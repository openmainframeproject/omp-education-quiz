resource "render_postgres" "moe" {
  name          = "${var.service_name}-pg"
  plan          = var.database_plan
  region        = var.region
  version       = "16"
  database_name = var.database_name
  database_user = var.database_user
}

resource "render_web_service" "moe" {
  name              = var.service_name
  plan              = var.service_plan
  region            = var.region
  num_instances     = 1
  health_check_path = "/healthz"

  runtime_source = {
    docker = {
      repo_url        = var.repo_url
      branch          = var.branch
      dockerfile_path = "Dockerfile"
    }
  }

  env_vars = {
    NODE_ENV = { value = "production" }
    PORT     = { value = "3000" }

    SANDBOX_URL = { value = var.sandbox_url }

    SESSION_SECRET = { value = var.session_secret }
    ADMIN_SECRET   = { value = var.admin_secret }

    DATABASE_URL = {
      value = render_postgres.moe.connection_info.internal_connection_string
    }
  }
}
