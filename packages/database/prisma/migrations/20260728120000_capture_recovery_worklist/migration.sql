-- F3b-1: capture recovery worklist.
-- Purely additive. No changes to payments, PaymentStatus, trips, bids or
-- trip_events, and no backfill.

-- CreateTable
CREATE TABLE "capture_recovery" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "stripe_payment_intent_id" VARCHAR(100),
    "bid_id" UUID,
    "expected_amount_cents" INTEGER NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "resolution" VARCHAR(40),
    "attempt_number" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_error" VARCHAR(200),
    "hold_expires_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_admin_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_recovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "capture_recovery_trip_id_key" ON "capture_recovery"("trip_id");

-- CreateIndex
CREATE INDEX "capture_recovery_status_next_attempt_at_idx" ON "capture_recovery"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "capture_recovery_status_created_at_idx" ON "capture_recovery"("status", "created_at" DESC);
