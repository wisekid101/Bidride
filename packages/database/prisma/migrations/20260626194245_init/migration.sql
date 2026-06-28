-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('rider', 'driver');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('pending', 'under_review', 'action_required', 'approved', 'declined', 'suspended');

-- CreateEnum
CREATE TYPE "BackgroundCheckStatus" AS ENUM ('not_started', 'pending', 'clear', 'consider', 'adverse_action', 'disputed');

-- CreateEnum
CREATE TYPE "ProfilePhotoStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RiderBadge" AS ENUM ('verified', 'trusted', 'business', 'vip');

-- CreateEnum
CREATE TYPE "DriverBadge" AS ENUM ('verified', 'trusted', 'vip');

-- CreateEnum
CREATE TYPE "RewardsTier" AS ENUM ('silver', 'gold', 'platinum', 'elite');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('drivers_license', 'insurance_card', 'vehicle_registration', 'vehicle_photo_front', 'vehicle_photo_back', 'vehicle_photo_interior', 'vehicle_photo_trunk', 'vehicle_photo_odometer', 'vehicle_photo_vin', 'profile_photo');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'needs_reupload');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('searching', 'accepted', 'driver_en_route', 'driver_arrived', 'in_progress', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "RideType" AS ENUM ('standard', 'priority', 'premium');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('pending', 'accepted', 'declined', 'countered', 'expired', 'withdrawn');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'processing', 'paid', 'failed');

-- CreateEnum
CREATE TYPE "SafetyState" AS ENUM ('normal', 'soft_alert', 'moderate_alert', 'critical', 'sos_active', 'panic_active', 'incident_closed');

-- CreateEnum
CREATE TYPE "CheckInStatus" AS ENUM ('pending', 'safe', 'escalated', 'not_required');

-- CreateEnum
CREATE TYPE "SosInitiatedBy" AS ENUM ('rider', 'driver');

-- CreateEnum
CREATE TYPE "SosTriggerSource" AS ENUM ('button_tap', 'volume_shortcut', 'auto_escalation', 'admin_triggered');

-- CreateEnum
CREATE TYPE "SosStatus" AS ENUM ('active', 'resolved', 'false_alarm', 'escalated_to_dispatch');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('recording', 'complete', 'deleted', 'held');

-- CreateEnum
CREATE TYPE "RecordingRetention" AS ENUM ('no_action_30d', 'action_taken_2y', 'law_enforcement_hold');

-- CreateEnum
CREATE TYPE "TrustUserRole" AS ENUM ('rider', 'driver');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "MultiAccountLinkType" AS ENUM ('shared_device', 'shared_phone', 'shared_payment', 'shared_ip');

-- CreateEnum
CREATE TYPE "SuspensionType" AS ENUM ('warning', 'temporary', 'indefinite', 'permanent');

-- CreateEnum
CREATE TYPE "SuspensionStatus" AS ENUM ('active', 'lifted', 'appealed', 'appeal_denied');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('founder', 'super_admin', 'operations_admin', 'safety_admin', 'driver_approval_admin', 'fraud_admin', 'support_admin', 'analytics_admin');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('assault', 'harassment', 'property_damage', 'route_deviation', 'driver_conduct', 'rider_conduct', 'false_sos', 'other');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'assigned', 'under_review', 'resolved', 'escalated_to_law_enforcement');

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('waiting', 'advance_notice', 'dispatched', 'completed', 'left_queue');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_review', 'waiting_on_user', 'resolved', 'escalated', 'closed');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('payment_issue', 'safety_issue', 'missing_item', 'refund_request', 'driver_complaint', 'rider_complaint', 'background_check_issue', 'account_issue');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "ProxySessionStatus" AS ENUM ('active', 'closed', 'expired');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "profile_photo_url" VARCHAR(500),
    "password_hash" VARCHAR(255),
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(100),
    "profile_photo_url" VARCHAR(500),
    "date_of_birth" DATE,
    "current_badge" "RiderBadge" NOT NULL DEFAULT 'verified',
    "stripe_customer_id" VARCHAR(100),
    "default_payment_method_id" VARCHAR(100),
    "push_token" VARCHAR(500),
    "corporate_account_id" UUID,
    "rewards_points" INTEGER NOT NULL DEFAULT 0,
    "rewards_tier" "RewardsTier" NOT NULL DEFAULT 'silver',
    "total_trips" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'pending',
    "legal_first_name" VARCHAR(100) NOT NULL,
    "legal_last_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "home_address" VARCHAR(255),
    "home_city" VARCHAR(100),
    "home_state" VARCHAR(2),
    "home_zip" VARCHAR(10),
    "license_number" VARCHAR(50),
    "license_state" VARCHAR(2),
    "license_class" VARCHAR(10),
    "license_expiry" DATE,
    "license_ai_confidence" DECIMAL(5,2),
    "background_check_id" VARCHAR(100),
    "background_check_status" "BackgroundCheckStatus" NOT NULL DEFAULT 'not_started',
    "background_check_ordered_at" TIMESTAMP(3),
    "background_check_cleared_at" TIMESTAMP(3),
    "insurance_policy_number" VARCHAR(100),
    "insurance_provider" VARCHAR(100),
    "insurance_expiry" DATE,
    "primary_vehicle_id" UUID,
    "profile_photo_url" VARCHAR(500),
    "profile_photo_status" "ProfilePhotoStatus" NOT NULL DEFAULT 'pending',
    "stripe_account_id" VARCHAR(100),
    "payout_bank_verified" BOOLEAN NOT NULL DEFAULT false,
    "payout_bank_verified_at" TIMESTAMP(3),
    "current_badge" "DriverBadge" NOT NULL DEFAULT 'verified',
    "eligible_ride_types" JSONB NOT NULL DEFAULT '["standard"]',
    "total_trips" INTEGER NOT NULL DEFAULT 0,
    "avg_rating" DECIMAL(3,2) NOT NULL DEFAULT 0.00,
    "acceptance_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "completion_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "push_token" VARCHAR(500),
    "onboarding_step" VARCHAR(50) NOT NULL DEFAULT 'personal_info',
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "make" VARCHAR(50) NOT NULL,
    "model" VARCHAR(50) NOT NULL,
    "year" SMALLINT NOT NULL,
    "color" VARCHAR(30) NOT NULL,
    "license_plate" VARCHAR(20) NOT NULL,
    "license_plate_state" VARCHAR(2) NOT NULL DEFAULT 'NJ',
    "vin" VARCHAR(17),
    "vehicle_class" VARCHAR(20) NOT NULL DEFAULT 'standard',
    "eligible_types" JSONB NOT NULL DEFAULT '["standard"]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "status" "VehicleStatus" NOT NULL DEFAULT 'pending',
    "inspection_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "inspection_date" DATE,
    "inspection_expires_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "ai_confidence" DECIMAL(5,2),
    "review_notes" TEXT,
    "reviewed_by_admin_id" UUID,
    "expires_at" DATE,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "driver_id" UUID,
    "vehicle_id" UUID,
    "bid_id" UUID,
    "status" "TripStatus" NOT NULL DEFAULT 'searching',
    "ride_type" "RideType" NOT NULL DEFAULT 'standard',
    "pickup_address" VARCHAR(255) NOT NULL,
    "pickup_lat" DECIMAL(9,6) NOT NULL,
    "pickup_lng" DECIMAL(9,6) NOT NULL,
    "dropoff_address" VARCHAR(255) NOT NULL,
    "dropoff_lat" DECIMAL(9,6) NOT NULL,
    "dropoff_lng" DECIMAL(9,6) NOT NULL,
    "ai_fare" DECIMAL(8,2) NOT NULL,
    "final_fare" DECIMAL(8,2),
    "driver_earnings" DECIMAL(8,2),
    "platform_fee" DECIMAL(8,2),
    "earnings_floor_met" BOOLEAN NOT NULL DEFAULT true,
    "earnings_supplement" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "pickup_wait_seconds" INTEGER NOT NULL DEFAULT 0,
    "wait_fee_charged" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "route_distance_miles" DECIMAL(6,2),
    "actual_distance_miles" DECIMAL(6,2),
    "estimated_duration_min" INTEGER,
    "actual_duration_min" INTEGER,
    "driver_rating_rider" SMALLINT,
    "rider_rating_driver" SMALLINT,
    "is_airport_trip" BOOLEAN NOT NULL DEFAULT false,
    "is_night_ride" BOOLEAN NOT NULL DEFAULT false,
    "route_deviation_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "message_type" VARCHAR(20) NOT NULL DEFAULT 'text',
    "read_at" TIMESTAMP(3),
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "driver_id" UUID,
    "ai_fare" DECIMAL(8,2) NOT NULL,
    "rider_offer" DECIMAL(8,2) NOT NULL,
    "counter_offer" DECIMAL(8,2),
    "final_fare" DECIMAL(8,2),
    "counter_round" SMALLINT NOT NULL DEFAULT 0,
    "status" "BidStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_events" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "rider_to_driver" SMALLINT,
    "driver_to_rider" SMALLINT,
    "rider_comment" TEXT,
    "driver_comment" TEXT,
    "rider_flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_sessions" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "current_state" "SafetyState" NOT NULL DEFAULT 'normal',
    "is_night_ride" BOOLEAN NOT NULL DEFAULT false,
    "is_airport_trip" BOOLEAN NOT NULL DEFAULT false,
    "check_in_status" "CheckInStatus" NOT NULL DEFAULT 'not_required',
    "admin_assigned_id" UUID,
    "sla_deadline" TIMESTAMP(3),
    "sla_breached" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sos_events" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "safety_session_id" UUID NOT NULL,
    "initiated_by_user_id" UUID NOT NULL,
    "initiated_by_role" "SosInitiatedBy" NOT NULL,
    "trigger_source" "SosTriggerSource" NOT NULL,
    "activation_confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "confirmed_safe_at" TIMESTAMP(3),
    "gps_lat" DECIMAL(9,6) NOT NULL,
    "gps_lng" DECIMAL(9,6) NOT NULL,
    "contacts_notified_count" INTEGER NOT NULL DEFAULT 0,
    "admin_assigned_id" UUID,
    "sla_met" BOOLEAN,
    "recording_id" UUID,
    "status" "SosStatus" NOT NULL DEFAULT 'active',
    "resolution_notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sos_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panic_events" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "safety_session_id" UUID NOT NULL,
    "initiated_by_role" VARCHAR(20) NOT NULL,
    "gps_lat" DECIMAL(9,6) NOT NULL,
    "gps_lng" DECIMAL(9,6) NOT NULL,
    "admin_assigned_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panic_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_recordings" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "safety_session_id" UUID NOT NULL,
    "storage_bucket" VARCHAR(100) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "encryption_key_id" VARCHAR(100) NOT NULL,
    "duration_seconds" INTEGER,
    "retention_category" "RecordingRetention" NOT NULL DEFAULT 'no_action_30d',
    "delete_after" TIMESTAMP(3),
    "access_log" JSONB NOT NULL DEFAULT '[]',
    "status" "RecordingStatus" NOT NULL DEFAULT 'recording',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_contacts" (
    "id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "relationship" VARCHAR(50) NOT NULL,
    "notify_on_sos" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_night" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_check_ins" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "safety_session_id" UUID NOT NULL,
    "status" "CheckInStatus" NOT NULL DEFAULT 'pending',
    "due_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safe_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_scores" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_role" "TrustUserRole" NOT NULL,
    "trust_score" SMALLINT NOT NULL DEFAULT 200,
    "fraud_probability" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "verification_confidence" DECIMAL(5,2) NOT NULL DEFAULT 50.00,
    "current_badge" VARCHAR(20) NOT NULL DEFAULT 'verified',
    "last_calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_score_history" (
    "id" UUID NOT NULL,
    "trust_score_id" UUID NOT NULL,
    "trust_score" SMALLINT NOT NULL,
    "fraud_probability" DECIMAL(5,2) NOT NULL,
    "trigger_event" VARCHAR(100) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_score_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_fingerprints" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "fingerprint" VARCHAR(255) NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "device_fingerprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multi_account_links" (
    "id" UUID NOT NULL,
    "user_id_a" UUID NOT NULL,
    "user_id_b" UUID NOT NULL,
    "link_type" "MultiAccountLinkType" NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multi_account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "stripe_payment_intent_id" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(8,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "refund_amount" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "trip_earnings" DECIMAL(10,2) NOT NULL,
    "floor_supplements" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "instant_fees" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "reward_bonuses" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "total_payout" DECIMAL(10,2) NOT NULL,
    "stripe_transfer_id" VARCHAR(100),
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings_floor_logs" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "floor_amount" DECIMAL(8,2) NOT NULL,
    "earned_amount" DECIMAL(8,2) NOT NULL,
    "supplement_amount" DECIMAL(8,2) NOT NULL,
    "formula_inputs" JSONB NOT NULL,
    "payout_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_floor_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_suspensions" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "suspension_type" "SuspensionType" NOT NULL,
    "status" "SuspensionStatus" NOT NULL DEFAULT 'active',
    "reason" TEXT NOT NULL,
    "internal_notes" TEXT,
    "authorized_by_admin_id" UUID NOT NULL,
    "confirmed_by_admin_id" UUID,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "lifted_at" TIMESTAMP(3),
    "appealed_at" TIMESTAMP(3),
    "appeal_reason" TEXT,
    "appeal_resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_rewards" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "reward_type" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(8,2) NOT NULL,
    "description" TEXT NOT NULL,
    "trip_id" UUID,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_performance_snapshots" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "acceptance_rate" DECIMAL(5,2) NOT NULL,
    "completion_rate" DECIMAL(5,2) NOT NULL,
    "avg_rating" DECIMAL(3,2) NOT NULL,
    "total_trips" INTEGER NOT NULL,
    "good_standing" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_performance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_notifications" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_clearable" BOOLEAN NOT NULL DEFAULT true,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_notifications" (
    "id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "airport_queue_entries" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "queue_position" INTEGER NOT NULL,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'waiting',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "advance_notice_at" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "trip_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airport_queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_data_cache" (
    "id" UUID NOT NULL,
    "flight_id" VARCHAR(20) NOT NULL,
    "airline" VARCHAR(100) NOT NULL,
    "flight_number" VARCHAR(20) NOT NULL,
    "origin" VARCHAR(10) NOT NULL,
    "scheduled_arrival" TIMESTAMP(3) NOT NULL,
    "estimated_arrival" TIMESTAMP(3),
    "status" VARCHAR(30) NOT NULL,
    "terminal" VARCHAR(10),
    "gate" VARCHAR(10),
    "seat_count" INTEGER,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_data_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_accounts" (
    "id" UUID NOT NULL,
    "company_name" VARCHAR(200) NOT NULL,
    "billing_email" VARCHAR(255) NOT NULL,
    "stripe_customer_id" VARCHAR(100),
    "monthly_budget" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corporate_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "admin_role" "AdminRole" NOT NULL,
    "mfa_secret" VARCHAR(100),
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "yubi_key_id" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(50) NOT NULL,
    "target_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_notes" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_incident_assignments" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "category" "IncidentCategory",
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "safety_incident_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_role" VARCHAR(20) NOT NULL,
    "rider_id" UUID,
    "driver_id" UUID,
    "trip_id" UUID,
    "assigned_to_id" UUID,
    "category" "TicketCategory" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "priority" "TicketPriority" NOT NULL DEFAULT 'medium',
    "subject" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "escalated_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_notes" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_addresses" (
    "id" UUID NOT NULL,
    "rider_id" UUID NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "address" VARCHAR(255) NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "amount" DECIMAL(8,2) NOT NULL,
    "reason" VARCHAR(50) NOT NULL,
    "notes" TEXT NOT NULL,
    "issued_by_admin_id" UUID NOT NULL,
    "stripe_refund_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_earnings" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "amount" DECIMAL(8,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_config" (
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "fraud_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_role" VARCHAR(10) NOT NULL,
    "trip_id" UUID,
    "fraud_probability" DECIMAL(5,2) NOT NULL,
    "trigger_signals" JSONB NOT NULL,
    "hold_placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hold_released_at" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "decision" VARCHAR(20),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_bid_exposures" (
    "id" UUID NOT NULL,
    "bid_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "exposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_bid_exposures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_session_logs" (
    "id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "duration_sec" INTEGER,

    CONSTRAINT "driver_session_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_pricing_logs" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "input_features" JSONB NOT NULL,
    "raw_fare" DECIMAL(8,2) NOT NULL,
    "ai_adjustment" DECIMAL(8,2) NOT NULL,
    "final_fare" DECIMAL(8,2) NOT NULL,
    "model_version" VARCHAR(50) NOT NULL,
    "confidence_score" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_pricing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_inference_logs" (
    "id" UUID NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(50) NOT NULL,
    "input_features" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER NOT NULL,
    "trip_id" UUID,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_inference_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_outcomes" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "bid_id" UUID,
    "zone_key" VARCHAR(50),
    "was_accepted" BOOLEAN NOT NULL,
    "time_to_acceptance_ms" INTEGER,
    "drivers_viewed" INTEGER NOT NULL DEFAULT 0,
    "drivers_ignored" INTEGER NOT NULL DEFAULT 0,
    "drivers_declined" INTEGER NOT NULL DEFAULT 0,
    "drivers_countered" INTEGER NOT NULL DEFAULT 0,
    "final_accepted_amount" DECIMAL(10,2),
    "final_fare" DECIMAL(10,2),
    "driver_earnings" DECIMAL(10,2),
    "platform_fee" DECIMAL(10,2),
    "prediction_probability" DECIMAL(5,4),
    "prediction_confidence" DECIMAL(5,4),
    "prediction_correct" BOOLEAN,
    "model_version" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_sessions" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "twilio_session_sid" VARCHAR(64) NOT NULL,
    "rider_participant_sid" VARCHAR(64) NOT NULL,
    "driver_participant_sid" VARCHAR(64) NOT NULL,
    "status" "ProxySessionStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "proxy_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_ledger" (
    "id" UUID NOT NULL,
    "correlation_id" VARCHAR(100) NOT NULL,
    "entry_type" VARCHAR(30) NOT NULL,
    "account_type" VARCHAR(20) NOT NULL,
    "account_id" VARCHAR(100) NOT NULL,
    "direction" VARCHAR(6) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'usd',
    "trip_id" VARCHAR(100),
    "refund_id" VARCHAR(100),
    "payout_id" VARCHAR(100),
    "actor_type" VARCHAR(20) NOT NULL DEFAULT 'system',
    "actor_id" VARCHAR(100),
    "source_event" VARCHAR(50) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_wallets" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "pending_balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "available_balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "lifetime_earnings" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "lifetime_paid" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "last_payout_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "direction" VARCHAR(6) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "balance_after" DECIMAL(10,2) NOT NULL,
    "trip_id" VARCHAR(100),
    "payout_id" VARCHAR(100),
    "description" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_batches" (
    "id" UUID NOT NULL,
    "batch_type" VARCHAR(20) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "driver_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_attempts" (
    "id" UUID NOT NULL,
    "batch_id" UUID,
    "driver_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "stripe_transfer_id" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL,
    "failure_reason" VARCHAR(200),
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "next_retry_at" TIMESTAMP(3),
    "succeeded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reconciliation" (
    "id" UUID NOT NULL,
    "stripe_object_id" VARCHAR(100) NOT NULL,
    "stripe_object_type" VARCHAR(30) NOT NULL,
    "stripe_amount" DECIMAL(10,2) NOT NULL,
    "local_amount" DECIMAL(10,2),
    "status" VARCHAR(20) NOT NULL,
    "mismatch_reason" VARCHAR(200),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_admin_id" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_routes" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "encoded_polyline" TEXT NOT NULL,
    "distance_miles" DECIMAL(8,2),
    "duration_min" INTEGER,
    "source" VARCHAR(20) NOT NULL DEFAULT 'fallback',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_deviation_events" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "deviation_miles" DECIMAL(8,4),
    "elapsed_min" DECIMAL(8,2),
    "expected_min" INTEGER,
    "risk_level" VARCHAR(10) NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalation_type" VARCHAR(20),
    "current_lat" DECIMAL(10,7) NOT NULL,
    "current_lng" DECIMAL(10,7) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_deviation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_safety_scores" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "risk_level" VARCHAR(10) NOT NULL,
    "score" INTEGER NOT NULL,
    "factors" JSONB NOT NULL DEFAULT '[]',
    "night_ride" BOOLEAN NOT NULL DEFAULT false,
    "airport_trip" BOOLEAN NOT NULL DEFAULT false,
    "distance_miles" DECIMAL(8,2),
    "prior_deviations" INTEGER NOT NULL DEFAULT 0,
    "prior_sos_events" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_safety_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "riders_user_id_key" ON "riders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "riders_stripe_customer_id_key" ON "riders"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_stripe_account_id_key" ON "drivers"("stripe_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_documents_driver_id_document_type_key" ON "driver_documents"("driver_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "trips_bid_id_key" ON "trips"("bid_id");

-- CreateIndex
CREATE INDEX "trips_driver_id_status_idx" ON "trips"("driver_id", "status");

-- CreateIndex
CREATE INDEX "trips_rider_id_created_at_idx" ON "trips"("rider_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "trips_status_created_at_idx" ON "trips"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_trip_id_created_at_idx" ON "chat_messages"("trip_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_trip_id_key" ON "ratings"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "safety_sessions_trip_id_key" ON "safety_sessions"("trip_id");

-- CreateIndex
CREATE INDEX "safety_sessions_current_state_sla_deadline_idx" ON "safety_sessions"("current_state", "sla_deadline");

-- CreateIndex
CREATE INDEX "sos_events_status_created_at_idx" ON "sos_events"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "trust_scores_user_id_key" ON "trust_scores"("user_id");

-- CreateIndex
CREATE INDEX "trust_scores_user_id_user_role_idx" ON "trust_scores"("user_id", "user_role");

-- CreateIndex
CREATE INDEX "device_fingerprints_fingerprint_idx" ON "device_fingerprints"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "device_fingerprints_user_id_fingerprint_key" ON "device_fingerprints"("user_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "payments_trip_id_key" ON "payments"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_stripe_transfer_id_key" ON "payouts"("stripe_transfer_id");

-- CreateIndex
CREATE INDEX "payouts_driver_id_period_start_idx" ON "payouts"("driver_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "earnings_floor_logs_trip_id_key" ON "earnings_floor_logs"("trip_id");

-- CreateIndex
CREATE INDEX "airport_queue_entries_status_queue_position_idx" ON "airport_queue_entries"("status", "queue_position");

-- CreateIndex
CREATE UNIQUE INDEX "flight_data_cache_flight_id_key" ON "flight_data_cache"("flight_id");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_accounts_stripe_customer_id_key" ON "corporate_accounts"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx" ON "audit_logs"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_created_at_idx" ON "audit_logs"("admin_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_created_at_idx" ON "support_tickets"("status", "priority", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_user_id_idx" ON "support_tickets"("user_id");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_to_id_idx" ON "support_tickets"("assigned_to_id");

-- CreateIndex
CREATE INDEX "ticket_notes_ticket_id_idx" ON "ticket_notes"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_addresses_rider_id_label_key" ON "saved_addresses"("rider_id", "label");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_stripe_refund_id_key" ON "refunds"("stripe_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "driver_earnings_trip_id_key" ON "driver_earnings"("trip_id");

-- CreateIndex
CREATE INDEX "driver_earnings_driver_id_created_at_idx" ON "driver_earnings"("driver_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fraud_alerts_status_created_at_idx" ON "fraud_alerts"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fraud_alerts_user_id_created_at_idx" ON "fraud_alerts"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "driver_bid_exposures_bid_id_idx" ON "driver_bid_exposures"("bid_id");

-- CreateIndex
CREATE INDEX "driver_bid_exposures_driver_user_id_exposed_at_idx" ON "driver_bid_exposures"("driver_user_id", "exposed_at" DESC);

-- CreateIndex
CREATE INDEX "driver_session_logs_driver_user_id_started_at_idx" ON "driver_session_logs"("driver_user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "ai_inference_logs_model_name_created_at_idx" ON "ai_inference_logs"("model_name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_inference_logs_trip_id_idx" ON "ai_inference_logs"("trip_id");

-- CreateIndex
CREATE INDEX "ai_inference_logs_user_id_idx" ON "ai_inference_logs"("user_id");

-- CreateIndex
CREATE INDEX "bid_outcomes_trip_id_idx" ON "bid_outcomes"("trip_id");

-- CreateIndex
CREATE INDEX "bid_outcomes_was_accepted_created_at_idx" ON "bid_outcomes"("was_accepted", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bid_outcomes_zone_key_was_accepted_idx" ON "bid_outcomes"("zone_key", "was_accepted");

-- CreateIndex
CREATE INDEX "bid_outcomes_prediction_correct_created_at_idx" ON "bid_outcomes"("prediction_correct", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "proxy_sessions_trip_id_key" ON "proxy_sessions"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_sessions_twilio_session_sid_key" ON "proxy_sessions"("twilio_session_sid");

-- CreateIndex
CREATE INDEX "proxy_sessions_status_expires_at_idx" ON "proxy_sessions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "financial_ledger_correlation_id_idx" ON "financial_ledger"("correlation_id");

-- CreateIndex
CREATE INDEX "financial_ledger_account_id_created_at_idx" ON "financial_ledger"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "financial_ledger_trip_id_idx" ON "financial_ledger"("trip_id");

-- CreateIndex
CREATE INDEX "financial_ledger_entry_type_created_at_idx" ON "financial_ledger"("entry_type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "driver_wallets_driver_id_key" ON "driver_wallets"("driver_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_created_at_idx" ON "wallet_transactions"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "wallet_transactions_driver_id_created_at_idx" ON "wallet_transactions"("driver_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payout_batches_status_created_at_idx" ON "payout_batches"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payout_attempts_stripe_transfer_id_key" ON "payout_attempts"("stripe_transfer_id");

-- CreateIndex
CREATE INDEX "payout_attempts_driver_id_created_at_idx" ON "payout_attempts"("driver_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payout_attempts_status_next_retry_at_idx" ON "payout_attempts"("status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reconciliation_stripe_object_id_key" ON "payment_reconciliation"("stripe_object_id");

-- CreateIndex
CREATE INDEX "payment_reconciliation_status_created_at_idx" ON "payment_reconciliation"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payment_reconciliation_stripe_object_type_created_at_idx" ON "payment_reconciliation"("stripe_object_type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trip_routes_trip_id_key" ON "trip_routes"("trip_id");

-- CreateIndex
CREATE INDEX "trip_routes_trip_id_idx" ON "trip_routes"("trip_id");

-- CreateIndex
CREATE INDEX "route_deviation_events_trip_id_idx" ON "route_deviation_events"("trip_id");

-- CreateIndex
CREATE INDEX "route_deviation_events_created_at_idx" ON "route_deviation_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "route_deviation_events_risk_level_created_at_idx" ON "route_deviation_events"("risk_level", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trip_safety_scores_trip_id_key" ON "trip_safety_scores"("trip_id");

-- CreateIndex
CREATE INDEX "trip_safety_scores_trip_id_idx" ON "trip_safety_scores"("trip_id");

-- CreateIndex
CREATE INDEX "trip_safety_scores_risk_level_created_at_idx" ON "trip_safety_scores"("risk_level", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_corporate_account_id_fkey" FOREIGN KEY ("corporate_account_id") REFERENCES "corporate_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_bid_id_fkey" FOREIGN KEY ("bid_id") REFERENCES "bids"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_sessions" ADD CONSTRAINT "safety_sessions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_sessions" ADD CONSTRAINT "safety_sessions_admin_assigned_id_fkey" FOREIGN KEY ("admin_assigned_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_safety_session_id_fkey" FOREIGN KEY ("safety_session_id") REFERENCES "safety_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_admin_assigned_id_fkey" FOREIGN KEY ("admin_assigned_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sos_events" ADD CONSTRAINT "sos_events_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "safety_recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panic_events" ADD CONSTRAINT "panic_events_safety_session_id_fkey" FOREIGN KEY ("safety_session_id") REFERENCES "safety_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_recordings" ADD CONSTRAINT "safety_recordings_safety_session_id_fkey" FOREIGN KEY ("safety_session_id") REFERENCES "safety_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safe_check_ins" ADD CONSTRAINT "safe_check_ins_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safe_check_ins" ADD CONSTRAINT "safe_check_ins_safety_session_id_fkey" FOREIGN KEY ("safety_session_id") REFERENCES "safety_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_scores" ADD CONSTRAINT "trust_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_score_history" ADD CONSTRAINT "trust_score_history_trust_score_id_fkey" FOREIGN KEY ("trust_score_id") REFERENCES "trust_scores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_fingerprints" ADD CONSTRAINT "device_fingerprints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multi_account_links" ADD CONSTRAINT "multi_account_links_user_id_a_fkey" FOREIGN KEY ("user_id_a") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multi_account_links" ADD CONSTRAINT "multi_account_links_user_id_b_fkey" FOREIGN KEY ("user_id_b") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_floor_logs" ADD CONSTRAINT "earnings_floor_logs_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_floor_logs" ADD CONSTRAINT "earnings_floor_logs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "earnings_floor_logs" ADD CONSTRAINT "earnings_floor_logs_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_suspensions" ADD CONSTRAINT "driver_suspensions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_rewards" ADD CONSTRAINT "driver_rewards_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_performance_snapshots" ADD CONSTRAINT "driver_performance_snapshots_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_notifications" ADD CONSTRAINT "driver_notifications_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_notifications" ADD CONSTRAINT "rider_notifications_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "airport_queue_entries" ADD CONSTRAINT "airport_queue_entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incident_assignments" ADD CONSTRAINT "safety_incident_assignments_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_notes" ADD CONSTRAINT "ticket_notes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_config" ADD CONSTRAINT "platform_config_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_sessions" ADD CONSTRAINT "proxy_sessions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallets" ADD CONSTRAINT "driver_wallets_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "driver_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_attempts" ADD CONSTRAINT "payout_attempts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
