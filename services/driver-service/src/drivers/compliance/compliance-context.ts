import { BackgroundCheckStatus } from '@bidride/database';
import { ComplianceContext } from './compliance.types';

// The already-fetched driver record shape the engine needs. Superset of the
// legacy computeMissingRequirements() input plus the personal-info fields
// (informational). Optional personal fields keep the legacy call sites — which
// passed a driver object without asserting these — type-compatible.
export interface DriverComplianceRecord {
  legalFirstName?: string | null;
  dateOfBirth?: Date | null;
  licenseNumber?: string | null;
  documents: Array<{ documentType: string; status: string }>;
  vehicles: Array<{ isActive: boolean }>;
  backgroundCheckStatus: BackgroundCheckStatus;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceExpiry: Date | null;
  jurisdiction?: string | null;
}

// PURE mapper: builds the immutable ComplianceContext from an already-fetched
// driver record. No I/O — Phase 3A adds no new queries. `now` is injectable for
// deterministic tests (defaults to the real clock, matching legacy behavior).
export function buildComplianceContext(
  driver: DriverComplianceRecord,
  now: Date = new Date(),
): ComplianceContext {
  return {
    legalFirstName: driver.legalFirstName ?? null,
    dateOfBirth: driver.dateOfBirth ?? null,
    licenseNumber: driver.licenseNumber ?? null,
    documents: driver.documents,
    vehicles: driver.vehicles,
    backgroundCheckStatus: driver.backgroundCheckStatus,
    insuranceProvider: driver.insuranceProvider,
    insurancePolicyNumber: driver.insurancePolicyNumber,
    insuranceExpiry: driver.insuranceExpiry,
    jurisdiction: driver.jurisdiction ?? null,
    now,
  };
}
