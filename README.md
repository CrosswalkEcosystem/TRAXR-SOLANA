# TRAXR-SOLANA (Alpha)
### Pool Risk Intelligence

![Status](https://img.shields.io/badge/status-alpha-blue)
![Network](https://img.shields.io/badge/network-Solana-black)
![License](https://img.shields.io/badge/license-Proprietary-red)

TRAXR-SOLANA is a foundational indexing and normalization layer for the Solana
DeFi ecosystem. The current deployment establishes a clean, verifiable data
substrate; CTS scoring runs in-app using pool-only signals and enriched
snapshot data.

This is not a full product rewrite. It is a minimal infrastructure experiment
focused on correctness, clarity, and determinism.

Indexing never guesses. Scoring never rewrites facts.

## Documentation
- [ROADMAP](docs/ROADMAP.md)
- [ARCHITECTURE](docs/ARCHITECTURE.md)

## Quickstart
```
npm install
npm run dev
# http://localhost:3000
```

## Environment Configuration
### Core flags
- `NEXT_PUBLIC_TRAXR_ENABLED=true|false` - toggle TRAXR-SOLANA UI.
- `TRAXR_FALLBACK_SAMPLE=true` - load embedded sample pools.
- `TRAXR_LOCAL_POOLS_PATH` - path to Solana pool JSON (default: newest `data/solanaPools_*.json`, fallback `data/solanaPools.json`).

## Layered Architecture
### Layer 1 - Indexed Market & Protocol Data (Live, Verifiable)
- Ingests Solana pool datasets from NodeZero
- Covers AMM, CLMM, CPMM, Orca Whirlpool, Meteora DLMM, and other tracked pools
- Normalizes pool identifiers, token metadata, liquidity and volume
- Source-backed and reproducible

### Layer 2 - Derived Heuristics (Computed, Best-Effort)
- Liquidity depth, $1,000 quote-based price impact, and freshness/status context
- Marked as derived, never treated as protocol guarantees

### Layer 3 - Risk & Structural Signals (CTS)
- Activity, stability, trust, fee, impact
- Computed by embedded CTS scoring logic

## Snapshot Model
The app operates on stamped JSON snapshots in `data/`. The UI loads the newest
snapshot per dataset and derives trend history from the retained snapshot set.

## Data Source (NodeZero)
TRAXR-SOLANA fetches pool datasets only from NodeZero:
- Base URL: `https://nodezero.crosswalk.pro/data/traxr/solana/`
- Header: `X-API-Key: $NODEZERO_API_KEY`

During `fetch:solana`, TRAXR-SOLANA also applies local enrichments before
writing the final stamped snapshots:
- AMM / CPMM: exact constant-product `$1,000` price impact from snapshot reserves
- Orca: exact `$1,000` Whirlpool quote via `rpc-internal`
- Meteora DLMM: exact `$1,000` DLMM quote via `rpc-internal`
- Meteora DLMM: token metadata and logo enrichment by mint
- CTS scoring, stability/volatility derivation, and warnings inputs

Run:
```
npm run fetch:solana
```
Optional:
- `NODEZERO_API_KEY` - required API key for NodeZero.
- `NODEZERO_RPC_KEY` - required key for Orca / Meteora quote enrichment
- `NODEZERO_RPC_URL` - override RPC endpoint (default: `https://nodezero.crosswalk.pro/rpc-internal`)

## CTS Scoring Boundary
The publishable repository keeps the CTS model implementation outside source
control. Local/private deployments can provide
`src/lib/scoringAdapter.private.ts`, which is gitignored and loaded at runtime.

Without that private module, the public build does not expose the CTS formula.
If upstream data already contains precomputed CTS outputs, the app can still
display those values without shipping the model logic itself.

Private deployments may still use behavior such as:
- Price Impact uses a fixed simulated `$1,000` swap basis
- Fee competitiveness uses pool-type-aware baselines
- Meteora DLMM fee uses `base_fee_percentage`, not dynamic max fee
- Stability is derived from retained snapshot history where enough price points exist

## API (read-only)
Fuzzy matching works on mintA/mintB, token names, symbols, and addresses.

Example:
```
GET http://localhost:3000/api/traxr/score?mintA=SOL&mintB=USDC
```

Response includes:
- pool ID
- TRAXR score (0-100) and CTS nodes (1-6)
- dimensional breakdown and warnings
- normalized metrics used for computation

Additional endpoints:
- `GET /api/traxr/pools`
- `GET /api/traxr/pools/:id`
- `GET /api/traxr/pool-trend?poolId=...`
- `GET /api/traxr/alerts`

## Status
TRAXR-SOLANA is in alpha. Current exact price impact coverage is:
- AMM
- CPMM
- Orca Whirlpool
- Meteora DLMM

CLMM exact price impact is still under active investigation and is not yet
treated as production-ready.

## License
UNLICENSED - proprietary module.
