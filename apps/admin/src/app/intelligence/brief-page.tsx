'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BriefView, ErrorState, FounderBrief, LoadingState, fetchJson } from './components';

// Shared page body for the three Founder briefs.
export function BriefPage({ type, title, icon }: { type: string; title: string; icon: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery<FounderBrief>({
    queryKey: ['intelligence-brief', type],
    queryFn: () => fetchJson<FounderBrief>(`/api/admin/intelligence/briefs/${type}`),
  });

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const fresh = await fetchJson<FounderBrief>(`/api/admin/intelligence/briefs/${type}?refresh=true`);
      queryClient.setQueryData(['intelligence-brief', type], fresh);
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
      {data && <BriefView brief={data} />}
    </div>
  );
}
