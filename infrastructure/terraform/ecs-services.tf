# ─── ECS Task Definitions, Services, IAM Roles, Secrets Manager ──────────────
# Companion to main.tf (ECS cluster) and ecr.tf (ECR repos).
# All 11 services are deployed as Fargate tasks behind the existing ALB.

# ─── Variables ────────────────────────────────────────────────────────────────

variable "db_name" { default = "bidride" }
variable "db_username" { default = "bidride_admin" }

# ─── IAM: ECS Execution Role (ECR pull + CloudWatch logs + Secrets Manager) ──

resource "aws_iam_role" "ecs_execution" {
  name = "bidride-ecs-execution-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "bidride-ecs-execution-secrets-${var.environment}"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:${var.aws_region}:*:secret:bidride/${var.environment}/*"
    }]
  })
}

# ─── IAM: ECS Task Role (runtime AWS resource access) ────────────────────────

resource "aws_iam_role" "ecs_task" {
  name = "bidride-ecs-task-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "bidride-ecs-task-s3-${var.environment}"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = [
        "${aws_s3_bucket.buckets["documents"].arn}/*",
        "${aws_s3_bucket.buckets["recordings"].arn}/*",
        "${aws_s3_bucket.buckets["photos"].arn}/*",
        "${aws_s3_bucket.buckets["tax_docs"].arn}/*",
      ]
      }, {
      Effect   = "Allow"
      Action   = ["s3:ListBucket"]
      Resource = values(aws_s3_bucket.buckets)[*].arn
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_kms" {
  name = "bidride-ecs-task-kms-${var.environment}"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
      Resource = aws_kms_key.recordings.arn
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_sqs" {
  name = "bidride-ecs-task-sqs-${var.environment}"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
      ]
      Resource = [for q in aws_sqs_queue.queues : q.arn]
    }]
  })
}

# ─── Secrets Manager ─────────────────────────────────────────────────────────
# Secrets are created as empty placeholders. Actual values are set via the
# AWS Console or CLI post-deploy — NEVER stored in Terraform state.

resource "aws_secretsmanager_secret" "shared" {
  for_each                = toset(["database-url", "redis-url", "jwt-secret", "internal-service-key"])
  name                    = "bidride/${var.environment}/${each.key}"
  recovery_window_in_days = 7

  tags = { Service = "shared" }
}

resource "aws_secretsmanager_secret" "per_service" {
  for_each = {
    "stripe-secret-key"               = "payment-service"
    "stripe-webhook-secret"           = "payment-service"
    "stripe-platform-account-id"      = "payment-service"
    "fcm-project-id"                  = "notification-service"
    "fcm-service-account-email"       = "notification-service"
    "fcm-service-account-private-key" = "notification-service"
    "twilio-account-sid"              = "notification-service"
    "twilio-auth-token"               = "notification-service"
    "twilio-phone-number"             = "notification-service"
    "twilio-proxy-service-sid"        = "safety-service"
    "checkr-api-key"                  = "driver-service"
    "checkr-webhook-secret"           = "driver-service"
    "admin-jwt-secret"                = "admin-service"
    "flightaware-api-key"             = "airport-service"
    "founder-jwt-secret"              = "admin-service"
  }

  name                    = "bidride/${var.environment}/${each.key}"
  recovery_window_in_days = 7

  tags = { Service = each.value }
}

locals {
  all_secrets = merge(aws_secretsmanager_secret.shared, aws_secretsmanager_secret.per_service)

  # Cloud Map private DNS — each service resolves as <name>.bidride.internal:<port>
  service_base_urls = {
    for k, v in local.ecs_services : k => "http://${k}.bidride.internal:${v.port}"
  }
}

# ─── Cloud Map: Private Service Discovery ────────────────────────────────────
# Gives every ECS task a stable DNS name within the VPC, eliminating the need
# for ALB hairpin routing for service-to-service calls.

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name        = "bidride.internal"
  description = "BidRide private service mesh"
  vpc         = module.vpc.vpc_id
}

resource "aws_service_discovery_service" "services" {
  for_each = local.ecs_services

  name = each.key

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ─── CloudWatch Log Groups ────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "services" {
  for_each          = toset(local.ecr_services)
  name              = "/ecs/bidride/${each.key}-${var.environment}"
  retention_in_days = 30
}

# ─── CloudWatch Alarms ────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "bidride-alb-5xx-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_ELB_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "ALB 5xx error rate elevated — check ECS service health"
  treat_missing_data  = "notBreaching"

  dimensions = { LoadBalancer = aws_lb.main.arn_suffix }
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "bidride-rds-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU above 80% for 3 consecutive minutes"
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = aws_db_instance.primary.identifier }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "bidride-rds-connections-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 400
  alarm_description   = "RDS connection count above 400 — connection pool leak or traffic spike"
  treat_missing_data  = "notBreaching"

  dimensions = { DBInstanceIdentifier = aws_db_instance.primary.identifier }
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu" {
  alarm_name          = "bidride-redis-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 60
  statistic           = "Average"
  threshold           = 70
  alarm_description   = "Redis CPU above 70% — possible slowlog commands or large key scans"
  treat_missing_data  = "notBreaching"

  dimensions = { ReplicationGroupId = aws_elasticache_replication_group.main.id }
}

# ─── Service Configuration ────────────────────────────────────────────────────
# Maps ECR key (auth-service) → port, sizing, ALB TG key, and secret names.

locals {
  ecs_services = {
    auth-service = {
      port          = 3001
      cpu           = 512
      memory        = 1024
      desired_count = 2
      alb_key       = "auth"
      secrets       = ["database-url", "redis-url", "jwt-secret", "twilio-account-sid", "twilio-auth-token", "twilio-phone-number"]
    }
    trip-service = {
      port          = 3002
      cpu           = 512
      memory        = 1024
      desired_count = 2
      alb_key       = "trip"
      secrets       = ["database-url", "redis-url", "jwt-secret", "internal-service-key"]
    }
    driver-service = {
      port          = 3003
      cpu           = 256
      memory        = 512
      desired_count = 2
      alb_key       = "driver"
      secrets       = ["database-url", "redis-url", "jwt-secret", "checkr-api-key", "checkr-webhook-secret"]
    }
    rider-service = {
      port          = 3004
      cpu           = 256
      memory        = 512
      desired_count = 2
      alb_key       = "rider"
      secrets       = ["database-url", "redis-url", "jwt-secret"]
    }
    pricing-service = {
      port          = 3005
      cpu           = 256
      memory        = 512
      desired_count = 1
      alb_key       = "pricing"
      secrets       = ["database-url", "redis-url", "internal-service-key"]
    }
    safety-service = {
      port          = 3006
      cpu           = 256
      memory        = 512
      desired_count = 2
      alb_key       = "safety"
      secrets       = ["database-url", "redis-url", "jwt-secret", "twilio-account-sid", "twilio-auth-token", "twilio-proxy-service-sid"]
    }
    payment-service = {
      port          = 3007
      cpu           = 256
      memory        = 512
      desired_count = 2
      alb_key       = "payment"
      secrets       = ["database-url", "redis-url", "jwt-secret", "stripe-secret-key", "stripe-webhook-secret", "stripe-platform-account-id"]
    }
    notification-service = {
      port          = 3008
      cpu           = 256
      memory        = 512
      desired_count = 1
      alb_key       = "notification"
      secrets       = ["database-url", "redis-url", "twilio-account-sid", "twilio-auth-token", "twilio-phone-number", "twilio-proxy-service-sid", "fcm-project-id", "fcm-service-account-email", "fcm-service-account-private-key"]
    }
    trust-service = {
      port          = 3009
      cpu           = 256
      memory        = 512
      desired_count = 1
      alb_key       = "trust"
      secrets       = ["database-url", "redis-url", "internal-service-key"]
    }
    airport-service = {
      port          = 3010
      cpu           = 256
      memory        = 512
      desired_count = 1
      alb_key       = "airport"
      secrets       = ["database-url", "redis-url", "jwt-secret", "flightaware-api-key"]
    }
    admin-service = {
      port          = 3011
      cpu           = 256
      memory        = 512
      desired_count = 1
      alb_key       = "admin"
      secrets       = ["database-url", "redis-url", "jwt-secret", "admin-jwt-secret", "founder-jwt-secret"]
    }
    ai-service = {
      port          = 3012
      cpu           = 1024
      memory        = 2048
      desired_count = 1
      alb_key       = null # VPC-internal only — not exposed through ALB
      secrets       = ["redis-url", "internal-service-key"]
    }
  }
}

# ─── ECS Task Definitions ─────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "services" {
  for_each = local.ecs_services

  family                   = "bidride-${each.key}-${var.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = each.key
    image     = "${aws_ecr_repository.services[each.key].repository_url}:latest"
    essential = true

    portMappings = [{
      containerPort = each.value.port
      protocol      = "tcp"
    }]

    environment = concat(
      [
        { name = "NODE_ENV", value = var.environment },
        { name = "PORT", value = tostring(each.value.port) },
        { name = "AI_SERVICE_URL", value = local.service_base_urls["ai-service"] },
      ],
      # trip-service → pricing, notification, driver, airport, trust
      each.key == "trip-service" ? [
        { name = "PRICING_SERVICE_URL", value = local.service_base_urls["pricing-service"] },
        { name = "NOTIFICATION_SERVICE_URL", value = local.service_base_urls["notification-service"] },
        { name = "DRIVER_SERVICE_URL", value = local.service_base_urls["driver-service"] },
        { name = "AIRPORT_SERVICE_URL", value = local.service_base_urls["airport-service"] },
        { name = "TRUST_SERVICE_URL", value = local.service_base_urls["trust-service"] },
      ] : [],
      # safety-service → notification, admin + S3/KMS for SOS recordings
      each.key == "safety-service" ? [
        { name = "NOTIFICATION_SERVICE_URL", value = local.service_base_urls["notification-service"] },
        { name = "ADMIN_SERVICE_URL", value = local.service_base_urls["admin-service"] },
        { name = "S3_RECORDINGS_BUCKET", value = aws_s3_bucket.buckets["recordings"].bucket },
        { name = "KMS_RECORDINGS_KEY_ID", value = aws_kms_key.recordings.key_id },
      ] : [],
      # payment-service → notification
      each.key == "payment-service" ? [
        { name = "NOTIFICATION_SERVICE_URL", value = local.service_base_urls["notification-service"] },
      ] : [],
      # trust-service → notification, admin
      each.key == "trust-service" ? [
        { name = "NOTIFICATION_SERVICE_URL", value = local.service_base_urls["notification-service"] },
        { name = "ADMIN_SERVICE_URL", value = local.service_base_urls["admin-service"] },
      ] : [],
      # admin-service → all other services for analytics/management
      each.key == "admin-service" ? [
        { name = "AUTH_SERVICE_URL", value = local.service_base_urls["auth-service"] },
        { name = "TRIP_SERVICE_URL", value = local.service_base_urls["trip-service"] },
        { name = "DRIVER_SERVICE_URL", value = local.service_base_urls["driver-service"] },
        { name = "RIDER_SERVICE_URL", value = local.service_base_urls["rider-service"] },
        { name = "PRICING_SERVICE_URL", value = local.service_base_urls["pricing-service"] },
        { name = "SAFETY_SERVICE_URL", value = local.service_base_urls["safety-service"] },
        { name = "PAYMENT_SERVICE_URL", value = local.service_base_urls["payment-service"] },
        { name = "NOTIFICATION_SERVICE_URL", value = local.service_base_urls["notification-service"] },
        { name = "TRUST_SERVICE_URL", value = local.service_base_urls["trust-service"] },
        { name = "AIRPORT_SERVICE_URL", value = local.service_base_urls["airport-service"] },
      ] : [],
      each.key == "rider-service" && var.google_maps_api_key != "" ? [
        { name = "GOOGLE_MAPS_API_KEY", value = var.google_maps_api_key }
      ] : [],
      each.key == "admin-service" && var.founder_signing_public_key != "" ? [
        { name = "FOUNDER_SIGNING_PUBLIC_KEY", value = var.founder_signing_public_key }
      ] : []
    )

    secrets = [
      for s in each.value.secrets : {
        name      = upper(replace(s, "-", "_"))
        valueFrom = local.all_secrets[s].arn
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services[each.key].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -sf http://localhost:${each.value.port}${each.key == "auth-service" ? "/health/live" : "/health"} || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = { Service = each.key }
}

# ─── ECS Services ─────────────────────────────────────────────────────────────
# Services with alb_key = null (ai-service) are VPC-internal and not attached
# to the ALB. All others get a load_balancer block.

locals {
  alb_services      = { for k, v in local.ecs_services : k => v if v.alb_key != null }
  internal_services = { for k, v in local.ecs_services : k => v if v.alb_key == null }
}

resource "aws_ecs_service" "alb_services" {
  for_each = local.alb_services

  name            = "bidride-${each.key}-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.services[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.services[each.value.alb_key].arn
    container_name   = each.key
    container_port   = each.value.port
  }

  service_registries {
    registry_arn = aws_service_discovery_service.services[each.key].arn
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy_attachment.ecs_execution,
  ]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = { Service = each.key }
}

resource "aws_ecs_service" "internal_services" {
  for_each = local.internal_services

  name            = "bidride-${each.key}-${var.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.services[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.private_subnets
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.services[each.key].arn
  }

  depends_on = [aws_iam_role_policy_attachment.ecs_execution]

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = { Service = each.key }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "ecs_service_names" {
  value = merge(
    { for k, svc in aws_ecs_service.alb_services : k => svc.name },
    { for k, svc in aws_ecs_service.internal_services : k => svc.name },
  )
}

output "secretsmanager_arns" {
  value = {
    shared      = { for k, s in aws_secretsmanager_secret.shared : k => s.arn }
    per_service = { for k, s in aws_secretsmanager_secret.per_service : k => s.arn }
  }
}
