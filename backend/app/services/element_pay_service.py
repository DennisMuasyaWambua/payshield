"""
Element Pay Integration Service for M-Pesa to USDC onramp
Documentation: https://devs.elementpay.net
"""

import hmac
import hashlib
import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta
import httpx
from pydantic import BaseModel, Field
import asyncio

from app.config import settings, ElementPayConfig

logger = logging.getLogger(__name__)

# Pydantic models for Element Pay API

class OnrampRequest(BaseModel):
    """Request to create onramp session"""
    amount_kes: float = Field(..., description="Amount in Kenyan Shillings")
    destination_wallet: str = Field(..., description="Destination wallet address")
    destination_chain: str = Field(default="base", description="Blockchain network")
    destination_token: str = Field(default="usdc", description="Token symbol")
    customer_phone: str = Field(..., description="Customer M-Pesa phone number")
    customer_email: Optional[str] = Field(None, description="Customer email")
    reference: str = Field(..., description="Your internal reference")
    callback_url: str = Field(..., description="Webhook callback URL")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")

class OnrampResponse(BaseModel):
    """Response from onramp session creation"""
    session_id: str
    ussd_code: str
    amount_kes: float
    amount_usdc: float
    exchange_rate: float
    expires_at: str
    status: str
    payment_instructions: Optional[Dict[str, Any]] = None

class OfframpRequest(BaseModel):
    """Request to create offramp session (USDC to M-Pesa)"""
    amount_usdc: float = Field(..., description="Amount in USDC")
    source_wallet: str = Field(..., description="Source wallet address")
    customer_phone: str = Field(..., description="Customer M-Pesa phone number")
    customer_email: Optional[str] = Field(None, description="Customer email")
    reference: str = Field(..., description="Your internal reference")
    callback_url: str = Field(..., description="Webhook callback URL")

class OfframpResponse(BaseModel):
    """Response from offramp session creation"""
    session_id: str
    amount_usdc: float
    amount_kes: float
    exchange_rate: float
    transaction_hash: Optional[str] = None
    status: str
    expires_at: str

class PaymentStatus(BaseModel):
    """Payment status response"""
    session_id: str
    status: str  # pending, completed, failed, expired
    amount_kes: Optional[float] = None
    amount_usdc: Optional[float] = None
    transaction_hash: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None

class ExchangeRate(BaseModel):
    """Exchange rate information"""
    pair: str  # e.g., "KES/USDC"
    rate: float
    timestamp: str
    valid_until: str

class WebhookPayload(BaseModel):
    """Webhook payload structure"""
    event: str
    data: Dict[str, Any]
    timestamp: str
    signature: str

class ElementPayService:
    """Service for Element Pay M-Pesa integration"""
    
    def __init__(self):
        self.base_url = settings.ELEMENT_PAY_BASE_URL
        self.api_key = settings.ELEMENT_PAY_API_KEY
        self.api_secret = settings.ELEMENT_PAY_API_SECRET
        self.webhook_secret = settings.ELEMENT_PAY_WEBHOOK_SECRET
        
        # HTTP client with authentication
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "PayShield-Protocol/1.0"
            },
            timeout=30.0
        )
        
        logger.info("✅ Element Pay service initialized")
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()
    
    # Exchange Rate Methods
    
    async def get_exchange_rate(self, pair: str = "KES/USDC") -> ExchangeRate:
        """Get current exchange rate"""
        try:
            response = await self.client.get(f"/exchange-rates/{pair}")
            response.raise_for_status()
            
            data = response.json()
            return ExchangeRate(**data)
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to get exchange rate: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Exchange rate request failed: {e}")
            raise
    
    async def calculate_usdc_amount(self, kes_amount: float) -> float:
        """Calculate USDC amount from KES"""
        try:
            rate_info = await self.get_exchange_rate()
            usdc_amount = kes_amount / rate_info.rate
            return round(usdc_amount, 6)  # USDC has 6 decimals
        except Exception as e:
            logger.error(f"Failed to calculate USDC amount: {e}")
            # Fallback rate (should not be used in production)
            return round(kes_amount / 130.0, 6)  # Approximate rate
    
    async def calculate_kes_amount(self, usdc_amount: float) -> float:
        """Calculate KES amount from USDC"""
        try:
            rate_info = await self.get_exchange_rate()
            kes_amount = usdc_amount * rate_info.rate
            return round(kes_amount, 2)
        except Exception as e:
            logger.error(f"Failed to calculate KES amount: {e}")
            # Fallback rate
            return round(usdc_amount * 130.0, 2)
    
    # Onramp Methods (M-Pesa to USDC)
    
    async def create_onramp_session(self, request: OnrampRequest) -> OnrampResponse:
        """Create M-Pesa to USDC onramp session"""
        try:
            # Calculate USDC amount
            usdc_amount = await self.calculate_usdc_amount(request.amount_kes)
            
            # Prepare request payload
            payload = {
                "type": "onramp",
                "source": {
                    "currency": "KES",
                    "amount": request.amount_kes,
                    "payment_method": "mpesa",
                    "customer_phone": self._format_phone_number(request.customer_phone)
                },
                "destination": {
                    "currency": "USDC",
                    "amount": usdc_amount,
                    "chain": request.destination_chain,
                    "wallet": request.destination_wallet
                },
                "customer": {
                    "phone": self._format_phone_number(request.customer_phone),
                    "email": request.customer_email
                },
                "reference": request.reference,
                "callback_url": request.callback_url,
                "metadata": request.metadata,
                "expires_in": 3600  # 1 hour expiry
            }
            
            response = await self.client.post("/sessions", json=payload)
            response.raise_for_status()
            
            data = response.json()
            
            return OnrampResponse(
                session_id=data["session_id"],
                ussd_code=data["payment_instructions"]["ussd_code"],
                amount_kes=request.amount_kes,
                amount_usdc=usdc_amount,
                exchange_rate=data["exchange_rate"],
                expires_at=data["expires_at"],
                status=data["status"],
                payment_instructions=data.get("payment_instructions")
            )
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Onramp session creation failed: {e.response.status_code} - {e.response.text}")
            raise ValueError(f"Element Pay API error: {e.response.text}")
        except Exception as e:
            logger.error(f"Onramp session creation failed: {e}")
            raise
    
    async def get_payment_status(self, session_id: str) -> PaymentStatus:
        """Check payment status"""
        try:
            response = await self.client.get(f"/sessions/{session_id}")
            response.raise_for_status()
            
            data = response.json()
            
            return PaymentStatus(
                session_id=session_id,
                status=data["status"],
                amount_kes=data.get("source", {}).get("amount"),
                amount_usdc=data.get("destination", {}).get("amount"),
                transaction_hash=data.get("transaction_hash"),
                completed_at=data.get("completed_at"),
                error_message=data.get("error_message")
            )
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Payment status check failed: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Payment status request failed: {e}")
            raise
    
    # Offramp Methods (USDC to M-Pesa)
    
    async def create_offramp_session(self, request: OfframpRequest) -> OfframpResponse:
        """Create USDC to M-Pesa offramp session"""
        try:
            # Calculate KES amount
            kes_amount = await self.calculate_kes_amount(request.amount_usdc)
            
            payload = {
                "type": "offramp",
                "source": {
                    "currency": "USDC",
                    "amount": request.amount_usdc,
                    "chain": "base",
                    "wallet": request.source_wallet
                },
                "destination": {
                    "currency": "KES",
                    "amount": kes_amount,
                    "payment_method": "mpesa",
                    "customer_phone": self._format_phone_number(request.customer_phone)
                },
                "customer": {
                    "phone": self._format_phone_number(request.customer_phone),
                    "email": request.customer_email
                },
                "reference": request.reference,
                "callback_url": request.callback_url
            }
            
            response = await self.client.post("/sessions", json=payload)
            response.raise_for_status()
            
            data = response.json()
            
            return OfframpResponse(
                session_id=data["session_id"],
                amount_usdc=request.amount_usdc,
                amount_kes=kes_amount,
                exchange_rate=data["exchange_rate"],
                transaction_hash=data.get("transaction_hash"),
                status=data["status"],
                expires_at=data["expires_at"]
            )
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Offramp session creation failed: {e.response.status_code} - {e.response.text}")
            raise ValueError(f"Element Pay API error: {e.response.text}")
        except Exception as e:
            logger.error(f"Offramp session creation failed: {e}")
            raise
    
    # Webhook Methods
    
    def verify_webhook_signature(self, payload: bytes, signature: str) -> bool:
        """Verify webhook signature using HMAC-SHA256"""
        try:
            expected_signature = hmac.new(
                self.webhook_secret.encode('utf-8'),
                payload,
                hashlib.sha256
            ).hexdigest()
            
            # Compare signatures securely
            return hmac.compare_digest(f"sha256={expected_signature}", signature)
            
        except Exception as e:
            logger.error(f"Webhook signature verification failed: {e}")
            return False
    
    async def process_webhook(self, payload_bytes: bytes, signature: str) -> Dict[str, Any]:
        """Process incoming webhook from Element Pay"""
        try:
            # Verify signature first
            if not self.verify_webhook_signature(payload_bytes, signature):
                raise ValueError("Invalid webhook signature")
            
            # Parse payload
            payload_str = payload_bytes.decode('utf-8')
            payload_data = json.loads(payload_str)
            
            webhook = WebhookPayload(**payload_data)
            
            logger.info(f"Processing webhook: {webhook.event} for session {webhook.data.get('session_id')}")
            
            # Process different webhook events
            if webhook.event == "payment.completed":
                return await self._handle_payment_completed(webhook.data)
            elif webhook.event == "payment.failed":
                return await self._handle_payment_failed(webhook.data)
            elif webhook.event == "payment.expired":
                return await self._handle_payment_expired(webhook.data)
            elif webhook.event == "offramp.completed":
                return await self._handle_offramp_completed(webhook.data)
            elif webhook.event == "offramp.failed":
                return await self._handle_offramp_failed(webhook.data)
            else:
                logger.warning(f"Unknown webhook event: {webhook.event}")
                return {"status": "ignored", "reason": "unknown_event"}
            
        except Exception as e:
            logger.error(f"Webhook processing failed: {e}")
            raise
    
    async def _handle_payment_completed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle successful payment completion"""
        try:
            session_id = data["session_id"]
            reference = data["reference"]
            amount_usdc = data["destination"]["amount"]
            transaction_hash = data["transaction_hash"]
            metadata = data.get("metadata", {})
            
            # Extract content and device info from metadata
            content_id = metadata.get("content_id")
            device_fingerprint = metadata.get("device_fingerprint")
            user_address = metadata.get("user_address")
            
            logger.info(f"Payment completed: {session_id}, USDC: {amount_usdc}, TX: {transaction_hash}")
            
            # Trigger payment completion in smart contract
            if content_id and device_fingerprint and user_address:
                from app.services.web3_service import web3_service
                # This would trigger the smart contract payment completion
                # await web3_service.complete_payment_from_element_pay(...)
            
            return {
                "status": "processed",
                "session_id": session_id,
                "transaction_hash": transaction_hash
            }
            
        except Exception as e:
            logger.error(f"Failed to handle payment completion: {e}")
            raise
    
    async def _handle_payment_failed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle failed payment"""
        session_id = data["session_id"]
        error_message = data.get("error_message", "Payment failed")
        
        logger.warning(f"Payment failed: {session_id} - {error_message}")
        
        # Update payment status in database
        # await self._update_payment_status(session_id, "failed", error_message)
        
        return {"status": "processed", "session_id": session_id}
    
    async def _handle_payment_expired(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle expired payment"""
        session_id = data["session_id"]
        
        logger.info(f"Payment expired: {session_id}")
        
        # Update payment status in database
        # await self._update_payment_status(session_id, "expired")
        
        return {"status": "processed", "session_id": session_id}
    
    async def _handle_offramp_completed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle successful offramp completion"""
        session_id = data["session_id"]
        amount_kes = data["destination"]["amount"]
        customer_phone = data["destination"]["customer_phone"]
        
        logger.info(f"Offramp completed: {session_id}, KES: {amount_kes} to {customer_phone}")
        
        return {"status": "processed", "session_id": session_id}
    
    async def _handle_offramp_failed(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle failed offramp"""
        session_id = data["session_id"]
        error_message = data.get("error_message", "Offramp failed")
        
        logger.warning(f"Offramp failed: {session_id} - {error_message}")
        
        return {"status": "processed", "session_id": session_id}
    
    # Utility Methods
    
    def _format_phone_number(self, phone: str) -> str:
        """Format phone number to international format"""
        # Remove any non-digit characters
        digits_only = ''.join(filter(str.isdigit, phone))
        
        # Handle Kenyan numbers
        if digits_only.startswith('254'):
            return f"+{digits_only}"
        elif digits_only.startswith('07') or digits_only.startswith('01'):
            return f"+254{digits_only[1:]}"
        elif len(digits_only) == 9:
            return f"+254{digits_only}"
        else:
            # Assume it's already formatted or from another country
            return f"+{digits_only}" if not phone.startswith('+') else phone
    
    def generate_reference(self, prefix: str = "PS") -> str:
        """Generate unique reference for payment"""
        import uuid
        timestamp = int(datetime.now().timestamp())
        unique_id = str(uuid.uuid4())[:8]
        return f"{prefix}-{timestamp}-{unique_id}"
    
    # Rate Limiting and Health Checks
    
    async def health_check(self) -> Dict[str, Any]:
        """Check Element Pay API health"""
        try:
            response = await self.client.get("/health")
            response.raise_for_status()
            
            return {
                "status": "healthy",
                "timestamp": datetime.now().isoformat(),
                "response_time_ms": response.elapsed.total_seconds() * 1000
            }
            
        except Exception as e:
            logger.error(f"Element Pay health check failed: {e}")
            return {
                "status": "unhealthy",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
    
    # Batch Operations
    
    async def get_multiple_payment_status(self, session_ids: List[str]) -> List[PaymentStatus]:
        """Get status for multiple payments"""
        tasks = [self.get_payment_status(session_id) for session_id in session_ids]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        statuses = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Failed to get status for {session_ids[i]}: {result}")
                statuses.append(PaymentStatus(
                    session_id=session_ids[i],
                    status="error",
                    error_message=str(result)
                ))
            else:
                statuses.append(result)
        
        return statuses

# Global Element Pay service instance
element_pay_service = ElementPayService()