terraform {
  required_version = ">= 1.8"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket         = "bidride-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "bidride-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "BidRide"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "aws_region"           { default = "us-east-1" }
variable "environment"          { default = "production" }
variable "db_instance_class"    { default = "db.r6g.large" }
variable "cache_node_type"      { default = "cache.r6g.large" }
variable "db_password"          { sensitive = true }
variable "founder_email"        {}
variable "google_maps_api_key"       { sensitive = true; default = "" }
variable "founder_signing_public_key" { sensitive = false; default = "" }

# ─── VPC ─────────────────────────────────────────────────────────────────────

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "bidride-${var.environment}"
  cidr = "10.0.0.0/16"

  azs             = ["us-east-1a", "us-east-1b", "us-east-1c"]
  public_subnets  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  private_subnets = ["10.0.10.0/24", "10.0.11.0/24", "10.0.12.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = false  # HA: one NAT per AZ
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# ─── Security Groups ──────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name   = "bidride-alb-${var.environment}"
  vpc_id = module.vpc.vpc_id

  ingress { from_port = 443; to_port = 443; protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  ingress { from_port = 80;  to_port = 80;  protocol = "tcp"; cidr_blocks = ["0.0.0.0/0"] }
  egress  { from_port = 0;   to_port = 0;   protocol = "-1";  cidr_blocks = ["0.0.0.0/0"] }
}

resource "aws_security_group" "ecs" {
  name   = "bidride-ecs-${var.environment}"
  vpc_id = module.vpc.vpc_id

  # ALB → ECS: services on ports 3001–3011
  ingress {
    from_port       = 3001
    to_port         = 3011
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # ECS → ECS: internal service-to-service (e.g., trip/trust/pricing calling ai-service on 3012)
  ingress {
    from_port = 3001
    to_port   = 3012
    protocol  = "tcp"
    self      = true
  }

  egress { from_port = 0; to_port = 0; protocol = "-1"; cidr_blocks = ["0.0.0.0/0"] }
}

resource "aws_security_group" "rds" {
  name   = "bidride-rds-${var.environment}"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
}

resource "aws_security_group" "elasticache" {
  name   = "bidride-elasticache-${var.environment}"
  vpc_id = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
}

# ─── RDS PostgreSQL Multi-AZ ──────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "bidride-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "primary" {
  identifier        = "bidride-${var.environment}"
  engine            = "postgres"
  engine_version    = "15.6"
  instance_class    = var.db_instance_class
  allocated_storage = 100
  storage_encrypted = true
  storage_type      = "gp3"

  db_name  = "bidride"
  username = "bidride_admin"
  password = var.db_password

  multi_az               = true
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = 30
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  deletion_protection     = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "bidride-${var.environment}-final"

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = { Name = "bidride-primary-${var.environment}" }
}

resource "aws_db_instance" "replica_analytics" {
  identifier          = "bidride-${var.environment}-replica-analytics"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.db_instance_class
  publicly_accessible = false

  vpc_security_group_ids = [aws_security_group.rds.id]
  tags = { Name = "bidride-replica-analytics-${var.environment}" }
}

resource "aws_db_instance" "replica_admin" {
  identifier          = "bidride-${var.environment}-replica-admin"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.db_instance_class
  publicly_accessible = false

  vpc_security_group_ids = [aws_security_group.rds.id]
  tags = { Name = "bidride-replica-admin-${var.environment}" }
}

# ─── ElastiCache Redis ────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "bidride-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "bidride-${var.environment}"
  description          = "BidRide Redis cluster"

  node_type            = var.cache_node_type
  num_cache_clusters   = 3
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name       = aws_elasticache_subnet_group.main.name
  security_group_ids      = [aws_security_group.elasticache.id]
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true

  automatic_failover_enabled = true
  multi_az_enabled           = true

  snapshot_retention_limit = 7
  snapshot_window          = "04:00-05:00"
}

# ─── ECS Cluster ─────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "bidride-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 100
    capacity_provider = "FARGATE"
  }
}

# ─── S3 Buckets ───────────────────────────────────────────────────────────────

locals {
  buckets = {
    documents  = "bidride-driver-documents-${var.environment}"
    recordings = "bidride-safety-recordings-${var.environment}"
    photos     = "bidride-profile-photos-${var.environment}"
    exports    = "bidride-exports-${var.environment}"
    tax_docs   = "bidride-tax-documents-${var.environment}"
  }
}

resource "aws_s3_bucket" "buckets" {
  for_each = local.buckets
  bucket   = each.value

  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "buckets" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.buckets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_versioning" "recordings" {
  bucket = aws_s3_bucket.buckets["recordings"].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "buckets" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.buckets[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── SQS Queues ───────────────────────────────────────────────────────────────

locals {
  queues = [
    "trip-events",
    "notifications",
    "rating-updates",
    "email-sends",
    "floor-logs",
    "fraud-alerts",
    "payout-processing",
    "driver-approval",
  ]
}

resource "aws_sqs_queue" "queues" {
  for_each                  = toset(local.queues)
  name                      = "bidride-${each.key}-${var.environment}"
  message_retention_seconds = 86400
  visibility_timeout_seconds = 300
  kms_master_key_id         = "alias/aws/sqs"
}

resource "aws_sqs_queue" "dlqs" {
  for_each                  = toset(local.queues)
  name                      = "bidride-${each.key}-${var.environment}-dlq"
  message_retention_seconds = 1209600  # 14 days
}

# ─── ALB ─────────────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "bidride-${var.environment}"
  load_balancer_type = "application"
  subnets            = module.vpc.public_subnets
  security_groups    = [aws_security_group.alb.id]

  enable_deletion_protection = true

  access_logs {
    bucket  = aws_s3_bucket.buckets["exports"].id
    prefix  = "alb-access-logs"
    enabled = true
  }
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "rds_endpoint"         { value = aws_db_instance.primary.endpoint }
output "redis_endpoint"       { value = aws_elasticache_replication_group.main.primary_endpoint_address }
output "alb_dns_name"         { value = aws_lb.main.dns_name }
output "ecs_cluster_name"     { value = aws_ecs_cluster.main.name }
output "recordings_bucket"    { value = aws_s3_bucket.buckets["recordings"].bucket }
output "documents_bucket"     { value = aws_s3_bucket.buckets["documents"].bucket }
