import { geocodingApi } from '../api/geocoding';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

beforeEach(() => jest.clearAllMocks());

function mockResponse(body: unknown, ok = true) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: jest.fn().mockResolvedValue(body),
  });
}

// ─── autocomplete ─────────────────────────────────────────────────────────────

describe('geocodingApi.autocomplete', () => {
  it('calls backend /geocode/autocomplete with query', async () => {
    mockResponse([{ placeId: 'p1', description: '123 Market', mainText: '123 Market', secondaryText: 'Newark' }]);
    const results = await geocodingApi.autocomplete('123 Market');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/geocode/autocomplete');
    expect(url).toContain('query=123+Market');
    expect(results).toHaveLength(1);
    expect(results[0].placeId).toBe('p1');
  });

  it('appends sessionToken when provided', async () => {
    mockResponse([]);
    await geocodingApi.autocomplete('Market', 'tok-abc');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('sessionToken=tok-abc');
  });

  it('returns empty array on HTTP error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    await expect(geocodingApi.autocomplete('Market')).rejects.toThrow();
  });
});

// ─── getPlaceCoordinates ──────────────────────────────────────────────────────

describe('geocodingApi.getPlaceCoordinates', () => {
  it('fetches /geocode/place/:placeId and returns lat/lng/address', async () => {
    mockResponse({ lat: 40.7357, lng: -74.1724, formattedAddress: '123 Market St, Newark, NJ' });
    const result = await geocodingApi.getPlaceCoordinates('ChIJ_test');
    expect(mockFetch.mock.calls[0][0]).toContain('/geocode/place/ChIJ_test');
    expect(result.lat).toBeCloseTo(40.7357);
    expect(result.formattedAddress).toBe('123 Market St, Newark, NJ');
  });

  it('URL-encodes placeId', async () => {
    mockResponse({ lat: 40.7, lng: -74.1, formattedAddress: 'Test' });
    await geocodingApi.getPlaceCoordinates('id/with/slashes');
    expect(mockFetch.mock.calls[0][0]).toContain('id%2Fwith%2Fslashes');
  });
});

// ─── reverseGeocode ───────────────────────────────────────────────────────────

describe('geocodingApi.reverseGeocode', () => {
  it('fetches /geocode/reverse with lat and lng', async () => {
    mockResponse({ formattedAddress: '123 Market St, Newark, NJ' });
    const result = await geocodingApi.reverseGeocode(40.7357, -74.1724);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/geocode/reverse');
    expect(url).toContain('lat=40.7357');
    expect(url).toContain('lng=-74.1724');
    expect(result.formattedAddress).toBe('123 Market St, Newark, NJ');
  });
});
