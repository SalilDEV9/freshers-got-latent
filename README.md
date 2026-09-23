# Freshers Got Latent · MindQuest

Event management and secure audience entry for IIIT Kottayam. **The current deployment target is the Next.js application in `web/`, with Supabase Auth, PostgreSQL and staff Realtime, hosted on Vercel.**

This is a development release, not an event-day production sign-off. See [release status](docs/RELEASE_STATUS.md) for exactly what has and has not been tested.

## Run the current application

Node.js 22 or newer (CI uses 24):

```bash
npm --prefix web ci
cp web/.env.example web/.env.local
# Configure the values as described in docs/DEPLOYMENT.md.
npm run dev
```

Open http://localhost:3000. Google authentication and data operations require configured Supabase and PostgreSQL; there is intentionally no insecure demo login in production code.

```bash
npm test
npm run build
```

## Included

- Google-only sign-in; approved registration matched to verified Google identity.
- CSV / XLSX import, manual Google Sheet sync, column detection and reusable mappings, normalization, strong-identifier deduplication, preview and explicit import approval.
- Separate payment verification and registration approval; bulk issue, block, revoke and permitted restore.
- One stored Ed25519-signed pass per attendee/event; opaque QR payload, private server key, key IDs and rotation support.
- Mobile audience Home / Pass / Live / Vote / Profile; QR preloaded on dashboard entry.
- Authorized gate camera scanner and paste fallback, identity confirmation, authoritative server verification and atomic one-time redemption.
- Audited administrator override for missing QR, without bypassing payment, registration or duplicate-entry rules.
- Private database schema with RLS; no browser table-write access; server-enforced roles and same-origin mutations.
- Hash-chained append-only audit ledger, gate attempts, attendee/check-in/audit CSV exports.
- Stage queue, teams, sealed self-score, frozen judge panel, three scoring parameters, individual remarks, controlled reveal, match rules and separate audience results.
- Staff private Realtime notifications with polling fallback; audience cached public polling and uncached pass checks.
- Results page, CSV export and browser print/save-to-PDF.
- Optional official Instagram link, independent of entry eligibility.

## Layout

| Directory | Purpose |
| --- | --- |
| `web/` | Current Next.js application and security/database tests |
| `supabase/migrations/` | Authoritative schema and Supabase Realtime migrations |
| `supabase/schema.sql` | Testable mirror of the core migration (no Supabase-only services) |
| `scripts/` | Key generation, database provisioning, ledger verification, load tests |
| `docs/` | Deployment, architecture, release status and earlier implementation notes |
| `backend/`, `frontend/` | Preserved earlier FastAPI/Vite implementation; separate data and auth |

The legacy application is retained to preserve completed work. **Do not run its custom audience passwords or unrestricted legacy voting as an entry point to the new ticket system.** There is no automatic data synchronization between the two implementations. Use the new application for the requested Google/QR architecture. Legacy Docker Compose files launch only the earlier implementation.

## Deployment

Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md). Vercel root directory: **`web`**. Never publish `.env` files, ticket signing keys, session cookies, audience spreadsheets, payment evidence, or database dumps to GitHub.

Repository requested by the owner: https://github.com/SalilDEV9/freshers-got-latent

## Event-day rules

A QR scan does not authorize admission. Staff must inspect the institute ID and wait for a successful online server confirmation. No offline check-in or silent bypass exists. After an ambiguous network timeout, rescan: an already-used response means the first confirmation may have committed. Never admit a second time based on a screenshot or the browser's previous state.

Hash chaining is tamper-evident, not tamper-proof against a database owner. Keep periodic ledger head hashes and exports outside the event database. Capacity and latency targets require the staging load test and a rehearsal on the actual gate network.
