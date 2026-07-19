# BidiRide — Intelligence Layer Architecture v1.0 (AI Core Phase 3)

**Status:** Phases 3.1 and 3.2 IMPLEMENTED (Founder-approved); this document is the architecture of record. Later phases remain design-only.
**Author:** Engineering
**Date:** 2026-07-11 (architecture) · 2026-07-12 (Phase 3.1 + 3.2 shipped)
**Scope:** The AI Operating System every current and future BidiRide product consumes

> **Shipped delta (Phase 3.2 — Close the Learning Loop):** the loop now runs
> end to end — outcome-evidence snapshots (before/after canonical metrics,
> Trusted/Reconciled-gated, advisory suggested score never auto-applied),
> Founder-only outcome scoring, per-family calibration (Brier + dismissal
> regret behind a 20-scored-outcome floor), the weekly Focus brief (seven
> sections, governed top-3 priorities), a leader-locked Redis scheduler that
> owns all recurring jobs (briefs, opportunity, outcome snapshots, expiry
> sweep, retention — replacing the old per-replica timers), read-only brief
> GETs with staleness SLAs, a bounded shared QualityClassService, and stable
> keyset cursor pagination. AI remains advisory/shadow-only throughout.
**Builds on:** `ai-core-architecture.md` (Phase 1), the Phase 2 shadow AI foundation (uncommitted, approved), `ai-governance-rules.md` v1.1, `ai-core-data-readiness.md`, and the 2026-07-02 suite (event catalog, feature registry, model registry, versioning)

> Positioning: Phase 1 designed the AI Core. Phase 2 built its foundation —
> shadow gates, kill switches, the universal envelope, quality-gated features,
> the audit/outcome chain. **Phase 3 does not replace any of that.** The
> Intelligence Layer is the organizing contract ABOVE the foundation: how
> intelligence is grouped into domains, how every recommendation is expressed,
> how the platform learns and remembers, and how the Founder consumes it.

---

## 0. The one-sentence architecture

**The Intelligence Layer is a contract, not a new service:** every BidiRide
product consumes intelligence through one universal recommendation format,
served by domain modules inside the existing `ai-service` (:3012), gated by
the existing shadow/kill-switch machinery, remembered in one recommendation
ledger, and surfaced to the Founder as evidence-backed briefs — while every
financial and safety decision stays in deterministic platform code.

Two genuinely new subsystems are proposed (everything else is reuse):

1. **The Recommendation Ledger** — standing recommendations persisted with
   lifecycle and outcome scoring (today's inference logs only cover
   request-scoped calls).
2. **Founder Intelligence** — scheduled insight briefs + a question interface
   over the ledger and the canonical marketplace data.

---

## 1. Architecture

```
                            PRODUCTS (today + future)
   Rider · Driver · Pricing · Dispatch · Offers · Airport │ Delivery · Wallet ·
                                                          │ Marketplace ·
                                                          │ Community · Biz Tools
        │ every product consumes, none implements          │ (plug in via §18)
        ▼
  ═══════════════════ UNIVERSAL RECOMMENDATION CONTRACT (§5) ═══════════════════
        │ request-scoped (sync hooks)          │ standing (ledger, async)
        ▼                                      ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                 INTELLIGENCE LAYER  (inside ai-service :3012)            │
  │                                                                          │
  │  DOMAINS (§2)         Pricing · Marketplace · Driver Success ·           │
  │  one NestJS module    Rider Experience · Integrity · Founder             │
  │  per domain, one      (+ reserved: Delivery, Merchant, Growth,           │
  │  manifest each        Community, Financial)                              │
  │       │                                                                  │
  │  DECISION ENGINE (§5) builds the universal format; writes the            │
  │       │               RECOMMENDATION LEDGER (new table, §5.3)            │
  │       ▼                                                                  │
  │  SHARED PRIMITIVES (Phase 2 — all built, all reused §12):                │
  │  ShadowModeService (kill switches) · AiResponseEnvelope ·                │
  │  InferenceLogService · FeatureStoreService + registry ·                  │
  │  DataQualityService (C1–C5 gate) · BidOutcomeService (outcome joins) ·   │
  │  ModelRegistryService · InternalKeyGuard (fail-closed)                   │
  └──────────────────────────────────────────────────────────────────────────┘
        ▲ reads (quality-gated projections — never writes product data)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ CANONICAL SOURCES: trips(finalFare) · bids · bid_outcomes · payments ·   │
  │ financial_ledger · driver_wallets · trip_events · ratings ·              │
  │ driver_session_logs · support_tickets · surge:* Redis · airport queue    │
  └──────────────────────────────────────────────────────────────────────────┘
        ▲                                       │ briefs & answers (read-only)
        │ decisions stay here                   ▼
   PLATFORM RULES (unchanged):            FOUNDER SURFACES:
   clamps · floors · caps · guards        admin portal Intelligence pages →
   (supremacy table, Phase 1 §9)          later: MCP gateway for Claude/ChatGPT (§7.4)
```

Placement decision — **extend ai-service, do not create a new service.**
Reasons: (a) every shared primitive already lives there; (b) a second AI
service would immediately violate "no product builds its own intelligence" by
creating two homes for it; (c) NestJS module boundaries give us the seams to
split later. **Split criteria** (any one triggers extracting a domain into its
own service): a domain needs a different scaling profile (Founder briefs are
batch; hooks are latency-bound), a domain needs different data access
(merchant data), or ai-service p95 on the 300ms ranking hook degrades.

## 2. Subsystems: the Domain model

A **domain** is a bounded intelligence context: it owns its model families,
its feature slice, its memory, its kill switch, and its manifest. A **family**
is one model inside a domain (exactly the Phase 2 unit of shadow/promotion).

The Founder's 15 candidate domains collapse to **6 active + 5 reserved**.
Grouping is by *decision surface and shared features*, not org chart — demand
and supply forecasting share zone-hour features and must reason jointly with
dispatch, so they are one domain, not three.

| Domain | Families (v1) | Consumes | Status |
|---|---|---|---|
| **Pricing** | fare-adjustment (built), surge advisory, win-probability calibration | pricing-service, trip-service bids | families exist (shadow) |
| **Marketplace** | demand forecast, supply forecast, dispatch ranking (built), wait time | dispatch, admin dashboard | ranking built; forecasts exist as services (heatmap/demand-forecast) to be foldedin |
| **Driver Success** | earnings forecast, repositioning (built as earnings-optimizer), utilization advice | driver app (advisory cards) | partial |
| **Rider Experience** | cancellation prediction, offer guidance ("offers like yours match in ~X min"), ETA honesty | rider app (advisory copy) | new |
| **Integrity** | fraud scoring (existing trust-service signals), anomaly detection (fare/audit drift) | trust-service, ops alerts | fraud hook exists |
| **Founder** | insight briefs, question answering, AI performance review | admin portal (Founder role) | new — §7 |
| *Reserved namespaces* | Delivery · Merchant · Growth · Community · Financial | future products | manifest slots only — no code until the product exists |

**Recommend rejecting two candidates:**
- **"Safety Intelligence" — reject.** Governance Rule 1: the safety pipeline
  must have zero dependency on ai-service, and Rule 6 bans panic data from any
  feature vector. Safety gets deterministic code, not intelligence. (Integrity
  may flag *fraud* anomalies; it never touches SOS/panic flows.)
- **"Community Intelligence" — defer, likely fold into Growth.** No community
  product exists; a domain with no decision surface and no data is scope
  theater. Reserved namespace only.

**Domain manifest** (one registry row per domain — the contract that keeps
future products honest): name, owner, constitution tags (§8 of this doc),
families[], feature slice (allowlisted inputs, per governance Rule 3a
pattern), consumers[], kill-switch key, memory classes used, privacy notes,
activation status. No manifest → no intelligence — a product PR that adds
model logic outside a manifest fails review by rule.

## 3. Data flow

Unchanged from Phase 1/2 at the bottom; one addition at the top:

1. **Products emit nothing new.** Events already land in canonical stores
   (Phase 1 finding: projection, not instrumentation).
2. **Quality gate** (C1–C5 classifier, built): monetary training data =
   Trusted + approved Reconciled only.
3. **Feature store** (built): projections with TTL, monetary features
   quality-gated, every feature registered.
4. **Domains** read features → produce recommendations via the Decision
   Engine.
5. **Request-scoped path** (built): sync hook → shadow gate → envelope →
   `ai_inference_logs` → outcome join (`bid_outcomes`).
6. **Standing path** (new): scheduled domain jobs → recommendation ledger →
   Founder/ops surfaces → adopt/dismiss → outcome scoring on the same ledger
   row. The ledger stores *references* to canonical rows (tripIds, zone keys,
   config keys), never copies of money values — it can never become a second
   financial truth.

## 4. Learning flow

**Signal inventory** (what exists today vs. gaps):

| Signal | Source | Status |
|---|---|---|
| Ride completion, offers, counters, cancellations | trips/bids/bid_outcomes/trip_events | ✅ flowing, outcome-joined |
| Driver earnings | trips + financial_ledger + driver_wallets (canonical) | ✅ quality-gated |
| Airport demand | airport queue + isAirportTrip | ✅ |
| Support tickets | `support_tickets` + `ticket_notes` (admin-service) | ✅ store exists — not yet projected; Founder Intelligence v1 consumes counts/categories only |
| Feature requests | **no store** | gap — smallest fix: a `category='feature_request'` tag on support tickets, not a new system |
| Wallet activity | `wallet_transactions`, `payout_*` | ✅ store exists — read-only Financial memory; no wallet product yet |
| Weather / traffic / special events / holidays | none | deferred external ingestion (unchanged from Phase 1); holiday calendar = static config table |
| Reward redemption | `driver_rewards` | ✅ store exists, low volume |
| Merchant / delivery / community | no product | reserved |

**Learning loop per family** (the Phase 2 loop, now stated as the layer-wide
rule): observe (projections) → gate (quality classes) → learn (recompute
transparent statistical profiles; later, train challengers) → **shadow**
(real recommendation logged, neutral served) → score (prediction vs outcome —
note Phase 2 fixed outcome scoring to use the *real* shadow prediction) →
human promotion per governance v1.1 → monitor (calibration, drift, clamp
saturation) → rollback switch.

**Privacy constraints on learning** (restating binding rules): zone keys are
the finest location granularity; no names/phones/emails/exact addresses/raw
GPS in any feature; panic events never enter any vector; trust scores never
enter pricing (Rule 3a allowlist, enforced in code); support-ticket learning
uses categories/counts/durations — never ticket body text in v1 (body text
would need PII scrubbing design first — deferred).

## 5. The Decision Engine (universal recommendation format)

### 5.1 Format

Extends the Phase 2 envelope (additive — existing hook consumers unaffected):

```json
{
  "id": "uuid",
  "domain": "pricing",
  "family": "fare-adjustment",
  "modelVersion": "fare-shadow-v1",
  "kind": "request | standing",
  "shadow": true,

  "recommendation": { "action": "adjust_fare", "value": 1.25, "unit": "USD" },
  "confidence": 0.82,
  "evidence": [
    { "source": "ai:feature:demand:2262:-3372", "value": 2.1, "asOf": "…" },
    { "source": "bid_outcomes 7d, n=41", "value": "acceptance 0.71" }
  ],
  "reasoning": "Zone demand is 2.1× hourly average with 3 nearby drivers; comparable conditions cleared at +$1–1.50.",
  "expectedOutcome": "Acceptance ≥70% maintained at +$1.25.",
  "expectedValue": { "metric": "contribution_margin_per_trip", "delta": "+$0.90", "horizon": "per-trip" },
  "alternatives": [
    { "action": "no_adjustment", "expectedValue": "+$0", "tradeoff": "slower driver match at peak" }
  ],
  "why": "Demand-supply imbalance is transient and price-responsive here.",
  "whyNot": "Low confidence below n=20 in this zone-hour; rider is 2 trips from loyalty tier.",
  "rollback": "Config: ai_fare_enabled=false (≤30s); recommendation self-expires at TTL.",
  "impacts": {
    "business": "+margin at peak", "user": "rider pays ≤ +$2 by hard clamp",
    "safety": "none — no safety surface", "revenue": "+", "trust": "neutral; explanation available on request"
  },
  "constitution": ["move_people", "create_trust"],
  "sampleSize": 41,
  "expiresAt": "…", "createdAt": "…"
}
```

Rules: every field mandatory for **standing** recommendations; request-scoped
hooks keep the compact Phase 2 envelope with `explanation/factors` (the
long-form fields would blow the 300ms budget) but must be *derivable* — the
inference log row carries enough to render the full format after the fact.
`sampleSize` is mandatory everywhere: **an alpha platform with 26 trips must
say "n=26" on every claim** or the Founder dashboard becomes confident fiction.

### 5.2 Black-box ban, made testable

A recommendation is rejected by contract test if: `evidence` is empty,
`reasoning` doesn't reference at least one evidence item, `confidence` lacks a
stated basis (sample size or model calibration), or `impacts.safety` is
anything but "none" (safety impact ⇒ automatic rejection — safety is not an
AI surface).

### 5.3 Recommendation Ledger (new table — migration deferred to approval)

`ai_recommendations`: id, domain, family, modelVersion, kind, payload (the
full format), status (`proposed → viewed → adopted | dismissed | expired`),
statusActor, statusReason, outcomeScore (null until scored), outcomeNotes,
canonicalRefs (tripIds/zoneKeys/configKeys), createdAt/expiresAt. Adopt/
dismiss with reasons is itself a learning signal (Founder supervision). Same
retention class as other AI tables (1-year TRAINING — and inherits the Phase 2
debt item: retention enforcement must be built).

## 6. Memory model

| Memory class | Contents | Store | Written by | Retention |
|---|---|---|---|---|
| **Short-term** | live zone features, presence, surge counters | Redis (TTL ≤180s) | feature store, gateway | seconds–minutes (built) |
| **Medium-term** | inference logs, pricing audit, bid outcomes, 7-day windows | Postgres AI tables | Phase 2 services | 1 yr (enforcement = debt) |
| **Long-term** | zone-hour profiles, calibration curves, seasonal baselines | new `ai_profiles` tables (deferred migration) | domain learners | years, aggregated, no PII |
| **Operational** | kill switches, model registry, health metrics, domain manifests | platform_config + registry table | humans + promotion workflow | permanent, audited |
| **Founder** | recommendation ledger, briefs, adopt/dismiss history | ledger + `ai_briefs` | Founder Intelligence | permanent (his institutional memory) |
| **Business** | canonical money/trips/tickets — trips.finalFare, financial_ledger, wallets | existing product tables | **products only — AI is read-only here, always** | product-owned |
| **Model** | versions, training windows, eval results, promotion history | model registry (+ `ai-model-registry.md` until table lands) | registry workflow | permanent |

The load-bearing rule: **Business memory is read-only to every AI component.**
The ledger references it; nothing in the Intelligence Layer ever writes a
product table. (Data-quality verdicts write `trip_events` — that is an audit
annotation, the one sanctioned exception, already built and append-only.)

## 7. Founder Intelligence

### 7.1 What it is

A domain whose only consumer is you, whose only power is to *say things with
evidence*. It controls no user-facing behavior — which is why it can be the
first domain to run un-shadowed (§11).

### 7.2 v1 briefs (all computable from existing data today)

| Brief | Sources | Answers |
|---|---|---|
| **Marketplace health** (daily) | feature store, bid_outcomes, session logs | supply/demand balance by zone, acceptance, cancellation, wait — "what neighborhoods are growing" (zone trip growth), n-stated |
| **Money map** (daily) | trips.finalFare, financial_ledger, earnings supplements (Trusted only) | "where are we losing money" — per-zone contribution incl. floor supplements the platform absorbed |
| **Churn signals** (weekly) — *DEFERRED, not shipped in 3.2* | driver_session_logs decay, rider trip recency, ratings | "why are drivers leaving / riders cancelling" — cohort curves + top correlated factors (cancellation reasons from trip_events) |
| **AI performance review** (SHIPPED — **daily**) | ledger + inference/outcome joins + calibration | "which AI recommendations produce results, which fail" — per family: calibration (Brier, dismissal regret, 20-scored floor), outcome score |
| **Trust map** (weekly) — *DEFERRED, not shipped in 3.2* | ratings, integrity events, refunds, fraud alerts, ticket categories | "where are we earning/losing trust" |
| **Focus brief** (SHIPPED — **weekly**, per Founder directive) | all of the above, ranked by expectedValue × confidence | "what should I focus on this week" — top 3 standing recommendations with full format |

"Which cities are ready for launch" and "what businesses should we recruit"
require data BidiRide doesn't collect yet (external market data, merchant
signals) — the brief framework holds slots for them; honest answer today is
"insufficient evidence," which the format forces it to say (`sampleSize`).

### 7.3 Question interface

`POST /ai/founder/ask` (admin-service proxy, Founder role only): maps a
question to registered brief queries + ledger search; every answer is composed
of evidence-backed fragments in the universal format. **v1 is a query router
over pre-built briefs, not a free-form LLM** — deterministic, auditable, no
hallucination surface. Unanswerable → says so + names the missing signal.

### 7.4 Founder AI (Claude/ChatGPT integration — design only)

The right shape is an **MCP server** (`bidride-intelligence`) exposing
read-only tools: `get_brief(name, date)`, `ask(question)`,
`list_recommendations(domain, status)`, `get_recommendation(id)`,
`marketplace_snapshot(zone?)`. Then Claude (or ChatGPT via the same gateway
pattern) answers "why are airport rides falling?" by *calling the Intelligence
Layer*, which already knows — the LLM narrates; the layer supplies every fact.

Safeguards (non-negotiable): read-only tools, Founder-scoped token via
admin-service auth, **PII-scrubbed responses by construction** (tools return
aggregates/zone keys only — the layer's own privacy rules mean there's no PII
to leak), every call written to audit_logs, and prompt-injection containment:
tool outputs are data-only JSON (no instructions), and the MCP server never
executes anything an LLM asks beyond the registered read tools. Placement:
thin module in admin-service (reuses Founder auth) — NOT inside ai-service
(keeps the external-LLM surface away from the inference path). Build: deferred
(§17); the contract is designed now so briefs are already MCP-shaped.

## 8. AI Governance (extends v1.1 — proposed v1.2 additions)

- **Constitution filter:** every domain manifest and every standing
  recommendation must carry ≥1 constitution tag (`move_people, move_goods,
  move_money, help_businesses, create_trust, meaningful_ai`). A capability
  that can't tag itself gets **rejected** — the manifest review is where.
- **Hierarchical kill switches:** global `ai_shadow_mode` (exists) → domain
  `ai_domain_<name>_enabled` (new) → family `ai_<family>_enabled` (exists).
  Live requires all three; any config failure ⇒ shadow (existing fail-safe).
- **Recommendation authority:** AI recommends → platform rules decide →
  humans activate. Unchanged; the ledger's `status` field makes the human
  decision auditable per recommendation.
- **Never silently change financial outcomes:** already enforced (clamps,
  canonical fare, floor); the ledger adds the affirmative record — any adopted
  financial recommendation points at the config/PR that a human applied.
- Existing rules carry over untouched: Rule 3/3a (prohibited features +
  pricing allowlist), Rule 4 (trust scores internal), Rule 6 (panic isolation),
  Rule 11 (shadow mandatory), Rule 12 (internal auth), activation/rollback
  procedures, decision authority matrix (+1 row: "Register new intelligence
  domain — Founder").

## 9. Security

Reuses Phase 2 posture: internal-only ai-service, `InternalKeyGuard`
fail-closed (production AND staging), VPC placement, no ALB route. Additions:
Founder endpoints exposed only through admin-service (Founder JWT + role
check, responses audited); ledger writes require the internal key like every
mutation; MCP gateway (deferred) gets its own scoped token, never the internal
service key. Carried-forward debt that becomes *blocking* for Phase 3
implementation: ai-service request-body validation (DTOs), the unfiltered
non-fare feature builders, and admin-service's missing internal key in
terraform (its AI proxy 401s today).

## 10. Privacy

Everything in §4's constraints, plus Founder-surface specifics: briefs and
answers contain aggregates, zone keys, rates, and money totals — never
individual rider/driver identities. Where a brief needs an actionable pointer
("driver cohort with declining sessions"), it returns an **opaque cohort id**
that only admin-portal drill-down (existing role-gated admin views, existing
audit logging) can resolve to people. Support-ticket learning: categories,
volumes, resolution times only; ticket text stays out until a scrubbing design
is approved. External-LLM surface: see §7.4 — aggregates only, by
construction.

## 11. Activation strategy

1. **Founder Intelligence first, live first.** It controls nothing, so
   read-only briefs can serve un-shadowed as soon as they exist — highest
   value, zero production risk. (Its "shadow" is simply: briefs marked
   `sampleSize` and reviewed for a couple of weeks before you trust them.)
2. Request-scoped families continue the v1.1 path: shadow → evaluation window
   → per-family Founder activation. Nothing in Phase 3 accelerates live AI.
3. Standing recommendations for ops (pricing/marketplace advisories) start
   `proposed`-only; "adopted" always means a human changed a config or shipped
   a change.
4. Domain switches roll out OFF; enabling a domain still serves shadow until
   each family is individually activated.

## 12. Current code reuse (what is NOT built new)

| Existing asset | Role in the Intelligence Layer |
|---|---|
| `shadow/shadow-mode.service.ts` | kill-switch core — extended with the domain tier |
| `AiResponseEnvelope` + Phase 2 shadow gates | request-scoped Decision Engine |
| `services/inference-log.service.ts` + `ai_inference_logs` | request-scoped audit memory |
| `bid-prediction/bid-outcome.service.ts` (sticky-accept, real-prediction scoring) | outcome joins for learning + AI performance brief |
| `feature-store/` + `feature-registry.ts` | short-term memory + feature contracts |
| `data-quality/` (C1–C5) | the learning gate |
| `services/model-registry.service.ts` + `ai-model-registry.md` | model memory |
| `internal-key.guard.ts` (fail-closed) | security boundary |
| `marketplace/` services (heatmap, demand-forecast, earnings-optimizer, dispatch-simulator) | fold into Marketplace/Driver Success domains as families — they already compute; they gain manifests, gates, and ledger output |
| admin-service `ai/` module + support module + finance module | Founder surface plumbing (proxy pattern, ticket/finance data access) |
| `financial_ledger`, `driver_wallets`, `payments` (canonical, post-e225720) | Business memory (read-only) for the money map |
| `platform_config` + Founder JWT machinery | operational memory + activation authority |

## 13. Exact services

- **`services/ai-service`** — extended (domains, decision engine, ledger,
  founder briefs). No new service in v1.
- **`services/admin-service`** — extended (founder intelligence proxy
  endpoints; already has `ai/` module).
- **`apps/admin`** — new Intelligence section (briefs, recommendation inbox,
  AI performance).
- **`packages/database`** — two migrations when implementation is approved:
  `ai_recommendations`, `ai_briefs` (+ later `ai_profiles`).
- **`services/notification-service`** — optional daily-brief push (deferred).
- **No** delivery/merchant/community services — reserved manifests only.
- **Future:** `intelligence-gateway` (MCP) as an admin-service module first;
  own service only if external-LLM traffic warrants isolation.

## 14. Exact files (proposed tree — no code yet)

```
services/ai-service/src/
  domains/
    domain-manifest.ts            # manifest type + registry (constitution tags, kill keys)
    pricing/pricing-domain.manifest.ts
    marketplace/marketplace-domain.manifest.ts     # adopts existing marketplace services
    driver-success/driver-success-domain.manifest.ts
    rider-experience/rider-experience-domain.manifest.ts
    integrity/integrity-domain.manifest.ts
    founder/                       # Founder Intelligence domain
      briefs/{marketplace-health,money-map,churn,ai-performance,trust-map,focus}.brief.ts
      founder-ask.service.ts       # question → brief-query router
      founder.module.ts
  recommendations/
    recommendation.types.ts        # the universal format (§5.1)
    recommendation-ledger.service.ts
    recommendation.controller.ts   # internal: create/list/status; guarded
    recommendations.module.ts
  shadow/shadow-mode.service.ts    # MODIFIED: domain-tier switch
services/admin-service/src/ai/
  founder-intelligence.controller.ts  # Founder-role proxy: briefs, ask, ledger inbox
apps/admin/src/app/intelligence/     # briefs page, recommendation inbox, AI performance
packages/database/prisma/            # migrations (deferred to implementation approval)
design/ai-governance-rules.md        # v1.2 additions (§8)
```

## 15. Smallest safe implementation (recommended first slice)

**Phase 3.1 — "the ledger and three briefs"** (order of days, zero production
influence, no product-service changes):
1. `ai_recommendations` + `ai_briefs` migrations.
2. Universal format types + ledger service (guarded, internal).
3. Founder domain with three briefs: **marketplace health**, **money map**,
   **AI performance review** — all computable from existing tables today.
4. Admin-portal Intelligence page rendering briefs + recommendation inbox
   (adopt/dismiss with reason).
5. Manifest registry with the six active domains declared (even before their
   families migrate under them — the contract lands first).

Everything else (domain-tier switches, folding marketplace services under
manifests, rider/driver advisory families, MCP gateway, external ingestion)
stacks on top in later slices.

## 16. Risks

1. **Tiny-n theater** — 26 completed trips: briefs must lead with sample
   sizes and wide uncertainty or Founder Intelligence trains *you* on noise.
   Mitigation: mandatory `sampleSize`, minimum-n rules per claim (already the
   feature-store pattern), "insufficient evidence" as a first-class answer.
2. **Ledger as shadow truth** — mitigated by canonical-refs-only design; ban
   copying money values into payloads beyond display strings.
3. **ai-service bloat** — one service accumulating batch + latency workloads;
   mitigated by module boundaries now + explicit split criteria (§1).
4. **External-LLM privacy/injection** — deferred build, but the contract
   (aggregates-only tools, read-only, audited) is set before any integration.
5. **Governance dilution** — 15 domains × manifests could become paperwork;
   collapsing to 6 + constitution filter keeps every domain earning its place.
6. **Retention debt compounds** — the ledger adds another growing AI table
   while Phase 2's retention enforcement is still unbuilt; make retention a
   Phase 3.1 acceptance criterion, not a footnote.
7. **Founder over-delegation** — an advisor that ranks your focus can quietly
   become the decider; the adopt/dismiss-with-reason loop keeps judgment
   human and audited.

## 17. Deferred work

Weather/traffic/special-events ingestion · learned (non-statistical)
challengers · MCP gateway build · notification-service brief delivery ·
support-ticket text mining (needs scrubbing design) · feature-request tagging
· `ai_profiles` long-term memory tables · delivery/merchant/community/growth/
financial domain activation (need products) · retention enforcement (Phase 2
debt, promoted to 3.1 criterion) · ai-service DTO validation + non-fare
feature-builder allowlists (Phase 2 debt, blocking for 3.x implementation) ·
"city launch readiness" and "merchant recruiting" briefs (need external data).

## 18. Future product integration

The plug-in contract is identical for every future product — **emit to
canonical stores per the event catalog, register a domain manifest, consume
recommendations; never implement model logic in the product**:

- **Community:** community reports/ratings land in their own tables →
  Community domain manifest → trust-map brief gains a community lens; safety
  reports still route to safety-service, never through AI.
- **Marketplace (goods):** listings/orders → Merchant domain (demand by
  category/zone reuses the zone-hour machinery wholesale); "what businesses
  should we recruit" becomes answerable here.
- **Wallet:** `driver_wallets`/`wallet_transactions` already exist —
  Financial domain reads them (read-only, Rule 9: AI never moves money) for
  cash-flow forecasts and payout-timing advisories.
- **Business tools:** corporate accounts exist in schema; Merchant domain
  serves demand forecasts to business customers via the same envelope —
  external consumers get a further-restricted field set (no internal
  confidence/factors beyond the public explanation).
- **Creator platform:** furthest out; Growth domain namespace; nothing
  designed beyond the manifest slot — honestly out of evidence range today.

---

## Phase 3 deliverable boundary

This document + governance v1.2 deltas (§8) are the whole deliverable.
Explicit non-goals: no code, no migrations, no new services, no redesign of
existing services, no commits, no deploy. Implementation (Phase 3.1, §15)
begins only on Founder approval.
