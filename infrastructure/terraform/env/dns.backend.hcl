# Terraform backend configuration — SHARED DNS
#
#   cd infrastructure/terraform/dns
#   terraform init -reconfigure -backend-config=../env/dns.backend.hcl
#
# A third state key alongside staging/ and production/. The hosted zone lives
# here and nowhere else, so neither environment can create a duplicate zone or
# destroy the company domain — it is not in their state at all.
key = "dns/terraform.tfstate"
