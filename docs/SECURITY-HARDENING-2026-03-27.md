# Security Hardening Implementation — 2026-03-27

This document tracks the hardening work implemented after the deep security review.

## Implemented

- Added central validation helpers in `src/validation.ts`.
- Enforced strict UID-only message ID validation (`/^[1-9]\d{0,9}$/`) for read/reply paths.
- Added strict result limit validation (`1..100`) for list/search paths.
- Added SMTP header/body sanitisation to block control-character header injection patterns.
- Hardened IMAP read flow with:
  - max payload size limit (`5 MB`)
  - read timeout (`15s`)
  - deterministic failure on missing message content
- Fixed malformed fallback query handling in IMAP search parsing.
- Added safer CLI read output defaults (metadata-only) with optional `--include-body`.
- Added CLI error redaction helper to avoid unsafe object dumps.
- Tightened CI to fail on lint/test and added production dependency audit gate.
- Updated runtime deps to reduce known vulnerability exposure:
  - `nodemailer` `^8.0.4`
  - `mailparser` `^3.9.6`

## Remaining Risk / Next Steps

- `imap -> utf7 -> semver` transitive high-severity advisory remains.
  - Recommended next step: replace `imap` with an actively maintained alternative.
- Keychain-backed credential loading is still pending.
  - Recommended next step: implement optional OS keychain provider with env fallback.
- Localhost Bridge authenticity checks are still limited.
  - Recommended next step: add robust Bridge identity/provenance verification where feasible.

## Verification

- Unit tests: `npm test -- --runInBand`
- Build: `npm run build`
- Lint: `npm run lint`
- Prod audit: `npm audit --omit=dev --audit-level=low --package-lock-only`
