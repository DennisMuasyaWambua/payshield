# PayShield Protocol Makefile

.PHONY: help install build test deploy clean

# Default target
help: ## Show this help message
	@echo "PayShield Protocol - Available Commands:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# Installation
install: ## Install all dependencies
	@echo "🔧 Installing dependencies..."
	npm install
	cd backend && pip install -r requirements.txt
	cd frontend && npm install

install-dev: ## Install development dependencies
	@echo "🔧 Installing development dependencies..."
	npm install
	cd backend && pip install -r requirements.txt && pip install pytest pytest-asyncio pytest-cov black flake8 mypy
	cd frontend && npm install

# Building
compile: ## Compile smart contracts
	@echo "🔨 Compiling smart contracts..."
	npx hardhat compile

build: ## Build all components
	@echo "🏗️ Building all components..."
	npx hardhat compile
	cd backend && python -m pytest --version > /dev/null 2>&1 || echo "Backend ready"
	cd frontend && npm run build

# Testing
test: ## Run all tests
	@echo "🧪 Running all tests..."
	npx hardhat test
	cd backend && python -m pytest tests/ -v
	cd frontend && npm test

test-contracts: ## Run smart contract tests
	@echo "🧪 Running contract tests..."
	npx hardhat test

test-backend: ## Run backend tests
	@echo "🧪 Running backend tests..."
	cd backend && python -m pytest tests/ -v

test-frontend: ## Run frontend tests
	@echo "🧪 Running frontend tests..."
	cd frontend && npm test

test-coverage: ## Run tests with coverage
	@echo "🧪 Running tests with coverage..."
	npx hardhat coverage
	cd backend && python -m pytest tests/ --cov=app --cov-report=html

# Development
dev: ## Start development environment
	@echo "🚀 Starting development environment..."
	docker-compose -f docker-compose.dev.yml up --build

dev-contracts: ## Deploy contracts to local network
	@echo "📝 Deploying contracts to local network..."
	npx hardhat run scripts/deploy.ts --network localhost

dev-backend: ## Start backend development server
	@echo "🚀 Starting backend development server..."
	cd backend && uvicorn app.main:app --reload

dev-frontend: ## Start frontend development server
	@echo "🚀 Starting frontend development server..."
	cd frontend && npm run dev

# Deployment
deploy-testnet: ## Deploy to Base Sepolia testnet
	@echo "🚀 Deploying to Base Sepolia testnet..."
	npx hardhat run scripts/deploy.ts --network base-sepolia

deploy-mainnet: ## Deploy to Base mainnet
	@echo "🚀 Deploying to Base mainnet..."
	npx hardhat run scripts/deploy.ts --network base

verify-contracts: ## Verify contracts on BaseScan
	@echo "✅ Verifying contracts..."
	npx hardhat verify --network base-sepolia $(CONTRACT_ADDRESS)

# Production
prod-build: ## Build production containers
	@echo "🏗️ Building production containers..."
	docker-compose build

prod-up: ## Start production environment
	@echo "🚀 Starting production environment..."
	docker-compose up -d

prod-down: ## Stop production environment
	@echo "🛑 Stopping production environment..."
	docker-compose down

prod-logs: ## View production logs
	@echo "📋 Viewing production logs..."
	docker-compose logs -f

# Database
db-migrate: ## Run database migrations
	@echo "📊 Running database migrations..."
	cd backend && alembic upgrade head

db-reset: ## Reset database
	@echo "📊 Resetting database..."
	cd backend && alembic downgrade base && alembic upgrade head

# Code Quality
lint: ## Run linters
	@echo "🔍 Running linters..."
	npx hardhat compile
	cd backend && black --check . && flake8 . && mypy .
	cd frontend && npm run lint

format: ## Format code
	@echo "🎨 Formatting code..."
	cd backend && black .
	cd frontend && npm run lint:fix

# Security
security-check: ## Run security checks
	@echo "🔒 Running security checks..."
	npm audit
	cd backend && pip-audit
	cd frontend && npm audit

# Documentation
docs: ## Generate documentation
	@echo "📚 Generating documentation..."
	npx hardhat docgen

# Monitoring
logs: ## View application logs
	@echo "📋 Viewing application logs..."
	docker-compose logs -f backend frontend

monitor: ## Open monitoring dashboard
	@echo "📊 Opening monitoring dashboard..."
	open http://localhost:3001

# Backup
backup-db: ## Backup database
	@echo "💾 Backing up database..."
	docker-compose exec postgres pg_dump -U payshield_user payshield > backup_$(shell date +%Y%m%d_%H%M%S).sql

restore-db: ## Restore database from backup
	@echo "📥 Restoring database..."
	@read -p "Enter backup file path: " backup_file; \
	docker-compose exec -T postgres psql -U payshield_user payshield < $$backup_file

# Cleanup
clean: ## Clean build artifacts
	@echo "🧹 Cleaning build artifacts..."
	rm -rf artifacts cache typechain-types
	cd backend && find . -type d -name __pycache__ -delete
	cd frontend && rm -rf .next out

clean-docker: ## Clean Docker containers and images
	@echo "🧹 Cleaning Docker containers and images..."
	docker-compose down --rmi all --volumes --remove-orphans
	docker system prune -f

# Setup
setup-env: ## Setup environment files
	@echo "⚙️ Setting up environment files..."
	cp .env.example .env
	cp backend/.env.example backend/.env
	cp frontend/.env.example frontend/.env.local
	@echo "Please edit the .env files with your configuration"

init: ## Initialize project for first time use
	@echo "🎯 Initializing PayShield Protocol..."
	$(MAKE) setup-env
	$(MAKE) install
	$(MAKE) compile
	@echo "✅ Initialization complete!"
	@echo "Next steps:"
	@echo "1. Edit .env files with your configuration"
	@echo "2. Run 'make dev' to start development environment"
	@echo "3. Run 'make deploy-testnet' to deploy contracts"

# CI/CD
ci-test: ## Run CI tests
	@echo "🤖 Running CI tests..."
	$(MAKE) compile
	$(MAKE) test
	$(MAKE) lint
	$(MAKE) security-check

# Health checks
health: ## Check system health
	@echo "🏥 Checking system health..."
	curl -f http://localhost:8000/health || echo "Backend unhealthy"
	curl -f http://localhost:3000 || echo "Frontend unhealthy"
	docker-compose ps