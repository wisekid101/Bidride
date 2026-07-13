import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ─── Shared data-quality class readout (Phase 3.2, Build Step 1) ─────────────
// THE single way to read the C1–C5 classifier's verdicts. Bounded by
// construction: callers ask about the trip ids in THEIR window and the query
// touches only those ids (indexed, DISTINCT ON latest event per trip) — the
// complete classification-event history is never rescanned. A 5-minute
// in-memory cache absorbs repeated brief/projection reads; the classifier
// invalidates it after every classify run.
//
// Semantics preserved exactly: latest event per trip wins; monetary metrics
// may use Trusted + Reconciled ONLY (Suspect/Excluded never touch money).

const CACHE_TTL_MS = 5 * 60_000;
const CHUNK_SIZE = 500;

interface CacheEntry {
  cls: string | undefined; // undefined = known-unclassified (also cached)
  fetchedAt: number;
}

@Injectable()
export class QualityClassService {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** Latest quality class per trip, for exactly the given trip ids. */
  async classesFor(tripIds: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const now = Date.now();
    const misses: string[] = [];

    for (const id of new Set(tripIds)) {
      const hit = this.cache.get(id);
      if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
        if (hit.cls) result.set(id, hit.cls);
      } else {
        misses.push(id);
      }
    }

    for (let i = 0; i < misses.length; i += CHUNK_SIZE) {
      const chunk = misses.slice(i, i + CHUNK_SIZE);
      // DISTINCT ON (tripId) latest event — one indexed query per chunk.
      const rows = await this.prisma.tripEvent.findMany({
        where: { eventType: 'data_quality_classified', tripId: { in: chunk } },
        orderBy: [{ tripId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['tripId'],
        select: { tripId: true, metadata: true },
      });
      const found = new Map<string, string>();
      for (const row of rows) {
        const cls = (row.metadata as { class?: string } | null)?.class;
        if (cls) found.set(row.tripId, cls);
      }
      for (const id of chunk) {
        const cls = found.get(id);
        this.cache.set(id, { cls, fetchedAt: now });
        if (cls) result.set(id, cls);
      }
    }
    return result;
  }

  /** Money gate: Trusted + Reconciled only. */
  async moneyEligibleSubset(tripIds: string[]): Promise<Set<string>> {
    const classes = await this.classesFor(tripIds);
    return new Set([...classes.entries()].filter(([, c]) => c === 'trusted' || c === 'reconciled').map(([id]) => id));
  }

  /**
   * All-time class counts (AI-performance gate stats) WITHOUT rescanning
   * history in memory: one DISTINCT ON query does latest-per-trip in SQL.
   */
  async latestClassCounts(): Promise<{ counts: Record<string, number>; total: number }> {
    const rows = await this.prisma.tripEvent.findMany({
      where: { eventType: 'data_quality_classified' },
      orderBy: [{ tripId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['tripId'],
      select: { metadata: true },
    });
    const counts: Record<string, number> = { trusted: 0, reconciled: 0, suspect: 0, excluded: 0 };
    for (const row of rows) {
      const cls = (row.metadata as { class?: string } | null)?.class;
      if (cls) counts[cls] = (counts[cls] ?? 0) + 1;
    }
    return { counts, total: rows.length };
  }

  /** Invalidation hook — the classifier calls this after every classify run. */
  reset(): void {
    this.cache.clear();
  }
}
