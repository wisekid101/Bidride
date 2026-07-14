import { DOMAIN_REGISTRY, assertDomainActive, getDomain, listDomains } from './domain-manifest';

describe('AI domain registry', () => {
  it('registers exactly the seven approved active domains', () => {
    expect(listDomains('active').map((d) => d.domain).sort()).toEqual([
      'driver_success', 'founder', 'integrity', 'marketplace', 'opportunity', 'pricing', 'rider_experience',
    ]);
  });

  it('reserves the five future domains without activating them', () => {
    expect(listDomains('reserved').map((d) => d.domain).sort()).toEqual([
      'community', 'creator', 'delivery', 'financial', 'merchant',
    ]);
  });

  it('every manifest declares the full governance surface', () => {
    for (const m of DOMAIN_REGISTRY) {
      expect(m.domain).toBeTruthy();
      expect(m.owner).toBeTruthy();
      expect(m.purpose).toBeTruthy();
      expect(Array.isArray(m.allowedFeatureFamilies)).toBe(true);
      expect(m.prohibitedFeatureFamilies.length).toBeGreaterThan(0);
      expect(Array.isArray(m.featureAllowlist)).toBe(true);
      expect(Array.isArray(m.dataSources)).toBe(true);
      expect(['training_1y', 'audit_permanent', 'ephemeral_ttl']).toContain(m.retentionClass);
      expect(m.killSwitchKey).toMatch(/^ai_[a-z_]+_enabled$/);
      expect(typeof m.shadowRequired).toBe('boolean');
      expect(Array.isArray(m.allowedConsumers)).toBe(true);
      expect(m.constitutionTags.length).toBeGreaterThan(0);
      expect(m.decisionAuthority).toBe('advisory_only'); // AI never decides
      expect(['active', 'reserved']).toContain(m.rolloutStatus);
    }
  });

  it('every active domain declares its ledger families; reserved domains declare none', () => {
    for (const d of listDomains('active')) expect(d.families.length).toBeGreaterThan(0);
    for (const d of listDomains('reserved')) expect(d.families).toEqual([]);
  });

  it('every manifest prohibits panic data, protected characteristics, PII, and raw GPS', () => {
    for (const m of DOMAIN_REGISTRY) {
      const flat = m.prohibitedFeatureFamilies.join(' ');
      expect(flat).toMatch(/panic/i);
      expect(flat).toMatch(/protected/i);
      expect(flat).toMatch(/pii/i);
      expect(flat).toMatch(/gps/i);
    }
  });

  it('pricing explicitly prohibits trust scores (Rule 3a)', () => {
    expect(getDomain('pricing')!.prohibitedFeatureFamilies.join(' ')).toMatch(/trust_scores/);
    expect(getDomain('pricing')!.featureAllowlist).not.toContain('riderTrustScore');
  });

  it('there is deliberately NO safety domain — safety is not an AI surface', () => {
    expect(getDomain('safety')).toBeUndefined();
  });

  it('assertDomainActive gates reserved and unknown domains', () => {
    expect(() => assertDomainActive('founder')).not.toThrow();
    expect(() => assertDomainActive('delivery')).toThrow(/reserved/);
    expect(() => assertDomainActive('nonsense')).toThrow(/no manifest/i);
  });

  it('production-serving domains require shadow mode; Founder read-only surfaces do not', () => {
    for (const name of ['pricing', 'marketplace', 'driver_success', 'rider_experience', 'integrity']) {
      expect(getDomain(name)!.shadowRequired).toBe(true);
    }
    expect(getDomain('founder')!.shadowRequired).toBe(false);
    expect(getDomain('opportunity')!.shadowRequired).toBe(false);
  });
});
