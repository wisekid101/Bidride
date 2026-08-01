# ─── Shared DNS Foundation ────────────────────────────────────────────────────
#
# This root module owns EXACTLY ONE thing: the single authoritative public
# hosted zone for the company domain. It is deliberately separate from the
# staging/production root module.
#
# WHY A SEPARATE STATE:
# staging and production are the SAME root module rendered twice against two
# state files, differentiated only by var.environment and the backend key. If
# the hosted zone lived there, EACH state would create its own zone for
# bidiride.com — two authoritative zones with different nameserver sets, only
# one of which the registrar can delegate to. Putting the zone in its own state
# makes that duplication structurally impossible rather than dependent on a
# flag being set correctly.
#
# It also means `terraform destroy` on staging (or production) cannot reach the
# company domain: the zone is not in that state at all.
#
# Certificates, validation records and API alias records deliberately do NOT
# live here — they are per-environment and are owned by the environment that
# uses them. This state owns shared, long-lived DNS only.

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Initialise with:
  #   terraform init -reconfigure -backend-config=../env/dns.backend.hcl
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
      Scope     = "shared-dns"
    }
  }
}

variable "aws_region" {
  description = "Region for the DNS state. Route 53 is global; this is for provider/state consistency."
  type        = string
  default     = "us-east-1"
}

variable "root_domain" {
  description = "The canonical company domain. One authoritative public zone only."
  type        = string
  default     = "bidiride.com"

  validation {
    condition     = var.root_domain == "bidiride.com"
    error_message = "root_domain must be bidiride.com. bidride.com is a different domain this project does not control."
  }
}

# ─── The authoritative public hosted zone ────────────────────────────────────
#
# prevent_destroy is not paranoia: once the registrar delegates to these
# nameservers, destroying this zone takes the company's DNS offline and a
# recreated zone gets DIFFERENT nameservers, requiring another registrar change
# and another propagation window.
#
# Removing prevent_destroy is an extraordinary action — see
# infrastructure/DEPLOYMENT_RUNBOOK.md before doing so.
resource "aws_route53_zone" "root" {
  name    = var.root_domain
  comment = "Authoritative public zone for ${var.root_domain}. Owned solely by the dns/ Terraform state."

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name = var.root_domain
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────
#
# hosted_zone_id is passed to each environment as an EXPLICIT input variable —
# not via terraform_remote_state. Explicit input keeps the states decoupled, so
# a change here can never ripple into an environment plan unreviewed.

output "hosted_zone_id" {
  description = "Route 53 zone ID. Set as route53_zone_id in each env/<environment>.tfvars."
  value       = aws_route53_zone.root.zone_id
}

output "hosted_zone_name" {
  description = "The zone's domain name."
  value       = aws_route53_zone.root.name
}

output "hosted_zone_name_servers" {
  description = "The four nameservers to enter at the registrar (GoDaddy). Review before delegating."
  value       = aws_route53_zone.root.name_servers
}
