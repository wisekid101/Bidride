# Terraform backend configuration — PRODUCTION
#
#   terraform init -reconfigure -backend-config=env/production.backend.hcl
#
# or: infrastructure/scripts/tf.sh production init
#
# This key is byte-identical to the value previously hardcoded in main.tf, so
# initialising with it targets the EXISTING production state. No migration.
key = "production/terraform.tfstate"
