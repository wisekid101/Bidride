import { ComplianceEngine, DEFAULT_REQUIREMENTS } from './compliance-engine';
import { buildComplianceContext, DriverComplianceRecord } from './compliance-context';
import { PersonalInfoRequirement } from './requirements/personal-info.requirement';
import { DocumentsRequirement } from './requirements/documents.requirement';
import { BackgroundCheckRequirement } from './requirements/background-check.requirement';
import { VehicleRequirement } from './requirements/vehicle.requirement';
import { InsuranceRequirement } from './requirements/insurance.requirement';

const FUTURE = new Date('2030-01-01');
const PAST = new Date('2020-01-01');
const NOW = new Date('2026-07-23');

// ─────────────────────────────────────────────────────────────────────────────
// Oracle: a VERBATIM copy of the pre-refactor DriverActivationService
// computeMissingRequirements() algorithm. The engine must reproduce this exactly.
// ─────────────────────────────────────────────────────────────────────────────
function legacyComputeMissing(driver: DriverComplianceRecord, now: Date): string[] {
  const REQUIRED = [
    { label: 'drivers_license', types: ['drivers_license'] },
    { label: 'insurance_card', types: ['insurance', 'insurance_card'] },
    { label: 'vehicle_registration', types: ['registration', 'vehicle_registration'] },
  ];
  const missing: string[] = [];
  for (const req of REQUIRED) {
    const ok = driver.documents.some(
      (d) => req.types.includes(d.documentType) && d.status === 'approved',
    );
    if (!ok) missing.push(`document_not_approved:${req.label}`);
  }
  if (driver.backgroundCheckStatus !== ('clear' as any)) {
    missing.push(`background_check:${driver.backgroundCheckStatus}`);
  }
  if (!driver.vehicles.some((v) => v.isActive)) missing.push('no_active_vehicle');
  if (!driver.insuranceProvider || !driver.insurancePolicyNumber || !driver.insuranceExpiry) {
    missing.push('insurance_info_missing');
  } else if (driver.insuranceExpiry <= now) {
    missing.push('insurance_expired');
  }
  return missing;
}

const engine = new ComplianceEngine();
const run = (d: DriverComplianceRecord) =>
  engine.evaluate(buildComplianceContext(d, { now: NOW })).missing;

describe('ComplianceEngine — golden equivalence with the legacy activation check', () => {
  // Cartesian permutation over every gate dimension.
  const docSets: Array<Array<{ documentType: string; status: string }>> = [
    [],
    [{ documentType: 'drivers_license', status: 'approved' }],
    [
      { documentType: 'drivers_license', status: 'approved' },
      { documentType: 'insurance', status: 'approved' },
      { documentType: 'registration', status: 'approved' },
    ],
    [
      { documentType: 'drivers_license', status: 'approved' },
      { documentType: 'insurance_card', status: 'approved' },
      { documentType: 'vehicle_registration', status: 'approved' },
    ],
    [
      { documentType: 'drivers_license', status: 'pending' },
      { documentType: 'insurance', status: 'approved' },
      { documentType: 'registration', status: 'rejected' },
    ],
  ];
  const bgStatuses = ['not_started', 'pending', 'clear', 'consider', 'adverse_action', 'disputed'];
  const vehicleSets = [[], [{ isActive: false }], [{ isActive: true }], [{ isActive: false }, { isActive: true }]];
  const insuranceSets = [
    { insuranceProvider: null, insurancePolicyNumber: null, insuranceExpiry: null },
    { insuranceProvider: 'Acme', insurancePolicyNumber: 'P1', insuranceExpiry: PAST },
    { insuranceProvider: 'Acme', insurancePolicyNumber: 'P1', insuranceExpiry: FUTURE },
    { insuranceProvider: 'Acme', insurancePolicyNumber: null, insuranceExpiry: FUTURE },
  ];

  it('produces byte-identical `missing` (keys AND order) across every permutation', () => {
    let count = 0;
    for (const documents of docSets) {
      for (const backgroundCheckStatus of bgStatuses) {
        for (const vehicles of vehicleSets) {
          for (const ins of insuranceSets) {
            const driver: DriverComplianceRecord = {
              documents,
              vehicles,
              backgroundCheckStatus: backgroundCheckStatus as any,
              ...ins,
            };
            expect(run(driver)).toEqual(legacyComputeMissing(driver, NOW));
            count++;
          }
        }
      }
    }
    // 5 * 6 * 4 * 4 = 480 permutations verified.
    expect(count).toBe(480);
  });

  it('a fully-eligible driver yields an empty missing list and canActivate=true', () => {
    const driver: DriverComplianceRecord = {
      documents: [
        { documentType: 'drivers_license', status: 'approved' },
        { documentType: 'insurance', status: 'approved' },
        { documentType: 'registration', status: 'approved' },
      ],
      vehicles: [{ isActive: true }],
      backgroundCheckStatus: 'clear' as any,
      insuranceProvider: 'Acme',
      insurancePolicyNumber: 'P1',
      insuranceExpiry: FUTURE,
    };
    const report = engine.evaluate(buildComplianceContext(driver, { now: NOW }));
    expect(report.missing).toEqual([]);
    expect(report.canActivate).toBe(true);
  });

  it('preserves the legacy key ORDER: documents → background → vehicle → insurance', () => {
    const driver: DriverComplianceRecord = {
      documents: [],
      vehicles: [],
      backgroundCheckStatus: 'pending' as any,
      insuranceProvider: null,
      insurancePolicyNumber: null,
      insuranceExpiry: null,
    };
    expect(run(driver)).toEqual([
      'document_not_approved:drivers_license',
      'document_not_approved:insurance_card',
      'document_not_approved:vehicle_registration',
      'background_check:pending',
      'no_active_vehicle',
      'insurance_info_missing',
    ]);
  });
});

describe('ComplianceEngine — informational personal-info never affects activation', () => {
  const eligibleButNoPersonalInfo: DriverComplianceRecord = {
    legalFirstName: null,
    dateOfBirth: null,
    licenseNumber: null,
    documents: [
      { documentType: 'drivers_license', status: 'approved' },
      { documentType: 'insurance', status: 'approved' },
      { documentType: 'registration', status: 'approved' },
    ],
    vehicles: [{ isActive: true }],
    backgroundCheckStatus: 'clear' as any,
    insuranceProvider: 'Acme',
    insurancePolicyNumber: 'P1',
    insuranceExpiry: FUTURE,
  };

  it('missing stays empty / canActivate stays true even with personal info absent (matches legacy)', () => {
    const report = engine.evaluate(buildComplianceContext(eligibleButNoPersonalInfo, { now: NOW }));
    expect(report.missing).toEqual([]);
    expect(report.canActivate).toBe(true);
    expect(legacyComputeMissing(eligibleButNoPersonalInfo, NOW)).toEqual([]);
  });

  it('surfaces personal info as an informational warning without contributing keys', () => {
    const report = engine.evaluate(buildComplianceContext(eligibleButNoPersonalInfo, { now: NOW }));
    const personal = report.all.find((r) => r.metadata.id === 'personal_info');
    expect(personal?.metadata.severity).toBe('informational');
    expect(personal?.status).toBe('missing');
    expect(personal?.keys).toEqual([]);
    expect(report.warnings.map((w) => w.metadata.id)).toContain('personal_info');
  });
});

describe('requirement modules — individually testable, pure', () => {
  const base: DriverComplianceRecord = {
    legalFirstName: 'Sam',
    dateOfBirth: new Date('1990-01-01'),
    licenseNumber: 'D1',
    documents: [
      { documentType: 'drivers_license', status: 'approved' },
      { documentType: 'insurance', status: 'approved' },
      { documentType: 'registration', status: 'approved' },
    ],
    vehicles: [{ isActive: true }],
    backgroundCheckStatus: 'clear' as any,
    insuranceProvider: 'Acme',
    insurancePolicyNumber: 'P1',
    insuranceExpiry: FUTURE,
  };
  const ctx = (o: Partial<DriverComplianceRecord> = {}) =>
    buildComplianceContext({ ...base, ...o }, { now: NOW });

  it('DocumentsRequirement: alias spellings count as approved', () => {
    const r = DocumentsRequirement.evaluate(
      ctx({
        documents: [
          { documentType: 'drivers_license', status: 'approved' },
          { documentType: 'insurance_card', status: 'approved' },
          { documentType: 'vehicle_registration', status: 'approved' },
        ],
      }),
    );
    expect(r.status).toBe('met');
    expect(r.keys).toEqual([]);
  });

  it('DocumentsRequirement: a rejected required doc is not "approved"', () => {
    const r = DocumentsRequirement.evaluate(
      ctx({ documents: [{ documentType: 'drivers_license', status: 'rejected' }] }),
    );
    expect(r.keys).toContain('document_not_approved:drivers_license');
  });

  it('BackgroundCheckRequirement: clear → met, otherwise pending with status key', () => {
    expect(BackgroundCheckRequirement.evaluate(ctx()).status).toBe('met');
    const r = BackgroundCheckRequirement.evaluate(ctx({ backgroundCheckStatus: 'consider' as any }));
    expect(r.keys).toEqual(['background_check:consider']);
  });

  it('VehicleRequirement: no active vehicle → no_active_vehicle', () => {
    expect(VehicleRequirement.evaluate(ctx({ vehicles: [{ isActive: false }] })).keys).toEqual([
      'no_active_vehicle',
    ]);
  });

  it('InsuranceRequirement: missing vs expired vs valid (expiry-aware, exposes expiresAt)', () => {
    expect(
      InsuranceRequirement.evaluate(
        ctx({ insuranceProvider: null, insurancePolicyNumber: null, insuranceExpiry: null }),
      ).keys,
    ).toEqual(['insurance_info_missing']);
    const expired = InsuranceRequirement.evaluate(ctx({ insuranceExpiry: PAST }));
    expect(expired.status).toBe('expired');
    expect(expired.keys).toEqual(['insurance_expired']);
    const valid = InsuranceRequirement.evaluate(ctx());
    expect(valid.status).toBe('met');
    expect(valid.expiresAt).toBe(FUTURE);
  });

  it('PersonalInfoRequirement: informational, never contributes keys', () => {
    expect(PersonalInfoRequirement.evaluate(ctx({ legalFirstName: null })).keys).toEqual([]);
    expect(PersonalInfoRequirement.evaluate(ctx({ legalFirstName: null })).status).toBe('missing');
  });
});

describe('requirement metadata — the future single source of truth', () => {
  const VALID_CATEGORIES = [
    'identity',
    'vehicle',
    'documentation',
    'insurance',
    'background',
    'compliance',
    'tax',
    'training',
    'airport',
    'jurisdiction',
  ];

  it('exposes the full metadata contract for every module', () => {
    for (const req of DEFAULT_REQUIREMENTS) {
      const m = req.metadata;
      expect(typeof m.id).toBe('string');
      expect(typeof m.displayName).toBe('string');
      expect(typeof m.description).toBe('string');
      expect(VALID_CATEGORIES).toContain(m.category);
      expect(['blocking', 'informational']).toContain(m.severity);
      expect(m.scope).toBe('activation');
      expect(typeof m.supportsExpiration).toBe('boolean');
      expect(typeof m.supportsJurisdiction).toBe('boolean');
      expect(m).toHaveProperty('policyVersion');
      expect(m).toHaveProperty('onboardingStep');
    }
  });

  it('every module exposes a valid, STABLE category (grouping for future systems)', () => {
    const byId = Object.fromEntries(
      DEFAULT_REQUIREMENTS.map((r) => [r.metadata.id, r.metadata.category]),
    );
    expect(byId).toEqual({
      personal_info: 'identity',
      documents: 'documentation',
      background_check: 'background',
      vehicle: 'vehicle',
      insurance: 'insurance',
      zero_tolerance: 'compliance',
    });
  });

  it('blocking set is the four legacy gates plus zero_tolerance (last); personal_info is informational', () => {
    const blocking = DEFAULT_REQUIREMENTS.filter((r) => r.metadata.severity === 'blocking').map(
      (r) => r.metadata.id,
    );
    // zero_tolerance is registered LAST so its key appends after the legacy keys.
    expect(blocking).toEqual(['documents', 'background_check', 'vehicle', 'insurance', 'zero_tolerance']);
    const informational = DEFAULT_REQUIREMENTS.filter(
      (r) => r.metadata.severity === 'informational',
    ).map((r) => r.metadata.id);
    expect(informational).toEqual(['personal_info']);
  });

  it('static metadata carries no literal policyVersion (the live version is on the result)', () => {
    for (const req of DEFAULT_REQUIREMENTS) expect(req.metadata.policyVersion).toBeNull();
  });

  it('zero_tolerance metadata: compliance/activation/blocking, onboardingStep zero_tolerance', () => {
    const zt = DEFAULT_REQUIREMENTS.find((r) => r.metadata.id === 'zero_tolerance')!.metadata;
    expect(zt.category).toBe('compliance');
    expect(zt.scope).toBe('activation');
    expect(zt.severity).toBe('blocking');
    expect(zt.onboardingStep).toBe('zero_tolerance');
  });
});
