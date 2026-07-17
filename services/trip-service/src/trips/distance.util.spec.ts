import {
  sanitizeRouteDistanceMiles,
  haversineMiles,
  haversineMeters,
  haversineRouteDistanceMiles,
  resolveEffectiveDistance,
} from './distance.util';

// Newark-area sample coordinates (~0.9 mi apart).
const P = { lat: 40.7, lng: -74.1 };
const D = { lat: 40.71, lng: -74.11 };
const coords = {
  pickupLat: P.lat, pickupLng: P.lng, dropoffLat: D.lat, dropoffLng: D.lng,
};

describe('sanitizeRouteDistanceMiles', () => {
  it('rounds a valid distance to 2dp', () => {
    expect(sanitizeRouteDistanceMiles(3.14159)).toBe(3.14);
  });
  it('preserves zero (pickup == dropoff is valid)', () => {
    expect(sanitizeRouteDistanceMiles(0)).toBe(0);
  });
  it('coerces a numeric string', () => {
    expect(sanitizeRouteDistanceMiles('5.5')).toBe(5.5);
  });
  it('rejects a negative distance', () => {
    expect(sanitizeRouteDistanceMiles(-1)).toBeNull();
  });
  it('rejects NaN', () => {
    expect(sanitizeRouteDistanceMiles(Number.NaN)).toBeNull();
  });
  it('rejects Infinity', () => {
    expect(sanitizeRouteDistanceMiles(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it('rejects undefined / missing', () => {
    expect(sanitizeRouteDistanceMiles(undefined)).toBeNull();
  });
  it('rejects a non-numeric string', () => {
    expect(sanitizeRouteDistanceMiles('abc')).toBeNull();
  });
  it('imposes no business distance cap (a long trip is accepted)', () => {
    expect(sanitizeRouteDistanceMiles(1200)).toBe(1200);
  });
});

describe('haversineRouteDistanceMiles', () => {
  it('returns a positive 2dp distance for distinct coordinates', () => {
    const d = haversineRouteDistanceMiles(P.lat, P.lng, D.lat, D.lng);
    expect(d).not.toBeNull();
    expect(d as number).toBeGreaterThan(0);
    expect(Math.round((d as number) * 100) / 100).toBe(d); // already 2dp
  });
  it('returns 0 when pickup equals dropoff', () => {
    expect(haversineRouteDistanceMiles(P.lat, P.lng, P.lat, P.lng)).toBe(0);
  });
  it('returns null when a coordinate is missing/invalid', () => {
    expect(haversineRouteDistanceMiles(P.lat, P.lng, undefined, D.lng)).toBeNull();
    expect(haversineRouteDistanceMiles(P.lat, P.lng, Number.NaN, D.lng)).toBeNull();
  });
  it('has no dependency on services (pure math)', () => {
    expect(haversineMiles(P.lat, P.lng, P.lat, P.lng)).toBe(0);
  });
  it('haversineMeters shares the one great-circle formula, scaled to meters', () => {
    const mi = haversineMiles(P.lat, P.lng, D.lat, D.lng);
    const m = haversineMeters(P.lat, P.lng, D.lat, D.lng);
    expect(m).toBeCloseTo((mi * 6371000) / 3958.8, 4); // same central angle, meter radius
  });
});

describe('resolveEffectiveDistance', () => {
  it('#1 selects valid actual over route', () => {
    expect(resolveEffectiveDistance({ actualDistanceMiles: 5, routeDistanceMiles: 3, ...coords }))
      .toEqual({ miles: 5, source: 'actual' });
  });
  it('#2 selects route when actual is null', () => {
    expect(resolveEffectiveDistance({ actualDistanceMiles: null, routeDistanceMiles: 3, ...coords }))
      .toEqual({ miles: 3, source: 'route' });
  });
  it('#3 selects haversine when both stored values are missing', () => {
    const r = resolveEffectiveDistance({ actualDistanceMiles: null, routeDistanceMiles: null, ...coords });
    expect(r.source).toBe('haversine');
    expect(r.miles).toBeGreaterThan(0);
  });
  it('#4 returns a null source when values and coordinates are invalid', () => {
    expect(resolveEffectiveDistance({
      actualDistanceMiles: null, routeDistanceMiles: null,
      pickupLat: undefined, pickupLng: undefined, dropoffLat: undefined, dropoffLng: undefined,
    })).toEqual({ miles: 0, source: null });
  });
  it('#5 uses actual, NOT MAX, when both are present', () => {
    // MAX would pick 9; correct behavior picks the (smaller) verified actual.
    expect(resolveEffectiveDistance({ actualDistanceMiles: 2, routeDistanceMiles: 9, ...coords }))
      .toEqual({ miles: 2, source: 'actual' });
  });
  it('#6 preserves a zero actual distance', () => {
    expect(resolveEffectiveDistance({ actualDistanceMiles: 0, routeDistanceMiles: 5, ...coords }))
      .toEqual({ miles: 0, source: 'actual' });
  });
  it('#7 preserves a zero route distance', () => {
    expect(resolveEffectiveDistance({ actualDistanceMiles: null, routeDistanceMiles: 0, ...coords }))
      .toEqual({ miles: 0, source: 'route' });
  });
  it('#8 pickup equals dropoff yields a legitimate zero via haversine', () => {
    const r = resolveEffectiveDistance({
      actualDistanceMiles: null, routeDistanceMiles: null,
      pickupLat: P.lat, pickupLng: P.lng, dropoffLat: P.lat, dropoffLng: P.lng,
    });
    expect(r).toEqual({ miles: 0, source: 'haversine' });
  });
  it('#9 rejects a negative actual and falls through to route', () => {
    expect(resolveEffectiveDistance({ actualDistanceMiles: -1, routeDistanceMiles: 3, ...coords }))
      .toEqual({ miles: 3, source: 'route' });
  });
  it('#10 rejects a negative route and falls through to haversine', () => {
    const r = resolveEffectiveDistance({ actualDistanceMiles: null, routeDistanceMiles: -1, ...coords });
    expect(r.source).toBe('haversine');
    expect(r.miles).toBeGreaterThan(0);
  });
  it('#11 rejects NaN inputs and falls through', () => {
    const r = resolveEffectiveDistance({ actualDistanceMiles: Number.NaN, routeDistanceMiles: Number.NaN, ...coords });
    expect(r.source).toBe('haversine');
    expect(Number.isFinite(r.miles)).toBe(true);
  });
  it('#12 rejects Infinity inputs and falls through', () => {
    const r = resolveEffectiveDistance({
      actualDistanceMiles: Number.POSITIVE_INFINITY, routeDistanceMiles: Number.POSITIVE_INFINITY, ...coords,
    });
    expect(r.source).toBe('haversine');
    expect(Number.isFinite(r.miles)).toBe(true);
  });
  it('#13 rounds the selected value to two decimals', () => {
    expect(resolveEffectiveDistance({ actualDistanceMiles: 4.129, routeDistanceMiles: null, ...coords }))
      .toEqual({ miles: 4.13, source: 'actual' });
  });
  it('#14 imposes no arbitrary maximum distance cap', () => {
    expect(resolveEffectiveDistance({ actualDistanceMiles: 1200, routeDistanceMiles: null, ...coords }))
      .toEqual({ miles: 1200, source: 'actual' });
  });
});
