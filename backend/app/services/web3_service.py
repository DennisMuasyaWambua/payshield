"""
Web3 Service for blockchain interactions
"""

import json
import logging
from typing import Dict, Any, Optional, Tuple
from web3 import Web3, HTTPProvider
from web3.contract import Contract
from web3.exceptions import TransactionNotFound, BlockNotFound
from eth_account import Account
import time

from app.config import settings, Web3Config

logger = logging.getLogger(__name__)

# Contract ABIs (simplified - in production, load from files)
PAYWALL_CORE_ABI = [
    {
        "inputs": [{"name": "priceUSDC", "type": "uint256"}, {"name": "accessDuration", "type": "uint256"}, {"name": "maxDevices", "type": "uint256"}, {"name": "contentHash", "type": "string"}],
        "name": "registerContent",
        "outputs": [{"name": "contentId", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"name": "paymentHash", "type": "bytes32"}, {"name": "contentId", "type": "uint256"}, {"name": "expiryMinutes", "type": "uint256"}],
        "name": "createPayment",
        "outputs": [{"name": "paymentId", "type": "bytes32"}],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [{"name": "preimage", "type": "bytes32"}, {"name": "deviceFingerprint", "type": "bytes32"}],
        "name": "completePayment",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"name": "contentId", "type": "uint256"}, {"name": "deviceFingerprint", "type": "bytes32"}, {"name": "user", "type": "address"}],
        "name": "verifyAccess",
        "outputs": [{"name": "hasAccess", "type": "bool"}, {"name": "expiresAt", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]

class Web3Service:
    """Service for interacting with blockchain contracts"""
    
    def __init__(self):
        self.w3 = Web3(HTTPProvider(Web3Config.get_rpc_url()))
        self.account = Account.from_key(settings.PRIVATE_KEY)
        self.chain_id = Web3Config.get_chain_id()
        
        # Initialize contracts
        self._init_contracts()
        
        # Validate connection
        if not self.w3.is_connected():
            raise ConnectionError("Failed to connect to Web3 provider")
        
        logger.info(f"✅ Web3 service initialized on chain {self.chain_id}")
    
    def _init_contracts(self):
        """Initialize smart contract instances"""
        try:
            self.paywall_core = self.w3.eth.contract(
                address=self.w3.to_checksum_address(settings.PAYWALL_CORE_ADDRESS),
                abi=PAYWALL_CORE_ABI
            )
            
            # Initialize other contracts similarly
            # self.paywall_subscriptions = ...
            # self.paywall_registry = ...
            # self.device_access_manager = ...
            
        except Exception as e:
            logger.error(f"Failed to initialize contracts: {e}")
            raise
    
    def get_nonce(self) -> int:
        """Get the current nonce for the account"""
        return self.w3.eth.get_transaction_count(self.account.address)
    
    def estimate_gas(self, transaction: Dict[str, Any]) -> int:
        """Estimate gas for a transaction"""
        try:
            return self.w3.eth.estimate_gas(transaction)
        except Exception as e:
            logger.warning(f"Gas estimation failed: {e}, using default")
            return 200000  # Default gas limit
    
    def send_transaction(self, transaction: Dict[str, Any]) -> str:
        """Sign and send a transaction"""
        try:
            # Set gas and nonce if not provided
            if 'gas' not in transaction:
                transaction['gas'] = self.estimate_gas(transaction)
            
            if 'nonce' not in transaction:
                transaction['nonce'] = self.get_nonce()
            
            if 'chainId' not in transaction:
                transaction['chainId'] = self.chain_id
            
            if 'gasPrice' not in transaction and 'maxFeePerGas' not in transaction:
                transaction['gasPrice'] = self.w3.eth.gas_price
            
            # Sign transaction
            signed_txn = self.account.sign_transaction(transaction)
            
            # Send transaction
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            logger.info(f"Transaction sent: {tx_hash.hex()}")
            return tx_hash.hex()
            
        except Exception as e:
            logger.error(f"Failed to send transaction: {e}")
            raise
    
    def wait_for_transaction(self, tx_hash: str, timeout: int = 300) -> Dict[str, Any]:
        """Wait for transaction to be mined"""
        try:
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
            return dict(receipt)
        except Exception as e:
            logger.error(f"Transaction {tx_hash} failed or timed out: {e}")
            raise
    
    # Content Management
    
    async def register_content(
        self,
        creator_address: str,
        price_usdc: int,
        access_duration: int,
        max_devices: int,
        content_hash: str
    ) -> Tuple[str, int]:
        """Register new content on blockchain"""
        try:
            # Build transaction
            transaction = self.paywall_core.functions.registerContent(
                price_usdc,
                access_duration,
                max_devices,
                content_hash
            ).build_transaction({
                'from': creator_address,
                'nonce': self.get_nonce(),
                'chainId': self.chain_id
            })
            
            # Send transaction
            tx_hash = self.send_transaction(transaction)
            
            # Wait for confirmation
            receipt = self.wait_for_transaction(tx_hash)
            
            # Parse events to get content ID
            content_id = self._parse_content_registered_event(receipt)
            
            return tx_hash, content_id
            
        except Exception as e:
            logger.error(f"Failed to register content: {e}")
            raise
    
    async def create_payment(
        self,
        payment_hash: str,
        content_id: int,
        expiry_minutes: int,
        user_address: str
    ) -> str:
        """Create payment intent on blockchain"""
        try:
            # Get content details to determine price
            content = await self.get_content(content_id)
            price_usdc = content['priceUSDC']
            
            transaction = self.paywall_core.functions.createPayment(
                payment_hash,
                content_id,
                expiry_minutes
            ).build_transaction({
                'from': user_address,
                'value': price_usdc,
                'nonce': self.get_nonce(),
                'chainId': self.chain_id
            })
            
            tx_hash = self.send_transaction(transaction)
            return tx_hash
            
        except Exception as e:
            logger.error(f"Failed to create payment: {e}")
            raise
    
    async def complete_payment(
        self,
        preimage: bytes,
        device_fingerprint: str,
        user_address: str
    ) -> str:
        """Complete payment with preimage revelation"""
        try:
            device_fingerprint_bytes = self.w3.keccak(text=device_fingerprint)
            
            transaction = self.paywall_core.functions.completePayment(
                preimage,
                device_fingerprint_bytes
            ).build_transaction({
                'from': user_address,
                'nonce': self.get_nonce(),
                'chainId': self.chain_id
            })
            
            tx_hash = self.send_transaction(transaction)
            return tx_hash
            
        except Exception as e:
            logger.error(f"Failed to complete payment: {e}")
            raise
    
    # Access Verification
    
    async def verify_access(
        self,
        content_id: int,
        device_fingerprint: str,
        user_address: str
    ) -> Tuple[bool, int]:
        """Verify if user has access to content from device"""
        try:
            device_fingerprint_bytes = self.w3.keccak(text=device_fingerprint)
            
            result = self.paywall_core.functions.verifyAccess(
                content_id,
                device_fingerprint_bytes,
                user_address
            ).call()
            
            has_access, expires_at = result
            return has_access, expires_at
            
        except Exception as e:
            logger.error(f"Failed to verify access: {e}")
            return False, 0
    
    async def record_access(
        self,
        content_id: int,
        device_fingerprint: str
    ) -> str:
        """Record content access for analytics"""
        try:
            device_fingerprint_bytes = self.w3.keccak(text=device_fingerprint)
            
            transaction = self.paywall_core.functions.recordAccess(
                content_id,
                device_fingerprint_bytes
            ).build_transaction({
                'from': self.account.address,
                'nonce': self.get_nonce(),
                'chainId': self.chain_id
            })
            
            tx_hash = self.send_transaction(transaction)
            return tx_hash
            
        except Exception as e:
            logger.error(f"Failed to record access: {e}")
            raise
    
    # Creator Management
    
    async def withdraw_creator_balance(self, creator_address: str) -> str:
        """Withdraw creator earnings"""
        try:
            transaction = self.paywall_core.functions.withdrawCreatorBalance().build_transaction({
                'from': creator_address,
                'nonce': self.get_nonce(),
                'chainId': self.chain_id
            })
            
            tx_hash = self.send_transaction(transaction)
            return tx_hash
            
        except Exception as e:
            logger.error(f"Failed to withdraw creator balance: {e}")
            raise
    
    async def get_creator_balance(self, creator_address: str) -> int:
        """Get creator's withdrawable balance"""
        try:
            balance = self.paywall_core.functions.creatorBalances(creator_address).call()
            return balance
        except Exception as e:
            logger.error(f"Failed to get creator balance: {e}")
            return 0
    
    # Data Retrieval
    
    async def get_content(self, content_id: int) -> Dict[str, Any]:
        """Get content details from blockchain"""
        try:
            content = self.paywall_core.functions.getContent(content_id).call()
            return {
                'contentId': content[0],
                'creator': content[1],
                'priceUSDC': content[2],
                'accessDuration': content[3],
                'maxDevices': content[4],
                'isActive': content[5],
                'totalRevenue': content[6],
                'accessCount': content[7],
                'contentHash': content[8],
                'createdAt': content[9]
            }
        except Exception as e:
            logger.error(f"Failed to get content {content_id}: {e}")
            raise
    
    async def get_creator_content_ids(self, creator_address: str) -> list:
        """Get all content IDs for a creator"""
        try:
            content_ids = self.paywall_core.functions.getCreatorContent(creator_address).call()
            return list(content_ids)
        except Exception as e:
            logger.error(f"Failed to get creator content: {e}")
            return []
    
    # Device Management
    
    async def update_suspicion_score(
        self,
        device_fingerprint: str,
        score: int,
        reason: str
    ) -> str:
        """Update device suspicion score (oracle only)"""
        try:
            # This would use the DeviceAccessManager contract
            # Implementation depends on the specific contract ABI
            pass
        except Exception as e:
            logger.error(f"Failed to update suspicion score: {e}")
            raise
    
    # Event Parsing
    
    def _parse_content_registered_event(self, receipt: Dict[str, Any]) -> int:
        """Parse ContentRegistered event to extract content ID"""
        try:
            # Parse logs to find ContentRegistered event
            for log in receipt['logs']:
                try:
                    decoded_log = self.paywall_core.events.ContentRegistered().processLog(log)
                    return decoded_log['args']['contentId']
                except:
                    continue
            
            raise ValueError("ContentRegistered event not found in transaction receipt")
            
        except Exception as e:
            logger.error(f"Failed to parse ContentRegistered event: {e}")
            raise
    
    # Utility Methods
    
    def to_wei(self, amount: float, decimals: int = 18) -> int:
        """Convert token amount to wei"""
        return int(amount * (10 ** decimals))
    
    def from_wei(self, amount: int, decimals: int = 18) -> float:
        """Convert wei to token amount"""
        return amount / (10 ** decimals)
    
    def is_valid_address(self, address: str) -> bool:
        """Check if address is valid Ethereum address"""
        try:
            self.w3.to_checksum_address(address)
            return True
        except ValueError:
            return False
    
    def get_block_number(self) -> int:
        """Get current block number"""
        return self.w3.eth.block_number
    
    def get_transaction(self, tx_hash: str) -> Optional[Dict[str, Any]]:
        """Get transaction details"""
        try:
            tx = self.w3.eth.get_transaction(tx_hash)
            return dict(tx)
        except TransactionNotFound:
            return None
    
    def get_transaction_receipt(self, tx_hash: str) -> Optional[Dict[str, Any]]:
        """Get transaction receipt"""
        try:
            receipt = self.w3.eth.get_transaction_receipt(tx_hash)
            return dict(receipt)
        except TransactionNotFound:
            return None

# Global Web3 service instance
web3_service = Web3Service()