// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PaywallCore
 * @notice Main payment contract for paywall access control
 * @dev Handles USDC payments, device verification, and access grants
 */
contract PaywallCore is ReentrancyGuard, AccessControl, Pausable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    IERC20 public immutable usdcToken;
    address public treasury;
    uint256 public platformFeeBps = 250; // 2.5% in basis points
    uint256 public constant MAX_FEE_BPS = 750; // 7.5% max platform fee
    
    uint256 private nextContentId = 1;
    uint256 private nextPaymentId = 1;
    
    struct Content {
        uint256 contentId;
        address creator;
        uint256 priceUSDC;           // Price in USDC (6 decimals)
        uint256 accessDuration;       // Duration in seconds (0 = lifetime)
        uint256 maxDevices;           // Max concurrent devices
        bool isActive;
        uint256 totalRevenue;
        uint256 accessCount;
        string contentHash;           // IPFS hash or content identifier
        uint256 createdAt;
    }
    
    struct Payment {
        bytes32 paymentHash;          // SHA256 hash of preimage (x402 style)
        address payer;
        uint256 contentId;
        uint256 amount;
        uint256 timestamp;
        uint256 expiresAt;
        bool completed;
        bool refunded;
        bytes32[] deviceFingerprints; // Devices that accessed via this payment
    }
    
    struct DeviceAccess {
        bytes32 deviceFingerprint;    // keccak256(fingerprint data)
        address payer;
        uint256 contentId;
        uint256 grantedAt;
        uint256 expiresAt;
        uint256 accessCount;
        bool isRevoked;
    }
    
    // Mappings
    mapping(uint256 => Content) public contents;
    mapping(bytes32 => Payment) public payments;
    mapping(bytes32 => DeviceAccess) public deviceAccess; // keccak256(contentId, deviceFingerprint)
    mapping(address => uint256) public creatorBalances;
    mapping(uint256 => mapping(bytes32 => bool)) public contentDeviceUsed;
    mapping(address => uint256[]) public creatorContent;
    mapping(uint256 => uint256) public contentDeviceCount;
    mapping(bytes32 => bytes32) public paymentHashToId; // paymentHash => paymentId
    
    // Events
    event ContentRegistered(
        uint256 indexed contentId, 
        address indexed creator, 
        uint256 price, 
        string contentHash
    );
    
    event PaymentCreated(
        bytes32 indexed paymentHash, 
        address indexed payer, 
        uint256 indexed contentId, 
        uint256 amount,
        uint256 expiresAt
    );
    
    event PaymentCompleted(
        bytes32 indexed paymentHash, 
        bytes32 deviceFingerprint, 
        uint256 creatorAmount, 
        uint256 platformFee
    );
    
    event AccessGranted(
        uint256 indexed contentId, 
        bytes32 indexed deviceFingerprint, 
        address indexed payer,
        uint256 expiresAt
    );
    
    event DeviceRevoked(
        uint256 indexed contentId, 
        bytes32 indexed deviceFingerprint,
        address revokedBy
    );
    
    event CreatorWithdrawal(address indexed creator, uint256 amount);
    
    event ContentStatusChanged(uint256 indexed contentId, bool isActive);
    
    constructor(address _usdcToken, address _treasury) {
        require(_usdcToken != address(0), "Invalid USDC token address");
        require(_treasury != address(0), "Invalid treasury address");
        
        usdcToken = IERC20(_usdcToken);
        treasury = _treasury;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @notice Register new content for monetization
     */
    function registerContent(
        uint256 priceUSDC,
        uint256 accessDuration,
        uint256 maxDevices,
        string calldata contentHash
    ) external whenNotPaused returns (uint256 contentId) {
        require(priceUSDC > 0, "Price must be greater than 0");
        require(maxDevices > 0, "Max devices must be greater than 0");
        require(bytes(contentHash).length > 0, "Content hash required");
        
        contentId = nextContentId++;
        
        contents[contentId] = Content({
            contentId: contentId,
            creator: msg.sender,
            priceUSDC: priceUSDC,
            accessDuration: accessDuration,
            maxDevices: maxDevices,
            isActive: true,
            totalRevenue: 0,
            accessCount: 0,
            contentHash: contentHash,
            createdAt: block.timestamp
        });
        
        creatorContent[msg.sender].push(contentId);
        
        emit ContentRegistered(contentId, msg.sender, priceUSDC, contentHash);
    }
    
    /**
     * @notice Create a payment intent with hash commitment
     */
    function createPayment(
        bytes32 paymentHash,
        uint256 contentId,
        uint256 expiryMinutes
    ) external payable whenNotPaused returns (bytes32 paymentId) {
        require(contents[contentId].isActive, "Content not active");
        require(expiryMinutes > 0 && expiryMinutes <= 1440, "Invalid expiry"); // Max 24 hours
        
        Content storage content = contents[contentId];
        uint256 expiresAt = block.timestamp + (expiryMinutes * 60);
        
        paymentId = keccak256(abi.encodePacked(paymentHash, block.timestamp, nextPaymentId++));
        
        payments[paymentId] = Payment({
            paymentHash: paymentHash,
            payer: msg.sender,
            contentId: contentId,
            amount: content.priceUSDC,
            timestamp: block.timestamp,
            expiresAt: expiresAt,
            completed: false,
            refunded: false,
            deviceFingerprints: new bytes32[](0)
        });
        
        // Store mapping for efficient lookup
        paymentHashToId[paymentHash] = paymentId;
        
        // Transfer USDC from payer (held in escrow until completion)
        require(
            usdcToken.transferFrom(msg.sender, address(this), content.priceUSDC),
            "USDC transfer failed"
        );
        
        emit PaymentCreated(paymentHash, msg.sender, contentId, content.priceUSDC, expiresAt);
        
        return paymentId;
    }
    
    /**
     * @notice Complete payment by revealing preimage and registering device
     */
    function completePayment(
        bytes32 preimage,
        bytes32 deviceFingerprint
    ) external nonReentrant whenNotPaused returns (bool) {
        bytes32 paymentHash = sha256(abi.encodePacked(preimage));
        bytes32 paymentId = findPaymentByHash(paymentHash);
        
        require(paymentId != bytes32(0), "Payment not found");
        
        Payment storage payment = payments[paymentId];
        require(!payment.completed, "Payment already completed");
        require(!payment.refunded, "Payment already refunded");
        require(block.timestamp <= payment.expiresAt, "Payment expired");
        require(payment.payer == msg.sender, "Not payment creator");
        
        Content storage content = contents[payment.contentId];
        require(content.isActive, "Content not active");
        
        // Check device limits
        require(
            contentDeviceCount[payment.contentId] < content.maxDevices ||
            contentDeviceUsed[payment.contentId][deviceFingerprint],
            "Device limit exceeded"
        );
        
        // Mark payment as completed
        payment.completed = true;
        payment.deviceFingerprints.push(deviceFingerprint);
        
        // Grant device access
        bytes32 accessKey = keccak256(abi.encodePacked(payment.contentId, deviceFingerprint));
        uint256 accessExpiresAt = content.accessDuration == 0 
            ? type(uint256).max 
            : block.timestamp + content.accessDuration;
            
        deviceAccess[accessKey] = DeviceAccess({
            deviceFingerprint: deviceFingerprint,
            payer: msg.sender,
            contentId: payment.contentId,
            grantedAt: block.timestamp,
            expiresAt: accessExpiresAt,
            accessCount: 0,
            isRevoked: false
        });
        
        // Update device tracking
        if (!contentDeviceUsed[payment.contentId][deviceFingerprint]) {
            contentDeviceUsed[payment.contentId][deviceFingerprint] = true;
            contentDeviceCount[payment.contentId]++;
        }
        
        // Calculate fees and distribute payment
        uint256 platformFee = (payment.amount * platformFeeBps) / 10000;
        uint256 creatorAmount = payment.amount - platformFee;
        
        creatorBalances[content.creator] += creatorAmount;
        
        // Transfer platform fee to treasury
        require(usdcToken.transfer(treasury, platformFee), "Treasury transfer failed");
        
        // Update content stats
        content.totalRevenue += payment.amount;
        content.accessCount++;
        
        emit PaymentCompleted(paymentHash, deviceFingerprint, creatorAmount, platformFee);
        emit AccessGranted(payment.contentId, deviceFingerprint, msg.sender, accessExpiresAt);
        
        return true;
    }
    
    /**
     * @notice Verify if device has access to content
     */
    function verifyAccess(
        uint256 contentId,
        bytes32 deviceFingerprint,
        address user
    ) external view returns (bool hasAccess, uint256 expiresAt) {
        bytes32 accessKey = keccak256(abi.encodePacked(contentId, deviceFingerprint));
        DeviceAccess storage access = deviceAccess[accessKey];
        
        if (access.payer == address(0) || 
            access.isRevoked || 
            access.payer != user ||
            block.timestamp > access.expiresAt) {
            return (false, 0);
        }
        
        return (true, access.expiresAt);
    }
    
    /**
     * @notice Increment access count for analytics
     */
    function recordAccess(
        uint256 contentId,
        bytes32 deviceFingerprint
    ) external {
        bytes32 accessKey = keccak256(abi.encodePacked(contentId, deviceFingerprint));
        require(deviceAccess[accessKey].payer != address(0), "No access found");
        
        deviceAccess[accessKey].accessCount++;
    }
    
    /**
     * @notice Refund expired payment
     */
    function refundExpiredPayment(bytes32 paymentHash) external nonReentrant {
        bytes32 paymentId = findPaymentByHash(paymentHash);
        require(paymentId != bytes32(0), "Payment not found");
        
        Payment storage payment = payments[paymentId];
        require(!payment.completed, "Payment already completed");
        require(!payment.refunded, "Payment already refunded");
        require(block.timestamp > payment.expiresAt, "Payment not expired");
        
        payment.refunded = true;
        
        require(usdcToken.transfer(payment.payer, payment.amount), "Refund failed");
    }
    
    /**
     * @notice Creator withdraws earned balance
     */
    function withdrawCreatorBalance() external nonReentrant {
        uint256 balance = creatorBalances[msg.sender];
        require(balance > 0, "No balance to withdraw");
        
        creatorBalances[msg.sender] = 0;
        
        require(usdcToken.transfer(msg.sender, balance), "Withdrawal failed");
        
        emit CreatorWithdrawal(msg.sender, balance);
    }
    
    /**
     * @notice Update content price (creator only)
     */
    function updateContentPrice(uint256 contentId, uint256 newPrice) external {
        require(contents[contentId].creator == msg.sender, "Not content creator");
        require(newPrice > 0, "Price must be greater than 0");
        
        contents[contentId].priceUSDC = newPrice;
    }
    
    /**
     * @notice Revoke device access (creator or admin)
     */
    function revokeDeviceAccess(
        uint256 contentId, 
        bytes32 deviceFingerprint
    ) external {
        require(
            contents[contentId].creator == msg.sender || 
            hasRole(ADMIN_ROLE, msg.sender),
            "Unauthorized"
        );
        
        bytes32 accessKey = keccak256(abi.encodePacked(contentId, deviceFingerprint));
        require(deviceAccess[accessKey].payer != address(0), "Access not found");
        
        deviceAccess[accessKey].isRevoked = true;
        
        emit DeviceRevoked(contentId, deviceFingerprint, msg.sender);
    }
    
    // Admin functions
    
    /**
     * @notice Set platform fee (admin only)
     */
    function setPlatformFee(uint256 feeBps) external onlyRole(ADMIN_ROLE) {
        require(feeBps <= MAX_FEE_BPS, "Fee too high");
        platformFeeBps = feeBps;
    }
    
    /**
     * @notice Pause/unpause content (admin only)
     */
    function setContentStatus(uint256 contentId, bool isActive) external onlyRole(ADMIN_ROLE) {
        require(contents[contentId].creator != address(0), "Content not found");
        contents[contentId].isActive = isActive;
        
        emit ContentStatusChanged(contentId, isActive);
    }
    
    /**
     * @notice Emergency pause (admin only)
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @notice Unpause (admin only)
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @notice Update treasury address (admin only)
     */
    function updateTreasury(address newTreasury) external onlyRole(ADMIN_ROLE) {
        require(newTreasury != address(0), "Invalid treasury address");
        treasury = newTreasury;
    }
    
    // View functions
    
    /**
     * @notice Get creator's content IDs
     */
    function getCreatorContent(address creator) external view returns (uint256[] memory) {
        return creatorContent[creator];
    }
    
    /**
     * @notice Get content details
     */
    function getContent(uint256 contentId) external view returns (Content memory) {
        return contents[contentId];
    }
    
    /**
     * @notice Get payment details
     */
    function getPayment(bytes32 paymentId) external view returns (Payment memory) {
        return payments[paymentId];
    }
    
    /**
     * @notice Find payment by hash (internal helper)
     */
    function findPaymentByHash(bytes32 paymentHash) internal view returns (bytes32) {
        return paymentHashToId[paymentHash];
    }
}