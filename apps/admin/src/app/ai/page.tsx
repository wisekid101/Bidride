'use client';

import { useQuery } from '@tanstack/react-query';
import { Brain, Activity, Target, Zap, TrendingUp, AlertCircle } from 'lucide-react';

interface CalibrationBucket {
  bucket: string;
  predicted: number;
  actual: number;
  count: number;
}

interface ZoneMetric {
  zone: string;
  predictions: number;
  accuracy: number;
}

interface HourMetric {
  hour: number;
  predictions: number;
  accuracy: number;
}

interface AiMetrics {
  model: { name: string; version: string; type: string };
  predictions: {
    total: number;
    withOutcome: number;
    accuracy: number | null;
    acceptanceRate: number | null;
    avgConfidence: number | null;
    falsePositives: number;
    falseNegatives: number;
    precision: number | null;
    recall: number | null;
    rocAucPlaceholder: null;
    calibration: CalibrationBucket[];
  };
  latency: { avgMs: number; p50Ms: number; p95Ms: number };
  fallbackRate: number | null;
  byZone: ZoneMetric[];
  byHour: HourMetric[];
}

function pct(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold font-mono text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function AccuracyBar({ value }: { value: number }) {
  const color = value >= 0.75 ? 'bg-teal-400' : value >= 0.60 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(value * 100).toFixed(0)}%` }} />
      </div>
      <span className="text-xs font-mono text-white w-10 text-right">{pct(value)}</span>
    </div>
  );
}

const HOUR_LABELS = ['12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a',
  '12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p'];

export default function AiDashboardPage() {
  const { data, isLoading, isError } = useQuery<AiMetrics>({
    queryKey: ['ai-metrics'],
    queryFn: async () => {
      const res = await fetch('/api/admin/ai-metrics');
      if (!res.ok) throw new Error('Failed to load AI metrics');
      return res.json();
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
        <Activity className="w-4 h-4 animate-pulse" />
        Loading AI metrics…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 flex items-center gap-2 text-red-400 text-sm">
        <AlertCircle className="w-4 h-4" />
        AI service unreachable. Check that ai-service is running on port 3012.
      </div>
    );
  }

  const p = data.predictions;
  const hasOutcomes = p.withOutcome > 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain className="w-6 h-6 text-teal-400" />
            AI Model Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data.model.name} · {data.model.version} · {data.model.type}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="text-xs text-teal-400 font-medium">Active</span>
        </div>
      </div>

      {/* No data notice */}
      {!hasOutcomes && (
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 flex gap-3">
          <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-400">No outcome data yet</p>
            <p className="text-xs text-yellow-400/80 mt-1">
              Accuracy metrics appear after trips complete and outcomes are recorded.
              Predictions are being logged now.
            </p>
          </div>
        </div>
      )}

      {/* Prediction volume + latency */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Predictions" value={p.total.toLocaleString()} sub="bid-win-probability" />
        <MetricCard label="With Outcome" value={p.withOutcome.toLocaleString()} sub="trips completed" />
        <MetricCard label="Avg Latency" value={`${data.latency.avgMs}ms`} sub={`p95 ${data.latency.p95Ms}ms`} />
        <MetricCard
          label="Fallback Rate"
          value={data.fallbackRate !== null ? pct(data.fallbackRate) : '—'}
          sub="rule engine only"
        />
      </div>

      {/* Accuracy metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Accuracy" value={pct(p.accuracy)} sub={hasOutcomes ? `${p.withOutcome} samples` : 'awaiting data'} />
        <MetricCard label="Acceptance Rate" value={pct(p.acceptanceRate)} sub="actual trip outcomes" />
        <MetricCard label="Avg Confidence" value={pct(p.avgConfidence)} sub="rule-based cap: 88%" />
        <MetricCard label="ROC AUC" value="—" sub="available after ML" />
      </div>

      {/* Classification detail */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Precision" value={pct(p.precision)} />
        <MetricCard label="Recall" value={pct(p.recall)} />
        <MetricCard label="False Positives" value={p.falsePositives.toString()} sub="predicted accept, was declined" />
        <MetricCard label="False Negatives" value={p.falseNegatives.toString()} sub="predicted decline, was accepted" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Calibration */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-white">Calibration</h2>
            <span className="text-xs text-muted-foreground ml-auto">predicted vs actual</span>
          </div>
          {p.calibration.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No calibration data yet</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left pb-2">Bucket</th>
                  <th className="text-right pb-2">Predicted</th>
                  <th className="text-right pb-2">Actual</th>
                  <th className="text-right pb-2">n</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {p.calibration.map((b) => (
                  <tr key={b.bucket}>
                    <td className="py-1.5 font-mono text-white">{b.bucket}</td>
                    <td className="py-1.5 text-right font-mono">{pct(b.predicted)}</td>
                    <td className={`py-1.5 text-right font-mono ${Math.abs(b.predicted - b.actual) > 0.1 ? 'text-yellow-400' : 'text-teal-400'}`}>
                      {pct(b.actual)}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Acceptance accuracy by hour */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-teal-400" />
            <h2 className="text-sm font-semibold text-white">Accuracy by Hour</h2>
          </div>
          {data.byHour.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No hourly data yet</p>
          ) : (
            <div className="space-y-1.5">
              {data.byHour.slice(0, 8).map((h) => (
                <div key={h.hour} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-7">{HOUR_LABELS[h.hour]}</span>
                  <AccuracyBar value={h.accuracy} />
                  <span className="text-xs text-muted-foreground w-8 text-right">{h.predictions}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Acceptance accuracy by zone */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-teal-400" />
          <h2 className="text-sm font-semibold text-white">Accuracy by Zone</h2>
          <span className="text-xs text-muted-foreground ml-auto">top zones by volume</span>
        </div>
        {data.byZone.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">No zone data yet</p>
        ) : (
          <div className="space-y-2">
            {data.byZone.slice(0, 10).map((z) => (
              <div key={z.zone} className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground w-24 shrink-0">{z.zone}</span>
                <div className="flex-1">
                  <AccuracyBar value={z.accuracy} />
                </div>
                <span className="text-xs text-muted-foreground w-12 text-right">{z.predictions} trips</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feature availability note */}
      <div className="bg-secondary/30 border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-white mb-1">Feature Availability</p>
        <p className="text-xs text-muted-foreground">
          Logged per inference in <code className="text-teal-400">ai_inference_logs.input_features</code>.
          15 signals tracked: bid ratio, rider/driver trust, zone demand, airport flag, weather,
          time of day, acceptance history, cancellation rate, response time, zone acceptance rate, ETA.
          Feature availability analytics will surface automatically as inference volume grows.
        </p>
      </div>
    </div>
  );
}
