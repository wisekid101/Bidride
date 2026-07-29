-- F3b-2a: booking state and crash-safe claim lease on the capture recovery
-- worklist. Purely additive, all nullable, no backfill — existing rows stay
-- valid with NULLs. No changes to payments, PaymentStatus, financial_ledger,
-- trips, bids or trip_events.

-- AlterTable
ALTER TABLE "capture_recovery" ADD COLUMN "last_stripe_status" VARCHAR(30);
ALTER TABLE "capture_recovery" ADD COLUMN "claim_token" VARCHAR(64);
ALTER TABLE "capture_recovery" ADD COLUMN "claimed_at" TIMESTAMP(3);
ALTER TABLE "capture_recovery" ADD COLUMN "booking_status" VARCHAR(20);
ALTER TABLE "capture_recovery" ADD COLUMN "booked_at" TIMESTAMP(3);
