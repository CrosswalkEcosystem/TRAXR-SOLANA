# TRAXR-SOLANA Architecture

TRAXR-SOLANA is a read-only analytics architecture for Solana pool intelligence.
It separates source-backed facts, computed heuristics, and risk interpretation so each
layer can be reasoned about independently.

## Design Principles
- Deterministic transforms over opaque mutation
- Explicit unknowns instead of guessed values
- Reproducible snapshots and stable identifiers
- Clear separation between public code and private scoring logic

## Repository Scope Boundary
This repository is the application and analytics layer, not the full production
indexing platform.

- Production indexing and snapshot storage run on internal Crosswalk infrastructure.
- Internal orchestration, retention policy, and infra operations are out of scope here.
- `data/` references in code represent runtime inputs for local/dev integration.

## System Layers
### Layer 1: Indexed Protocol Data (Authoritative Inputs)
- Source: NodeZero Solana datasets
- Coverage: AMM, CLMM, CPMM, Orca Whirlpool, Meteora DLMM, and other tagged pools
- Output: normalized identity, token metadata, liquidity, volume, and protocol context

### Layer 2: Derived Heuristics (Computed Context)
- Fixed-basis execution impact estimates
- Volatility and freshness signals
- Fee-context normalization by pool type/protocol
- All derived values are explicitly treated as non-authoritative

### Layer 3: Risk Signals (Presentation Layer)
- Composite score and node-level dimensions (`depth`, `activity`, `impact`, `stability`, `trust`, `fee`)
- Warning generation and trend views
- Read-only API responses for UI and external consumers

## CTS Model Privacy Boundary
The proprietary CTS scoring adapter is intentionally excluded from tracked source.

- Runtime optionally loads `src/lib/scoringAdapter.private.ts` when present.
- Public repository builds run without disclosing CTS formula internals.
- Precomputed score fields can still be surfaced when provided by upstream data.

This boundary is a core architectural choice, not a temporary workaround.

## Data Flow
1. Ingestion
   Pull snapshot datasets from NodeZero and local stores.
2. Normalization
   Convert heterogeneous pool payloads into a single metric contract.
3. Enrichment
   Apply deterministic enrichments such as quote-based impact and metadata fill.
4. Scoring
   Use private adapter when available, otherwise safe public fallback behavior.
5. Serving
   Expose read-only endpoints under `/api/traxr/*` and render dashboard views.

## Operational Constraints
- No transaction signing, wallet access, or custody flows
- No trading execution features
- CLMM exact impact remains an evolving area
- Historical exact quotes depend on snapshot availability

## Reliability Notes
- Cached refresh behavior is bounded and time-based
- API responses are constrained by configurable limits
- Unknown or missing fields are surfaced explicitly, not hidden
