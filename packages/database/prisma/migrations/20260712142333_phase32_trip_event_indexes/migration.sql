-- CreateIndex
CREATE INDEX "trip_events_event_type_trip_id_idx" ON "trip_events"("event_type", "trip_id");

-- CreateIndex
CREATE INDEX "trip_events_event_type_created_at_idx" ON "trip_events"("event_type", "created_at");
