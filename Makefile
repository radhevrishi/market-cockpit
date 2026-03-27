.PHONY: help up down logs migrate shell-api shell-db test-backend lint-frontend

help:
	@echo "Market Cockpit — Developer Commands"
	@echo ""
	@echo "  make up            Start all services (Docker)"
	@echo "  make down          Stop all services"
	@echo "  make logs          Tail all logs"
	@echo "  make migrate       Run DB migrations"
	@echo "  make shell-api     Open shell in API container"
	@echo "  make shell-db      Open psql in DB container"
	@echo "  make test-backend  Run backend tests"
	@echo "  make lint-frontend Run Next.js linter"
	@echo "  make ingest-now    Trigger manual news ingestion"

up:
	docker-compose up -d
	@echo "→ Frontend: http://localhost:3000"
	@echo "→ API docs: http://localhost:8000/docs"

down:
	docker-compose down

logs:
	docker-compose logs -f

migrate:
	docker-compose exec api alembic upgrade head

shell-api:
	docker-compose exec api /bin/bash

shell-db:
	docker-compose exec db psql -U mcuser -d market_cockpit

test-backend:
	cd backend && python -m pytest tests/ -v

lint-frontend:
	cd frontend && npm run lint

ingest-now:
	docker-compose exec worker celery -A app.workers.celery_app call app.workers.ingestion_tasks.ingest_news_sources

reset-db:
	docker-compose down -v
	docker-compose up -d db redis
	sleep 3
	docker-compose exec api alembic upgrade head
	@echo "Database reset complete"
