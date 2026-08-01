# JWT Public-Key Population Runbook (B8B-1)

Operational steps to populate the RS256 public-key keysets **after** the B8B-1
Terraform is applied. This provisions *public* keys only — private key material
lives in KMS and is never exported, never placed in Git, and never stored in
Terraform state.

Applies to the two Secrets Manager placeholders created by B8B-1:

- `bidride/<env>/jwt-public-keys`        — user tokens (verified by auth, trip, driver, rider, pricing, safety, payment)
- `bidride/<env>/jwt-admin-public-keys`  — admin tokens (verified by admin-service only)

> Do **not** run these commands as part of B8B-1. They are for the operator at
> deploy time. B8B-1 only creates the KMS keys and empty secret placeholders.
>
> **For the full rollout procedure, follow `infrastructure/RS256_ROLLOUT_RUNBOOK.md`.**
> This document covers only the keyset population itself (§1–§6) and rotation (§7).
>
> **Deployment ordering — READ THIS FIRST.** `SEC-RS256-B1` has landed:
> `infrastructure/terraform/ecs-services.tf` now injects these secrets into the
> verifier task definitions as `JWT_PUBLIC_KEYS` and `JWT_ADMIN_PUBLIC_KEYS`.
>
> ECS refuses to start a task whose `secrets` entry resolves to a secret with **no
> value**. Therefore the order is mandatory and cannot be reversed:
>
> 1. **Populate both keysets first** (§1–§6 below).
> 2. **Then** `tf.sh <env> apply` — which registers new task-definition revisions.
> 3. **Then** `deploy-fleet.sh <env> <sha>` — which actually moves the verifier
>    services onto those revisions.
>
> Step 3 is not optional and is not implied by step 2. Every ECS service carries
> `lifecycle { ignore_changes = [task_definition] }`, so `terraform apply`
> registers revisions but never moves a service onto one. **`terraform apply` is
> not a deployment** — see `DEPLOYMENT_RUNBOOK.md`.
>
> Populating first is safe and inert: the verifiers accept both HS256 and RS256
> per token, and nothing signs RS256 until `jwt_signing_alg` is set to `RS256`, so
> a populated keyset changes no behaviour on its own.
>
> ⚠️ **Correction to earlier revisions of this runbook.** This section previously
> claimed that "applying the Terraform before populating the keysets will fail
> every verifier task launch". That was wrong. Because of `ignore_changes`, tasks
> never moved to the new revision at all, so neither the failure *nor the intended
> success* could occur — the guardrail operators were relying on did not exist.
> Populate-first is still correct, but the real reason is step 3: once
> `deploy-fleet.sh` moves services onto the new revision, an empty secret blocks
> task startup for real.
>
> Services receiving `JWT_PUBLIC_KEYS` (user domain, 8): auth, trip, driver, rider,
> pricing, safety, payment, admin. `admin-service` additionally receives
> `JWT_ADMIN_PUBLIC_KEYS` because it verifies **both** domains — user tokens on the
> support-ticket routes and its own admin sessions. notification, trust, airport,
> and ai-service have no user-token verifier and are deliberately excluded.

---

## Keyset JSON schema (canonical contract)

Both secrets — `jwt-public-keys` and `jwt-admin-public-keys` — use the **same**
schema. This is the single source of truth: the population steps below and the
future B8C verifiers (which will load and parse these secrets) MUST agree on it.

- The secret value is a **JSON object** (not an array).
- Each **key** is a `kid` string (e.g. `"v1"`, `"v2"`).
- Each **value** is the corresponding **public** key as an SPKI PEM string
  (`-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n`).
- 1 entry in steady state; ≥2 entries only during a rotation overlap window.
- **Never** contains a private key (`PRIVATE KEY` must never appear).
- The two domains are separate secrets and MUST NOT share `kid`/key material:
  `jwt-public-keys` holds user-token keys; `jwt-admin-public-keys` holds admin
  keys only.

```json
{
  "<kid>": "-----BEGIN PUBLIC KEY-----\n<base64>\n-----END PUBLIC KEY-----\n"
}
```

A B8C verifier reads the token header `kid`, looks it up in this object, and
verifies with the returned PEM (RS256). An unknown `kid` → reject.

---

## 0. Prerequisites

- Terraform applied (KMS keys + aliases + secret placeholders exist).
- AWS CLI with permission to `kms:GetPublicKey` and `secretsmanager:PutSecretValue`.
- `<env>` = the Terraform `environment` (default `production`).

Get the key ids from Terraform outputs:

```
terraform output kms_jwt_user_key_id
terraform output kms_jwt_admin_key_id
```

(Or use the aliases `alias/bidride-jwt-user-<env>` / `alias/bidride-jwt-admin-<env>`.)

---

## 1. Obtain each KMS public key (`kms:GetPublicKey`)

KMS returns the public key as DER bytes; convert to PEM (SPKI):

```
aws kms get-public-key \
  --key-id alias/bidride-jwt-user-<env> \
  --query PublicKey --output text \
  | base64 -d > jwt-user-pub.der

openssl pkey -pubin -inform DER -in jwt-user-pub.der -out jwt-user-pub.pem
# jwt-user-pub.pem is a standard "-----BEGIN PUBLIC KEY-----" SPKI PEM.
```

Repeat with `alias/bidride-jwt-admin-<env>` → `jwt-admin-pub.pem`.

These `.pem` files contain **only public keys** — safe to handle, but still do
not commit them to Git. Delete the local files when finished.

---

## 2. Choose and record the `kid`

- `kid` is a short, stable label identifying the key generation, **not** the key
  material. Use `v1` for the first key (`v2`, `v3`, … for later rotations).
- Record which `kid` maps to which KMS key ARN in your secure ops notes (not in
  Git). The application selects the verification key by the token-header `kid`.

---

## 3. Build the keyset JSON

The keyset is a JSON object mapping `kid` → public-key PEM. During normal
operation it holds a single key; during rotation it holds **both** the outgoing
and incoming keys (see §6).

```
# Single key (steady state):
jq -n --arg v1 "$(cat jwt-user-pub.pem)" '{ "v1": $v1 }' > jwt-user-keyset.json
```

Result shape:

```json
{
  "v1": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

Build `jwt-admin-keyset.json` the same way from `jwt-admin-pub.pem`.

---

## 4. Populate `jwt-public-keys` (user domain)

```
aws secretsmanager put-secret-value \
  --secret-id bidride/<env>/jwt-public-keys \
  --secret-string file://jwt-user-keyset.json
```

## 5. Populate `jwt-admin-public-keys` (admin domain)

```
aws secretsmanager put-secret-value \
  --secret-id bidride/<env>/jwt-admin-public-keys \
  --secret-string file://jwt-admin-keyset.json
```

Keep the user and admin keysets strictly separate — never place the admin key in
the user keyset or vice-versa.

---

## 6. Verify the keyset format

The scripted check does all of the below, plus an end-to-end `kms:Sign` →
openssl-verify round trip proving the key and the keyset are a matching pair:

```
bash infrastructure/scripts/verify-deployment.sh <env> all
```
Sections 2, 3 and 6 must pass.

Manual equivalent:

```
aws secretsmanager get-secret-value \
  --secret-id bidride/<env>/jwt-public-keys \
  --query SecretString --output text | jq .
```

Checks:
- Valid JSON object; each value begins with `-----BEGIN PUBLIC KEY-----`.
- Each `kid` present matches a `kid` the issuer will stamp (`jwt_signing_kid`).
- No private-key markers anywhere (`PRIVATE KEY` must never appear).
- The user and admin keysets share no key material.

---

## 7. Rotation — overlapping keys

When rotating (new KMS key created via Terraform with a new alias/`kid`):

1. `GetPublicKey` for the **new** key (§1) and add it to the keyset **alongside**
   the current key:
   ```json
   { "v1": "<current PEM>", "v2": "<new PEM>" }
   ```
   `put-secret-value` the two-key set, then redeploy verifiers so they load both:
   ```
   infrastructure/scripts/deploy-fleet.sh <env> <sha>
   ```
2. Flip the **issuer** to sign with the new `kid`: set `jwt_signing_kid = "v2"`
   in `env/<env>.tfvars`, `tf.sh <env> apply`, then
   `deploy-fleet.sh <env> <sha> --only auth-service` (and `admin-service`).
   Tokens signed with `v1` remain valid because verifiers still hold `v1`.
3. After the access-token TTL window (plus refresh churn), remove `v1` from the
   keyset, redeploy verifiers again, and retire/disable the old KMS key.

Steps 1 and 3 are real deployments, not restarts. A changed secret **value**
under an existing reference is re-resolved when a task restarts; a changed
**reference** requires a new task-definition revision to be deployed.

At no point is a verifier without the key it needs — the overlap guarantees zero
verification gap.

---

## 8. Never do

- Never export or store the **private** key (it cannot leave KMS anyway).
- Never put key material in Git or Terraform state.
- Never reuse one `kid` for two different keys.
- Never merge the user and admin trust domains into one keyset.

Domain separation is enforced in code, not by convention alone — two resolvers
read two different environment variables and neither falls back to the other:

| Domain | Resolver | Reads | Audience |
|---|---|---|---|
| user | `<service>/src/user-jwt-verification.ts` (8 copies) | `JWT_PUBLIC_KEYS` | `bidride-user` |
| admin | `admin-service/src/admin-jwt-verification.ts` | `JWT_ADMIN_PUBLIC_KEYS` | `bidride-admin` |

If a `kid` is placed in the wrong keyset, verification fails closed rather than
crossing domains. Tests assert this explicitly.

---

## Emergency revocation

To revoke a compromised signing key immediately: **disable** the KMS key in the
console/CLI (`aws kms disable-key`). All tokens carrying that `kid` fail
verification at once. Rotate to a fresh key/`kid` per §7. The 15-minute access
token TTL and the server-side revocable refresh tokens bound the exposure window.
