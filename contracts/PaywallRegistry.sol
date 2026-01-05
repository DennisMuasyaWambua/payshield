// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title PaywallRegistry
 * @notice Central registry for creators, content, and platform configuration
 */
contract PaywallRegistry is AccessControl, Pausable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    
    enum ContentType { VIDEO, DOCUMENT, LIVESTREAM, API, SOFTWARE, OTHER }
    
    struct Creator {
        address wallet;
        bool isVerified;
        bool isActive;
        uint256 totalRevenue;
        uint256 totalContent;
        uint256 totalSubscribers;
        uint256 registeredAt;
        string profileHash;          // IPFS hash of profile metadata
        string name;
        string email;
        uint256 customFeeBps;        // Custom fee rate (0 = use default)
    }
    
    struct ContentMetadata {
        uint256 contentId;
        address creator;
        ContentType contentType;
        string title;
        string description;
        string thumbnailHash;        // IPFS hash of thumbnail
        string[] tags;
        uint256 createdAt;
        uint256 lastModified;
        bool isFeatured;
        uint256 rating;              // Average rating (1-5 stars * 100)
        uint256 ratingCount;
    }
    
    struct PlatformConfig {
        uint256 defaultFeeBps;       // Default platform fee
        uint256 maxFeeBps;           // Maximum allowed fee
        address treasury;
        address feeRecipient;
        bool paymentsEnabled;
        bool subscriptionsEnabled;
        uint256 minContentPrice;     // Minimum content price in USDC
        uint256 maxContentPrice;     // Maximum content price in USDC
    }
    
    struct CategoryConfig {
        ContentType category;
        uint256 feeBps;              // Category-specific fee
        bool isActive;
        string name;
        uint256 minPrice;
        uint256 maxPrice;
    }
    
    // State variables
    PlatformConfig public platformConfig;
    
    // Mappings
    mapping(address => Creator) public creators;
    mapping(uint256 => ContentMetadata) public contentMetadata;
    mapping(ContentType => CategoryConfig) public categoryConfigs;
    mapping(address => bool) public bannedCreators;
    mapping(uint256 => bool) public featuredContent;
    mapping(address => uint256[]) public creatorContentIds;
    mapping(bytes32 => bool) public usedProfileHashes; // Prevent duplicate profiles
    
    // Statistics
    uint256 public totalCreators;
    uint256 public totalVerifiedCreators;
    uint256 public totalContent;
    uint256 public totalRevenue;
    
    // Events
    event CreatorRegistered(
        address indexed creator, 
        string name, 
        string profileHash, 
        uint256 timestamp
    );
    
    event CreatorVerified(address indexed creator, address verifiedBy);
    
    event CreatorStatusChanged(address indexed creator, bool isActive);
    
    event ContentRegistered(
        uint256 indexed contentId,
        address indexed creator,
        ContentType contentType,
        string title
    );
    
    event ContentMetadataUpdated(
        uint256 indexed contentId,
        string title,
        string description
    );
    
    event ContentFeatured(uint256 indexed contentId, bool featured);
    
    event ContentRated(
        uint256 indexed contentId,
        address rater,
        uint256 rating,
        uint256 newAverage
    );
    
    event PlatformConfigUpdated(
        uint256 defaultFeeBps,
        address treasury,
        bool paymentsEnabled
    );
    
    event CategoryConfigUpdated(
        ContentType indexed category,
        uint256 feeBps,
        bool isActive
    );
    
    constructor(address _treasury) {
        require(_treasury != address(0), "Invalid treasury address");
        
        platformConfig = PlatformConfig({
            defaultFeeBps: 250,          // 2.5%
            maxFeeBps: 750,              // 7.5%
            treasury: _treasury,
            feeRecipient: _treasury,
            paymentsEnabled: true,
            subscriptionsEnabled: true,
            minContentPrice: 1e6,        // 1 USDC
            maxContentPrice: 10000e6     // 10,000 USDC
        });
        
        // Initialize default category configurations
        _initializeCategories();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
    }
    
    /**
     * @notice Register as a content creator
     */
    function registerCreator(
        string calldata name,
        string calldata email,
        string calldata profileHash
    ) external whenNotPaused {
        require(creators[msg.sender].registeredAt == 0, "Creator already registered");
        require(bytes(name).length > 0, "Name required");
        require(bytes(profileHash).length > 0, "Profile hash required");
        require(!usedProfileHashes[keccak256(bytes(profileHash))], "Profile hash already used");
        
        creators[msg.sender] = Creator({
            wallet: msg.sender,
            isVerified: false,
            isActive: true,
            totalRevenue: 0,
            totalContent: 0,
            totalSubscribers: 0,
            registeredAt: block.timestamp,
            profileHash: profileHash,
            name: name,
            email: email,
            customFeeBps: 0
        });
        
        usedProfileHashes[keccak256(bytes(profileHash))] = true;
        totalCreators++;
        
        emit CreatorRegistered(msg.sender, name, profileHash, block.timestamp);
    }
    
    /**
     * @notice Verify a creator (verifier only)
     */
    function verifyCreator(address creator) external onlyRole(VERIFIER_ROLE) {
        require(creators[creator].registeredAt > 0, "Creator not registered");
        require(!creators[creator].isVerified, "Creator already verified");
        
        creators[creator].isVerified = true;
        totalVerifiedCreators++;
        
        emit CreatorVerified(creator, msg.sender);
    }
    
    /**
     * @notice Update creator profile
     */
    function updateCreatorProfile(
        string calldata name,
        string calldata email,
        string calldata newProfileHash
    ) external {
        require(creators[msg.sender].registeredAt > 0, "Creator not registered");
        
        Creator storage creator = creators[msg.sender];
        
        if (bytes(newProfileHash).length > 0 && 
            keccak256(bytes(newProfileHash)) != keccak256(bytes(creator.profileHash))) {
            require(!usedProfileHashes[keccak256(bytes(newProfileHash))], "Profile hash already used");
            
            // Remove old hash and add new one
            usedProfileHashes[keccak256(bytes(creator.profileHash))] = false;
            usedProfileHashes[keccak256(bytes(newProfileHash))] = true;
            
            creator.profileHash = newProfileHash;
        }
        
        if (bytes(name).length > 0) {
            creator.name = name;
        }
        
        if (bytes(email).length > 0) {
            creator.email = email;
        }
    }
    
    /**
     * @notice Register content metadata
     */
    function registerContentMetadata(
        uint256 contentId,
        address creator,
        ContentType contentType,
        string calldata title,
        string calldata description,
        string calldata thumbnailHash,
        string[] calldata tags
    ) external onlyRole(ADMIN_ROLE) {
        require(creators[creator].registeredAt > 0, "Creator not registered");
        require(contentMetadata[contentId].contentId == 0, "Content already registered");
        require(bytes(title).length > 0, "Title required");
        
        contentMetadata[contentId] = ContentMetadata({
            contentId: contentId,
            creator: creator,
            contentType: contentType,
            title: title,
            description: description,
            thumbnailHash: thumbnailHash,
            tags: tags,
            createdAt: block.timestamp,
            lastModified: block.timestamp,
            isFeatured: false,
            rating: 0,
            ratingCount: 0
        });
        
        creatorContentIds[creator].push(contentId);
        creators[creator].totalContent++;
        totalContent++;
        
        emit ContentRegistered(contentId, creator, contentType, title);
    }
    
    /**
     * @notice Update content metadata
     */
    function updateContentMetadata(
        uint256 contentId,
        string calldata title,
        string calldata description,
        string calldata thumbnailHash,
        string[] calldata tags
    ) external {
        ContentMetadata storage content = contentMetadata[contentId];
        require(content.contentId != 0, "Content not found");
        require(
            content.creator == msg.sender || hasRole(ADMIN_ROLE, msg.sender),
            "Unauthorized"
        );
        
        if (bytes(title).length > 0) {
            content.title = title;
        }
        
        if (bytes(description).length > 0) {
            content.description = description;
        }
        
        if (bytes(thumbnailHash).length > 0) {
            content.thumbnailHash = thumbnailHash;
        }
        
        if (tags.length > 0) {
            content.tags = tags;
        }
        
        content.lastModified = block.timestamp;
        
        emit ContentMetadataUpdated(contentId, title, description);
    }
    
    /**
     * @notice Rate content (1-5 stars)
     */
    function rateContent(uint256 contentId, uint256 rating) external {
        require(contentMetadata[contentId].contentId != 0, "Content not found");
        require(rating >= 100 && rating <= 500, "Rating must be 1-5 stars (100-500)");
        
        ContentMetadata storage content = contentMetadata[contentId];
        
        // Calculate new average rating
        uint256 totalRating = content.rating * content.ratingCount + rating;
        content.ratingCount++;
        content.rating = totalRating / content.ratingCount;
        
        emit ContentRated(contentId, msg.sender, rating, content.rating);
    }
    
    /**
     * @notice Feature/unfeature content (admin only)
     */
    function setContentFeatured(uint256 contentId, bool featured) external onlyRole(ADMIN_ROLE) {
        require(contentMetadata[contentId].contentId != 0, "Content not found");
        
        contentMetadata[contentId].isFeatured = featured;
        featuredContent[contentId] = featured;
        
        emit ContentFeatured(contentId, featured);
    }
    
    /**
     * @notice Update creator statistics (called by main contracts)
     */
    function updateCreatorStats(
        address creator,
        uint256 revenueIncrease,
        uint256 subscriberChange,
        bool isSubscriberIncrease
    ) external onlyRole(ADMIN_ROLE) {
        require(creators[creator].registeredAt > 0, "Creator not registered");
        
        Creator storage creatorData = creators[creator];
        creatorData.totalRevenue += revenueIncrease;
        
        if (isSubscriberIncrease) {
            creatorData.totalSubscribers += subscriberChange;
        } else {
            creatorData.totalSubscribers = creatorData.totalSubscribers > subscriberChange 
                ? creatorData.totalSubscribers - subscriberChange 
                : 0;
        }
        
        totalRevenue += revenueIncrease;
    }
    
    /**
     * @notice Set custom fee rate for creator (admin only)
     */
    function setCreatorCustomFee(address creator, uint256 feeBps) external onlyRole(ADMIN_ROLE) {
        require(creators[creator].registeredAt > 0, "Creator not registered");
        require(feeBps <= platformConfig.maxFeeBps, "Fee too high");
        
        creators[creator].customFeeBps = feeBps;
    }
    
    /**
     * @notice Ban/unban creator (admin only)
     */
    function setCreatorStatus(address creator, bool isActive) external onlyRole(ADMIN_ROLE) {
        require(creators[creator].registeredAt > 0, "Creator not registered");
        
        creators[creator].isActive = isActive;
        bannedCreators[creator] = !isActive;
        
        emit CreatorStatusChanged(creator, isActive);
    }
    
    // Platform configuration functions (admin only)
    
    /**
     * @notice Update platform configuration
     */
    function updatePlatformConfig(
        uint256 defaultFeeBps,
        uint256 maxFeeBps,
        address treasury,
        bool paymentsEnabled,
        bool subscriptionsEnabled,
        uint256 minContentPrice,
        uint256 maxContentPrice
    ) external onlyRole(ADMIN_ROLE) {
        require(treasury != address(0), "Invalid treasury address");
        require(defaultFeeBps <= maxFeeBps, "Default fee cannot exceed max");
        require(maxContentPrice >= minContentPrice, "Invalid price range");
        
        platformConfig.defaultFeeBps = defaultFeeBps;
        platformConfig.maxFeeBps = maxFeeBps;
        platformConfig.treasury = treasury;
        platformConfig.paymentsEnabled = paymentsEnabled;
        platformConfig.subscriptionsEnabled = subscriptionsEnabled;
        platformConfig.minContentPrice = minContentPrice;
        platformConfig.maxContentPrice = maxContentPrice;
        
        emit PlatformConfigUpdated(defaultFeeBps, treasury, paymentsEnabled);
    }
    
    /**
     * @notice Update category configuration
     */
    function updateCategoryConfig(
        ContentType category,
        uint256 feeBps,
        bool isActive,
        string calldata name,
        uint256 minPrice,
        uint256 maxPrice
    ) external onlyRole(ADMIN_ROLE) {
        require(feeBps <= platformConfig.maxFeeBps, "Fee too high");
        require(maxPrice >= minPrice, "Invalid price range");
        
        categoryConfigs[category] = CategoryConfig({
            category: category,
            feeBps: feeBps,
            isActive: isActive,
            name: name,
            minPrice: minPrice,
            maxPrice: maxPrice
        });
        
        emit CategoryConfigUpdated(category, feeBps, isActive);
    }
    
    // View functions
    
    /**
     * @notice Get creator details
     */
    function getCreator(address creator) external view returns (Creator memory) {
        return creators[creator];
    }
    
    /**
     * @notice Get content metadata
     */
    function getContentMetadata(uint256 contentId) external view returns (ContentMetadata memory) {
        return contentMetadata[contentId];
    }
    
    /**
     * @notice Get creator's content IDs
     */
    function getCreatorContentIds(address creator) external view returns (uint256[] memory) {
        return creatorContentIds[creator];
    }
    
    /**
     * @notice Get effective fee rate for creator/content
     */
    function getEffectiveFeeRate(address creator, ContentType contentType) 
        external 
        view 
        returns (uint256) 
    {
        // Check custom creator fee
        if (creators[creator].customFeeBps > 0) {
            return creators[creator].customFeeBps;
        }
        
        // Check category-specific fee
        if (categoryConfigs[contentType].isActive && categoryConfigs[contentType].feeBps > 0) {
            return categoryConfigs[contentType].feeBps;
        }
        
        // Return default platform fee
        return platformConfig.defaultFeeBps;
    }
    
    /**
     * @notice Check if creator is active and not banned
     */
    function isCreatorActive(address creator) external view returns (bool) {
        return creators[creator].isActive && !bannedCreators[creator];
    }
    
    /**
     * @notice Get platform statistics
     */
    function getPlatformStats() external view returns (
        uint256 _totalCreators,
        uint256 _totalVerifiedCreators,
        uint256 _totalContent,
        uint256 _totalRevenue
    ) {
        return (totalCreators, totalVerifiedCreators, totalContent, totalRevenue);
    }
    
    // Internal functions
    
    /**
     * @notice Initialize default category configurations
     */
    function _initializeCategories() internal {
        categoryConfigs[ContentType.VIDEO] = CategoryConfig({
            category: ContentType.VIDEO,
            feeBps: 250,
            isActive: true,
            name: "Video Content",
            minPrice: 1e6,      // 1 USDC
            maxPrice: 1000e6    // 1,000 USDC
        });
        
        categoryConfigs[ContentType.DOCUMENT] = CategoryConfig({
            category: ContentType.DOCUMENT,
            feeBps: 200,
            isActive: true,
            name: "Documents",
            minPrice: 1e6,      // 1 USDC
            maxPrice: 100e6     // 100 USDC
        });
        
        categoryConfigs[ContentType.LIVESTREAM] = CategoryConfig({
            category: ContentType.LIVESTREAM,
            feeBps: 300,
            isActive: true,
            name: "Live Streaming",
            minPrice: 5e6,      // 5 USDC
            maxPrice: 500e6     // 500 USDC
        });
        
        categoryConfigs[ContentType.API] = CategoryConfig({
            category: ContentType.API,
            feeBps: 150,
            isActive: true,
            name: "API Access",
            minPrice: 1e6,      // 1 USDC
            maxPrice: 10000e6   // 10,000 USDC
        });
        
        categoryConfigs[ContentType.SOFTWARE] = CategoryConfig({
            category: ContentType.SOFTWARE,
            feeBps: 200,
            isActive: true,
            name: "Software",
            minPrice: 10e6,     // 10 USDC
            maxPrice: 5000e6    // 5,000 USDC
        });
        
        categoryConfigs[ContentType.OTHER] = CategoryConfig({
            category: ContentType.OTHER,
            feeBps: 250,
            isActive: true,
            name: "Other Content",
            minPrice: 1e6,      // 1 USDC
            maxPrice: 1000e6    // 1,000 USDC
        });
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