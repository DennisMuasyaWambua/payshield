// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title DeviceAccessManager
 * @notice Manages device fingerprint verification and access control
 */
contract DeviceAccessManager is AccessControl, Pausable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    
    uint256 public constant MAX_SUSPICION_SCORE = 100;
    uint256 public constant BLACKLIST_THRESHOLD = 80;
    uint256 public constant MAX_DEVICES_PER_USER = 10;
    uint256 public constant FINGERPRINT_CHANGE_COOLDOWN = 1 hours;
    
    struct DeviceRecord {
        bytes32 fingerprintHash;
        address owner;
        uint256 firstSeenAt;
        uint256 lastAccessAt;
        uint256 totalAccessCount;
        uint256 suspicionScore;       // 0-100, updated by backend oracle
        bool isBlacklisted;
        bool isActive;
        string encryptedMetadata;     // Encrypted device metadata
        uint256 lastFingerprintChange;
    }
    
    struct DeviceActivity {
        bytes32 fingerprintHash;
        uint256 timestamp;
        uint256 contentId;
        address user;
        string action;                // "access", "payment", "registration"
        uint256 blockNumber;
    }
    
    struct SuspicionEvent {
        bytes32 fingerprintHash;
        uint256 timestamp;
        string reason;
        uint256 scoreIncrease;
        address reportedBy;
    }
    
    struct DeviceAnalytics {
        uint256 dailyAccesses;
        uint256 weeklyAccesses;
        uint256 monthlyAccesses;
        uint256 lastResetTimestamp;
        mapping(uint256 => uint256) contentAccesses; // contentId => access count
        uint256 uniqueContentAccessed;
        uint256 avgSessionDuration;
        string geolocationHash;       // Hash of approximate location
    }
    
    // State variables
    uint256 public totalDevices;
    uint256 public blacklistedDevices;
    uint256 public activeDevices;
    
    // Mappings
    mapping(bytes32 => DeviceRecord) public deviceRecords;
    mapping(address => bytes32[]) public userDevices;
    mapping(bytes32 => DeviceAnalytics) private deviceAnalytics;
    mapping(bytes32 => bool) public globalBlacklist;
    mapping(address => mapping(bytes32 => bool)) public userDeviceMapping;
    
    // Activity tracking
    mapping(uint256 => DeviceActivity) public deviceActivities;
    mapping(bytes32 => uint256[]) public deviceActivityHistory;
    mapping(bytes32 => SuspicionEvent[]) public suspicionHistory;
    uint256 private nextActivityId = 1;
    
    // Rate limiting
    mapping(bytes32 => mapping(uint256 => uint256)) public deviceDailyAccess; // fingerprint => day => count
    mapping(bytes32 => uint256) public deviceLastAccess;
    uint256 public constant DAILY_ACCESS_LIMIT = 1000;
    uint256 public constant ACCESS_RATE_LIMIT = 10; // per minute
    
    // Events
    event DeviceRegistered(
        bytes32 indexed fingerprintHash,
        address indexed owner,
        uint256 timestamp
    );
    
    event DeviceAccessRecorded(
        bytes32 indexed fingerprintHash,
        address indexed user,
        uint256 indexed contentId,
        uint256 timestamp
    );
    
    event DeviceBlacklisted(
        bytes32 indexed fingerprintHash,
        string reason,
        address blacklistedBy
    );
    
    event DeviceWhitelisted(
        bytes32 indexed fingerprintHash,
        address whitelistedBy
    );
    
    event SuspicionScoreUpdated(
        bytes32 indexed fingerprintHash,
        uint256 oldScore,
        uint256 newScore,
        string reason
    );
    
    event SuspiciousActivityDetected(
        bytes32 indexed fingerprintHash,
        address user,
        string activity,
        uint256 suspicionIncrease
    );
    
    event DeviceRemoved(
        bytes32 indexed fingerprintHash,
        address indexed owner
    );
    
    event FingerprintChanged(
        bytes32 indexed oldFingerprint,
        bytes32 indexed newFingerprint,
        address indexed user
    );
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }
    
    /**
     * @notice Register a new device fingerprint
     */
    function registerDevice(
        bytes32 fingerprintHash,
        string calldata encryptedMetadata
    ) external whenNotPaused returns (bool) {
        require(fingerprintHash != bytes32(0), "Invalid fingerprint hash");
        require(userDevices[msg.sender].length < MAX_DEVICES_PER_USER, "Max devices exceeded");
        require(!globalBlacklist[fingerprintHash], "Device globally blacklisted");
        
        // Check if device already exists
        if (deviceRecords[fingerprintHash].firstSeenAt != 0) {
            require(deviceRecords[fingerprintHash].owner == msg.sender, "Device owned by another user");
            require(!deviceRecords[fingerprintHash].isBlacklisted, "Device blacklisted");
            
            // Reactivate existing device
            deviceRecords[fingerprintHash].isActive = true;
            deviceRecords[fingerprintHash].lastAccessAt = block.timestamp;
            
            return true;
        }
        
        // Register new device
        deviceRecords[fingerprintHash] = DeviceRecord({
            fingerprintHash: fingerprintHash,
            owner: msg.sender,
            firstSeenAt: block.timestamp,
            lastAccessAt: block.timestamp,
            totalAccessCount: 0,
            suspicionScore: 0,
            isBlacklisted: false,
            isActive: true,
            encryptedMetadata: encryptedMetadata,
            lastFingerprintChange: block.timestamp
        });
        
        userDevices[msg.sender].push(fingerprintHash);
        userDeviceMapping[msg.sender][fingerprintHash] = true;
        
        totalDevices++;
        activeDevices++;
        
        _recordActivity(
            fingerprintHash,
            0, // No specific content for registration
            "registration"
        );
        
        emit DeviceRegistered(fingerprintHash, msg.sender, block.timestamp);
        
        return true;
    }
    
    /**
     * @notice Verify device fingerprint and check access permissions
     */
    function verifyDevice(
        bytes32 fingerprintHash,
        address claimedOwner
    ) external view returns (bool isValid, uint256 suspicionScore) {
        DeviceRecord storage device = deviceRecords[fingerprintHash];
        
        if (device.firstSeenAt == 0) {
            return (false, 0); // Device not registered
        }
        
        if (device.isBlacklisted || globalBlacklist[fingerprintHash]) {
            return (false, 100); // Device blacklisted
        }
        
        if (device.owner != claimedOwner) {
            return (false, 90); // Wrong owner
        }
        
        if (!device.isActive) {
            return (false, 50); // Device inactive
        }
        
        return (true, device.suspicionScore);
    }
    
    /**
     * @notice Record device access to content
     */
    function recordAccess(
        bytes32 fingerprintHash,
        uint256 contentId,
        address user
    ) external whenNotPaused {
        require(userDeviceMapping[user][fingerprintHash], "Device not owned by user");
        
        DeviceRecord storage device = deviceRecords[fingerprintHash];
        require(device.isActive && !device.isBlacklisted, "Device not accessible");
        
        // Rate limiting checks
        _checkRateLimit(fingerprintHash);
        
        // Update device record
        device.lastAccessAt = block.timestamp;
        device.totalAccessCount++;
        
        // Update analytics
        _updateDeviceAnalytics(fingerprintHash, contentId);
        
        // Record activity
        _recordActivity(fingerprintHash, contentId, "access");
        
        emit DeviceAccessRecorded(fingerprintHash, user, contentId, block.timestamp);
    }
    
    /**
     * @notice Update suspicion score (oracle only)
     */
    function updateSuspicionScore(
        bytes32 fingerprintHash,
        uint256 newScore,
        string calldata reason
    ) external onlyRole(ORACLE_ROLE) {
        require(newScore <= MAX_SUSPICION_SCORE, "Score exceeds maximum");
        require(deviceRecords[fingerprintHash].firstSeenAt != 0, "Device not found");
        
        DeviceRecord storage device = deviceRecords[fingerprintHash];
        uint256 oldScore = device.suspicionScore;
        device.suspicionScore = newScore;
        
        // Record suspicion event
        suspicionHistory[fingerprintHash].push(SuspicionEvent({
            fingerprintHash: fingerprintHash,
            timestamp: block.timestamp,
            reason: reason,
            scoreIncrease: newScore > oldScore ? newScore - oldScore : 0,
            reportedBy: msg.sender
        }));
        
        // Auto-blacklist if score exceeds threshold
        if (newScore >= BLACKLIST_THRESHOLD && !device.isBlacklisted) {
            device.isBlacklisted = true;
            blacklistedDevices++;
            activeDevices--;
            
            emit DeviceBlacklisted(fingerprintHash, reason, msg.sender);
        }
        
        emit SuspicionScoreUpdated(fingerprintHash, oldScore, newScore, reason);
    }
    
    /**
     * @notice Blacklist device (admin only)
     */
    function blacklistDevice(
        bytes32 fingerprintHash,
        string calldata reason
    ) external onlyRole(ADMIN_ROLE) {
        require(deviceRecords[fingerprintHash].firstSeenAt != 0, "Device not found");
        
        DeviceRecord storage device = deviceRecords[fingerprintHash];
        require(!device.isBlacklisted, "Device already blacklisted");
        
        device.isBlacklisted = true;
        device.isActive = false;
        globalBlacklist[fingerprintHash] = true;
        
        blacklistedDevices++;
        if (device.isActive) {
            activeDevices--;
        }
        
        emit DeviceBlacklisted(fingerprintHash, reason, msg.sender);
    }
    
    /**
     * @notice Whitelist device (admin only)
     */
    function whitelistDevice(bytes32 fingerprintHash) external onlyRole(ADMIN_ROLE) {
        require(deviceRecords[fingerprintHash].firstSeenAt != 0, "Device not found");
        
        DeviceRecord storage device = deviceRecords[fingerprintHash];
        require(device.isBlacklisted, "Device not blacklisted");
        
        device.isBlacklisted = false;
        device.isActive = true;
        device.suspicionScore = 0;
        globalBlacklist[fingerprintHash] = false;
        
        blacklistedDevices--;
        activeDevices++;
        
        emit DeviceWhitelisted(fingerprintHash, msg.sender);
    }
    
    /**
     * @notice Remove device from user account
     */
    function removeDevice(bytes32 fingerprintHash) external {
        require(userDeviceMapping[msg.sender][fingerprintHash], "Device not owned");
        
        DeviceRecord storage device = deviceRecords[fingerprintHash];
        device.isActive = false;
        userDeviceMapping[msg.sender][fingerprintHash] = false;
        
        // Remove from user's device list
        bytes32[] storage devices = userDevices[msg.sender];
        for (uint256 i = 0; i < devices.length; i++) {
            if (devices[i] == fingerprintHash) {
                devices[i] = devices[devices.length - 1];
                devices.pop();
                break;
            }
        }
        
        activeDevices--;
        
        emit DeviceRemoved(fingerprintHash, msg.sender);
    }
    
    /**
     * @notice Update device fingerprint (for legitimate hardware changes)
     */
    function updateFingerprint(
        bytes32 oldFingerprintHash,
        bytes32 newFingerprintHash,
        string calldata encryptedMetadata
    ) external whenNotPaused {
        require(userDeviceMapping[msg.sender][oldFingerprintHash], "Old device not owned");
        require(newFingerprintHash != bytes32(0), "Invalid new fingerprint");
        require(deviceRecords[newFingerprintHash].firstSeenAt == 0, "New fingerprint already exists");
        
        DeviceRecord storage oldDevice = deviceRecords[oldFingerprintHash];
        require(
            block.timestamp >= oldDevice.lastFingerprintChange + FINGERPRINT_CHANGE_COOLDOWN,
            "Fingerprint change too frequent"
        );
        
        // Copy old device data to new fingerprint
        deviceRecords[newFingerprintHash] = DeviceRecord({
            fingerprintHash: newFingerprintHash,
            owner: msg.sender,
            firstSeenAt: oldDevice.firstSeenAt,
            lastAccessAt: block.timestamp,
            totalAccessCount: oldDevice.totalAccessCount,
            suspicionScore: oldDevice.suspicionScore + 10, // Slight suspicion increase
            isBlacklisted: false,
            isActive: true,
            encryptedMetadata: encryptedMetadata,
            lastFingerprintChange: block.timestamp
        });
        
        // Update user mapping
        userDeviceMapping[msg.sender][oldFingerprintHash] = false;
        userDeviceMapping[msg.sender][newFingerprintHash] = true;
        
        // Update user device list
        bytes32[] storage devices = userDevices[msg.sender];
        for (uint256 i = 0; i < devices.length; i++) {
            if (devices[i] == oldFingerprintHash) {
                devices[i] = newFingerprintHash;
                break;
            }
        }
        
        // Deactivate old device
        oldDevice.isActive = false;
        
        emit FingerprintChanged(oldFingerprintHash, newFingerprintHash, msg.sender);
    }
    
    /**
     * @notice Report suspicious activity
     */
    function reportSuspiciousActivity(
        bytes32 fingerprintHash,
        string calldata activity,
        uint256 suspicionIncrease
    ) external onlyRole(ORACLE_ROLE) {
        require(deviceRecords[fingerprintHash].firstSeenAt != 0, "Device not found");
        require(suspicionIncrease <= 50, "Suspicion increase too high");
        
        DeviceRecord storage device = deviceRecords[fingerprintHash];
        uint256 oldScore = device.suspicionScore;
        uint256 newScore = oldScore + suspicionIncrease;
        
        if (newScore > MAX_SUSPICION_SCORE) {
            newScore = MAX_SUSPICION_SCORE;
        }
        
        device.suspicionScore = newScore;
        
        // Record suspicion event
        suspicionHistory[fingerprintHash].push(SuspicionEvent({
            fingerprintHash: fingerprintHash,
            timestamp: block.timestamp,
            reason: activity,
            scoreIncrease: suspicionIncrease,
            reportedBy: msg.sender
        }));
        
        emit SuspiciousActivityDetected(fingerprintHash, device.owner, activity, suspicionIncrease);
        
        // Auto-blacklist if threshold reached
        if (newScore >= BLACKLIST_THRESHOLD && !device.isBlacklisted) {
            device.isBlacklisted = true;
            blacklistedDevices++;
            activeDevices--;
            
            emit DeviceBlacklisted(fingerprintHash, activity, msg.sender);
        }
    }
    
    // View functions
    
    /**
     * @notice Get user's registered devices
     */
    function getUserDevices(address user) external view returns (DeviceRecord[] memory) {
        bytes32[] memory deviceHashes = userDevices[user];
        DeviceRecord[] memory devices = new DeviceRecord[](deviceHashes.length);
        
        for (uint256 i = 0; i < deviceHashes.length; i++) {
            devices[i] = deviceRecords[deviceHashes[i]];
        }
        
        return devices;
    }
    
    /**
     * @notice Get device analytics (admin only)
     */
    function getDeviceAnalytics(bytes32 fingerprintHash) 
        external 
        view 
        onlyRole(ADMIN_ROLE) 
        returns (
            uint256 dailyAccesses,
            uint256 weeklyAccesses,
            uint256 monthlyAccesses,
            uint256 uniqueContent
        ) 
    {
        DeviceAnalytics storage analytics = deviceAnalytics[fingerprintHash];
        return (
            analytics.dailyAccesses,
            analytics.weeklyAccesses,
            analytics.monthlyAccesses,
            analytics.uniqueContentAccessed
        );
    }
    
    /**
     * @notice Get device activity history
     */
    function getDeviceActivityHistory(bytes32 fingerprintHash) 
        external 
        view 
        returns (uint256[] memory) 
    {
        return deviceActivityHistory[fingerprintHash];
    }
    
    /**
     * @notice Get suspicion history for device
     */
    function getSuspicionHistory(bytes32 fingerprintHash) 
        external 
        view 
        returns (SuspicionEvent[] memory) 
    {
        return suspicionHistory[fingerprintHash];
    }
    
    /**
     * @notice Get platform device statistics
     */
    function getDeviceStats() external view returns (
        uint256 _totalDevices,
        uint256 _activeDevices,
        uint256 _blacklistedDevices
    ) {
        return (totalDevices, activeDevices, blacklistedDevices);
    }
    
    // Internal functions
    
    /**
     * @notice Record device activity
     */
    function _recordActivity(
        bytes32 fingerprintHash,
        uint256 contentId,
        string memory action
    ) internal {
        uint256 activityId = nextActivityId++;
        
        deviceActivities[activityId] = DeviceActivity({
            fingerprintHash: fingerprintHash,
            timestamp: block.timestamp,
            contentId: contentId,
            user: msg.sender,
            action: action,
            blockNumber: block.number
        });
        
        deviceActivityHistory[fingerprintHash].push(activityId);
    }
    
    /**
     * @notice Check rate limiting for device
     */
    function _checkRateLimit(bytes32 fingerprintHash) internal {
        uint256 today = block.timestamp / 1 days;
        uint256 currentMinute = block.timestamp / 1 minutes;
        
        // Check daily limit
        require(
            deviceDailyAccess[fingerprintHash][today] < DAILY_ACCESS_LIMIT,
            "Daily access limit exceeded"
        );
        
        // Check rate limit (simplified)
        require(
            block.timestamp >= deviceLastAccess[fingerprintHash] + (60 / ACCESS_RATE_LIMIT),
            "Access rate limit exceeded"
        );
        
        deviceDailyAccess[fingerprintHash][today]++;
        deviceLastAccess[fingerprintHash] = block.timestamp;
    }
    
    /**
     * @notice Update device analytics
     */
    function _updateDeviceAnalytics(bytes32 fingerprintHash, uint256 contentId) internal {
        DeviceAnalytics storage analytics = deviceAnalytics[fingerprintHash];
        
        uint256 today = block.timestamp / 1 days;
        uint256 week = block.timestamp / 1 weeks;
        uint256 month = block.timestamp / 30 days;
        
        // Reset counters if period changed
        if (analytics.lastResetTimestamp < today * 1 days) {
            analytics.dailyAccesses = 0;
        }
        if (analytics.lastResetTimestamp < week * 1 weeks) {
            analytics.weeklyAccesses = 0;
        }
        if (analytics.lastResetTimestamp < month * 30 days) {
            analytics.monthlyAccesses = 0;
        }
        
        analytics.dailyAccesses++;
        analytics.weeklyAccesses++;
        analytics.monthlyAccesses++;
        analytics.lastResetTimestamp = block.timestamp;
        
        // Track unique content
        if (contentId > 0 && analytics.contentAccesses[contentId] == 0) {
            analytics.uniqueContentAccessed++;
        }
        analytics.contentAccesses[contentId]++;
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
}