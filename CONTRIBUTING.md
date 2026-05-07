# Contributing to TRAXR-SOLANA

Thanks for contributing. This repository is maintained as a professional, read-only
analytics codebase focused on Solana pool intelligence.

## Project Guardrails
- Keep changes deterministic and reproducible.
- Preserve the read-only scope of the product.
- Do not introduce wallet, signing, or custody flows.
- Do not commit secrets, local caches, or snapshot blobs.

## Private Scoring Adapter Policy
The proprietary CTS implementation is intentionally private.

- Do not add or commit `src/lib/scoringAdapter.private.ts`.
- Keep scoring boundaries in `src/lib/scoringAdapter.ts` intact.
- Public contributions should target normalization, API quality, UX, and observability.

## Development Workflow
1. Create a focused branch.
2. Keep commits small and logically grouped.
3. Run lint/build checks relevant to your changes.
4. Update docs when behavior or contracts change.
5. Update [CHANGELOG.md](CHANGELOG.md) for notable user-facing changes.

## Pull Request Checklist
- Clear summary of the problem and solution
- Any API contract or response-shape changes called out
- Notes on data assumptions and fallback behavior
- Screenshots or example responses for UI/API-impacting changes
- CI checks pass (`lint` and `build`)

## Coding Expectations
- Prefer explicit handling for missing data
- Avoid hidden defaults that look authoritative
- Keep heuristics clearly labeled as derived behavior
- Favor readability over cleverness

## Issue Reporting
Use GitHub issues for:
- Bugs and regressions
- Documentation improvements
- Feature requests within project scope

For sensitive security issues, follow [SECURITY.md](SECURITY.md) and do not
open a public issue.
