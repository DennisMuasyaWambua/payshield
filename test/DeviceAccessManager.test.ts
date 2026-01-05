import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";

describe("DeviceAccessManager", function () {
  let deviceAccessManager: Contract;
  let owner: Signer;
  let user1: Signer;
  let user2: Signer;
  let oracle: Signer;

  const DEVICE_1 = ethers.keccak256(ethers.toUtf8Bytes("device1"));
  const DEVICE_2 = ethers.keccak256(ethers.toUtf8Bytes("device2"));
  const DEVICE_3 = ethers.keccak256(ethers.toUtf8Bytes("device3"));
  const ENCRYPTED_METADATA = "encrypted_device_metadata_here";

  beforeEach(async function () {
    [owner, user1, user2, oracle] = await ethers.getSigners();

    // Deploy DeviceAccessManager
    const DeviceAccessManager = await ethers.getContractFactory("DeviceAccessManager");
    deviceAccessManager = await DeviceAccessManager.deploy();
    await deviceAccessManager.waitForDeployment();

    // Grant oracle role
    const ORACLE_ROLE = await deviceAccessManager.ORACLE_ROLE();
    await deviceAccessManager.grantRole(ORACLE_ROLE, await oracle.getAddress());
  });

  describe("Device Registration", function () {
    it("Should allow user to register device", async function () {
      const tx = await deviceAccessManager.connect(user1).registerDevice(
        DEVICE_1,
        ENCRYPTED_METADATA
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "DeviceRegistered";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Check device record
      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.owner).to.equal(await user1.getAddress());
      expect(record.isActive).to.be.true;
      expect(record.isBlacklisted).to.be.false;
      expect(record.suspicionScore).to.equal(0);

      // Check stats
      const [totalDevices, activeDevices] = await deviceAccessManager.getDeviceStats();
      expect(totalDevices).to.equal(1);
      expect(activeDevices).to.equal(1);
    });

    it("Should prevent registering same device by different user", async function () {
      // User1 registers device
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);

      // User2 tries to register same device
      await expect(
        deviceAccessManager.connect(user2).registerDevice(DEVICE_1, ENCRYPTED_METADATA)
      ).to.be.revertedWith("Device owned by another user");
    });

    it("Should prevent registering blacklisted device", async function () {
      // Register and then blacklist device
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
      await deviceAccessManager.connect(owner).blacklistDevice(DEVICE_1, "Test blacklist");

      // Try to register blacklisted device
      await expect(
        deviceAccessManager.connect(user2).registerDevice(DEVICE_1, ENCRYPTED_METADATA)
      ).to.be.revertedWith("Device globally blacklisted");
    });

    it("Should enforce max devices per user", async function () {
      const MAX_DEVICES = await deviceAccessManager.MAX_DEVICES_PER_USER();
      
      // Register maximum allowed devices
      for (let i = 0; i < MAX_DEVICES; i++) {
        const deviceHash = ethers.keccak256(ethers.toUtf8Bytes(`device${i}`));
        await deviceAccessManager.connect(user1).registerDevice(deviceHash, ENCRYPTED_METADATA);
      }

      // Try to register one more device
      const extraDevice = ethers.keccak256(ethers.toUtf8Bytes("extra_device"));
      await expect(
        deviceAccessManager.connect(user1).registerDevice(extraDevice, ENCRYPTED_METADATA)
      ).to.be.revertedWith("Max devices exceeded");
    });

    it("Should allow reactivating inactive device", async function () {
      // Register and remove device
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
      await deviceAccessManager.connect(user1).removeDevice(DEVICE_1);

      // Reactivate device
      const tx = await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
      
      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.isActive).to.be.true;
    });
  });

  describe("Device Verification", function () {
    beforeEach(async function () {
      // Register some devices
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
      await deviceAccessManager.connect(user2).registerDevice(DEVICE_2, ENCRYPTED_METADATA);
    });

    it("Should verify valid device", async function () {
      const [isValid, suspicionScore] = await deviceAccessManager.verifyDevice(
        DEVICE_1,
        await user1.getAddress()
      );

      expect(isValid).to.be.true;
      expect(suspicionScore).to.equal(0);
    });

    it("Should reject unregistered device", async function () {
      const [isValid, suspicionScore] = await deviceAccessManager.verifyDevice(
        DEVICE_3,
        await user1.getAddress()
      );

      expect(isValid).to.be.false;
      expect(suspicionScore).to.equal(0);
    });

    it("Should reject device with wrong owner", async function () {
      const [isValid, suspicionScore] = await deviceAccessManager.verifyDevice(
        DEVICE_1,
        await user2.getAddress()
      );

      expect(isValid).to.be.false;
      expect(suspicionScore).to.equal(90);
    });

    it("Should reject blacklisted device", async function () {
      // Blacklist device
      await deviceAccessManager.connect(owner).blacklistDevice(DEVICE_1, "Security concern");

      const [isValid, suspicionScore] = await deviceAccessManager.verifyDevice(
        DEVICE_1,
        await user1.getAddress()
      );

      expect(isValid).to.be.false;
      expect(suspicionScore).to.equal(100);
    });
  });

  describe("Access Recording", function () {
    beforeEach(async function () {
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
    });

    it("Should record device access", async function () {
      const contentId = 123;
      
      const tx = await deviceAccessManager.recordAccess(
        DEVICE_1,
        contentId,
        await user1.getAddress()
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "DeviceAccessRecorded";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Check updated access count
      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.totalAccessCount).to.equal(1);
    });

    it("Should prevent access recording for non-owner", async function () {
      await expect(
        deviceAccessManager.recordAccess(DEVICE_1, 123, await user2.getAddress())
      ).to.be.revertedWith("Device not owned by user");
    });

    it("Should prevent access recording for blacklisted device", async function () {
      // Blacklist device
      await deviceAccessManager.connect(owner).blacklistDevice(DEVICE_1, "Blacklisted");

      await expect(
        deviceAccessManager.recordAccess(DEVICE_1, 123, await user1.getAddress())
      ).to.be.revertedWith("Device not accessible");
    });
  });

  describe("Suspicion Score Management", function () {
    beforeEach(async function () {
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
    });

    it("Should allow oracle to update suspicion score", async function () {
      const newScore = 75;
      const reason = "Suspicious activity detected";

      const tx = await deviceAccessManager.connect(oracle).updateSuspicionScore(
        DEVICE_1,
        newScore,
        reason
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "SuspicionScoreUpdated";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.suspicionScore).to.equal(newScore);
    });

    it("Should auto-blacklist device with high suspicion score", async function () {
      const BLACKLIST_THRESHOLD = await deviceAccessManager.BLACKLIST_THRESHOLD();
      
      const tx = await deviceAccessManager.connect(oracle).updateSuspicionScore(
        DEVICE_1,
        Number(BLACKLIST_THRESHOLD) + 1,
        "Auto-blacklist threshold reached"
      );

      const receipt = await tx.wait();
      const blacklistEvent = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "DeviceBlacklisted";
        } catch {
          return false;
        }
      });

      expect(blacklistEvent).to.exist;

      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.isBlacklisted).to.be.true;
    });

    it("Should prevent non-oracle from updating suspicion score", async function () {
      await expect(
        deviceAccessManager.connect(user1).updateSuspicionScore(DEVICE_1, 50, "Test")
      ).to.be.revertedWith(/AccessControl:/);
    });

    it("Should reject suspicion score above maximum", async function () {
      const MAX_SCORE = await deviceAccessManager.MAX_SUSPICION_SCORE();
      
      await expect(
        deviceAccessManager.connect(oracle).updateSuspicionScore(
          DEVICE_1,
          Number(MAX_SCORE) + 1,
          "Too high"
        )
      ).to.be.revertedWith("Score exceeds maximum");
    });
  });

  describe("Device Blacklisting", function () {
    beforeEach(async function () {
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
    });

    it("Should allow admin to blacklist device", async function () {
      const reason = "Security violation";

      const tx = await deviceAccessManager.connect(owner).blacklistDevice(DEVICE_1, reason);

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "DeviceBlacklisted";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.isBlacklisted).to.be.true;
      expect(record.isActive).to.be.false;

      // Check stats updated
      const [, , blacklistedDevices] = await deviceAccessManager.getDeviceStats();
      expect(blacklistedDevices).to.equal(1);
    });

    it("Should allow admin to whitelist device", async function () {
      // First blacklist
      await deviceAccessManager.connect(owner).blacklistDevice(DEVICE_1, "Test blacklist");

      // Then whitelist
      const tx = await deviceAccessManager.connect(owner).whitelistDevice(DEVICE_1);

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "DeviceWhitelisted";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.isBlacklisted).to.be.false;
      expect(record.isActive).to.be.true;
      expect(record.suspicionScore).to.equal(0); // Reset to 0
    });

    it("Should prevent blacklisting non-existent device", async function () {
      await expect(
        deviceAccessManager.connect(owner).blacklistDevice(DEVICE_3, "Does not exist")
      ).to.be.revertedWith("Device not found");
    });

    it("Should prevent whitelisting non-blacklisted device", async function () {
      await expect(
        deviceAccessManager.connect(owner).whitelistDevice(DEVICE_1)
      ).to.be.revertedWith("Device not blacklisted");
    });
  });

  describe("Device Management", function () {
    beforeEach(async function () {
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_2, ENCRYPTED_METADATA);
    });

    it("Should allow user to remove own device", async function () {
      const tx = await deviceAccessManager.connect(user1).removeDevice(DEVICE_1);

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "DeviceRemoved";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.isActive).to.be.false;

      // Check device removed from user's list
      const userDevices = await deviceAccessManager.getUserDevices(await user1.getAddress());
      expect(userDevices.length).to.equal(1);
      expect(userDevices[0].fingerprintHash).to.equal(DEVICE_2);
    });

    it("Should prevent removing device not owned", async function () {
      await expect(
        deviceAccessManager.connect(user2).removeDevice(DEVICE_1)
      ).to.be.revertedWith("Device not owned");
    });

    it("Should allow fingerprint update with cooldown", async function () {
      const newDevice = ethers.keccak256(ethers.toUtf8Bytes("new_device"));
      const COOLDOWN = await deviceAccessManager.FINGERPRINT_CHANGE_COOLDOWN();

      // Fast forward time past cooldown
      await ethers.provider.send("evm_increaseTime", [Number(COOLDOWN) + 1]);

      const tx = await deviceAccessManager.connect(user1).updateFingerprint(
        DEVICE_1,
        newDevice,
        "new_encrypted_metadata"
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "FingerprintChanged";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      // Old device should be inactive
      const oldRecord = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(oldRecord.isActive).to.be.false;

      // New device should be active with inherited data
      const newRecord = await deviceAccessManager.deviceRecords(newDevice);
      expect(newRecord.isActive).to.be.true;
      expect(newRecord.owner).to.equal(await user1.getAddress());
      expect(newRecord.suspicionScore).to.equal(10); // Slight increase for fingerprint change
    });

    it("Should prevent fingerprint update before cooldown", async function () {
      const newDevice = ethers.keccak256(ethers.toUtf8Bytes("new_device"));

      await expect(
        deviceAccessManager.connect(user1).updateFingerprint(
          DEVICE_1,
          newDevice,
          "new_metadata"
        )
      ).to.be.revertedWith("Fingerprint change too frequent");
    });
  });

  describe("Suspicious Activity Reporting", function () {
    beforeEach(async function () {
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
    });

    it("Should allow oracle to report suspicious activity", async function () {
      const activity = "Automated access pattern detected";
      const suspicionIncrease = 30;

      const tx = await deviceAccessManager.connect(oracle).reportSuspiciousActivity(
        DEVICE_1,
        activity,
        suspicionIncrease
      );

      const receipt = await tx.wait();
      const event = receipt?.logs?.find((log: any) => {
        try {
          return deviceAccessManager.interface.parseLog(log)?.name === "SuspiciousActivityDetected";
        } catch {
          return false;
        }
      });

      expect(event).to.exist;

      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.suspicionScore).to.equal(suspicionIncrease);
    });

    it("Should cap suspicion increase", async function () {
      await expect(
        deviceAccessManager.connect(oracle).reportSuspiciousActivity(
          DEVICE_1,
          "High increase",
          60 // Above max of 50
        )
      ).to.be.revertedWith("Suspicion increase too high");
    });

    it("Should auto-blacklist on high suspicion", async function () {
      const THRESHOLD = await deviceAccessManager.BLACKLIST_THRESHOLD();
      
      // Report activity that pushes score above threshold
      await deviceAccessManager.connect(oracle).reportSuspiciousActivity(
        DEVICE_1,
        "Severe violation",
        Number(THRESHOLD)
      );

      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.isBlacklisted).to.be.true;
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      // Setup test data
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_2, ENCRYPTED_METADATA);
      await deviceAccessManager.connect(user2).registerDevice(DEVICE_3, ENCRYPTED_METADATA);

      // Record some access
      await deviceAccessManager.recordAccess(DEVICE_1, 1, await user1.getAddress());
      await deviceAccessManager.recordAccess(DEVICE_1, 2, await user1.getAddress());
    });

    it("Should return user devices", async function () {
      const devices = await deviceAccessManager.getUserDevices(await user1.getAddress());
      expect(devices.length).to.equal(2);
      
      const device1 = devices.find(d => d.fingerprintHash === DEVICE_1);
      expect(device1?.owner).to.equal(await user1.getAddress());
      expect(device1?.totalAccessCount).to.equal(2);
    });

    it("Should return device analytics", async function () {
      const [dailyAccesses, weeklyAccesses, monthlyAccesses, uniqueContent] = 
        await deviceAccessManager.getDeviceAnalytics(DEVICE_1);

      expect(dailyAccesses).to.equal(2);
      expect(weeklyAccesses).to.equal(2);
      expect(monthlyAccesses).to.equal(2);
      expect(uniqueContent).to.equal(2);
    });

    it("Should return platform device statistics", async function () {
      const [totalDevices, activeDevices, blacklistedDevices] = 
        await deviceAccessManager.getDeviceStats();

      expect(totalDevices).to.equal(3);
      expect(activeDevices).to.equal(3);
      expect(blacklistedDevices).to.equal(0);
    });

    it("Should return device activity history", async function () {
      const activityIds = await deviceAccessManager.getDeviceActivityHistory(DEVICE_1);
      expect(activityIds.length).to.equal(3); // 1 registration + 2 access records
    });

    it("Should return suspicion history", async function () {
      // Add some suspicion events
      await deviceAccessManager.connect(oracle).updateSuspicionScore(DEVICE_1, 25, "Test1");
      await deviceAccessManager.connect(oracle).reportSuspiciousActivity(DEVICE_1, "Test2", 10);

      const history = await deviceAccessManager.getSuspicionHistory(DEVICE_1);
      expect(history.length).to.equal(2);
      expect(history[0].reason).to.equal("Test1");
      expect(history[1].reason).to.equal("Test2");
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to pause contract", async function () {
      await deviceAccessManager.connect(owner).pause();

      await expect(
        deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should allow admin to unpause contract", async function () {
      await deviceAccessManager.connect(owner).pause();
      await deviceAccessManager.connect(owner).unpause();

      // Should work again
      await deviceAccessManager.connect(user1).registerDevice(DEVICE_1, ENCRYPTED_METADATA);
      
      const record = await deviceAccessManager.deviceRecords(DEVICE_1);
      expect(record.isActive).to.be.true;
    });

    it("Should prevent non-admin from pausing", async function () {
      await expect(
        deviceAccessManager.connect(user1).pause()
      ).to.be.revertedWith(/AccessControl:/);
    });
  });
});