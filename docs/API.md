# API v1 Contract

Base path: `/api/v1`

## Authentication

- Browser auth uses secure cookie session.
- `POST /auth/login`: verify credentials, set auth cookie, return session payload.
- `POST /auth/logout`: clear auth cookie.
- `GET /auth/me`: get current user from auth cookie.
- `POST /auth/register`: only available when `ALLOW_SELF_REGISTRATION=true`.

## Admin

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/{user_id}`
- `GET /admin/invite-codes`
- `POST /admin/invite-codes`
- `PATCH /admin/invite-codes/{invite_id}`

## Accounts

- `GET /accounts`
- `POST /accounts`
- `PATCH /accounts/{account_id}`

## Instruments

- `GET /instruments`
- `POST /instruments`
- `PATCH /instruments/{instrument_id}`

## Allocation

- `GET /allocation/nodes`
- `POST /allocation/nodes`
- `PATCH /allocation/nodes/{node_id}`
- `PATCH /allocation/nodes/weights/batch`
- `DELETE /allocation/nodes/{node_id}`
- `GET /allocation/tag-groups`
- `POST /allocation/tag-groups`
- `PATCH /allocation/tag-groups/{group_id}`
- `DELETE /allocation/tag-groups/{group_id}`
- `GET /allocation/tags`
- `POST /allocation/tags`
- `PATCH /allocation/tags/{tag_id}`
- `DELETE /allocation/tags/{tag_id}`
- `GET /allocation/instrument-tags`
- `PUT /allocation/instrument-tags`
- `DELETE /allocation/instrument-tags/{instrument_id}/{group_id}`
- `GET /allocation/account-tags`
- `PUT /allocation/account-tags`
- `DELETE /allocation/account-tags/{account_id}/{group_id}`

## Transactions

- `GET /transactions`
- `POST /transactions`
- `PATCH /transactions/{transaction_id}`
- `DELETE /transactions/{transaction_id}`
- `POST /transactions/{transaction_id}/reverse`
- `POST /transactions/import-csv`

## Portfolio Views

- `GET /holdings`
- `GET /dashboard/summary`
- `GET /dashboard/returns-curve`
- `GET /rebalance/drift`

## Quotes

- `POST /quotes/refresh`
- `GET /quotes/lookup`
- `GET /quotes/latest`
- `GET /quotes/manual-overrides`
- `POST /quotes/manual-overrides`

## Pagination Convention (Reserved)

For list endpoints that opt in to pagination in follow-up phases, use:
- Query params: `page`, `page_size`
- Response payload: `{ "page": number, "page_size": number, "total": number, "items": [...] }`

Refer to OpenAPI docs at `/api/docs` when `EXPOSE_API_DOCS=true`.
