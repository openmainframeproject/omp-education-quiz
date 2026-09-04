# Fly.io App + IPv4/IPv6 addresses
#
# Fly's Terraform provider manages the app object and network resources.
# Machine configuration and secrets are owned by the fly CLI (fly.toml at
# repo root is the source of truth), which keeps this module small:
#
#   fly deploy                      # builds Dockerfile & updates machines
#   fly postgres create --name moe-pg --org <org>
#   fly postgres attach moe-pg -a <app>   # injects DATABASE_URL secret
#   fly secrets set SESSION_SECRET=... ADMIN_SECRET=...
#
# Postgres is intentionally NOT in Terraform because Fly manages it as a
# separate app with its own lifecycle.

terraform {
  required_version = ">= 1.6"

  required_providers {
    fly = {
      source  = "fly-apps/fly"
      version = "0.0.6"
    }
  }

  # Recommended: store state outside the repo. See infra/README.md for options.
  # backend "s3" {
  #   bucket                      = "moe-terraform-state"
  #   key                         = "fly/terraform.tfstate"
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  # }
}

provider "fly" {
  # Reads FLY_API_TOKEN from the environment:
  #   export FLY_API_TOKEN=$(fly auth token)
}
