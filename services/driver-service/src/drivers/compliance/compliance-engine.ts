import {
  ComplianceContext,
  ComplianceReport,
  ComplianceRequirement,
  RequirementResult,
} from './compliance.types';
import { PersonalInfoRequirement } from './requirements/personal-info.requirement';
import { DocumentsRequirement } from './requirements/documents.requirement';
import { BackgroundCheckRequirement } from './requirements/background-check.requirement';
import { VehicleRequirement } from './requirements/vehicle.requirement';
import { InsuranceRequirement } from './requirements/insurance.requirement';

// Registry order is significant: the blocking modules are ordered
// Documents -> Background -> Vehicle -> Insurance so that the flattened
// `missing` keys match the legacy computeMissingRequirements() output order
// exactly. PersonalInfo is informational and contributes no keys, so its
// position is immaterial to the activation output.
export const DEFAULT_REQUIREMENTS: readonly ComplianceRequirement[] = [
  PersonalInfoRequirement,
  DocumentsRequirement,
  BackgroundCheckRequirement,
  VehicleRequirement,
  InsuranceRequirement,
] as const;

// Pure evaluator over a registry of requirement modules. No I/O, no writes.
export class ComplianceEngine {
  private readonly requirements: readonly ComplianceRequirement[];

  constructor(requirements: readonly ComplianceRequirement[] = DEFAULT_REQUIREMENTS) {
    this.requirements = requirements;
  }

  evaluate(ctx: ComplianceContext): ComplianceReport {
    const all: RequirementResult[] = [];
    for (const req of this.requirements) {
      if (!req.appliesTo(ctx)) continue;
      all.push(req.evaluate(ctx));
    }

    const blockingUnmet = all.filter((r) => r.metadata.severity === 'blocking' && r.keys.length > 0);
    const warnings = all.filter(
      (r) => r.metadata.severity === 'informational' && r.status !== 'met',
    );
    // Flatten in registry order → identical to the legacy flat `missing` list.
    const missing = blockingUnmet.flatMap((r) => r.keys);

    return {
      all,
      blockingUnmet,
      warnings,
      missing,
      canActivate: missing.length === 0,
    };
  }
}
