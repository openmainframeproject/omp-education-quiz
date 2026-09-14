variable "kubeconfig_path" {
  description = "Path to kubeconfig file (~/.kube/config by default)"
  type        = string
  default     = "~/.kube/config"
}

variable "kubeconfig_context" {
  description = "Kubeconfig context to use. Empty uses the current context."
  type        = string
  default     = ""
}

variable "namespace" {
  description = "Kubernetes namespace to deploy into (created if missing)"
  type        = string
  default     = "moe"
}

variable "image" {
  description = "Container image to run"
  type        = string
  default     = "ghcr.io/openmainframeproject/mainframe-open-education:latest"
}

variable "replicas" {
  description = "Number of web replicas. Scale >1 only with a shared Postgres DATABASE_URL."
  type        = number
  default     = 1
}

variable "session_secret" {
  description = "Session cookie signing secret (generate: openssl rand -hex 32)"
  type        = string
  sensitive   = true
}

variable "admin_secret" {
  description = "Admin API secret (generate: openssl rand -hex 32)"
  type        = string
  sensitive   = true
}

variable "database_url" {
  description = "PostgreSQL connection string (managed DB on your cloud of choice)"
  type        = string
  sensitive   = true
}
