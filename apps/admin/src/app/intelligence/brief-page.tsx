'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BriefView, ErrorState, FounderBrief, LoadingState, fetchJson } from './components';

interface BriefEnvelope {
  brief: FounderBrief | null;
  generatedAt: string | null;
  stale: boolean;
  slaMinutes: number;
}

// Shared page body for the three Founder briefs.
export function BriefPage({ type, title, icon }: { type: string; title: string; icon: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Read-only GET: { brief, generatedAt, stale, slaMinutes } — never generates.
  const { data, isLoading, isError, error } = useQuery<BriefEnvelope>({
    queryKey: ['intelligence-brief', type],
    queryFn: () => fetchJson<BriefEnvelope>(`/api/admin/intelligence/briefs/${type}`),
  });

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await fetchJson<FounderBrief>(`/api/admin/intelligence/briefs/${type}/generate`, { method: 'POST' });
      await queryClient.invalidateQueries({ queryKey: ['intelligence-brief', type] });
    } catch (e) {
      setRefreshError((e as Error).message ?? 'Regenerate failed');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <Link href="/intelligence" className="text-xs text-teal-400 hover:underline">← Intelligence overview</Link>
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          {icon}
          {title}
        </h1>
        <button
          onClick={refresh}
          disabled={refreshing || isLoading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border bg-card text-white hover:bg-secondary disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Regenerate
        </button>
      </div>
      {refreshError && <ErrorState label={`Regenerate failed: ${refreshError}`} />}
      {isLoading && <LoadingState label={`Loading ${title}…`} />}
      {isError && <ErrorState label={(error as Error)?.message ?? 'Failed to load brief'} />}
      {data && data.stale && data.brief && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-200/90">
          STALE: generated {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'never'} — outside its
          {' '}{Math.round(data.slaMinutes / 60)}h freshness SLA. The scheduler may be down; Regenerate for a fresh read.
        </div>
      )}
      {data && !data.brief && (
        <p className="text-sm text-muted-foreground italic">
          This brief has never been generated. The scheduler will produce it on its next cycle, or press Regenerate.
        </p>
      )}
      {data?.brief && <BriefView brief={data.brief} />}
    </div>
  );
}
