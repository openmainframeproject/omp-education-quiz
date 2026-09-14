output "app_name" {
  value       = fly_app.moe.name
  description = "Fly app name"
}

output "ipv4" {
  value       = fly_ip.primary_v4.address
  description = "Dedicated IPv4 (point your DNS A record here)"
}

output "ipv6" {
  value       = fly_ip.primary_v6.address
  description = "Dedicated IPv6 (point your DNS AAAA record here)"
}

output "next_steps" {
  value = <<-EOT
    1. fly deploy                          (uses fly.toml + Dockerfile)
    2. fly postgres create --name ${var.app_name}-pg --org ${var.fly_org}
    3. fly postgres attach ${var.app_name}-pg -a ${var.app_name}
    4. fly secrets set SESSION_SECRET=<hex> ADMIN_SECRET=<hex>
  EOT
}
