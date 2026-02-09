.PHONY: test-backend coverage-backend acceptance-smoke frontend-build e2e-smoke e2e-allocation e2e-holdings e2e-transactions e2e-regression e2e-smoke-mobile

test-backend:
	docker compose exec -T backend sh -lc 'cd /app && PYTHONPATH=/app pytest -q'

coverage-backend:
	docker compose exec -T backend sh -lc 'cd /app && PYTHONPATH=/app pytest'

acceptance-smoke:
	./scripts/acceptance_smoke.sh

frontend-build:
	docker compose exec -T frontend sh -lc 'cd /app && npm run build'

e2e-smoke:
	docker compose exec -T frontend sh -lc 'cd /app && PLAYWRIGHT_BASE_URL=http://nginx PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:smoke'

e2e-allocation:
	docker compose exec -T frontend sh -lc 'cd /app && PLAYWRIGHT_BASE_URL=http://nginx PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:allocation'

e2e-holdings:
	docker compose exec -T frontend sh -lc 'cd /app && PLAYWRIGHT_BASE_URL=http://nginx PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:holdings'

e2e-transactions:
	docker compose exec -T frontend sh -lc 'cd /app && PLAYWRIGHT_BASE_URL=http://nginx PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:transactions'

e2e-regression:
	docker compose exec -T frontend sh -lc 'cd /app && PLAYWRIGHT_BASE_URL=http://nginx PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:regression'

e2e-smoke-mobile:
	docker compose exec -T frontend sh -lc 'cd /app && PLAYWRIGHT_BASE_URL=http://nginx PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:mobile'
