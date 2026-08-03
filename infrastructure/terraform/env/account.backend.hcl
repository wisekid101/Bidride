# Terraform backend configuration — SHARED ACCOUNT
#
#   cd infrastructure/terraform/account
#   terraform init -reconfigure -backend-config=../env/account.backend.hcl
#
# A fourth state key alongside staging/, production/ and dns/. Account-wide
# singletons live here and nowhere else, so the environment module — which is
# rendered twice against one account — cannot declare them twice and have the
# two states overwrite each other on every apply.
key = "account/terraform.tfstate"
