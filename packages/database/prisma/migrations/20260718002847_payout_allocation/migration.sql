-- CreateTable
CREATE TABLE "payout_requests" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "status" VARCHAR(30) NOT NULL,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "initiator_type" VARCHAR(30) NOT NULL,
    "initiator_id" VARCHAR(100),
    "reason" VARCHAR(200) NOT NULL,
    "source_available_balance" DECIMAL(10,2) NOT NULL,
    "resulting_available_balance" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "allocated_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_allocations" (
    "id" UUID NOT NULL,
    "payout_request_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "earning_ledger_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "status" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "allocated_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "release_reason" VARCHAR(200),

    CONSTRAINT "payout_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_allocation_transitions" (
    "id" UUID NOT NULL,
    "payout_allocation_id" UUID NOT NULL,
    "payout_request_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "from_status" VARCHAR(30),
    "to_status" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "initiator_type" VARCHAR(30) NOT NULL,
    "initiator_id" VARCHAR(100),
    "correlation_id" VARCHAR(200) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_allocation_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_idempotency_key_key" ON "payout_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "payout_requests_driver_id_status_idx" ON "payout_requests"("driver_id", "status");

-- CreateIndex
CREATE INDEX "payout_requests_status_created_at_idx" ON "payout_requests"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payout_allocations_driver_id_status_idx" ON "payout_allocations"("driver_id", "status");

-- CreateIndex
CREATE INDEX "payout_allocations_payout_request_id_idx" ON "payout_allocations"("payout_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_allocation_transitions_correlation_id_key" ON "payout_allocation_transitions"("correlation_id");

-- CreateIndex
CREATE INDEX "payout_allocation_transitions_payout_allocation_id_created__idx" ON "payout_allocation_transitions"("payout_allocation_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_allocation_transitions_payout_request_id_created_at_idx" ON "payout_allocation_transitions"("payout_request_id", "created_at");

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocations" ADD CONSTRAINT "payout_allocations_earning_ledger_id_fkey" FOREIGN KEY ("earning_ledger_id") REFERENCES "financial_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocation_transitions" ADD CONSTRAINT "payout_allocation_transitions_payout_allocation_id_fkey" FOREIGN KEY ("payout_allocation_id") REFERENCES "payout_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_allocation_transitions" ADD CONSTRAINT "payout_allocation_transitions_payout_request_id_fkey" FOREIGN KEY ("payout_request_id") REFERENCES "payout_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce at most one ACTIVE allocation per earning ledger entry. Prisma cannot
-- express a PARTIAL unique index, so it is defined here in raw SQL. RELEASED and
-- CANCELED allocations intentionally do NOT block a future reallocation.
CREATE UNIQUE INDEX "payout_allocations_active_earning_key"
  ON "payout_allocations" ("earning_ledger_id")
  WHERE "status" IN ('ALLOCATED', 'SUBMISSION_PENDING', 'SUBMITTED', 'PAID');
