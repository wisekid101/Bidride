'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileText, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConstitutionTags, ErrorState, LoadingState, QualityBadge, StatusBadge, fetchJson } from '../../components';

interface EvidenceItem { source: string; metric: string; value: string | number | boolean | null; window?: string; sampleSize?: number; asOf: string }
interface LedgerEvent { actor: string; actorRole: string; action: string; previousStatus: string | null; newStatus: string; reason: string | null; createdAt: string }
interface RecommendationDetail {
  id: string; domain: string; family: string; title: string; status: string;
  confidence: string | number; sampleSize: number; constitutionTags: string[];
  outcomeScore: string | number | null; outcomeNotes: string | null;
  createdAt: string; expiresAt: string | null;
  payload: {
    summary: string;
    recommendation: { action: string; value?: string | number; unit?: string; detail?: string };
    evidence: EvidenceItem[];
    reasoning: string[];
    expectedOutcome: string;
    expectedValue: { metric: string; delta: string; horizon: string } | string;
    alternatives: Array<{ action: string; expectedValue?: string; tradeoff: string }>;
    why: string; whyNot: string; rollback: string;
    businessImpact: string; userImpact: string; safetyImpact: string; revenueImpact: string; trustImpact: string;
    sourceVersion: string; insufficientEvidence?: boolean;
  };
  events: LedgerEvent[];
}

export default function RecommendationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery<RecommendationDetail>({
    queryKey: ['intelligence-rec', id],
    queryFn: () => fetchJson(`/api/admin/intelligence/recommendations/${id}`),
  });

  // Opening the detail marks it viewed (idempotent server-side).
  useEffect(() => {
    if (data && data.status === 'proposed') {
      void fetch(`/api/admin/intelligence/recommendations/${id}/view`, { method: 'POST' })
        .then(() => queryClient.invalidateQueries({ queryKey: ['intelligence-rec', id] }))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.status]);

  const decide = useMutation({
    mutationFn: async (action: 'adopt' | 'dismiss') => {
      setDecisionError(null);
      const res = await fetch(`/api/admin/intelligence/recommendations/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `${action} failed`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['intelligence-rec', id] }),
    onError: (e) => setDecisionError((e as Error).message),
  });

  if (isLoading) return <LoadingState label="Loading recommendation…" />;
  if (isError || !data) return <ErrorState label={(error as Error)?.message ?? 'Not found'} />;

  const p = data.payload;
  const decidable = data.status === 'proposed' || data.status === 'viewed';
  const ev = p.expectedValue;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <Link href="/intelligence/inbox" className="text-xs text-teal-400 hover:underline flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> back to inbox
      </Link>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-bold text-white">{data.title}</h1>
          <StatusBadge status={data.status} />
        </div>
        <p className="text-sm text-muted-foreground">{p.summary}</p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{data.domain}/{data.family}</span>
          <span>confidence <span className="font-mono text-white">{Number(data.confidence).toFixed(2)}</span> / 1.00</span>
          <span>n=<span className="font-mono text-white">{data.sampleSize}</span></span>
          <span>{new Date(data.createdAt).toLocaleString()}</span>
          {data.expiresAt && <span>expires {new Date(data.expiresAt).toLocaleDateString()}</span>}
        </div>
        <ConstitutionTags tags={data.constitutionTags} />
        {p.insufficientEvidence && (
          <p className="text-xs text-zinc-300 bg-zinc-800/50 border border-zinc-600/40 rounded-lg p-2">
            This recommendation declares <b>insufficient evidence</b> — it exists to tell you honestly that no action is supported yet.
          </p>
        )}
      </div>

      <section className="bg-card rounded-xl border border-border p-4 space-y-1">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Recommended action (advisory only)</p>
        <p className="text-sm text-white font-mono">{p.recommendation.action}{p.recommendation.value !== undefined ? ` → ${p.recommendation.value}${p.recommendation.unit ? ` (${p.recommendation.unit})` : ''}` : ''}</p>
        {p.recommendation.detail && <p className="text-xs text-muted-foreground">{p.recommendation.detail}</p>}
        <p className="text-[11px] text-yellow-500/80 pt-1">Adopting records your decision in the ledger. Nothing executes automatically.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white">Evidence</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {p.evidence.map((e, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-3">
              <p className="text-xs text-white font-medium">{e.metric.replace(/_/g, ' ')}</p>
              <p className="text-lg font-mono text-white">{e.value === null || e.value === undefined ? 'insufficient evidence' : String(e.value)}</p>
              <p className="text-[10px] text-muted-foreground">{e.window ?? ''}{e.sampleSize != null ? ` · n=${e.sampleSize}` : ''} · as of {new Date(e.asOf).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground/70 truncate" title={e.source}>src: {e.source}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <InfoCard title="Reasoning" body={p.reasoning.map((r, i) => `${i + 1}. ${r}`).join('\n')} />
        <InfoCard title="Expected outcome" body={p.expectedOutcome} />
        <InfoCard title="Expected value" body={typeof ev === 'string' ? ev.replace(/_/g, ' ') : `${ev.metric}: ${ev.delta} (${ev.horizon})`} />
        <InfoCard title="Why" body={p.why} />
        <InfoCard title="Why not" body={p.whyNot} />
        <InfoCard title="Rollback" body={p.rollback} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white">Impact</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <InfoCard title="Business" body={p.businessImpact} />
          <InfoCard title="Users" body={p.userImpact} />
          <InfoCard title="Safety" body={p.safetyImpact} highlight={!/^none/i.test(p.safetyImpact)} />
          <InfoCard title="Revenue" body={p.revenueImpact} />
          <InfoCard title="Trust" body={p.trustImpact} />
        </div>
      </section>

      {p.alternatives.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-white">Alternatives considered</h2>
          {p.alternatives.map((a, i) => (
            <div key={i} className="bg-card rounded-lg border border-border p-3 text-xs">
              <p className="text-white font-mono">{a.action}</p>
              <p className="text-muted-foreground">{a.expectedValue ? `expected: ${a.expectedValue} · ` : ''}tradeoff: {a.tradeoff}</p>
            </div>
          ))}
        </section>
      )}

      {decidable && (
        <section className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Founder decision (reason required, recorded in the audit trail)</p>
          <textarea
            aria-label="Reason for your decision (minimum 3 characters)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you adopting or dismissing this recommendation?"
            className="w-full h-20 bg-secondary/50 border border-border rounded-lg p-2 text-sm text-white placeholder:text-muted-foreground/60"
            maxLength={2000}
          />
          {reason.trim().length > 0 && reason.trim().length < 3 && (
            <p className="text-xs text-muted-foreground">A reason of at least 3 characters is required.</p>
          )}
          {decisionError && <p className="text-xs text-red-400">{decisionError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => decide.mutate('adopt')}
              disabled={decide.isPending || reason.trim().length < 3}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal-500/20 border border-teal-500/40 text-teal-300 disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> Adopt (records decision only)
            </button>
            <button
              onClick={() => decide.mutate('dismiss')}
              disabled={decide.isPending || reason.trim().length < 3}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-zinc-500/20 border border-zinc-500/40 text-zinc-300 disabled:opacity-40"
            >
              <X className="w-3.5 h-3.5" /> Dismiss (records decision only)
            </button>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white flex items-center gap-1.5"><FileText className="w-4 h-4 text-teal-400" /> Decision history</h2>
        <div className="space-y-1.5">
          {data.events.map((e, i) => (
            <div key={i} className="text-[11px] text-muted-foreground bg-card rounded-lg border border-border px-3 py-2">
              <span className="text-white">{e.action}</span> · {e.actor} ({e.actorRole}) · {e.previousStatus ?? '∅'} → {e.newStatus} · {new Date(e.createdAt).toLocaleString()}
              {e.reason && <p className="text-muted-foreground mt-0.5">“{e.reason}”</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function InfoCard({ title, body, highlight }: { title: string; body: string; highlight?: boolean }) {
  return (
    <div className={`bg-card rounded-lg border p-3 ${highlight ? 'border-red-500/50' : 'border-border'}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{title}</p>
      <p className="text-xs text-white/90 mt-1 whitespace-pre-line">{body}</p>
    </div>
  );
}
