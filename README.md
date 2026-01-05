# 🔐 PayShield Protocol

**Decentralized Paywall-as-a-Service Platform**

A production-ready, blockchain-based paywall system that enables content creators, sports streaming companies, and media publishers to monetize digital content using USDC micropayments on Base blockchain, with M-Pesa integration via Element Pay.

## 🎯 Overview

PayShield Protocol revolutionizes content monetization by combining:
- **Blockchain Payments**: Instant USDC settlements on Base network
- **M-Pesa Integration**: Element Pay onramp for African markets
- **Anti-Piracy Protection**: Advanced device fingerprinting
- **Pay-per-Access**: Micropayments for videos, documents, livestreams, APIs, software

### Key Features

✅ **For Creators**
- Instant USDC payments with no chargebacks
- 92.5-97.5% revenue share (2.5-7.5% platform fee)
- Advanced analytics and device tracking
- Anti-piracy protection with device limits

✅ **For Users**
- Pay with M-Pesa (Kenya) or crypto wallets
- Access content on verified devices only
- Transparent pricing with no hidden fees
- Cross-device content access (within limits)

✅ **For Platform**
- Scalable SaaS architecture
- Multi-tenant smart contracts
- Real-time fraud detection
- Comprehensive dashboard and analytics

## 🏗️ Architecture

### Smart Contracts (Solidity)
```
Base Network (Chain ID: 8453)
├── PaywallCore.sol - Main payment & access control
├── PaywallSubscriptions.sol - Recurring subscriptions  
├── PaywallRegistry.sol - Content & creator management
└── DeviceAccessManager.sol - Device fingerprint verification
```

### Backend (FastAPI)
```
Python FastAPI Application
├── Payment Processing API
├── Element Pay M-Pesa Integration
├── Device Fingerprinting Service
├── Content Management System
└── Creator Dashboard APIs
```

### Frontend (Next.js)
```
React/TypeScript Application
├── Paywall Modal Component
├── Creator Dashboard
├── Device Fingerprinting Client
├── Wallet Connection (RainbowKit)
└── M-Pesa Payment Interface
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.9+
- PostgreSQL 13+
- Redis 6+

### Installation

1. **Clone Repository**
```bash
git clone https://github.com/payshield/payshield-protocol.git
cd payshield-protocol
```

2. **Install Dependencies**
```bash
# Smart contracts
npm install

# Backend
cd backend
pip install -r requirements.txt

# Frontend  
cd ../frontend
npm install
```

3. **Environment Setup**
```bash
# Copy environment files
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# Configure your settings
nano .env
```

4. **Deploy Smart Contracts**
```bash
# Compile contracts
npx hardhat compile

# Deploy to Base Sepolia testnet
npx hardhat run scripts/deploy.ts --network base-sepolia

# Verify contracts
npx hardhat verify --network base-sepolia <CONTRACT_ADDRESS>
```

5. **Start Services**
```bash
# Backend API
cd backend
uvicorn app.main:app --reload --port 8000

# Frontend
cd ../frontend  
npm run dev
```

## 📋 Smart Contract API

### PaywallCore.sol

**Register Content**
```solidity
function registerContent(
    uint256 priceUSDC,      // Price in USDC (6 decimals)
    uint256 accessDuration, // Duration in seconds (0 = lifetime)
    uint256 maxDevices,     // Max concurrent devices
    string contentHash      // IPFS hash
) external returns (uint256 contentId)
```

**Create Payment**
```solidity
function createPayment(
    bytes32 paymentHash,    // SHA256 hash of preimage
    uint256 contentId,
    uint256 expiryMinutes
) external payable returns (bytes32 paymentId)
```

**Complete Payment**
```solidity
function completePayment(
    bytes32 preimage,
    bytes32 deviceFingerprint
) external returns (bool)
```

**Verify Access**
```solidity
function verifyAccess(
    uint256 contentId,
    bytes32 deviceFingerprint,
    address user
) external view returns (bool hasAccess, uint256 expiresAt)
```

## 🌍 Element Pay Integration

### M-Pesa to USDC Onramp

```python
# Create onramp session
onramp_request = OnrampRequest(
    amount_kes=1300.0,  # 1,300 KES
    destination_wallet="0x742d35Cc6638C0532",
    customer_phone="+254712345678",
    reference="content-123-device-abc"
)

session = await element_pay.create_onramp_session(onramp_request)
# Returns USSD code: *665*313#
```

### USDC to M-Pesa Offramp (Creator Payouts)

```python
# Creator cashout to M-Pesa
offramp_request = OfframpRequest(
    amount_usdc=100.0,  # 100 USDC
    source_wallet="0x742d35Cc6638C0532",
    customer_phone="+254712345678"
)

payout = await element_pay.create_offramp_session(offramp_request)
```

## 🔍 Device Fingerprinting

### Client-Side Collection

```typescript
import { fingerprintGenerator } from './services/fingerprint';

// Generate device fingerprint
const fingerprint = await fingerprintGenerator.generateFingerprint();

// Get blockchain-compatible hash
const fingerprintHash = await fingerprintGenerator.getFingerprintForBlockchain();
```

### Server-Side Validation

```python
from app.services.fingerprint_service import fingerprint_service

# Validate fingerprint
result = await fingerprint_service.validate_fingerprint(
    fingerprint_data=request.json(),
    ip_address="192.168.1.1",
    user_address="0x742d35Cc6638C0532"
)

print(f"Valid: {result.is_valid}")
print(f"Suspicion Score: {result.suspicion_score}")
```

## 📊 Usage Examples

### Content Creator Flow

```javascript
// 1. Register as creator
await api.post('/api/v1/creator/register', {
    name: "John's Sports Channel",
    email: "john@sports.com"
});

// 2. Register content
const content = await api.post('/api/v1/content', {
    title: "Liverpool vs Chelsea Live",
    price_usdc: 5.0,
    access_duration: 7200, // 2 hours
    max_devices: 3,
    content_type: "livestream"
});

// 3. Generate paywall URL
const paywallUrl = `https://app.payshield.io/pay/${content.id}`;
```

### User Payment Flow

```javascript
// 1. User visits paywall
// 2. Select payment method (Crypto or M-Pesa)

// For M-Pesa payment
const payment = await api.post('/api/v1/payments/mpesa/initiate', {
    content_id: 123,
    device_fingerprint: "abc123...",
    phone: "+254712345678"
});

// User dials USSD code: *665*313#
// Payment auto-completes via webhook

// 3. Verify access
const access = await api.post('/api/v1/access/verify', {
    content_id: 123,
    device_fingerprint: "abc123..."
});

if (access.has_access) {
    // Show content
}
```

## 🔧 API Reference

### Content Management

```bash
POST /api/v1/content              # Register new content
GET  /api/v1/content/{id}         # Get content details
PATCH /api/v1/content/{id}        # Update content
POST /api/v1/content/{id}/paywall-url  # Generate paywall URL
```

### Payment Processing

```bash
POST /api/v1/payments/create       # Create payment session
POST /api/v1/payments/mpesa/initiate  # M-Pesa payment
POST /api/v1/payments/verify       # Verify payment
GET  /api/v1/payments/{id}/status  # Check payment status
```

### Access Control

```bash
POST /api/v1/access/verify         # Verify device access
POST /api/v1/access/revoke         # Revoke device access
```

### Device Management

```bash
POST /api/v1/devices/register      # Register device
GET  /api/v1/devices/my-devices    # List user devices
DELETE /api/v1/devices/{hash}      # Remove device
```

## 🧪 Testing

### Smart Contract Tests

```bash
# Run all tests
npx hardhat test

# Run specific test
npx hardhat test test/PaywallCore.test.ts

# Test with coverage
npx hardhat coverage
```

### Backend Tests

```bash
cd backend
pytest tests/ -v

# With coverage
pytest tests/ --cov=app --cov-report=html
```

### Frontend Tests

```bash
cd frontend
npm test

# E2E tests
npm run test:e2e
```

## 📈 Deployment

### Production Deployment

1. **Smart Contracts (Base Mainnet)**
```bash
npx hardhat run scripts/deploy.ts --network base
```

2. **Backend (Docker)**
```bash
docker build -t payshield-api backend/
docker run -p 8000:8000 payshield-api
```

3. **Frontend (Vercel)**
```bash
vercel deploy --prod
```

### Environment Configuration

**Production Environment Variables**
```env
# Blockchain
BASE_RPC_URL=https://mainnet.base.org
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

# Element Pay
ELEMENT_PAY_API_KEY=live_...
ELEMENT_PAY_API_SECRET=live_...

# Database
DATABASE_URL=postgresql://user:pass@prod-db:5432/payshield

# Security
JWT_SECRET=production-secret-key
API_SECRET_KEY=production-api-key
```

## 📝 Documentation

- [Smart Contract Documentation](./contracts/README.md)
- [Backend API Documentation](./backend/README.md)
- [Frontend Documentation](./frontend/README.md)
- [Element Pay Integration Guide](./docs/element-pay.md)
- [Device Fingerprinting Guide](./docs/fingerprinting.md)

## 🛡️ Security

- Smart contracts audited by [Audit Firm]
- Device fingerprinting prevents piracy
- Rate limiting and DDoS protection
- Encrypted sensitive data
- Multi-sig treasury management

## 🌟 Roadmap

### Phase 1: MVP (Completed)
- ✅ Core smart contracts
- ✅ Basic payment flow
- ✅ M-Pesa integration
- ✅ Device fingerprinting

### Phase 2: Advanced Features
- [ ] Mobile apps (iOS/Android)
- [ ] Advanced analytics dashboard
- [ ] Multi-chain support (Polygon, Arbitrum)
- [ ] NFT-gated content

### Phase 3: Scale & Expand
- [ ] White-label solutions
- [ ] Enterprise features
- [ ] Global payment methods
- [ ] AI-powered fraud detection

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs.payshield.io](https://docs.payshield.io)
- **Discord**: [discord.gg/payshield](https://discord.gg/payshield)
- **Email**: support@payshield.io
- **Twitter**: [@PayShieldHQ](https://twitter.com/PayShieldHQ)

---

**Built with ❤️ for the future of content monetization**