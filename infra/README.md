# Infrastructure as Code (Terraform)

One root module per hosting platform. Each module provisions the same
two pieces — the **web app** and a **PostgreSQL database** — so MOE can run
on whichever cloud Linux Foundation secures credits for.

```
infra/
├── digitalocean/   DO App Platform + Managed PostgreSQL   (fully declarative)
├── render/         Render web service + Managed Postgres  (fully declarative)
├── fly/            Fly app + IPs (machines/DB via fly CLI — see notes)
└── kubernetes/     Any cluster via kubeconfig + any managed PG
```

## Prerequisites

- Terraform >= 1.6 (`brew install terraform` / `tfenv install`)
- Platform credentials:
  | Module | Credential | How to get it |
  |---|---|---|
  | digitalocean | `do_token` + optionally Spaces keys for state | DO console → API → Tokens |
  | render | `render_api_key` | Render dashboard → Account Settings → API Keys |
  | fly | `FLY_API_TOKEN` env var | `fly auth token` |
  | kubernetes | working `kubeconfig_path` | your cluster provider |

## Remote state (required for team use)

Each module ships with a commented-out S3-compatible backend block that works
with a free DigitalOcean Space. To enable:

1. Create a private Space named e.g. `moe-terraform-state`.
2. Generate Spaces access keys.
3. Uncomment the `backend "s3"` block in `versions.tf`, add access/secret key
   args, then:

```bash
cd infra/<platform>
terraform init
```

Alternative: Terraform Cloud free tier (`cloud { organization = "..." }` block).

## Standard workflow

```bash
cd infra/digitalocean        # or render/, fly/, kubernetes/
cp terraform.tfvars.example terraform.tfvars   # fill in secrets
terraform init
terraform validate
terraform plan               # review
terraform apply              # provision
terraform output             # app URL + DATABASE_URL
```

Secrets in `.tfvars` are gitignored; never commit them.

## Platform-specific notes

### DigitalOcean (recommended target)
Fully declarative: app builds from this repo's Dockerfile via App Platform,
Managed PostgreSQL is wired into `$DATABASE_URL` automatically. Cheapest paid
app size is `basic-xs`; the `db-s-1vcpu-1gb` database fits current traffic.

### Render (current host)
Fully declarative against `render-oss/render` v1.x. The service deploys from a
pre-built image (`image_url` variable) — build/push it with:

```bash
docker build -t ghcr.io/openmainframeproject/mainframe-open-education:latest .
docker push ghcr.io/openmainframeproject/mainframe-open-education:latest
```

If attribute schemas drift between provider releases, `terraform validate`
will point at the exact fields — check the provider docs for the pinned version.

### Fly.io (hybrid by design)
Terraform owns the app object and IP addresses. Machines, autoscaling and
Postgres are owned by the `fly` CLI because Fly models them as separate apps;
the exact commands are printed by `terraform output next_steps`.

### Kubernetes
Deploys namespace + secret + deployment + service using the kubeconfig you
point it at. Works identically on DO DOKS, EKS, GKE, AKS, OCP. Ingress is not
managed here — apply `k8s/03-ingress.yaml` manually or wire your own.
Prefer plain manifests without Terraform? Use the files in `/k8s` directly:

```bash
kubectl apply -f k8s/00-namespace.yaml -f k8s/01-secret.example.yaml -f k8s/02-deployment.yaml
```

## Migration between platforms

Because configuration is environment-driven (see docs/deploy/README.md),
moving hosts means: provision with the new module → restore DB backup → set
secrets → switch DNS. Full runbook: docs/deploy/README.md § Migration.
