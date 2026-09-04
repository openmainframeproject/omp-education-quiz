output "service_name" {
  description = "ClusterIP service name for your ingress/load-balancer to target"
  value       = kubernetes_service.web.metadata[0].name
}

output "namespace" {
  value = kubernetes_namespace.moe.metadata[0].name
}
