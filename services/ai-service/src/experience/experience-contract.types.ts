// ─── Rider & Driver Experience Engine — CONTRACT ONLY (Phase 3.1, Phase 7) ───
// NO implementation in this milestone. No production recommendation is
// delivered to riders or drivers. These types define the future surface so
// that when the Experience Engine is approved, it plugs into the ledger and
// domain registry instead of inventing its own shapes.
//
// Non-negotiable properties encoded here (see design/experience-engine-contract.md):
// explicit preferences, dismissible everything, "Why am I seeing this?",
// history, opt-out, preference reset — and NO hidden behavioral manipulation,
// NO sensitive-trait inference, NO trust-score personalization, NO financial
// discrimination.

import { ConstitutionTag, EvidenceItem } from '../recommendations/recommendation.types';

export type ExperienceAudience = 'rider' | 'driver';

/** Every user-facing suggestion the future engine may deliver. */
export interface ExperienceRecommendation {
  id: string;
  /** ledger id — every user-facing suggestion traces to a governed recommendation */
  recommendationId: string;
  audience: ExperienceAudience;
  domain: 'driver_success' | 'rider_experience';
  title: string;
  body: string;
  /** MANDATORY user-visible answer to "Why am I seeing this?" */
  whyAmISeeingThis: {
    explanation: string;
    /** aggregate evidence only — never the user's own inferred traits */
    evidence: EvidenceItem[];
    dataUsed: string[];
  };
  constitutionTags: ConstitutionTag[];
  dismissible: true; // literally always
  expiresAt: string;
  createdAt: string;
}

/** Explicit, user-owned preferences. Defaults are OFF for everything. */
export interface ExperiencePreferences {
  userId: string;
  audience: ExperienceAudience;
  /** master switch — opt OUT is always available and immediate */
  recommendationsEnabled: boolean;
  /** per-category opt-ins (explicit, no inferred enrollment) */
  categories: {
    earningsTips?: boolean;      // driver
    demandHeatups?: boolean;     // driver
    offerGuidance?: boolean;     // rider
    waitExpectations?: boolean;  // rider
  };
  updatedAt: string;
}

export interface ExperienceEvent {
  recommendationId: string;
  userId: string;
  action: 'shown' | 'opened' | 'dismissed' | 'preference_opt_out' | 'preferences_reset';
  createdAt: string;
}

/** The complete API the future engine must implement — nothing less. */
export interface ExperienceEngineContract {
  getPreferences(userId: string, audience: ExperienceAudience): Promise<ExperiencePreferences>;
  setPreferences(prefs: ExperiencePreferences): Promise<void>;
  /** one call resets every preference to defaults (all off) */
  resetPreferences(userId: string, audience: ExperienceAudience): Promise<void>;
  /** returns [] whenever recommendationsEnabled is false — no dark patterns */
  getActiveRecommendations(userId: string, audience: ExperienceAudience): Promise<ExperienceRecommendation[]>;
  dismiss(userId: string, recommendationId: string): Promise<void>;
  history(userId: string, audience: ExperienceAudience): Promise<ExperienceEvent[]>;
}

/**
 * PROHIBITED INPUTS — compile-time documentation of what the engine may never
 * consume. Reviews reject any implementation reading these for experience
 * personalization.
 */
export const EXPERIENCE_PROHIBITED_INPUTS = [
  'trust scores (rider or driver) — no trust-score personalization',
  'protected characteristics or proxies (governance Rule 3)',
  'inferred sensitive traits of any kind',
  'panic/SOS/safety data (governance Rule 6)',
  'individual payment amounts or payment methods — no financial discrimination',
  'support ticket body text',
  'raw GPS traces (zone-level aggregates only)',
] as const;
