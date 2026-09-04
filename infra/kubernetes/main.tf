resource "kubernetes_namespace" "moe" {
  metadata {
    name = var.namespace
  }
}

resource "kubernetes_secret" "moe_secrets" {
  metadata {
    name      = "moe-secrets"
    namespace = kubernetes_namespace.moe.metadata[0].name
  }

  data = {
    SESSION_SECRET = var.session_secret
    ADMIN_SECRET   = var.admin_secret
    DATABASE_URL   = var.database_url
  }
}

resource "kubernetes_deployment" "web" {
  metadata {
    name      = "moe-web"
    namespace = kubernetes_namespace.moe.metadata[0].name
    labels = {
      app = "moe-web"
    }
  }

  spec {
    replicas = var.replicas

    selector {
      match_labels = {
        app = "moe-web"
      }
    }

    template {
      metadata {
        labels = {
          app = "moe-web"
        }
      }

      spec {
        container {
          name  = "web"
          image = var.image

          port {
            container_port = 3000
          }

          env {
            name  = "NODE_ENV"
            value = "production"
          }

          env {
            name  = "PORT"
            value = "3000"
          }

          env {
            name  = "TRUST_PROXY"
            value = "true"
          }

          env {
            name = "SESSION_SECRET"

            value_from {
              secret_key_ref {
                name = kubernetes_secret.moe_secrets.metadata[0].name
                key  = "SESSION_SECRET"
              }
            }
          }

          env {
            name = "ADMIN_SECRET"

            value_from {
              secret_key_ref {
                name = kubernetes_secret.moe_secrets.metadata[0].name
                key  = "ADMIN_SECRET"
              }
            }
          }

          env {
            name = "DATABASE_URL"

            value_from {
              secret_key_ref {
                name = kubernetes_secret.moe_secrets.metadata[0].name
                key  = "DATABASE_URL"
              }
            }
          }

          liveness_probe {
            http_get {
              path = "/healthz"
              port = 3000
            }

            initial_delay_seconds = 20
            period_seconds        = 30
            timeout_seconds       = 5
          }

          readiness_probe {
            http_get {
              path = "/readyz"
              port = 3000
            }

            initial_delay_seconds = 15
            period_seconds        = 15
            timeout_seconds       = 5
            failure_threshold     = 3
          }

          resources {
            requests = {
              cpu    = "100m"
              memory = "256Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "512Mi"
            }
          }
        }
      }
    }
  }
}

resource "kubernetes_service" "web" {
  metadata {
    name      = "moe-web"
    namespace = kubernetes_namespace.moe.metadata[0].name
  }

  spec {
    selector = {
      app = "moe-web"
    }

    port {
      port        = 80
      target_port = 3000
      protocol    = "TCP"
    }
  }
}
