-- CreateIndex
CREATE INDEX "trips_status_completed_at_idx" ON "trips"("status", "completed_at");
