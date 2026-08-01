# RS256 Rollout Runbook (SEC-RS256)

How to move JWT issuance from HS256 to RS256 without a fleet-wide 401 storm.

This is the **operational** counterpart to the code that already exists:
verifiers accept both algorithms per token (`services/*/src/user-jwt-verification.ts`),
signing is implemented and KMS-backed (`services/{auth,admin}-service/src/auth/`),
and issuance stays HS256 until deliberately switched.

> **Nothing here is optional and nothing here is reorderable.** Each step exists
> because skipping it produces a specific, known failure.

---

## Why the obvious four-step plan does not work

A plan of the form:

1. Populate both public-key secrets
2. `terraform apply`
3. Wait for services to stabilise
4. Enable RS256 signing

**is unsafe**, and was rejected in deployment review. Steps 1 and 3 are fine.

- **Step 2 does nothing to the running fleet.** Every ECS service carries
  `ignore_changes = [task_definition]`. Terraform registers a revision carrying
  `JWT_PUBLIC_KEYS`; no service moves onto it. The keyset never reaches a
  running container, and every checkpoint still reports success.
- **Step 4 had no implementation.** `JWT_SIGNING_ALG`, `JWT_SIGNING_KID` and
  `JWT_KMS_KEY_ID` existed in application code and nowhere in infrastructure.

Both are now fixed. The corrected sequence is below.

---

## Preconditions

| # | Precondition | How to confirm |
|---|---|---|
| 1 | KMS keys and aliases exist | `tf.sh <env> output kms_jwt_user_key_id` / `kms_jwt_admin_key_id` |
| 2 | Signer task roles grant `kms:Sign` on their own key only | `verify-deployment.sh <env> all` §5 |
| 3 | Both secret placeholders exist | `aws secretsmanager describe-secret --secret-id bidride/<env>/jwt-public-keys` |
| 4 | Alert subscription CONFIRMED | `verify-deployment.sh <env> all` §7 |
| 5 | Staging has completed this runbook and soaked | Founder sign-off |

Precondition 5 does not apply when the environment *is* staging.

---

## Step 1 — Populate both keysets

Follow `JWT_PUBLIC_KEY_RUNBOOK.md` §1–§6. Summary:

```bash
ENV=staging   # or production

for domain in user admin; do
  aws kms get-public-key --key-id "alias/bidride-jwt-${domain}-${ENV}" \
    --query PublicKey --output text | base64 -d > "jwt-${domain}-pub.der"
  openssl pkey -pubin -inform DER -in "jwt-${domain}-pub.der" -out "jwt-${domain}-pub.pem"
  jq -n --arg v1 "$(cat "jwt-${domain}-pub.pem")" '{ "v1": $v1 }' > "jwt-${domain}-keyset.json"
done

aws secretsmanager put-secret-value \
  --secret-id "bidride/${ENV}/jwt-public-keys"       --secret-string "file://jwt-user-keyset.json"
aws secretsmanager put-secret-value \
  --secret-id "bidride/${ENV}/jwt-admin-public-keys" --secret-string "file://jwt-admin-keyset.json"

rm -f jwt-*-pub.der jwt-*-pub.pem jwt-*-keyset.json
```

The `kid` you choose here (`v1` above) must match `jwt_signing_kid` in Step 3.

**This step is inert and reversible.** Verifiers accept both algorithms, and
nothing signs RS256 yet, so a populated keyset changes no behaviour on its own.

> The ordering rationale in older revisions of `JWT_PUBLIC_KEY_RUNBOOK.md` —
> "applying the Terraform first will fail every verifier task launch" — was
> **wrong**, because `ignore_changes` meant tasks never moved to the new
> revision at all. Populate-first is still correct, but for a different reason:
> Step 2 below *does* move them, and an empty secret would then block task
> startup for real.

Verify before continuing:

```bash
bash infrastructure/scripts/verify-deployment.sh "${ENV}" all
```
Sections 2, 3 and 6 must pass. **Section 6 is the important one**: it signs a
real JWT signing input with `kms:Sign` and verifies it against the published
keyset with openssl. If it fails, the key and the keyset do not match and
enabling RS256 would break every login. Do not continue.

---

## Step 2 — Get the keysets onto the running verifiers (still HS256)

```bash
infrastructure/scripts/tf.sh "${ENV}" plan     # expect: task-def changes, ZERO ecs_service changes
infrastructure/scripts/tf.sh "${ENV}" apply
infrastructure/scripts/deploy-fleet.sh "${ENV}" <sha>
```

`jwt_signing_alg` is still `HS256`. This step only ensures every verifier is
running a task definition that carries `JWT_PUBLIC_KEYS`, and admin-service one
that also carries `JWT_ADMIN_PUBLIC_KEYS`.

```bash
bash infrastructure/scripts/verify-deployment.sh "${ENV}" all
```
Section 2 must show **all eight** user-domain verifiers injecting
`JWT_PUBLIC_KEYS`: auth, trip, driver, rider, pricing, safety, payment, admin.

**Soak here.** At least one full business day in staging, and monitor:

- `BidRide/Deployment → JwtVerificationFailures` — must not move
- alarm `bidride-jwt-401-ratio-*` — must stay OK
- alarm `bidride-ecs-tasks-below-desired-*` — must stay OK

Nothing has changed behaviourally yet. If anything moved, stop: the problem is
in the deployment, not in RS256.

---

## Step 3 — Enable RS256 issuance

Only now does anything begin signing RS256.

```bash
# env/<env>.tfvars
jwt_signing_alg = "RS256"
jwt_signing_kid = "v1"     # MUST match the kid populated in Step 1
```

```bash
infrastructure/scripts/tf.sh "${ENV}" plan
infrastructure/scripts/tf.sh "${ENV}" apply
```

Then deploy the two issuers — **auth-service first, alone**:

```bash
infrastructure/scripts/deploy-fleet.sh "${ENV}" <sha> --only auth-service
bash infrastructure/scripts/verify-deployment.sh "${ENV}" auth-service
```

Section 4 must report `JWT_SIGNING_ALG=RS256` **and** a boot log line agreeing.
Watch for 15 minutes — one full access-token TTL — before continuing:

```bash
aws logs tail "/ecs/bidride/auth-service-${ENV}" --since 15m --follow
```

Then admin-service:

```bash
infrastructure/scripts/deploy-fleet.sh "${ENV}" <sha> --only admin-service
bash infrastructure/scripts/verify-deployment.sh "${ENV}" all
```

### The boot guard is your safety net

`assertSigningKeyMatchesKeyset` runs inside the DI factory, so a mismatched
key/keyset **fails module initialisation** — the service refuses to start rather
than issuing tokens no verifier can check. Under the circuit breaker, ECS then
fails the deployment and reverts to the last stable revision automatically.

A crash loop here is the system working correctly. The alarm
`bidride-jwt-rs256-boot-failure-*` fires with the reason.

---

## Step 4 — Abort / rollback

RS256 rollback is a **configuration** rollback, and it is fast because verifiers
never stopped accepting HS256.

```bash
# 1. Immediate: put the issuer back on its pre-RS256 revision.
bash infrastructure/scripts/rollback-service.sh "${ENV}" auth-service
bash infrastructure/scripts/rollback-service.sh "${ENV}" admin-service

# 2. Then make the config match reality, so the next apply does not re-enable it.
#    env/<env>.tfvars:  jwt_signing_alg = "HS256"
infrastructure/scripts/tf.sh "${ENV}" plan
infrastructure/scripts/tf.sh "${ENV}" apply
```

Do **not** remove `JWT_PUBLIC_KEYS` from the verifiers as part of a rollback.
Leaving the keyset in place is harmless and keeps already-issued RS256 tokens
verifiable until they expire (15-minute access-token TTL). Removing it would
reject every outstanding RS256 token immediately.

Order matters: roll back the **issuers** first. Rolling back verifiers while an
issuer still signs RS256 is the 401 storm you are trying to avoid.

### Emergency key revocation

```bash
aws kms disable-key --key-id "alias/bidride-jwt-user-${ENV}"
```
Every token carrying that `kid` fails verification at once. Expect
`bidride-kms-signing-failure-*` to fire — during a deliberate revocation that is
expected, not a second incident. Rotate per `JWT_PUBLIC_KEY_RUNBOOK.md` §7.

---

## Step 5 — Rotation

`JWT_PUBLIC_KEY_RUNBOOK.md` §7 covers key rotation. The deployment mechanics:

1. Add the new key to the keyset **alongside** the current one (`{"v1":…,"v2":…}`).
2. Redeploy verifiers so they load both: `deploy-fleet.sh <env> <sha>`.
3. Flip `jwt_signing_kid = "v2"`, apply, deploy **issuers only**.
4. After the TTL window, remove `v1` from the keyset, redeploy verifiers, retire
   the old KMS key.

Steps 2 and 4 are real deployments, not restarts — the keyset arrives through
the task definition, so a `--force-new-deployment` would not pick up a changed
*reference*. (A changed *value* under the same reference does re-resolve on
restart; a changed reference does not.)

---

## Monitoring during rollout

| Signal | Where | Meaning |
|---|---|---|
| `JwtVerificationFailures` / `HttpRequests` | `BidRide/Deployment` | 401 ratio per verifier — the primary rollout signal |
| `bidride-jwt-401-ratio-<svc>-<env>` | CloudWatch alarm | >25% 401s for 3 min |
| `JwtIssuanceRs256` / `JwtIssuanceHs256` | `BidRide/Deployment` | Per-task census of what the fleet issues |
| `bidride-jwt-rs256-boot-failure-<svc>-<env>` | CloudWatch alarm | Issuer refused to start on a key/keyset mismatch |
| `bidride-kms-signing-failure-<svc>-<env>` | CloudWatch alarm | `kms:Sign` / `kms:GetPublicKey` failing |
| `bidride-ecs-tasks-below-desired-<svc>-<env>` | CloudWatch alarm | Crash loop or failed deployment |
| `bidride-alb-target-4xx-<env>` | CloudWatch alarm | Fleet-wide 4xx, which 401s are |

### Known monitoring gap — read before rollout

**Unknown-`kid` rejections are not separately observable.**
`resolveUserJwtVerification` throws, the guard catches with a bare `catch {}`,
and nothing is logged — so an unknown `kid` is indistinguishable from an expired
token inside the 401 stream. You will see *that* verification failures rose, not
*that they were kid lookups*.

Mitigations in place: the boot guard makes the most likely cause (key/keyset
mismatch) impossible to deploy, and check 6 of `verify-deployment.sh` proves the
pair matches before rollout. The residual case is a token signed with a `kid`
that was later removed from the keyset — which Step 5's overlap window is
designed to prevent.

Closing the gap requires a metric emission in the shared resolver, which is
application code and out of scope for the deployment sprint. Tracked as
**SEC-RS256-OBS**.
