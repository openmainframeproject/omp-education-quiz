# Render Web Service + Managed PostgreSQL

terraform {
  required_version = ">= 1.6"

  required_providers {
    render = {
      source  = "render-oss/render"
      version = "~> 1.4"
    }
  }

  # Recommended: store state outside the repo. See infra/README.md for options.
  # backend "s3" {
  #   bucket                      = "moe-terraform-state"
  #   key                         = "render/terraform.tfstate"
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  # }
}

provider "render" {
  api_key = var.render_api_key
}
