COMPOSE = docker compose -f infra/docker-compose.yml

.PHONY: help up down build logs ps restart prod-up proxy-up monitor-up

help:
	@echo "Common targets:"
	@echo "  make up          # Start services (detached)"
	@echo "  make down        # Stop and remove services"
	@echo "  make build       # Build images"
	@echo "  make logs        # Tail logs"
	@echo "  make ps          # List services"
	@echo "  make restart     # Restart services"
	@echo "  make prod-up     # Start with production profile"
	@echo "  make proxy-up    # Start reverse proxy profile"
	@echo "  make monitor-up  # Start watchtower monitoring"

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

restart:
	$(COMPOSE) restart

prod-up:
	$(COMPOSE) --profile production up -d

proxy-up:
	$(COMPOSE) --profile proxy up -d

monitor-up:
	$(COMPOSE) --profile monitoring up -d
