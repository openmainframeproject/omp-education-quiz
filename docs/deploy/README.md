# Deploying Mainframe Open Education

MOE is a standard 12-factor Node app: **all host-specific behavior lives in
`config.js`** and is driven by environment variables. The same Docker image
runs unchanged on any platform that can execute containers — which is every
platform Linux Foundation holds credits for.

```
┌───────────────────────────────────────────────────────┐
│  Your platform's HTTPS proxy / load balancer          │
│      (TRUST_PROXY tells Express how to read headers)  │
└──────────────┬────────────────────────────────────────┘
               ▼
        MOE container  (Dockerfile, listens on $PORT)
               │ DATABASE_URL            │ SANDBOX_URL
               ▼                         ▼
     Any managed PostgreSQL    External COBOL sandbox service
```

## Platform matrix

| Platform | Config in repo | IaC | Database option | Health probes |
|---|---|---|---|---|
| **Render** (current) | `render.yaml` | `infra/render/` | Render Managed PG | `/healthz` |
| **DigitalOcean** | `.do/app.yaml` | `infra/digitalocean/` | DO Managed PG | `/healthz` |
| **Railway** | `railway.json` | CLI/dashboard | Railway Postgres plugin | `/healthz` |
| **Fly.io** | `fly.toml` | `infra/fly/` (hybrid) | Fly Postgres (`fly postgres attach`) | `/healthz` |
| **Kubernetes** | `k8s/*.yaml` | `infra/kubernetes/` | any managed PG via secret | liveness `/healthz`, readiness `/readyz` |
| **Any Docker host** | `Dockerfile` | `docker-compose.yml` | bundled Postgres | `/healthz` |

All platforms also need the secrets below; none of them require code changes.
The COBOL execution sandbox is its own container/repo
([Mainframe_Sandbox](https://github.com/TusharB-07/Mainframe_Sandbox)) reached
via `SANDBOX_URL`; local `docker compose up` builds and wires it automatically.

---

## Canonical environment variable contract

`config.js` reads these once at boot. Legacy aliases keep older setups working.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port (most platforms inject this automatically) |
| `NODE_ENV` | prod: `production` | `development` | Enables secure cookies, fail-fast validation |
| `TRUST_PROXY` | no | `1` in production, off in dev | Express `trust proxy`. `true` = all hops (Fly, K8s ingress), number = hop count (Render), IPs = explicit proxies |
| `DATABASE_URL` | no* | — | PostgreSQL connection string. *Required in production for durable accounts/progress; unset falls back to SQLite/libSQL (`data/moe.db`) or Turso |
| `POSTGRES_URL` | no | — | Legacy alias for `DATABASE_URL` |
| `PGSSLMODE` | no | auto | `disable` for in-network/sidecar Postgres, `require`/`verify-ca`/`verify-full` to force SSL; default auto-connects with SSL for remote hosts and falls back automatically if the server refuses SSL (`?sslmode=` in the URL also honored) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | no | — | libSQL/Turso alternative when `DATABASE_URL` unset |
| `SESSION_SECRET` | **yes in production** | dev fallback | Session cookie signing. Startup aborts if missing/default in production |
| `ADMIN_SECRET` | recommended | falls back to `SESSION_SECRET` | Guards `/api/admin/badge-claims` |
| `SANDBOX_URL` | no | public sandbox | Base URL of the external COBOL execution service |
| `SITEMAP_REFRESH_MS` | no | `3600000` | GitBook sitemap cache refresh interval |
| `FETCH_TIMEOUT_MS` | no | `15000` | Outbound fetch timeout (GitBook, Credly) |
| `CREDLY_API_BASE`, `CREDLY_ORG_ID`, `CREDLY_AUTH_TOKEN`, `CREDLY_BADGE_TEMPLATE_ID` | no | mock mode | Badge issuance credentials |

### Health endpoints (use these in platform dashboards)

| Endpoint | Meaning | Returns |
|---|---|---|
| `GET /healthz` | Liveness — process is up | always `200 {ok:true}` |
| `GET /readyz` | Readiness — DB reachable AND sitemap loaded | `200` or `503` with per-check detail |
| `GET /api/sitemap` | Legacy health path (still supported, e.g. by older Render blueprints) | sitemap JSON |

The container `HEALTHCHECK` uses `/healthz`; Kubernetes uses both.

---

## Quickstart per platform

### Render (current setup)
```bash
# Dashboard → New Blueprint → point at this repo (uses render.yaml),
# or provision entirely via Terraform:
cd infra/render && terraform init && terraform apply
```

### DigitalOcean App Platform
```bash
doctl apps create --spec .do/app.yaml
# set SESSION_SECRET / ADMIN_SECRET when prompted or via dashboard
# Managed Postgres is created from the spec; $DATABASE_URL is auto-injected.
# Terraform alternative:
cd infra/digitalocean && terraform init && terraform apply
```

### Railway
```bash
railway init && railway up          # railway.json supplies build/deploy config
railway add --database postgres     # injects $DATABASE_URL
railway variables --set "SESSION_SECRET=$(openssl rand -hex 32)" \
                       "ADMIN_SECRET=$(openssl rand -hex 32)"
```

### Fly.io
```bash
fly launch --no-deploy --copy-config
fly postgres create --name moe-pg
fly postgres attach moe-pg           # injects $DATABASE_URL
fly secrets set SESSION_SECRET=$(openssl rand -hex 32) ADMIN_SECRET=$(openssl rand -hex 32)
fly deploy                           # uses fly.toml + Dockerfile
# IP reservation automation available via infra/fly/
```

### Kubernetes (any cluster)
```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl create secret generic moe-secrets -n moe \
  --from-literal=SESSION_SECRET=$(openssl rand -hex 32) \
  --from-literal=ADMIN_SECRET=$(openssl rand -hex 32) \
  --from-literal=DATABASE_URL="postgres://user:pass@host:5432/moe?sslmode=require"
kubectl apply -f k8s/02-deployment.yaml
# then your Ingress of choice (template in k8s/03-ingress.yaml)
```

### Local / any Docker host
```bash
docker compose up --build   # app on :3000 + Postgres, fully wired
```

---

## Migrating between platforms (e.g. Render → DigitalOcean)

Zero code changes. Order matters only where noted.

1. **Provision the target** (DO example):
   ```bash
   cd infra/digitalocean
   terraform apply    # outputs database_uri + app URL
   ```
2. **Copy data before cutover** (accounts, progress, badge claims):
   ```bash
   # source: Render external DB URI        target: DO managed DB URI
   pg_dump "$RENDER_DATABASE_URL" -Fc -f moe.dump
   pg_restore --clean --if-exists -d "$DO_DATABASE_URL" moe.dump
   ```
3. **Set the same secrets** on the new platform (`SESSION_SECRET`,
   `ADMIN_SECRET`) so existing login sessions survive.
4. **Point `SANDBOX_URL` correctly.** The COBOL sandbox is a separate
   microservice with its own repo and Dockerfile:
   [`TusharB-07/Mainframe_Sandbox`](https://github.com/TusharB-07/Mainframe_Sandbox)
   (listens on port `4000`, exposes `POST /execute` + `GET /health`; it is a
   standalone container — no docker-in-docker involved). It currently runs as
   a Render service, but being a plain container it deploys anywhere: Railway
   (config ships in that repo), DO App Platform, Fly.io, or any host. Either
   leave the existing deployment running (it is reachable from anywhere) or
   redeploy it to the new platform and use its URL. Local compose builds it
   straight from the git URL and wires `SANDBOX_URL=http://sandbox:4000`
   automatically. Verify:
   ```bash
   curl -X POST "$NEW_APP_URL/api/sandbox/execute" \
     -H 'Content-Type: application/json' \
     --data-binary @- <<'JSON'
   {"language":"cobol","code":"IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\nPROCEDURE DIVISION.\n    DISPLAY 'HELLO MOE'.\n    STOP RUN.","stdin":""}
   JSON
   ```
5. **Smoke-test on the staging URL**: `/healthz`, `/readyz`, one lesson page,
   one quiz submit, login + progress sync, admin CSV export.
6. **Cut DNS** to the new platform's ingress/CNAME value. Keep the old
   deployment running until TTL expires, then decommission.
7. **Verify** `/readyz` shows `checks.database: ok` against the migrated data,
   and log in with a pre-migration test account.

Rollback = flip DNS back; the old stack stays intact until step 7 passes.

---

## Operational notes

- **Scaling beyond 1 instance:** sessions are stored server-side in Postgres
  (`connect-pg-simple`) whenever `DATABASE_URL` is set, so multiple replicas
  work behind any load balancer. On SQLite-only setups stay at 1 instance.
- **Graceful shutdown:** SIGTERM drains connections (10s max) then closes DB
  pools — required for K8s/Fly/App Platform rolling deploys.
- **Backups:** enable automated backups on whichever managed Postgres you
  choose; `pg_dump "$DATABASE_URL" -Fc` works everywhere.
- **No object storage, queues, or email services are used** — nothing else to
  port when switching providers.
