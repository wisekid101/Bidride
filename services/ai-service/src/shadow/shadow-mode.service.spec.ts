import { ShadowModeService } from './shadow-mode.service';

const mockPrisma = {
  platformConfig: { findMany: jest.fn() },
} as any;

const rows = (values: Record<string, unknown>) =>
  Object.entries(values).map(([key, value]) => ({ key, value }));

let service: ShadowModeService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new ShadowModeService(mockPrisma);
  mockPrisma.platformConfig.findMany.mockResolvedValue([]);
});

// ─── Fail-safe defaults ───────────────────────────────────────────────────────

describe('ShadowModeService — defaults', () => {
  it('global shadow mode defaults TRUE when no config rows exist', async () => {
    expect(await service.isShadow('fare')).toBe(true);
    expect(await service.isShadow('ranking')).toBe(true);
    expect(await service.isShadow('win_probability')).toBe(true);
  });

  it('feature families default FALSE — turning global shadow off alone activates nothing', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue(rows({ ai_shadow_mode: false }));

    expect(await service.isLive('fare')).toBe(false);
    expect(await service.isLive('ranking')).toBe(false);
    expect(await service.isLive('win_probability')).toBe(false);
  });

  it('an enabled family under global shadow TRUE still serves neutral output', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue(
      rows({ ai_shadow_mode: true, ai_fare_enabled: true }),
    );

    expect(await service.isShadow('fare')).toBe(true);
    expect(await service.isLive('fare')).toBe(false);
  });

  it('goes live only when global shadow is OFF and the family switch is ON', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue(
      rows({ ai_shadow_mode: false, ai_fare_enabled: true }),
    );

    expect(await service.isLive('fare')).toBe(true);
    // Sibling families stay shadowed — switches are per-family.
    expect(await service.isLive('ranking')).toBe(false);
    expect(await service.isLive('win_probability')).toBe(false);
  });

  it('accepts string "true"/"false" Json values', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue(
      rows({ ai_shadow_mode: 'false', ai_ranking_enabled: 'true' }),
    );

    expect(await service.isLive('ranking')).toBe(true);
  });

  it('treats malformed config values as their fail-safe defaults', async () => {
    mockPrisma.platformConfig.findMany.mockResolvedValue(
      rows({ ai_shadow_mode: { nonsense: 1 }, ai_fare_enabled: 42 }),
    );

    expect(await service.isShadow('fare')).toBe(true);
  });
});

// ─── Config-read failure forces shadow ────────────────────────────────────────

describe('ShadowModeService — config failure', () => {
  it('a platform_config read failure forces shadow mode (fail SAFE)', async () => {
    mockPrisma.platformConfig.findMany.mockRejectedValue(new Error('db down'));

    expect(await service.isShadow('fare')).toBe(true);
    expect(await service.isLive('fare')).toBe(false);
  });
});

// ─── Cache behavior ───────────────────────────────────────────────────────────

describe('ShadowModeService — 30s config cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads config once within the TTL window', async () => {
    await service.isShadow('fare');
    await service.isShadow('ranking');
    await service.isLive('win_probability');

    expect(mockPrisma.platformConfig.findMany).toHaveBeenCalledTimes(1);
  });

  it('kill-switch changes take effect after cache expiry', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    // Live: global shadow off + family on.
    mockPrisma.platformConfig.findMany.mockResolvedValue(
      rows({ ai_shadow_mode: false, ai_fare_enabled: true }),
    );
    expect(await service.isLive('fare')).toBe(true);

    // Founder flips the kill switch. Within TTL the cache still answers…
    mockPrisma.platformConfig.findMany.mockResolvedValue(rows({ ai_shadow_mode: true }));
    now += 29_000;
    expect(await service.isLive('fare')).toBe(true);

    // …and after the 30s TTL the switch takes effect.
    now += 2_000;
    expect(await service.isLive('fare')).toBe(false);
    expect(await service.isShadow('fare')).toBe(true);
  });

  it('resetCache drops the cache immediately (test hook)', async () => {
    await service.isShadow('fare');
    service.resetCache();
    await service.isShadow('fare');

    expect(mockPrisma.platformConfig.findMany).toHaveBeenCalledTimes(2);
  });

  it('a failed read is also cached — no hot-loop hammering a down database', async () => {
    mockPrisma.platformConfig.findMany.mockRejectedValue(new Error('db down'));

    await service.isShadow('fare');
    await service.isShadow('fare');

    expect(mockPrisma.platformConfig.findMany).toHaveBeenCalledTimes(1);
  });
});
