output "app_live_url" {
  description = "Public URL of the deployed app"
  value       = digitalocean_app.web.live_url
}

output "default_ingress" {
  description = "Default *.ondigitalocean.app ingress (point your CNAME here)"
  value       = digitalocean_app.web.default_ingress
}

output "database_uri" {
  description = "Managed PostgreSQL connection string (same value injected as DATABASE_URL)"
  value       = digitalocean_database_cluster.moe_pg.uri
  sensitive   = true
}

output "database_host" {
  description = "PostgreSQL host, useful for pg_dump/restore migrations"
  value       = digitalocean_database_cluster.moe_pg.host
}
