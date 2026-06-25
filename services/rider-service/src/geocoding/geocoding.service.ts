import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

// ─── Cache TTLs ───────────────────────────────────────────────────────────────
const AUTOCOMPLETE_TTL = 300;     // 5 min — suggestions change frequently
const PLACE_DETAILS_TTL = 604800; // 7 days — place coordinates are stable
const REVERSE_GEO_TTL = 3600;    // 1 hour

export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceCoordinates {
  lat: number;
  lng: number;
  formattedAddress: string;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://maps.googleapis.com/maps/api';

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.apiKey = config.getOrThrow('GOOGLE_MAPS_API_KEY');
  }

  // ─── Places Autocomplete ─────────────────────────────────────────────────

  async autocomplete(query: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
    if (!query || query.trim().length < 2) return [];

    const cacheKey = `geocode:autocomplete:${query.toLowerCase().trim()}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PlaceSuggestion[];
    }

    const params = new URLSearchParams({
      input: query.trim(),
      key: this.apiKey,
      components: 'country:us',
      types: 'address',
      ...(sessionToken ? { sessiontoken: sessionToken } : {}),
    });

    try {
      const res = await fetch(`${this.baseUrl}/place/autocomplete/json?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as {
        status: string;
        predictions: Array<{
          place_id: string;
          description: string;
          structured_formatting: { main_text: string; secondary_text: string };
        }>;
      };

      if (data.status === 'ZERO_RESULTS') return [];

      if (data.status !== 'OK') {
        this.logger.warn(`Places Autocomplete status: ${data.status} for query: "${query}"`);
        return [];
      }

      const suggestions: PlaceSuggestion[] = data.predictions.map((p) => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting.main_text,
        secondaryText: p.structured_formatting.secondary_text,
      }));

      await this.redis.setex(cacheKey, AUTOCOMPLETE_TTL, JSON.stringify(suggestions));
      return suggestions;
    } catch (err) {
      this.logger.error(`Autocomplete failed for "${query}": ${String(err)}`);
      // Graceful degradation — return empty rather than crash the UI
      return [];
    }
  }

  // ─── Place Details (placeId → coordinates) ────────────────────────────────

  async getPlaceCoordinates(placeId: string): Promise<PlaceCoordinates> {
    if (!placeId) throw new BadRequestException('placeId is required');

    const cacheKey = `geocode:place:${placeId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PlaceCoordinates;
    }

    const params = new URLSearchParams({
      place_id: placeId,
      fields: 'geometry,formatted_address',
      key: this.apiKey,
    });

    try {
      const res = await fetch(`${this.baseUrl}/place/details/json?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as {
        status: string;
        result?: {
          formatted_address: string;
          geometry: { location: { lat: number; lng: number } };
        };
      };

      if (data.status !== 'OK' || !data.result) {
        throw new BadRequestException(`Invalid place ID: ${placeId}`);
      }

      const coords: PlaceCoordinates = {
        lat: data.result.geometry.location.lat,
        lng: data.result.geometry.location.lng,
        formattedAddress: data.result.formatted_address,
      };

      await this.redis.setex(cacheKey, PLACE_DETAILS_TTL, JSON.stringify(coords));
      return coords;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Place details failed for "${placeId}": ${String(err)}`);
      throw new ServiceUnavailableException('Geocoding service unavailable');
    }
  }

  // ─── Reverse Geocoding (coordinates → address) ────────────────────────────

  async reverseGeocode(lat: number, lng: number): Promise<{ formattedAddress: string }> {
    // Round to ~11m precision for cache key
    const latKey = lat.toFixed(4);
    const lngKey = lng.toFixed(4);
    const cacheKey = `geocode:reverse:${latKey}:${lngKey}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as { formattedAddress: string };
    }

    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: this.apiKey,
      result_type: 'street_address|premise',
    });

    try {
      const res = await fetch(`${this.baseUrl}/geocode/json?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as {
        status: string;
        results: Array<{ formatted_address: string }>;
      };

      const formattedAddress =
        data.status === 'OK' && data.results.length > 0
          ? data.results[0].formatted_address
          : 'Current location';

      const result = { formattedAddress };
      await this.redis.setex(cacheKey, REVERSE_GEO_TTL, JSON.stringify(result));
      return result;
    } catch (err) {
      this.logger.error(`Reverse geocode failed for (${lat},${lng}): ${String(err)}`);
      // Graceful fallback — don't block the user flow
      return { formattedAddress: 'Current location' };
    }
  }
}
