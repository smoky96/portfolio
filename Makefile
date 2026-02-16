.PHONY: test-backend coverage-backend acceptance-smoke predeploy-backup frontend-build e2e-smoke e2e-allocation e2e-holdings e2e-transactions e2e-regression e2e-smoke-mobile

test-backend:
	docker run --rm -v $(PWD)/backend:/app -w /app python:3.12-slim bash -lc 'python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -q -r requirements.txt && PYTHONPATH=/app pytest -q'

coverage-backend:
	docker run --rm -v $(PWD)/backend:/app -w /app python:3.12-slim bash -lc 'python -m venv /tmp/venv && . /tmp/venv/bin/activate && pip install -q -r requirements.txt && PYTHONPATH=/app pytest'

acceptance-smoke:
	./scripts/acceptance_smoke.sh

predeploy-backup:
	./scripts/predeploy_backup.sh

frontend-build:
	cd frontend && npm ci && npm run build

e2e-smoke:
	cd frontend && PLAYWRIGHT_BASE_URL=http://localhost:8080 PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:smoke

e2e-allocation:
	cd frontend && PLAYWRIGHT_BASE_URL=http://localhost:8080 PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:allocation

e2e-holdings:
	cd frontend && PLAYWRIGHT_BASE_URL=http://localhost:8080 PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:holdings

e2e-transactions:
	cd frontend && PLAYWRIGHT_BASE_URL=http://localhost:8080 PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:transactions

e2e-regression:
	cd frontend && PLAYWRIGHT_BASE_URL=http://localhost:8080 PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:regression

e2e-smoke-mobile:
	cd frontend && PLAYWRIGHT_BASE_URL=http://localhost:8080 PLAYWRIGHT_AUTH_USER=admin PLAYWRIGHT_AUTH_PASS=admin123 npm run test:e2e:mobile
