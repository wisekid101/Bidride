# ─── ECR Repositories ─────────────────────────────────────────────────────────
# One repository per service. Images are tagged :latest (CD pipeline overwrites)
# and :YYYYMMDD-<git-sha> for rollback.

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

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 production images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["prod-"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
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
