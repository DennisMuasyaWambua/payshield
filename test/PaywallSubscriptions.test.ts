import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("PaywallSubscriptions", function () {
  let paywallSubscriptions: Contract;
  let mockUSDC: Contract;
  let owner: Signer;
  let creator: Signer;
  let subscriber: Signer;
  let treasury: Signer;

  const INITIAL_USDC_SUPPLY = ethers.parseUnits("1000000", 6); // 1M USDC
  const MONTHLY_PRICE = ethers.parseUnits("10", 6); // 10 USDC
  const ANNUAL_PRICE = ethers.parseUnits("100", 6); // 100 USDC (discounted)
  const PLATFORM_FEE_BPS = 250; // 2.5%
  const MAX_DEVICES = 3;

  beforeEach(async function () {
    [owner, creator, subscriber, treasury] = await ethers.getSigners();

    // Deploy mock USDC token
    const MockUSDC = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockUSDC.deploy("USD Coin", "USDC", 6);
    await mockUSDC.waitForDeployment();

    // Mint USDC to subscriber for testing
    await mockUSDC.mint(await subscriber.getAddress(), INITIAL_USDC_SUPPLY);

    // Deploy PaywallSubscriptions
    const PaywallSubscriptions = await ethers.getContractFactory("PaywallSubscriptions");
    paywallSubscriptions = await PaywallSubscriptions.deploy(
      await mockUSDC.getAddress(),
      await treasury.getAddress()
    );
    await paywallSubscriptions.waitForDeployment();
  });

  describe("Plan Management", function () {
    it("Should allow creator to create subscription plan", async function () {
      const contentIds = [1, 2, 3];
      
      const tx = await paywallSubscriptions.connect(creator).createPlan(
        "Premium Sports Package",
        "Access to all premium sports content",
        MONTHLY_PRICE,
        ANNUAL_PRICE,
        MAX_DEVICES,
        contentIds
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return paywallSubscriptions.interface.parseLog(log)?.name === "PlanCreated";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Check plan details
      const plan = await paywallSubscriptions.getPlan(1);
      expect(plan.creator).to.equal(await creator.getAddress());
      expect(plan.name).to.equal("Premium Sports Package");
      expect(plan.monthlyPriceUSDC).to.equal(MONTHLY_PRICE);
      expect(plan.annualPriceUSDC).to.equal(ANNUAL_PRICE);
      expect(plan.maxDevices).to.equal(MAX_DEVICES);
      expect(plan.isActive).to.be.true;
    });

    it("Should reject plan with annual price higher than monthly * 12", async function () {
      const invalidAnnualPrice = ethers.parseUnits("150", 6); // 150 USDC
      
      await expect(
        paywallSubscriptions.connect(creator).createPlan(
          "Invalid Plan",
          "This should fail",
          MONTHLY_PRICE,
          invalidAnnualPrice,
          MAX_DEVICES,
          [1, 2]
        )
      ).to.be.revertedWith("Annual price should be discounted");
    });

    it("Should allow creator to update plan status", async function () {
      // Create plan first
      await paywallSubscriptions.connect(creator).createPlan(
        "Test Plan",
        "Test Description",
        MONTHLY_PRICE,
        ANNUAL_PRICE,
        MAX_DEVICES,
        [1, 2]
      );

      // Update status
      await paywallSubscriptions.connect(creator).updatePlanStatus(1, false);

      const plan = await paywallSubscriptions.getPlan(1);
      expect(plan.isActive).to.be.false;
    });

    it("Should allow creator to add content to plan", async function () {
      // Create plan
      await paywallSubscriptions.connect(creator).createPlan(
        "Test Plan",
        "Test Description",
        MONTHLY_PRICE,
        ANNUAL_PRICE,
        MAX_DEVICES,
        [1, 2]
      );

      // Add content
      await paywallSubscriptions.connect(creator).addContentToPlan(1, 3);

      const plan = await paywallSubscriptions.getPlan(1);
      expect(plan.includedContentIds.length).to.equal(3);
      expect(plan.includedContentIds[2]).to.equal(3);
    });
  });

  describe("Subscription Management", function () {
    let planId: number;
    const deviceFingerprint = ethers.keccak256(ethers.toUtf8Bytes("device123"));

    beforeEach(async function () {
      // Create a plan
      await paywallSubscriptions.connect(creator).createPlan(
        "Premium Plan",
        "Premium content access",
        MONTHLY_PRICE,
        ANNUAL_PRICE,
        MAX_DEVICES,
        [1, 2, 3]
      );
      planId = 1;

      // Approve USDC spending
      await mockUSDC.connect(subscriber).approve(
        await paywallSubscriptions.getAddress(),
        INITIAL_USDC_SUPPLY
      );
    });

    it("Should allow user to subscribe monthly", async function () {
      const tx = await paywallSubscriptions.connect(subscriber).subscribe(
        planId,
        false, // monthly
        deviceFingerprint
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return paywallSubscriptions.interface.parseLog(log)?.name === "Subscribed";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Check subscription details
      const subscription = await paywallSubscriptions.getSubscription(1);
      expect(subscription.subscriber).to.equal(await subscriber.getAddress());
      expect(subscription.planId).to.equal(planId);
      expect(subscription.isAnnual).to.be.false;
      expect(subscription.autoRenew).to.be.true;

      // Check USDC was transferred
      const expectedCreatorAmount = MONTHLY_PRICE * BigInt(10000 - PLATFORM_FEE_BPS) / BigInt(10000);
      expect(await paywallSubscriptions.creatorBalances(await creator.getAddress())).to.equal(expectedCreatorAmount);
    });

    it("Should allow user to subscribe annually", async function () {
      await paywallSubscriptions.connect(subscriber).subscribe(
        planId,
        true, // annual
        deviceFingerprint
      );

      const subscription = await paywallSubscriptions.getSubscription(1);
      expect(subscription.isAnnual).to.be.true;
      expect(subscription.totalPaid).to.equal(ANNUAL_PRICE);
    });

    it("Should enforce device limits", async function () {
      // Subscribe first
      await paywallSubscriptions.connect(subscriber).subscribe(
        planId,
        false,
        deviceFingerprint
      );

      // Try to register more devices than allowed
      const device2 = ethers.keccak256(ethers.toUtf8Bytes("device2"));
      const device3 = ethers.keccak256(ethers.toUtf8Bytes("device3"));
      const device4 = ethers.keccak256(ethers.toUtf8Bytes("device4"));

      await paywallSubscriptions.connect(subscriber).registerDevice(1, device2);
      await paywallSubscriptions.connect(subscriber).registerDevice(1, device3);

      // Fourth device should fail
      await expect(
        paywallSubscriptions.connect(subscriber).registerDevice(1, device4)
      ).to.be.revertedWith("Device limit reached");
    });

    it("Should check subscription access correctly", async function () {
      // Subscribe
      await paywallSubscriptions.connect(subscriber).subscribe(
        planId,
        false,
        deviceFingerprint
      );

      // Check access for included content
      const [hasAccess1, subscriptionId1] = await paywallSubscriptions.checkSubscriptionAccess(
        await subscriber.getAddress(),
        1, // Content included in plan
        deviceFingerprint
      );
      expect(hasAccess1).to.be.true;
      expect(subscriptionId1).to.equal(1);

      // Check access for non-included content
      const [hasAccess2] = await paywallSubscriptions.checkSubscriptionAccess(
        await subscriber.getAddress(),
        99, // Content not included in plan
        deviceFingerprint
      );
      expect(hasAccess2).to.be.false;

      // Check access with unregistered device
      const unregisteredDevice = ethers.keccak256(ethers.toUtf8Bytes("unregistered"));
      const [hasAccess3] = await paywallSubscriptions.checkSubscriptionAccess(
        await subscriber.getAddress(),
        1,
        unregisteredDevice
      );
      expect(hasAccess3).to.be.false;
    });

    it("Should handle subscription cancellation", async function () {
      // Subscribe
      await paywallSubscriptions.connect(subscriber).subscribe(
        planId,
        false,
        deviceFingerprint
      );

      // Cancel subscription
      await paywallSubscriptions.connect(subscriber).cancelSubscription(1);

      const subscription = await paywallSubscriptions.getSubscription(1);
      expect(subscription.isCancelled).to.be.true;
      expect(subscription.autoRenew).to.be.false;

      // Access should be denied after cancellation
      const [hasAccess] = await paywallSubscriptions.checkSubscriptionAccess(
        await subscriber.getAddress(),
        1,
        deviceFingerprint
      );
      expect(hasAccess).to.be.false;

      // Check that subscriber count decreased
      const plan = await paywallSubscriptions.getPlan(planId);
      expect(plan.subscriberCount).to.equal(0);
    });
  });

  describe("Subscription Renewal", function () {
    let planId: number;
    let subscriptionId: number;
    const deviceFingerprint = ethers.keccak256(ethers.toUtf8Bytes("device123"));

    beforeEach(async function () {
      // Create plan and subscribe
      await paywallSubscriptions.connect(creator).createPlan(
        "Renewal Test Plan",
        "Test renewal",
        MONTHLY_PRICE,
        ANNUAL_PRICE,
        MAX_DEVICES,
        [1, 2]
      );
      planId = 1;

      await mockUSDC.connect(subscriber).approve(
        await paywallSubscriptions.getAddress(),
        INITIAL_USDC_SUPPLY
      );

      await paywallSubscriptions.connect(subscriber).subscribe(
        planId,
        false, // monthly
        deviceFingerprint
      );
      subscriptionId = 1;
    });

    it("Should allow manual renewal", async function () {
      // Fast forward time to near expiry
      const subscription = await paywallSubscriptions.getSubscription(subscriptionId);
      await time.increaseTo(Number(subscription.nextBillingDate) - 86400); // 1 day before

      const balanceBefore = await paywallSubscriptions.creatorBalances(await creator.getAddress());

      // Manually renew
      const tx = await paywallSubscriptions.connect(subscriber).renewSubscription(subscriptionId);

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return paywallSubscriptions.interface.parseLog(log)?.name === "SubscriptionRenewed";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Check updated subscription
      const updatedSubscription = await paywallSubscriptions.getSubscription(subscriptionId);
      expect(updatedSubscription.totalPaid).to.equal(MONTHLY_PRICE * BigInt(2));

      // Check creator balance increased
      const balanceAfter = await paywallSubscriptions.creatorBalances(await creator.getAddress());
      const expectedIncrease = MONTHLY_PRICE * BigInt(10000 - PLATFORM_FEE_BPS) / BigInt(10000);
      expect(balanceAfter - balanceBefore).to.equal(expectedIncrease);
    });

    it("Should prevent early renewal", async function () {
      await expect(
        paywallSubscriptions.connect(subscriber).renewSubscription(subscriptionId)
      ).to.be.revertedWith("Too early to renew");
    });

    it("Should handle expired subscription", async function () {
      // Fast forward past expiry
      const subscription = await paywallSubscriptions.getSubscription(subscriptionId);
      await time.increaseTo(Number(subscription.currentPeriodEnd) + 1);

      // Access should be denied for expired subscription
      const [hasAccess] = await paywallSubscriptions.checkSubscriptionAccess(
        await subscriber.getAddress(),
        1,
        deviceFingerprint
      );
      expect(hasAccess).to.be.false;
    });
  });

  describe("Creator Earnings", function () {
    beforeEach(async function () {
      // Create plan and some subscriptions
      await paywallSubscriptions.connect(creator).createPlan(
        "Earnings Test Plan",
        "Test earnings",
        MONTHLY_PRICE,
        ANNUAL_PRICE,
        MAX_DEVICES,
        [1]
      );

      await mockUSDC.connect(subscriber).approve(
        await paywallSubscriptions.getAddress(),
        INITIAL_USDC_SUPPLY
      );

      const deviceFingerprint = ethers.keccak256(ethers.toUtf8Bytes("device123"));
      await paywallSubscriptions.connect(subscriber).subscribe(1, false, deviceFingerprint);
    });

    it("Should allow creator to withdraw earnings", async function () {
      const balanceBefore = await mockUSDC.balanceOf(await creator.getAddress());
      const creatorBalance = await paywallSubscriptions.creatorBalances(await creator.getAddress());

      const tx = await paywallSubscriptions.connect(creator).withdrawCreatorBalance();

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return paywallSubscriptions.interface.parseLog(log)?.name === "CreatorWithdrawal";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      const balanceAfter = await mockUSDC.balanceOf(await creator.getAddress());
      expect(balanceAfter - balanceBefore).to.equal(creatorBalance);

      // Creator balance should be reset to 0
      expect(await paywallSubscriptions.creatorBalances(await creator.getAddress())).to.equal(0);
    });

    it("Should reject withdrawal with zero balance", async function () {
      // First withdraw everything
      await paywallSubscriptions.connect(creator).withdrawCreatorBalance();

      // Try to withdraw again
      await expect(
        paywallSubscriptions.connect(creator).withdrawCreatorBalance()
      ).to.be.revertedWith("No balance to withdraw");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set platform fee", async function () {
      const newFeeBps = 500; // 5%
      await paywallSubscriptions.connect(owner).setPlatformFee(newFeeBps);
      
      expect(await paywallSubscriptions.platformFeeBps()).to.equal(newFeeBps);
    });

    it("Should reject platform fee above maximum", async function () {
      const invalidFeeBps = 1000; // 10% (above 7.5% max)
      
      await expect(
        paywallSubscriptions.connect(owner).setPlatformFee(invalidFeeBps)
      ).to.be.revertedWith("Fee too high");
    });

    it("Should allow admin to pause contract", async function () {
      await paywallSubscriptions.connect(owner).pause();

      const deviceFingerprint = ethers.keccak256(ethers.toUtf8Bytes("device123"));
      await expect(
        paywallSubscriptions.connect(creator).createPlan(
          "Test Plan",
          "Test",
          MONTHLY_PRICE,
          ANNUAL_PRICE,
          MAX_DEVICES,
          [1]
        )
      ).to.be.revertedWithCustomError(paywallSubscriptions, "EnforcedPause");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      // Setup some data
      await paywallSubscriptions.connect(creator).createPlan(
        "Test Plan 1",
        "First plan",
        MONTHLY_PRICE,
        ANNUAL_PRICE,
        MAX_DEVICES,
        [1, 2]
      );

      await paywallSubscriptions.connect(creator).createPlan(
        "Test Plan 2", 
        "Second plan",
        MONTHLY_PRICE * BigInt(2),
        ANNUAL_PRICE * BigInt(2),
        MAX_DEVICES,
        [3, 4]
      );

      await mockUSDC.connect(subscriber).approve(
        await paywallSubscriptions.getAddress(),
        INITIAL_USDC_SUPPLY
      );

      const deviceFingerprint = ethers.keccak256(ethers.toUtf8Bytes("device123"));
      await paywallSubscriptions.connect(subscriber).subscribe(1, false, deviceFingerprint);
    });

    it("Should return creator plans", async function () {
      const plans = await paywallSubscriptions.getCreatorPlans(await creator.getAddress());
      expect(plans.length).to.equal(2);
      expect(plans[0]).to.equal(1);
      expect(plans[1]).to.equal(2);
    });

    it("Should return user subscriptions", async function () {
      const subscriptions = await paywallSubscriptions.getUserSubscriptions(await subscriber.getAddress());
      expect(subscriptions.length).to.equal(1);
      expect(subscriptions[0]).to.equal(1);
    });

    it("Should check subscription active status", async function () {
      const isActive = await paywallSubscriptions.isSubscriptionActive(1);
      expect(isActive).to.be.true;

      // Cancel and check again
      await paywallSubscriptions.connect(subscriber).cancelSubscription(1);
      const isActiveAfterCancel = await paywallSubscriptions.isSubscriptionActive(1);
      expect(isActiveAfterCancel).to.be.false;
    });
  });
});