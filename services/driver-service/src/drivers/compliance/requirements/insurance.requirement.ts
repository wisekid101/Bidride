import { ComplianceContext, ComplianceRequirement, RequirementResult } from '../compliance.types';

// Blocking: insurance must be present and unexpired. Contributes
// `insurance_info_missing` (any field absent) or `insurance_expired` (past the
// expiry date) — identical to the legacy check, evaluated against ctx.now.
//
// This is the first requirement that is inherently expiry-aware; the engine
// surfaces `expiresAt` for future renewal/reminder phases without changing
// today's activation behavior.
export const InsuranceRequirement: ComplianceRequirement = {
  metadata: {
    id: 'insurance',
    displayName: 'Insurance',
    description: 'Valid, unexpired vehicle insurance on file.',
    category: 'insurance',
    severity: 'blocking',
    scope: 'activation',
    supportsExpiration: true,
    supportsJurisdiction: false,
    policyVersion: null,
    onboardingStep: 'personal_info',
  },
  appliesTo: () => true,
  evaluate(ctx: ComplianceContext): RequirementResult {
    if (!ctx.insuranceProvider || !ctx.insurancePolicyNumber || !ctx.insuranceExpiry) {
      return { metadata: this.metadata, status: 'missing', keys: ['insurance_info_missing'] };
    }
    if (ctx.insuranceExpiry <= ctx.now) {
      return {
        metadata: this.metadata,
        status: 'expired',
        keys: ['insurance_expired'],
        expiresAt: ctx.insuranceExpiry,
      };
    }
    return {
      metadata: this.metadata,
      status: 'met',
      keys: [],
      expiresAt: ctx.insuranceExpiry,
    };
  },
};
