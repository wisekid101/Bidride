# BidRide Database Architecture

> **Status: DRAFT — Awaiting founder approval before development begins**
> **Last updated: 2026-06-24**
> **Database: PostgreSQL 15+ with PostGIS extension**

---

## TABLE OF CONTENTS
1. [Design Principles](#1-design-principles)
2. [Schema Overview](#2-schema-overview)
3. [Core Tables](#3-core-tables)
4. [Ride & Bid Tables](#4-ride--bid-tables)
5. [Financial Tables](#5-financial-tables)
6. [Safety & Compliance Tables](#6-safety--compliance-tables)
7. [Geospatial Tables](#7-geospatial-tables)
8. [Indexes & Performance](#8-indexes--performance)
9. [Data Retention & Archival](#9-data-retention--archival)
10. [Redis Schema](#10-redis-schema)

---

## 1. Design Principles

- **Soft deletes everywhere** — never hard-delete a record; use `deleted_at` timestamps for legal and audit compliance
- **Immutable financial records** — payment and payout records are never updated, only appended
- **UUID primary keys** — avoids exposing sequential IDs that reveal business volume
- **Audit timestamps** — every table has `created_at` and `updated_at`
- **No cross-module joins in application code** — each service module owns its tables; foreign keys exist but cross-module queries go through the service layer
- **PostGIS for all geographic data** — use `GEOGRAPHY(POINT)` type for driver locations and trip coordinates

---

## 2. Schema Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CORE IDENTITY                                 │
│   users  ←→  driver_profiles  ←→  vehicles  ←→  driver_documents   │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                        RIDE LIFECYCLE                                │
│   rides  ←→  bids  ←→  ride_status_history  ←→  ride_messages      │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                        FINANCIAL                                     │
│   payments  ←→  driver_payouts  ←→  platform_fees  ←→  refunds     │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                     SAFETY & COMPLIANCE                              │
│   safety_incidents  ←→  zero_tolerance_reports  ←→  audit_logs     │
└─────────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────────┐
│                        GEOSPATIAL                                    │
│   service_zones  ←→  trip_route_snapshots  ←→  driver_locations    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Tables

### `users`
Stores all platform users — riders and drivers share this table. Role determines access.

```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             VARCHAR(20) UNIQUE NOT NULL,
  email             VARCHAR(255) UNIQUE,
  full_name         VARCHAR(255) NOT NULL,
  role              VARCHAR(20) NOT NULL CHECK (role IN ('rider', 'driver', 'admin')),
  status            VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deactivated', 'pending')),
  profile_photo_url TEXT,
  average_rating    NUMERIC(3,2),
  total_ratings     INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id VARCHAR(255),        -- Riders: Stripe customer ID
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ,          -- Soft delete
  last_active_at    TIMESTAMPTZ
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);
```

### `driver_profiles`
Extended information for users with role='driver'. One-to-one with users.

```sql
CREATE TABLE driver_profiles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id),
  license_number        VARCHAR(50) NOT NULL,
  license_state         VARCHAR(2) NOT NULL,
  license_expiry        DATE NOT NULL,
  ssn_encrypted         TEXT NOT NULL,              -- AES-256 encrypted, never plaintext
  ssn_last_four         VARCHAR(4) NOT NULL,
  date_of_birth         DATE NOT NULL,
  onboarding_status     VARCHAR(30) NOT NULL DEFAULT 'pending'
                        CHECK (onboarding_status IN (
                          'pending', 'documents_submitted', 'background_check_in_progress',
                          'background_check_passed', 'background_check_failed',
                          'vehicle_inspection_pending', 'approved', 'rejected'
                        )),
  checkr_candidate_id   VARCHAR(255),               -- Checkr API reference
  background_check_status VARCHAR(20) DEFAULT 'pending'
                        CHECK (background_check_status IN (
                          'pending', 'in_progress', 'passed', 'failed', 'expired'
                        )),
  mvr_status            VARCHAR(20) DEFAULT 'pending',
  stripe_account_id     VARCHAR(255),               -- Stripe Connect account ID
  is_online             BOOLEAN NOT NULL DEFAULT FALSE,
  total_rides           INTEGER NOT NULL DEFAULT 0,
  cancellation_rate     NUMERIC(5,4) DEFAULT 0,     -- e.g. 0.0500 = 5%
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);
```

### `vehicles`
Driver vehicles. A driver may have multiple vehicles but only one active at a time.

```sql
CREATE TABLE vehicles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES driver_profiles(id),
  make            VARCHAR(50) NOT NULL,
  model           VARCHAR(50) NOT NULL,
  year            SMALLINT NOT NULL,
  color           VARCHAR(30) NOT NULL,
  license_plate   VARCHAR(20) NOT NULL,
  plate_state     VARCHAR(2) NOT NULL,
  vin             VARCHAR(17),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  inspection_status VARCHAR(20) DEFAULT 'pending'
                  CHECK (inspection_status IN ('pending', 'passed', 'failed', 'expired')),
  inspection_date DATE,
  inspection_expiry DATE,
  photo_urls      JSONB,                            -- Array of S3 URLs
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vehicles_driver_id ON vehicles(driver_id);
CREATE INDEX idx_vehicles_plate ON vehicles(license_plate, plate_state);
```

### `driver_documents`
Stores metadata for uploaded driver documents (actual files in S3).

```sql
CREATE TABLE driver_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       UUID NOT NULL REFERENCES driver_profiles(id),
  document_type   VARCHAR(50) NOT NULL
                  CHECK (document_type IN (
                    'drivers_license_front', 'drivers_license_back',
                    'vehicle_registration', 'personal_insurance',
                    'vehicle_photo_front', 'vehicle_photo_back',
                    'vehicle_photo_left', 'vehicle_photo_right',
                    'vehicle_photo_interior', 'profile_photo'
                  )),
  s3_key          TEXT NOT NULL,                    -- Never expose raw S3 URL
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expiry_date     DATE,
  rejection_reason TEXT,
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `payment_methods`
Rider saved payment methods (tokenized by Stripe — no card data stored here).

```sql
CREATE TABLE payment_methods (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id),
  stripe_payment_method_id VARCHAR(255) NOT NULL,  -- Stripe's PM ID (pm_xxx)
  card_brand            VARCHAR(20),                -- visa, mastercard, amex, etc.
  card_last_four        VARCHAR(4),
  card_exp_month        SMALLINT,
  card_exp_year         SMALLINT,
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX idx_payment_methods_user_id ON payment_methods(user_id);
```

### `ratings`
Post-trip ratings from both riders and drivers.

```sql
CREATE TABLE ratings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id       UUID NOT NULL REFERENCES rides(id),
  rater_id      UUID NOT NULL REFERENCES users(id),
  ratee_id      UUID NOT NULL REFERENCES users(id),
  rater_role    VARCHAR(10) NOT NULL CHECK (rater_role IN ('rider', 'driver')),
  stars         SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags          TEXT[],                             -- e.g. ['great_navigation', 'friendly']
  comment       TEXT,
  is_visible    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ride_id, rater_id)
);
```

---

## 4. Ride & Bid Tables

### `rides`
The central table. Every completed, cancelled, or in-progress trip lives here.

```sql
CREATE TABLE rides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id            UUID NOT NULL REFERENCES users(id),
  driver_id           UUID REFERENCES users(id),   -- NULL until driver assigned
  vehicle_id          UUID REFERENCES vehicles(id),
  
  -- Status
  status              VARCHAR(30) NOT NULL DEFAULT 'requesting'
                      CHECK (status IN (
                        'requesting',         -- Rider requested, finding drivers
                        'bid_pending',        -- Rider submitted bid, awaiting driver
                        'driver_assigned',    -- Driver accepted, en route to rider
                        'driver_arrived',     -- Driver at pickup location
                        'in_progress',        -- Rider in vehicle
                        'completed',          -- Trip ended, payment processed
                        'cancelled_by_rider',
                        'cancelled_by_driver',
                        'cancelled_by_system',
                        'no_drivers_available'
                      )),
  
  -- Location
  pickup_address      TEXT NOT NULL,
  pickup_location     GEOGRAPHY(POINT, 4326) NOT NULL,
  dropoff_address     TEXT NOT NULL,
  dropoff_location    GEOGRAPHY(POINT, 4326) NOT NULL,
  actual_pickup       GEOGRAPHY(POINT, 4326),       -- Where driver actually picked up
  actual_dropoff      GEOGRAPHY(POINT, 4326),
  
  -- Pricing
  ride_type           VARCHAR(20) NOT NULL DEFAULT 'standard'
                      CHECK (ride_type IN ('standard', 'bid')),
  estimated_fare      NUMERIC(10,2) NOT NULL,
  final_fare          NUMERIC(10,2),               -- Set on completion
  distance_miles      NUMERIC(8,2),
  duration_minutes    INTEGER,
  surge_multiplier    NUMERIC(4,2) DEFAULT 1.00,
  
  -- Airport
  is_airport_ride     BOOLEAN NOT NULL DEFAULT FALSE,
  airport_fee         NUMERIC(10,2),               -- EWR Port Authority fee
  
  -- Cancellation
  cancellation_reason TEXT,
  cancellation_fee    NUMERIC(10,2),
  
  -- Timestamps
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  driver_assigned_at  TIMESTAMPTZ,
  driver_arrived_at   TIMESTAMPTZ,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rides_rider_id ON rides(rider_id);
CREATE INDEX idx_rides_driver_id ON rides(driver_id);
CREATE INDEX idx_rides_status ON rides(status);
CREATE INDEX idx_rides_requested_at ON rides(requested_at DESC);
CREATE INDEX idx_rides_pickup_location ON rides USING GIST(pickup_location);
CREATE INDEX idx_rides_dropoff_location ON rides USING GIST(dropoff_location);
```

### `bids`
Records every bid, counter-offer, and bid outcome in the bid flow.

```sql
CREATE TABLE bids (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id           UUID NOT NULL REFERENCES rides(id),
  
  -- Who is acting
  rider_id          UUID NOT NULL REFERENCES users(id),
  driver_id         UUID REFERENCES users(id),     -- NULL for initial rider bid
  
  -- Bid details
  bid_type          VARCHAR(20) NOT NULL
                    CHECK (bid_type IN (
                      'rider_bid',       -- Initial bid from rider
                      'driver_counter',  -- Driver counter-offer
                      'rider_counter'    -- Rider response to counter (if we allow it)
                    )),
  amount            NUMERIC(10,2) NOT NULL,
  
  -- Status
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending',    -- Awaiting response
                      'accepted',   -- Other party accepted
                      'rejected',   -- Other party rejected
                      'countered',  -- Other party countered (new bid record created)
                      'expired',    -- TTL reached with no response
                      'cancelled'   -- Ride cancelled before bid resolved
                    )),
  
  -- Parent bid (for counter-offers — links back to original)
  parent_bid_id     UUID REFERENCES bids(id),
  
  -- Expiration
  expires_at        TIMESTAMPTZ NOT NULL,
  responded_at      TIMESTAMPTZ,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bids_ride_id ON bids(ride_id);
CREATE INDEX idx_bids_status ON bids(status);
CREATE INDEX idx_bids_expires_at ON bids(expires_at)
  WHERE status = 'pending';             -- Partial index for expiration job
```

### `ride_status_history`
Immutable log of every status change on a ride. Never update — only insert.

```sql
CREATE TABLE ride_status_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id),
  old_status  VARCHAR(30),
  new_status  VARCHAR(30) NOT NULL,
  changed_by  UUID REFERENCES users(id),   -- NULL for system changes
  reason      TEXT,
  metadata    JSONB,                        -- Additional context
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ride_status_history_ride_id ON ride_status_history(ride_id);
```

### `ride_messages`
In-app messages between rider and driver for a specific ride.

```sql
CREATE TABLE ride_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id),
  sender_id   UUID NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ride_messages_ride_id ON ride_messages(ride_id);
```

---

## 5. Financial Tables

### `payments`
One record per ride payment. Immutable — never update a payment record.

```sql
CREATE TABLE payments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id                 UUID NOT NULL REFERENCES rides(id),
  rider_id                UUID NOT NULL REFERENCES users(id),
  
  -- Stripe references
  stripe_payment_intent_id VARCHAR(255) UNIQUE,     -- pi_xxx
  stripe_payment_method_id VARCHAR(255),            -- pm_xxx
  
  -- Amounts (all in cents to avoid floating-point errors)
  total_amount_cents      INTEGER NOT NULL,
  base_fare_cents         INTEGER NOT NULL,
  distance_fare_cents     INTEGER NOT NULL,
  time_fare_cents         INTEGER NOT NULL,
  surge_amount_cents      INTEGER NOT NULL DEFAULT 0,
  airport_fee_cents       INTEGER NOT NULL DEFAULT 0,
  tip_cents               INTEGER NOT NULL DEFAULT 0,
  platform_fee_cents      INTEGER NOT NULL,        -- BidRide's take
  driver_payout_cents     INTEGER NOT NULL,        -- Driver's earnings
  
  -- Status
  status                  VARCHAR(20) NOT NULL DEFAULT 'authorized'
                          CHECK (status IN (
                            'authorized',   -- Hold placed on card
                            'captured',     -- Payment collected
                            'refunded',     -- Full refund issued
                            'partial_refund',
                            'failed',
                            'cancelled'     -- Hold released
                          )),
  
  authorized_at           TIMESTAMPTZ,
  captured_at             TIMESTAMPTZ,
  
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_ride_id ON payments(ride_id);
CREATE INDEX idx_payments_rider_id ON payments(rider_id);
CREATE INDEX idx_payments_stripe_intent ON payments(stripe_payment_intent_id);
```

### `driver_payouts`
Records each payout transfer to a driver's bank account.

```sql
CREATE TABLE driver_payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id             UUID NOT NULL REFERENCES users(id),
  
  -- What rides are included
  payment_ids           UUID[],                    -- Array of payment IDs in this payout
  
  -- Stripe references
  stripe_transfer_id    VARCHAR(255) UNIQUE,       -- tr_xxx
  stripe_account_id     VARCHAR(255) NOT NULL,     -- Driver's Stripe Connect account
  
  -- Amount
  amount_cents          INTEGER NOT NULL,
  currency              VARCHAR(3) NOT NULL DEFAULT 'usd',
  
  -- Status
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'in_transit', 'paid', 'failed', 'cancelled'
                        )),
  
  initiated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  failed_at             TIMESTAMPTZ,
  failure_reason        TEXT,
  
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_payouts_driver_id ON driver_payouts(driver_id);
```

### `refunds`
Tracks refunds issued to riders.

```sql
CREATE TABLE refunds (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            UUID NOT NULL REFERENCES payments(id),
  ride_id               UUID NOT NULL REFERENCES rides(id),
  rider_id              UUID NOT NULL REFERENCES users(id),
  
  stripe_refund_id      VARCHAR(255) UNIQUE,       -- re_xxx
  
  amount_cents          INTEGER NOT NULL,
  reason                VARCHAR(50) NOT NULL
                        CHECK (reason IN (
                          'driver_no_show', 'wrong_route', 'safety_incident',
                          'overcharge', 'duplicate_charge', 'ride_cancelled',
                          'customer_goodwill', 'other'
                        )),
  notes                 TEXT,
  issued_by             UUID REFERENCES users(id), -- Admin who issued it (NULL = automatic)
  
  status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'succeeded', 'failed')),
  
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);
```

---

## 6. Safety & Compliance Tables

### `safety_incidents`
Every SOS trigger, in-app safety report, or admin-flagged incident.

```sql
CREATE TABLE safety_incidents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id           UUID REFERENCES rides(id),
  reported_by       UUID NOT NULL REFERENCES users(id),
  
  incident_type     VARCHAR(50) NOT NULL
                    CHECK (incident_type IN (
                      'sos_triggered', 'harassment', 'unsafe_driving',
                      'assault', 'property_damage', 'wrong_route',
                      'fraud', 'zero_tolerance_violation', 'other'
                    )),
  description       TEXT,
  location          GEOGRAPHY(POINT, 4326),
  
  status            VARCHAR(20) NOT NULL DEFAULT 'open'
                    CHECK (status IN (
                      'open', 'under_review', 'resolved', 'escalated_to_law_enforcement'
                    )),
  
  driver_suspended  BOOLEAN NOT NULL DEFAULT FALSE,
  driver_suspended_at TIMESTAMPTZ,
  resolution_notes  TEXT,
  resolved_by       UUID REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_safety_incidents_ride_id ON safety_incidents(ride_id);
CREATE INDEX idx_safety_incidents_status ON safety_incidents(status);
```

### `zero_tolerance_reports`
Specific tracking for drug/alcohol reports (NJ TNC law mandates zero tolerance program).

```sql
CREATE TABLE zero_tolerance_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  safety_incident_id  UUID NOT NULL REFERENCES safety_incidents(id),
  reported_driver_id  UUID NOT NULL REFERENCES users(id),
  reporting_rider_id  UUID NOT NULL REFERENCES users(id),
  ride_id             UUID REFERENCES rides(id),
  
  violation_type      VARCHAR(30) NOT NULL
                      CHECK (violation_type IN ('alcohol', 'drugs', 'both')),
  
  driver_suspended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  investigation_completed_at TIMESTAMPTZ,
  outcome             VARCHAR(30)
                      CHECK (outcome IN (
                        'driver_reinstated', 'driver_permanently_deactivated',
                        'unsubstantiated', 'pending'
                      )),
  
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `audit_logs`
Immutable log of sensitive admin actions.

```sql
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID NOT NULL REFERENCES users(id),
  action        VARCHAR(100) NOT NULL,    -- e.g. 'driver.deactivated', 'refund.issued'
  target_type   VARCHAR(50),             -- 'driver', 'rider', 'ride', 'payment'
  target_id     UUID,
  metadata      JSONB,                   -- Before/after state or relevant data
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
```

---

## 7. Geospatial Tables

### `service_zones`
Defines geographic boundaries where BidRide operates (Newark city limits, EWR zone, etc.).

```sql
CREATE TABLE service_zones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,               -- e.g. 'Newark City', 'EWR Airport'
  zone_type   VARCHAR(30) NOT NULL
              CHECK (zone_type IN ('city', 'airport', 'suburb', 'restricted')),
  boundary    GEOGRAPHY(POLYGON, 4326) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  
  -- Pricing overrides for this zone
  base_fare_override    NUMERIC(10,2),
  per_mile_override     NUMERIC(10,2),
  airport_fee_cents     INTEGER,                   -- EWR Port Authority fee
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_service_zones_boundary ON service_zones USING GIST(boundary);
```

### `trip_route_snapshots`
Stores the actual route taken per trip for dispute resolution and safety review.

```sql
CREATE TABLE trip_route_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id),
  
  -- Stored as a compressed array of points
  route_points JSONB NOT NULL,    -- [{lat, lng, timestamp, speed}, ...]
  
  total_distance_meters INTEGER,
  
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_trip_route_ride_id ON trip_route_snapshots(ride_id);
```

---

## 8. Indexes & Performance

### Critical Queries and Their Indexes

**Find available drivers near a pickup location:**
```sql
-- Uses PostGIS spatial index
SELECT u.id, dp.is_online, ST_Distance(dl.location, ST_MakePoint($lng, $lat)::geography) AS distance
FROM users u
JOIN driver_profiles dp ON dp.user_id = u.id
JOIN driver_locations dl ON dl.driver_id = u.id   -- Redis, not PostgreSQL
WHERE dp.is_online = TRUE
  AND u.status = 'active'
  AND ST_DWithin(dl.location, ST_MakePoint($lng, $lat)::geography, 8047)  -- 5 miles
ORDER BY distance ASC
LIMIT 10;
```

**Get all pending bids expiring in the next 60 seconds (BullMQ job):**
```sql
-- Uses partial index: idx_bids_expires_at WHERE status = 'pending'
SELECT id, ride_id, expires_at
FROM bids
WHERE status = 'pending'
  AND expires_at < NOW() + INTERVAL '60 seconds';
```

**Rider trip history:**
```sql
-- Uses idx_rides_rider_id + idx_rides_requested_at
SELECT id, status, pickup_address, dropoff_address, final_fare, requested_at
FROM rides
WHERE rider_id = $riderId
  AND deleted_at IS NULL
ORDER BY requested_at DESC
LIMIT 20;
```

### Database Configuration Notes
- Enable `pg_stat_statements` extension to identify slow queries
- Set `work_mem` appropriately for PostGIS queries (start at 64MB)
- Enable connection pooling via **PgBouncer** (prevents connection exhaustion at scale)
- Regular `VACUUM ANALYZE` on high-churn tables (rides, bids, ride_status_history)

---

## 9. Data Retention & Archival

| Table | Retention | Action After Retention |
|-------|-----------|----------------------|
| `rides` | 3 years active, 7 years archive | Move to cold storage (S3 Glacier) after 3 years |
| `payments` | 7 years | IRS requirement — never delete |
| `driver_payouts` | 7 years | IRS requirement |
| `bids` | 3 years | Archive with ride record |
| `ride_status_history` | 3 years | Archive |
| `ride_messages` | 1 year | Delete after 1 year (inform in Privacy Policy) |
| `safety_incidents` | Indefinite | Never delete — legal exposure |
| `audit_logs` | 5 years | Archive |
| `trip_route_snapshots` | 3 years | Archive |
| `driver_documents` | Duration of driver relationship + 3 years | FCRA |
| `users` (deleted accounts) | 30 days after deletion request | Purge (user right to delete) |
| `zero_tolerance_reports` | Indefinite | Never delete |

### Archival Strategy
- Active data: PostgreSQL (RDS)
- Archive (1–7 years): PostgreSQL read replica with separate retention policy, or export to S3 Parquet
- Deleted user data: anonymize PII before the 30-day purge (replace name, phone, email with hashed tokens; preserve ride/payment records for tax purposes)

---

## 10. Redis Schema

Redis handles ephemeral, high-speed data that doesn't need to live in PostgreSQL.

### Key Naming Convention
`{service}:{entity}:{id}:{field}`

### Active Driver Locations
```
Key:    driver:location:{driverId}
Type:   Hash
Fields: lat, lng, bearing, speed, updated_at
TTL:    30 seconds (expires if driver stops updating)
```

### Driver Online Status
```
Key:    driver:online:{driverId}
Type:   String (value: "1")
TTL:    30 seconds (refresh on each location update)
```

### Active Ride Session
```
Key:    ride:session:{rideId}
Type:   Hash
Fields: status, rider_id, driver_id, started_at, current_lat, current_lng
TTL:    24 hours (safety buffer — active rides should complete in < 4 hours)
```

### Bid State (Fast Lookup)
```
Key:    bid:active:{rideId}
Type:   Hash
Fields: bid_id, amount, status, expires_at, driver_counters (JSON)
TTL:    Match bid expiry (3–5 minutes)
```

### User Session (JWT Refresh Token)
```
Key:    session:refresh:{userId}:{tokenHash}
Type:   String (value: "valid")
TTL:    30 days
```

### OTP (Phone Verification)
```
Key:    otp:{phone}
Type:   Hash
Fields: code (hashed), attempts, created_at
TTL:    5 minutes
```

### Rate Limiting
```
Key:    ratelimit:{userId}:{endpoint}
Type:   String (counter)
TTL:    1 minute window
```

### Nearby Drivers Cache (Reduce PostGIS query frequency)
```
Key:    geo:drivers:{geohash}
Type:   Sorted Set (score = timestamp)
TTL:    10 seconds
```

---

*This document requires founder approval before development begins.*
*Database schema will be implemented as TypeORM entities and migration files.*
