// ─── Mock fetch before any imports ────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock ioredis
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedis),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeocodingService } from './geocoding.service';
import { REDIS_CLIENT } from '../redis/redis.module';

// ─── Google Maps API response fixtures ───────────────────────────────────────

const autocompleteResponse = {
  status: 'OK',
  predictions: [
    {
      place_id: 'ChIJ_test_001',
      description: '123 Market St, Newark, NJ 07102, USA',
      structured_formatting: {
        main_text: '123 Market St',
        secondary_text: 'Newark, NJ 07102, USA',
      },
    },
    {
      place_id: 'ChIJ_test_002',
      description: '456 Market St, Newark, NJ 07105, USA',
      structured_formatting: {
        main_text: '456 Market St',
        secondary_text: 'Newark, NJ 07105, USA',
      },
    },
  ],
};

const placeDetailsResponse = {
  status: 'OK',
  result: {
    formatted_address: '123 Market St, Newark, NJ 07102, USA',
    geometry: { location: { lat: 40.7357, lng: -74.1724 } },
  },
};

const reverseGeocodeResponse = {
  status: 'OK',
  results: [{ formatted_address: '123 Market St, Newark, NJ 07102, USA' }],
};

// ─── Test setup ───────────────────────────────────────────────────────────────

async function buildService() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      GeocodingService,
      {
        provide: ConfigService,
        useValue: { getOrThrow: jest.fn().mockReturnValue('test-api-key') },
      },
      { provide: REDIS_CLIENT, useValue: mockRedis },
    ],
  }).compile();

  return module.get<GeocodingService>(GeocodingService);
}

function mockApiResponse(body: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.setex.mockResolvedValue('OK');
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GeocodingService', () => {
  describe('autocomplete', () => {
    it('returns suggestions from Google Places API', async () => {
      const service = await buildService();
      mockApiResponse(autocompleteResponse);

      const results = await service.autocomplete('123 Market');

      expect(results).toHaveLength(2);
      expect(results[0].placeId).toBe('ChIJ_test_001');
      expect(results[0].mainText).toBe('123 Market St');
      expect(results[0].secondaryText).toBe('Newark, NJ 07102, USA');
    });

    it('returns empty array for queries shorter than 2 characters', async () => {
      const service = await buildService();

      const results = await service.autocomplete('a');

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty array for empty query', async () => {
      const service = await buildService();

      const results = await service.autocomplete('');

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns cached results without calling API again', async () => {
      const service = await buildService();
      const cached = JSON.stringify([{ placeId: 'cached-id', description: 'Cached result', mainText: 'Cached', secondaryText: 'NJ' }]);
      mockRedis.get.mockResolvedValue(cached);

      const results = await service.autocomplete('123 Market');

      expect(results[0].placeId).toBe('cached-id');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('caches results with 5-minute TTL', async () => {
      const service = await buildService();
      mockApiResponse(autocompleteResponse);

      await service.autocomplete('123 Market');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('geocode:autocomplete:'),
        300,
        expect.any(String),
      );
    });

    it('returns empty array when Google API returns ZERO_RESULTS', async () => {
      const service = await buildService();
      mockApiResponse({ status: 'ZERO_RESULTS', predictions: [] });

      const results = await service.autocomplete('xyzzy irreversible');

      expect(results).toHaveLength(0);
    });

    it('returns empty array gracefully when fetch throws (API unavailable)', async () => {
      const service = await buildService();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const results = await service.autocomplete('123 Market');

      expect(results).toHaveLength(0);
    });

    it('includes country:us restriction in API call', async () => {
      const service = await buildService();
      mockApiResponse(autocompleteResponse);

      await service.autocomplete('Market St');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('components=country%3Aus');
    });

    it('passes sessionToken to API when provided', async () => {
      const service = await buildService();
      mockApiResponse(autocompleteResponse);

      await service.autocomplete('Market St', 'session-token-abc');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('sessiontoken=session-token-abc');
    });
  });

  describe('getPlaceCoordinates', () => {
    it('returns lat/lng and formatted address for a valid place ID', async () => {
      const service = await buildService();
      mockApiResponse(placeDetailsResponse);

      const coords = await service.getPlaceCoordinates('ChIJ_test_001');

      expect(coords.lat).toBeCloseTo(40.7357);
      expect(coords.lng).toBeCloseTo(-74.1724);
      expect(coords.formattedAddress).toBe('123 Market St, Newark, NJ 07102, USA');
    });

    it('throws BadRequestException for empty placeId', async () => {
      const service = await buildService();

      await expect(service.getPlaceCoordinates('')).rejects.toThrow(BadRequestException);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when Google returns INVALID_REQUEST', async () => {
      const service = await buildService();
      mockApiResponse({ status: 'INVALID_REQUEST', result: null });

      await expect(service.getPlaceCoordinates('bad-id')).rejects.toThrow(BadRequestException);
    });

    it('throws ServiceUnavailableException when fetch fails', async () => {
      const service = await buildService();
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      await expect(service.getPlaceCoordinates('ChIJ_test_001')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('returns cached coordinates without calling API', async () => {
      const service = await buildService();
      const cached = JSON.stringify({ lat: 40.7357, lng: -74.1724, formattedAddress: 'Cached' });
      mockRedis.get.mockResolvedValue(cached);

      const coords = await service.getPlaceCoordinates('ChIJ_test_001');

      expect(coords.formattedAddress).toBe('Cached');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('caches place details with 7-day TTL', async () => {
      const service = await buildService();
      mockApiResponse(placeDetailsResponse);

      await service.getPlaceCoordinates('ChIJ_test_001');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'geocode:place:ChIJ_test_001',
        604800,
        expect.any(String),
      );
    });

    it('requests only geometry and formatted_address fields', async () => {
      const service = await buildService();
      mockApiResponse(placeDetailsResponse);

      await service.getPlaceCoordinates('ChIJ_test_001');

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('fields=geometry%2Cformatted_address');
    });
  });

  describe('reverseGeocode', () => {
    it('returns formatted address for valid coordinates', async () => {
      const service = await buildService();
      mockApiResponse(reverseGeocodeResponse);

      const result = await service.reverseGeocode(40.7357, -74.1724);

      expect(result.formattedAddress).toBe('123 Market St, Newark, NJ 07102, USA');
    });

    it('returns fallback address when Google returns no results', async () => {
      const service = await buildService();
      mockApiResponse({ status: 'ZERO_RESULTS', results: [] });

      const result = await service.reverseGeocode(0, 0);

      expect(result.formattedAddress).toBe('Current location');
    });

    it('returns fallback address gracefully when fetch throws', async () => {
      const service = await buildService();
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      const result = await service.reverseGeocode(40.7357, -74.1724);

      expect(result.formattedAddress).toBe('Current location');
    });

    it('caches with 4-decimal precision key', async () => {
      const service = await buildService();
      mockApiResponse(reverseGeocodeResponse);

      await service.reverseGeocode(40.73579, -74.17249);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'geocode:reverse:40.7358:-74.1725',
        3600,
        expect.any(String),
      );
    });

    it('returns cached result without calling API', async () => {
      const service = await buildService();
      const cached = JSON.stringify({ formattedAddress: 'Cached Address' });
      mockRedis.get.mockResolvedValue(cached);

      const result = await service.reverseGeocode(40.7357, -74.1724);

      expect(result.formattedAddress).toBe('Cached Address');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('caches results with 1-hour TTL', async () => {
      const service = await buildService();
      mockApiResponse(reverseGeocodeResponse);

      await service.reverseGeocode(40.7357, -74.1724);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('geocode:reverse:'),
        3600,
        expect.any(String),
      );
    });
  });
});
