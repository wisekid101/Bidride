import {
  decodePolyline,
  encodeFallbackPolyline,
  haversineMiles,
  minDistanceToPolylineMiles,
  LatLng,
} from './route.service';

describe('route.service — pure utility functions', () => {
  describe('haversineMiles', () => {
    it('returns 0 for same point', () => {
      const p = { lat: 40.7357, lng: -74.1724 };
      expect(haversineMiles(p, p)).toBeCloseTo(0, 5);
    });

    it('computes distance between Newark and Manhattan (~8 miles)', () => {
      const newark = { lat: 40.7357, lng: -74.1724 };
      const manhattan = { lat: 40.7580, lng: -73.9855 };
      const dist = haversineMiles(newark, manhattan);
      expect(dist).toBeGreaterThan(7);
      expect(dist).toBeLessThan(10);
    });
  });

  describe('encodeFallbackPolyline + decodePolyline (round-trip)', () => {
    it('round-trips a two-point polyline correctly', () => {
      const from: LatLng = { lat: 40.7357, lng: -74.1724 };
      const to: LatLng = { lat: 40.8000, lng: -74.0500 };

      const encoded = encodeFallbackPolyline(from, to);
      const decoded = decodePolyline(encoded);

      expect(decoded).toHaveLength(2);
      expect(decoded[0].lat).toBeCloseTo(from.lat, 4);
      expect(decoded[0].lng).toBeCloseTo(from.lng, 4);
      expect(decoded[1].lat).toBeCloseTo(to.lat, 4);
      expect(decoded[1].lng).toBeCloseTo(to.lng, 4);
    });

    it('handles negative coordinates correctly', () => {
      const from: LatLng = { lat: -33.8688, lng: 151.2093 }; // Sydney
      const to: LatLng = { lat: -37.8136, lng: 144.9631 };   // Melbourne
      const encoded = encodeFallbackPolyline(from, to);
      const decoded = decodePolyline(encoded);
      expect(decoded[0].lat).toBeCloseTo(from.lat, 4);
      expect(decoded[1].lat).toBeCloseTo(to.lat, 4);
    });
  });

  describe('decodePolyline', () => {
    it('returns empty array for empty string', () => {
      expect(decodePolyline('')).toEqual([]);
    });

    it('decodes known Google encoded polyline', () => {
      // Known encoded polyline for a simple 2-point route (from Google docs example)
      // "_p~iF~ps|U_ulLnnqC_mqNvxq`@" represents 3 points
      const decoded = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
      expect(decoded).toHaveLength(3);
      expect(decoded[0].lat).toBeCloseTo(38.5, 0);
      expect(decoded[0].lng).toBeCloseTo(-120.2, 0);
    });
  });

  describe('minDistanceToPolylineMiles', () => {
    const polyline: LatLng[] = [
      { lat: 40.7000, lng: -74.1700 },
      { lat: 40.7100, lng: -74.1600 },
      { lat: 40.7200, lng: -74.1500 },
    ];

    it('returns 0 for a point exactly on the polyline', () => {
      const dist = minDistanceToPolylineMiles({ lat: 40.7000, lng: -74.1700 }, polyline);
      expect(dist).toBeCloseTo(0, 3);
    });

    it('returns a small distance for a point near the polyline', () => {
      const nearPoint: LatLng = { lat: 40.7001, lng: -74.1701 };
      const dist = minDistanceToPolylineMiles(nearPoint, polyline);
      expect(dist).toBeLessThan(0.1); // < 0.1 miles
    });

    it('returns a larger distance for a point far from the polyline', () => {
      const farPoint: LatLng = { lat: 40.7580, lng: -73.9855 }; // Manhattan
      const dist = minDistanceToPolylineMiles(farPoint, polyline);
      expect(dist).toBeGreaterThan(5); // > 5 miles away
    });

    it('returns Infinity for empty polyline', () => {
      const dist = minDistanceToPolylineMiles({ lat: 40.7, lng: -74.1 }, []);
      expect(dist).toBe(Infinity);
    });

    it('handles single-point polyline', () => {
      const dist = minDistanceToPolylineMiles({ lat: 40.7000, lng: -74.1700 }, [{ lat: 40.7000, lng: -74.1700 }]);
      expect(dist).toBeCloseTo(0, 3);
    });

    it('correctly identifies when a point exceeds the 0.5-mile threshold', () => {
      // A point that is clearly > 0.5 miles from the polyline
      const offRoutePoint: LatLng = { lat: 40.7700, lng: -74.0900 }; // far from Newark polyline
      const dist = minDistanceToPolylineMiles(offRoutePoint, polyline);
      expect(dist).toBeGreaterThan(0.5);
    });
  });
});
