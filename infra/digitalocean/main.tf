resource "digitalocean_database_cluster" "moe_pg" {
  name       = "${var.app_name}-pg"
  engine     = "pg"
  version    = "16"
  size       = "db-s-1vcpu-1gb"
  region     = var.region
  node_count = 1
}

resource "digitalocean_project" "moe" {
  count       = var.project_name == "" ? 0 : 1
  name        = var.project_name
  description = "Mainframe Open Education learning platform"
}

resource "digitalocean_project_resources" "moe" {
  count   = var.project_name == "" ? 0 : 1
  project = digitalocean_project.moe[0].id
  resources = [
    digitalocean_app.web.urn,
    digitalocean_database_cluster.moe_pg.urn,
  ]
}

resource "digitalocean_app" "web" {
  spec {
    name   = var.app_name
    region = var.region

    # Binding this database component makes App Platform inject the
    # PostgreSQL connection string automatically as $DATABASE_URL.
    database {
      cluster_name = digitalocean_database_cluster.moe_pg.name
      db_name      = var.database_name
      engine       = "PG"
      production   = true
      version      = "16"
    }

    service {
      name               = "${var.app_name}-web"
      instance_count     = 1
      instance_size_slug = var.instance_size_slug
      http_port          = 3000
      dockerfile_path    = "Dockerfile"

      git {
        repo_clone_url = var.repo_clone_url
        branch         = var.branch
      }

      health_check {
        http_path             = "/healthz"
        initial_delay_seconds = 20
        period_seconds        = 30
        timeout_seconds       = 5
        failure_threshold     = 3
      }

      env {
        key   = "NODE_ENV"
        value = "production"
        scope = "RUN_AND_BUILD_TIME"
      }

      env {
        key   = "SESSION_SECRET"
        value = var.session_secret
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "ADMIN_SECRET"
        value = var.admin_secret
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "SANDBOX_URL"
        value = var.sandbox_url
        scope = "RUN_TIME"
      }
    }
  }
}
