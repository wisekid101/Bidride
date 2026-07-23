-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "zero_tolerance_accepted_version" VARCHAR(50);

-- CreateTable
CREATE TABLE "zero_tolerance_policies" (
    "version" VARCHAR(50) NOT NULL,
    "content_hash" VARCHAR(128) NOT NULL,
    "body" TEXT NOT NULL,
    "min_app_version" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zero_tolerance_policies_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "zero_tolerance_acceptances" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "policy_version" VARCHAR(50) NOT NULL,
    "policy_content_hash" VARCHAR(128) NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'mobile',
    "app_version" VARCHAR(20),
    "ip_address" VARCHAR(45),
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zero_tolerance_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zero_tolerance_policies_is_active_effective_at_idx" ON "zero_tolerance_policies"("is_active", "effective_at" DESC);

-- CreateIndex
CREATE INDEX "zero_tolerance_acceptances_driver_id_accepted_at_idx" ON "zero_tolerance_acceptances"("driver_id", "accepted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "zero_tolerance_acceptances_driver_id_policy_version_key" ON "zero_tolerance_acceptances"("driver_id", "policy_version");

-- AddForeignKey
ALTER TABLE "zero_tolerance_acceptances" ADD CONSTRAINT "zero_tolerance_acceptances_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zero_tolerance_acceptances" ADD CONSTRAINT "zero_tolerance_acceptances_policy_version_fkey" FOREIGN KEY ("policy_version") REFERENCES "zero_tolerance_policies"("version") ON DELETE RESTRICT ON UPDATE CASCADE;
