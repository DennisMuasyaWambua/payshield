import { ethers } from "hardhat";
import { Contract } from "ethers";

async function main() {
  console.log("🚀 Starting PayShield Protocol deployment...\n");

  // Check if private key is configured
  if (!process.env.PRIVATE_KEY) {
    throw new Error(
      "PRIVATE_KEY not found in environment variables.\n" +
      "Please create a .env file from .env.example and set your PRIVATE_KEY.\n" +
      "Example: cp .env.example .env && nano .env"
    );
  }

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signers available. Please check your network configuration.");
  }

  const deployer = signers[0];
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH\n");

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log("Network:", network.name, "(Chain ID:", network.chainId, ")\n");

  // USDC address based on network
  let usdcAddress: string;
  if (network.chainId === BigInt(8453)) {
    // Base Mainnet
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  } else if (network.chainId === BigInt(84532)) {
    // Base Sepolia
    usdcAddress = process.env.USDC_SEPOLIA_ADDRESS || "0x..."; // Deploy mock USDC if needed
  } else {
    throw new Error(`Unsupported network: ${network.chainId}`);
  }

  // Treasury address (use deployer for testnet, proper address for mainnet)
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;

  console.log("Configuration:");
  console.log("- USDC Address:", usdcAddress);
  console.log("- Treasury Address:", treasuryAddress);
  console.log();

  // Deploy contracts
  const contracts: { [key: string]: Contract } = {};

  // 1. Deploy PaywallRegistry
  console.log("📋 Deploying PaywallRegistry...");
  const PaywallRegistry = await ethers.getContractFactory("PaywallRegistry");
  contracts.registry = await PaywallRegistry.deploy(treasuryAddress);
  await contracts.registry.waitForDeployment();
  console.log("✅ PaywallRegistry deployed to:", await contracts.registry.getAddress());
  console.log();

  // 2. Deploy DeviceAccessManager
  console.log("🔍 Deploying DeviceAccessManager...");
  const DeviceAccessManager = await ethers.getContractFactory("DeviceAccessManager");
  contracts.deviceManager = await DeviceAccessManager.deploy();
  await contracts.deviceManager.waitForDeployment();
  console.log("✅ DeviceAccessManager deployed to:", await contracts.deviceManager.getAddress());
  console.log();

  // 3. Deploy PaywallCore
  console.log("💰 Deploying PaywallCore...");
  const PaywallCore = await ethers.getContractFactory("PaywallCore");
  contracts.core = await PaywallCore.deploy(usdcAddress, treasuryAddress);
  await contracts.core.waitForDeployment();
  console.log("✅ PaywallCore deployed to:", await contracts.core.getAddress());
  console.log();

  // 4. Deploy PaywallSubscriptions
  console.log("📅 Deploying PaywallSubscriptions...");
  const PaywallSubscriptions = await ethers.getContractFactory("PaywallSubscriptions");
  contracts.subscriptions = await PaywallSubscriptions.deploy(usdcAddress, treasuryAddress);
  await contracts.subscriptions.waitForDeployment();
  console.log("✅ PaywallSubscriptions deployed to:", await contracts.subscriptions.getAddress());
  console.log();

  // Setup permissions and initial configuration
  console.log("⚙️  Setting up permissions and configuration...");

  // Grant admin roles
  const ADMIN_ROLE = await contracts.registry.ADMIN_ROLE();
  const ORACLE_ROLE = await contracts.deviceManager.ORACLE_ROLE();

  console.log("- Granting admin roles...");
  await contracts.registry.grantRole(ADMIN_ROLE, await contracts.core.getAddress());
  await contracts.deviceManager.grantRole(ORACLE_ROLE, deployer.address); // Backend will use oracle role
  
  // Set initial platform configuration
  console.log("- Setting platform configuration...");
  await contracts.registry.updatePlatformConfig(
    250,         // 2.5% default fee
    750,         // 7.5% max fee
    treasuryAddress,
    true,        // payments enabled
    true,        // subscriptions enabled
    ethers.parseUnits("1", 6),      // 1 USDC min price
    ethers.parseUnits("10000", 6)   // 10,000 USDC max price
  );

  console.log("✅ Configuration complete!\n");

  // Display deployment summary
  console.log("🎉 Deployment Summary:");
  console.log("====================");
  console.log("PaywallRegistry:     ", await contracts.registry.getAddress());
  console.log("DeviceAccessManager: ", await contracts.deviceManager.getAddress());
  console.log("PaywallCore:         ", await contracts.core.getAddress());
  console.log("PaywallSubscriptions:", await contracts.subscriptions.getAddress());
  console.log("USDC Token:          ", usdcAddress);
  console.log("Treasury:            ", treasuryAddress);
  console.log();

  // Save deployment info to file
  const deploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      PaywallRegistry: await contracts.registry.getAddress(),
      DeviceAccessManager: await contracts.deviceManager.getAddress(),
      PaywallCore: await contracts.core.getAddress(),
      PaywallSubscriptions: await contracts.subscriptions.getAddress(),
    },
    config: {
      usdcAddress,
      treasuryAddress,
    }
  };

  // Write to deployments directory
  const fs = require("fs");
  const path = require("path");
  
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }
  
  const deploymentFile = path.join(deploymentsDir, `${network.name}-${Date.now()}.json`);
  fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("📄 Deployment info saved to:", deploymentFile);

  // Environment variables for .env file
  console.log("\n📝 Add these to your .env file:");
  console.log("================================");
  console.log(`PAYWALL_REGISTRY_ADDRESS=${await contracts.registry.getAddress()}`);
  console.log(`DEVICE_ACCESS_MANAGER_ADDRESS=${await contracts.deviceManager.getAddress()}`);
  console.log(`PAYWALL_CORE_ADDRESS=${await contracts.core.getAddress()}`);
  console.log(`PAYWALL_SUBSCRIPTIONS_ADDRESS=${await contracts.subscriptions.getAddress()}`);
  console.log();

  // Gas usage summary
  const deploymentTx1 = await contracts.registry.deploymentTransaction();
  const deploymentTx2 = await contracts.deviceManager.deploymentTransaction();
  const deploymentTx3 = await contracts.core.deploymentTransaction();
  const deploymentTx4 = await contracts.subscriptions.deploymentTransaction();
  
  if (deploymentTx1 && deploymentTx2 && deploymentTx3 && deploymentTx4) {
    const receipt1 = await deploymentTx1.wait();
    const receipt2 = await deploymentTx2.wait();
    const receipt3 = await deploymentTx3.wait();
    const receipt4 = await deploymentTx4.wait();
    
    const totalGasUsed = (receipt1?.gasUsed || 0n) + (receipt2?.gasUsed || 0n) + 
                        (receipt3?.gasUsed || 0n) + (receipt4?.gasUsed || 0n);
    
    console.log("⛽ Gas Usage Summary:");
    console.log("===================");
    console.log("PaywallRegistry:     ", receipt1?.gasUsed?.toString() || "N/A");
    console.log("DeviceAccessManager: ", receipt2?.gasUsed?.toString() || "N/A");
    console.log("PaywallCore:         ", receipt3?.gasUsed?.toString() || "N/A");
    console.log("PaywallSubscriptions:", receipt4?.gasUsed?.toString() || "N/A");
    console.log("Total Gas Used:      ", totalGasUsed.toString());
  }

  console.log("\n🔧 Next steps:");
  console.log("1. Verify contracts on BaseScan (run: npm run verify)");
  console.log("2. Deploy backend APIs");
  console.log("3. Set up Element Pay integration");
  console.log("4. Deploy frontend application");
  console.log("5. Configure monitoring and analytics");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });