# ─── ALB Routing Layer ────────────────────────────────────────────────────────
# HTTPS listener, target groups (one per service), path-based routing rules,
# and WebSocket sticky sessions for the auth-service gateway.

# ─── Variables ───────────────────────────────────────────────────────────────

variable "root_domain" {
  description = "Canonical company domain. Used only to sanity-check api_hostname."
  type        = string
  default     = "bidiride.com"
}

# The FULL hostname this environment serves. Environment-specific by
# definition: staging-api.bidiride.com vs api.bidiride.com. No wildcard — each
# environment's certificate covers exactly its own hostname, so a staging
# mistake can never present a certificate valid for production.
variable "api_hostname" {
  description = "Full API hostname for THIS environment (e.g. staging-api.bidiride.com)."
  type        = string

  validation {
    condition     = endswith(var.api_hostname, ".bidiride.com")
    error_message = "api_hostname must be under bidiride.com. bidride.com is a different domain this project does not control."
  }
}

# Supplied explicitly from the dns/ state output `hosted_zone_id`. This root
# module never creates or destroys the hosted zone — it only writes records
# into a zone someone else owns.
variable "route53_zone_id" {
  description = "Route 53 zone ID from the dns/ state. Records are written here; the zone itself is never managed by this module."
  type        = string
}

# ─── ACM Certificate (environment-owned) ─────────────────────────────────────
#
# Previously this module only LOOKED UP an externally created certificate. That
# is how the failed api.bidride.com certificate came to exist outside Terraform
# and time out unvalidated. Terraform now requests and validates the
# certificate, so renewal cannot depend on a human remembering to publish a DNS
# record.

resource "aws_acm_certificate" "api" {
  domain_name       = var.api_hostname
  validation_method = "DNS"

  # Replace before destroying: the listener always has a valid certificate
  # attached, so a certificate change never interrupts HTTPS.
  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = var.api_hostname
    Environment = var.environment
  }
}

# Validation records are written into the SHARED zone by zone id. Each record
# is keyed on the certificate's own domain_validation_options, so staging and
# production write distinct records and cannot collide.
resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

# Blocks until ACM observes the record and issues. Without this, the listener
# could reference a PENDING_VALIDATION certificate and the apply would fail
# late instead of waiting.
resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for r in aws_route53_record.api_cert_validation : r.fqdn]
}

# ─── API alias record ────────────────────────────────────────────────────────
#
# Alias (not CNAME) so the hostname resolves directly to the ALB with no extra
# lookup. The ALB's DNS name and hosted-zone id come from the resource itself —
# never hardcoded.
resource "aws_route53_record" "api" {
  zone_id = var.route53_zone_id
  name    = var.api_hostname
  type    = "A"

  alias {
    name    = aws_lb.main.dns_name
    zone_id = aws_lb.main.zone_id
    # The ALB already health-checks its targets; enabling this would withdraw
    # DNS on partial target failure and remove the ability to serve a 503 from
    # the load balancer itself.
    evaluate_target_health = false
  }
}

locals {
  # The validation resource, not the certificate, so the listener can only ever
  # attach a certificate that has actually reached ISSUED.
  certificate_arn = aws_acm_certificate_validation.api.certificate_arn

  services = {
    # auth-service exposes /health/live (Sprint 12 H2 fix — setGlobalPrefix exclusions).
    # All other services expose /health only (no /live sub-path).
    auth         = { port = 3001, health_path = "/health/live" }
    trip         = { port = 3002, health_path = "/health" }
    driver       = { port = 3003, health_path = "/health" }
    rider        = { port = 3004, health_path = "/health" }
    pricing      = { port = 3005, health_path = "/health" }
    safety       = { port = 3006, health_path = "/health" }
    payment      = { port = 3007, health_path = "/health" }
    notification = { port = 3008, health_path = "/health" }
    trust        = { port = 3009, health_path = "/health" }
    airport      = { port = 3010, health_path = "/health" }
    admin        = { port = 3011, health_path = "/health" }
  }

  # Path routing rules — ordered by priority (lower = higher priority).
  # Auth-service hosts both REST (/auth) and WebSocket gateway (/ws).
  # Note: notification uses @Controller('internal/notifications') and trust uses
  # @Controller('internal/trust') — ALB paths match those controller prefixes.
  routing_rules = {
    auth-ws      = { priority = 10, service = "auth", paths = ["/ws", "/ws/*"] }
    auth-rest    = { priority = 20, service = "auth", paths = ["/auth/*"] }
    trip         = { priority = 30, service = "trip", paths = ["/trips/*", "/bids/*"] }
    pricing      = { priority = 35, service = "pricing", paths = ["/pricing/*"] }
    driver       = { priority = 40, service = "driver", paths = ["/drivers/*", "/driver/*", "/vehicles", "/vehicles/*"] }
    rider        = { priority = 50, service = "rider", paths = ["/riders/*"] }
    safety       = { priority = 60, service = "safety", paths = ["/safety/*"] }
    payment      = { priority = 70, service = "payment", paths = ["/payments/*"] }
    notification = { priority = 80, service = "notification", paths = ["/internal/notifications/*"] }
    trust        = { priority = 90, service = "trust", paths = ["/internal/trust/*"] }
    airport      = { priority = 100, service = "airport", paths = ["/airport/*"] }
    admin        = { priority = 110, service = "admin", paths = ["/admin/*"] }

    # Provider webhook callbacks. Both controllers use @Controller('webhooks'),
    # so the paths are /webhooks/stripe (payment) and /webhooks/checkr (driver).
    #
    # These must be routed individually — a single /webhooks/* rule cannot fan
    # out to two different target groups, and matching the prefix to one service
    # would silently blackhole the other provider's callbacks.
    #
    # Without these rules both paths fall through to the listener's fixed-response
    # 404. Stripe and Checkr would each accept the endpoint at registration and
    # then fail every delivery: Stripe retries for up to three days before
    # disabling the endpoint, and Checkr's background-check results would never
    # arrive, stranding every driver mid-onboarding. Neither failure is visible
    # from the BidiRide side — the requests never reach a service, so nothing
    # logs them.
    #
    # Exact paths, not wildcards: these are single POST endpoints, and a wildcard
    # would route unintended sub-paths into the payment and driver services.
    payment-webhook = { priority = 120, service = "payment", paths = ["/webhooks/stripe"] }
    driver-webhook  = { priority = 130, service = "driver", paths = ["/webhooks/checkr"] }
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
