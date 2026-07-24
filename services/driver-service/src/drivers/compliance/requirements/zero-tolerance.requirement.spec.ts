import { ZeroToleranceRequirement } from './zero-tolerance.requirement';
import { ComplianceEngine } from '../compliance-engine';
import { buildComplianceContext, DriverComplianceRecord } from '../compliance-context';

const FUTURE = new Date('2030-01-01');

// A driver satisfying all four legacy gates — used to isolate the ZT gate.
const eligibleDriver: DriverComplianceRecord = {
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

const ztCtx = (accepted: string | null, current: string | null) =>
  buildComplianceContext(
    { ...eligibleDriver, zeroToleranceAcceptedVersion: accepted },
    { currentZeroTolerancePolicyVersion: current },
  );

describe('ZeroToleranceRequirement (pure module)', () => {
  it('accepted === current → met (no key)', () => {
    const r = ZeroToleranceRequirement.evaluate(ztCtx('zt-v2', 'zt-v2'));
    expect(r.status).toBe('met');
    expect(r.keys).toEqual([]);
  });

  it('accepted !== current → BLOCK with zero_tolerance:not_accepted', () => {
    const r = ZeroToleranceRequirement.evaluate(ztCtx('zt-v1', 'zt-v2'));
    expect(r.status).toBe('missing');
    expect(r.keys).toEqual(['zero_tolerance:not_accepted']);
  });

  it('accepted === null → BLOCK with zero_tolerance:not_accepted', () => {
    const r = ZeroToleranceRequirement.evaluate(ztCtx(null, 'zt-v2'));
    expect(r.keys).toEqual(['zero_tolerance:not_accepted']);
  });

  it('no active policy (current === null) → met and INERT (not_applicable, no key)', () => {
    const r = ZeroToleranceRequirement.evaluate(ztCtx(null, null));
    expect(r.status).toBe('not_applicable');
    expect(r.keys).toEqual([]);
  });

  it('grandfathered driver (accepted backfilled to current) → met', () => {
    // The grandfather script sets zeroToleranceAcceptedVersion = current.
    const r = ZeroToleranceRequirement.evaluate(ztCtx('zt-2026-07', 'zt-2026-07'));
    expect(r.status).toBe('met');
    expect(r.keys).toEqual([]);
  });
});

describe('ComplianceEngine — Zero Tolerance gate integration', () => {
  const engine = new ComplianceEngine();
  const missing = (accepted: string | null, current: string | null) =>
    engine.evaluate(
      buildComplianceContext(
        { ...eligibleDriver, zeroToleranceAcceptedVersion: accepted },
        { currentZeroTolerancePolicyVersion: current },
      ),
    );

  it('appends zero_tolerance:not_accepted LAST when a policy is unaccepted', () => {
    const report = missing('zt-v1', 'zt-v2');
    expect(report.missing).toEqual(['zero_tolerance:not_accepted']);
    expect(report.canActivate).toBe(false);
  });

  it('preserves legacy key order with ZT appended after insurance', () => {
    const report = engine.evaluate(
      buildComplianceContext(
        {
          documents: [],
          vehicles: [],
          backgroundCheckStatus: 'pending' as any,
          insuranceProvider: null,
          insurancePolicyNumber: null,
          insuranceExpiry: null,
          zeroToleranceAcceptedVersion: null,
        },
        { currentZeroTolerancePolicyVersion: 'zt-v2' },
      ),
    );
    expect(report.missing).toEqual([
      'document_not_approved:drivers_license',
      'document_not_approved:insurance_card',
      'document_not_approved:vehicle_registration',
      'background_check:pending',
      'no_active_vehicle',
      'insurance_info_missing',
      'zero_tolerance:not_accepted',
    ]);
  });

  it('eligible + accepted current → canActivate true, no missing', () => {
    const report = missing('zt-v2', 'zt-v2');
    expect(report.missing).toEqual([]);
    expect(report.canActivate).toBe(true);
  });

  it('eligible + no policy published → INERT → canActivate true', () => {
    const report = missing(null, null);
    expect(report.missing).toEqual([]);
    expect(report.canActivate).toBe(true);
  });
});
