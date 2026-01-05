// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PaywallSubscriptions
 * @notice Handles recurring subscription payments for content access
 */
contract PaywallSubscriptions is ReentrancyGuard, AccessControl, Pausable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    IERC20 public immutable usdcToken;
    address public treasury;
    uint256 public platformFeeBps = 250; // 2.5% in basis points
    
    uint256 private nextPlanId = 1;
    uint256 private nextSubscriptionId = 1;
    
    uint256 public constant GRACE_PERIOD = 3 days;
    uint256 public constant MONTH_DURATION = 30 days;
    uint256 public constant YEAR_DURATION = 365 days;
    
    struct SubscriptionPlan {
        uint256 planId;
        address creator;
        string name;
        string description;
        uint256 monthlyPriceUSDC;
        uint256 annualPriceUSDC;     // Typically discounted
        uint256 maxDevices;
        uint256[] includedContentIds;
        bool isActive;
        uint256 subscriberCount;
        uint256 createdAt;
    }
    
    struct Subscription {
        uint256 subscriptionId;
        address subscriber;
        uint256 planId;
        uint256 startedAt;
        uint256 currentPeriodStart;
        uint256 currentPeriodEnd;
        uint256 nextBillingDate;
        bool isAnnual;
        bool autoRenew;
        bool isCancelled;
        bytes32[] registeredDevices;
        uint256 totalPaid;
    }
    
    struct SubscriptionAccess {
        uint256 subscriptionId;
        bytes32 deviceFingerprint;
        uint256 grantedAt;
        uint256 accessCount;
        bool isActive;
    }
    
    // Mappings
    mapping(uint256 => SubscriptionPlan) public plans;
    mapping(uint256 => Subscription) public subscriptions;
    mapping(address => uint256[]) public userSubscriptions;
    mapping(address => uint256[]) public creatorPlans;
    mapping(bytes32 => SubscriptionAccess) public subscriptionAccess; // keccak256(subscriptionId, deviceFingerprint)
    mapping(address => uint256) public creatorBalances;
    mapping(uint256 => mapping(uint256 => bool)) public planContentIncluded;
    
    // Events
    event PlanCreated(
        uint256 indexed planId,
        address indexed creator,
        string name,
        uint256 monthlyPrice,
        uint256 annualPrice
    );
    
    event Subscribed(
        uint256 indexed subscriptionId,
        address indexed subscriber,
        uint256 indexed planId,
        bool isAnnual,
        uint256 amount
    );
    
    event SubscriptionRenewed(
        uint256 indexed subscriptionId,
        uint256 amount,
        uint256 newPeriodEnd
    );
    
    event SubscriptionCancelled(
        uint256 indexed subscriptionId,
        address indexed subscriber
    );
    
    event DeviceRegistered(
        uint256 indexed subscriptionId,
        bytes32 deviceFingerprint
    );
    
    event CreatorWithdrawal(address indexed creator, uint256 amount);
    
    constructor(address _usdcToken, address _treasury) {
        require(_usdcToken != address(0), "Invalid USDC token address");
        require(_treasury != address(0), "Invalid treasury address");
        
        usdcToken = IERC20(_usdcToken);
        treasury = _treasury;
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }
    
    /**
     * @notice Create a subscription plan
     */
    function createPlan(
        string calldata name,
        string calldata description,
        uint256 monthlyPrice,
        uint256 annualPrice,
        uint256 maxDevices,
        uint256[] calldata contentIds
    ) external whenNotPaused returns (uint256 planId) {
        require(bytes(name).length > 0, "Plan name required");
        require(monthlyPrice > 0, "Monthly price must be greater than 0");
        require(annualPrice > 0, "Annual price must be greater than 0");
        require(maxDevices > 0, "Max devices must be greater than 0");
        require(annualPrice < monthlyPrice * 12, "Annual price should be discounted");
        
        planId = nextPlanId++;
        
        plans[planId] = SubscriptionPlan({
            planId: planId,
            creator: msg.sender,
            name: name,
            description: description,
            monthlyPriceUSDC: monthlyPrice,
            annualPriceUSDC: annualPrice,
            maxDevices: maxDevices,
            includedContentIds: contentIds,
            isActive: true,
            subscriberCount: 0,
            createdAt: block.timestamp
        });
        
        // Track content inclusion
        for (uint256 i = 0; i < contentIds.length; i++) {
            planContentIncluded[planId][contentIds[i]] = true;
        }
        
        creatorPlans[msg.sender].push(planId);
        
        emit PlanCreated(planId, msg.sender, name, monthlyPrice, annualPrice);
    }
    
    /**
     * @notice Subscribe to a plan
     */
    function subscribe(
        uint256 planId,
        bool isAnnual,
        bytes32 initialDeviceFingerprint
    ) external nonReentrant whenNotPaused returns (uint256 subscriptionId) {
        require(plans[planId].isActive, "Plan not active");
        require(initialDeviceFingerprint != bytes32(0), "Device fingerprint required");
        
        SubscriptionPlan storage plan = plans[planId];
        uint256 price = isAnnual ? plan.annualPriceUSDC : plan.monthlyPriceUSDC;
        uint256 duration = isAnnual ? YEAR_DURATION : MONTH_DURATION;
        
        subscriptionId = nextSubscriptionId++;
        
        uint256 periodStart = block.timestamp;
        uint256 periodEnd = periodStart + duration;
        
        subscriptions[subscriptionId] = Subscription({
            subscriptionId: subscriptionId,
            subscriber: msg.sender,
            planId: planId,
            startedAt: periodStart,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            nextBillingDate: periodEnd,
            isAnnual: isAnnual,
            autoRenew: true,
            isCancelled: false,
            registeredDevices: new bytes32[](1),
            totalPaid: price
        });
        
        subscriptions[subscriptionId].registeredDevices[0] = initialDeviceFingerprint;
        
        // Grant device access
        bytes32 accessKey = keccak256(abi.encodePacked(subscriptionId, initialDeviceFingerprint));
        subscriptionAccess[accessKey] = SubscriptionAccess({
            subscriptionId: subscriptionId,
            deviceFingerprint: initialDeviceFingerprint,
            grantedAt: block.timestamp,
            accessCount: 0,
            isActive: true
        });
        
        userSubscriptions[msg.sender].push(subscriptionId);
        plan.subscriberCount++;
        
        // Process payment
        require(
            usdcToken.transferFrom(msg.sender, address(this), price),
            "USDC transfer failed"
        );
        
        // Calculate fees
        uint256 platformFee = (price * platformFeeBps) / 10000;
        uint256 creatorAmount = price - platformFee;
        
        creatorBalances[plan.creator] += creatorAmount;
        require(usdcToken.transfer(treasury, platformFee), "Treasury transfer failed");
        
        emit Subscribed(subscriptionId, msg.sender, planId, isAnnual, price);
        emit DeviceRegistered(subscriptionId, initialDeviceFingerprint);
    }
    
    /**
     * @notice Renew subscription (auto or manual)
     */
    function renewSubscription(uint256 subscriptionId) external nonReentrant whenNotPaused {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.subscriber == msg.sender || sub.autoRenew, "Unauthorized renewal");
        require(!sub.isCancelled, "Subscription cancelled");
        require(
            block.timestamp >= sub.nextBillingDate - GRACE_PERIOD,
            "Too early to renew"
        );
        
        SubscriptionPlan storage plan = plans[sub.planId];
        require(plan.isActive, "Plan no longer active");
        
        uint256 price = sub.isAnnual ? plan.annualPriceUSDC : plan.monthlyPriceUSDC;
        uint256 duration = sub.isAnnual ? YEAR_DURATION : MONTH_DURATION;
        
        // Process payment
        require(
            usdcToken.transferFrom(sub.subscriber, address(this), price),
            "USDC transfer failed"
        );
        
        // Update subscription period
        sub.currentPeriodStart = sub.currentPeriodEnd;
        sub.currentPeriodEnd = sub.currentPeriodStart + duration;
        sub.nextBillingDate = sub.currentPeriodEnd;
        sub.totalPaid += price;
        
        // Calculate fees
        uint256 platformFee = (price * platformFeeBps) / 10000;
        uint256 creatorAmount = price - platformFee;
        
        creatorBalances[plan.creator] += creatorAmount;
        require(usdcToken.transfer(treasury, platformFee), "Treasury transfer failed");
        
        emit SubscriptionRenewed(subscriptionId, price, sub.currentPeriodEnd);
    }
    
    /**
     * @notice Cancel subscription
     */
    function cancelSubscription(uint256 subscriptionId) external {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.subscriber == msg.sender, "Not subscription owner");
        require(!sub.isCancelled, "Already cancelled");
        
        sub.isCancelled = true;
        sub.autoRenew = false;
        
        // Deactivate all device access for this subscription
        for (uint256 i = 0; i < sub.registeredDevices.length; i++) {
            bytes32 accessKey = keccak256(abi.encodePacked(subscriptionId, sub.registeredDevices[i]));
            subscriptionAccess[accessKey].isActive = false;
        }
        
        plans[sub.planId].subscriberCount--;
        
        emit SubscriptionCancelled(subscriptionId, msg.sender);
    }
    
    /**
     * @notice Register additional device for subscription
     */
    function registerDevice(
        uint256 subscriptionId,
        bytes32 deviceFingerprint
    ) external whenNotPaused {
        Subscription storage sub = subscriptions[subscriptionId];
        require(sub.subscriber == msg.sender, "Not subscription owner");
        require(!sub.isCancelled, "Subscription cancelled");
        require(block.timestamp <= sub.currentPeriodEnd, "Subscription expired");
        
        SubscriptionPlan storage plan = plans[sub.planId];
        require(sub.registeredDevices.length < plan.maxDevices, "Device limit reached");
        
        // Check if device already registered
        for (uint256 i = 0; i < sub.registeredDevices.length; i++) {
            require(sub.registeredDevices[i] != deviceFingerprint, "Device already registered");
        }
        
        sub.registeredDevices.push(deviceFingerprint);
        
        // Grant device access
        bytes32 accessKey = keccak256(abi.encodePacked(subscriptionId, deviceFingerprint));
        subscriptionAccess[accessKey] = SubscriptionAccess({
            subscriptionId: subscriptionId,
            deviceFingerprint: deviceFingerprint,
            grantedAt: block.timestamp,
            accessCount: 0,
            isActive: true
        });
        
        emit DeviceRegistered(subscriptionId, deviceFingerprint);
    }
    
    /**
     * @notice Check if subscription grants access to specific content
     */
    function checkSubscriptionAccess(
        address subscriber,
        uint256 contentId,
        bytes32 deviceFingerprint
    ) external view returns (bool hasAccess, uint256 subscriptionId) {
        uint256[] memory userSubs = userSubscriptions[subscriber];
        
        for (uint256 i = 0; i < userSubs.length; i++) {
            uint256 subId = userSubs[i];
            Subscription storage sub = subscriptions[subId];
            
            if (sub.isCancelled || block.timestamp > sub.currentPeriodEnd) {
                continue;
            }
            
            // Check if content is included in plan
            if (!planContentIncluded[sub.planId][contentId]) {
                continue;
            }
            
            // Check device access
            bytes32 accessKey = keccak256(abi.encodePacked(subId, deviceFingerprint));
            SubscriptionAccess storage access = subscriptionAccess[accessKey];
            
            if (access.isActive) {
                return (true, subId);
            }
        }
        
        return (false, 0);
    }
    
    /**
     * @notice Record content access for analytics
     */
    function recordSubscriptionAccess(
        uint256 subscriptionId,
        bytes32 deviceFingerprint
    ) external {
        bytes32 accessKey = keccak256(abi.encodePacked(subscriptionId, deviceFingerprint));
        require(subscriptionAccess[accessKey].isActive, "No active access");
        
        subscriptionAccess[accessKey].accessCount++;
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
     * @notice Update plan status (creator only)
     */
    function updatePlanStatus(uint256 planId, bool isActive) external {
        require(plans[planId].creator == msg.sender, "Not plan creator");
        plans[planId].isActive = isActive;
    }
    
    /**
     * @notice Add content to existing plan (creator only)
     */
    function addContentToPlan(uint256 planId, uint256 contentId) external {
        require(plans[planId].creator == msg.sender, "Not plan creator");
        require(!planContentIncluded[planId][contentId], "Content already included");
        
        plans[planId].includedContentIds.push(contentId);
        planContentIncluded[planId][contentId] = true;
    }
    
    /**
     * @notice Remove content from plan (creator only)
     */
    function removeContentFromPlan(uint256 planId, uint256 contentId) external {
        require(plans[planId].creator == msg.sender, "Not plan creator");
        require(planContentIncluded[planId][contentId], "Content not included");
        
        planContentIncluded[planId][contentId] = false;
        
        // Remove from array (simplified - in production use more efficient method)
        uint256[] storage contentIds = plans[planId].includedContentIds;
        for (uint256 i = 0; i < contentIds.length; i++) {
            if (contentIds[i] == contentId) {
                contentIds[i] = contentIds[contentIds.length - 1];
                contentIds.pop();
                break;
            }
        }
    }
    
    // Admin functions
    
    /**
     * @notice Set platform fee (admin only)
     */
    function setPlatformFee(uint256 feeBps) external onlyRole(ADMIN_ROLE) {
        require(feeBps <= 750, "Fee too high"); // Max 7.5%
        platformFeeBps = feeBps;
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
    
    // View functions
    
    /**
     * @notice Get plan details
     */
    function getPlan(uint256 planId) external view returns (SubscriptionPlan memory) {
        return plans[planId];
    }
    
    /**
     * @notice Get subscription details
     */
    function getSubscription(uint256 subscriptionId) external view returns (Subscription memory) {
        return subscriptions[subscriptionId];
    }
    
    /**
     * @notice Get user's subscriptions
     */
    function getUserSubscriptions(address user) external view returns (uint256[] memory) {
        return userSubscriptions[user];
    }
    
    /**
     * @notice Get creator's plans
     */
    function getCreatorPlans(address creator) external view returns (uint256[] memory) {
        return creatorPlans[creator];
    }
    
    /**
     * @notice Check if subscription is active
     */
    function isSubscriptionActive(uint256 subscriptionId) external view returns (bool) {
        Subscription storage sub = subscriptions[subscriptionId];
        return !sub.isCancelled && block.timestamp <= sub.currentPeriodEnd;
    }
}