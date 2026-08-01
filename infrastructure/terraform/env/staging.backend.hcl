# Terraform backend configuration — STAGING
#
#   terraform init -reconfigure -backend-config=env/staging.backend.hcl
#
# or: infrastructure/scripts/tf.sh staging init
#
# Separate key ⇒ separate state file ⇒ staging can never plan against, or
# destroy, production infrastructure. Same bucket, which is intentional: one
# bucket to secure, version and audit.
key = "staging/terraform.tfstate"
