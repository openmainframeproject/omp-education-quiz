output "service_url" {
  description = "Public URL of the Render web service"
  value       = render_web_service.moe.url
}

output "database_connection_string" {
  description = "External connection string for migrations (pg_dump/restore)"
  value       = render_postgres.moe.connection_info.external_connection_string
  sensitive   = true
}

output "postgres_version" {
  value = render_postgres.moe.version
}
