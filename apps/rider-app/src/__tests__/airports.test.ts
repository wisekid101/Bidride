import { detectEwrAddress, EWR_TERMINALS, isNearEwr, EWR_RADIUS_METERS } from '../constants/airports';

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

describe('isNearEwr (airport geofence)', () => {
  it('includes every EWR terminal', () => {
    for (const t of EWR_TERMINALS) {
      expect(isNearEwr(t.lat, t.lng)).toBe(true);
    }
  });

  it('includes the EWR cell phone lot (~0.74 mi from center)', () => {
    expect(isNearEwr(40.6990, -74.1810)).toBe(true);
  });

  it('excludes Port Newark Marine Terminal (~1.59 mi)', () => {
    expect(isNearEwr(40.6840, -74.1450)).toBe(false);
  });

  it('excludes Terminal Ave in Elizabeth (~2.19 mi)', () => {
    expect(isNearEwr(40.6600, -74.1900)).toBe(false);
  });

  it('excludes downtown Newark (~3.2 mi)', () => {
    expect(isNearEwr(40.7357, -74.1724)).toBe(false);
  });

  it('radius default keeps the false-positive margin (inside 1.2mi ≈ 1930m)', () => {
    // The nearest known false positive (Port Newark, ~2560m) must stay
    // outside even if the radius is tuned up moderately.
    expect(EWR_RADIUS_METERS).toBeLessThan(2500);
    expect(EWR_RADIUS_METERS).toBeGreaterThan(500);
  });
});
