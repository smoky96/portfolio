# Production Hardening Checklist (P0/P1)

## PR-1: Auth and Secrets
- [ ] `APP_ENV=prod` startup rejects default weak values.
- [ ] Login sets HttpOnly auth cookie.
- [ ] Logout clears auth cookie.
- [ ] `/auth/register` is disabled in production.
- [ ] Frontend does not store auth token in localStorage.

## PR-2: Gateway and Runtime Hardening
- [ ] Nginx login endpoint rate limiting enabled.
- [ ] Security response headers are enabled.
- [ ] CORS uses explicit allowlist, not wildcard.
- [ ] API docs are hidden in production.
- [ ] Backend and frontend images run with hardened multi-stage Dockerfiles.

## PR-3: Backup and CI Gates
- [ ] Production compose uses managed PostgreSQL.
- [ ] Backups are encrypted before upload.
- [ ] Restore script supports point-in-time backup selection.
- [ ] Backend CI runs lint + dependency audit + tests.
- [ ] Frontend CI runs dependency audit + build + smoke E2E.

## PR-4: Docs and Release
- [ ] README updated with secure bootstrap flow.
- [ ] Deployment guide includes production env and rollback.
- [ ] API doc reflects current endpoints and cookie auth.
- [ ] Backup/restore drill record includes RTO and RPO.
