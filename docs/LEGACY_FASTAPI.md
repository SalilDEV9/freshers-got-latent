# Freshers Got Latent — MindQuest

A runnable first implementation of the FGL event desk for IIIT Kottayam. React + TypeScript, FastAPI, SQLAlchemy, and PostgreSQL deployment configuration. SQLite is included for laptop rehearsals and automated tests.

**Release: 0.1.0, development/rehearsal. This is not a production launch.** The source repository was not accessible through the connected GitHub account, so this delivery is a standalone source package. Nothing was pushed or deployed.

## Implemented

- Audience screen, organiser overview, backstage queue, stage controller, independent judging desk, stage display, results, account/panel settings, and audit log.
- Server-side roles: super admin, event admin, controller, backstage volunteer, host, judge, audience. Public display is a read-only public view.
- Roster entry, check-in, backstage processing, sealed self-scores, queue reordering, ready/on-stage/performance/judging/reveal/completion transitions; waiting acts may be skipped or marked absent.
- Default 1–10 integer scoring; configurable range/step; exact, nearest-integer (half up), ±0.25 and ±0.50 matching.
- One locked submission per assigned judge. All assigned judges must submit before reveal. Other judges’ scores and the self-score are withheld from responses before reveal.
- Judge rankings with shared ranks for equal averages. Latent matches and Audience Choice are separate outcomes.
- Server-timestamped timer, announcements, pause/resume, revision notifications over WebSocket, HTTP refresh fallback every five seconds, stale-command protection.
- One Audience Choice vote per organiser-issued audience account; voting only for completed acts. Totals publish when the event ends.
- CSV export, browser print-to-PDF, curated host prompts, account creation, and timestamped audit records.
- Local fonts: Barlow Condensed, Source Sans 3 and IBM Plex Mono. Graphite, teal and lime broadcast-style UI; no remote font dependency.

## Quick local start (Ubuntu/macOS)

Requires Python 3.12 and Node 24. Open a terminal at this project's root.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
cd backend
../.venv/bin/python -m app.bootstrap --username salil --name Salil --role super_admin
cd ..
npm run dev
```

The bootstrap command securely prompts for a password of at least 12 characters. There are no default live passwords. Open `http://localhost:5173`, click **Crew sign in**, and use the account you created. The development command starts both the FastAPI API and Vite frontend. Python is discovered from the root `.venv`; use `FGL_PYTHON` to select another interpreter.

Windows PowerShell: use `py -3.12 -m venv .venv` and `.venv\Scripts\python.exe` instead of `.venv/bin/python`; inside `backend`, use `..\.venv\Scripts\python.exe -m app.bootstrap ...`. The Node launcher supports the Windows venv layout.

### First event setup

1. In **Event settings**, create judge, controller, backstage and audience accounts. Share each credential privately with its owner.
2. Select the assigned judges and save the scoring rules. The default matching mode is exact; this is a configurable starting default, not an assertion about your event's final rulebook.
3. Add performers through **Backstage & queue**. The stage name, talent category and host introduction are public-facing fields; do not enter private contact details there.
4. Check in each performer, move them backstage, and seal their own chosen score. Mark them ready.
5. In **Stage control**, go live and bring the next ready act on stage. Start performance and then open judging.
6. Each judge signs in on a separate device/browser profile and locks a score.
7. When all scores are locked, the controller reveals them, then completes the act.
8. Open Audience Choice voting when appropriate; end the event to publish the final vote totals. End is irreversible in this version.

Accounts share the same browser session cookie within a browser profile. Use separate devices or browser profiles when rehearsing different roles simultaneously.

## Separate seeded rehearsal

This creates fictional acts and randomly generated accounts in a **new** database. It refuses to overwrite an existing event.

```bash
cd backend
FGL_REHEARSAL=1 DATABASE_URL=sqlite:///./rehearsal.db ../.venv/bin/python -m app.rehearsal
cd ..
```

Keep the generated passwords private. Create a local, ignored `.env.development.local` at the project root:

```dotenv
DATABASE_URL=sqlite:///./rehearsal.db
```

Then run `npm run dev`. The rehearsal starts at the judging step with two judges so you can test the reveal quickly. To create a fresh rehearsal, choose a different SQLite filename. Production and rehearsal data must remain separate.

## PostgreSQL through Docker Compose

Docker is an alternative to the local Python/Node development setup.

```bash
cp .env.example .env
# Replace POSTGRES_PASSWORD in .env with a random hexadecimal password.
docker compose up --build -d
docker compose exec app python -m app.bootstrap --username salil --name Salil --role super_admin
```

Open `http://localhost:8000`. The image builds React and serves it from FastAPI, keeping API and UI on one origin. PostgreSQL has a health check and persistent volume. The database port is not exposed. The app port binds to localhost by default.

For an actual HTTPS deployment, configure the chosen reverse proxy/domain, set the exact origin in `ALLOWED_ORIGINS`, and set `COOKIE_SECURE=true`. Add WebSocket proxy support. Do not expose development servers or ship `.env` files. Public hosting was not provisioned in this delivery.

The supplied Compose configuration has not been executed here because Docker/PostgreSQL were unavailable in the execution environment. PostgreSQL integration is a remaining gate.

## Verify

```bash
cd backend
../.venv/bin/python -m pytest tests -q
cd ..
npm --prefix frontend run build
.venv/bin/python scripts/smoke.py
```

The smoke test uses its own disposable database, randomly generated credentials, and a real Uvicorn server. It exercises HTTP, WebSocket revision updates and restart persistence without modifying your event.

## Project map

```text
backend/app/domain.py       Pure scoring, projections and state constants
backend/app/main.py         API, authorization and transactional event commands
backend/app/db.py           SQLAlchemy models and transaction boundaries
backend/app/security.py     Password hashing and opaque session tokens
backend/app/bootstrap.py    Initial account creation
backend/app/rehearsal.py    Explicit, isolated rehearsal setup
backend/tests/             Scoring, permissions, transitions and concurrency tests
frontend/src/App.tsx        Role-specific event views
frontend/src/api.ts         Same-origin JSON transport and errors
frontend/src/types.ts       Shared frontend data types
frontend/src/style.css      Broadcast theme, responsive and print layouts
frontend/scripts/dev.mjs    Combined Python + Vite development launcher
scripts/smoke.py            Real HTTP/WebSocket workflow verification
compose.yaml               PostgreSQL + app deployment configuration
docs/ARCHITECTURE.md        Design decisions and limitations
docs/RELEASE_STATUS.md      Verification evidence and remaining work
```

The original MindQuest logo asset was not available in this workspace. The interface currently uses a typographic MindQuest wordmark; it does not claim to reproduce the supplied logo.
