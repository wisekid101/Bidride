'use client';

import { useEffect, useState, useCallback } from 'react';

interface SupportTicket {
  id: string;
  userId: string;
  role: 'rider' | 'driver';
  category: string;
  subject: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  updatedAt: string;
}

interface SupportStats {
  openTickets: number;
  inProgressTickets: number;
  resolvedToday: number;
  urgentTickets: number;
  avgResolutionHours: number;
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
  open: '#F4B400',
  in_progress: '#00D4C6',
  resolved: '#22C55E',
  closed: '#6B7280',
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#EF4444',
  high: '#F97316',
  medium: '#F4B400',
  low: '#6B7280',
};

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 700,
      background: `${color}22`,
      color,
      border: `1px solid ${color}44`,
    }}>
      {label.toUpperCase().replace('_', ' ')}
    </span>
  );
}

function StatCard({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
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

export default function SupportPage() {
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [filter, setFilter] = useState<'all' | 'open' | 'urgent'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ticketData = await apiFetch<SupportTicket[]>('/admin/support/tickets?limit=50').catch(() => []);
      const statsData = await apiFetch<SupportStats>('/admin/support/stats').catch(() => null);
      setTickets(ticketData);
      setStats(statsData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredTickets = tickets.filter((t) => {
    if (filter === 'open') return t.status === 'open' || t.status === 'in_progress';
    if (filter === 'urgent') return t.priority === 'urgent';
    return true;
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0A2342', color: '#fff', padding: '32px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Support Center</h1>
          <div style={{ color: '#9CA3AF', fontSize: 13, marginTop: 4 }}>Rider & driver support tickets</div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            background: '#00D4C6', color: '#0A2342', border: 'none',
            borderRadius: 8, padding: '8px 20px', fontWeight: 700, cursor: 'pointer',
          }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#EF444422', border: '1px solid #EF4444', borderRadius: 8, padding: 12, marginBottom: 20, color: '#EF4444' }}>
          {error} — Support ticket API not yet implemented. This page will display live tickets when the support module is complete.
        </div>
      )}

      {/* Stats */}
      {stats ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
          <StatCard label="Open Tickets" value={stats.openTickets} warn={stats.openTickets > 10} />
          <StatCard label="In Progress" value={stats.inProgressTickets} />
          <StatCard label="Resolved Today" value={stats.resolvedToday} />
          <StatCard label="Urgent" value={stats.urgentTickets} warn={stats.urgentTickets > 0} />
          <StatCard label="Avg Resolution (h)" value={stats.avgResolutionHours.toFixed(1)} />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
          {['Open Tickets', 'In Progress', 'Resolved Today', 'Urgent'].map((l) => (
            <StatCard key={l} label={l} value="—" />
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['open', 'urgent', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: 'none', border: 'none',
              color: filter === f ? '#00D4C6' : '#9CA3AF',
              fontWeight: filter === f ? 700 : 400,
              cursor: 'pointer', fontSize: 14,
              padding: '8px 16px',
              borderBottom: filter === f ? '2px solid #00D4C6' : '2px solid transparent',
            }}
          >
            {f === 'open' ? 'Open / In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Ticket table */}
      {filteredTickets.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#9CA3AF', borderBottom: '1px solid #1E3A5F' }}>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Subject</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Category</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Priority</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #1E3A5F' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#9CA3AF' }}>
                    {t.id.slice(0, 8)}…
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge label={t.role} color={t.role === 'driver' ? '#00D4C6' : '#F4B400'} />
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, maxWidth: 280 }}>{t.subject}</td>
                  <td style={{ padding: '10px 12px', color: '#9CA3AF' }}>{t.category}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge label={t.priority} color={PRIORITY_COLOR[t.priority] ?? '#6B7280'} />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge label={t.status} color={STATUS_COLOR[t.status] ?? '#6B7280'} />
                  </td>
                  <td style={{ padding: '10px 12px', color: '#9CA3AF', fontSize: 12 }}>
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: '#9CA3AF', padding: 60 }}>
          {loading ? 'Loading tickets…' : 'No tickets found for this filter.'}
          {!loading && tickets.length === 0 && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              Support ticket management will be live in a future sprint.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
