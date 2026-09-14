resource "fly_app" "moe" {
  name = var.app_name
  org  = var.fly_org
}

resource "fly_ip" "primary_v4" {
  app  = fly_app.moe.name
  type = "v4"
}

resource "fly_ip" "primary_v6" {
  app  = fly_app.moe.name
  type = "v6"
}
