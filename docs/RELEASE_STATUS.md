# Release status — 0.2.0 development release

## Implemented in the new Next.js application

- Google/Supabase session integration and approved-email linking.
- CSV, XLSX and manual Google Sheet ingestion; reusable mappings, validation, deduplication and reviewed import.
- Separate payment/registration approval, bulk pass issuance, blocks/revocations and permitted restore.
- Stored Ed25519 QR credentials with private server signing key and public verification keys.
- Audience Home/Pass/Live/Vote/Profile, checked-in-only per-performance ratings, optional Instagram link.
- Assigned gate camera scanning, identity confirmation, authoritative atomic check-in, duplicate denial and audited administrator override.
- Event-scoped roles, private RLS-protected tables, request bounds, CSRF origin check and mutation rate counters.
- Append-only hash-chained audit, entry logs, administrative summaries and CSV exports.
- Core event queue, teams, profile edits, ordering, timers/pause, frozen judge panels, parameters and remarks, controlled reveal, latent match rules, results and CSV/print-PDF.
- Staff private Realtime wiring with polling fallback; cached public audience polling.
- Key generation, DB provisioning, deployment guide, audit verification, PostgreSQL concurrency CI and k6 scripts.

## Verification executed locally

- Final Next.js production build and TypeScript checking passed.
- Production HTTP smoke passed for six routes, frame protection, cross-origin mutation rejection and content-type enforcement. This does not validate browser hydration or authenticated workflows.
- 15 new automated tests passed: QR integrity/claims/key checks; CSV normalization/deduplication and formula escaping; XLSX round trip/limits; schema compilation; role/gate/payment/expiry/block rejection; one-of-50 queued redemptions; immutable audit and hash validation; unprivileged DB denial; sealed result visibility and exact matching.
- 35 earlier FastAPI tests passed (two third-party deprecation warnings).
- Production npm audit reported zero known vulnerabilities after pinning ExcelJS's compatible UUID dependency to 11.1.1; XLSX round-trip test passed after that change.

The embedded PostgreSQL tests use PGlite and one connection. They do **not** prove independent multi-connection race behavior or Supabase hosted policy behavior. A 50-connection real-PostgreSQL test is provided in CI but has not run here.

## Not yet verified / configured

- A dedicated Freshers Got Latent Supabase project, applied hosted migrations and security advisors.
- Google OAuth provider credentials, consent/redirect setup and real approved/unregistered-account login tests.
- Live Supabase Realtime topic authorization and database server-role/pooler configuration.
- Vercel production deployment, secrets and final URL.
- End-to-end browser/camera tests on actual mobile devices; browser access to the local app was blocked in this environment.
- 600–800-session load tests, voting bursts, real multi-gate concurrency and network-failure rehearsal.
- Production backup restore exercise and external ledger checkpoint storage.
- Repository publication: the connector reports `push: false` for `SalilDEV9/freshers-got-latent`. No upload has been claimed or performed.

## Deliberate current boundaries

- Google Sheet sync is manually triggered and uses a server-managed read-only OAuth access token. Automatic refresh/consent and scheduled sync are not implemented.
- The Next.js PDF path is browser print/save-to-PDF; the previous server-generated PDF endpoint remains in the separate FastAPI application.
- The official MindQuest logo file and Instagram URL were not available; the interface uses a text wordmark and shows Instagram only when its real URL is configured.
- New and legacy application databases are separate; no automatic migration of legacy rehearsal records is included. Production must use `web/` for Google/QR access.
- There is no offline admission, public blockchain, Instagram-follow verification, payment gateway or claim of unhackable security.

Do not call this release production-complete until the outstanding deployment and rehearsal checks pass.
