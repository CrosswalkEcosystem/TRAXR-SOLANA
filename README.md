# TRAXR-SOLANA
### Solana Pool Risk Intelligence (Hackathon Build)

![Status](https://img.shields.io/badge/status-hackathon-blue)
![Network](https://img.shields.io/badge/network-Solana-black)
![License](https://img.shields.io/badge/license-Proprietary-red)

TRAXR-SOLANA is a read-only analytics system for Solana liquidity pools. It ingests
source-backed pool data, normalizes it into a stable schema, derives structural
risk signals, and serves those results through a web UI and API.

The project is optimized for clarity and reproducibility:
- Indexing never guesses.
- Derived signals are labeled as heuristics.
- Raw source-backed fields are never rewritten.

## Documentation
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [API Reference](docs/API.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)

## Quickstart
```bash
nvm use
npm install
npm run dev
# http://localhost:3000
```

Environment setup:
```bash
cp .env.example .env.local
```

## What This Repository Includes
- Next.js app and API endpoints under `src/app/api/traxr/*`
- Data normalization and trend logic under `src/lib/*`
- Fetch and enrichment scripts under `scripts/*`
- UI components for score breakdowns, warnings, and trend views

## Scope Boundary: Internal Indexing vs Public App Repo
TRAXR-SOLANA consumes snapshot datasets, but the production indexing pipeline and
snapshot storage infrastructure are internal and out of scope for this repository.

- In production, indexing/storage run on Crosswalk-managed infrastructure.
- This repository contains the app/API layer and snapshot consumption logic.
- Local `data/` paths in code are runtime integration points, not a committed data lake.
- Public contributors should treat `data/` as environment-specific runtime input.

## CTS Scoring Privacy Boundary
The CTS model implementation is intentionally kept private and out of source control.

- Private deployments can provide `src/lib/scoringAdapter.private.ts`.
- That file is gitignored and loaded dynamically at runtime.
- Public/publishable builds do not expose the proprietary CTS formula.

If upstream snapshots already include precomputed CTS fields, TRAXR can display those
values without shipping the private model logic.

## Data Pipeline
TRAXR ingests Solana pool datasets from NodeZero and then performs local enrichment:
- AMM/CPMM exact constant-product `$1,000` impact estimation
- Orca Whirlpool quote-based impact enrichment
- Meteora DLMM quote-based impact enrichment
- Metadata/logo enrichment for supported pools

Default source:
- Base URL: `https://nodezero.crosswalk.pro/data/traxr/solana/`
- Header: `X-API-Key: $NODEZERO_API_KEY`

Snapshot retention, archival strategy, and production indexing orchestration are
managed internally and are not part of this open repository's scope.

## Environment Variables
Core:
- `NEXT_PUBLIC_TRAXR_ENABLED=true|false`
- `TRAXR_USE_SQLITE=true|false`
- `TRAXR_FALLBACK_SAMPLE=true|false`

Data/runtime:
- `TRAXR_LOCAL_DATA_DIR` (default `data/`)
- `TRAXR_LOCAL_POOLS_PATH` (optional direct snapshot path)
- `TRAXR_API_LIMIT` and `TRAXR_API_MAX_LIMIT`

Enrichment:
- `NODEZERO_API_KEY`
- `NODEZERO_RPC_KEY`
- `NODEZERO_RPC_URL` (default `https://nodezero.crosswalk.pro/rpc-internal`)

## API Overview (Read-Only)
Example:
```http
GET /api/traxr/score?mintA=SOL&mintB=USDC
```

Main endpoints:
- `GET /api/traxr/score`
- `GET /api/traxr/pools`
- `GET /api/traxr/pools/:id`
- `GET /api/traxr/pool-trend?poolId=...`
- `GET /api/traxr/alerts`

Typical response fields:
- Pool identity (`poolId`, token symbols/mints)
- `score` (`0-100`) and `ctsNodes` (`0-6`)
- Node breakdown (`depth`, `activity`, `impact`, `stability`, `trust`, `fee`)
- Warning list and normalized metrics payload

## Hackathon Notes
- This repo is intentionally read-only analytics: no wallets, no signing, no custody.
- Exact CLMM impact is still maturing and should be treated as experimental.
- Some scripts assume access to internal NodeZero services and keys.

## Public Release Checklist
- Ensure `src/lib/scoringAdapter.private.ts` is not present/tracked.
- Confirm no local snapshots/databases are tracked in git.
- Run `npm run build`.
- Verify docs match current runtime behavior and scope boundaries.

## License
UNLICENSED - Proprietary. See [LICENSE](LICENSE).
