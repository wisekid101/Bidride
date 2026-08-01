# ─── ECR Repositories ─────────────────────────────────────────────────────────
# One repository per service. The CD pipeline pushes an immutable :<git-sha> tag
# and a mutable :latest tag used ONLY as a Docker layer cache source.
#
# Deployments never reference a tag. deploy-service.sh resolves :<git-sha> to
# its sha256 DIGEST and pins the task definition to repo@sha256:… — immutable
# regardless of what any tag later points at. That is what makes "roll back to
# this exact ARN" mean "roll back to these exact bytes".

locals {
  ecr_services = [
    "auth-service",
    "trip-service",
    "driver-service",
    "rider-service",
    "pricing-service",
    "safety-service",
    "payment-service",
    "notification-service",
    "trust-service",
    "airport-service",
    "admin-service",
    "ai-service",
  ]
}

resource "aws_ecr_repository" "services" {
  for_each = toset(local.ecr_services)

  name                 = "bidride/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Environment = var.environment
    Service     = each.key
  }
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name

  # Retention exists to protect ROLLBACK TARGETS, not to save storage.
  #
  # The previous policy retained only images tagged `prod-*` — a prefix this
  # pipeline has never produced — and expired untagged images after 7 days.
  # Under digest-pinned deployment that combination is destructive: re-pushing
  # a tag leaves the previously-tagged image untagged, and 7 days later the
  # digest a running task definition points at is deleted. ECR image deletion
  # does not fail a running task, but it makes the service unrecoverable the
  # moment it needs to place a new one.
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain the last 60 tagged builds — the rollback horizon"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 60
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 90 days (was 7 — too short to roll back to)"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 90
        }
        action = { type = "expire" }
      }
    ]
  })
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "ecr_repository_urls" {
  value = { for k, repo in aws_ecr_repository.services : k => repo.repository_url }
}
