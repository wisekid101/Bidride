'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart2, MapPin, Clock, TrendingUp, Users, Activity } from 'lucide-react';

interface HeatmapZone {
  zoneKey: string;
  centerLat: number;
  centerLng: number;
  requests: number;
  activeDrivers: number;
  demandScore: number;
  surgeMultiplier: number;
  acceptanceRate: number | null;
  avgFareUsd: number | null;
  avgWaitMin: number | null;
  driverDensity: number;
  isAirportZone: boolean;
}

interface HeatmapSummary {
  zones: HeatmapZone[];
  totalActiveRequests: number;
  totalActiveDrivers: number;
  activeZoneCount: number;
  timestamp: string;
}

interface DemandForecast {
  horizon: string;
  horizonMinutes: number;
  predictedRequests: number;
  predictedMultiplier: number;
  confidence: number;
  trend: 'rising' | 'stable' | 'falling';
}

interface MarketplaceStats {
  heatmap: HeatmapSummary;
  forecast: DemandForecast[];
}

const TREND_COLOR: Record<string, string> = {
  rising: 'text-emerald-400',
  stable: 'text-slate-400',
  falling: 'text-red-400',
};

function demandColor(score: number): string {
  if (score >= 0.7) return 'bg-red-900/60 text-red-200';
  if (score >= 0.4) return 'bg-amber-900/50 text-amber-200';
  return 'bg-emerald-900/30 text-emerald-300';
}

export default function MarketplacePage() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery<MarketplaceStats>({
    queryKey: ['marketplace-stats'],
    queryFn: () => fetch('/api/admin/marketplace').then((r) => r.json()),
    refetchInterval: 30000,
  });

  const heatmap = data?.heatmap;
  const forecast = data?.forecast ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-teal-400" />
            Marketplace Intelligence
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live supply/demand, zone heat map, and demand forecasts — Newark/EWR
          </p>
        </div>
        {dataUpdatedAt > 0 && (
          <span className="text-xs text-muted-foreground">
            Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {isError && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          Marketplace service unavailable — data may be stale.
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Activity className="w-4 h-4" />}
          label="Active Requests"
          value={isLoading ? '—' : String(heatmap?.totalActiveRequests ?? 0)}
        />
        <SummaryCard
          icon={<Users className="w-4 h-4" />}
          label="Active Drivers"
          value={isLoading ? '—' : String(heatmap?.totalActiveDrivers ?? 0)}
        />
        <SummaryCard
          icon={<MapPin className="w-4 h-4" />}
          label="Active Zones"
          value={isLoading ? '—' : String(heatmap?.activeZoneCount ?? 0)}
        />
        <SummaryCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Marketplace Balance"
          value={
            isLoading
              ? '—'
              : heatmap && heatmap.totalActiveDrivers > 0
              ? `${((heatmap.totalActiveRequests / heatmap.totalActiveDrivers) * 100).toFixed(0)}% util`
              : '—'
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Heat Map Zone Table */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-teal-400" />
            Zone Heat Map
          </h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : (heatmap?.zones.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No active zones</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border">
                    <th className="text-left pb-2 pr-3">Zone</th>
                    <th className="text-right pb-2 pr-3">Req</th>
                    <th className="text-right pb-2 pr-3">Drivers</th>
                    <th className="text-right pb-2 pr-3">Surge</th>
                    <th className="text-right pb-2 pr-3">Acc%</th>
                    <th className="text-right pb-2">Avg Fare</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {heatmap!.zones.map((z) => (
                    <tr key={z.zoneKey} className="hover:bg-secondary/20">
                      <td className="py-1.5 pr-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${demandColor(z.demandScore)}`}
                        >
                          {z.isAirportZone ? '✈ EWR' : z.zoneKey}
                        </span>
                      </td>
                      <td className="text-right pr-3 font-mono text-white">{z.requests}</td>
                      <td className="text-right pr-3 font-mono text-white">{z.activeDrivers}</td>
                      <td className="text-right pr-3 font-mono text-amber-400">
                        {z.surgeMultiplier.toFixed(2)}×
                      </td>
                      <td className="text-right pr-3 font-mono">
                        {z.acceptanceRate != null ? `${(z.acceptanceRate * 100).toFixed(0)}%` : '—'}
                      </td>
                      <td className="text-right font-mono text-emerald-400">
                        {z.avgFareUsd != null ? `$${z.avgFareUsd.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Demand Forecast */}
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-teal-400" />
            Demand Forecast — Newark Core
          </h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : forecast.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No forecast available</p>
          ) : (
            <div className="space-y-2">
              {forecast.map((f) => (
                <div
                  key={f.horizon}
                  className="flex items-center justify-between rounded-lg bg-secondary/20 px-3 py-2"
                >
                  <div>
                    <span className="text-sm font-medium text-white">{f.horizon}</span>
                    <span
                      className={`ml-2 text-xs font-medium ${TREND_COLOR[f.trend] ?? 'text-slate-400'}`}
                    >
                      {f.trend}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono text-white">
                      {f.predictedRequests} req
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {f.predictedMultiplier.toFixed(2)}× surge &middot; {(f.confidence * 100).toFixed(0)}% conf
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Dispatch latency / predicted demand note */}
      <p className="text-xs text-muted-foreground">
        Zone demand scores auto-refresh every 30s from Redis. Acceptance rate and avg fare sourced from bid outcomes (last 6h).
        Forecasts are rule-based horizon projections — not ML-trained.
      </p>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-teal-400 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-xl font-bold text-white font-mono">{value}</p>
    </div>
  );
}
