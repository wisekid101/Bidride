import { WebSocketEventGateway } from './websocket.gateway';
import { JwtService } from '@nestjs/jwt';

const mockJwt = {
  verify: jest.fn(),
} as unknown as JwtService;

const mockRedis = {
  duplicate: jest.fn().mockReturnValue({
    subscribe: jest.fn(),
    psubscribe: jest.fn(),
    on: jest.fn(),
  }),
  setex: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  sadd: jest.fn().mockResolvedValue(1),
  publish: jest.fn().mockResolvedValue(1),
} as any;

const mockPrisma = {
  driverSessionLog: {
    create: jest.fn().mockResolvedValue({ id: 'log-1', startedAt: new Date() }),
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
} as any;

function makeSocket(overrides: Partial<{ data: Record<string, unknown>; handshake: unknown; id: string }> = {}) {
  return {
    id: 'socket-1',
    data: {},
    handshake: { auth: { token: 'valid-token' } },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  } as any;
}

let gateway: WebSocketEventGateway;

beforeEach(() => {
  jest.clearAllMocks();
  // Reset subscriber mock so duplicate() always returns a fresh stub
  mockRedis.duplicate.mockReturnValue({
    subscribe: jest.fn(),
    psubscribe: jest.fn(),
    on: jest.fn(),
  });
  gateway = new WebSocketEventGateway(mockJwt, mockRedis, mockPrisma);
  // @ts-expect-error — server is set by NestJS WebSocket decorator, stub it
  gateway.server = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
});

// ─── Session logging ──────────────────────────────────────────────────────────

describe('WebSocketEventGateway — driver session logging', () => {
  it('creates a DriverSessionLog record when a driver connects', async () => {
    mockJwt.verify = jest.fn().mockReturnValue({ sub: 'u-driver-1', role: 'driver' });

    const socket = makeSocket();
    await gateway.handleConnection(socket);

    // Allow fire-and-forget to settle
    await new Promise(setImmediate);

    expect(mockPrisma.driverSessionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { driverUserId: 'u-driver-1' } }),
    );
    expect(mockRedis.setex).toHaveBeenCalledWith(
      'driver:u-driver-1:session_log_id',
      86400,
      'log-1',
    );
  });

  it('does NOT create a session log when a rider connects', async () => {
    mockJwt.verify = jest.fn().mockReturnValue({ sub: 'u-rider-1', role: 'rider' });

    const socket = makeSocket();
    await gateway.handleConnection(socket);

    await new Promise(setImmediate);

    expect(mockPrisma.driverSessionLog.create).not.toHaveBeenCalled();
  });

  it('closes the session log with endedAt + durationSec when a driver disconnects', async () => {
    const startedAt = new Date(Date.now() - 5000); // 5 seconds ago
    mockRedis.get.mockImplementation((key: string) => {
      if (key === 'driver:u-driver-1:session_log_id') return Promise.resolve('log-1');
      if (key === 'driver:u-driver-1:zone') return Promise.resolve(null);
      return Promise.resolve(null);
    });
    mockPrisma.driverSessionLog.findUnique.mockResolvedValue({ id: 'log-1', startedAt });

    const socket = makeSocket({ data: { userId: 'u-driver-1', role: 'driver' } });
    gateway.handleDisconnect(socket);

    await new Promise(setImmediate);

    expect(mockPrisma.driverSessionLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'log-1' },
        data: expect.objectContaining({ durationSec: expect.any(Number) }),
      }),
    );
  });

  it('removes driver from surge:drivers:{zone} on disconnect', async () => {
    mockRedis.get.mockImplementation((key: string) => {
      if (key === 'driver:u-driver-1:session_log_id') return Promise.resolve(null);
      if (key === 'driver:u-driver-1:zone') return Promise.resolve('2261:-3368');
      return Promise.resolve(null);
    });

    const socket = makeSocket({ data: { userId: 'u-driver-1', role: 'driver' } });
    gateway.handleDisconnect(socket);

    await new Promise(setImmediate);

    expect(mockRedis.srem).toHaveBeenCalledWith('surge:drivers:2261:-3368', 'u-driver-1');
    expect(mockRedis.del).toHaveBeenCalledWith('driver:u-driver-1:zone');
  });
});
