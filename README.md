# BidRide

A rideshare marketplace that gives riders and drivers more control.

---

## What Is BidRide?

BidRide combines the instant-request experience of Uber and Lyft with an optional bidding layer — letting riders save money and drivers earn more, without removing the convenience either side expects.

**Riders** can accept the standard fare (instant match) or submit a lower bid. **Drivers** can accept, reject, or counter. The result is a transparent marketplace where both sides have a voice in the price.

Bidding is optional. The standard experience is always available.

---

## The Problem

Current rideshare platforms create frustration on both sides:

- Riders pay unpredictable, opaque prices — especially during surge
- Drivers receive a smaller share of the fare than they deserve
- Neither side has meaningful negotiation or control

---

## Initial Market

**Phase 1 Launch:** Newark, New Jersey + Newark Liberty International Airport (EWR)

The goal is to dominate one market first — learn, improve, then scale.

---

## Core Principles

1. **Safety First** — never optional
2. **Legality First** — compliance before growth
3. **Trust First** — over short-term profits
4. **Driver Success** — empowered and rewarded
5. **Rider Savings** — better value
6. **Transparency** — clear pricing
7. **Sustainability** — long-term, not hype

---

## Project Structure

```
bidride/
  docs/                        # Research, architecture, legal, strategy
  apps/
    rider-app/                 # React Native — iOS & Android
    driver-app/                # React Native — iOS & Android
    admin-portal/              # Next.js — internal operations dashboard
  services/
    backend-api/               # NestJS — primary REST + WebSocket API
    auth-service/              # Authentication and session management
    ride-service/              # Ride lifecycle management
    pricing-service/           # Fare calculation and bid floor logic
    payment-service/           # Stripe Connect integration
    geo-service/               # Location, proximity, geofencing
  infrastructure/
    docker/                    # Docker Compose and container config
    database/                  # PostgreSQL migrations
    redis/                     # Redis configuration
  design/                      # Brand, UX direction, app flows
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Product Vision](docs/product-vision.md) | What BidRide is and how it works |
| [Legal & Safety Requirements](docs/legal-safety-requirements.md) | NJ TNC law, EWR, insurance, driver onboarding, compliance |
| [Technical Architecture](docs/technical-architecture.md) | Tech stack, system design, infrastructure |
| [Database Architecture](docs/database-architecture.md) | PostgreSQL schema, Redis design |
| [API Architecture](docs/api-architecture.md) | REST endpoints, WebSocket events, bid flow |
| [Pricing Model](docs/pricing-model.md) | Fare structure, bid mechanics, driver earnings |
| [Roadmap](docs/roadmap.md) | Phase-by-phase build plan |

---

## Build Process

No step is skipped. No code ships without the prior step complete.

> Research → Validate → Design → Legal Review → Safety Review → Architecture → Build → Test → Launch → Improve

---

## Status

**Current Phase: Foundation**
Architecture complete. Awaiting founder approval to begin development.

---

*Founded by Markie Brown.*
