# TRAXR-SOLANA Architecture (Alpha)

TRAXR-SOLANA is a read-only indexing and normalization layer for Solana DeFi data.
Scoring and risk interpretation are intentionally decoupled and mirror the
CTS logic used by `crosswalk-dex-backend`.

Indexing never guesses. Scoring never rewrites facts.

## Layered System
### Layer 1 - Indexed Market & Protocol Data (Live, Verifiable)
- Source: NodeZero Solana pool datasets
- Outputs: pool identifiers, token metadata, liquidity, volume, and program attribution
- Source-backed, reproducible, and high-confidence

### Layer 2 - Derived Heuristics (Computed, Best-Effort)
- Liquidity depth
- Fixed-size ($1,000) price impact
- Data freshness
- Marked as derived and non-authoritative

### Layer 3 - Risk & Structural Signals (Decoupled)
- Activity, trust, stability, and fee posture
- Derived by pool-only CTS scoring

## Core Pipeline
1. **Data Ingestion**
   - Snapshot-based ingestion from NodeZero
   - Solana pools only
   - Datasets: AMM, CLMM, CPMM, Orca Whirlpool, Meteora DLMM, and other tracked pools

2. **Normalization**
   - Deterministic mapping into Solana pool metrics
   - Stable identifiers and field naming
   - Pool-type-aware fee interpretation

3. **Scoring (Embedded)**
   - Mirrors the pool-only CTS logic used by `crosswalk-dex-backend`
   - Pure, deterministic pool-only CTS logic

4. **Snapshot Enrichment**
   - AMM / CPMM: exact constant-product `$1,000` impact from local reserves
   - Orca: exact Whirlpool `$1,000` quote via `rpc-internal`
   - Meteora: exact DLMM `$1,000` quote via `rpc-internal`
   - Meteora: mint metadata / logo enrichment

5. **Presentation**
   - Next.js UI for CTS nodes, breakdowns, warnings
   - Read-only API under `/api/traxr/*`

## Transparency Rules
- Unknown values are intentional and explicit
- Derived metrics are labeled as heuristic
- Source-backed values are never overwritten

## Alpha Constraints
- CLMM exact price impact is not yet production-ready
- No trading or portfolio features
- No signing or custody
- Historical exact Orca / Meteora depth cannot be reconstructed retroactively

## Future (Optional)
- On-chain pool address resolution
- Protocol-specific contract decoding
- Snapshot trend history
- Cross-chain aggregation
