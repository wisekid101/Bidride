-- AlterTable
ALTER TABLE "payout_requests" ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "destination_account_id" VARCHAR(100),
ADD COLUMN     "last_error_code" VARCHAR(100),
ADD COLUMN     "last_error_message" VARCHAR(500),
ADD COLUMN     "last_provider_request_id" VARCHAR(100),
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "provider_metadata" JSONB,
ADD COLUMN     "reconciliation_required_at" TIMESTAMP(3),
ADD COLUMN     "stripe_transfer_id" VARCHAR(100),
ADD COLUMN     "submission_started_at" TIMESTAMP(3),
ADD COLUMN     "transfer_group" VARCHAR(200),
ADD COLUMN     "transfer_idempotency_key" VARCHAR(200);

-- CreateTable
CREATE TABLE "payout_submission_attempts" (
    "id" UUID NOT NULL,
    "payout_request_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "transfer_group" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "destination_account_id" VARCHAR(100),
    "provider_request_id" VARCHAR(100),
    "stripe_transfer_id" VARCHAR(100),
    "provider_response" JSONB,
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(500),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_submission_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_submission_attempts_payout_request_id_created_at_idx" ON "payout_submission_attempts"("payout_request_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_submission_attempts_status_idx" ON "payout_submission_attempts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payout_submission_attempts_payout_request_id_attempt_number_key" ON "payout_submission_attempts"("payout_request_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_stripe_transfer_id_key" ON "payout_requests"("stripe_transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_transfer_idempotency_key_key" ON "payout_requests"("transfer_idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_transfer_group_key" ON "payout_requests"("transfer_group");

-- AddForeignKey
ALTER TABLE "payout_submission_attempts" ADD CONSTRAINT "payout_submission_attempts_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
