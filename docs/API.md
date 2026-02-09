# API v1 Contract

Base path: `/api/v1`

## Endpoints

- `GET /dashboard/summary`
- `GET /dashboard/returns-curve`
- `GET/POST/PATCH /accounts`
- `GET/POST/PATCH /instruments`
- `GET/POST/PATCH/DELETE /allocation/nodes`
- `GET/POST/PATCH/DELETE /allocation/categories`
- `GET/POST /transactions`
- `PATCH/DELETE /transactions/{transaction_id}`
- `POST /transactions/{transaction_id}/reverse`
- `POST /transactions/import-csv`
- `GET /holdings`
- `GET /rebalance/drift`
- `POST /quotes/refresh`
- `GET/POST /quotes/manual-overrides`

Refer to OpenAPI docs at `/api/docs` for request/response schema details.
