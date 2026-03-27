# Security Audit — 2026-03-27

Repository: `openclaw-protonmail-skill`  
Audited branch: `main`  
Scope: `src/`, `bin/`, CI workflow, dependency graph, operational docs

## Threat Model

- Assets: Proton Bridge credentials, mailbox contents, ability to send mail as user.
- Boundaries: OpenClaw tool inputs, local IMAP/SMTP bridge transport, npm dependency chain, local logs/transcripts.
- Adversaries: malicious local process, prompt-injected email content, dependency/supply-chain compromise.

## Findings

### High — 1) Localhost transport trust is weak against local adversaries

- Evidence: `src/index.ts:114`, `src/index.ts:115`, `src/index.ts:121`, `src/index.ts:104`.
- Detail: IMAP/SMTP is configured as plaintext (`tls: false`, `autotls: 'never'`, `secure: false`). Host allowlist is good, but does not prove the peer is Proton Bridge.
- Impact: a malicious local process can bind to expected ports and capture Bridge credentials or manipulate mail traffic.
- Recommendation:
  - Add service authenticity checks before auth (for example expected bridge capability/banner fingerprint).
  - Prefer authenticated/encrypted local transport where Bridge supports it.
  - Fail closed when identity checks do not match.

### High — 2) Unbounded reads and parsing enable memory/CPU denial-of-service

- Evidence: `src/imap.ts:391`, `src/imap.ts:396`, `src/imap.ts:145`, `src/imap.ts:225`.
- Detail: full message bodies are parsed with `simpleParser` and list/search limits are not clamped.
- Impact: large or maliciously crafted messages can exhaust memory/CPU and hang/crash the skill process.
- Recommendation:
  - Clamp `limit` to safe bounds (for example `1..100`).
  - Add max message/attachment size controls before parsing.
  - Default to metadata-first fetch; stream attachments instead of loading entire payloads in memory.

### High — 3) `messageId` is unsanitised and passed directly to IMAP fetch

- Evidence: `src/index.ts:199`, `src/index.ts:237`, `src/imap.ts:391`.
- Detail: raw user/tool input is sent to `imap.fetch(messageId, ...)` without format restrictions.
- Impact: overbroad fetches via sequence syntax (for example ranges) can expose more data than intended and amplify DoS risk.
- Recommendation:
  - Validate message IDs as strict positive UID values only (`/^[1-9]\d{0,9}$/`).
  - Reject range/wildcard/comma syntax.

### Medium — 4) Search fallback regex contains a malformed boundary character

- Evidence: `src/imap.ts:332`.
- Detail: filter-strip regex uses a non-printing backspace character before `(from|subject|body|newer_than)` instead of a word boundary token.
- Impact: fallback sanitisation can behave inconsistently and reduce confidence in query normalisation logic.
- Recommendation:
  - Replace malformed token with explicit safe parser logic or a tested boundary regex.
  - Add focused tests for mixed/quoted filter strings and malformed operator input.

### High — 5) Runtime dependency vulnerabilities in a sensitive package

- Evidence: `package.json:42`, `package.json:43`, `package.json:44`.
- Command output: `npm audit --omit=dev --package-lock-only` reports high findings in `nodemailer` and `imap -> utf7 -> semver` chain.
- Detail: current runtime versions include known advisories.
- Impact: increased risk of denial-of-service and parser-layer weaknesses in code handling untrusted email traffic.
- Recommendation:
  - Upgrade to patched versions (`nodemailer >= 8.0.4`).
  - Reassess `imap` dependency choice due transitive vulnerability exposure.
  - Add CI gate for production dependency vulnerabilities.

### Medium — 6) Sensitive data can leak through output channels

- Evidence: `bin/protonmail:57`, `bin/protonmail:62`, `bin/protonmail:63`, `src/imap.ts:79`.
- Detail: CLI prints full email bodies/HTML to stdout; IMAP errors are logged raw.
- Impact: secrets and private content can end up in shell history, terminal logs, CI artefacts, and OpenClaw transcripts.
- Recommendation:
  - Default CLI output to metadata-only, add explicit flag for full body dump.
  - Redact error output and avoid printing raw transport objects.

### Medium — 7) Availability bug: `readMessage` promise can hang on edge paths

- Evidence: `src/imap.ts:383`.
- Detail: `readMessage` has no `fetch.end` fallback reject when no message body event is emitted.
- Impact: tool call can hang indefinitely and block automation workflows.
- Recommendation:
  - Add deterministic completion path with timeout and explicit “message not found” handling.

### Medium — 8) CI allows test/lint failures to pass

- Evidence: `.github/workflows/ci.yml:33`, `.github/workflows/ci.yml:61`.
- Detail: both lint and tests use `continue-on-error: true`.
- Impact: security regressions can merge without hard gate.
- Recommendation:
  - Remove `continue-on-error` for quality/security gates.
  - Add dedicated security step (`npm audit --omit=dev --audit-level=high`).

### Low — 9) Documentation mismatches can create unsafe operator assumptions

- Evidence: `SECURITY.md:40`, `SECURITY.md:58` vs runtime in `src/index.ts:114`, `src/index.ts:121`.
- Detail: docs describe TLS/self-signed behaviour that does not match current plaintext local transport implementation.
- Impact: operational misunderstanding of residual risk.
- Recommendation:
  - Align documentation with actual transport behaviour and threat assumptions.

## Attack Surface Map

- Input-driven operations: `listInbox(limit, unreadOnly)`, `search(query, limit)`, `readMessage(messageId)`, `send(...)`, `reply(...)`.
- Untrusted data ingestion: IMAP headers, full MIME bodies via `mailparser`.
- Data egress points: stdout (CLI), OpenClaw transcripts, SMTP outbound sending.

## Prioritised Hardening Plan

1. Add strict input validation for `messageId`, `limit`, recipient fields, and subject/body control characters.
2. Add fetch/parse size budgets and timeouts for all IMAP read paths.
3. Upgrade vulnerable runtime dependencies and enforce audit gate in CI.
4. Minimise sensitive output by default (metadata-only + explicit opt-in for full body).
5. Add local Bridge identity verification and document the residual local threat model clearly.

## Notes

- Fork created for this audit: `https://github.com/angie/openclaw-protonmail-skill`.
- No production code changed in this audit pass.
