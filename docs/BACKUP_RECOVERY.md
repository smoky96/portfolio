# Backup and Recovery

## Backup Policy

- Backup format: `pg_dump -Fc` (custom format)
- Backup interval: every `BACKUP_INTERVAL_SECONDS` (default 24h)
- Encryption: `openssl aes-256-cbc` when `BACKUP_ENCRYPTION_KEY` is set
- Upload target: `s3://$S3_BUCKET/$S3_PREFIX/`
- Retention baseline: 30 days
- Object storage lifecycle recommendation:
  - Day 0-30: Standard
  - Day 31-90: Infrequent Access
  - Day 91+: Glacier/Archive

## Manual Backup Command

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml exec -T \
  -e RUN_ONCE=true backup /opt/backup/backup.sh
```

## Manual Restore Command

Restore latest available backup:

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml exec -T backup /opt/backup/restore.sh
```

Restore specific object key:

```bash
ENV_FILE=.env.prod docker compose -f docker-compose.prod.yml exec -T \
  -e RESTORE_S3_KEY=portfolio/portfolio_YYYYMMDD_HHMMSS.dump.enc \
  backup /opt/backup/restore.sh
```

## Recovery Drill Record

- Drill date: `2026-02-16`
- Scope: full logical restore from encrypted/custom backup into active database
- Outcome: success
- Measured backup duration: `0.290s` (local compose drill)
- Measured RTO: `0.425s` (local compose drill, single-node)
- Measured RPO: `~0` (restored from latest backup point)
- Notes:
  - Validate application `/health` and dashboard API after restore.
  - Keep a signed drill log for each monthly test.
