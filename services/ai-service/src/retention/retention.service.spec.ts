import { RetentionService, DEFAULT_RETENTION_CONFIG } from './retention.service';

const mockPrisma = {
  platformConfig: { findUnique: jest.fn(), upsert: jest.fn() },
  aiPricingLog: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  aiInferenceLog: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  bidOutcome: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  aiRecommendation: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  aiBrief: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  // Canonical tables deliberately present to prove they are never touched:
  trip: { deleteMany: jest.fn() },
  payment: { deleteMany: jest.fn() },
  tripEvent: { deleteMany: jest.fn() },
} as any;

const service = new RetentionService(mockPrisma);
const TABLES = ['aiPricingLog', 'aiInferenceLog', 'bidOutcome', 'aiRecommendation', 'aiBrief'] as const;

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
  mockPrisma.platformConfig.upsert.mockResolvedValue({});
  for (const t of TABLES) {
    mockPrisma[t].count.mockResolvedValue(0);
    mockPrisma[t].findMany.mockResolvedValue([]);
    mockPrisma[t].deleteMany.mockResolvedValue({ count: 0 });
  }
});

describe('RetentionService — configuration', () => {
  it('uses safe defaults when no config exists', async () => {
    expect(await service.loadConfig()).toEqual(DEFAULT_RETENTION_CONFIG);
  });

  it('merges platform_config overrides', async () => {
    mockPrisma.platformConfig.findUnique.mockResolvedValue({ value: { aiPricingLogsDays: 90, batchSize: 500 } });
    const cfg = await service.loadConfig();
    expect(cfg.aiPricingLogsDays).toBe(90);
    expect(cfg.batchSize).toBe(500);
    expect(cfg.aiInferenceLogsDays).toBe(365);
  });

  it('refuses accidental sub-30-day retention and absurd batch sizes', async () => {
    mockPrisma.platformConfig.findUnique.mockResolvedValue({ value: { aiPricingLogsDays: 1, batchSize: 999999 } });
    const cfg = await service.loadConfig();
    expect(cfg.aiPricingLogsDays).toBe(365);
    expect(cfg.batchSize).toBe(1000);
  });

  it('falls back to defaults when config is unreadable', async () => {
    mockPrisma.platformConfig.findUnique.mockRejectedValue(new Error('db down'));
    expect(await service.loadConfig()).toEqual(DEFAULT_RETENTION_CONFIG);
  });
});

describe('RetentionService — dry run', () => {
  it('counts eligible rows but deletes NOTHING', async () => {
    mockPrisma.aiPricingLog.count.mockResolvedValue(42);

    const summary = await service.run(true);

    expect(summary.dryRun).toBe(true);
    expect(summary.tables.find((t) => t.table === 'ai_pricing_logs')).toMatchObject({ eligible: 42, deleted: 0 });
    for (const t of TABLES) expect(mockPrisma[t].deleteMany).not.toHaveBeenCalled();
  });
});

describe('RetentionService — deletion', () => {
  it('deletes in batches until the table is swept', async () => {
    mockPrisma.aiInferenceLog.count.mockResolvedValue(3);
    mockPrisma.aiInferenceLog.findMany
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
      .mockResolvedValueOnce([{ id: 'c' }])
      .mockResolvedValue([]);
    mockPrisma.aiInferenceLog.deleteMany
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });
    mockPrisma.platformConfig.findUnique.mockResolvedValue({ value: { batchSize: 2 } });

    const summary = await service.run(false);

    const row = summary.tables.find((t) => t.table === 'ai_inference_logs')!;
    expect(row).toMatchObject({ eligible: 3, deleted: 3, batches: 2 });
  });

  it('ledger sweep deletes ONLY undecided expired rows — adopted, dismissed, and outcome rows are Founder memory', async () => {
    mockPrisma.aiRecommendation.count.mockResolvedValue(1);
    mockPrisma.aiRecommendation.findMany.mockResolvedValueOnce([{ id: 'r1' }]).mockResolvedValue([]);
    mockPrisma.aiRecommendation.deleteMany.mockResolvedValueOnce({ count: 1 });

    await service.run(false);

    const countWhere = mockPrisma.aiRecommendation.count.mock.calls[0][0].where;
    expect(countWhere.status.in).toEqual(['expired']);
    const findWhere = mockPrisma.aiRecommendation.findMany.mock.calls[0][0].where;
    expect(findWhere.status.in).toEqual(['expired']);
  });

  it('NEVER touches canonical financial, trip, payment, or event tables', async () => {
    mockPrisma.aiPricingLog.count.mockResolvedValue(10);
    mockPrisma.aiPricingLog.findMany.mockResolvedValueOnce([{ id: 'x' }]).mockResolvedValue([]);
    mockPrisma.aiPricingLog.deleteMany.mockResolvedValue({ count: 1 });

    await service.run(false);

    expect(mockPrisma.trip.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.payment.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.tripEvent.deleteMany).not.toHaveBeenCalled();
  });

  it('a failure in one table does not block the others (failure recovery)', async () => {
    mockPrisma.aiPricingLog.count.mockRejectedValue(new Error('boom'));
    mockPrisma.aiBrief.count.mockResolvedValue(2);
    mockPrisma.aiBrief.findMany.mockResolvedValueOnce([{ id: 'b1' }, { id: 'b2' }]).mockResolvedValue([]);
    mockPrisma.aiBrief.deleteMany.mockResolvedValue({ count: 2 });

    const summary = await service.run(false);

    expect(summary.tables.find((t) => t.table === 'ai_pricing_logs')!.error).toContain('boom');
    expect(summary.tables.find((t) => t.table === 'ai_briefs')!.deleted).toBe(2);
  });

  it('persists an audit summary after every run', async () => {
    await service.run(true);
    const upsert = mockPrisma.platformConfig.upsert.mock.calls[0][0];
    expect(upsert.where.key).toBe('ai_retention_last_run');
    expect(upsert.create.value.dryRun).toBe(true);
    expect(upsert.create.value.tables).toHaveLength(5);
  });
});
