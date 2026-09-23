# Vercel + Supabase deployment

## Access and configuration needed

Create a **dedicated Freshers Got Latent Supabase project** in the owner's selected organization, preferably in the same region as Vercel functions. Do not reuse INDRA-NET or another unrelated project's database. Obtain GitHub write access to `SalilDEV9/freshers-got-latent` and connect that repository to Vercel with root directory **web**.

This checkout does not contain production credentials and has not been deployed. Free/paid project selection and organization ownership must be resolved before provisioning. Verify current provider quotas against rehearsal results rather than assuming a free plan meets latency targets.

## 1. Database

Apply the SQL files in `supabase/migrations/` in filename order. The first migration creates the private `fgl` schema; the second configures Supabase-only private Realtime broadcasts. Run `scripts/provision-db.sql` as the owner to create the restricted `fgl_api` server role and RLS policies. Set its LOGIN password securely outside source control, and use its Supabase transaction-pooler connection as `DATABASE_URL`.

The private `fgl` schema must **not** appear in Supabase's exposed API schemas. Audience and staff browsers receive no grants on these tables. The only authenticated schema access added by Realtime is USAGE plus a narrowly scoped boolean membership function. All data operations go through Next.js, which validates Google identity and checks current database roles. Do not use the `postgres` owner connection for the deployed application.

Use a database-owner session to bootstrap a real event and its first super administrator after that person signs in with Google. Replace the placeholders before running:

```sql
begin;
insert into fgl.events(title,expires_at)
values ('Freshers Got Latent', '<actual event closing timestamp with timezone>')
returning id;
-- Use that returned ID below; use the actual Supabase Auth user UUID.
insert into fgl.event_staff(event_id,user_id,role)
values ('<event UUID>', '<owner Auth UUID>', 'super_admin');
select fgl.append_audit('<event UUID>', '<event UUID>', 'EVENT_BOOTSTRAPPED',
  '<owner Auth UUID>', null, '{}'::jsonb);
commit;
```

Set `FGL_EVENT_ID` to this event UUID. Set the correct expiry; expired or ended events cannot admit attendees. Configure staff roles through the admin interface. Reserve judges can sign in first and then receive a role from the super administrator.

Run Supabase security/performance advisors after applying migrations. Only enable private Realtime channels in Realtime settings (disable public channel access). Staff messages contain a revision number, never attendee information or unrevealed scores. Every reload still checks current roles, so an already-connected disabled staff client cannot fetch protected data.

## 2. Google authentication

In Google Cloud, create an OAuth web client, configure its consent screen and approved users/domain as appropriate. In Supabase Auth, enable only the intended Google provider for this app and configure the Google client ID and secret. The authorized Google callback is the Supabase project callback shown in its dashboard.

Set the Supabase Site URL to the final HTTPS website. Allow the exact application callback `https://<site>/auth/callback`; also allow `http://localhost:3000/auth/callback` only for local development. Do not add broad wildcard production redirects. Google sign-in creates an Auth identity, **not** an approved registration or ticket.

Staff accounts also use Google sign-in; their roles come exclusively from `fgl.event_staff`. No user-editable metadata grants permissions. Supabase admin/Google provider configuration must be tested with real approved and unregistered Google accounts.

## 3. Signing keys

On a trusted administrator machine:

```bash
node scripts/generate-ticket-key.mjs /private/path/fgl-signing.env
```

The output contains a PKCS8 Ed25519 private PEM encoded as JSON and an SPKI public verification-key map. Put the values into Vercel server environment variables from `web/.env.example`. For Vercel's UI, paste the JSON value itself, without the shell's surrounding single quotes. Keep the private key out of GitHub and all `NEXT_PUBLIC_` variables.

For normal rotation, change `FGL_SIGNING_KEY_ID` and the private key, retaining previous public keys in `FGL_VERIFY_KEYS_JSON` while those tickets remain valid. Previously issued QR text is stored and remains unchanged. For a compromised key, remove that verification key immediately and revoke affected unredeemed passes with an audited operation. Reissuing a revoked ticket is intentionally not provided; resolve identity and incident policy before implementing a reissue workflow.

## 4. Vercel

Import the repository, choose **web** as root, Node 24, and Next.js framework detection. Set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `DATABASE_URL` (server role pooler connection, TLS)
- `APP_ORIGIN` (exact HTTPS origin, no trailing slash)
- `FGL_EVENT_ID`
- `FGL_SIGNING_KEY_ID`
- `FGL_SIGNING_PRIVATE_KEY_JSON`
- `FGL_VERIFY_KEYS_JSON`
- `NEXT_PUBLIC_INSTAGRAM_URL` (actual official account URL; optional)

Rebuild after changing public variables. Keep preview deployments on a separate rehearsal database and OAuth redirect allowlist. Do not connect previews to real audience records. No WebSocket server runs inside Vercel functions; Supabase handles staff channels.

## 5. Import and payment workflow

1. Export Google Forms responses to CSV/XLSX or configure `GOOGLE_SHEETS_ACCESS_TOKEN` with read-only Sheets access for manual synchronization. This initial connector accepts a server-managed access token; refresh it outside the application before expiry. There is no unattended scheduled sync or in-app Google consent/token-refresh workflow.
2. Map name, email and roll number; optionally phone, UTR and HTTPS proof link. Reuse saved batch mappings. First worksheet only for XLSX, with plain cell values (no formulas/rich cells), maximum 1 MB upload, 2,000 rows and 50 columns. XLSX expansion is capped before parsing.
3. Review duplicate/invalid/missing rows. Correct the source and preview again. Only explicitly selected validated rows are imported. Concurrent import conflicts are rejected by database uniqueness constraints.
4. Verify each payment independently against payment records; a screenshot or reference is not automatic proof. Record a reason/reference in the bulk action.
5. Approve registration, then generate passes in bulk or let the first approved login issue its pass. Repeated login uses the existing ticket.
6. Assign gates to active staff accounts and rehearse ID verification and scanning.

## 6. Verification gates before event day

Local:

```bash
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
```

Real PostgreSQL race test, **disposable database only**:

```bash
FGL_ALLOW_TEST_DATABASE=1 FGL_TEST_DATABASE_URL=postgres://.../fgl_entry_test \
  node web/tests/postgres-race.mjs
```

The script creates the schema; use a fresh empty database. CI is configured to run it. This is distinct from the embedded PostgreSQL tests, which queue operations through one database connection.

Against a rehearsal deployment with synthetic accounts:

```bash
k6 run -e BASE_URL=https://<staging> scripts/load-live.js
k6 run -e BASE_URL=https://<staging> -e FIXTURES=/private/staging-users.json scripts/load-authenticated.js
```

Authenticated fixtures are an array of `{ "cookie": "<complete synthetic session Cookie header>" }`, one per test attendee. Keep them private. These scripts test public/live and private dashboard read traffic; also run a supervised voting burst and actual multi-gate scan rehearsal. Measure p95/p99 latency and errors, not only average response time. The 500 ms/one-second figures remain targets until measured on the deployed region and actual gate network.

Verify unregistered login, wrong email, pending payment, ID mismatch, revoked/blocked pass, simultaneous scan, repeated confirm, network interruption, expired session, disabled staff, and expired event. Online failure must deny admission and keep the attendee waiting for a valid response.

## 7. Backup and audit

Use Supabase backups and a tested restore process. Periodically export the audit ledger and independently store its final `(event_id,audit_id,record_hash)` checkpoint. Run `scripts/verify-ledger.sql` to verify chains. A database owner can rewrite history; external checkpoints are needed to detect wholesale replacement or truncation. The application role cannot UPDATE/DELETE/TRUNCATE ledger records.

Run a scheduled owner maintenance task to delete request-limit buckets older than two days; never delete the audit ledger. Restrict payment proof sharing, retain audience data only for the organizer's defined retention period, and keep backups private. The old Docker backup scripts apply to the legacy FastAPI stack, not hosted Supabase.
