'use client';

import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorState, LoadingState, StatusBadge, fetchJson } from '../components';

interface RecSummary {
  id: string; domain: string; family: string; recommendationType: string; title: string; status: string;
  confidence: string | number; sampleSize: number; constitutionTags: string[]; createdAt: string; expiresAt: string | null;
}
interface RecList { items: RecSummary[]; total: number; page: number; limit: number }

const STATUS_FILTERS = ['all', 'proposed', 'viewed', 'adopted', 'dismissed', 'expired', 'outcome_pending', 'outcome_scored'] as const;
const PAGE_SIZE = 25;

export default function InboxPage() {
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (status !== 'all') params.set('status', status);

  const { data, isLoading, isError, error } = useQuery<RecList>({
    queryKey: ['intelligence-inbox', status, page],
    queryFn: () => fetchJson(`/api/admin/intelligence/recommendations?${params.toString()}`),
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Inbox className="w-6 h-6 text-teal-400" />
        Recommendation Inbox
      </h1>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`text-xs px-2.5 py-1 rounded-lg border ${status === s ? 'bg-teal-500/20 border-teal-500/40 text-teal-300' : 'bg-card border-border text-muted-foreground hover:text-white'}`}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {isLoading && <LoadingState label="Loading recommendations…" />}
      {isError && <ErrorState label={(error as Error)?.message ?? 'Failed to load'} />}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No recommendations match this filter.</p>
      )}

      {data && data.items.length > 0 && (
        <div className="space-y-2">
          {data.items.map((r) => (
            <Link key={r.id} href={`/intelligence/inbox/${r.id}`} className="flex items-center justify-between bg-card rounded-lg border border-border px-4 py-3 hover:bg-secondary/50 transition">
              <div className="min-w-0">
                <p className="text-sm text-white truncate">{r.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {r.domain}/{r.family} · n={r.sampleSize} · confidence {Number(r.confidence).toFixed(2)} · {new Date(r.createdAt).toLocaleString()}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      )}

      {data && pages > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded border border-border disabled:opacity-40">← prev</button>
          page {page} / {pages} · {data.total} total
          <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded border border-border disabled:opacity-40">next →</button>
        </div>
      )}
    </div>
  );
}
