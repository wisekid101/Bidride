# BidiRide — Founder AI Architecture Diagram v1.0

**Status:** Pending Founder Approval  
**Author:** Engineering  
**Date:** 2026-07-02  
**Scope:** End-to-end AI data flow across every BidiRide service

---

## Full System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BIDIRIDE AI ARCHITECTURE                           │
│                          Sprint 2C · Alpha · EWR                            │
└─────────────────────────────────────────────────────────────────────────────┘

 ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────┐
 │   RIDER APP      │     │   DRIVER APP     │     │   ADMIN PORTAL       │
 │  (React Native)  │     │  (React Native)  │     │  (Next.js 14)        │
 │                  │     │                  │     │                      │
 │ • HomeScreen     │     │ • DriverHome     │     │ • /admin/ai          │
 │   shows aiFare   │     │   shows heatmap  │     │   AI Model Dashboard │
 │ • BidRequest     │     │ • IncomingReq    │     │ • /admin/marketplace │
 │   shows          │     │   shows aiFare   │     │   Heatmap + Forecast │
 │   winProbability │     │ • EarningsDash   │     │ • /admin/fraud       │
 │ • TripComplete   │     │   [planned:      │     │   Fraud Alerts       │
 │   shows fare     │     │   earnings       │     │                      │
 │                  │     │   optimizer]     │     │                      │
 └────────┬─────────┘     └────────┬─────────┘     └──────────┬───────────┘
          │ REST/HTTPS              │ REST/HTTPS                │ REST/HTTPS
          │                        │                           │
 ┌────────▼─────────┐   ┌──────────▼──────────┐   ┌──────────▼───────────┐
 │  RIDER SERVICE   │   │   DRIVER SERVICE    │   │   ADMIN SERVICE      │
 │     :3004        │   │      :3003          │   │      :3011           │
 │                  │   │                     │   │                      │
 │ Provides:        │   │ Provides:           │   │ Endpoints:           │
 │ riderTrustScore  │   │ driverTrustScore    │   │ GET /admin/ai/       │
 │ riderTotalTrips  │   │ acceptanceRate      │   │   metrics → ai-svc   │
 │                  │   │ completionRate      │   │ GET /admin/ai/       │
 │                  │   │ [planned: proxy to  │   │   health  → ai-svc   │
 │                  │   │ earnings-optimizer  │   │ GET /admin/          │
 │                  │   │ repositioning]      │   │   marketplace →      │
 │                  │   │                     │   │   ai-svc heatmap     │
 └────────┬─────────┘   └──────────┬──────────┘   └──────────┬───────────┘
          │                        │                           │
          └────────────┬───────────┘                           │
                       │                                       │
          ┌────────────▼────────────────────────────────────── ┘
          │           REST (internal key gated)
          │
 ┌────────▼──────────────────────────────────────────────────────────────────┐
 │                           TRIP SERVICE  :3002                             │
 │                                                                           │
 │  FARE REQUEST FLOW                    BID FLOW                            │
 │  ─────────────────                    ──────────────────────              │
 │  createTrip()                         createBid()                         │
 │    └─► pricing-service                  └─► [Bug 1] local formula         │
 │         /pricing/estimate                    should call:                 │
 │                                              POST /ai/bid-win-probability │
 │  endTrip()                                                                │
 │    ├─► recordBidOutcome() ──────────────────► POST /ai/bid-outcome ──┐   │
 │    ├─► chargeRider()                                                  │   │
 │    └─► creditDriverWallet()          DRIVER RANKING                   │   │
 │                                      ────────────────                 │   │
 │  cancelTrip()                        createBid()                      │   │
 │    └─► [Bug 4] no bid_outcome          ├─► POST /ai/driver-ranking ──┤   │
 │         for rejected bids              │    [Bug 2: 0mi distance]     │   │
 │                                        └─► POST /ai/dispatch-simulate ┤   │
 │                                             [Bug 3: score=50]         │   │
 └─────────────────────────────────────────────────────────────────────┬─┘   │
                                                                       │     │
                         ┌─────────────────────────────────────────────▼─────▼──┐
                         │                  AI SERVICE  :3012                    │
                         │                                                       │
                         │  ┌─────────────────────────────────────────────────┐ │
                         │  │  INFERENCE CONTROLLER  (InternalKeyGuard)       │ │
                         │  │                                                  │ │
                         │  │  POST /ai/fare-adjustment ──► FeatureService    │ │
                         │  │    └─► ModelRegistry(champion) ──► FallbackSvc  │ │
                         │  │                                                  │ │
                         │  │  POST /ai/fraud-score ──────► FeatureService    │ │
                         │  │    └─► ModelRegistry(champion) ──► FallbackSvc  │ │
                         │  │                                                  │ │
                         │  │  POST /ai/bid-win-probability                   │ │
                         │  │    └─► FeatureService(Redis enrich)             │ │
                         │  │    └─► BidWinProbabilityEngine (rule-v1)        │ │
                         │  │    └─► runShadows() [challenger/shadow]         │ │
                         │  │                                                  │ │
                         │  │  POST /ai/bid-outcome                           │ │
                         │  │    └─► BidOutcomeService                        │ │
                         │  │    └─► links prediction ← ai_inference_logs     │ │
                         │  │                                                  │ │
                         │  │  POST /ai/driver-ranking                        │ │
                         │  │    └─► DriverRankingService (DB+Redis enrich)   │ │
                         │  │    └─► DriverRankingEngine (ranking-v1)         │ │
                         │  │                                                  │ │
                         │  │  POST /ai/dispatch-simulate                     │ │
                         │  │    └─► DispatchSimulatorService                 │ │
                         │  └─────────────────────────────────────────────────┘ │
                         │                                                       │
                         │  ┌─────────────────────────────────────────────────┐ │
                         │  │  MARKETPLACE CONTROLLER  (no auth guard)        │ │
                         │  │                                                  │ │
                         │  │  GET /ai/heatmap ───────► HeatmapService        │ │
                         │  │  GET /ai/demand-forecast ► DemandForecastService│ │
                         │  │  GET /ai/repositioning ──► RepositioningService │ │
                         │  │  GET /ai/earnings-optimizer ► EarningsOptimizer │ │
                         │  │  GET /ai/marketplace-stats ► heatmap+forecast   │ │
                         │  └─────────────────────────────────────────────────┘ │
                         │                                                       │
                         │  ┌─────────────────────────────────────────────────┐ │
                         │  │  BID PREDICTION MODULE                          │ │
                         │  │                                                  │ │
                         │  │  GET  /ai/metrics ──────► ModelMetricsService   │ │
                         │  │  GET  /ai/health ───────► ModelHealthService    │ │
                         │  └─────────────────────────────────────────────────┘ │
                         │                                                       │
                         │  ┌─────────────────────────────────────────────────┐ │
                         │  │  CROSS-CUTTING SERVICES                         │ │
                         │  │                                                  │ │
                         │  │  InferenceLogService ──────────────────────┐    │ │
                         │  │  ModelHealthService (in-memory metrics)    │    │ │
                         │  │  ModelRegistryService (champion config)    │    │ │
                         │  │  FeatureService (feature assembly + Redis) │    │ │
                         │  │  FallbackService (rule fallbacks)          │    │ │
                         │  └────────────────────────────────────────────┼────┘ │
                         └───────────────────────────────────────────────┼──────┘
                                                                         │
          ┌──────────────────────────────────────────────────────────────┤
          │                                                               │
 ┌────────▼──────────────────────┐              ┌───────────────────────▼──────┐
 │   POSTGRESQL (RDS)            │              │   REDIS (ElastiCache)         │
 │                               │              │                               │
 │  AI Tables                    │              │  Real-time AI signals         │
 │  ──────────────               │              │  ─────────────────────        │
 │  ai_inference_logs            │              │  surge:requests:{zone}        │
 │    every inference logged      │              │    INT — demand counter       │
 │                               │              │    TTL: 24h                   │
 │  bid_outcomes                 │              │                               │
 │    ground truth labels        │              │  surge:drivers:{zone}         │
 │    [Bug 4: rejections missing]│              │    SET — online driver IDs    │
 │                               │              │    TTL: 24h                   │
 │  driver_bid_exposures         │              │                               │
 │    who saw each bid           │              │  driver:{uid}:location        │
 │    [Bug 5: not queried yet]   │              │    JSON — lat/lng ping        │
 │                               │              │    TTL: ~10s (ephemeral)      │
 │  ai_pricing_logs              │              │                               │
 │    [dead — not yet written]   │              │  driver:{uid}:session_start   │
 │                               │              │    INT — epoch ms             │
 │  driver_session_logs          │              │    TTL: 24h                   │
 │    online/offline sessions    │              │                               │
 │                               │              │  queue:ewr                    │
 │  Upstream tables              │              │    ZSET — EWR FIFO queue      │
 │  ──────────────────           │              │    TTL: 24h                   │
 │  trips          (trip data)   │              │                               │
 │  bids           (bid data)    │              │  bid:{bidId}:claimed          │
 │  trust_scores   (scores)      │              │    STRING — atomic claim lock │
 │  fraud_alerts   (flags)       │              │    TTL: 60s                   │
 │  ratings        (ratings)     │              │                               │
 │  drivers        (metrics)     │              └───────────────────────────────┘
 │  riders         (profile)     │
 └───────────────────────────────┘


 EXTERNAL SERVICES (future)
 ──────────────────────────
 ┌─────────────────────────────┐
 │   AWS SAGEMAKER             │
 │                             │
 │  Endpoints (not yet live):  │
 │  SAGEMAKER_FARE_ENDPOINT    │
 │  SAGEMAKER_FRAUD_ENDPOINT   │
 │                             │
 │  Framework: ModelRegistry   │
 │  invokes via AWS SDK        │
 │  Gated by env var presence  │
 └─────────────────────────────┘
```

---

## Data Flow: Ride Request → AI Fare

```
Rider opens app
      │
      ▼
HomeScreen: GET /pricing/estimate
      │
      ▼
pricing-service.estimateFare()
      ├─► haversineDistance(pickup, dropoff) = distanceMiles
      ├─► isNightRide(), isAirportTrip()
      ├─► getSurgeScore() ──► Redis surge:requests:{zone}
      │                            └─► surgeZoneScore = requests / 150
      ├─► rawFare = BASE($2.50) + distance × $1.10 + duration × $0.22
      │            + airportPremium + nightPremium × surgeMultiplier
      │
      └─► getAiAdjustment() ──► POST ai-service /ai/fare-adjustment
                │                     │
                │                     └─► FeatureService.buildFareFeatures()
                │                           └─► {distanceMiles, durationMin,
                │                                surgeZoneScore, isAirport, isNight,
                │                                hourOfDay, dayOfWeek,
                │                                riderTrustScore, riderTotalTrips}
                │                     │
                │                     └─► ModelRegistry.invoke('fare-adjustment')
                │                           ├─ if SAGEMAKER_FARE_ENDPOINT: SageMaker call
                │                           └─ if not: FallbackService → {adjustment: 0}
                │                     │
                │                     └─► InferenceLogService.log() [fire-and-forget]
                │                             → ai_inference_logs row
                │
                └─► adjustment clamped to [-$2.00, +$2.00]
                └─► finalFare = max(rawFare + adjustment, $5.00)

aiFare displayed to rider ──► stored in trips.ai_fare
```

---

## Data Flow: Bid Submission → Win Probability

```
Rider submits bid
      │
      ▼
trip-service.bids.service.createBid()
      ├─► Create trips row + bids row
      ├─► rankDriversWithFallback() ──► POST /ai/driver-ranking
      │        [Bug 2: distance=0, eta=5 for all]
      ├─► simulateDispatchAsync() ──► POST /ai/dispatch-simulate [fire-and-forget]
      │        [Bug 3: score=50 for all]
      ├─► broadcastBidRequest() ──► Redis pub/sub → driver WebSockets
      │        └─► driverBidExposure.createMany() → driver_bid_exposures rows
      │
      └─► [Bug 1] winProbability = local formula (nearbyDrivers/5 × bidRatio^0.5)
               SHOULD BE: POST /ai/bid-win-probability
                            └─► FeatureService.buildBidFeatures()
                            └─► BidWinProbabilityEngine.predict() (13 signals)
                            └─► InferenceLogService.log() → ai_inference_logs row

winProbability returned to rider app → displayed in BidRequestScreen
```

---

## Data Flow: Trip Complete → Training Record

```
Driver ends trip
      │
      ▼
trip-service.trips.service.endTrip()
      ├─► Calculate finalFare, driverEarnings, platformFee
      ├─► Apply earnings floor check
      │
      ├─► recordBidOutcome() [fire-and-forget]
      │        └─► POST /ai/bid-outcome
      │               └─► BidOutcomeService.recordOutcome()
      │                     ├─► Look up ai_inference_logs for this trip_id
      │                     │     (model='bid-win-probability')
      │                     │     → predictionProbability, predictionConfidence
      │                     ├─► predictionCorrect = (prob >= 0.5) == wasAccepted
      │                     └─► [Bug 5] driversViewed=0 (should query driver_bid_exposures)
      │                     └─► INSERT bid_outcomes row
      │
      ├─► chargeRiderForTrip() [fire-and-forget] → payment-service
      └─► creditDriverWalletForTrip() [fire-and-forget] → payment-service

[Bug 4] Rejected bids: NO bid_outcomes row written (wasAccepted=false missing)
```

---

## Data Flow: Fraud Check

```
Trust recalculation (on trip complete, account change, or manual trigger)
      │
      ▼
trust-service.calculateTrustScore()
      ├─► Rule engine: score 0–1000 from identity, trips, rating, disputes, devices
      │
      └─► getFraudProbability()
               └─► POST /ai/fraud-score
                     └─► FeatureService.buildFraudFeatures()
                     └─► ModelRegistry → FallbackService (rule-based now)
                     └─► InferenceLogService.log() → ai_inference_logs row
                     └─► fraudProbability returned
      │
      ├─► If fraudProbability >= 90: triggerFraudHold()
      │        └─► INSERT fraud_alerts row (auto_hold=true)
      │        └─► payment hold initiated
      └─► UPDATE trust_scores row
```

---

## Data Flow: Admin AI Dashboard

```
Admin opens /admin/ai
      │
      ▼
Next.js: GET /api/admin/ai-metrics
      │
      ▼
admin-service: GET /admin/ai/metrics
      │
      ▼
AI service: GET /ai/metrics
      │
      ▼
ModelMetricsService.getMetrics()
      ├─► SELECT from ai_inference_logs WHERE model='bid-win-probability'
      │     → total predictions, avg confidence, p50/p95 latency, fallback rate
      ├─► SELECT from bid_outcomes
      │     → accuracy, precision, recall, TP/FP/FN counts
      ├─► Raw query: by-zone accuracy (bid_outcomes GROUP BY zone_key)
      └─► Raw query: by-hour accuracy (bid_outcomes GROUP BY HOUR(created_at))

Displayed: MetricCard grid + accuracy bars + calibration + zone/hour breakdown
Refresh: every 60 seconds
```

---

## Planned Flows (Sprint 2C Part 2B)

```
[PLANNED] Driver sees earnings optimizer in app

Driver opens EarningsDashboard
      │
      ▼
driver-app: GET /driver/ai/earnings-optimizer?lat=&lng=&hoursOnline=
      │
      ▼
driver-service: proxy → GET ai-service /ai/earnings-optimizer
      │
      ▼
EarningsOptimizerService.getRecommendations()
      ├─► Redis scan: surge:requests:* within 8mi radius
      ├─► EWR queue length from Redis queue:ewr
      └─► Returns: bestZones, bestHours, breakRec, airportRec

Displayed: AI-powered card on EarningsDashboard screen


[PLANNED] Driver sees repositioning suggestion when idle

DriverHomeScreen polls every 60s when online + no active trip
      │
      ▼
driver-service: proxy → GET ai-service /ai/repositioning?lat=&lng=
      │
      ▼
RepositioningService.getRecommendations()
      ├─► Check 5×5 grid of adjacent zones via Redis
      └─► Returns: top 3 zones with demand score and ride success probability

Displayed: subtle banner "Better demand 1.2mi north" when score > 0.3
```

---

## Known Bugs Summary (for reference during Part 2B)

| Bug | Location | Description | Impact |
|---|---|---|---|
| Bug 1 | `bids.service.ts:177` | winProbability uses local formula, not AI endpoint | AI model bypassed; ModelMetrics has no data |
| Bug 2 | `bids.service.ts:751` | `haversineDistance(lat, lng, lat, lng)` = 0 for all drivers | Driver ranking proximity signal is meaningless |
| Bug 3 | `bids.service.ts:772` | dispatch-simulate receives `score: 50` for all candidates | Strategy selection based on dummy data |
| Bug 4 | `trips.service.ts:588` | `recordBidOutcome` only called on accepted bids | Training dataset has 100% positive bias |
| Bug 5 | `bid-outcome.service.ts:46` | `driversViewed` etc always 0; DriverBidExposure not queried | Supply-side features unusable for training |
