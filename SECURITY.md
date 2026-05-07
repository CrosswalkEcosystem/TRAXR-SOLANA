# Security Policy

TRAXR-SOLANA is a read-only analytics system. It does not manage private keys,
execute transactions, or provide custody workflows.

## How to Report a Vulnerability
Please report sensitive issues privately:
- `security@crosswalk.pro`

Do not open public GitHub issues for active security vulnerabilities.

## Security Scope
In scope:
- API routes under `src/app/api/traxr/*`
- Data normalization/scoring boundaries under `src/lib/*`
- UI logic that surfaces risk information under `src/components/*`
- Snapshot ingestion and enrichment scripts under `scripts/*`

Out of scope:
- External infrastructure not maintained in this repository
- Upstream third-party services and RPC providers
- Wallet, signing, and custody systems (not part of this project)

## Private CTS Model Handling
The proprietary CTS scoring implementation is intentionally not committed.

- `src/lib/scoringAdapter.private.ts` must remain local/private.
- Public repository changes must not expose model coefficients, thresholds, or formula internals.
- Suspected leakage of private scoring logic should be reported as a security issue.
