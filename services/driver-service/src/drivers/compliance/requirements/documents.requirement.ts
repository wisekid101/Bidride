import { ComplianceContext, ComplianceRequirement, RequirementResult } from '../compliance.types';

// Each entry lists the accepted documentType spellings for one required doc (the
// app uploads 'insurance'/'registration'; the schema enum names them
// 'insurance_card'/'vehicle_registration'). Preserved verbatim from the legacy
// DriverActivationService.REQUIRED_DOCUMENTS.
export const REQUIRED_DOCUMENTS: Array<{ label: string; types: string[] }> = [
  { label: 'drivers_license', types: ['drivers_license'] },
  { label: 'insurance_card', types: ['insurance', 'insurance_card'] },
  { label: 'vehicle_registration', types: ['registration', 'vehicle_registration'] },
];

// Blocking: every required document must have an `approved` record. Contributes
// one `document_not_approved:<label>` key per unmet required document, in
// REQUIRED_DOCUMENTS order — identical to the legacy check.
export const DocumentsRequirement: ComplianceRequirement = {
  metadata: {
    id: 'documents',
    displayName: 'Required documents',
    description: "Driver's license, insurance card, and vehicle registration must be approved.",
    category: 'documentation',
    severity: 'blocking',
    scope: 'activation',
    supportsExpiration: false,
    supportsJurisdiction: false,
    policyVersion: null,
    onboardingStep: 'document_upload',
  },
  appliesTo: () => true,
  evaluate(ctx: ComplianceContext): RequirementResult {
    const keys: string[] = [];
    for (const req of REQUIRED_DOCUMENTS) {
      const ok = ctx.documents.some(
        (d) => req.types.includes(d.documentType) && d.status === 'approved',
      );
      if (!ok) keys.push(`document_not_approved:${req.label}`);
    }
    return {
      metadata: this.metadata,
      status: keys.length === 0 ? 'met' : 'missing',
      keys,
    };
  },
};
