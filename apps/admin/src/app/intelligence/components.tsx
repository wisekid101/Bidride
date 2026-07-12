'use client';

import { AlertCircle, Loader2 } from 'lucide-react';

// ─── Shared Founder Intelligence UI ───────────────────────────────────────────
// Every number renders with its window, sample size, source, and quality
// label. Insufficient evidence is a first-class visual state — no invented
// values, no fake charts.

export interface BriefMetric {
  name: string;
  value: number | string | null;
  unit?: string;
  window: string;
  sampleSize: number;
  source: string;
  comparison?: { period: string; value: number | string | null; changePct: number | null };
  qualityLabel: string;
  betterWhen?: 'up' | 'down';
  note?: string;
}

export interface BriefSection {
  title: string;
  metrics: BriefMetric[];
  zoneTable?: { columns: string[]; rows: Array<Record<string, string | number | null>> };
  notes?: string[];
}

export interface FounderBrief {
  briefType: string;
  windowStart: string;
  windowEnd: string;
  comparisonWindowStart: string;
  comparisonWindowEnd: string;
  generatedAt: string;
  sourceVersion: string;
  sections: BriefSection[];
  insufficientEvidence: string[];
}

const QUALITY_STYLES: Record<string, string> = {
  canonical_trusted: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  canonical_all: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  operational: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  live_snapshot: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  insufficient_evidence: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

export function QualityBadge({ label }: { label: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${QUALITY_STYLES[label] ?? QUALITY_STYLES.operational}`}>
      {label.replace(/_/g, ' ')}
    </span>
  );
}

export function fmtValue(m: BriefMetric): string {
  if (m.qualityLabel === 'insufficient_evidence' || m.value === null) return 'insufficient evidence';
  if (m.unit === 'USD') return `$${Number(m.value).toFixed(2)}`;
  if (m.unit === '%') return `${m.value}%`;
  if (m.unit) return `${m.value} ${m.unit}`;
  return String(m.value);
}

export function MetricTile({ m }: { m: BriefMetric }) {
  const insufficient = m.qualityLabel === 'insufficient_evidence';
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{m.name.replace(/_/g, ' ')}</p>
        <QualityBadge label={m.qualityLabel} />
      </div>
      <p className={`text-2xl font-bold font-mono mt-1 ${insufficient ? 'text-zinc-500 text-base' : m.unit === 'USD' ? 'text-[#F4B400]' : 'text-white'}`}>
        {fmtValue(m)}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">
        n={m.sampleSize} · {m.window}
      </p>
      {m.comparison && (
        <p className="text-[11px] text-muted-foreground">
          prev {m.comparison.period}: {m.comparison.value ?? '—'}
          {m.comparison.changePct != null && (
            <span className={(m.betterWhen === 'down' ? m.comparison.changePct <= 0 : m.comparison.changePct >= 0) ? 'text-teal-400' : 'text-red-400'}>
              {' '}({m.comparison.changePct >= 0 ? '+' : ''}{m.comparison.changePct}%)
            </span>
          )}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground/70 mt-1 truncate" title={m.source}>src: {m.source}</p>
      {m.note && <p className="text-[10px] text-yellow-500/80 mt-1">{m.note}</p>}
    </div>
  );
}

function humanize(key: string): string {
  return key
    .replace(/Pct$/, ' %')
    .replace(/Ms$/, ' (ms)')
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
}

function fmtCell(column: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (column.endsWith('Pct') && typeof value === 'number') return `${value}%`;
  return String(value);
}

export function DataTable({ columns, rows }: { columns: string[]; rows: Array<Record<string, string | number | null>> }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground italic">no rows with sufficient data this window</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-secondary/50 text-muted-foreground">
            {columns.map((c) => (
              <th key={c} className="text-left px-3 py-2 font-medium">{humanize(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {columns.map((c) => (
                <td key={c} className="px-3 py-1.5 font-mono text-white/90">{fmtCell(c, r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BriefView({ brief }: { brief: FounderBrief }) {
  const ageMin = Math.round((Date.now() - new Date(brief.generatedAt).getTime()) / 60000);
  return (
    <div className="space-y-6">
      {ageMin > 60 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-200/90">
          This brief was generated {ageMin >= 120 ? `${Math.round(ageMin / 60)} hours` : `${ageMin} minutes`} ago and may not
          reflect current data — use Regenerate for a fresh read.
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        window {brief.windowStart.slice(0, 10)} → {brief.windowEnd.slice(0, 10)} · compared to{' '}
        {brief.comparisonWindowStart.slice(0, 10)} → {brief.comparisonWindowEnd.slice(0, 10)} · generated{' '}
        {new Date(brief.generatedAt).toLocaleString()} · {brief.sourceVersion}
      </p>
      {brief.sections.map((s) => (
        <section key={s.title} className="space-y-3">
          <h2 className="text-sm font-semibold text-white">{s.title}</h2>
          {s.metrics.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {s.metrics.map((m) => <MetricTile key={m.name} m={m} />)}
            </div>
          )}
          {s.zoneTable && <DataTable columns={s.zoneTable.columns} rows={s.zoneTable.rows} />}
          {s.notes?.map((n, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">• {n}</p>
          ))}
        </section>
      ))}
      {brief.insufficientEvidence.length > 0 && (
        <div className="rounded-lg border border-zinc-600/40 bg-zinc-800/40 p-3">
          <p className="text-xs text-zinc-300">
            Insufficient evidence this window: {brief.insufficientEvidence.join(', ')} — these render only when their
            sample floor is met. No values were invented.
          </p>
        </div>
      )}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  );
}

export function ErrorState({ label }: { label: string }) {
  return (
    <div className="p-6 flex items-center gap-2 text-red-400 text-sm">
      <AlertCircle className="w-4 h-4" />
      {label}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  proposed: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  viewed: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  adopted: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  dismissed: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  expired: 'bg-zinc-500/15 text-zinc-500 border-zinc-600/30',
  outcome_pending: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  outcome_scored: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.proposed}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function ConstitutionTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary border border-teal-500/20 text-teal-300/90">
          {t.replace(/_/g, ' ')}
        </span>
      ))}
    </div>
  );
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
