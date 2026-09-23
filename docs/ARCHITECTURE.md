# Current architecture: Next.js + Supabase

The new application is `web/`. The preserved FastAPI/Vite implementation is a separate legacy application and is not a shared authentication or data source.

## Trust boundaries

1. Google authenticates the person through Supabase Auth. Next.js validates the session with `getUser()` and requires a confirmed Google identity email, not user-editable metadata.
2. Next.js looks up current roles and the event registration in PostgreSQL. Successful sign-in alone does not approve payment, registration or entry.
3. A private `fgl` schema contains event, registrations, payment, tickets, gate devices, attempts, staff, performances, judge scores, votes, import batches and ledger records. The current announcement is stored on the single event record.
4. Browser clients cannot read or write these tables through Supabase's Data API. All tables have RLS. A dedicated server-only SQL role accesses them through the transaction pooler. Its credential is not a Supabase public key and never reaches the client.
5. The only private-schema function available to authenticated browser identities answers whether that identity may receive a particular staff Realtime topic. It is security-definer, has an empty search path, validates `auth.uid()`, and grants no data-table access.

## Import and account linking

CSV/XLSX or a manually triggered private Google Sheet read produces rows and column mappings. The server normalizes and validates all fields, compares email, roll and UTR against both the batch and existing records, and persists a preview. All members of a duplicate pair are flagged. Same normalized names generate a warning, not rejection. Email matching is case normalized; Gmail dot/plus variants are deliberately not guessed or merged.

Explicitly selected valid rows are committed atomically. Database uniqueness is the final guard if two previews become stale. Import leaves payment pending. Admin payment approval and registration approval are separate audited operations. Tickets can be issued in bulk after those checks, or on the first approved Google login. Linking is one-time and uses a verified provider email; another Auth UUID cannot take over an already-linked record.

The payment proof is a reviewed HTTPS link, not an image uploaded to public storage. The server does not fetch arbitrary proof URLs. UTR absence requires manual payment review; available references must be unique per event.

## Tickets and gates

The Node crypto library generates a 256-bit nonce and signs a versioned Ed25519 payload. QR claims contain only version, event UUID, ticket UUID, nonce, issued timestamp and key ID. The signature is separate. Personal and payment data never enter the QR.

The signed QR is stored on issuance. Normal key rotation does not resign existing passes. The scanner optionally prechecks with Web Crypto and always sends the complete signed token to the server. Invalid tokens are audited without storing raw QR material. The server checks the signature and matches every opaque claim to its ticket row before returning only the current attendee's name and roll.

Identity confirmation is a separate operation. The database rechecks current staff role, assigned active gate, registration, payment, event expiry and ticket state; it conditionally updates an ACTIVE ticket to REDEEMED. The check-in, registration state and audit append commit together. Duplicate attempts produce recorded denials. Cached data never authorizes entry. Administrator override skips missing QR possession only; it requires institute-ID confirmation, a detailed reason and every authoritative eligibility check.

## Concurrency and audit

Short mutation transactions lock the event first, then relevant rows. This gives a consistent lock order and serial ledger appends. The conditional ticket UPDATE is still the definitive one-use operation. Event control uses an optimistic revision; independent judge submissions are exempt from stale revision rejection and instead use the frozen panel, current performance state and unique submission key.

Scoring revision is separate from staff notification revision, so audience votes and gate scans do not invalidate event control forms. Bulk imports/issuance run in one transaction; complete these before opening gates to avoid long event-lock waits.

Ledger records are SHA-256 chained over canonical PostgreSQL JSONB including UTC timestamp, action, actor, device, entity and previous hash. UPDATE/DELETE/TRUNCATE are denied to the application and rejected by an append-only trigger. External checkpoints are required to detect a database-owner rewrite or tail deletion. This is not a public blockchain and does not claim protection against a compromised database owner.

## Live data and scale

Audience public state uses a three-second CDN cache and jittered 4–5 second polling. Private dashboard/pass requests are `private, no-store`, refresh every ten seconds while visible, and never authorize a scan. QR images are precomputed after the initial dashboard response. Voting requires current checked-in registration and redeemed ticket and has a unique event/performance/audience key.

Staff subscribe to private Supabase broadcast topics. Payloads contain only notification revisions; the client re-fetches authorized state. Five-second polling remains as a fallback. A revoked staff session that remains subscribed receives no personal data and is denied on data reload.

The database pool is capped at three connections per Next.js process with prepared statements disabled for transaction-pooler compatibility. This is a starting configuration, not proof of 800-session capacity. Rehearsal must measure provider pool limits, transaction-lock wait time, Google/Supabase session validation and actual gate network latency.

## Event features

A single active performance is enforced by a partial unique index. The self-score is permanently sealed before READY. The stage entry freezes a judge panel. Three predefined criteria (creativity, entertainment, originality), each 1–10 with equal weight, plus private remarks form a judge submission; the database enforces one submission per judge/performance. Reveal requires all frozen judges. Exact latent matching compares integer criterion totals to avoid floating-point error; nearest, ±0.25 and ±0.5 modes are also available and locked once the event starts.

Public results come only from revealed/completed performances. Judge rank, latent matches and final audience averages are separate. Public results support print/save-to-PDF; organizer CSV uses formula-safe cell escaping. Performer editing/reordering is limited to waiting acts. Admin recovery preserves completed results and requires a reason. Missing judges can be replaced before they submit; historical scores remain unchanged. Host prompts are a curated local question set, not an AI service dependency.
