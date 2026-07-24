-- CreateEnum
CREATE TYPE "TaxComplianceStatus" AS ENUM ('not_started', 'session_created', 'pending_provider', 'verified', 'rejected', 'needs_update', 'provider_confirmed_exempt', 'unavailable', 'superseded');

-- CreateTable
CREATE TABLE "driver_tax_compliance" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_account_reference" VARCHAR(255),
    "provider_submission_reference" VARCHAR(255),
    "status" "TaxComplianceStatus" NOT NULL DEFAULT 'not_started',
    "required_form_type" VARCHAR(20) NOT NULL,
    "required_version" VARCHAR(50) NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "certified_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "last_provider_sync_at" TIMESTAMP(3),
    "failure_code" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_tax_compliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_tax_compliance_events" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "compliance_record_id" UUID NOT NULL,
    "provider_event_id" VARCHAR(255),
    "previous_status" "TaxComplianceStatus",
    "new_status" "TaxComplianceStatus" NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "reason_code" VARCHAR(50),
    "provider_reference" VARCHAR(255),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_tax_compliance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_compliance_config" (
    "id" UUID NOT NULL,
    "requirement_enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" VARCHAR(40) NOT NULL,
    "required_form_type" VARCHAR(20) NOT NULL,
    "required_version" VARCHAR(50) NOT NULL,
    "effective_at" TIMESTAMP(3),
    "minimum_app_version" VARCHAR(20),
    "supported_jurisdictions" JSONB NOT NULL DEFAULT '[]',
    "fail_closed_on_provider_error" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_compliance_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_tax_compliance_driver_id_key" ON "driver_tax_compliance"("driver_id");

-- CreateIndex
CREATE INDEX "driver_tax_compliance_status_idx" ON "driver_tax_compliance"("status");

-- CreateIndex
CREATE UNIQUE INDEX "driver_tax_compliance_events_provider_event_id_key" ON "driver_tax_compliance_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "driver_tax_compliance_events_driver_id_occurred_at_idx" ON "driver_tax_compliance_events"("driver_id", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "driver_tax_compliance" ADD CONSTRAINT "driver_tax_compliance_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_tax_compliance_events" ADD CONSTRAINT "driver_tax_compliance_events_compliance_record_id_fkey" FOREIGN KEY ("compliance_record_id") REFERENCES "driver_tax_compliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
