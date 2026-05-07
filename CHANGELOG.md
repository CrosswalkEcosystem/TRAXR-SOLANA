# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog principles and uses semantic-style tags
when practical for hackathon delivery.

## [0.1.0-hackathon] - 2026-05-07
### Added
- Clean repository history reset for public-readiness.
- Documentation overhaul for professional external consumption:
  - README, architecture, roadmap, contributing, security, support.
- Explicit privacy boundary for proprietary CTS scoring adapter.
- Scope boundary clarifying internal indexing/storage infra vs public app repo.
- Public fallback scoring behavior when private scorer is absent.
- Ignore rules for private scorer and local snapshot/runtime artifacts.

### Security
- Established policy that proprietary scorer source must not be committed.
- Added explicit private reporting guidance for sensitive issues.

### Notes
- Production indexing orchestration and snapshot retention run on internal
  Crosswalk infrastructure and are out of scope for this repository.
