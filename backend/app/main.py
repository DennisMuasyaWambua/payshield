"""
PayShield Protocol Backend API
Main application entry point
"""

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.security import HTTPBearer
import uvicorn
import os
import time
from contextlib import asynccontextmanager

from app.config import settings
from app.api.v1 import content, payments, devices, access, creator, streams, subscriptions
from app.services.database import engine, Base
from app.utils.logging import setup_logging

# Setup logging
logger = setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager"""
    logger.info("🚀 Starting PayShield Protocol API...")
    
    # Create database tables
    # Base.metadata.create_all(bind=engine)
    
    # Initialize services
    logger.info("📊 Initializing services...")
    
    yield
    
    logger.info("🛑 Shutting down PayShield Protocol API...")

app = FastAPI(
    title="PayShield Protocol API",
    description="Decentralized Paywall-as-a-Service Platform",
    version="1.0.0",
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
    lifespan=lifespan
)

# Security
security = HTTPBearer()

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.ENVIRONMENT == "production":
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.ALLOWED_HOSTS
    )

# Request logging middleware
@app.middleware("http")
async def log_requests(request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    
    logger.info(
        f"{request.method} {request.url.path} - "
        f"Status: {response.status_code} - "
        f"Time: {process_time:.3f}s"
    )
    
    return response

# Include routers
app.include_router(
    content.router,
    prefix="/api/v1/content",
    tags=["content"]
)

app.include_router(
    payments.router,
    prefix="/api/v1/payments",
    tags=["payments"]
)

app.include_router(
    devices.router,
    prefix="/api/v1/devices",
    tags=["devices"]
)

app.include_router(
    access.router,
    prefix="/api/v1/access",
    tags=["access"]
)

app.include_router(
    creator.router,
    prefix="/api/v1/creator",
    tags=["creator"]
)

app.include_router(
    streams.router,
    prefix="/api/v1/streams",
    tags=["streams"]
)

app.include_router(
    subscriptions.router,
    prefix="/api/v1/subscriptions",
    tags=["subscriptions"]
)

# Health check endpoints
@app.get("/health")
async def health_check():
    """Basic health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": int(time.time()),
        "version": "1.0.0"
    }

@app.get("/health/detailed")
async def detailed_health_check():
    """Detailed health check with service status"""
    try:
        # Check database connection
        from app.services.database import get_db
        db = next(get_db())
        db.execute("SELECT 1")
        db_status = "healthy"
    except Exception as e:
        db_status = f"unhealthy: {str(e)}"
    
    try:
        # Check Redis connection
        from app.services.redis_service import redis_client
        await redis_client.ping()
        redis_status = "healthy"
    except Exception as e:
        redis_status = f"unhealthy: {str(e)}"
    
    try:
        # Check Web3 connection
        from app.services.web3_service import Web3Service
        web3_service = Web3Service()
        latest_block = web3_service.w3.eth.block_number
        web3_status = f"healthy (block: {latest_block})"
    except Exception as e:
        web3_status = f"unhealthy: {str(e)}"
    
    return {
        "status": "healthy",
        "timestamp": int(time.time()),
        "services": {
            "database": db_status,
            "redis": redis_status,
            "web3": web3_status
        },
        "environment": settings.ENVIRONMENT,
        "version": "1.0.0"
    }

@app.get("/")
async def root():
    """API root endpoint"""
    return {
        "message": "PayShield Protocol API",
        "version": "1.0.0",
        "docs": "/docs" if settings.ENVIRONMENT != "production" else "Contact admin for API documentation",
        "health": "/health"
    }

# Error handlers
@app.exception_handler(404)
async def not_found_handler(request, exc):
    return {
        "error": "Not Found",
        "message": "The requested resource was not found",
        "status_code": 404
    }

@app.exception_handler(500)
async def internal_error_handler(request, exc):
    logger.error(f"Internal server error: {exc}")
    return {
        "error": "Internal Server Error",
        "message": "An internal server error occurred",
        "status_code": 500
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.ENVIRONMENT == "development",
        log_level="info"
    )