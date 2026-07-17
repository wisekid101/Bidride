'use client';

import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, MapPin, Clock } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

interface SosEvent {
  id: string;
  tripId: string;
  initiatedByRole: 'rider' | 'driver';
  status: 'active' | 'assigned' | 'resolved';
  createdAt: string;
  gpsLat: number;
  gpsLng: number;
  adminAssignedId: string | null;
  slaMet?: boolean | null;
  recordingId?: string | null;
}

interface PanicEvent {
  id: string;
  tripId: string;
  initiatedByRole: 'rider' | 'driver';
  createdAt: string;
  adminAssignedId: string | null;
  // DO NOT display rider identity on panic — contact driver only
}

interface DeviationAlert {
  id: string;
  tripId: string;
  type: 'spatial' | 'time_overrun';
  riskLevel: 'low' | 'moderate' | 'high';
  deviationMiles: number | null;
  elapsedMin: number | null;
  expectedMin: number | null;
  escalated: boolean;
  escalationType: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const RISK_BADGE: Record<string, string> = {
  high: 'bg-red-900/60 text-red-300 border border-red-700',
  moderate: 'bg-amber-900/50 text-amber-300 border border-amber-700',
  low: 'bg-slate-700/50 text-slate-300 border border-slate-600',
};

export default function SafetyPage() {
  const [sosQueue, setSosQueue] = useState<SosEvent[]>([]);
  const [panicQueue, setPanicQueue] = useState<PanicEvent[]>([]);
  const [deviationAlerts, setDeviationAlerts] = useState<DeviationAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSos, setSelectedSos] = useState<SosEvent | null>(null);
  const [riskFilter, setRiskFilter] = useState<string>('');

  useEffect(() => {
    fetchAll();
    // Real-time: subscribe to the safety WebSocket. On any safety event the
    // Safety Center refreshes immediately (no polling). A slow 30s fallback
    // only covers a dropped socket; it is not the primary mechanism.
    let socket: Socket | undefined;
    (async () => {
      try {
        const res = await fetch('/api/admin/auth/ws-token');
        const { token } = await res.json();
        if (!token) return;
        socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080', {
          auth: { token },
          transports: ['websocket'],
        });
        const onSafety = () => fetchAll();
        socket.on('safety:panic_new', onSafety);
        socket.on('safety:sos_new', onSafety);
        socket.on('safety:anomaly', onSafety);
      } catch {
        /* falls back to the resilience interval below */
      }
    })();
    const fallback = setInterval(fetchAll, 30000);
    return () => { clearInterval(fallback); if (socket) socket.close(); };
  }, []);

  const fetchAll = async () => {
    try {
      const [sosRes, panicRes, devRes] = await Promise.all([
        fetch('/api/admin/safety/sos?status=active'),
        fetch('/api/admin/safety/panic?status=active'),
        fetch('/api/admin/safety/deviations?limit=30'),
      ]);
      const [sos, panic, devs] = await Promise.all([
        sosRes.json(),
        panicRes.json(),
        devRes.json(),
      ]);
      setSosQueue(Array.isArray(sos) ? sos : []);
      setPanicQueue(Array.isArray(panic) ? panic : []);
      setDeviationAlerts(Array.isArray(devs) ? devs : []);
    } catch {
      /* handled by retry interval */
    } finally {
      setLoading(false);
    }
  };

  const assignSos = async (sosId: string) => {
    await fetch(`/api/admin/safety/sos/${sosId}/assign`, { method: 'POST' });
    fetchAll();
  };

  const resolveSos = async (sosId: string, notes: string) => {
    await fetch(`/api/admin/safety/sos/${sosId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    fetchAll();
    setSelectedSos(null);
  };

  const SOS_SLA_SECONDS = 90;
  const getSlaStatus = (createdAt: string) => {
    const deadline = new Date(createdAt).getTime() + SOS_SLA_SECONDS * 1000;
    const secondsLeft = (deadline - Date.now()) / 1000;
    if (secondsLeft < 0) return { label: 'BREACHED', color: 'text-red-500', urgent: true };
    if (secondsLeft < 30) return { label: `${Math.round(secondsLeft)}s`, color: 'text-red-400', urgent: true };
    if (secondsLeft < 60) return { label: `${Math.round(secondsLeft)}s`, color: 'text-yellow-400', urgent: false };
    return { label: `${Math.round(secondsLeft)}s`, color: 'text-teal-400', urgent: false };
  };

  const filteredDeviations = riskFilter
    ? deviationAlerts.filter((d) => d.riskLevel === riskFilter)
    : deviationAlerts;

  const highDeviationCount = deviationAlerts.filter((d) => d.riskLevel === 'high').length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-red-400" />
        <h1 className="text-2xl font-bold text-white">Safety Incident Center</h1>
        {highDeviationCount > 0 && (
          <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
            {highDeviationCount} HIGH RISK
          </span>
        )}
      </div>

      {/* Panic Queue — DO NOT CONTACT RIDER rule */}
      {panicQueue.length > 0 && (
        <div className="bg-red-950/30 border border-red-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
            <span className="font-semibold text-red-300 text-sm uppercase tracking-wide">
              Panic Events Active ({panicQueue.length})
            </span>
          </div>
          <div className="bg-red-900/40 border border-red-600 rounded-lg p-3 mb-3">
            <p className="text-red-200 text-sm font-medium">
              ⚠️ DO NOT CONTACT THE RIDER about a panic event.
              Contact the driver only. The rider initiated this covertly.
            </p>
          </div>
          <div className="space-y-2">
            {panicQueue.map((panic) => (
              <div key={panic.id} className="flex items-center justify-between bg-card rounded-lg p-3 border border-border">
                <div>
                  <span className="text-sm font-medium text-white">
                    Trip {panic.tripId.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {new Date(panic.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <button
                  className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded-full"
                  onClick={() => assignSos(panic.id)}
                >
                  Assign to Me
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SOS Queue */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            SOS Queue ({sosQueue.length} active)
          </h2>
          <span className="text-xs text-muted-foreground">SLA: 90 seconds</span>
        </div>

        {loading && (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">Loading…</div>
        )}
        {!loading && sosQueue.length === 0 && (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">No active SOS events. All clear.</div>
        )}

        <div className="divide-y divide-border">
          {sosQueue.map((sos) => {
            const sla = getSlaStatus(sos.createdAt);
            return (
              <div
                key={sos.id}
                className={`px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-secondary/30 ${sla.urgent ? 'border-l-2 border-l-red-500' : ''}`}
                onClick={() => setSelectedSos(sos)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">Trip {sos.tripId.slice(0, 8)}…</span>
                    <span className="text-xs bg-secondary rounded-full px-2 py-0.5 text-muted-foreground capitalize">{sos.initiatedByRole}</span>
                    {!!sos.recordingId && (
                      <span className="text-xs bg-teal-900/50 text-teal-400 rounded-full px-2 py-0.5">Recording</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(sos.createdAt).toLocaleTimeString()} · {sos.adminAssignedId ? 'Assigned' : 'Unassigned'}
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-mono font-bold ${sla.color}`}>{sla.label}</span>
                  <div className="text-xs text-muted-foreground">SLA remaining</div>
                </div>
                {!sos.adminAssignedId && (
                  <button
                    className="text-xs bg-teal-600 hover:bg-teal-500 text-white px-3 py-1.5 rounded-full"
                    onClick={(e) => { e.stopPropagation(); assignSos(sos.id); }}
                  >
                    Assign
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Route Deviation Alerts */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-amber-400" />
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Route Deviation Alerts
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="text-xs bg-secondary border border-border rounded px-2 py-1 text-muted-foreground"
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
            >
              <option value="">All risk levels</option>
              <option value="high">High only</option>
              <option value="moderate">Moderate only</option>
              <option value="low">Low only</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-center text-muted-foreground text-sm">Loading…</div>
        ) : filteredDeviations.length === 0 ? (
          <div className="px-4 py-6 text-center text-muted-foreground text-sm">No deviation alerts.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left px-4 py-2">Trip</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Risk</th>
                  <th className="text-right px-4 py-2">Deviation</th>
                  <th className="text-right px-4 py-2">Elapsed / Expected</th>
                  <th className="text-left px-4 py-2">Escalation</th>
                  <th className="text-right px-4 py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {filteredDeviations.map((d) => (
                  <tr
                    key={d.id}
                    className={`hover:bg-secondary/20 ${d.riskLevel === 'high' ? 'border-l-2 border-l-red-500' : ''}`}
                  >
                    <td className="px-4 py-2 font-mono text-white">{d.tripId.slice(0, 8)}…</td>
                    <td className="px-4 py-2">
                      <span className="capitalize text-slate-300">
                        {d.type === 'spatial' ? '📍 Spatial' : '⏱ Time overrun'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${RISK_BADGE[d.riskLevel]}`}>
                        {d.riskLevel}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {d.deviationMiles != null ? `${Number(d.deviationMiles).toFixed(2)} mi` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-300">
                      {d.elapsedMin != null ? `${Number(d.elapsedMin).toFixed(0)}m` : '—'}
                      {d.expectedMin != null ? ` / ${d.expectedMin}m` : ''}
                    </td>
                    <td className="px-4 py-2">
                      {d.escalated ? (
                        <span className={`text-[10px] font-semibold ${d.escalationType === 'admin_alert' ? 'text-red-400' : 'text-amber-400'}`}>
                          {d.escalationType === 'admin_alert' ? '🚨 Admin alerted' : '✉ Check-in sent'}
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {new Date(d.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SOS Detail Panel */}
      {selectedSos && (
        <SosDetailPanel sos={selectedSos} onResolve={resolveSos} onClose={() => setSelectedSos(null)} />
      )}
    </div>
  );
}

function SosDetailPanel({
  sos,
  onResolve,
  onClose,
}: {
  sos: SosEvent;
  onResolve: (id: string, notes: string) => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('');

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-white">SOS Detail</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-white text-sm">Close</button>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Trip ID</span>
            <span className="text-white font-mono text-xs">{sos.tripId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Initiated by</span>
            <span className="text-white capitalize">{sos.initiatedByRole}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">GPS</span>
            <span className="text-white font-mono text-xs">{sos.gpsLat != null ? Number(sos.gpsLat).toFixed(5) : '—'}, {sos.gpsLng != null ? Number(sos.gpsLng).toFixed(5) : '—'}</span>
          </div>
          {!!sos.recordingId && (
            <div className="bg-yellow-950/30 border border-yellow-700 rounded-lg p-3">
              <p className="text-yellow-300 text-xs">
                Audio recording exists. Access requires dual-admin authorization.
                Do not access unless required for investigation.
              </p>
            </div>
          )}
        </div>
        <div>
          <label className="text-sm text-muted-foreground block mb-1">Incident Category</label>
          <select
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-white"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Select category (required to resolve)</option>
            <option value="assault">Assault</option>
            <option value="harassment">Harassment</option>
            <option value="route_deviation">Route Deviation</option>
            <option value="false_sos">False SOS</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-muted-foreground block mb-1">Resolution Notes</label>
          <textarea
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-white h-20 resize-none"
            placeholder="Required before resolving…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <button
          className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm"
          disabled={!notes.trim() || !category}
          onClick={() => onResolve(sos.id, `[${category}] ${notes}`)}
        >
          Mark Resolved
        </button>
      </div>
    </div>
  );
}
