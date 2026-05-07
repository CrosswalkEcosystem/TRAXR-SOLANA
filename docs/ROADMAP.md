# TRAXR-SOLANA Roadmap (Alpha)

This roadmap is intentionally minimal. Each phase builds on a verified data
substrate before adding higher-order logic.

## Phase 1 - Indexing & Normalization (Current)
- NodeZero ingestion (Solana)
- Normalized pool metadata and liquidity/volume
- Deterministic stamped snapshots and local cache
- Fetch-time local enrichment for exact AMM/CPMM impact
- Fetch-time Orca Whirlpool and Meteora DLMM quote enrichment
- Meteora mint metadata / logo enrichment

## Phase 2 - On-Chain Resolution
- Pool program verification
- Fee tier metadata validation
- Protocol-specific adapters (DEX by DEX)
- Production-ready CLMM exact quote support

## Phase 3 - Scoring Engine Expansion
- Embedded CTS aligned with enriched snapshot fields
- Pool-type-aware fee competitiveness
- Clear confidence modeling and warnings
- No contamination of raw indexed data

## Phase 4 - Cross-Chain Aggregation
- Extend normalized model across chains
- Unified scoring pipeline with per-chain adapters

## Out of Scope
- Trading features
- Portfolio tracking
- Custody or transaction signing
- Full ecosystem coverage
