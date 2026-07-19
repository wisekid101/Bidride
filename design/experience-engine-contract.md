# BidiRide — Rider & Driver Experience Engine Contract v1.0 (Phase 3.1, contract only)

**Status:** Contract approved for future implementation — NOT implemented
**Date:** 2026-07-11
**Code contract:** `services/ai-service/src/experience/experience-contract.types.ts`

No rider or driver receives an AI recommendation in Phase 3.1. This document
fixes the rules any future Experience Engine must honor before a line of its
implementation is approved.

## The deal with the user

1. **Explicit preferences, defaults off.** Nobody is enrolled by inference.
   Each category (earnings tips, demand heat-ups, offer guidance, wait
   expectations) is an explicit opt-in stored per user.
2. **Everything is dismissible.** The type system says `dismissible: true` —
   there is no non-dismissible variant to reach for.
3. **"Why am I seeing this?" is mandatory.** Every suggestion carries a
   user-visible explanation with the aggregate evidence behind it and a plain
   list of the data used. If it can't explain itself, it can't be shown.
4. **History.** Users can see everything they were shown and what they did
   with it.
5. **Opt-out and reset.** One switch turns everything off immediately; one
   action resets all preferences to defaults (off). `getActiveRecommendations`
   returns an empty list the moment the master switch is off.
6. **No hidden behavioral manipulation.** Suggestions state what they are and
   why. No urgency theater, no dark patterns, no undisclosed experiments on
   suggestion content (experiments follow the shadow/challenger governance
   like every other model).

## Prohibited inputs (hard, reviewed, testable)

- Trust scores — **no trust-score personalization** (extends Rule 3a's pricing
  prohibition to the experience surface).
- Protected characteristics or their proxies (Rule 3).
- Inferred sensitive traits of any kind — the engine may not build them,
  buy them, or consume them.
- Panic/SOS/safety data (Rule 6).
- Individual payment amounts or payment methods — **no financial
  discrimination**: two users in the same zone at the same time are shown the
  same suggestions.
- Support-ticket body text; raw GPS traces (zone aggregates only).

## Architecture position

The engine is a *delivery* layer, not an intelligence layer: every suggestion
must reference a governed ledger recommendation (`recommendationId`) produced
by the `driver_success` or `rider_experience` domain under their manifests,
kill switches, and shadow rules. The engine adds preference filtering,
delivery, dismissal, and history — it computes nothing and stores no features.

## Acceptance preconditions for implementation (future milestone)

Founder approval; domain families outcome-evidenced per governance; privacy
review of the preference store; UX review of the "why" surface; kill switch
(`ai_driver_success_enabled` / `ai_rider_experience_enabled`) wired before the
first suggestion renders.
