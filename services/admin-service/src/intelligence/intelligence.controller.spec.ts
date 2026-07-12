import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { FounderGuard } from '../auth/founder.guard';
import { IntelligenceController } from './intelligence.controller';

// ─── FounderGuard ─────────────────────────────────────────────────────────────

const ctxWithRole = (role?: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ adminUser: role ? { role } : undefined }) }) }) as any;

describe('FounderGuard', () => {
  const guard = new FounderGuard();

  it('allows the founder', () => {
    expect(guard.canActivate(ctxWithRole('founder'))).toBe(true);
  });

  it('rejects every other admin role', () => {
    for (const role of ['super_admin', 'operations_admin', 'fraud_admin', 'support_admin', 'analytics_admin']) {
      expect(() => guard.canActivate(ctxWithRole(role))).toThrow(ForbiddenException);
    }
  });

  it('rejects unauthenticated requests', () => {
    expect(() => guard.canActivate(ctxWithRole(undefined))).toThrow(ForbiddenException);
  });
});

// ─── IntelligenceController proxy ─────────────────────────────────────────────

const mockAudit = { createLog: jest.fn().mockResolvedValue(undefined) } as any;
const controller = new IntelligenceController(mockAudit);

const founderReq = { adminUser: { sub: 'admin-1', email: 'marq@bidride.com', role: 'founder' }, ip: '127.0.0.1' };
const ID = '11111111-2222-4333-8444-555555555555';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const upstreamOk = (body: unknown) =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
  upstreamOk({ ok: true });
});

afterAll(() => {
  delete process.env.INTERNAL_SERVICE_KEY;
});

describe('IntelligenceController — upstream proxying', () => {
  it('forwards the internal service key to ai-service', async () => {
    await controller.briefs();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/ai/founder/briefs');
    expect(init.headers['x-internal-key']).toBe('test-internal-key');
  });

  it('rejects unknown brief types before anything reaches upstream', () => {
    expect(() => controller.brief('drop_table', undefined)).toThrow(BadGatewayException);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes only allowlisted, validated filters to the ledger', async () => {
    await controller.list({ domain: 'opportunity', status: 'proposed', page: 2, limit: 10 } as any);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toContain('domain=opportunity');
    expect(url).toContain('status=proposed');
    expect(url).toContain('page=2');
  });

  it('passes upstream client errors through with their REAL status, message only', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'Recommendation rejected', errors: ['x'], stack: 'SECRET INTERNALS' }) });
    try {
      await controller.get(ID);
      fail('should have thrown');
    } catch (e) {
      const http = e as import('@nestjs/common').HttpException;
      expect(http.getStatus()).toBe(422);
      const resp = http.getResponse() as Record<string, unknown>;
      expect(resp.message).toBe('Recommendation rejected');
      expect(JSON.stringify(resp)).not.toContain('SECRET INTERNALS');
    }
  });

  it('collapses upstream 5xx to 502', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ message: 'boom' }) });
    await expect(controller.get(ID)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('maps upstream unreachability to 502 without leaking details', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5'));
    try {
      await controller.briefs();
      fail('should have thrown');
    } catch (e) {
      expect(JSON.stringify((e as BadGatewayException).getResponse())).not.toContain('10.0.0.5');
    }
  });
});

describe('IntelligenceController — decisions record, audit, and never execute', () => {
  it('adopt forwards the Founder identity + reason and writes an audit log', async () => {
    await controller.adopt(ID, { reason: 'Assigning ops to review the zone.' } as any, founderReq);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain(`/ai/recommendations/${ID}/adopt`);
    expect(JSON.parse(init.body)).toEqual({
      actor: 'marq@bidride.com',
      actorRole: 'founder',
      reason: 'Assigning ops to review the zone.',
    });
    expect(mockAudit.createLog).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        action: 'intelligence.recommendation.adopt',
        targetType: 'ai_recommendation',
        targetId: ID,
        metadata: { reason: 'Assigning ops to review the zone.' },
      }),
    );
  });

  it('dismiss audits with its reason', async () => {
    await controller.dismiss(ID, { reason: 'Not a priority this week.' } as any, founderReq);
    expect(mockAudit.createLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'intelligence.recommendation.dismiss' }),
    );
  });

  it('audit failure never blocks the decision (ledger events are authoritative)', async () => {
    mockAudit.createLog.mockRejectedValueOnce(new Error('audit db down'));
    await expect(controller.view(ID, founderReq)).resolves.toEqual({ ok: true });
  });

  it('the controller has no route that executes product changes', () => {
    const members = Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).sort();
    expect(members).toEqual(
      ['actor', 'adopt', 'auditDecision', 'brief', 'briefs', 'constructor', 'dismiss', 'generateOpportunity', 'get', 'list', 'upstream', 'view'].sort(),
    );
  });
});
