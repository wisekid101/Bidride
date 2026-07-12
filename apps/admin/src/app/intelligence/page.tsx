'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Activity, Gauge, Inbox, Lightbulb, Map, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ErrorState, LoadingState, StatusBadge, fetchJson } from './components';

interface BriefOverview { briefType: string; generatedAt: string | null }
interface RecSummary {
  id: string; domain: string; family: string; title: string; status: string;
  confidence: string | number; sampleSize: number; createdAt: string;
}
interface RecList { items: RecSummary[]; total: number }

const BRIEF_CARDS = [
  { type: 'marketplace_health', title: 'Marketplace Health', href: '/intelligence/marketplace-health', icon: Activity, tint: 'text-teal-400' },
  { type: 'money_map', title: 'Money Map', href: '/intelligence/money-map', icon: Map, tint: 'text-yellow-400' },
  { type: 'ai_performance', title: 'AI Performance', href: '/intelligence/ai-performance', icon: Gauge, tint: 'text-purple-400' },
];

export default function IntelligenceOverviewPage() {
  const queryClient = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/admin/intelligence/opportunity', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? 'Analysis failed');
      }
      await queryClient.invalidateQueries({ queryKey: ['intelligence-recs-proposed'] });
    } catch (e) {
      setAnalyzeError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const briefs = useQuery<BriefOverview[]>({
    queryKey: ['intelligence-overview'],
    queryFn: () => fetchJson('/api/admin/intelligence/briefs'),
  });
  const recs = useQuery<RecList>({
    queryKey: ['intelligence-recs-proposed'],
    queryFn: () => fetchJson('/api/admin/intelligence/recommendations?status=proposed&limit=5'),
  });

  if (briefs.isLoading) return <LoadingState label="Loading Intelligence overview…" />;
  if (briefs.isError) return <ErrorState label={(briefs.error as Error)?.message ?? 'Intelligence unavailable'} />;

  const generatedAt = (type: string) => briefs.data?.find((b) => b.briefType === type)?.generatedAt ?? null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-teal-400" />
          Founder Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Evidence-based briefs and advisory recommendations. Everything here is read-only — adopting a
          recommendation records your decision, it never executes a change.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {BRIEF_CARDS.map(({ type, title, href, icon: Icon, tint }) => (
          <Link key={type} href={href} className="bg-card rounded-xl border border-border p-4 hover:bg-secondary/50 transition">
            <p className="flex items-center gap-2 text-white font-semibold text-sm"><Icon className={`w-4 h-4 ${tint}`} /> {title}</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {generatedAt(type) ? `last generated ${new Date(generatedAt(type)!).toLocaleString()}` : 'not yet generated — open to generate'}
            </p>
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Inbox className="w-4 h-4 text-teal-400" /> Recommendation Inbox — proposed
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={analyze}
              disabled={analyzing}
              className="text-xs px-2.5 py-1 rounded-lg border border-teal-500/40 bg-teal-500/10 text-teal-300 disabled:opacity-50"
            >
              {analyzing ? 'Analyzing…' : 'Analyze opportunities'}
            </button>
            <Link href="/intelligence/inbox" className="text-xs text-teal-400 hover:underline">open inbox →</Link>
          </div>
        </div>
        {analyzeError && <p className="text-xs text-red-400">{analyzeError}</p>}
        {recs.isLoading && <LoadingState label="Loading recommendations…" />}
        {recs.isError && <ErrorState label="Recommendations unavailable" />}
        {recs.data && recs.data.items.length === 0 && (
          <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
            <Lightbulb className="w-3.5 h-3.5" /> No proposed recommendations right now.
          </p>
        )}
        {recs.data && recs.data.items.length > 0 && (
          <div className="space-y-2">
            {recs.data.items.map((r) => (
              <Link key={r.id} href={`/intelligence/inbox/${r.id}`} className="flex items-center justify-between bg-card rounded-lg border border-border px-4 py-2.5 hover:bg-secondary/50 transition">
                <div>
                  <p className="text-sm text-white">{r.title}</p>
                  <p className="text-[11px] text-muted-foreground">{r.domain}/{r.family} · n={r.sampleSize} · confidence {Number(r.confidence).toFixed(2)}</p>
                </div>
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
