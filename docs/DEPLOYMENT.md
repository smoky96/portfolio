# Deployment Guide

## 1. Prepare Production Environment

```bash
cp .env.prod.example .env.prod
```

Required updates before deployment:
- `APP_ENV=prod`
- set strong `JWT_SECRET_KEY`
- set strong `BOOTSTRAP_ADMIN_PASSWORD`
- set non-default `BOOTSTRAP_ADMIN_INVITE_CODE`
- set managed PostgreSQL `DATABASE_URL`
- set `ALLOW_SELF_REGISTRATION=false`
- set `EXPOSE_API_DOCS=false`
- set cookie/cors settings for your domain
- set backup object storage + encryption settings

## 2. Deploy Services

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml up -d --build
```

## 3. Initialize Admin Account (One-Time)

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml exec -T backend python -m app.scripts.bootstrap_admin
```

## 4. Verify

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml ps
curl -I http://localhost:8080/health
```

Expected:
- `/health` returns `200`
- `/api/docs` is unavailable in production
- login succeeds with bootstrap admin credentials

## 5. Backup and Restore

Backup worker:
- runs `pg_dump -Fc` on schedule
- encrypts output when `BACKUP_ENCRYPTION_KEY` is set
- uploads to object storage when `S3_BUCKET` is set

Run a manual restore:

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml exec -T backup /opt/backup/restore.sh
```

Restore specific object key:

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml exec -T \
  -e RESTORE_S3_KEY=portfolio/portfolio_20260101_010101.dump.enc \
  backup /opt/backup/restore.sh
```

## 6. Release Window (30 minutes)

1. Take pre-release backup snapshot.
2. Deploy with `ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml up -d --build`.
3. Run health + smoke checks.
4. Force user re-login (cookie session migration).
5. If smoke fails, roll back to previous image tag/config and restore snapshot if needed.

## 7. Rollback

1. Re-apply previous compose image tags and env file.
2. Restart stack:

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml up -d
```

3. If data corruption is detected:
- run restore with target backup
- re-run smoke checks
