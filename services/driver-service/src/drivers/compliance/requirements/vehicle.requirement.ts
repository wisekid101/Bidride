import { ComplianceContext, ComplianceRequirement, RequirementResult } from '../compliance.types';

// Blocking: the driver must have at least one active vehicle. When none,
// contributes `no_active_vehicle` — identical to the legacy check.
export const VehicleRequirement: ComplianceRequirement = {
  metadata: {
    id: 'vehicle',
    displayName: 'Active vehicle',
    description: 'The driver must have at least one active, inspection-passed vehicle.',
    category: 'vehicle',
    severity: 'blocking',
    scope: 'activation',
    supportsExpiration: false,
    supportsJurisdiction: false,
    policyVersion: null,
    onboardingStep: 'vehicle_info',
  },
  appliesTo: () => true,
  evaluate(ctx: ComplianceContext): RequirementResult {
    const hasActive = ctx.vehicles.some((v) => v.isActive);
    return {
      metadata: this.metadata,
      status: hasActive ? 'met' : 'missing',
      keys: hasActive ? [] : ['no_active_vehicle'],
    };
  },
};
