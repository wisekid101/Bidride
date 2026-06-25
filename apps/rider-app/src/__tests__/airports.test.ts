import { detectEwrAddress, EWR_TERMINALS } from '../constants/airports';

describe('detectEwrAddress', () => {
  it('detects "Newark Liberty International Airport"', () => {
    expect(detectEwrAddress('Newark Liberty International Airport, Newark, NJ 07114, USA')).toBe(true);
  });

  it('detects standalone "EWR" word boundary', () => {
    expect(detectEwrAddress('EWR Terminal B')).toBe(true);
  });

  it('detects "Newark airport" (case insensitive)', () => {
    expect(detectEwrAddress('newark airport')).toBe(true);
  });

  it('does not match "newark" as a city alone', () => {
    expect(detectEwrAddress('123 Main St, Newark, NJ')).toBe(false);
  });

  it('does not match partial "ewr" inside a word', () => {
    expect(detectEwrAddress('sewer repair services')).toBe(false);
  });
});

describe('EWR_TERMINALS', () => {
  it('has exactly 3 terminals (A, B, C)', () => {
    expect(EWR_TERMINALS).toHaveLength(3);
    const names = EWR_TERMINALS.map((t) => t.name);
    expect(names).toContain('Terminal A');
    expect(names).toContain('Terminal B');
    expect(names).toContain('Terminal C');
  });

  it('all terminals have valid Newark area coordinates', () => {
    for (const t of EWR_TERMINALS) {
      expect(t.lat).toBeGreaterThan(40.68);
      expect(t.lat).toBeLessThan(40.70);
      expect(t.lng).toBeGreaterThan(-74.18);
      expect(t.lng).toBeLessThan(-74.16);
    }
  });

  it('all terminals have distinct coordinates', () => {
    const coords = EWR_TERMINALS.map((t) => `${t.lat},${t.lng}`);
    const unique = new Set(coords);
    expect(unique.size).toBe(3);
  });
});
