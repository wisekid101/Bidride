import { SchedulerService, DEFAULT_JOBS } from './scheduler.service';
import { RetentionService } from '../retention/retention.service';
import { RecommendationLedgerService } from '../recommendations/recommendation-ledger.service';

const mockPrisma = {
  platformConfig: { findUnique: jest.fn(), upsert: jest.fn() },
  aiBrief: { findFirst: jest.fn() },
} as any;

const mockRedis = { set: jest.fn() } as any;

const mockFounder = { generate: jest.fn().mockResolvedValue({ briefType: 'money_map', sections: [] }) } as any;
const mockOpportunity = { generate: jest.fn().mockResolvedValue({ id: 'r1', kind: 'supply_shortage', zone: 'z' }) } as any;
const mockOutcomes = { snapshotDue: jest.fn().mockResolvedValue({ snapshotted: 1, skipped: 0 }) } as any;
const mockLedger = { expireSweep: jest.fn().mockResolvedValue({ expired: 2 }) } as any;
const mockRetention = {
  loadConfig: jest.fn().mockResolvedValue({ scheduleEnabled: true }),
  run: jest.fn().mockResolvedValue({ tables: [] }),
} as any;

// null = explicitly no Redis client (undefined would trigger the default arg)
const makeService = (redis: any = mockRedis) =>
  new SchedulerService(mockPrisma, mockFounder, mockOpportunity, mockOutcomes, mockLedger, mockRetention, redis ?? undefined);

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
  mockPrisma.platformConfig.upsert.mockResolvedValue({});
  mockPrisma.aiBrief.findFirst.mockResolvedValue(null); // no briefs → everything due
  mockRedis.set.mockResolvedValue('OK'); // lock acquired by default
  mockFounder.generate.mockResolvedValue({ briefType: 'money_map', sections: [] });
});

describe('Scheduler — Redis leader lock', () => {
  it('acquires the lock with SET NX PX and runs the job', async () => {
    const service = makeService();
    const result = await service.runNow('expire_sweep');

    expect(mockRedis.set).toHaveBeenCalledWith(
      'ai:scheduler:lock:expire_sweep', service.instanceId, 'PX', DEFAULT_JOBS.expire_sweep.lockTtlMs, 'NX',
    );
    expect(result.action).toBe('ran');
    expect(mockLedger.expireSweep).toHaveBeenCalledTimes(1);
  });

  it('a held lock means this replica SKIPS — one runner per job', async () => {
    mockRedis.set.mockResolvedValue(null); // NX failed: another replica holds it
    const service = makeService();

    const result = await service.runNow('expire_sweep');

    expect(result.action).toBe('skipped_lock_held');
    expect(mockLedger.expireSweep).not.toHaveBeenCalled();
  });

  it('Redis failure causes a SAFE SKIP — never duplicate execution', async () => {
    mockRedis.set.mockRejectedValue(new Error('redis down'));
    const service = makeService();

    const result = await service.runNow('retention');

    expect(result.action).toBe('skipped_redis_unavailable');
    expect(mockRetention.run).not.toHaveBeenCalled();
  });

  it('no Redis client at all → every job skips safely', async () => {
    const service = makeService(null);
    const results = await service.tick(new Date());
    expect(results.every((r) => r.action === 'skipped_redis_unavailable')).toBe(true);
  });

  it('lock TTLs are validated: below the floor or above the interval falls back to defaults', async () => {
    mockPrisma.platformConfig.findUnique.mockResolvedValue({
      value: { retention: { lockTtlMs: 5 }, expire_sweep: { lockTtlMs: 999_999_999 } },
    });
    const service = makeService();
    const jobs = await service.loadJobs();
    expect(jobs.retention.lockTtlMs).toBe(DEFAULT_JOBS.retention.lockTtlMs);
    expect(jobs.expire_sweep.lockTtlMs).toBe(DEFAULT_JOBS.expire_sweep.lockTtlMs);
  });
});

describe('Scheduler — dueness and duplicate prevention', () => {
  it('skips a brief that is fresher than its interval', async () => {
    mockPrisma.aiBrief.findFirst.mockResolvedValue({ generatedAt: new Date(Date.now() - 60_000) });
    const service = makeService();

    const results = await service.tick(new Date());
    const briefResult = results.find((r) => r.job === 'money_map')!;
    expect(briefResult.action).toBe('skipped_not_due');
    expect(mockFounder.generate).not.toHaveBeenCalled();
  });

  it('re-verifies dueness AFTER winning the lock (race belt): a just-completed run is not repeated', async () => {
    // money_map: due on the first check, fresh on the re-check inside the
    // lock (another replica just completed it); all other briefs stay fresh.
    let moneyMapChecks = 0;
    mockPrisma.aiBrief.findFirst.mockImplementation(async (args: any) => {
      if (args.where.briefType === 'money_map') {
        moneyMapChecks += 1;
        return moneyMapChecks === 1 ? null : { generatedAt: new Date() };
      }
      return { generatedAt: new Date() };
    });
    const service = makeService();

    const results = await service.tick(new Date());
    const briefResult = results.find((r) => r.job === 'money_map')!;
    expect(briefResult.action).toBe('skipped_not_due');
    expect(moneyMapChecks).toBe(2); // due-check + post-lock re-check
    expect(mockFounder.generate).not.toHaveBeenCalled();
  });

  it('task jobs record their last run in scheduler state (single writer via lock)', async () => {
    const service = makeService();
    await service.runNow('outcome_snapshots');

    const upsert = mockPrisma.platformConfig.upsert.mock.calls[0][0];
    expect(upsert.where.key).toBe('ai_scheduler_state');
    expect(Object.keys(upsert.create.value)).toContain('outcome_snapshots');
  });
});

describe('Scheduler — job isolation and observability', () => {
  it('one failing job never stops the others', async () => {
    mockFounder.generate.mockRejectedValue(new Error('brief exploded'));
    const service = makeService();

    const results = await service.tick(new Date());

    const failed = results.filter((r) => r.action === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(results.find((r) => r.job === 'expire_sweep')!.action).toBe('ran');
    expect(results.find((r) => r.job === 'retention')!.action).toBe('ran');
  });

  it('records durations and outcomes per job for observability', async () => {
    const service = makeService();
    await service.runNow('retention');

    const last = service.lastResults.get('retention')!;
    expect(last.action).toBe('ran');
    expect(last.durationMs).toBeGreaterThanOrEqual(0);
    expect(last.detail).toContain('retention');
  });

  it('retention honors its own scheduleEnabled config', async () => {
    mockRetention.loadConfig.mockResolvedValue({ scheduleEnabled: false });
    const service = makeService();

    const result = await service.runNow('retention');
    expect(result.action).toBe('ran');
    expect(result.detail).toContain('disabled by config');
    expect(mockRetention.run).not.toHaveBeenCalled();
  });
});

describe('Scheduler — schedule configuration validation', () => {
  it('applies config overrides and rejects nonsense values with safe fallbacks', async () => {
    mockPrisma.platformConfig.findUnique.mockResolvedValue({
      value: {
        focus: { intervalMin: 20_160, slaMin: 20_280 },      // valid override: biweekly
        money_map: { intervalMin: -5 },                       // nonsense → default
        made_up_job: { intervalMin: 1 },                      // unknown job → ignored
      },
    });
    const service = makeService();
    const jobs = await service.loadJobs();

    expect(jobs.focus.intervalMin).toBe(20_160);
    expect(jobs.money_map.intervalMin).toBe(DEFAULT_JOBS.money_map.intervalMin);
    expect(jobs.made_up_job).toBeUndefined();
  });

  it('SLA can never undercut the interval', async () => {
    mockPrisma.platformConfig.findUnique.mockResolvedValue({
      value: { marketplace_health: { intervalMin: 1440, slaMin: 10 } },
    });
    const service = makeService();
    const jobs = await service.loadJobs();
    expect(jobs.marketplace_health.slaMin).toBe(1560);
  });

  it('exposes per-brief freshness SLAs for the read-only GET endpoints', async () => {
    const service = makeService();
    expect(await service.slaMinutesFor('focus')).toBe(DEFAULT_JOBS.focus.slaMin);
    expect(await service.slaMinutesFor('money_map')).toBe(DEFAULT_JOBS.money_map.slaMin);
  });

  it('manual triggers use the same implementation as scheduled runs', async () => {
    const service = makeService();
    await service.runNow('opportunity');
    expect(mockOpportunity.generate).toHaveBeenCalledTimes(1); // the one shared implementation
  });

  it('rejects unknown jobs on manual trigger', async () => {
    const service = makeService();
    await expect(service.runNow('rm -rf')).rejects.toThrow(/Unknown scheduler job/);
  });
});

describe('Scheduler — old per-replica timers are gone', () => {
  it('RetentionService no longer schedules itself', () => {
    expect((RetentionService.prototype as any).onModuleInit).toBeUndefined();
  });

  it('RecommendationLedgerService no longer schedules itself', () => {
    expect((RecommendationLedgerService.prototype as any).onModuleInit).toBeUndefined();
  });
});
