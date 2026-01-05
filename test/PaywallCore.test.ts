import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("PaywallCore", function () {
  let paywallCore: Contract;
  let mockUSDC: Contract;
  let owner: Signer;
  let creator: Signer;
  let user: Signer;
  let treasury: Signer;

  const INITIAL_USDC_SUPPLY = ethers.parseUnits("1000000", 6); // 1M USDC
  const CONTENT_PRICE = ethers.parseUnits("10", 6); // 10 USDC
  const PLATFORM_FEE_BPS = 250; // 2.5%

  beforeEach(async function () {
    [owner, creator, user, treasury] = await ethers.getSigners();

    // Deploy mock USDC token
    const MockUSDC = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockUSDC.deploy("USD Coin", "USDC", 6);
    await mockUSDC.waitForDeployment();

    // Mint USDC to user for testing
    await mockUSDC.mint(await user.getAddress(), INITIAL_USDC_SUPPLY);

    // Deploy PaywallCore
    const PaywallCore = await ethers.getContractFactory("PaywallCore");
    paywallCore = await PaywallCore.deploy(
      await mockUSDC.getAddress(),
      await treasury.getAddress()
    );
    await paywallCore.waitForDeployment();
  });

  describe("Content Registration", function () {
    it("Should allow creator to register content", async function () {
      const contentHash = "QmTestContentHash123";
      const accessDuration = 86400; // 24 hours
      const maxDevices = 3;

      const tx = await paywallCore.connect(creator).registerContent(
        CONTENT_PRICE,
        accessDuration,
        maxDevices,
        contentHash
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return paywallCore.interface.parseLog(log)?.name === "ContentRegistered";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Check content details
      const content = await paywallCore.getContent(1);
      expect(content.creator).to.equal(await creator.getAddress());
      expect(content.priceUSDC).to.equal(CONTENT_PRICE);
      expect(content.accessDuration).to.equal(accessDuration);
      expect(content.maxDevices).to.equal(maxDevices);
      expect(content.contentHash).to.equal(contentHash);
      expect(content.isActive).to.be.true;
    });

    it("Should reject content registration with zero price", async function () {
      await expect(
        paywallCore.connect(creator).registerContent(
          0,
          86400,
          3,
          "QmTestHash"
        )
      ).to.be.revertedWith("Price must be greater than 0");
    });

    it("Should reject content registration with zero max devices", async function () {
      await expect(
        paywallCore.connect(creator).registerContent(
          CONTENT_PRICE,
          86400,
          0,
          "QmTestHash"
        )
      ).to.be.revertedWith("Max devices must be greater than 0");
    });
  });

  describe("Payment Flow", function () {
    let contentId: number;
    const deviceFingerprint = ethers.keccak256(ethers.toUtf8Bytes("device123"));
    const preimage = ethers.randomBytes(32);
    const paymentHash = ethers.sha256(preimage);

    beforeEach(async function () {
      // Register content first
      await paywallCore.connect(creator).registerContent(
        CONTENT_PRICE,
        86400, // 24 hours
        3,     // max 3 devices
        "QmTestContentHash"
      );
      contentId = 1;

      // Approve USDC spending
      await mockUSDC.connect(user).approve(
        await paywallCore.getAddress(),
        CONTENT_PRICE
      );
    });

    it("Should create payment intent", async function () {
      const expiryMinutes = 60; // 1 hour

      const tx = await paywallCore.connect(user).createPayment(
        paymentHash,
        contentId,
        expiryMinutes
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return paywallCore.interface.parseLog(log)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Check USDC was transferred to contract
      expect(await mockUSDC.balanceOf(await paywallCore.getAddress())).to.equal(CONTENT_PRICE);
    });

    it("Should complete payment with correct preimage", async function () {
      // Create payment
      await paywallCore.connect(user).createPayment(
        paymentHash,
        contentId,
        60
      );

      // Complete payment
      const tx = await paywallCore.connect(user).completePayment(
        preimage,
        deviceFingerprint
      );

      const receipt = await tx.wait();
      
      // Check for PaymentCompleted event
      const paymentEvent = receipt?.logs?.find((log: any) => {
        try {
          return paywallCore.interface.parseLog(log)?.name === "PaymentCompleted";
        } catch {
          return false;
        }
      });
      expect(paymentEvent).to.exist;

      // Check for AccessGranted event
      const accessEvent = receipt?.logs?.find((log: any) => {
        try {
          return paywallCore.interface.parseLog(log)?.name === "AccessGranted";
        } catch {
          return false;
        }
      });
      expect(accessEvent).to.exist;

      // Verify access
      const [hasAccess] = await paywallCore.verifyAccess(
        contentId,
        deviceFingerprint,
        await user.getAddress()
      );
      expect(hasAccess).to.be.true;

      // Check creator balance
      const expectedCreatorAmount = CONTENT_PRICE * BigInt(10000 - PLATFORM_FEE_BPS) / BigInt(10000);
      expect(await paywallCore.creatorBalances(await creator.getAddress())).to.equal(expectedCreatorAmount);
    });

    it("Should reject payment completion with wrong preimage", async function () {
      // Create payment
      await paywallCore.connect(user).createPayment(
        paymentHash,
        contentId,
        60
      );

      // Try to complete with wrong preimage
      const wrongPreimage = ethers.randomBytes(32);
      
      await expect(
        paywallCore.connect(user).completePayment(wrongPreimage, deviceFingerprint)
      ).to.be.revertedWith("Payment not found");
    });

    it("Should allow creator to withdraw balance", async function () {
      // Complete a payment first
      await paywallCore.connect(user).createPayment(paymentHash, contentId, 60);
      await paywallCore.connect(user).completePayment(preimage, deviceFingerprint);

      const balanceBefore = await mockUSDC.balanceOf(await creator.getAddress());
      
      await paywallCore.connect(creator).withdrawCreatorBalance();

      const balanceAfter = await mockUSDC.balanceOf(await creator.getAddress());
      const expectedAmount = CONTENT_PRICE * BigInt(10000 - PLATFORM_FEE_BPS) / BigInt(10000);
      
      expect(balanceAfter - balanceBefore).to.equal(expectedAmount);
    });
  });

  describe("Device Access Control", function () {
    let contentId: number;
    const deviceFingerprint1 = ethers.keccak256(ethers.toUtf8Bytes("device1"));
    const deviceFingerprint2 = ethers.keccak256(ethers.toUtf8Bytes("device2"));
    const deviceFingerprint3 = ethers.keccak256(ethers.toUtf8Bytes("device3"));
    const deviceFingerprint4 = ethers.keccak256(ethers.toUtf8Bytes("device4"));

    beforeEach(async function () {
      // Register content with max 2 devices
      await paywallCore.connect(creator).registerContent(
        CONTENT_PRICE,
        86400, // 24 hours
        2,     // max 2 devices
        "QmTestContentHash"
      );
      contentId = 1;

      await mockUSDC.connect(user).approve(
        await paywallCore.getAddress(),
        CONTENT_PRICE * BigInt(10) // Approve for multiple payments
      );
    });

    it("Should enforce device limits", async function () {
      // First device - should work
      const preimage1 = ethers.randomBytes(32);
      const paymentHash1 = ethers.sha256(preimage1);
      
      await paywallCore.connect(user).createPayment(paymentHash1, contentId, 60);
      await paywallCore.connect(user).completePayment(preimage1, deviceFingerprint1);

      // Second device - should work
      const preimage2 = ethers.randomBytes(32);
      const paymentHash2 = ethers.sha256(preimage2);
      
      await paywallCore.connect(user).createPayment(paymentHash2, contentId, 60);
      await paywallCore.connect(user).completePayment(preimage2, deviceFingerprint2);

      // Third device - should fail due to device limit
      const preimage3 = ethers.randomBytes(32);
      const paymentHash3 = ethers.sha256(preimage3);
      
      await paywallCore.connect(user).createPayment(paymentHash3, contentId, 60);
      await expect(
        paywallCore.connect(user).completePayment(preimage3, deviceFingerprint3)
      ).to.be.revertedWith("Device limit exceeded");
    });

    it("Should allow access from same device multiple times", async function () {
      const preimage = ethers.randomBytes(32);
      const paymentHash = ethers.sha256(preimage);
      
      await paywallCore.connect(user).createPayment(paymentHash, contentId, 60);
      await paywallCore.connect(user).completePayment(preimage, deviceFingerprint1);

      // Same device should still have access
      const [hasAccess] = await paywallCore.verifyAccess(
        contentId,
        deviceFingerprint1,
        await user.getAddress()
      );
      expect(hasAccess).to.be.true;

      // Record additional access
      await paywallCore.recordAccess(contentId, deviceFingerprint1);
    });

    it("Should allow admin to revoke device access", async function () {
      const preimage = ethers.randomBytes(32);
      const paymentHash = ethers.sha256(preimage);
      
      await paywallCore.connect(user).createPayment(paymentHash, contentId, 60);
      await paywallCore.connect(user).completePayment(preimage, deviceFingerprint1);

      // Verify access works
      let [hasAccess] = await paywallCore.verifyAccess(
        contentId,
        deviceFingerprint1,
        await user.getAddress()
      );
      expect(hasAccess).to.be.true;

      // Creator revokes access
      await paywallCore.connect(creator).revokeDeviceAccess(contentId, deviceFingerprint1);

      // Verify access is revoked
      [hasAccess] = await paywallCore.verifyAccess(
        contentId,
        deviceFingerprint1,
        await user.getAddress()
      );
      expect(hasAccess).to.be.false;
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to pause contract", async function () {
      await paywallCore.connect(owner).pause();

      await expect(
        paywallCore.connect(creator).registerContent(
          CONTENT_PRICE,
          86400,
          3,
          "QmTestHash"
        )
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should allow admin to set platform fee", async function () {
      const newFeeBps = 500; // 5%
      await paywallCore.connect(owner).setPlatformFee(newFeeBps);
      
      expect(await paywallCore.platformFeeBps()).to.equal(newFeeBps);
    });

    it("Should reject platform fee above maximum", async function () {
      const invalidFeeBps = 1000; // 10% (above 7.5% max)
      
      await expect(
        paywallCore.connect(owner).setPlatformFee(invalidFeeBps)
      ).to.be.revertedWith("Fee too high");
    });
  });
});