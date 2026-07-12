-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" UUID NOT NULL,
    "domain" VARCHAR(50) NOT NULL,
    "family" VARCHAR(100) NOT NULL,
    "recommendation_type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'proposed',
    "confidence" DECIMAL(5,4) NOT NULL,
    "sample_size" INTEGER NOT NULL,
    "constitution_tags" TEXT[],
    "payload" JSONB NOT NULL,
    "canonical_refs" JSONB,
    "outcome_score" DECIMAL(5,4),
    "outcome_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_recommendation_events" (
    "id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "actor" VARCHAR(100) NOT NULL,
    "actor_role" VARCHAR(50) NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "previous_status" VARCHAR(30),
    "new_status" VARCHAR(30) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_recommendation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_briefs" (
    "id" UUID NOT NULL,
    "brief_type" VARCHAR(50) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "source_version" VARCHAR(50) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_recommendations_domain_status_idx" ON "ai_recommendations"("domain", "status");

-- CreateIndex
CREATE INDEX "ai_recommendations_status_created_at_idx" ON "ai_recommendations"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_recommendations_created_at_idx" ON "ai_recommendations"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_recommendation_events_recommendation_id_created_at_idx" ON "ai_recommendation_events"("recommendation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_briefs_brief_type_generated_at_idx" ON "ai_briefs"("brief_type", "generated_at" DESC);

-- AddForeignKey
ALTER TABLE "ai_recommendation_events" ADD CONSTRAINT "ai_recommendation_events_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "ai_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
