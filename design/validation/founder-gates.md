# Founder Gates

Decisions that require explicit Founder (Marq Brown) approval before execution.
No automated system, no other admin role, and no CI/CD pipeline may bypass these gates.

---

## Earnings Floor Formula

**Gate:** Any change to the earnings floor formula requires a signed Founder JWT before the change is deployed.

**Current formula (locked):**
```
floor = (distance_miles × $1.10) + (duration_min × $0.22) + $2.50
```

**How it works:**
- The `PlatformConfigService` in admin-service enforces that `earnings_floor_*` config keys can only be updated by a request carrying a valid Founder JWT.
- The formula is deterministic — no ML model may override or adjust the floor.
- The platform absorbs any supplement between actual earnings and the floor; this is never passed to the rider.

**Change process:**
1. Founder signs a JWT scoped to `earnings_floor_update`
2. `PATCH /admin/config` with signed JWT — any other role receives 403
3. Change is logged to `audit_logs` with the Founder's admin ID and old/new values
4. Staging validation required before production deploy

---

## Production Deploy

**Gate:** Production deploys require Founder approval via the GitHub Actions manual approval step.

- Staging deploys are automatic on merge to `main`
- Production deploy is gated: CI/CD pauses at approval step, sends notification, waits for Founder to approve in GitHub UI
- An RDS snapshot is automatically taken before the ECS rolling deploy proceeds
- Force-deploying without the approval step is not permitted

---

## Airport Surge Above 1.5×

**Gate:** EWR surge multiplier above 1.5× requires admin confirmation before it takes effect.

- Multipliers up to 1.5× are applied automatically by the airport-service based on demand signals
- Multipliers from 1.5× to 2.5× (the hard cap) require an admin to confirm in the admin portal before activation
- The 2.5× hard cap is absolute — no code path, admin action, or ML recommendation may exceed it
- All surge events are logged with multiplier, timestamp, and the admin who confirmed (or `auto` for ≤1.5×)

**Who can confirm surge above 1.5×:** Founder, Super Admin, or Operations Admin.

---

## Permanent Driver Ban

**Gate:** No automated system may issue a permanent ban. Only a human admin can make that decision.

- Fraud auto-hold triggers at `fraud_probability ≥ 90%` (automatic, reversible)
- Suspension triggers on background check adverse action (automatic, reversible by Founder/Super Admin)
- Permanent ban (`status: declined` with permanent flag) requires manual admin action
- Permanent bans must be reviewed by Founder or Super Admin before taking effect
- All permanent ban decisions are logged to `audit_logs`

---

## Admin Role Changes

**Gate:** Granting or revoking Super Admin role requires Founder action.

**Role hierarchy (top to bottom):**
```
Founder
└── Super Admin
    ├── Operations Admin
    ├── Safety Admin
    ├── Driver Approval Admin
    ├── Fraud Admin
    ├── Support Admin
    └── Analytics Admin
```

- Founder can grant/revoke any role
- Super Admin can grant/revoke roles below Super Admin
- No admin may grant a role equal to or above their own
- Role changes are audit-logged

---

## Platform Config — Restricted Keys

**Gate:** The following `platform_config` keys may only be modified by the Founder:

| Key prefix | Description |
|---|---|
| `earnings_floor_*` | Earnings floor formula coefficients |
| `surge_hard_cap` | Airport surge absolute maximum (currently 2.5×) |
| `fraud_auto_hold_threshold` | Probability threshold for automatic fraud hold |
| `wallet_hold_hours` | Driver wallet hold period before payout eligibility |

All other config keys may be modified by Operations Admin and above.

---

## Security Policy Changes

**Gate:** Changes to the following require Founder review:

- JWT signing algorithm or secret rotation
- OTP expiry window
- Rate limiting thresholds on auth endpoints
- CORS origin allowlist
- Internal service key rotation
- WebAuthn/FIDO2 configuration
- Audio recording trigger conditions (must remain: SOS confirmation only)

---

## Panic Event Protocol **[Non-Negotiable]**

**Rule:** The admin panic payload must never include `riderId`, `riderName`, or `riderPhone`.

This is not a configurable gate — it is a hard-coded invariant. Admin personnel must not contact the rider during an active panic event. Any change to the panic payload schema requires Founder review and sign-off. Violations are a safety incident, not a bug.
