import { Injectable, BadRequestException, NotFoundException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const QUEUE_KEY = 'queue:ewr';
const ADVANCE_NOTICE_MINUTES = 10;
const FLIGHT_CACHE_TTL = 30; // seconds

interface FlightArrival {
  flightId: string;
  flightNumber: string;
  airline: string;
  origin: string;
  scheduledArrival: string;
  estimatedArrival: string;
  status: string;
  terminal: string;
  seatCount: number;
}

interface QueueEntry {
  driverId: string;
  position: number;
  joinedAt: string;
  estimatedDispatchMinutes: number | null;
}

@Injectable()
export class AirportService {
  private readonly flightAwareApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.flightAwareApiKey = config.getOrThrow('FLIGHTAWARE_API_KEY');
  }

  // ─── Queue Management ─────────────────────────────────────────────────────

  async joinQueue(driverId: string): Promise<{ position: number; queueLength: number }> {
    const existing = await this.prisma.airportQueueEntry.findFirst({
      where: { driverId, status: 'waiting' },
    });

    if (existing) {
      throw new BadRequestException({ code: 'QUEUE_ALREADY_JOINED', message: 'Already in EWR queue.' });
    }

    // Add to Redis sorted set (score = join timestamp for FIFO ordering)
    const score = Date.now();
    await this.redis.zadd(QUEUE_KEY, score, driverId);

    const position = await this.redis.zrank(QUEUE_KEY, driverId);
    const queueLength = await this.redis.zcard(QUEUE_KEY);

    await this.prisma.airportQueueEntry.create({
      data: {
        driverId,
        queuePosition: (position ?? 0) + 1,
        status: 'waiting',
      },
    });

    return { position: (position ?? 0) + 1, queueLength };
  }

  async leaveQueue(driverId: string): Promise<void> {
    await this.redis.zrem(QUEUE_KEY, driverId);
    await this.prisma.airportQueueEntry.updateMany({
      where: { driverId, status: 'waiting' },
      data: { status: 'left_queue', leftAt: new Date() },
    });
  }

  async getQueuePosition(driverId: string): Promise<QueueEntry | null> {
    const rank = await this.redis.zrank(QUEUE_KEY, driverId);
    if (rank === null) return null;

    const position = rank + 1;
    const demandForecast = await this.getDemandForecast();

    const estimatedDispatch = demandForecast
      ? Math.round((position / demandForecast.requestsPerHour) * 60)
      : null;

    return {
      driverId,
      position,
      joinedAt: new Date().toISOString(),
      estimatedDispatchMinutes: estimatedDispatch,
    };
  }

  async getFullQueue(): Promise<{ driverId: string; position: number; score: number }[]> {
    const members = await this.redis.zrangebyscore(QUEUE_KEY, '-inf', '+inf', 'WITHSCORES');
    const result: { driverId: string; position: number; score: number }[] = [];

    for (let i = 0; i < members.length; i += 2) {
      result.push({
        driverId: members[i],
        position: result.length + 1,
        score: Number(members[i + 1]),
      });
    }

    return result;
  }

  async dispatchNext(tripId: string): Promise<string | null> {
    const next = await this.redis.zpopmin(QUEUE_KEY);
    if (!next || next.length === 0) return null;

    const driverId = next[0];

    await this.prisma.airportQueueEntry.updateMany({
      where: { driverId, status: 'waiting' },
      data: { status: 'dispatched', dispatchedAt: new Date(), tripId },
    });

    return driverId;
  }

  // ─── Flight Data ──────────────────────────────────────────────────────────

  async getUpcomingArrivals(): Promise<FlightArrival[]> {
    const cacheKey = 'flight:ewr:arrivals';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as FlightArrival[];

    try {
      const now = new Date();
      const twoHoursLater = new Date(now.getTime() + 2 * 3600 * 1000);

      const response = await fetch(
        `https://aeroapi.flightaware.com/aeroapi/airports/KEWR/flights/arrivals?start=${now.toISOString()}&end=${twoHoursLater.toISOString()}&type=airline`,
        {
          headers: {
            'x-apikey': this.flightAwareApiKey,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) throw new Error(`FlightAware API error: ${response.status}`);

      const data = await response.json() as { arrivals: any[] };

      const arrivals: FlightArrival[] = (data.arrivals ?? []).map((f: any) => ({
        flightId: f.ident,
        flightNumber: f.ident,
        airline: f.operator ?? 'Unknown',
        origin: f.origin?.code ?? '',
        scheduledArrival: f.scheduled_in,
        estimatedArrival: f.estimated_in ?? f.scheduled_in,
        status: f.status,
        terminal: f.gate_destination?.split('/')?.[0] ?? '',
        seatCount: (f.seats_cabin_first + f.seats_cabin_business + f.seats_cabin_coach) || 150,
      }));

      await this.redis.setex(cacheKey, FLIGHT_CACHE_TTL, JSON.stringify(arrivals));

      // Persist flight data for demand forecasting
      for (const arrival of arrivals) {
        await this.prisma.flightDataCache.upsert({
          where: { flightId: arrival.flightId },
          update: {
            estimatedArrival: new Date(arrival.estimatedArrival),
            status: arrival.status,
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + 3600 * 1000),
          },
          create: {
            flightId: arrival.flightId,
            flightNumber: arrival.flightNumber,
            airline: arrival.airline,
            origin: arrival.origin,
            scheduledArrival: new Date(arrival.scheduledArrival),
            estimatedArrival: new Date(arrival.estimatedArrival),
            status: arrival.status,
            terminal: arrival.terminal,
            seatCount: arrival.seatCount,
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + 3600 * 1000),
          },
        });
      }

      return arrivals;
    } catch (err) {
      console.error('FlightAware fetch failed:', err);
      return [];
    }
  }

  async getDemandForecast(): Promise<{ requestsPerHour: number; confidence: number } | null> {
    const arrivals = await this.getUpcomingArrivals();
    if (arrivals.length === 0) return null;

    // Simple heuristic: 15% of arriving passengers request rideshare
    const nextHourArrivals = arrivals.filter((f) => {
      const arrivalTime = new Date(f.estimatedArrival).getTime();
      const oneHourFromNow = Date.now() + 3600 * 1000;
      return arrivalTime <= oneHourFromNow;
    });

    const totalPassengers = nextHourArrivals.reduce((sum, f) => sum + f.seatCount, 0);
    const estimatedRequests = Math.round(totalPassengers * 0.15);

    return { requestsPerHour: estimatedRequests, confidence: 0.7 };
  }

  async getCurrentSurge(): Promise<{ multiplier: number; adminConfirmedAbove15x: boolean }> {
    const demandForecast = await this.getDemandForecast();
    const queueLength = await this.redis.zcard(QUEUE_KEY);

    if (!demandForecast) return { multiplier: 1.0, adminConfirmedAbove15x: false };

    const demandSupplyRatio = queueLength > 0
      ? (demandForecast.requestsPerHour / queueLength)
      : demandForecast.requestsPerHour;

    const rawMultiplier = Math.min(2.5, 1.0 + (demandSupplyRatio - 1) * 0.3);
    const multiplier = Math.round(rawMultiplier * 10) / 10;

    return {
      multiplier: Math.max(1.0, multiplier),
      adminConfirmedAbove15x: multiplier > 1.5, // must be admin-confirmed above 1.5×
    };
  }
}
