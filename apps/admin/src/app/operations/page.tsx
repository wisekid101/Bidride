'use client';

import { useEffect, useState, useCallback } from 'react';

interface ServiceHealth {
  name: string;
  port: number;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latencyMs?: number;
  checkedAt: string;
}

interface SystemMetrics {
  totalTripsToday: number;
  activeTripsNow: number;
  driversOnlineNow: number;
  pendingDriverApprovals: number;
  openFraudAlerts: number;
  openSosEvents: number;
  failedPayoutsLast24h: number;
  avgFareLast24h: number;
}

interface AuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  adminId: string;
  createdAt: string;
}

interface CircuitBreakerStatus {
  breakers: { name: string; state: string; failures: number }[];
  lastUpdated: string;
}

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:3011';

async function apiFetch<T>(path: string): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: token ? `Bearer ${token}` : '' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

const STATUS_COLOR: Record<string, string> = {
  healthy: '#00D4C6',
  degraded: '#F4B400',
  unhealthy: '#EF4444',
  unknown: '#6B7280',
  closed: '#00D4C6',
  open: '#EF4444',
  half_open: '#F4B400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 700,
      background: `${STATUS_COLOR[status] ?? '#6B7280'}22`,
      color: STATUS_COLOR[status] ?? '#6B7280',
      border: `1px solid ${STATUS_COLOR[status] ?? '#6B7280'}44`,
    }}>
      {status.toUpperCase()}
    </span>
  );
}

function MetricCard({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div style={{
      background: '#112D52',
      borderRadius: 12,
      padding: '20px 24px',
      border: warn ? '1px solid #EF444444' : '1px solid #1E3A5F',
      flex: 1,
      minWidth: 140,
    }}>
      <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 6 }}>{label}</div>
      <div style={{
        fontSize: 28,
        fontWeight: 800,
        color: warn ? '#EF4444' : '#FFFFFF',
        fontFamily: 'JetBrains Mono, monospace',
      }}>{value}</div>
    </div>
  );
}

export default function OperationsPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'services' | 'audit' | 'breakers'>('overview');
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [breakers, setBreakers] = useState<CircuitBreakerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s, a, b] = await Promise.all([
        apiFetch<SystemMetrics>('/admin/operations/metrics'),
        apiFetch<ServiceHealth[]>('/admin/operations/health'),
        apiFetch<AuditLog[]>('/admin/operations/audit?limit=50'),
        apiFetch<CircuitBreakerStatus>('/admin/operations/circuit-breakers'),
      ]);
      setMetrics(m);
      setServices(s);
      setAuditLogs(a);
      setBreakers(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'services' as const, label: 'Services' },
    { id: 'breakers' as const, label: 'Circuit Breakers' },
    { id: 'audit' as const, label: 'Audit Log' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#0A2342', color: '#fff', padding: '32px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Operations Center</h1>
          <div style={{ color: '#9CA3AF', fontSize: 13, marginTop: 4 }}>Production reliability & system health</div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            background: '#00D4C6', color: '#0A2342', border: 'none',
            borderRadius: 8, padding: '8px 20px', fontWeight: 700, cursor: 'pointer',
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#EF444422', border: '1px solid #EF4444', borderRadius: 8, padding: 12, marginBottom: 20, color: '#EF4444' }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 28, borderBottom: '1px solid #1E3A5F', paddingBottom: 0 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              background: 'none', border: 'none', color: activeTab === t.id ? '#00D4C6' : '#9CA3AF',
              fontWeight: activeTab === t.id ? 700 : 400, cursor: 'pointer', fontSize: 14,
              padding: '10px 16px', borderBottom: activeTab === t.id ? '2px solid #00D4C6' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && metrics && (
        <div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <MetricCard label="Trips Today" value={metrics.totalTripsToday} />
            <MetricCard label="Active Trips" value={metrics.activeTripsNow} />
            <MetricCard label="Drivers Online" value={metrics.driversOnlineNow} />
            <MetricCard label="Avg Fare (24h)" value={`$${metrics.avgFareLast24h.toFixed(2)}`} />
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <MetricCard label="Pending Approvals" value={metrics.pendingDriverApprovals} warn={metrics.pendingDriverApprovals > 0} />
            <MetricCard label="Open Fraud Alerts" value={metrics.openFraudAlerts} warn={metrics.openFraudAlerts > 0} />
            <MetricCard label="Open SOS Events" value={metrics.openSosEvents} warn={metrics.openSosEvents > 0} />
            <MetricCard label="Failed Payouts (24h)" value={metrics.failedPayoutsLast24h} warn={metrics.failedPayoutsLast24h > 0} />
          </div>
        </div>
      )}

      {/* Services */}
      {activeTab === 'services' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ color: '#9CA3AF', borderBottom: '1px solid #1E3A5F' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Service</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Port</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Latency</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Checked</th>
              </tr>
            </thead>
            <tbody>
              {services.map((svc) => (
                <tr key={svc.name} style={{ borderBottom: '1px solid #1E3A5F' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{svc.name}</td>
                  <td style={{ padding: '10px 12px', color: '#9CA3AF', fontFamily: 'JetBrains Mono, monospace' }}>{svc.port}</td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge status={svc.status} /></td>
                  <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', color: '#9CA3AF' }}>
                    {svc.latencyMs != null ? `${svc.latencyMs}ms` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#9CA3AF', fontSize: 12 }}>
                    {new Date(svc.checkedAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Circuit Breakers */}
      {activeTab === 'breakers' && breakers && (
        <div>
          <div style={{ color: '#9CA3AF', fontSize: 12, marginBottom: 16 }}>
            Last updated: {new Date(breakers.lastUpdated).toLocaleTimeString()}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {breakers.breakers.map((b) => (
              <div key={b.name} style={{
                background: '#112D52', borderRadius: 12, padding: '20px 24px',
                border: `1px solid ${STATUS_COLOR[b.state] ?? '#1E3A5F'}44`,
                minWidth: 180,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{b.name}</div>
                <StatusBadge status={b.state} />
                <div style={{ marginTop: 8, color: '#9CA3AF', fontSize: 13 }}>
                  Failures: <span style={{ color: b.failures > 0 ? '#EF4444' : '#fff', fontFamily: 'JetBrains Mono, monospace' }}>{b.failures}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Log */}
      {activeTab === 'audit' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#9CA3AF', borderBottom: '1px solid #1E3A5F' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Time</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Action</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Target</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Admin ID</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #1E3A5F' }}>
                  <td style={{ padding: '8px 12px', color: '#9CA3AF', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#00D4C6', fontWeight: 600 }}>{log.action}</td>
                  <td style={{ padding: '8px 12px', color: '#9CA3AF' }}>
                    {log.targetType} · <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{log.targetId.slice(0, 8)}…</span>
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                    {log.adminId.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {auditLogs.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9CA3AF', padding: 40 }}>No audit logs found.</div>
          )}
        </div>
      )}
    </div>
  );
}
