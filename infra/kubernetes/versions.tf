# Kubernetes (any managed or self-hosted cluster)

terraform {
  required_version = ">= 1.6"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
  }

  # Recommended: store state outside the repo. See infra/README.md for options.
  # backend "s3" {
  #   bucket                      = "moe-terraform-state"
  #   key                         = "kubernetes/terraform.tfstate"
  #   endpoint                    = "https://nyc3.digitaloceanspaces.com"
  #   region                      = "us-east-1"
  #   skip_credentials_validation = true
  #   skip_metadata_api_check     = true
  # }
}

provider "kubernetes" {
  config_path    = var.kubeconfig_path
  config_context = var.kubeconfig_context
}
