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
  zeroToleranceAcceptedVersion?: string | null;
  jurisdiction?: string | null;
}

// Options carrying values that must be RESOLVED OUTSIDE the engine (I/O in the
// async caller) and injected so the engine + modules stay pure.
export interface ComplianceContextOptions {
  now?: Date;
  // Current active Zero Tolerance policy version, resolved by the caller.
  // Undefined/null => no policy published => the Zero Tolerance gate is inert.
  currentZeroTolerancePolicyVersion?: string | null;
}

// PURE mapper: builds the immutable ComplianceContext from an already-fetched
// driver record plus caller-resolved options. No I/O. `now` is injectable for
// deterministic tests (defaults to the real clock, matching legacy behavior).
export function buildComplianceContext(
  driver: DriverComplianceRecord,
  opts: ComplianceContextOptions = {},
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
    zeroToleranceAcceptedVersion: driver.zeroToleranceAcceptedVersion ?? null,
    currentZeroTolerancePolicyVersion: opts.currentZeroTolerancePolicyVersion ?? null,
    jurisdiction: driver.jurisdiction ?? null,
    now: opts.now ?? new Date(),
  };
}
