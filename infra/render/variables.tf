variable "render_api_key" {
  description = "Render API key (Dashboard > Account Settings > API Keys)"
  type        = string
  sensitive   = true
}

variable "service_name" {
  description = "Name of the Render web service"
  type        = string
  default     = "mainframe-open-education"
}

variable "region" {
  description = "Render region slug"
  type        = string
  default     = "oregon"
}

variable "service_plan" {
  description = "Web service instance plan"
  type        = string
  default     = "starter"
}

variable "database_plan" {
  description = "Managed PostgreSQL plan"
  type        = string
  default     = "basic-256mb"
}

variable "database_name" {
  type    = string
  default = "moe"
}

variable "database_user" {
  type    = string
  default = "moe"
}

variable "repo_url" {
  description = "GitHub repository URL Render builds the Dockerfile from"
  type        = string
  default     = "https://github.com/openmainframeproject/mainframe_open_education"
}

variable "branch" {
  description = "Branch Render builds from"
  type        = string
  default     = "main"
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
