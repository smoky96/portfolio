# Deployment Guide

## 1. Configure env

```bash
cp .env.example .env
```

## 2. Start stack

```bash
docker compose up --build -d
```

## 3. Verify

```bash
docker compose ps
curl -I http://localhost:8080/health
```

## 4. Data backup

- Backup container runs `pg_dump` once every 24 hours by default.
- SQL backups are stored in docker volume `backups`.
- Retention defaults to 7 days.

## 5. Credentials

- Basic Auth user: `admin`
- Basic Auth password: `admin123`
- Change credentials by updating `/infrastructure/nginx/.htpasswd`.
