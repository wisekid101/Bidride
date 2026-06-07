'use client';

import { useState, useEffect } from 'react';
import { Shield, AlertTriangle, Phone } from 'lucide-react';

interface SosEvent {
  id: string;
  tripId: string;
  initiatedByRole: 'rider' | 'driver';
  status: 'active' | 'assigned' | 'resolved';
  createdAt: string;
  slaDeadline: string;
  gpsLat: number;
  gpsLng: number;
  adminAssignedId: string | null;
  recordingExists: boolean;
}

interface PanicEvent {
  id: string;
  tripId: string;
  initiatedByRole: 'rider' | 'driver';
  createdAt: string;
  adminAssignedId: string | null;
  // Note: DO NOT display rider identity on panic — contact driver only
}

export default function SafetyPage() {
  const [sosQueue, setSosQueue] = useState<SosEvent[]>([]);
  const [panicQueue, setPanicQueue] = useState<PanicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSos, setSelectedSos] = useState<SosEvent | null>(null);

  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchQueues = async () => {
    try {
      const [sosRes, panicRes] = await Promise.all([
        fetch('/api/admin/safety/sos?status=active'),
        fetch('/api/admin/safety/panic?status=active'),
      ]);
      const [sos, panic] = await Promise.all([sosRes.json(), panicRes.json()]);
      setSosQueue(sos);
      setPanicQueue(panic);
    } catch {
      /* handled by retry interval */
    } finally {
      setLoading(false);
    }
  };

  const assignSos = async (sosId: string) => {
    await fetch(`/api/admin/safety/sos/${sosId}/assign`, { method: 'POST' });
    fetchQueues();
  };

  const resolveSos = async (sosId: string, notes: string) => {
    await fetch(`/api/admin/safety/sos/${sosId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    fetchQueues();
    setSelectedSos(null);
  };

  const getSlaStatus = (deadline: string) => {
    const secondsLeft = (new Date(deadline).getTime() - Date.now()) / 1000;
    if (secondsLeft < 0) return { label: 'BREACHED', color: 'text-red-500', urgent: true };
    if (secondsLeft < 30) return { label: `${Math.round(secondsLeft)}s`, color: 'text-red-400', urgent: true };
    if (secondsLeft < 60) return { label: `${Math.round(secondsLeft)}s`, color: 'text-yellow-400', urgent: false };
    return { label: `${Math.round(secondsLeft)}s`, color: 'text-teal-400', urgent: false };
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-red-400" />
        <h1 className="text-2xl font-bold text-white">Safety Incident Center</h1>
      </div>

      {/* Panic Queue — DO NOT CONTACT RIDER rule is prominently displayed */}
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
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            No active SOS events. All clear.
          </div>
        )}

        <div className="divide-y divide-border">
          {sosQueue.map((sos) => {
            const sla = getSlaStatus(sos.slaDeadline);
            return (
              <div
                key={sos.id}
                className={`px-4 py-3 flex items-center gap-4 cursor-pointer hover:bg-secondary/30 ${
                  sla.urgent ? 'border-l-2 border-l-red-500' : ''
                }`}
                onClick={() => setSelectedSos(sos)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      Trip {sos.tripId.slice(0, 8)}…
                    </span>
                    <span className="text-xs bg-secondary rounded-full px-2 py-0.5 text-muted-foreground capitalize">
                      {sos.initiatedByRole}
                    </span>
                    {sos.recordingExists && (
                      <span className="text-xs bg-teal-900/50 text-teal-400 rounded-full px-2 py-0.5">
                        Recording
                      </span>
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

      {/* SOS Detail Panel */}
      {selectedSos && (
        <SosDetailPanel
          sos={selectedSos}
          onResolve={resolveSos}
          onClose={() => setSelectedSos(null)}
        />
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
          <button onClick={onClose} className="text-muted-foreground hover:text-white text-sm">
            Close
          </button>
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
            <span className="text-white font-mono text-xs">
              {sos.gpsLat.toFixed(5)}, {sos.gpsLng.toFixed(5)}
            </span>
          </div>
          {sos.recordingExists && (
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
