# TRAXR-SOLANA API Reference

Base path: `/api/traxr/*`

All endpoints are read-only and return JSON.

## `GET /api/traxr/score`
Fetch score and node breakdown for a token pair.

Query params:
- `mintA` (required)
- `mintB` (required)
- `dataset` (optional)

Example:
```http
GET /api/traxr/score?mintA=SOL&mintB=USDC
```

Success response includes:
- `poolId`
- `score` (`0-100`)
- `ctsNodes` (`0-6`)
- `nodes` (`depth`, `activity`, `impact`, `stability`, `trust`, `fee`)
- `warnings`
- `metrics`

## `GET /api/traxr/pools`
List pools with optional pagination metadata.

Query params:
- `limit` (optional integer)
- `offset` (optional integer)
- `page` (optional integer; used with `limit`)
- `meta=true|false` (optional, default `false`)

Notes:
- `limit=all` returns `400`.

## `GET /api/traxr/pools/:id`
Fetch one pool by ID.

Query params:
- `dataset` (optional)

## `GET /api/traxr/dataset`
Fetch a dataset page.

Query params:
- `name` (required dataset name)
- `limit` (optional)
- `offset` (optional)
- `summary=true|false` (optional)

## `GET /api/traxr/dataset-summary`
Fetch computed summary for a dataset.

Query params:
- `name` (required dataset name)

## `GET /api/traxr/search`
Search pools by token symbols, names, mints, and pool metadata.

Query params:
- `q` (required non-empty string)
- `limit` (optional, default `50`)
- `dataset` (optional)

## `GET /api/traxr/pool-trend`
Fetch historical trend points for a pool.

Query params:
- `poolId` (required)
- `dataset` (optional)

## `GET /api/traxr/alerts`
List pools with active warnings.

Response includes:
- `count`
- `alerts[]` with `poolId`, `score`, `ctsNodes`, warnings, token labels, `updatedAt`

## Error Contract
Common errors:
- `400` for missing required query params or invalid pagination values.
- `404` when resource/pool lookup fails.
- `500` for unexpected internal errors.

Typical error payload:
```json
{ "error": "message" }
```

## Caching
Some dataset-oriented endpoints use cache headers for short-lived public caching.
Consumers should tolerate frequent refresh behavior.

## Security and Scope Notes
- API is read-only.
- No signing, wallet access, or transaction execution.
- Proprietary CTS formula is not exposed by this repository.
