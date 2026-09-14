# Mainframe Open Education (MOE)

A free, open-source learning platform that transforms the **Mainframe Open Education** curriculum into an interactive, hands-on experience. Live-rendered documentation, per-page knowledge-check quizzes, an in-browser **COBOL sandbox**, cross-device progress accounts, and a verified **MOE Practitioner Badge** earned through a 20-question exam.

Content is sponsored by the **Open Mainframe Project**, a Linux Foundation project — and the platform proxies and renders the live MOE GitBook at request time.

---

##  Features

- **GitBook content viewer** — pages are fetched, converted, and rendered from the live MOE GitBook with a clean reader UI (sidebar navigation, table of contents, breadcrumbs, prev/next, dark mode, font sizing).
- **Knowledge-check quizzes** — 40 pages ship with quizzes (131 questions in total); passing one marks the page complete and drives your progress.
- **COBOL sandbox** — write and run real COBOL right in the browser. A global sandbox is available from the header, and an inline sandbox auto-appears on COBOL-related pages.
- **Progress tracking** — a progress bar, sidebar checkmarks, and a live per-chapter progress on the landing page.
- **Email + password accounts** — progress is stored locally when logged out and synced to your account (server-side) when logged in, so it follows you across devices.
- **MOE Practitioner Badge** — once you complete **≥80% of the curriculum**, attempt a randomized **20-question exam** (pass = **≥80%**). Passing confirms the badge will be issued by the **Linux Foundation via Credly**.
- **Command palette** — quickly search and jump to any page with `⌘K` / `Ctrl+K`.
- **Certification-grade UI** — a polished, responsive landing page plus a dedicated badge exam page, all in the OMP navy/brass branding.

---

##  Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js (CommonJS) + Express 4 |
| Sessions | `express-session` (cookie-based) |
| Auth | `bcryptjs` password hashing + rate-limited endpoints |
| Database | Dual backend via `db.js`: **PostgreSQL** (`pg`) when `DATABASE_URL` is set, else SQLite/libSQL (`@libsql/client`) — local file in dev, hosted Turso optional |
| Markdown | `marked` v18 |
| HTML parsing | `cheerio` |
| COBOL execution | External GnuCOBOL sandbox service (proxied by the server) |
| Frontend | Vanilla JavaScript + CSS + inline SVG (no framework) |
| Config | `config.js` platform-abstraction layer — all host-specific behavior is environment-driven |
| Deployment | Dockerfile + per-platform configs (Render, DigitalOcean, Railway, Fly.io, Kubernetes) — see [docs/deploy](docs/deploy/README.md) |

No build step, no bundler, no TypeScript — `npm install` is all you need.

---

##  Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Browser (vanilla JS SPA)                                     │
│   viewer.html │ index.html │ certification.html │ auth.js     │
└──────────────┬────────────────────────────────────────────────┘
               │  /api/*  (JSON)            │ static assets
┌──────────────▼────────────────────────────────────────────────┐
│  server.js (Express, single file)                             │
│   ├─ /healthz, /readyz       platform liveness/readiness      │
│   ├─ /api/sitemap            parse sitemap.md → nav tree      │
│   ├─ /api/page?url=          fetch + render GitBook content   │
│   ├─ /api/file/:id           proxy GitBook file assets        │
│   ├─ /api/sandbox/execute    forward COBOL to sandbox service │
│   ├─ /api/auth/*             register / login / logout / me   │
│   ├─ /api/progress*          persist completed pages (auth)   │
│   └─ /certification          serve the badge exam page        │
└──────────────┬───────────────────────┬────────────────────────┘
               │                       │
        live MOE GitBook         PostgreSQL / SQLite-Turso
        (content source)         (accounts + progress)

All host-specific behavior is resolved by config.js — see the
Platform Abstraction Layer section below.
```

### Data flow at a glance

- **Rendering a page:** `GET /api/page?url=<gitbook-url>` → fetch live GitBook HTML → clean it with `cheerio` → normalize GitBook-flavored Markdown → render with `marked` → inject into the viewer alongside the quiz, TOC, and page nav.
- **Running COBOL:** the editor `POST /api/sandbox/execute` → server relays to the external GnuCOBOL sandbox → stdout/stderr returned.
- **Progress:** logged out → `localStorage` (`moe_completed_quizzes`); logged in → merged with and stored on the server, synced back on login.
- **Badge exam:** ≥80% of quizzes complete → `GET /certification` → 20 randomized questions → ≥80% passes and shows the Credly / Linux Foundation confirmation.

---

##  Platform Abstraction Layer

MOE is not tied to any single hosting provider. If the project secures cloud
credits from DigitalOcean (or Railway, Fly.io, or any Kubernetes cluster), it
can be redeployed there **without touching application code** — only
environment variables and deployment manifests change.

### What it is

A thin boundary with three moving parts:

1. **`config.js` — the runtime config boundary.** The *only* module in the
   codebase allowed to read `process.env`. Every other module (`server.js`,
   `db.js`, `sitemap-cache.js`, `credly-badges.js`) imports a single frozen
   snapshot from it. Host-specific quirks (proxy hops, port injection,
   database URL naming) are normalized here once, in one place.
2. **Platform contracts served to the host.** Standard signals every platform's
   scheduler understands: `/healthz`, `/readyz`, `TRUST_PROXY`, and clean
   SIGTERM draining.
3. **Deployment artifacts per platform.** The same Docker image is described
   by one small manifest per host, plus optional Terraform roots that
   provision app + database declaratively.

### Architecture

```
              ┌───────────────────────────────────────────────────┐
              │        Hosting platform (pick any one)            │
              │   Render │ DigitalOcean │ Railway │ Fly.io        │
              │   Kubernetes │ ECS │ any Docker host              │
              └────────┬─────────────────────────────┬────────────┘
     injects env vars  │                             │  probes /healthz + /readyz,
     + DATABASE_URL    │                             │  sends SIGTERM to stop
                       ▼                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  MOE container  (Dockerfile, $PORT)                 │
│                                                                     │
│   process.env ───►  config.js   ◄── ONLY module reading env vars    │
│                        │                                            │
│         normalizes: port · TRUST_PROXY · DATABASE_URL               │
│         (+POSTGRES_URL alias) · SESSION_SECRET · ADMIN_SECRET       │
│         SANDBOX_URL · CREDLY_* · timeouts                           │
│                        │                                            │
│      ┌───────────────┼────────────────┬─────────────────┐           │
│      ▼               ▼                ▼                 ▼           │
│  server.js         db.js       sitemap-cache.js  credly-badges.js   │
│  trust proxy       PG ⇄ SQLite refresh interval  Credly API base   │
│  secrets, port     via db.js URL  fetch timeout    org/token        │
│                                                                    │
│   Contracts exposed back to the host:                              │
│     • GET /healthz → liveness (process up)                         │
│     • GET /readyz  → readiness (DB ping + sitemap loaded)          │
│     • SIGTERM/SIGINT → drain connections, close DB pool, exit 0    │
└─────────────────────────────────────────────────────────────────────┘
```

And on the deployment side, one image — many targets:

```
                    Dockerfile  (single hardened image)
                           │ built once
     ┌──────────┬──────────┼───────────┬─────────────┐
     ▼          ▼          ▼           ▼             ▼
 render.yaml .do/app.yaml fly.toml railway.json  k8s/*.yaml      ← native configs
     │          │          │           │             │
     └──────────┴──────────┴───────────┴─────────────┘
                                │ optionally provisioned by
                   infra/{render,digitalocean,fly,kubernetes}/  ← Terraform
                                │
              docs/deploy/README.md  ← quickstarts + migration runbook
```

### The rules of the layer

| Rule | Enforced by |
|---|---|
| No module touches `process.env` directly | Code review convention; all reads flow through `config.js` |
| Canonical names win, legacy aliases still work | `DATABASE_URL` preferred; `POSTGRES_URL` accepted; Turso vars honored when no PG URL exists |
| Production must be explicitly secured | Startup **aborts** if `SESSION_SECRET` is missing/default or `ADMIN_SECRET` isn't independent; dev mode only warns |

### What gets normalized where

| Concern | Before (host-coupled) | After (abstracted) |
|---|---|---|
| Proxy hops behind HTTPS terminators | Hardcoded `trust proxy = 1` (Render's topology) | `TRUST_PROXY=true` (Fly/K8s ingress), `=2`, IP list, or default hop-count |
| Database selection | Assumed SQLite/Turso everywhere | `DATABASE_URL` present → PostgreSQL (any managed provider); absent → local SQLite/Turso |
| Secrets | Silent insecure fallback in every environment | Dev warns; production refuses to boot without real secrets |
| Health checks | Reused `/api/sitemap` as a proxy health signal | Dedicated liveness/readiness endpoints for any scheduler |
| Shutdown | Process killed abruptly on redeploy | Graceful 10s drain, DB pools closed cleanly |
| Port binding | `PORT` read ad hoc | Centralized, Docker HEALTHCHECK uses the same value |

### Runtime behavior matrix

| Behavior | Development (`NODE_ENV` unset) | Production (`NODE_ENV=production`) |
|---|---|---|
| Missing `SESSION_SECRET` | Warns, uses dev fallback | **Startup aborted** with named fix |
| `ADMIN_SECRET` unset | Falls back to `SESSION_SECRET` (warns) | Must be set and independent |
| Trust proxy default | Off | 1 hop (override with `TRUST_PROXY`) |
| Session cookies | Not `secure` | `secure` (works behind any proxy via `TRUST_PROXY`) |
| Database | `data/moe.db` SQLite auto-created | Whatever `DATABASE_URL` points at |

### How it's verified

- `node test-config.js` — env normalization, alias handling, proxy parsing, prod fail-fast logic.
- `node test-health.js` — boots the real server as a hosting platform would: polls `/healthz`, checks `/readyz` dependency states, sends SIGTERM and asserts exit code 0, and verifies production refuses to start without secrets.
- Container smoke test — `docker run` the image, curl both endpoints, `docker stop` and watch the graceful-drain logs.

Full deployment details live in **[docs/deploy/README.md](docs/deploy/README.md)**; infrastructure code lives in **[infra/](infra/README.md)**.

---

##  Getting Started

### Prerequisites

- **Node.js 20+**
- No external services required for local development

### Install & run

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start        # → http://localhost:3000

# (development alias)
npm run dev
```

On first start the app auto-creates a local SQLite database at `data/moe.db` (gitignored). The COBOL sandbox defaults to a public deployment; to point at your own instance, set `SANDBOX_URL`.

### Docker

```bash
# Easiest: full local stack (app + PostgreSQL)
docker compose up --build

# Or standalone container (production validation requires both secrets)
docker build -t moe .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_SECRET=$(openssl rand -hex 32) \
  moe
```

> Production containers refuse to start with missing/default secrets — that is
> the abstraction layer's fail-fast guard, not a bug.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `TRUST_PROXY` | `1` in production | Express proxy-hop trust (`true`, hop count, or IP list) for platforms other than Render's default |
| `SANDBOX_URL` | `https://mainframe-sandbox.onrender.com` | COBOL sandbox execution endpoint |
| `SESSION_SECRET` | dev fallback (**required in production**) | Signs session cookies; startup aborts if missing in production |
| `ADMIN_SECRET` | falls back to `SESSION_SECRET` | Guards admin endpoints |
| `DATABASE_URL` | local `data/moe.db` | PostgreSQL connection string (alias: `POSTGRES_URL`) — any managed provider |
| `PGSSLMODE` | auto | `disable` for in-network/sidecar DBs, `require`/`verify-full` to force SSL; auto = SSL for remote hosts with plain-fallback |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | — | libSQL/Turso alternative when `DATABASE_URL` is unset |
| `CREDLY_*` | mock mode | Only needed by badge issuance / offline quiz builder |

The full contract, per-platform quickstarts, and a migration runbook live in **[docs/deploy/README.md](docs/deploy/README.md)**.

---

## 📖 Usage

### Browse & learn
1. Open `/` and pick a learning path, or open `/viewer.html` directly.
2. Navigate with the sidebar or the `⌘K` command palette.
3. Complete the **Knowledge Check** quiz at the bottom of quiz pages to mark them done.

### Run COBOL
- Use the **Sandbox** button in the header on any page, or
- Scroll to the auto-embedded sandbox on COBOL-related pages.

### Track progress
- Progress (`X/Y`) is shown in the viewer header, with checkmarks in the sidebar.
- **Log in** (top-right) so progress syncs across devices.

### Earn the badge
1. Complete **≥80%** of the knowledge-check quizzes.
2. Visit `/certification` and take the **20-question** exam.
3. Score **≥80%** to pass — the badge is issued by the **Linux Foundation via Credly**.

### Project scripts
- `npm start` / `npm run dev` — run the web server
- `node build-quizzes.js` — offline CLI that generates `public/quizzes.json` via the Anthropic API (requires `ANTHROPIC_API_KEY` and a running dev server)

---

##  Accounts & Security

- Passwords are hashed with **bcrypt** (12 rounds); auth endpoints are rate-limited.
- Session cookies are `httpOnly`, `sameSite: lax`, and `secure` in production.
- Progress endpoints require a valid session.
- **Note:** `/api/page` and `/api/proxy` accept arbitrary URLs (intended for GitBook proxying) — review before exposing beyond trusted networks.

---

##  Project Structure

```
Mainframe_Open_Education/
├── server.js                  # Entire Express backend (single file)
├── config.js                  # Platform-abstraction layer: the only module reading env vars
├── build-quizzes.js           # Offline quiz-generation CLI (Anthropic)
├── quiz-prompt-template.txt   # Prompt/schema used by the quiz builder
├── sitemap.md                 # Static GitBook table of contents (cold-boot fallback)
├── test-*.js                  # Hand-rolled test suites (config, health, sitemap, credly E2E)
├── Dockerfile                 # Hardened node:20-slim image w/ HEALTHCHECK + non-root user
├── docker-compose.yml         # Local full stack: app + PostgreSQL
├── render.yaml                # Render blueprint
├── .do/app.yaml               # DigitalOcean App Platform spec
├── fly.toml                   # Fly.io machine config
├── railway.json               # Railway build/deploy config
├── k8s/                       # Plain Kubernetes manifests (namespace/deployment/ingress)
├── infra/                     # Terraform root modules per platform + remote-state guide
├── docs/deploy/README.md      # Deployment matrix, env contract, migration runbook
├── data/                      # Runtime SQLite DB (gitignored)
└── public/
    ├── index.html             # Marketing landing page
    ├── viewer.html            # Reader SPA shell
    ├── certification.html     # MOE Practitioner Badge exam
    ├── quizzes.json           # Generated quizzes keyed by page URL
    ├── css/                   # style.css + landing.css
    └── js/                    # app.js (viewer) + auth.js (accounts)
```

---

##  API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sitemap` | Parsed sitemap tree |
| `GET` | `/api/page?url=` | Rendered GitBook content (`markdown` / `raw` / `iframe`) |
| `GET` | `/api/file/:id` | Proxies GitBook file assets |
| `GET` | `/api/llms` | GitBook `llms.txt` with fixed image URLs |
| `POST` | `/api/sandbox/execute` | Executes code on the external COBOL sandbox |
| `POST` | `/api/auth/register` | Create an account |
| `POST` | `/api/auth/login` | Log in |
| `POST` | `/api/auth/logout` | Log out |
| `GET` | `/api/auth/me` | Current session user |
| `GET` | `/healthz` | Liveness probe (always 200 when process is up) |
| `GET` | `/readyz` | Readiness probe (DB reachable + sitemap loaded) |
| `GET` | `/api/progress` | *(auth)* Completed pages |
| `POST` | `/api/progress` | *(auth)* Mark a page complete |
| `POST` | `/api/progress/sync` | *(auth)* Replace full progress set |
| `GET` | `/certification` | Badge exam page |

---

## 📄 License

[Apache License 2.0](LICENSE)

Content is from the **Mainframe Open Education (MOE)** project by the **Open Mainframe Project**, a Linux Foundation project. This project is an independent community implementation.

---

## Discussion

You can connect with the community in a variety of ways...

- [LINK TO MAILING LIST](https://lists.openmainframeproject.org/g/xxxx-discussion)
- [#omp-education-quiz channel on Open Mainframe Project Slack](https://slack.openmainframeproject.org)
- ['omp-education-quiz' category on Open Mainframe Project Community Forums](https://community.openmainframeproject.org/)

## Contributing
Anyone can contribute to the omp-education-quiz project - learn more at [CONTRIBUTING.md](CONTRIBUTING.md)

## Governance
omp-education-quiz is a project hosted by the [Open Mainframe Project](https://openmainframeproject.org). This project has established it's own processes for managing day-to-day processes in the project at [GOVERNANCE.md](GOVERNANCE.md).


## Reporting Issues
To report a problem, you can open an [issue](https://github.com/openmainframeproject/omp-education-quiz/issues) in repository against a specific workflow. If the issue is sensitive in nature or a security related issue, please do not report in the issue tracker but instead email omp-education-quiz-private@lists.openmainframeproject.org.
