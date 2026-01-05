"""
Device Fingerprinting Service
Server-side validation and fraud detection
"""

import hashlib
import json
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
import re
import ipaddress
from collections import defaultdict

from app.config import settings

logger = logging.getLogger(__name__)

@dataclass
class FingerprintComponents:
    """Device fingerprint components"""
    user_agent: str
    screen_width: int
    screen_height: int
    color_depth: int
    pixel_ratio: float
    timezone_offset: int
    timezone_name: str
    language: str
    languages: List[str]
    platform: str
    hardware_concurrency: int
    device_memory: Optional[int]
    max_touch_points: int
    canvas_fingerprint: str
    webgl_vendor: str
    webgl_renderer: str
    webgl_hash: str
    audio_fingerprint: str
    available_fonts: List[str]
    plugins: List[str]
    cookies_enabled: bool
    local_storage_enabled: bool
    session_storage_enabled: bool
    do_not_track: Optional[str]

@dataclass
class DeviceFingerprint:
    """Complete device fingerprint"""
    hash: str
    components: FingerprintComponents
    confidence: float
    created_at: str
    version: str
    ip_address: Optional[str] = None
    geolocation_hash: Optional[str] = None

@dataclass
class FingerprintValidationResult:
    """Result of fingerprint validation"""
    is_valid: bool
    confidence: float
    suspicion_score: int
    anomalies: List[str]
    recommendations: List[str]

@dataclass
class DeviceRecord:
    """Device record for tracking"""
    fingerprint_hash: str
    first_seen: datetime
    last_seen: datetime
    access_count: int
    linked_addresses: List[str]
    suspicion_score: int
    is_blacklisted: bool
    ip_addresses: List[str]
    user_agents: List[str]
    anomalies: List[Dict[str, Any]]

class FingerprintService:
    """Service for device fingerprint validation and fraud detection"""
    
    def __init__(self):
        self.device_records: Dict[str, DeviceRecord] = {}
        self.ip_reputation_cache: Dict[str, Dict[str, Any]] = {}
        self.suspicious_patterns = self._load_suspicious_patterns()
        self.known_bot_signatures = self._load_bot_signatures()
        
        logger.info("✅ Fingerprint service initialized")
    
    def _load_suspicious_patterns(self) -> Dict[str, List[str]]:
        """Load patterns that indicate suspicious behavior"""
        return {
            "user_agents": [
                r"bot|crawler|spider|scraper",
                r"headless|phantom|selenium|puppeteer",
                r"curl|wget|python|go-http",
                r"test|automation|robot"
            ],
            "screen_resolutions": [
                "1x1", "0x0", "800x600", "1024x768"  # Common automation resolutions
            ],
            "canvas_fingerprints": [
                # Known canvas fingerprints from automation tools
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA"  # Common automation signature
            ],
            "webgl_renderers": [
                "swiftshader",  # Software rendering (common in automation)
                "mesa",         # Linux software rendering
                "llvmpipe"      # Software rendering
            ]
        }
    
    def _load_bot_signatures(self) -> List[Dict[str, Any]]:
        """Load known bot/automation signatures"""
        return [
            {
                "name": "Chrome Headless",
                "user_agent_pattern": r"HeadlessChrome",
                "webgl_vendor": "Google Inc.",
                "webgl_renderer": "ANGLE",
                "suspicion_score": 90
            },
            {
                "name": "Selenium WebDriver",
                "user_agent_pattern": r"Chrome.*webdriver",
                "hardware_concurrency": 4,
                "device_memory": None,
                "suspicion_score": 95
            },
            {
                "name": "Puppeteer",
                "user_agent_pattern": r"Chrome.*Puppeteer",
                "canvas_fingerprint": "automation",
                "suspicion_score": 95
            }
        ]
    
    async def validate_fingerprint(
        self,
        fingerprint_data: Dict[str, Any],
        ip_address: str,
        user_address: str
    ) -> FingerprintValidationResult:
        """Validate and analyze device fingerprint"""
        try:
            # Parse fingerprint components
            components = self._parse_fingerprint_components(fingerprint_data)
            
            # Generate fingerprint hash
            fingerprint_hash = self._generate_fingerprint_hash(components)
            
            # Calculate confidence
            confidence = self._calculate_confidence(components)
            
            # Detect anomalies
            anomalies = await self._detect_anomalies(components, ip_address, user_address)
            
            # Calculate suspicion score
            suspicion_score = self._calculate_suspicion_score(components, anomalies, ip_address)
            
            # Generate recommendations
            recommendations = self._generate_recommendations(anomalies, suspicion_score)
            
            # Update device record
            await self._update_device_record(
                fingerprint_hash, 
                components, 
                ip_address, 
                user_address, 
                suspicion_score
            )
            
            is_valid = (
                confidence >= 70 and 
                suspicion_score < settings.FINGERPRINT_SUSPICION_THRESHOLD and
                not self._is_blacklisted(fingerprint_hash)
            )
            
            return FingerprintValidationResult(
                is_valid=is_valid,
                confidence=confidence,
                suspicion_score=suspicion_score,
                anomalies=anomalies,
                recommendations=recommendations
            )
            
        except Exception as e:
            logger.error(f"Fingerprint validation failed: {e}")
            return FingerprintValidationResult(
                is_valid=False,
                confidence=0,
                suspicion_score=100,
                anomalies=["validation_error"],
                recommendations=["Contact support"]
            )
    
    def _parse_fingerprint_components(self, data: Dict[str, Any]) -> FingerprintComponents:
        """Parse raw fingerprint data into structured components"""
        return FingerprintComponents(
            user_agent=data.get("userAgent", ""),
            screen_width=data.get("screen", {}).get("width", 0),
            screen_height=data.get("screen", {}).get("height", 0),
            color_depth=data.get("screen", {}).get("colorDepth", 0),
            pixel_ratio=data.get("screen", {}).get("pixelRatio", 1.0),
            timezone_offset=data.get("timezone", {}).get("offset", 0),
            timezone_name=data.get("timezone", {}).get("name", ""),
            language=data.get("language", ""),
            languages=data.get("languages", []),
            platform=data.get("platform", ""),
            hardware_concurrency=data.get("hardwareConcurrency", 0),
            device_memory=data.get("deviceMemory"),
            max_touch_points=data.get("maxTouchPoints", 0),
            canvas_fingerprint=data.get("canvas", ""),
            webgl_vendor=data.get("webgl", {}).get("vendor", ""),
            webgl_renderer=data.get("webgl", {}).get("renderer", ""),
            webgl_hash=data.get("webgl", {}).get("hash", ""),
            audio_fingerprint=data.get("audio", ""),
            available_fonts=data.get("fonts", []),
            plugins=data.get("plugins", []),
            cookies_enabled=data.get("cookiesEnabled", True),
            local_storage_enabled=data.get("localStorageEnabled", True),
            session_storage_enabled=data.get("sessionStorageEnabled", True),
            do_not_track=data.get("doNotTrack")
        )
    
    def _generate_fingerprint_hash(self, components: FingerprintComponents) -> str:
        """Generate stable hash from fingerprint components"""
        # Create stable representation
        fingerprint_string = json.dumps(asdict(components), sort_keys=True, default=str)
        
        # Generate SHA256 hash
        return hashlib.sha256(fingerprint_string.encode()).hexdigest()
    
    def _calculate_confidence(self, components: FingerprintComponents) -> float:
        """Calculate confidence score for fingerprint uniqueness"""
        confidence = 0
        
        # Screen resolution uniqueness (higher resolution = more unique)
        screen_area = components.screen_width * components.screen_height
        if screen_area > 1920 * 1080:
            confidence += 20
        elif screen_area > 1366 * 768:
            confidence += 15
        elif screen_area > 1024 * 768:
            confidence += 10
        else:
            confidence += 5
        
        # Canvas fingerprint (very unique)
        if components.canvas_fingerprint and len(components.canvas_fingerprint) > 50:
            confidence += 25
        
        # WebGL fingerprint (unique)
        if components.webgl_vendor and components.webgl_renderer:
            confidence += 20
        
        # Audio fingerprint (unique)
        if components.audio_fingerprint and len(components.audio_fingerprint) > 10:
            confidence += 15
        
        # Available fonts (somewhat unique)
        if len(components.available_fonts) > 20:
            confidence += 10
        elif len(components.available_fonts) > 10:
            confidence += 5
        
        # Hardware concurrency (less unique but helpful)
        if components.hardware_concurrency > 0:
            confidence += 5
        
        # Device memory (if available)
        if components.device_memory:
            confidence += 5
        
        return min(confidence, 100)
    
    async def _detect_anomalies(
        self,
        components: FingerprintComponents,
        ip_address: str,
        user_address: str
    ) -> List[str]:
        """Detect fingerprinting anomalies and suspicious patterns"""
        anomalies = []
        
        # Check user agent
        user_agent = components.user_agent.lower()
        for pattern in self.suspicious_patterns["user_agents"]:
            if re.search(pattern, user_agent, re.IGNORECASE):
                anomalies.append(f"suspicious_user_agent: {pattern}")
        
        # Check screen resolution
        screen_res = f"{components.screen_width}x{components.screen_height}"
        if screen_res in self.suspicious_patterns["screen_resolutions"]:
            anomalies.append(f"suspicious_screen_resolution: {screen_res}")
        
        # Check for automation signatures
        for signature in self.known_bot_signatures:
            if re.search(signature["user_agent_pattern"], components.user_agent, re.IGNORECASE):
                anomalies.append(f"bot_signature: {signature['name']}")
        
        # Check impossible combinations
        if components.max_touch_points > 0 and components.platform.lower() not in ["android", "ios", "ipad"]:
            anomalies.append("impossible_touch_desktop")
        
        if components.hardware_concurrency == 0:
            anomalies.append("missing_hardware_concurrency")
        
        # Check canvas fingerprint
        if not components.canvas_fingerprint:
            anomalies.append("missing_canvas_fingerprint")
        elif components.canvas_fingerprint in self.suspicious_patterns["canvas_fingerprints"]:
            anomalies.append("known_automation_canvas")
        
        # Check WebGL
        if not components.webgl_vendor or not components.webgl_renderer:
            anomalies.append("missing_webgl_info")
        
        renderer_lower = components.webgl_renderer.lower()
        for suspicious_renderer in self.suspicious_patterns["webgl_renderers"]:
            if suspicious_renderer in renderer_lower:
                anomalies.append(f"suspicious_webgl_renderer: {suspicious_renderer}")
        
        # Check for rapid fingerprint changes (if we have history)
        await self._check_fingerprint_stability(components, user_address, anomalies)
        
        # Check IP reputation
        await self._check_ip_reputation(ip_address, anomalies)
        
        return anomalies
    
    async def _check_fingerprint_stability(
        self,
        components: FingerprintComponents,
        user_address: str,
        anomalies: List[str]
    ):
        """Check if user's fingerprint has changed rapidly (potential spoofing)"""
        # In a real implementation, this would check database records
        # For now, we'll simulate this check
        pass
    
    async def _check_ip_reputation(self, ip_address: str, anomalies: List[str]):
        """Check IP address reputation"""
        try:
            # Check if IP is in known suspicious ranges
            ip = ipaddress.ip_address(ip_address)
            
            # Check for localhost/private IPs (could be proxies)
            if ip.is_private or ip.is_loopback:
                anomalies.append("private_ip_address")
            
            # Check for known VPN/proxy ranges (would need real service integration)
            # This is simplified - in production, integrate with IP reputation APIs
            
        except ValueError:
            anomalies.append("invalid_ip_address")
    
    def _calculate_suspicion_score(
        self,
        components: FingerprintComponents,
        anomalies: List[str],
        ip_address: str
    ) -> int:
        """Calculate overall suspicion score (0-100)"""
        score = 0
        
        # Base score from anomalies
        for anomaly in anomalies:
            if anomaly.startswith("bot_signature"):
                score += 40
            elif anomaly.startswith("suspicious_user_agent"):
                score += 20
            elif anomaly.startswith("impossible_"):
                score += 30
            elif anomaly.startswith("missing_"):
                score += 10
            elif anomaly.startswith("suspicious_"):
                score += 15
            else:
                score += 5
        
        # Additional checks
        if not components.cookies_enabled:
            score += 10
        
        if not components.local_storage_enabled:
            score += 10
        
        if components.do_not_track == "1":
            score += 5  # Privacy-conscious users, slight increase
        
        # Perfect fingerprint is suspicious too
        if len(anomalies) == 0 and self._is_too_perfect(components):
            score += 15
            anomalies.append("suspiciously_perfect_fingerprint")
        
        return min(score, 100)
    
    def _is_too_perfect(self, components: FingerprintComponents) -> bool:
        """Check if fingerprint is suspiciously perfect (could be fake)"""
        # Check for unrealistic hardware combinations
        if (components.hardware_concurrency == 8 and 
            components.device_memory and components.device_memory >= 32 and
            components.screen_width * components.screen_height >= 3840 * 2160):
            # Very high-end setup, could be fake
            return True
        
        # Check for perfect round numbers
        if (components.screen_width % 100 == 0 and 
            components.screen_height % 100 == 0 and
            components.pixel_ratio == 1.0):
            return True
        
        return False
    
    def _generate_recommendations(
        self,
        anomalies: List[str],
        suspicion_score: int
    ) -> List[str]:
        """Generate recommendations based on anomalies"""
        recommendations = []
        
        if suspicion_score >= 80:
            recommendations.append("block_access")
            recommendations.append("require_manual_verification")
        elif suspicion_score >= 60:
            recommendations.append("require_additional_verification")
            recommendations.append("limit_access_attempts")
        elif suspicion_score >= 40:
            recommendations.append("monitor_closely")
            recommendations.append("rate_limit_aggressively")
        elif suspicion_score >= 20:
            recommendations.append("monitor_activity")
        
        if any("bot_signature" in a for a in anomalies):
            recommendations.append("block_automation_tools")
        
        if any("missing_" in a for a in anomalies):
            recommendations.append("request_browser_update")
        
        return recommendations
    
    async def _update_device_record(
        self,
        fingerprint_hash: str,
        components: FingerprintComponents,
        ip_address: str,
        user_address: str,
        suspicion_score: int
    ):
        """Update device record with new information"""
        now = datetime.now()
        
        if fingerprint_hash in self.device_records:
            record = self.device_records[fingerprint_hash]
            record.last_seen = now
            record.access_count += 1
            record.suspicion_score = max(record.suspicion_score, suspicion_score)
            
            if user_address not in record.linked_addresses:
                record.linked_addresses.append(user_address)
            
            if ip_address not in record.ip_addresses:
                record.ip_addresses.append(ip_address)
            
            # Track user agent changes
            if components.user_agent not in record.user_agents:
                record.user_agents.append(components.user_agent)
                if len(record.user_agents) > 5:  # Too many different user agents
                    record.anomalies.append({
                        "type": "multiple_user_agents",
                        "timestamp": now.isoformat(),
                        "count": len(record.user_agents)
                    })
        else:
            # New device
            self.device_records[fingerprint_hash] = DeviceRecord(
                fingerprint_hash=fingerprint_hash,
                first_seen=now,
                last_seen=now,
                access_count=1,
                linked_addresses=[user_address],
                suspicion_score=suspicion_score,
                is_blacklisted=False,
                ip_addresses=[ip_address],
                user_agents=[components.user_agent],
                anomalies=[]
            )
    
    def _is_blacklisted(self, fingerprint_hash: str) -> bool:
        """Check if device is blacklisted"""
        record = self.device_records.get(fingerprint_hash)
        return record.is_blacklisted if record else False
    
    # Public API methods
    
    async def check_device_limits(
        self,
        fingerprint_hash: str,
        content_id: str,
        max_devices: int
    ) -> bool:
        """Check if device limit is exceeded for content"""
        # In a real implementation, this would check the database
        # For now, return True (allowed)
        return True
    
    async def calculate_risk_score(
        self,
        fingerprint_hash: str
    ) -> int:
        """Calculate overall risk score for device"""
        record = self.device_records.get(fingerprint_hash)
        if not record:
            return 50  # Unknown device, medium risk
        
        risk_score = record.suspicion_score
        
        # Adjust based on behavior patterns
        if record.access_count > 1000:  # Very high usage
            risk_score += 10
        
        if len(record.linked_addresses) > 10:  # Used by many addresses
            risk_score += 20
        
        if len(record.ip_addresses) > 20:  # Used from many IPs
            risk_score += 15
        
        return min(risk_score, 100)
    
    async def get_device_analytics(
        self,
        fingerprint_hash: str
    ) -> Optional[Dict[str, Any]]:
        """Get analytics for a device"""
        record = self.device_records.get(fingerprint_hash)
        if not record:
            return None
        
        return {
            "fingerprint_hash": fingerprint_hash,
            "first_seen": record.first_seen.isoformat(),
            "last_seen": record.last_seen.isoformat(),
            "access_count": record.access_count,
            "linked_addresses_count": len(record.linked_addresses),
            "unique_ips_count": len(record.ip_addresses),
            "user_agents_count": len(record.user_agents),
            "suspicion_score": record.suspicion_score,
            "is_blacklisted": record.is_blacklisted,
            "anomaly_count": len(record.anomalies),
            "risk_score": await self.calculate_risk_score(fingerprint_hash)
        }
    
    async def detect_fingerprint_spoofing(
        self,
        fingerprint_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Detect potential fingerprint spoofing attempts"""
        components = self._parse_fingerprint_components(fingerprint_data)
        spoofing_indicators = []
        
        # Check for known spoofing patterns
        if components.canvas_fingerprint == "fake" or not components.canvas_fingerprint:
            spoofing_indicators.append("missing_or_fake_canvas")
        
        if not components.webgl_vendor or not components.webgl_renderer:
            spoofing_indicators.append("missing_webgl")
        
        # Check for unrealistic combinations
        if (components.hardware_concurrency > 64 or 
            (components.device_memory and components.device_memory > 64)):
            spoofing_indicators.append("unrealistic_hardware")
        
        # Check for automation signatures
        for pattern in self.suspicious_patterns["user_agents"]:
            if re.search(pattern, components.user_agent, re.IGNORECASE):
                spoofing_indicators.append("automation_detected")
                break
        
        is_spoofed = len(spoofing_indicators) >= 2
        
        return {
            "is_spoofed": is_spoofed,
            "confidence": len(spoofing_indicators) * 25,  # Rough confidence score
            "indicators": spoofing_indicators,
            "fingerprint_hash": self._generate_fingerprint_hash(components)
        }

# Global fingerprint service instance
fingerprint_service = FingerprintService()