variable "fly_org" {
  description = "Fly organization slug to create the app in (see: fly orgs list)"
  type        = string
}

variable "app_name" {
  description = "Globally unique Fly app name. Must match app name in fly.toml."
  type        = string
  default     = "mainframe-open-education"
}
