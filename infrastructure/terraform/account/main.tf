# ─── Shared Account Foundation ────────────────────────────────────────────────
#
# This root module owns account-wide, region-scoped SINGLETONS — resources of
# which exactly one exists per AWS account and region, regardless of how many
# environments are deployed into it.
#
# WHY A SEPARATE STATE:
# staging and production are the SAME root module rendered twice against two
# state files, differentiated only by var.environment and the backend key. A
# singleton declared there would be declared twice, and the two states would
# fight over it: each `terraform apply` would overwrite the other's version and
# report perpetual drift. Putting singletons in their own state makes that
# conflict structurally impossible rather than dependent on a flag.
#
# This mirrors the reasoning already applied to the hosted zone in dns/, which
# is deliberately scoped to shared DNS only and must not accumulate unrelated
# resources.
#
# Initialise with:
#   terraform init -reconfigure -backend-config=../env/account.backend.hcl
# using key "account/terraform.tfstate".
#
# NOT YET APPLIED — creating this state is a Founder gate.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket       = "bidride-terraform-state"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "bidiride"
      ManagedBy = "terraform"
      Scope     = "shared-account"
    }
  }
}

variable "aws_region" {
  description = "Region whose registry-level settings this state owns."
  type        = string
  default     = "us-east-1"
}

# ─── ECR registry scanning ────────────────────────────────────────────────────
#
# ecr.tf sets image_scanning_configuration { scan_on_push = true } on every
# repository. That is the LEGACY per-repository setting. AWS now evaluates
# scanning against the REGISTRY-level configuration, and this account's registry
# reported:
#
#   { "scanType": "BASIC", "rules": [] }
#
# An empty rules list means no image is ever scanned, no matter what the
# per-repository flag says. Verified against a freshly pushed image:
#
#   DescribeImageScanFindings → ScanNotFoundException: Image scan does not exist
#
# So all twelve repositories advertised scanning while producing nothing — a
# security control that reads as enabled in the console and in Terraform, and
# silently does no work. That failure mode is worse than having no scanning at
# all, because it answers "are we scanning images?" with a confident yes.
#
# BASIC scanning is free and runs on push. The wildcard filter covers every
# current and future bidride/* repository, so a new service cannot be created
# unscanned.
resource "aws_ecr_registry_scanning_configuration" "this" {
  scan_type = "BASIC"

  rule {
    scan_frequency = "SCAN_ON_PUSH"

    repository_filter {
      filter      = "*"
      filter_type = "WILDCARD"
    }
  }
}

output "ecr_scanning" {
  description = "Registry-level ECR scanning actually in force for this account and region."
  value = {
    scan_type      = aws_ecr_registry_scanning_configuration.this.scan_type
    scan_frequency = "SCAN_ON_PUSH"
    applies_to     = "* (all repositories)"
  }
}
