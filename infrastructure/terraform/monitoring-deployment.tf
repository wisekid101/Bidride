# ─── Deployment & RS256 Rollout Monitoring ───────────────────────────────────
# SEC-RS256-DEPLOY blocker 5.
#
# Before this file, an RS256 rollout was unobservable. Its failure mode is a
# 401, and the only HTTP alarm in the stack watched ELB *5xx* — so a fleet that
# had silently lost its keyset looked identical to a healthy one at every
# checkpoint the pipeline provided.
#
# WHY LOG METRIC FILTERS AND NOT COUNTERS
# ---------------------------------------
# The obvious implementation is a counter inside the JWT resolver. This sprint
# is explicitly forbidden from touching JWT verification or signing code, so
# every signal here is derived from output the services ALREADY produce:
#
#   - packages/observability CorrelationMiddleware emits one structured JSON
#     line per request ("http_request") carrying statusCode. That is the
#     verification-failure signal.
#   - jwt-signer.provider.ts logs the issuance algorithm once at boot, and
#     jwt-signing.config.ts throws documented strings when RS256 is
#     misconfigured. Those are the algorithm and KMS signals.
#
# One consequence is stated plainly rather than papered over: UNKNOWN-KID
# rejections are NOT separable here. resolveUserJwtVerification throws, the
# guard catches with a bare `catch {}`, and nothing is logged — so an unknown
# kid is indistinguishable from an expired token in the 401 stream. Closing
# that gap requires a one-line emission in the shared resolver and is tracked
# as SEC-RS256-OBS. See infrastructure/RS256_ROLLOUT_RUNBOOK.md §6.

locals {
  # Services that verify user tokens — the ones whose 401 rate is a keyset
  # health signal. Derived from the secrets map so it cannot drift.
  jwt_verifier_services = [
    for k, v in local.ecs_services : k if contains(v.secrets, "jwt-public-keys")
  ]

  # Services that can be configured to SIGN with KMS.
  jwt_signer_services = ["auth-service", "admin-service"]

  deployment_metric_namespace = "BidRide/Deployment"
}

# ─── JWT verification failures (401 rate per verifier) ───────────────────────
# Pattern targets the structured request-completion line, so it counts real
# rejected requests rather than any log line mentioning 401.

resource "aws_cloudwatch_log_metric_filter" "jwt_verification_failures" {
  for_each = toset(local.jwt_verifier_services)

  name           = "bidride-jwt-verification-failures-${each.key}-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.services[each.key].name
  pattern        = "{ $.message = \"http_request\" && $.statusCode = 401 }"

  metric_transformation {
    name       = "JwtVerificationFailures"
    namespace  = local.deployment_metric_namespace
    value      = "1"
    unit       = "Count"
    dimensions = { service = "$.service" }
  }
}

# Total request volume on the same line shape, so the alarm below can be read
# as a RATE rather than a raw count — 50 failures means something very
# different at 100 rps than at 100 rpm.
resource "aws_cloudwatch_log_metric_filter" "http_requests" {
  for_each = toset(local.jwt_verifier_services)

  name           = "bidride-http-requests-${each.key}-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.services[each.key].name
  pattern        = "{ $.message = \"http_request\" }"

  metric_transformation {
    name       = "HttpRequests"
    namespace  = local.deployment_metric_namespace
    value      = "1"
    unit       = "Count"
    dimensions = { service = "$.service" }
  }
}

# Alarm on the PROPORTION of 401s. A keyset that failed to load turns a
# specific population of requests into blanket rejections, which shows up as a
# step change in ratio, not as a threshold on absolute count.
resource "aws_cloudwatch_metric_alarm" "jwt_verification_failure_ratio" {
  for_each = toset(local.jwt_verifier_services)

  alarm_name          = "bidride-jwt-401-ratio-${each.key}-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  threshold           = 0.25
  treat_missing_data  = "notBreaching"
  alarm_description   = <<-EOT
    Over 25% of ${each.key} requests are returning 401 for 3 consecutive minutes.
    During an RS256 rollout the first suspect is a missing or mismatched
    JWT_PUBLIC_KEYS keyset on the running task definition. Confirm with:
      bash infrastructure/scripts/verify-deployment.sh ${var.environment} ${each.key}
  EOT

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "ratio"
    expression  = "IF(total > 10, failures / total, 0)"
    label       = "401 ratio (${each.key})"
    return_data = true
  }

  metric_query {
    id = "failures"
    metric {
      metric_name = "JwtVerificationFailures"
      namespace   = local.deployment_metric_namespace
      period      = 60
      stat        = "Sum"
      dimensions  = { service = each.key }
    }
  }

  metric_query {
    id = "total"
    metric {
      metric_name = "HttpRequests"
      namespace   = local.deployment_metric_namespace
      period      = 60
      stat        = "Sum"
      dimensions  = { service = each.key }
    }
  }
}

# ─── Issuance algorithm distribution (HS256 vs RS256) ────────────────────────
# auth-service and admin-service each log their resolved algorithm exactly once
# per task start (jwt-signer.provider.ts). Counting those lines gives a per-task
# census of what the fleet is issuing — which is the actionable rollout
# question. These are Nest Logger text lines, not JSON, so the patterns are
# substring matches.

resource "aws_cloudwatch_log_metric_filter" "jwt_issuance_rs256" {
  for_each = toset(local.jwt_signer_services)

  name           = "bidride-jwt-issuance-rs256-${each.key}-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.services[each.key].name
  pattern        = "\"JWT issuance algorithm: RS256\""

  # No dimensions: CloudWatch can only attach a dimension whose VALUE it can
  # extract from the log event (a JSON $.field or a space-delimited $N token).
  # These patterns are quoted substrings against Nest Logger text lines, so
  # there is nothing to extract and PutMetricFilter answers "The specified
  # filter pattern does not support dimensions". The service therefore lives in
  # the metric NAME, which keeps per-service attribution intact.
  metric_transformation {
    name      = "JwtIssuanceRs256-${each.key}"
    namespace = local.deployment_metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_log_metric_filter" "jwt_issuance_hs256" {
  for_each = toset(local.jwt_signer_services)

  name           = "bidride-jwt-issuance-hs256-${each.key}-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.services[each.key].name
  pattern        = "\"JWT issuance algorithm: HS256\""

  metric_transformation {
    name      = "JwtIssuanceHs256-${each.key}"
    namespace = local.deployment_metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

# ─── RS256 misconfiguration and KMS signing failures ─────────────────────────
# jwt-signing.config.ts refuses to start on any RS256 misconfiguration, with
# documented message prefixes. A task crash-looping at boot is otherwise only
# visible as "service won't stabilise", which does not say why.

resource "aws_cloudwatch_log_metric_filter" "jwt_rs256_boot_failure" {
  for_each = toset(local.jwt_signer_services)

  name           = "bidride-jwt-rs256-boot-failure-${each.key}-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.services[each.key].name
  pattern        = "?\"RS256 issuance is enabled but\" ?\"does not match the keyset entry for kid\" ?\"is not a usable SPKI public key\" ?\"Could not fetch the KMS public key\""

  metric_transformation {
    name      = "JwtRs256BootFailure-${each.key}"
    namespace = local.deployment_metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "jwt_rs256_boot_failure" {
  for_each = toset(local.jwt_signer_services)

  alarm_name          = "bidride-jwt-rs256-boot-failure-${each.key}-${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "JwtRs256BootFailure-${each.key}"
  namespace           = local.deployment_metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_description   = <<-EOT
    ${each.key} refused to start: RS256 issuance is enabled but the KMS key and
    the published keyset disagree. The service is failing closed — it will not
    issue tokens no verifier can check. Set jwt_signing_alg back to HS256 and
    re-run the keyset population runbook before retrying.
  EOT

  # The service is in the metric name, not a dimension — see the filter above.
  alarm_actions = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_log_metric_filter" "kms_signing_failure" {
  for_each = toset(local.jwt_signer_services)

  name           = "bidride-kms-signing-failure-${each.key}-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.services[each.key].name
  pattern        = "?\"kms:Sign returned no signature\" ?\"KMS returned an empty signature\" ?\"kms:GetPublicKey returned no key\" ?\"KMSInvalidStateException\" ?\"AccessDeniedException\""

  metric_transformation {
    name      = "KmsSigningFailure-${each.key}"
    namespace = local.deployment_metric_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "kms_signing_failure" {
  for_each = toset(local.jwt_signer_services)

  alarm_name          = "bidride-kms-signing-failure-${each.key}-${var.environment}"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "KmsSigningFailure-${each.key}"
  namespace           = local.deployment_metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_description   = <<-EOT
    ${each.key} failed a kms:Sign / kms:GetPublicKey call. If RS256 issuance is
    enabled this means login is broken. Check the task role's KMS grant and the
    key's state (a disabled key is the emergency-revocation path, so this alarm
    is expected during a deliberate revocation).
  EOT

  # The service is in the metric name, not a dimension — see the filter above.
  alarm_actions = [aws_sns_topic.alerts.arn]
}

# ─── ECS task health (deployment failures) ───────────────────────────────────
# ECS publishes RunningTaskCount and DesiredTaskCount under ECS/ContainerInsights.
# A deployment that cannot place healthy tasks shows here first, and this is the
# signal that the circuit breaker on each service is acting on.

resource "aws_cloudwatch_metric_alarm" "ecs_running_below_desired" {
  for_each = local.ecs_services

  alarm_name          = "bidride-ecs-tasks-below-desired-${each.key}-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = var.deployment_alarm_evaluation_periods
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_description   = <<-EOT
    ${each.key} is running fewer tasks than desired for
    ${var.deployment_alarm_evaluation_periods} consecutive minutes — a failed
    deployment, a crash loop, or capacity starvation. During an RS256 rollout,
    a crash loop on auth-service or admin-service is most likely the boot guard
    refusing a mismatched keyset; check the RS256 boot-failure alarm.
  EOT

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  metric_query {
    id          = "deficit"
    expression  = "running - desired"
    label       = "running - desired (${each.key})"
    return_data = true
  }

  metric_query {
    id = "running"
    metric {
      metric_name = "RunningTaskCount"
      namespace   = "ECS/ContainerInsights"
      period      = 60
      stat        = "Average"
      dimensions = {
        ClusterName = aws_ecs_cluster.main.name
        ServiceName = "bidride-${each.key}-${var.environment}"
      }
    }
  }

  metric_query {
    id = "desired"
    metric {
      metric_name = "DesiredTaskCount"
      namespace   = "ECS/ContainerInsights"
      period      = 60
      stat        = "Average"
      dimensions = {
        ClusterName = aws_ecs_cluster.main.name
        ServiceName = "bidride-${each.key}-${var.environment}"
      }
    }
  }
}

# ─── ALB target 4xx ──────────────────────────────────────────────────────────
# The pre-existing ALB alarm watches 5xx only. A broken keyset produces 401s,
# which are 4xx — the exact blind spot that made the previous rollout plan
# unverifiable.

resource "aws_cloudwatch_metric_alarm" "alb_target_4xx" {
  alarm_name          = "bidride-alb-target-4xx-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "HTTPCode_Target_4XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 100
  treat_missing_data  = "notBreaching"
  alarm_description   = "Target 4xx elevated — during an RS256 rollout, suspect JWT verification before anything else."

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  dimensions = { LoadBalancer = aws_lb.main.arn_suffix }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "jwt_verifier_services" {
  description = "Services that receive JWT_PUBLIC_KEYS and must be rolled together."
  value       = sort(local.jwt_verifier_services)
}

output "deployment_metric_namespace" { value = local.deployment_metric_namespace }
