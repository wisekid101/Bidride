import { BackgroundCheckStatus } from '@bidride/database';
import { ComplianceContext, ComplianceRequirement, RequirementResult } from '../compliance.types';

// Blocking: the background check must be `clear`. When not clear, contributes
// `background_check:<currentStatus>` — identical to the legacy check.
export const BackgroundCheckRequirement: ComplianceRequirement = {
  metadata: {
    id: 'background_check',
    displayName: 'Background check',
    description: 'The driver background check must return a clear result.',
    category: 'background',
    severity: 'blocking',
    scope: 'activation',
    supportsExpiration: false,
    supportsJurisdiction: false,
    policyVersion: null,
    onboardingStep: 'background_check',
  },
  appliesTo: () => true,
  evaluate(ctx: ComplianceContext): RequirementResult {
    const clear = ctx.backgroundCheckStatus === BackgroundCheckStatus.clear;
    return {
      metadata: this.metadata,
      status: clear ? 'met' : 'pending',
      keys: clear ? [] : [`background_check:${ctx.backgroundCheckStatus}`],
    };
  },
};
