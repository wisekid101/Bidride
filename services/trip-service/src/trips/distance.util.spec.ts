import { sanitizeRouteDistanceMiles } from './distance.util';

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
