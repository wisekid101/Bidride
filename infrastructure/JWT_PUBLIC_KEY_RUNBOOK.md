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
> **Deployment ordering:** B8B-1 creates the placeholders but does **not** inject
> them into any ECS task definition. Populate the keysets with these steps, then
> a later batch (**B8B-2 — Public-Key Keyset Activation**) validates the keysets
> and injects them into the verifier task definitions. This ordering prevents an
> ECS task from rolling with a secret reference that has no value yet.

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

```
aws secretsmanager get-secret-value \
  --secret-id bidride/<env>/jwt-public-keys \
  --query SecretString --output text | jq .
```

Checks:
- Valid JSON object; each value begins with `-----BEGIN PUBLIC KEY-----`.
- Each `kid` present matches a `kid` the issuer will stamp.
- No private-key markers anywhere (`PRIVATE KEY` must never appear).

---

## 7. Rotation — overlapping keys

When rotating (new KMS key created via Terraform with a new alias/`kid`):

1. `GetPublicKey` for the **new** key (§1) and add it to the keyset **alongside**
   the current key:
   ```json
   { "v1": "<current PEM>", "v2": "<new PEM>" }
   ```
   `put-secret-value` the two-key set. Redeploy verifiers so they load both.
2. Flip the **issuer** (auth/admin) to sign with the new `kid` (`v2`). Tokens
   signed with `v1` remain valid because verifiers still hold `v1`.
3. After the access-token TTL window (plus refresh churn), remove `v1` from the
   keyset and retire/disable the old KMS key.

At no point is a verifier without the key it needs — the overlap guarantees zero
verification gap.

---

## 8. Never do

- Never export or store the **private** key (it cannot leave KMS anyway).
- Never put key material in Git or Terraform state.
- Never reuse one `kid` for two different keys.
- Never merge the user and admin trust domains into one keyset.

---

## Emergency revocation

To revoke a compromised signing key immediately: **disable** the KMS key in the
console/CLI (`aws kms disable-key`). All tokens carrying that `kid` fail
verification at once. Rotate to a fresh key/`kid` per §7. The 15-minute access
token TTL and the server-side revocable refresh tokens bound the exposure window.
