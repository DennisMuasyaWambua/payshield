"""
Configuration settings for PayShield Protocol API
"""

import os
from typing import List
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    """Application settings"""
    
    # Environment
    ENVIRONMENT: str = Field(default="development", env="ENVIRONMENT")
    DEBUG: bool = Field(default=True, env="DEBUG")
    
    # API Configuration
    API_SECRET_KEY: str = Field(..., env="API_SECRET_KEY")
    JWT_SECRET: str = Field(..., env="JWT_SECRET")
    JWT_ALGORITHM: str = Field(default="HS256", env="JWT_ALGORITHM")
    JWT_EXPIRE_HOURS: int = Field(default=24, env="JWT_EXPIRE_HOURS")
    
    # Database
    DATABASE_URL: str = Field(..., env="DATABASE_URL")
    
    # Redis
    REDIS_URL: str = Field(default="redis://localhost:6379", env="REDIS_URL")
    
    # Blockchain Configuration
    BASE_RPC_URL: str = Field(..., env="BASE_RPC_URL")
    BASE_SEPOLIA_RPC_URL: str = Field(..., env="BASE_SEPOLIA_RPC_URL")
    PRIVATE_KEY: str = Field(..., env="PRIVATE_KEY")
    
    # Contract Addresses
    PAYWALL_CORE_ADDRESS: str = Field(..., env="PAYWALL_CORE_ADDRESS")
    PAYWALL_SUBSCRIPTIONS_ADDRESS: str = Field(..., env="PAYWALL_SUBSCRIPTIONS_ADDRESS")
    PAYWALL_REGISTRY_ADDRESS: str = Field(..., env="PAYWALL_REGISTRY_ADDRESS")
    DEVICE_ACCESS_MANAGER_ADDRESS: str = Field(..., env="DEVICE_ACCESS_MANAGER_ADDRESS")
    USDC_ADDRESS: str = Field(..., env="USDC_ADDRESS")
    
    # Element Pay Configuration
    ELEMENT_PAY_API_KEY: str = Field(..., env="ELEMENT_PAY_API_KEY")
    ELEMENT_PAY_API_SECRET: str = Field(..., env="ELEMENT_PAY_API_SECRET")
    ELEMENT_PAY_WEBHOOK_SECRET: str = Field(..., env="ELEMENT_PAY_WEBHOOK_SECRET")
    ELEMENT_PAY_BASE_URL: str = Field(
        default="https://api.elementpay.net/v1", 
        env="ELEMENT_PAY_BASE_URL"
    )
    
    # CORS Settings
    ALLOWED_ORIGINS: List[str] = Field(
        default=["http://localhost:3000", "http://localhost:3001"],
        env="ALLOWED_ORIGINS"
    )
    ALLOWED_HOSTS: List[str] = Field(
        default=["localhost", "127.0.0.1", "api.payshield.io"],
        env="ALLOWED_HOSTS"
    )
    
    # Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = Field(default=60, env="RATE_LIMIT_PER_MINUTE")
    RATE_LIMIT_PER_HOUR: int = Field(default=1000, env="RATE_LIMIT_PER_HOUR")
    
    # File Upload
    MAX_UPLOAD_SIZE: int = Field(default=10 * 1024 * 1024, env="MAX_UPLOAD_SIZE")  # 10MB
    UPLOAD_DIRECTORY: str = Field(default="./uploads", env="UPLOAD_DIRECTORY")
    
    # External Services
    IPFS_GATEWAY_URL: str = Field(
        default="https://ipfs.io/ipfs/", 
        env="IPFS_GATEWAY_URL"
    )
    PINATA_API_KEY: str = Field(default="", env="PINATA_API_KEY")
    PINATA_SECRET_KEY: str = Field(default="", env="PINATA_SECRET_KEY")
    
    # Monitoring
    SENTRY_DSN: str = Field(default="", env="SENTRY_DSN")
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")
    
    # Security
    PASSWORD_MIN_LENGTH: int = Field(default=8, env="PASSWORD_MIN_LENGTH")
    SESSION_TIMEOUT_HOURS: int = Field(default=24, env="SESSION_TIMEOUT_HOURS")
    
    # Business Logic
    PLATFORM_FEE_BPS: int = Field(default=250, env="PLATFORM_FEE_BPS")  # 2.5%
    MAX_PLATFORM_FEE_BPS: int = Field(default=750, env="MAX_PLATFORM_FEE_BPS")  # 7.5%
    MIN_CONTENT_PRICE_USDC: float = Field(default=1.0, env="MIN_CONTENT_PRICE_USDC")
    MAX_CONTENT_PRICE_USDC: float = Field(default=10000.0, env="MAX_CONTENT_PRICE_USDC")
    MAX_DEVICES_PER_USER: int = Field(default=10, env="MAX_DEVICES_PER_USER")
    
    # Device Fingerprinting
    FINGERPRINT_SUSPICION_THRESHOLD: int = Field(default=80, env="FINGERPRINT_SUSPICION_THRESHOLD")
    DEVICE_ACCESS_RATE_LIMIT: int = Field(default=1000, env="DEVICE_ACCESS_RATE_LIMIT")  # per day
    
    # Payment Configuration
    PAYMENT_EXPIRY_MINUTES: int = Field(default=60, env="PAYMENT_EXPIRY_MINUTES")
    AUTO_REFUND_EXPIRED_PAYMENTS: bool = Field(default=True, env="AUTO_REFUND_EXPIRED_PAYMENTS")
    
    # Live Streaming
    STREAM_SESSION_TIMEOUT_MINUTES: int = Field(default=30, env="STREAM_SESSION_TIMEOUT_MINUTES")
    MAX_CONCURRENT_STREAMS_PER_USER: int = Field(default=5, env="MAX_CONCURRENT_STREAMS_PER_USER")
    
    # Analytics
    ENABLE_ANALYTICS: bool = Field(default=True, env="ENABLE_ANALYTICS")
    ANALYTICS_BATCH_SIZE: int = Field(default=100, env="ANALYTICS_BATCH_SIZE")
    
    class Config:
        env_file = ".env"
        case_sensitive = True

# Global settings instance
settings = Settings()

# Validation
def validate_settings():
    """Validate critical settings"""
    errors = []
    
    # Check required blockchain settings
    if not settings.PAYWALL_CORE_ADDRESS.startswith('0x'):
        errors.append("PAYWALL_CORE_ADDRESS must be a valid Ethereum address")
    
    if not settings.USDC_ADDRESS.startswith('0x'):
        errors.append("USDC_ADDRESS must be a valid Ethereum address")
    
    # Check Element Pay configuration
    if not settings.ELEMENT_PAY_API_KEY:
        errors.append("ELEMENT_PAY_API_KEY is required")
    
    # Check database URL
    if not settings.DATABASE_URL.startswith(('postgresql://', 'postgresql+psycopg2://')):
        errors.append("DATABASE_URL must be a valid PostgreSQL connection string")
    
    # Check JWT secret
    if len(settings.JWT_SECRET) < 32:
        errors.append("JWT_SECRET should be at least 32 characters long")
    
    if errors:
        raise ValueError("Configuration errors: " + "; ".join(errors))

# Web3 Configuration
class Web3Config:
    """Web3 specific configuration"""
    
    @staticmethod
    def get_rpc_url() -> str:
        """Get the appropriate RPC URL based on environment"""
        if settings.ENVIRONMENT == "production":
            return settings.BASE_RPC_URL
        else:
            return settings.BASE_SEPOLIA_RPC_URL
    
    @staticmethod
    def get_chain_id() -> int:
        """Get chain ID based on environment"""
        if settings.ENVIRONMENT == "production":
            return 8453  # Base Mainnet
        else:
            return 84532  # Base Sepolia

# Element Pay Configuration
class ElementPayConfig:
    """Element Pay specific configuration"""
    
    @staticmethod
    def get_headers() -> dict:
        """Get authentication headers for Element Pay API"""
        return {
            "Authorization": f"Bearer {settings.ELEMENT_PAY_API_KEY}",
            "Content-Type": "application/json"
        }
    
    @staticmethod
    def get_webhook_endpoints() -> dict:
        """Get webhook endpoint URLs"""
        base_url = "https://api.payshield.io"  # Production URL
        if settings.ENVIRONMENT != "production":
            base_url = "https://ngrok-tunnel.com"  # Development tunnel
            
        return {
            "payment_completed": f"{base_url}/api/v1/webhooks/element-pay/payment-completed",
            "payment_failed": f"{base_url}/api/v1/webhooks/element-pay/payment-failed",
            "offramp_completed": f"{base_url}/api/v1/webhooks/element-pay/offramp-completed"
        }

# Initialize validation
if __name__ == "__main__":
    validate_settings()
    print("✅ Configuration validation passed")
else:
    # Only validate in non-test environments
    if os.getenv("TESTING") != "1":
        try:
            validate_settings()
        except ValueError as e:
            print(f"⚠️ Configuration warning: {e}")