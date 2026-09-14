variable "do_token" {
  description = "DigitalOcean API token (https://cloud.digitalocean.com/account/api/tokens)"
  type        = string
  sensitive   = true
}

variable "app_name" {
  description = "Name of the App Platform application"
  type        = string
  default     = "mainframe-open-education"
}

variable "region" {
  description = "DO region slug for both the app and database"
  type        = string
  default     = "nyc3"
}

variable "project_name" {
  description = "Optional DO project to group resources into. Empty skips project creation."
  type        = string
  default     = ""
}

variable "repo_clone_url" {
  description = "Git clone URL App Platform builds from"
  type        = string
  default     = "https://github.com/openmainframeproject/mainframe_open_education.git"
}

variable "branch" {
  description = "Branch App Platform builds from"
  type        = string
  default     = "main"
}

variable "instance_size_slug" {
  description = "App instance size (basic-xs is the cheapest paid tier)"
  type        = string
  default     = "basic-xs"
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

variable "sandbox_url" {
  description = "External COBOL sandbox endpoint"
  type        = string
  default     = "https://mainframe-sandbox.onrender.com"
}

variable "database_name" {
  description = "Database name inside the managed PostgreSQL cluster"
  type        = string
  default     = "moe"
}
