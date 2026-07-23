import { ComplianceContext, ComplianceRequirement, RequirementResult } from '../compliance.types';

// INFORMATIONAL (Phase 3A): personal information is NOT a current activation
// gate — it is enforced at submission and by the onboarding router, and the
// legacy computeMissingRequirements() never checked it. Modeling it as
// informational keeps the engine's activation output byte-identical to today
// (it never contributes to `missing`) while still exposing personal info as a
// first-class requirement for the future single source of truth. Promotion to
// blocking would be a separate founder-signed change.
export const PersonalInfoRequirement: ComplianceRequirement = {
  metadata: {
    id: 'personal_info',
    displayName: 'Personal information',
    description: 'Legal name, date of birth, and license number on file.',
    category: 'identity',
    severity: 'informational',
    scope: 'activation',
    supportsExpiration: false,
    supportsJurisdiction: false,
    policyVersion: null,
    onboardingStep: 'personal_info',
  },
  appliesTo: () => true,
  evaluate(ctx: ComplianceContext): RequirementResult {
    const complete = Boolean(ctx.legalFirstName && ctx.dateOfBirth && ctx.licenseNumber);
    return {
      metadata: this.metadata,
      // Reported for visibility only; `keys` is ALWAYS empty (informational), so
      // it can never affect `missing` or `canActivate`.
      status: complete ? 'met' : 'missing',
      keys: [],
    };
  },
};
