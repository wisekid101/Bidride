/**
 * Safety Service unit tests.
 * Critical invariants verified:
 *   - SOS countdown can be cancelled within window
 *   - Panic events NEVER include rider identity in the notification payload
 *   - Audio recording is created on SOS confirmation, not initiation
 *   - Night ride check-in is only triggered for night rides
 *   - Spatial deviation is detected after sustained off-route period
 *   - Time overrun detection still works
 *   - Risk score calculation is deterministic
 *   - Moderate risk → check-in, High risk → admin alert
 */

import { SafetyService } from './safety.service';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockPrisma = {
  safetySession: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  sosEvent: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  },
  panicEvent: { create: jest.fn() },
  safetyRecording: { create: jest.fn() },
  safeCheckIn: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  trip: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  tripSafetyScore: {
    findUnique: jest.fn(),
    upsert: jest.fn().mockResolvedValue({}),
  },
  routeDeviationEvent: {
    create: jest.fn().mockResolvedValue({}),
    count: jest.fn().mockResolvedValue(0),
  },
} as any;

const mockRedis = {
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
} as any;

const mockConfig = {
  getOrThrow: jest.fn().mockReturnValue('test-value'),
  get: jest.fn().mockReturnValue('us-east-1'),
} as any;

const mockRouteService = {
  getPolyline: jest.fn().mockResolvedValue([]),
} as any;

// Fresh service per suite (uses new mock state)
function makeService() {
  return new SafetyService(mockPrisma, mockConfig, mockRedis, mockRouteService);
}

const mockSession = { id: 'session-1', tripId: 'trip-1', isNightRide: false, currentState: 'normal', riderId: 'rider-1' };
const mockNightSession = { ...mockSession, isNightRide: true };
const mockUser = { id: 'user-1', role: 'rider' };
const mockSos = {
  id: 'sos-1',
  tripId: 'trip-1',
  safetySessionId: 'session-1',
  initiatedByUserId: 'user-1',
  status: 'active',
  activationConfirmedAt: null,
};

// ─── Core SOS / Panic / CheckIn ──────────────────────────────────────────────

describe('SafetyService — SOS', () => {
  let service: SafetyService;
  beforeEach(() => { service = makeService(); jest.clearAllMocks(); });

  describe('initiateSos', () => {
    it('creates SOS event and publishes to admin channel', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.sosEvent.create.mockResolvedValue({ id: 'sos-1' });
      mockPrisma.safetySession.update.mockResolvedValue({});

      await service.initiateSos('trip-1', 'user-1', 'button_tap', 40.7, -74.0);

      expect(mockPrisma.sosEvent.create).toHaveBeenCalledTimes(1);
      expect(mockRedis.publish).toHaveBeenCalledWith('safety:sos', expect.stringContaining('safety:sos_new'));
    });

    it('throws NotFoundException if session not found', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(null);
      await expect(service.initiateSos('trip-1', 'user-1', 'button_tap', 40.7, -74.0)).rejects.toThrow(NotFoundException);
    });

    it('sets countdown Redis key with 7-second TTL', async () => {
      mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession);
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.sosEvent.create.mockResolvedValue({ id: 'sos-1' });
      mockPrisma.safetySession.update.mockResolvedValue({});

      await service.initiateSos('trip-1', 'user-1', 'button_tap', 40.7, -74.0);

      expect(mockRedis.setex).toHaveBeenCalledWith('sos:countdown:sos-1', 7, 'user-1');
    });
  });

  describe('confirmSos', () => {
    it('creates audio recording on confirmation', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue(mockSos);
      mockPrisma.sosEvent.update.mockResolvedValue({});
      mockPrisma.safetyRecording.create.mockResolvedValue({});
      mockPrisma.trip.findUnique.mockResolvedValue({ rider: { trustedContacts: [] } });

      await service.confirmSos('sos-1', 'user-1');

      expect(mockPrisma.safetyRecording.create).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException if user does not own SOS', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue({ ...mockSos, initiatedByUserId: 'other-user' });
      await expect(service.confirmSos('sos-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancelSos', () => {
    it('cancels SOS during countdown window', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue(mockSos);
      mockPrisma.sosEvent.update.mockResolvedValue({});
      mockPrisma.safetySession.update.mockResolvedValue({});
      mockRedis.exists.mockResolvedValue(1);

      await service.cancelSos('sos-1', 'user-1');

      expect(mockPrisma.sosEvent.update).toHaveBeenCalledWith({
        where: { id: 'sos-1' },
        data: expect.objectContaining({ status: 'false_alarm' }),
      });
    });

    it('resets session state to normal on cancel', async () => {
      mockPrisma.sosEvent.findUnique.mockResolvedValue(mockSos);
      mockPrisma.sosEvent.update.mockResolvedValue({});
      mockPrisma.safetySession.update.mockResolvedValue({});
      mockRedis.exists.mockResolvedValue(1);

      await service.cancelSos('sos-1', 'user-1');

      expect(mockPrisma.safetySession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { currentState: 'normal' },
      });
    });
  });
});

describe('SafetyService — Panic (CRITICAL: rider identity must NOT be in notification)', () => {
  let service: SafetyService;
  beforeEach(() => { service = makeService(); jest.clearAllMocks(); });

  it('publishes panic without rider identity in payload', async () => {
    mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession);
    mockPrisma.panicEvent.create.mockResolvedValue({ id: 'panic-1' });
    mockPrisma.safetySession.update.mockResolvedValue({});

    await service.triggerPanic('trip-1', 'user-1', 'rider', 40.7, -74.0);

    const payload = JSON.parse(mockRedis.publish.mock.calls[0][1]);
    expect(payload).not.toHaveProperty('riderId');
    expect(payload).not.toHaveProperty('riderName');
    expect(payload).not.toHaveProperty('riderPhone');
    expect(payload).toHaveProperty('tripId');
    expect(payload).toHaveProperty('initiatedByRole');
  });
});

describe('SafetyService — CheckIn', () => {
  let service: SafetyService;
  beforeEach(() => { service = makeService(); jest.clearAllMocks(); });

  it('skips check-in for non-night rides', async () => {
    mockPrisma.safetySession.findUnique.mockResolvedValue(mockSession);
    const result = await service.requestCheckIn('trip-1', 'rider-1');
    expect(result).toEqual({ skipped: true, reason: 'Not a night ride.' });
    expect(mockPrisma.safeCheckIn.create).not.toHaveBeenCalled();
  });

  it('creates check-in for night rides', async () => {
    mockPrisma.safetySession.findUnique.mockResolvedValue(mockNightSession);
    mockPrisma.safeCheckIn.create.mockResolvedValue({ id: 'checkin-1', dueAt: new Date() });

    const result = await service.requestCheckIn('trip-1', 'rider-1');

    expect(mockPrisma.safeCheckIn.create).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('checkInId');
  });
});

// ─── Route Anomaly Detection (time overrun) ───────────────────────────────────

describe('SafetyService — checkRouteAnomaly (time overrun)', () => {
  let service: SafetyService;
  beforeEach(() => {
    service = makeService();
    jest.clearAllMocks();
    mockRouteService.getPolyline.mockResolvedValue([]); // No polyline — spatial check skipped
  });

  it('returns early when trip does not exist', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue(null);
    await service.checkRouteAnomaly('trip-x', 40.7, -74.1);
    expect(mockPrisma.trip.update).not.toHaveBeenCalled();
  });

  it('returns early when trip has no startedAt', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue({
      dropoffLat: 40.8, dropoffLng: -74.2, startedAt: null, estimatedDurationMin: 20, routeDeviationCount: 0,
    });
    await service.checkRouteAnomaly('trip-1', 40.7, -74.1);
    expect(mockPrisma.trip.update).not.toHaveBeenCalled();
  });

  it('does not flag anomaly when within time threshold', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue({
      dropoffLat: 40.8, dropoffLng: -74.2,
      startedAt: new Date(Date.now() - 10 * 60000),
      estimatedDurationMin: 20,
      routeDeviationCount: 0,
    });
    await service.checkRouteAnomaly('trip-1', 40.7, -74.1);
    expect(mockPrisma.trip.update).not.toHaveBeenCalled();
  });

  it('increments routeDeviationCount and publishes anomaly when time overrun > 15 min', async () => {
    mockPrisma.trip.findUnique.mockResolvedValue({
      dropoffLat: 40.8, dropoffLng: -74.2,
      startedAt: new Date(Date.now() - 50 * 60000), // 50 min elapsed
      estimatedDurationMin: 20,                      // expected 20 → deviation 30 > 15
      routeDeviationCount: 0,
    });
    mockPrisma.trip.update.mockResolvedValue({});
    mockPrisma.tripSafetyScore.findUnique.mockResolvedValue({ riskLevel: 'low' });

    await service.checkRouteAnomaly('trip-1', 40.7, -74.1);

    expect(mockPrisma.trip.update).toHaveBeenCalledWith({
      where: { id: 'trip-1' },
      data: { routeDeviationCount: { increment: 1 } },
    });
    expect(mockRedis.publish).toHaveBeenCalledWith('safety:anomaly', expect.stringContaining('"type":"time_overrun"'));
  });
});

// ─── Spatial Deviation Detection ─────────────────────────────────────────────

describe('SafetyService — checkRouteAnomaly (spatial deviation)', () => {
  let service: SafetyService;

  beforeEach(() => {
    service = makeService();
    jest.clearAllMocks();
    mockPrisma.trip.findUnique.mockResolvedValue({
      dropoffLat: 40.8, dropoffLng: -74.2,
      startedAt: new Date(Date.now() - 5 * 60000), // 5 min, no time overrun
      estimatedDurationMin: 30,
      routeDeviationCount: 0,
    });
    mockPrisma.trip.update.mockResolvedValue({});
    mockPrisma.tripSafetyScore.findUnique.mockResolvedValue({ riskLevel: 'low' });
  });

  it('does NOT flag spatial deviation when driver is on route', async () => {
    // Polyline along Newark; driver is exactly on it
    mockRouteService.getPolyline.mockResolvedValue([
      { lat: 40.7357, lng: -74.1724 },
      { lat: 40.7400, lng: -74.1800 },
    ]);
    await service.checkRouteAnomaly('trip-1', 40.7357, -74.1724);
    // No off-route timer should be set
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('starts off-route timer on first detection > 0.5 miles from route', async () => {
    // Polyline at Newark airport; driver is far away (Manhattan area)
    mockRouteService.getPolyline.mockResolvedValue([
      { lat: 40.6925, lng: -74.1687 }, // EWR
      { lat: 40.7000, lng: -74.1700 },
    ]);
    mockRedis.get.mockResolvedValue(null); // No prior timer

    // Driver at 40.7580 (far north — ~5 miles off)
    await service.checkRouteAnomaly('trip-1', 40.7580, -74.0060);

    expect(mockRedis.set).toHaveBeenCalledWith(
      'trip:trip-1:off_route_since',
      expect.any(String),
      'EX',
      600,
    );
    // No deviation event yet — need 2 min sustained
    expect(mockPrisma.trip.update).not.toHaveBeenCalled();
  });

  it('fires deviation event after 2+ minutes sustained off-route', async () => {
    mockRouteService.getPolyline.mockResolvedValue([
      { lat: 40.6925, lng: -74.1687 },
      { lat: 40.7000, lng: -74.1700 },
    ]);
    // Simulate off-route since 3 minutes ago
    mockRedis.get.mockResolvedValue(String(Date.now() - 3 * 60 * 1000));

    await service.checkRouteAnomaly('trip-1', 40.7580, -74.0060);

    expect(mockPrisma.trip.update).toHaveBeenCalledWith({
      where: { id: 'trip-1' },
      data: { routeDeviationCount: { increment: 1 } },
    });
  });

  it('clears off-route timer when driver returns to route', async () => {
    mockRouteService.getPolyline.mockResolvedValue([
      { lat: 40.7357, lng: -74.1724 },
      { lat: 40.7400, lng: -74.1800 },
    ]);
    mockRedis.get.mockResolvedValue(String(Date.now() - 60000)); // Was off-route 1 min ago

    // Driver is now back on route (same coords as polyline start)
    await service.checkRouteAnomaly('trip-1', 40.7357, -74.1724);

    expect(mockRedis.del).toHaveBeenCalledWith('trip:trip-1:off_route_since');
  });

  it('does NOT fire deviation event if off-route for less than 2 minutes', async () => {
    mockRouteService.getPolyline.mockResolvedValue([
      { lat: 40.6925, lng: -74.1687 },
      { lat: 40.7000, lng: -74.1700 },
    ]);
    // Only 90 seconds off-route (< 2 minutes)
    mockRedis.get.mockResolvedValue(String(Date.now() - 90 * 1000));

    await service.checkRouteAnomaly('trip-1', 40.7580, -74.0060);

    expect(mockPrisma.trip.update).not.toHaveBeenCalled();
  });
});

// ─── Safety Risk Scoring ──────────────────────────────────────────────────────

describe('SafetyService — computeAndStoreSafetyScore', () => {
  let service: SafetyService;
  beforeEach(() => {
    service = makeService();
    jest.clearAllMocks();
    mockPrisma.routeDeviationEvent.count.mockResolvedValue(0);
    mockPrisma.sosEvent.count.mockResolvedValue(0);
  });

  it('returns low risk for a standard daytime short trip', async () => {
    const result = await service.computeAndStoreSafetyScore('trip-1', {
      isNightRide: false,
      isAirportTrip: false,
      distanceMiles: 3,
    });
    expect(result.riskLevel).toBe('low');
    expect(result.score).toBeLessThan(25);
  });

  it('returns moderate risk for a night ride', async () => {
    const result = await service.computeAndStoreSafetyScore('trip-1', {
      isNightRide: true,
      isAirportTrip: false,
      distanceMiles: 3,
    });
    expect(result.riskLevel).toBe('moderate');
    expect(result.factors).toContain('night_ride');
  });

  it('returns high risk for night ride + long distance + airport', async () => {
    const result = await service.computeAndStoreSafetyScore('trip-1', {
      isNightRide: true,
      isAirportTrip: true,
      distanceMiles: 25,
    });
    expect(result.riskLevel).toBe('high');
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.factors).toContain('night_ride');
    expect(result.factors).toContain('airport_trip');
    expect(result.factors).toContain('long_distance');
  });

  it('includes prior_deviation factor when driver has repeat deviations', async () => {
    mockPrisma.trip.findMany.mockResolvedValue([{ id: 'trip-a' }, { id: 'trip-b' }]);
    mockPrisma.routeDeviationEvent.count.mockResolvedValue(3);
    mockPrisma.sosEvent.count.mockResolvedValue(0);
    const result = await service.computeAndStoreSafetyScore('trip-1', {
      isNightRide: false,
      isAirportTrip: false,
      distanceMiles: 5,
      driverUserId: 'driver-1',
    });
    expect(result.factors).toContain('repeat_deviations');
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('always stores result via upsert (fire-and-forget)', async () => {
    await service.computeAndStoreSafetyScore('trip-1', {
      isNightRide: false, isAirportTrip: false, distanceMiles: 5,
    });
    // upsert is fire-and-forget; flush microtasks
    await new Promise((r) => setTimeout(r, 0));
    expect(mockPrisma.tripSafetyScore.upsert).toHaveBeenCalledTimes(1);
  });
});

// ─── Escalation Logic ─────────────────────────────────────────────────────────

describe('SafetyService — escalation on deviation', () => {
  let service: SafetyService;

  beforeEach(() => {
    service = makeService();
    jest.clearAllMocks();
    mockPrisma.trip.findUnique.mockResolvedValue({
      dropoffLat: 40.8, dropoffLng: -74.2,
      startedAt: new Date(Date.now() - 50 * 60000),
      estimatedDurationMin: 20,
      routeDeviationCount: 0,
    });
    mockPrisma.trip.update.mockResolvedValue({});
    mockRouteService.getPolyline.mockResolvedValue([]); // Only time overrun fires
  });

  it('publishes safety:anomaly (no escalation) for low risk deviation', async () => {
    mockPrisma.tripSafetyScore.findUnique.mockResolvedValue({ riskLevel: 'low' });

    await service.checkRouteAnomaly('trip-1', 40.7, -74.1);

    const publishCalls = mockRedis.publish.mock.calls;
    const anomalyCalls = publishCalls.filter(([ch]: string[]) => ch === 'safety:anomaly');
    expect(anomalyCalls.length).toBeGreaterThan(0);
    // No check-in or admin alert
    const notifCalls = publishCalls.filter(([ch]: string[]) => ch === 'notifications');
    expect(notifCalls.length).toBe(0);
  });

  it('sends check-in request for moderate risk deviation', async () => {
    mockPrisma.tripSafetyScore.findUnique.mockResolvedValue({ riskLevel: 'moderate' });
    mockPrisma.safetySession.findUnique.mockResolvedValue({ id: 'sess-1', riderId: 'rider-1', isNightRide: false });
    mockPrisma.safeCheckIn.create.mockResolvedValue({ id: 'checkin-1', dueAt: new Date() });

    await service.checkRouteAnomaly('trip-1', 40.7, -74.1);
    await new Promise((r) => setTimeout(r, 0)); // flush fire-and-forget

    // Should have fired check-in creation
    expect(mockPrisma.safeCheckIn.create).toHaveBeenCalledTimes(1);
  });

  it('publishes high-risk admin alert for high risk deviation', async () => {
    mockPrisma.tripSafetyScore.findUnique.mockResolvedValue({ riskLevel: 'high' });

    await service.checkRouteAnomaly('trip-1', 40.7, -74.1);

    const highRiskPublish = mockRedis.publish.mock.calls.find(
      ([_ch, msg]: string[]) => msg.includes('high_risk_deviation'),
    );
    expect(highRiskPublish).toBeDefined();
    expect(JSON.parse(highRiskPublish![1])).toMatchObject({ riskLevel: 'high' });
  });

  it('writes RouteDeviationEvent to DB with escalation metadata', async () => {
    mockPrisma.tripSafetyScore.findUnique.mockResolvedValue({ riskLevel: 'high' });

    await service.checkRouteAnomaly('trip-1', 40.7, -74.1);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockPrisma.routeDeviationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tripId: 'trip-1',
          type: 'time_overrun',
          riskLevel: 'high',
          escalated: true,
          escalationType: 'admin_alert',
        }),
      }),
    );
  });
});
