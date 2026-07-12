# BidRide — Learning Graph Design v1.0 (Phase 3.1, design only — DO NOT BUILD)

**Status:** Design for future consideration — no implementation approved
**Date:** 2026-07-11

The question this document answers: should BidRide's intelligence learn over
an explicit graph of marketplace relationships, and if so, how do we build one
that can never become a hidden user-surveillance system?

## 1. Verdict first: no graph database

**A dedicated graph database is not needed** — now, and probably not at
100,000 users either. Reasons:

1. Every relationship the intelligence layer needs is already a foreign key or
   a zone key in Postgres. Graph queries we actually foresee (zone↔zone flows,
   driver↔zone service patterns, cohort transitions) are 1–2 hops — join
   territory, not traversal territory.
2. A graph DB adds an operational system, a second copy of relationship data,
   and a new attack/privacy surface, against zero current query need.
3. The dangerous graph capability — deep multi-hop traversal from an
   individual — is precisely the capability we want NOT to have (§5).

The "Learning Graph" is therefore a **logical model**: a documented set of
aggregate nodes/edges **projected into the existing feature store** (Postgres
aggregates + Redis TTL keys), recomputed on schedule, discarded on TTL. If a
future product (e.g., multi-hop fraud rings at scale) demonstrates a real
traversal need, that becomes its own Founder-approved proposal.

## 2. Nodes (allowed)

| Node | Identifier | Notes |
|---|---|---|
| Zone | zoneKey (2km grid) | the atom of location — finest allowed granularity |
| Zone-hour profile | zoneKey + hour + dow | demand/supply/wait/earnings aggregates |
| Model family | modelName | performance lineage |
| Recommendation | ledger id | adoption/outcome lineage |
| Cohort | **opaque cohort id** | pseudonymous group ≥ k members (k=10); resolvable to people ONLY inside existing role-gated admin views |
| Ticket category | enum | volumes/durations only |
| Vehicle class | enum | |

## 3. Relationships (allowed, aggregate-only)

- Zone →(trip_flow, n, window)→ Zone — trip count flows, never individual routes
- Cohort →(serves, n)→ Zone — e.g., "driver cohort C123 serves zones A,B"
- Cohort →(transition, rate)→ Cohort — e.g., active→dormant driver cohorts
- ModelFamily →(recommended_in)→ Zone — where recommendations concentrate
- Recommendation →(evidence_from)→ Zone-hour profile
- TicketCategory →(concentrates_in, rate)→ Zone

## 4. Identifiers

**Allowed:** zoneKey, cohortId (opaque, k≥10), model/family names, ledger ids,
enum categories, window labels.
**Prohibited as graph identifiers:** userId, riderId, driverId, phone, email,
names, device fingerprints, payment identifiers, raw coordinates, trip ids as
*traversable* nodes (trip ids may appear only as provenance references inside
evidence, never as graph vertices connecting people).

## 5. Privacy boundaries (the anti-surveillance rules)

1. **No person is a node.** The graph cannot answer "who" questions by
   construction — its vertices are places, cohorts, models, and categories.
2. **k-anonymity floor:** any cohort or edge with fewer than k=10 members
   collapses into its parent aggregate or is dropped.
3. **One-way door:** projections aggregate upward (rows → cohorts/zones);
   nothing in the feature store links back to individuals. Drill-down to
   people happens only in existing role-gated, audited admin surfaces.
4. **No cross-tenant edges:** when business accounts exist, each business's
   demand data aggregates within its own boundary; cross-business edges only
   at city-level aggregates (tenant boundary).
5. Panic/SOS, protected characteristics, ticket text: excluded at the source
   per standing governance — the graph inherits every existing prohibition.

## 6. Aggregation, retention, deletion

- Projections run on the feature-store cadence (60s for hot Redis keys, daily
  for Postgres profile tables); every projected row carries `computed_at`,
  `source_window`, `schema_version`.
- Hot keys: TTL 180s (existing). Profile tables: TRAINING class, 1-year
  retention via the Phase 3.1 retention service (extend its allowlist when the
  tables exist).
- **User deletion:** because individuals are never nodes, deleting a user
  requires no graph surgery — their rows disappear from canonical tables and
  the next projection window simply no longer includes them. Cohort ids are
  recomputed per window, so membership is not a stored personal record.

## 7. Projection into the existing feature store

Each edge family = one projection job (the FeatureStoreService pattern):
`ai:feature:flow:{fromZone}:{toZone}`, `ai_profiles_zone_hour` (future table),
`ai:feature:cohort:{cohortId}:zone:{zoneKey}`. Consumers are the shadowed
prediction modules and Founder briefs — the same consumers, same gates, same
kill switches as every other feature.

## 8. What would change this verdict

Fraud-ring detection at ≥100k users (multi-hop device/payment link traversal)
is the one credible graph-DB use case on the horizon. If Integrity
Intelligence hits Postgres recursion limits on real cases, that team brings a
scoped proposal: separate store, Integrity-only access, subpoena-grade audit,
its own retention — never merged with the marketplace learning graph.
