# BidRide — Technical Architecture v1.0 · Part 2: Database Architecture

**Status:** Draft — Pending Founder Approval
**Document:** 08-B · Part 2 of 5

---

## Entity Relationship Overview

```
users ──< riders ──< trips >── drivers >── users
                 ──< bids
                 ──< payments
                 ──< ratings
                 ──< trusted_contacts
                 ──< safe_check_ins

drivers ──< vehicles
        ──< driver_documents
        ──< driver_suspensions
        ──< driver_rewards
        ──< trust_scores ──< trust_score_history
        ──< device_fingerprints
        ──< airport_queue_entries

trips ──< trip_events
      ──< safety_sessions ──< sos_events
                          ──< panic_events
                          ──< safety_recordings
      ──< bids

admin_users ──< audit_logs
            ──< admin_notes (polymorphic: drivers | riders | trips)
            ──< safety_incident_assignments >── safety_incidents
```

---

## Core Tables

### `users`
```sql
id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
phone         VARCHAR(20) UNIQUE NOT NULL
email         VARCHAR(255) UNIQUE NOT NULL
password_hash VARCHAR(255) NOT NULL
phone_verified BOOLEAN DEFAULT FALSE
email_verified BOOLEAN DEFAULT FALSE
role          ENUM('rider','driver') NOT NULL
created_at    TIMESTAMP DEFAULT now()
updated_at    TIMESTAMP DEFAULT now()
deleted_at    TIMESTAMP NULL  -- soft delete
```

### `riders`
```sql
id               UUID PRIMARY KEY
user_id          UUID REFERENCES users(id) UNIQUE
display_name     VARCHAR(100)
profile_photo_url VARCHAR(500)
date_of_birth    DATE
current_badge    ENUM('verified','trusted','business','vip') DEFAULT 'verified'
trust_score_id   UUID REFERENCES trust_scores(id)
stripe_customer_id VARCHAR(100)
default_payment_method_id VARCHAR(100)
corporate_account_id UUID REFERENCES corporate_accounts(id) NULL
rewards_points   INTEGER DEFAULT 0
rewards_tier     ENUM('silver','gold','platinum','elite') DEFAULT 'silver'
total_trips      INTEGER DEFAULT 0
created_at       TIMESTAMP DEFAULT now()
updated_at       TIMESTAMP DEFAULT now()
```

### `drivers`
```sql
id                        UUID PRIMARY KEY
user_id                   UUID REFERENCES users(id) UNIQUE
status                    ENUM('pending','under_review','action_required','approved','declined','suspended') DEFAULT 'pending'
legal_first_name          VARCHAR(100) NOT NULL
legal_last_name           VARCHAR(100) NOT NULL
date_of_birth             DATE NOT NULL
home_address              VARCHAR(255)
home_city                 VARCHAR(100)
home_state                VARCHAR(2)
home_zip                  VARCHAR(10)
license_number            VARCHAR(50)
license_state             VARCHAR(2)
license_class             VARCHAR(10)
license_expiry            DATE
license_ai_confidence     DECIMAL(5,2)
background_check_id       VARCHAR(100)
background_check_status   ENUM('not_started','pending','clear','consider','adverse_action','disputed') DEFAULT 'not_started'
background_check_ordered_at TIMESTAMP NULL
background_check_cleared_at TIMESTAMP NULL
insurance_policy_number   VARCHAR(100)
insurance_provider        VARCHAR(100)
insurance_expiry          DATE NULL
primary_vehicle_id        UUID NULL
profile_photo_url         VARCHAR(500) NULL
profile_photo_status      ENUM('pending','approved','rejected') DEFAULT 'pending'
stripe_account_id         VARCHAR(100) NULL
payout_bank_verified      BOOLEAN DEFAULT FALSE
payout_bank_verified_at   TIMESTAMP NULL
current_badge             ENUM('verified','trusted','vip') DEFAULT 'verified'
trust_score_id            UUID NULL
eligible_ride_types       JSONB DEFAULT '["standard"]'
total_trips               INTEGER DEFAULT 0
avg_rating                DECIMAL(3,2) DEFAULT 0.00
acceptance_rate           DECIMAL(5,2) DEFAULT 0.00
completion_rate           DECIMAL(5,2) DEFAULT 0.00
applied_at                TIMESTAMP DEFAULT now()
approved_at               TIMESTAMP NULL
declined_at               TIMESTAMP NULL
decline_reason            TEXT NULL
created_at                TIMESTAMP DEFAULT now()
updated_at                TIMESTAMP DEFAULT now()
```

### `vehicles`
```sql
id              UUID PRIMARY KEY
driver_id       UUID REFERENCES drivers(id)
make            VARCHAR(50) NOT NULL
model           VARCHAR(50) NOT NULL
year            SMALLINT NOT NULL
color           VARCHAR(30) NOT NULL
license_plate   VARCHAR(20) NOT NULL
vin             VARCHAR(17) NULL
eligible_types  JSONB DEFAULT '["standard"]'
is_active       BOOLEAN DEFAULT TRUE
status          ENUM('pending','approved','rejected') DEFAULT 'pending'
created_at      TIMESTAMP DEFAULT now()
```

---

## Trip Tables

### `trips`
```sql
id                    UUID PRIMARY KEY
rider_id              UUID REFERENCES riders(id)
driver_id             UUID REFERENCES drivers(id) NULL
vehicle_id            UUID REFERENCES vehicles(id) NULL
bid_id                UUID REFERENCES bids(id) NULL
status                ENUM('searching','accepted','driver_en_route','driver_arrived','in_progress','completed','cancelled','no_show') DEFAULT 'searching'
ride_type             ENUM('standard','priority','premium') DEFAULT 'standard'
pickup_address        VARCHAR(255)
pickup_lat            DECIMAL(9,6)
pickup_lng            DECIMAL(9,6)
dropoff_address       VARCHAR(255)
dropoff_lat           DECIMAL(9,6)
dropoff_lng           DECIMAL(9,6)
ai_fare               DECIMAL(8,2) NOT NULL
final_fare            DECIMAL(8,2) NULL
driver_earnings       DECIMAL(8,2) NULL
platform_fee          DECIMAL(8,2) NULL
earnings_floor_met    BOOLEAN DEFAULT TRUE
earnings_supplement   DECIMAL(8,2) DEFAULT 0.00
pickup_wait_seconds   INTEGER DEFAULT 0
wait_fee_charged      DECIMAL(8,2) DEFAULT 0.00
route_distance_miles  DECIMAL(6,2) NULL
actual_distance_miles DECIMAL(6,2) NULL
estimated_duration_min INTEGER NULL
actual_duration_min   INTEGER NULL
driver_rating_rider   SMALLINT NULL
rider_rating_driver   SMALLINT NULL
is_airport_trip       BOOLEAN DEFAULT FALSE
is_night_ride         BOOLEAN DEFAULT FALSE
route_deviation_count INTEGER DEFAULT 0
accepted_at           TIMESTAMP NULL
started_at            TIMESTAMP NULL
completed_at          TIMESTAMP NULL
cancelled_at          TIMESTAMP NULL
cancel_reason         VARCHAR(255) NULL
created_at            TIMESTAMP DEFAULT now()
```

### `bids`
```sql
id             UUID PRIMARY KEY
trip_id        UUID REFERENCES trips(id)
rider_id       UUID REFERENCES riders(id)
driver_id      UUID REFERENCES drivers(id) NULL
ai_fare        DECIMAL(8,2) NOT NULL
rider_offer    DECIMAL(8,2) NOT NULL
counter_offer  DECIMAL(8,2) NULL
final_fare     DECIMAL(8,2) NULL
counter_round  SMALLINT DEFAULT 0
status         ENUM('pending','accepted','declined','countered','expired','withdrawn') DEFAULT 'pending'
expires_at     TIMESTAMP NOT NULL
created_at     TIMESTAMP DEFAULT now()
resolved_at    TIMESTAMP NULL
```

### `trip_events`
```sql
id          UUID PRIMARY KEY
trip_id     UUID REFERENCES trips(id)
event_type  VARCHAR(50) NOT NULL
lat         DECIMAL(9,6) NULL
lng         DECIMAL(9,6) NULL
metadata    JSONB DEFAULT '{}'
created_at  TIMESTAMP DEFAULT now()
```

---

## Safety Tables

### `safety_sessions`
```sql
id                  UUID PRIMARY KEY
trip_id             UUID REFERENCES trips(id) UNIQUE
current_state       ENUM('normal','soft_alert','moderate_alert','critical','sos_active','panic_active','incident_closed') DEFAULT 'normal'
is_night_ride       BOOLEAN DEFAULT FALSE
is_airport_trip     BOOLEAN DEFAULT FALSE
check_in_status     ENUM('pending','safe','escalated','not_required') DEFAULT 'not_required'
admin_assigned_id   UUID REFERENCES admin_users(id) NULL
sla_deadline        TIMESTAMP NULL
sla_breached        BOOLEAN DEFAULT FALSE
created_at          TIMESTAMP DEFAULT now()
updated_at          TIMESTAMP DEFAULT now()
```

### `sos_events`
```sql
id                      UUID PRIMARY KEY
trip_id                 UUID REFERENCES trips(id)
safety_session_id       UUID REFERENCES safety_sessions(id)
initiated_by_user_id    UUID REFERENCES users(id)
initiated_by_role       ENUM('rider','driver')
trigger_source          ENUM('button_tap','volume_shortcut','auto_escalation','admin_triggered')
activation_confirmed_at TIMESTAMP NULL
cancelled_at            TIMESTAMP NULL
confirmed_safe_at       TIMESTAMP NULL
gps_at_activation       POINT
contacts_notified_count INTEGER DEFAULT 0
admin_assigned_id       UUID REFERENCES admin_users(id) NULL
sla_met                 BOOLEAN NULL
recording_id            UUID NULL
status                  ENUM('active','resolved','false_alarm','escalated_to_dispatch') DEFAULT 'active'
resolution_notes        TEXT NULL
resolved_at             TIMESTAMP NULL
created_at              TIMESTAMP DEFAULT now()
```

### `safety_recordings`
```sql
id                  UUID PRIMARY KEY
trip_id             UUID REFERENCES trips(id)
sos_event_id        UUID REFERENCES sos_events(id)
storage_bucket      VARCHAR(100) NOT NULL
storage_key         VARCHAR(500) NOT NULL
encryption_key_id   VARCHAR(100) NOT NULL
duration_seconds    INTEGER NULL
retention_category  ENUM('no_action_30d','action_taken_2y','law_enforcement_hold') DEFAULT 'no_action_30d'
delete_after        TIMESTAMP NULL
access_log          JSONB DEFAULT '[]'
status              ENUM('recording','complete','deleted','held') DEFAULT 'recording'
created_at          TIMESTAMP DEFAULT now()
```

---

## Trust & Fraud Tables

### `trust_scores`
```sql
id                    UUID PRIMARY KEY
user_id               UUID REFERENCES users(id) UNIQUE
user_role             ENUM('rider','driver')
trust_score           SMALLINT DEFAULT 200
fraud_probability     DECIMAL(5,2) DEFAULT 0.00
verification_confidence DECIMAL(5,2) DEFAULT 50.00
current_badge         VARCHAR(20) DEFAULT 'verified'
last_calculated_at    TIMESTAMP DEFAULT now()
created_at            TIMESTAMP DEFAULT now()
```

### `device_fingerprints`
```sql
id              UUID PRIMARY KEY
user_id         UUID REFERENCES users(id)
fingerprint     VARCHAR(255) NOT NULL
platform        ENUM('ios','android')
first_seen_at   TIMESTAMP DEFAULT now()
last_seen_at    TIMESTAMP DEFAULT now()
is_blocked      BOOLEAN DEFAULT FALSE
UNIQUE(user_id, fingerprint)
```

### `multi_account_links`
```sql
id              UUID PRIMARY KEY
user_id_a       UUID REFERENCES users(id)
user_id_b       UUID REFERENCES users(id)
link_type       ENUM('shared_device','shared_phone','shared_payment','shared_ip')
confidence      DECIMAL(5,2)
flagged         BOOLEAN DEFAULT FALSE
created_at      TIMESTAMP DEFAULT now()
```

---

## Payment Tables

### `payments`
```sql
id                  UUID PRIMARY KEY
trip_id             UUID REFERENCES trips(id)
rider_id            UUID REFERENCES riders(id)
stripe_payment_intent_id VARCHAR(100) UNIQUE
amount              DECIMAL(8,2) NOT NULL
currency            VARCHAR(3) DEFAULT 'usd'
status              ENUM('pending','succeeded','failed','refunded','partially_refunded') DEFAULT 'pending'
refund_amount       DECIMAL(8,2) DEFAULT 0.00
created_at          TIMESTAMP DEFAULT now()
```

### `payouts`
```sql
id                  UUID PRIMARY KEY
driver_id           UUID REFERENCES drivers(id)
period_start        DATE NOT NULL
period_end          DATE NOT NULL
trip_earnings       DECIMAL(10,2) NOT NULL
floor_supplements   DECIMAL(10,2) DEFAULT 0.00
instant_fees        DECIMAL(10,2) DEFAULT 0.00
reward_bonuses      DECIMAL(10,2) DEFAULT 0.00
total_payout        DECIMAL(10,2) NOT NULL
stripe_transfer_id  VARCHAR(100) NULL
status              ENUM('pending','processing','paid','failed') DEFAULT 'pending'
paid_at             TIMESTAMP NULL
created_at          TIMESTAMP DEFAULT now()
```

### `earnings_floor_logs`
```sql
id               UUID PRIMARY KEY
trip_id          UUID REFERENCES trips(id) UNIQUE
driver_id        UUID REFERENCES drivers(id)
floor_amount     DECIMAL(8,2) NOT NULL
earned_amount    DECIMAL(8,2) NOT NULL
supplement_amount DECIMAL(8,2) NOT NULL
formula_inputs   JSONB NOT NULL
payout_id        UUID REFERENCES payouts(id) NULL
created_at       TIMESTAMP DEFAULT now()
```

---

## Platform Config

### `platform_config`
```sql
key           VARCHAR(100) PRIMARY KEY
value         JSONB NOT NULL
description   TEXT
changed_by    UUID REFERENCES admin_users(id)
changed_at    TIMESTAMP DEFAULT now()
```

Initial rows:
- `earnings_floor_formula` → `{ "per_mile": 1.10, "per_min": 0.22, "base": 2.50 }`
- `platform_fee_rate` → `{ "rate": 0.20 }`
- `instant_payout_fee` → `{ "flat": 0.99 }`
- `ai_surge_threshold` → `{ "requests_per_zone": 150 }`

---

## Indexing Strategy

```sql
-- High-frequency trip lookups
CREATE INDEX idx_trips_driver_status ON trips(driver_id, status);
CREATE INDEX idx_trips_rider_created ON trips(rider_id, created_at DESC);
CREATE INDEX idx_trips_status_created ON trips(status, created_at DESC);

-- Real-time dispatch
CREATE INDEX idx_drivers_status_badge ON drivers(status, current_badge);

-- Safety — SLA monitoring
CREATE INDEX idx_safety_sessions_state ON safety_sessions(current_state, sla_deadline);
CREATE INDEX idx_sos_events_status ON sos_events(status, created_at);

-- Trust scoring
CREATE INDEX idx_trust_scores_user ON trust_scores(user_id, user_role);
CREATE INDEX idx_device_fingerprints_fp ON device_fingerprints(fingerprint);

-- Airport queue
CREATE INDEX idx_airport_queue_status ON airport_queue_entries(status, queue_position);

-- Admin audit
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id, created_at DESC);
CREATE INDEX idx_audit_logs_admin ON audit_logs(admin_id, created_at DESC);

-- Payment lookup
CREATE INDEX idx_payments_trip ON payments(trip_id);
CREATE INDEX idx_payouts_driver_period ON payouts(driver_id, period_start);
```

## Partitioning

`trips` table is range-partitioned by `created_at` month:
```sql
CREATE TABLE trips PARTITION BY RANGE (created_at);
CREATE TABLE trips_2026_06 PARTITION OF trips
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- New partition created first day of each month via scheduled Lambda
```

Partitioning benefits: query performance on date-range analytics; faster purge of old data; parallel vacuum.

---

*BidRide Technical Architecture — Part 2 of 5 — Confidential · Delaware LLC*
