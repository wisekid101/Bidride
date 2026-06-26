# ─── ALB Routing Layer ────────────────────────────────────────────────────────
# HTTPS listener, target groups (one per service), path-based routing rules,
# and WebSocket sticky sessions for the auth-service gateway.

# ─── Variables ───────────────────────────────────────────────────────────────

variable "domain_name"           { default = "api.bidride.com" }
variable "acm_certificate_arn"   { default = "" }

# ─── ACM Certificate ─────────────────────────────────────────────────────────

data "aws_acm_certificate" "api" {
  count       = var.acm_certificate_arn == "" ? 1 : 0
  domain      = var.domain_name
  statuses    = ["ISSUED"]
  most_recent = true
}

locals {
  certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : data.aws_acm_certificate.api[0].arn

  services = {
    auth         = { port = 3001, health_path = "/health/live" }
    trip         = { port = 3002, health_path = "/health/live" }
    driver       = { port = 3003, health_path = "/health/live" }
    rider        = { port = 3004, health_path = "/health/live" }
    pricing      = { port = 3005, health_path = "/health/live" }
    safety       = { port = 3006, health_path = "/health/live" }
    payment      = { port = 3007, health_path = "/health/live" }
    notification = { port = 3008, health_path = "/health/live" }
    trust        = { port = 3009, health_path = "/health/live" }
    airport      = { port = 3010, health_path = "/health/live" }
    admin        = { port = 3011, health_path = "/health/live" }
  }

  # Path routing rules — ordered by priority (lower = higher priority).
  # Auth-service hosts both REST (/auth) and WebSocket gateway (/ws).
  routing_rules = {
    auth-ws      = { priority = 10,  service = "auth",         paths = ["/ws", "/ws/*"],             websocket = true }
    auth-rest    = { priority = 20,  service = "auth",         paths = ["/auth/*"] }
    trip         = { priority = 30,  service = "trip",         paths = ["/trips/*", "/bids/*", "/pricing/*"] }
    driver       = { priority = 40,  service = "driver",       paths = ["/drivers/*", "/driver/*"] }
    rider        = { priority = 50,  service = "rider",        paths = ["/riders/*"] }
    safety       = { priority = 60,  service = "safety",       paths = ["/safety/*"] }
    payment      = { priority = 70,  service = "payment",      paths = ["/payments/*"] }
    notification = { priority = 80,  service = "notification", paths = ["/internal/notifications/*"] }
    trust        = { priority = 90,  service = "trust",        paths = ["/trust/*"] }
    airport      = { priority = 100, service = "airport",      paths = ["/airport/*"] }
    admin        = { priority = 110, service = "admin",        paths = ["/admin/*"] }
  }
}

# ─── HTTP → HTTPS Redirect ────────────────────────────────────────────────────

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# ─── HTTPS Listener ──────────────────────────────────────────────────────────

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  # Default: 404 for unmatched paths
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"Not Found\"}"
      status_code  = "404"
    }
  }
}

# ─── Target Groups (one per service) ─────────────────────────────────────────

resource "aws_lb_target_group" "services" {
  for_each = local.services

  name        = "bidride-${each.key}-${var.environment}"
  port        = each.value.port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = module.vpc.vpc_id

  health_check {
    path                = each.value.health_path
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  deregistration_delay = 30

  # WebSocket requires sticky sessions so the WS handshake and frames
  # reach the same container. Only enabled on auth-service.
  dynamic "stickiness" {
    for_each = each.key == "auth" ? [1] : []
    content {
      type            = "lb_cookie"
      cookie_duration = 86400
      enabled         = true
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ─── Listener Rules (path-based routing) ─────────────────────────────────────

resource "aws_lb_listener_rule" "routes" {
  for_each = local.routing_rules

  listener_arn = aws_lb_listener.https.arn
  priority     = each.value.priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.services[each.value.service].arn
  }

  condition {
    path_pattern {
      values = each.value.paths
    }
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "target_group_arns" {
  value = { for k, tg in aws_lb_target_group.services : k => tg.arn }
}
