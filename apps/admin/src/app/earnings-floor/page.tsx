'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, DollarSign, Lock, Info } from 'lucide-react';

interface FloorConfig {
  per_mile: number;
  per_min: number;
  base: number;
}

interface FloorImpact {
  totalSupplement: number;
  tripsAffected: number;
  avgSupplement: number;
}

interface FloorLog {
  id: string;
  driverName: string;
  tripId: string;
  distance: number;
  duration: number;
  driverEarnings: number;
  floorAmount: number;
  supplement: number;
  createdAt: string;
}

export default function EarningsFloorPage() {
  const [period, setPeriod] = useState<'week' | 'month'>('month');

  const { data: config } = useQuery<{ value: FloorConfig }>({
    queryKey: ['platform-config', 'earnings_floor_formula'],
    queryFn: async () => {
      const res = await fetch('/api/admin/config/earnings_floor_formula');
      return res.json();
    },
  });

  const { data: impact } = useQuery<FloorImpact>({
    queryKey: ['floor-impact', period],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics/earnings-floor?period=${period}`);
      return res.json();
    },
  });

  const { data: logs } = useQuery<FloorLog[]>({
    queryKey: ['floor-logs', period],
    queryFn: async () => {
      const res = await fetch(`/api/admin/earnings-floor/logs?period=${period}`);
      return res.json();
    },
  });

  const formula = config?.value;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Earnings Floor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Platform guarantee that drivers always earn a minimum per trip. BidRide absorbs any
          shortfall.
        </p>
      </div>

      {/* Formula display */}
      <div className="bg-card rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#F4B400]" />
            <h2 className="text-sm font-semibold text-white">Floor Formula</h2>
          </div>
          <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-md flex items-center gap-1">
            <Lock className="w-3 h-3" />
            Founder-only write access
          </span>
        </div>

        {formula ? (
          <div className="space-y-3">
            <code className="block text-sm font-mono text-[#F4B400] bg-secondary/50 rounded-xl p-4">
              floor = (miles × ${formula.per_mile.toFixed(2)}) + (min × ${formula.per_min.toFixed(2)}) + ${formula.base.toFixed(2)}
            </code>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Per Mile</span>
                <span className="ml-2 font-mono font-bold text-[#F4B400]">
                  ${formula.per_mile.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Per Minute</span>
                <span className="ml-2 font-mono font-bold text-[#F4B400]">
                  ${formula.per_min.toFixed(2)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Base</span>
                <span className="ml-2 font-mono font-bold text-[#F4B400]">
                  ${formula.base.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-16 bg-secondary/50 rounded-xl animate-pulse" />
        )}

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <p>
            Changes to this formula require a signed JWT from the Founder. Contact marq@bidride.com
            to request a formula change.
          </p>
        </div>
      </div>

      {/* Period toggle */}
      <div className="flex gap-2">
        {(['week', 'month'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              period === p
                ? 'bg-[#F4B400] text-black border-[#F4B400]'
                : 'bg-card text-muted-foreground border-border hover:border-[#F4B400]/50'
            }`}
          >
            Last {p === 'week' ? '7 Days' : '30 Days'}
          </button>
        ))}
      </div>

      {/* Impact metrics */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          icon={DollarSign}
          label="Total Supplement Paid"
          value={`$${(impact?.totalSupplement ?? 0).toFixed(2)}`}
          gold
        />
        <MetricCard
          icon={TrendingUp}
          label="Trips Protected"
          value={(impact?.tripsAffected ?? 0).toString()}
        />
        <MetricCard
          icon={DollarSign}
          label="Avg Supplement"
          value={`$${(impact?.avgSupplement ?? 0).toFixed(2)}`}
        />
      </div>

      {/* Floor log table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-white">Floor Supplement Log</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left px-4 py-3 font-medium">Driver</th>
                <th className="text-right px-4 py-3 font-medium">Distance</th>
                <th className="text-right px-4 py-3 font-medium">Duration</th>
                <th className="text-right px-4 py-3 font-medium">Earned</th>
                <th className="text-right px-4 py-3 font-medium">Floor</th>
                <th className="text-right px-4 py-3 font-medium">Supplement</th>
                <th className="text-right px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs?.map((log) => (
                <tr key={log.id} className="hover:bg-secondary/20">
                  <td className="px-4 py-3 text-white font-medium">{log.driverName}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {log.distance.toFixed(1)} mi
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {log.duration} min
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    ${log.driverEarnings.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    ${log.floorAmount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-[#F4B400]">
                    +${log.supplement.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {new Date(log.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {!logs?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    No supplement logs in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  gold,
}: {
  icon: any;
  label: string;
  value: string;
  gold?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-4 h-4 ${gold ? 'text-[#F4B400]' : 'text-muted-foreground'}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold font-mono ${gold ? 'text-[#F4B400]' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}
