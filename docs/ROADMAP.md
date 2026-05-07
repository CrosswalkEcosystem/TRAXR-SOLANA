# TRAXR-SOLANA Roadmap

This roadmap is scoped for hackathon execution and near-term product hardening.
It prioritizes data reliability first, then model depth, then expansion.

## Phase 1: Stable Foundation (Complete / In Progress)
- Deterministic Solana pool ingestion and normalization
- Snapshot retention and trend-compatible dataset structure
- Read-only API surface for score and pool exploration
- Baseline UI for score cards, node breakdowns, and warnings

## Phase 2: Data Quality and Coverage (Current Focus)
- Improve protocol-specific adapters and field completeness
- Expand exact quote enrichment where possible
- Tighten stale-data detection and warning quality
- Improve diagnostics for missing/partial upstream fields

## Phase 3: Scoring Productization
- Keep proprietary CTS scorer private through adapter boundary
- Refine confidence signaling for incomplete pools
- Improve explainability of node-level outcomes
- Add repeatable validation fixtures for regression checks

## Phase 4: Integration Readiness
- Harden API contract and pagination behavior
- Publish integration examples and response schemas
- Improve operational scripts for snapshot lifecycle management
- Prepare deployment and runbook documentation

## Phase 5: Expansion Paths (Post-Hackathon)
- Multi-chain normalization model design
- Per-chain adapter strategy for score consistency
- Optional enterprise-facing analytics packaging

## Explicit Non-Goals
- Trading, execution, or routing
- Wallet connectivity, signing, or custody
- Portfolio management features
