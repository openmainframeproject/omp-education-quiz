# DigitalOcean App Platform + Managed PostgreSQL

terraform {
  required_version = ">= 1.6"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.40"
    }
  }

  # Recommended: store state outside the repo. See infra/README.md for options.
  # backend "s3" {
  #   bucket                      = "moe-terraform-state"
  #   key                         = "digitalocean/terraform.tfstate"
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  # }
}

provider "digitalocean" {
  token = var.do_token
}
