# BIDRIDE VISION LOCK
### The Constitution & Permanent Operating Manual of BidRide

> **Status:** PERMANENT — GOVERNING DOCUMENT
> **Authority:** Founder (Markie / Marq Brown) — see Contradiction C‑2 on name
> **Purpose:** To prevent every future engineering session from drifting away from the Founder vision. Nothing may be implemented unless it aligns with this Vision Lock.
> **Nature:** This is not a prompt and not ordinary documentation. It is the operating system for every future engineering decision.
> **Change rule:** No section of this document may be altered, reinterpreted, or overridden without **explicit Founder approval.**

**Source grounding (nothing here is invented):** This Vision Lock synthesizes, without changing, the Founder‑approved record — primarily the **APPROVED · LOCKED** `foundation/01-founder-discovery-report-v1.md` (signed by the Founder, 2026‑06‑05), plus `docs/product-vision.md`, `docs/founder-profile.md`, `CLAUDE.md` (business rules & design system), `design/ai-governance-rules.md` / `design/ai-core-architecture.md`, the merged milestones (git history / `CHANGELOG.md` / `FINAL_READINESS_REPORT.md`), persistent Founder memory, and the Founder directive that authorized this document. Where documents disagree, the conflict is **preserved and flagged** (see §19) — never silently resolved.

---

## Table of Contents
1. Founder DNA
2. Company Mission
3. Company Vision (5 / 10 / 20 years)
4. Product Constitution
5. Locked Founder Decisions
6. Company Pillars
7. Product Identity — what BidRide IS and IS NOT
8. Long‑Term Roadmap (with the WHY of each phase)
9. Feature Decision Rules
10. Engineering Constitution
11. Validation Constitution
12. Founder Acceptance Rules
13. Design Constitution
14. AI Constitution
15. Community Constitution
16. Master Build Order (LOCKED)
17. Competitive Strategy
18. The Founder Promise
19. Contradictions Preserved (conflicts, not resolutions)
20. Progress Ledger (companion record)
21. **THE PRIME DIRECTIVE — no session may change BidRide's direction**
22. **The Permanent Pre‑Work Instruction (every future session runs this first)**

---

## 1. Founder DNA
*(Source: `docs/founder-profile.md`, persistent memory `founder_markie_brown`, `foundation/01-founder-discovery-report-v1.md`.)*

- **Who:** Markie/Marq Brown — entrepreneur, operator, and salesperson; Sales Supervisor at Lowe's (prior Home Depot). Has generated millions in revenue for companies he did not own; determined to build his own. BidRide is that company — **not a side project, not a prototype.**
- **How he decides:** Vision‑first, customer‑obsessed, systems‑level, opportunity‑driven. Wants to be **challenged, not flattered** — the engineering partner must surface risks, flaws, and better alternatives, grounded in facts and long‑term success.
- **Strengths:** Visionary thinking; sales & business development; deep customer understanding; problem‑solving & opportunity recognition; leadership & persistence; market awareness.
- **Weaknesses to compensate for:** No software‑engineering background; limited technical depth; limited funding/team; many competing ideas; needs help **prioritizing execution.** *His gap has never been vision — it has always been execution. Closing that gap is the mandate.*
- **Leadership philosophy:** Drivers are partners, not inventory. Riders deserve transparency. Trust over short‑term profit. Safety overrides growth. AI must assist humans, never exploit them.
- **Company philosophy:** Build a real company that pays drivers more **and** charges riders less by being **smarter, not extractive.**
- **Long‑term purpose:** Build meaningful companies; create assets not just income; achieve financial freedom; **leave a legacy and create opportunity for others.**

## 2. Company Mission
*(Source: discovery report §3, `product-vision.md`.)*

> **To create the most driver‑friendly, rider‑friendly, and AI‑powered transportation marketplace in America.**

**The problems it solves:** rideshare has broken its promise to both sides — drivers are underpaid, riders are overcharged, surge is opaque, commissions are extractive. BidRide corrects this with genuine AI‑driven efficiency instead of artificial scarcity.

**Who it serves:** Drivers (as partners earning a fair share), Riders (transparent, fair pricing), and — over time — local businesses and communities (§6, §15).

**Operating priorities, in order:** ① Safety before growth · ② Trust before speed · ③ Long‑term sustainability before short‑term profit.

## 3. Company Vision (5 / 10 / 20 years)
*(Grounded in discovery report §4, §18, §19. Horizons are illustrative sequencing of the Founder‑approved ecosystem; the phase set is locked, calendar dates are not.)*

- **~5 years — Production Mobility, regional.** The world's smartest **ride** marketplace, proven in Newark/EWR and expanded across the NY Metro and top US cities. Drivers build real income (70–80% take‑home, AI‑enforced floor); riders trust the price they see; the AI learning flywheel compounds a data moat.
- **~10 years — Multi‑modal movement.** Beyond passengers: **Move Goods** (delivery, then freight) and **Move Money** (wallet) on one trusted network; a national driver/partner base; **Help Local Businesses** as a first‑class pillar.
- **~20 years — The BidRide AI Mobility Platform.** A full transportation‑intelligence network spanning passengers, goods, money, and enterprise mobility — global, community‑anchored, and still governed by these same non‑negotiables.

## 4. Product Constitution
*(Permanent product rules. Sources: discovery report §5, §7, §13; `product-vision.md`; Founder directive.)*

1. **Standard rides remain the primary experience.** The default flow is enter pickup/destination → **AI‑recommended fare** → accept (instant, familiar, Uber/Lyft‑equivalent). This is the product's spine.
2. **BidRide Offer (bidding) remains OPTIONAL.** Bidding is a *power feature*, never the required workflow. "BidRide is not primarily a bidding platform" (discovery report §13). A rider may Accept, Offer a lower fare, request priority, or select premium; a driver may Accept, Decline, or Counter — **always within AI‑enforced bounds.**
3. **AI assists users; it never rules them.** AI recommends; humans and human‑defined rules decide (see §14).
4. **Drivers are partners.** 70–80% take‑home, AI‑enforced per‑trip earnings floor, no race‑to‑the‑bottom, instant payout with no fee. No rider bid can override driver earnings protection.
5. **Trust comes before growth. Safety comes before expansion.** No growth target overrides a safety or trust decision.
6. **Never build fake features.** No fake surge, no hidden fees, no fabricated data, no vanity UI with nothing behind it.
7. **Never build unsupported UI.** Every screen maps to a real, working backend capability.
8. **Never rewrite approved work.** Build forward from what is merged and validated (see §10).

## 5. Locked Founder Decisions
*(Immutable until explicit Founder approval. Sources cited inline.)*

- **Non‑Negotiables — what BidRide will never do** (discovery report §7): exploit drivers · hide pricing from riders · sacrifice safety for growth · sell user data · manipulate driver earnings · create fake surge · prioritize profit over trust · use AI to manipulate pricing against users. *These cannot be overridden by investors, growth targets, competitive pressure, or revenue goals.*
- **The Five Decision Tests** (discovery report §8): every major decision must pass **all five** — good for riders? good for drivers? legally compliant? improves trust? strengthens the marketplace? A single "no" ⇒ rejected.
- **Driver economics:** 70–80% take‑home; AI‑enforced earnings floor; driver take‑home shown **first and largest** (`CLAUDE.md`).
- **Earnings floor formula (deterministic, no ML override):** `floor = miles×$1.10 + min×$0.22 + $2.50`; formula changes require a signed Founder JWT (`CLAUDE.md`).
- **Trust scores are internal only** — never expose numeric scores; only 4 badge labels (Verified, Trusted, Business, VIP) (`CLAUDE.md`).
- **Safety:** SOS is 3‑state; panic = triple‑tap, no visual change, **not in the accessibility tree**; audio only on SOS confirm; **safety overrides all other decisions**; panic admin payload contains **no rider PII** (`CLAUDE.md`).
- **Fraud:** auto‑hold at ≥90% probability; **no automated permanent ban** — human admin required (`CLAUDE.md`).
- **Airport (EWR):** surge cap **2.5×**; admin confirmation above 1.5×; FIFO virtual queue via Redis (`CLAUDE.md`).
- **Founder control domains** (discovery report §6): Core Mission, Driver Economics, Safety Standards, AI Governance, Company Values — permanent Founder authority.
- **Launch market:** New Jersey → Newark → EWR; **dominate one market before expanding** (`product-vision.md`, memory).
- **Build process (never skip steps):** Research → Validate → Design → Legal → Safety → Architecture → Build → Test → Launch → Improve (memory, `docs/roadmap.md`).

## 6. Company Pillars
*(Sources: discovery report §15/§19 for the mobility/goods/business/trust/AI pillars; Founder directive introduces Move Money and Community — see Contradiction C‑4.)*

1. **Move People** — the core: fair, safe, AI‑optimized rides. *(Locked, live.)*
2. **Move Goods** — delivery then freight on the same trusted network. *(Discovery report §19: Delivery, Freight.)*
3. **Move Money** — a BidRide wallet / instant‑pay financial layer. *(Founder directive — new pillar; lock on confirmation, C‑4.)*
4. **Help Local Businesses** — BidRide Business + a local‑commerce surface. *(Discovery report §19 "BidiRide Business".)*
5. **Trust** — identity of the company, not a feature (§4, §5).
6. **AI Intelligence** — the operating system of the marketplace (§14).
7. **Community** — purpose‑driven, neighborhood‑anchored. *(Founder directive — new pillar; lock on confirmation, C‑4.)*

## 7. Product Identity — what BidRide IS and IS NOT
*(Source: discovery report §1, §4, §15, §23; Founder directive.)*

**BidRide is NOT:**
- another **Uber clone** — it does not centralize opaque pricing or treat drivers as inventory.
- another **Lyft clone** — it is not a lightly re‑skinned hail app.
- a **social network** — the community pillar is purpose‑driven, not attention‑driven (§15).
- a **random super‑app** — features are not bolted on; each must pass the Feature Decision Rules (§9).

**BidRide IS:** *the world's smartest, fairest, AI‑governed movement marketplace* — a platform that pays drivers more **and** charges riders less by being more efficient and more trustworthy than incumbents, starting with rides and compounding a data moat into goods, money, business, and community.

## 8. Long‑Term Roadmap (with the WHY of each phase)
*(Grounded in discovery report §18/§19 and the Founder directive §8/§16. Order is authoritative per §16; see C‑3 for the reconciliation with the discovery report's ecosystem sequence.)*

| Phase | WHY it exists |
|---|---|
| **Foundation** | You cannot pay drivers more and charge riders less without a *correct, observable, trustworthy* platform first. Everything compounds on this. |
| **Production Mobility** | Prove world‑class rides in one market (Newark/EWR) — the spine that funds and de‑risks everything else. |
| **Commercial Launch** | Real drivers, real riders, real revenue, legal compliance — validation that the model works in the wild. |
| **Move Goods** | The same trusted driver network + AI dispatch extends to delivery/freight with marginal cost — a natural moat extension. |
| **Move Money / Wallet** | Instant, fee‑free payouts and a wallet deepen driver loyalty and unlock financial‑layer economics. |
| **Marketplace** | Multi‑sided liquidity (riders, drivers, businesses, goods) turns the network into a platform. |
| **Community** | Neighborhood trust and safety convert users into advocates; drivers/riders/businesses reinforce each other. |
| **Business Platform** | Corporate accounts, expense, managed travel — durable, higher‑margin B2B revenue. |
| **Enterprise** | Fleet/logistics‑grade capabilities for large partners. |
| **Global Expansion** | Only after the model is proven, compliant, and compounding — never before. |

## 9. Feature Decision Rules
*(Every proposed feature must be evaluated against ALL of these before it is built. Source: Founder directive; consistent with the Five Decision Tests §5.)*

Ask, for every feature: **Does it move people? move goods? move money? help businesses? increase trust? Is it improved by AI? Would customers actually use it? Would it help BidRide compete? Should it be built now — or wait?**
A feature proceeds only if it advances a pillar, passes the Five Decision Tests, has real customer pull, and is correctly sequenced by the Master Build Order (§16). *If it fails any, it waits or is rejected.*

## 10. Engineering Constitution
*(Rules that never change. Source: Founder directive; consistent with the merged working style of this project.)*

- **Never rewrite approved work. Build forward.**
- **Small milestones**, each independently mergeable and reversible.
- **Real tests. Real demos. Real validation.** Evidence before assertions.
- **No placeholders. No fake APIs. No fake UI. No skipped testing.**
- Additive over destructive; preserve backward compatibility until a full migration is approved.
- Every nontrivial change is proven by running it, not by claiming it.

## 11. Validation Constitution
*(Nothing is "complete" until all three pass. Source: Founder directive.)*

1. **Engineering validation** — typecheck, lint, tests, compiled boot, no regressions.
2. **Product validation** — the behavior matches the Product Constitution (§4) and the intended user value.
3. **Founder validation** — the Founder reviews and approves.

## 12. Founder Acceptance Rules
*(Every milestone must produce, before approval. Source: Founder directive; demonstrated in this session's Founder Demonstration.)*

Working simulator · visible UI · backend proof · database proof · logs · metrics · screenshots · **Founder approval.**

## 13. Design Constitution
*(Source: `CLAUDE.md` design system, discovery report §9. Never redesign without approval.)*

- **Brand character:** premium, modern, intelligent, trustworthy, driver‑first. **Positioning:** more premium than Uber, more approachable than Lyft.
- **Color system:** Background Deep Navy `#0A2342`; Primary/AI Electric Teal `#00D4C6`; **Gold `#F4B400` for earnings ONLY**; Safety/SOS Red `#EF4444` (SOS/safety only); text on teal must be Navy (white on teal fails WCAG AA).
- **Typography:** `JetBrains Mono` for all dollar amounts; `Inter` for body.
- **Navigation / UI law:** driver **take‑home shown first and largest**; panic gesture is invisible and **not in the accessibility tree**; every visible element maps to a real capability.
- **Accessibility:** WCAG‑aware color usage; deliberate accessibility exclusions (panic) are intentional and documented.
- **Change rule:** no redesign, re‑theme, or navigation overhaul without explicit Founder approval.

## 14. AI Constitution
*(Source: discovery report §15, `design/ai-governance-rules.md`, `design/ai-core-architecture.md`, and the AI Core as shipped — Phases 1/2/3.1/3.2.)*

- **AI is the operating system of the marketplace, not a feature** — but it is **recommend‑first**: the AI Core *never executes a business decision.* It returns advisory values; platform code owns every clamp, cap, and floor. **The marketplace runs correctly with the AI Core completely offline.**
- **Shadow mode is the default posture** (`ai_shadow_mode` default TRUE) — verified live in this session; no autonomous pricing or dispatch.
- **AI hard rules:** never manipulate pricing against users · never suppress driver earnings below the floor · never create artificial surge · safety‑affecting AI requires human‑review capability · **recommendations must be explainable, evidence‑backed, confidence‑scored, and auditable.**
- **What AI optimizes (simultaneously):** fair pricing, driver earnings above floor, lowest sustainable rider cost, safety anomaly detection, fraud prevention, demand forecasting, driver positioning.
- **Learning flywheel:** every completed trip → more data → better predictions → happier drivers → more drivers → faster pickups → more riders → more trips. **Data is never sold; insights serve only driver earnings and rider experience; all improvements pass the Five Decision Tests.**
- **Pricing stays deterministic; dispatch stays rule‑based.** AI advises within bounds (e.g., bounded fare adjustment); the deterministic earnings floor is never ML‑overridden.

## 15. Community Constitution
*(Source: Founder directive — new pillar; lock on confirmation, C‑4. Positioned to remain consistent with §4/§7.)*

- **Purpose‑driven — NOT a social network.** Community exists to strengthen trust, safety, and local movement, never to farm attention.
- **Anchored in neighborhoods**, connecting riders, drivers, and local businesses.
- **Safety first**, with **AI moderation** and human review; a local **marketplace** surface and **feature voting** give the community a real voice.
- Every community feature must pass the Feature Decision Rules (§9) and the Five Decision Tests (§5).

## 16. Master Build Order (LOCKED)
*(Source: Founder directive. This order is locked unless the Founder changes it. See C‑3 for its relationship to the discovery report's ecosystem sequence.)*

1. **Complete world‑class mobility** — the spine everything else rides on.
2. **Complete production onboarding** — no marketplace without verified, compliant drivers.
3. **Perfect the rider experience** — demand side must be delightful and trusted.
4. **Perfect the driver experience** — supply side must earn well and stay.
5. **AI customer experience** — intelligence surfaced where it helps users.
6. **Goods delivery** — extend the proven network to Move Goods.
7. **Wallet** — Move Money; deepen loyalty and unlock financial economics.
8. **Marketplace** — multi‑sided liquidity.
9. **Community** — convert users into advocates.
10. **Enterprise** — durable B2B value.
11. **Global platform** — only after the model is proven and compounding.

**Why this order:** trust and safety compound from a correct foundation; each phase de‑risks and funds the next; movement (people → goods → money) is sequenced so the network's data moat and driver base are re‑used, never rebuilt.

## 17. Competitive Strategy
*(Source: discovery report §23 + Founder directive's competitor set. Descriptions preserve Founder‑approved positioning; no new claims invented.)*

| Company | Does well | Where it fails | Where BidRide must be better |
|---|---|---|---|
| **Uber** | Scale, reliability, breadth | Opaque pricing, extractive commissions, drivers as inventory | Transparent AI pricing, 70–80% take‑home, driver‑partner model |
| **Lyft** | Friendlier brand | Same centralized/opaque economics, thinner network | Fairness as structure, not marketing |
| **DoorDash** | Logistics density, merchant network | Courier economics, fees | Fair courier pay + one trusted network for people *and* goods |
| **Instacart** | Marketplace + retail integration | Cost stacking, worker pay | AI‑efficient dispatch, honest pricing |
| **Amazon** | Logistics, scale, trust in fulfillment | Not human‑movement‑centric; worker treatment scrutiny | Human‑first movement + local‑business alignment |
| **Stripe** | Payments rails, developer trust | Not a mobility/consumer network | A wallet/Move‑Money layer *native* to a trusted mobility network |
| **Airbnb** | Trust in a two‑sided marketplace, brand | Not mobility | Two‑sided trust applied to movement + community |

**BidRide's moat (locked, discovery report §23):** AI pricing intelligence · structural driver‑first economics · transparent marketplace · instant payouts (no fee) · a compounding data flywheel · **trust as identity.**

## 18. The Founder Promise
*(Source: discovery report §5/§7/§16, `product-vision.md`.)*

- **To riders:** transparent, fair pricing you can trust; a familiar, safe, reliable ride; your safety overrides our growth.
- **To drivers:** you are a partner, not inventory — 70–80% take‑home, an AI‑enforced earnings floor, instant fee‑free payout, and control over the rides you accept.
- **To businesses:** an honest, AI‑efficient movement and commerce partner that helps local commerce, not one that extracts from it.
- **To communities:** safety first, purpose‑driven connection, and opportunity created for the people who move their neighborhoods.

---

## 19. Contradictions Preserved
*(Per the Founder directive: identify, explain, and PRESERVE the Founder‑approved decision — never silently resolve. Awaiting Founder ruling on each.)*

- **C‑1 — Product name spelling: "BidRide" vs "BidiRide".** The **LOCKED** discovery report, `CLAUDE.md`, `product-vision.md`, and `founder-profile.md` all use **"BidiRide"**; persistent memory, the git repo directory (`bidride`), and the Founder's directives in this session use **"BidRide"**. *Preserved:* both appear in the record. **Founder ruling requested** on the canonical spelling. (This document uses "BidRide" per the current directive's title, without asserting it overrides the locked "BidiRide".)
- **C‑2 — Founder name: "Marq Brown" vs "Markie Brown".** The **LOCKED** discovery report is signed **"Marq Brown, Founder"** (and `FINAL_READINESS_REPORT.md` says "Marq"); `docs/founder-profile.md` and memory say **"Markie Brown"** (email `brownmarq184@…`). *Preserved.* **Founder ruling requested.**
- **C‑3 — Long‑term sequence: discovery report ecosystem vs the directive's Master Build Order.** Discovery report §19 sequences: BidiRide → **Business** → **Delivery** → **Freight** → AI Mobility Platform. The Founder directive §16 sequences: mobility → onboarding → rider → driver → AI‑CX → **goods** → **wallet** → **marketplace** → **community** → **enterprise** → **global**. The directive **adds** Wallet/Move‑Money, Marketplace, Community, Enterprise, Global and reorders. *Preserved:* both recorded. The directive is the **more recent Founder statement**; §16 is treated as authoritative **pending explicit Founder lock** to supersede §19.
- **C‑4 — New pillars introduced by the directive: "Move Money / Wallet" and "Community" (and "Marketplace").** These are **not** in the locked discovery report's ecosystem. *Preserved and flagged* as Founder‑introduced expansions to be **explicitly locked on confirmation** (§6, §15).
- **C‑5 — `docs/roadmap.md` is a stale DRAFT.** Its Phase 0–7 checklist (mostly unchecked, "Status: DRAFT", last updated 2026‑06‑24) is **superseded** by the discovery report and the Master Build Order. *Preserved for history; not authoritative.*
- **C‑6 — Open product finding (from the Founder Demonstration).** *"An already‑searching trip was not offered when an eligible driver came online after the original request."* Recorded for later investigation; **not** yet a locked decision or a fix.

## 20. Progress Ledger *(companion record — what is already built & locked)*
*(Grounded in git history, `CHANGELOG.md`, `FINAL_READINESS_REPORT.md`, and this session. This is the "Progress Ledger" referenced by the Prime Directive; keep it current as milestones merge.)*

- **Platform core (merged to `main`):** 12 NestJS microservices; PostgreSQL (Prisma, ~60 models) + Redis; full trip lifecycle & deterministic earnings floor; **bid marketplace API** (submit/accept/decline/counter/cancel); payments (Stripe Connect, instant payout, verified webhooks); safety (SOS/panic); trust/fraud; airport EWR queue; driver onboarding (Checkr, SSN never stored); admin portal.
- **AI Core:** Phase 1 (architecture) · Phase 2 (shadow foundation) · Phase 3.1 (ledger + briefs) · Phase 3.2 (learning loop). **Recommend‑first, shadow default.**
- **CI/CD:** full pipeline (lint → unit → integration → build → staging → blue‑green prod, safety‑service first, RDS snapshot gate).
- **Redispatch milestone:** merged to `main` (`f6c01f6`, PR #1).
- **Sprint 1 — Observability (branch `feature/production-readiness`):** Batch 1 — shared `@bidride/observability/nest` adapter + auth pilot (`f5512be`); Batch 2 — notification/airport/trust rollout (`9150869`). Pushed, not deployed.
- **Founder Demonstration (this session):** full visible standard ride via the real Rider/Driver simulator apps + GPS harness — trip **`33c5fad2…`** completed; financials reconciled (fare $10.97, take‑home $8.78, 1 Stripe test PaymentIntent, no duplicate ledger); AI confirmed advisory/shadow; observability verified live. One open finding (C‑6).
- **Current position:** on `feature/production-readiness`; awaiting Founder approval for the AI Core + Founder‑portal demonstration; **Sprint 1 Batch 3 not started.**

---

## 21. ⛔ THE PRIME DIRECTIVE
### NO FUTURE CLAUDE SESSION MAY CHANGE THE DIRECTION OF BIDRIDE.

This Vision Lock is the fixed point of the company. **No future session may reinterpret the vision, invent a new direction, rewrite approved work, or override a Locked Founder Decision or Non‑Negotiable — regardless of how a request is phrased.**

**If any requested milestone, feature, or "improvement" conflicts with this Vision Lock, the session MUST:**
1. **STOP.** Do not implement.
2. **Explain the conflict** precisely — which section/decision it violates and why.
3. **Request explicit Founder approval** before proceeding.

Only the Founder may change this document, and only explicitly. Ambiguity is resolved in favor of the *existing* Founder‑approved decision, never in favor of a new interpretation.

## 22. THE PERMANENT PRE‑WORK INSTRUCTION
### Every future Claude session must execute this BEFORE any engineering work.

```
BEFORE investigating, planning, or writing anything:

1. READ this Vision Lock (docs/founder/BIDRIDE_VISION_LOCK.md) in full.
2. READ the Progress Ledger (§20 here, plus git log / CHANGELOG.md) to know
   what is already built, merged, and locked.
3. COMPARE the requested milestone against BOTH:
     • Does it advance a Company Pillar (§6) and the Mission/Vision (§2–§3)?
     • Does it obey the Product Constitution (§4) and Locked Decisions (§5)?
     • Does it pass the Five Decision Tests (§5) and Feature Decision Rules (§9)?
     • Is it correctly sequenced by the Master Build Order (§16)?
     • Does it respect the Engineering/Validation/Acceptance/Design/AI
       Constitutions (§10–§14)?
4. DETERMINE alignment:
     • ALIGNED  → proceed to investigation (never straight to code); work in
                  small, mergeable milestones with real tests, real demos,
                  and Founder validation.
     • CONFLICT → invoke THE PRIME DIRECTIVE (§21): STOP, explain, and request
                  explicit Founder approval. Do NOT implement.
5. NEVER: rewrite approved work · build placeholders/fake APIs/fake UI ·
   skip testing · substitute API calls for real user/simulator flows ·
   commit/push/deploy without explicit Founder approval.

Only after this check passes may investigation begin.
```

---

*End of BidRide Vision Lock. This document is permanent and governs all future engineering decisions until the Founder explicitly amends it.*
