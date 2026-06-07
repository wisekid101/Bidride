'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, RefreshCw } from 'lucide-react';

interface Refund {
  id: string;
  tripId: string;
  amount: number;
  reason: string;
  notes: string;
  issuedByAdminId: string;
  createdAt: string;
  trip: {
    pickupAddress: string;
    dropoffAddress: string;
    finalFare: number;
  };
}

const REFUND_REASONS = [
  { key: 'overcharge', label: 'Overcharge' },
  { key: 'driver_cancelled', label: 'Driver Cancelled' },
  { key: 'poor_service', label: 'Poor Service' },
  { key: 'safety_incident', label: 'Safety Incident' },
  { key: 'technical_error', label: 'Technical Error' },
  { key: 'goodwill', label: 'Goodwill' },
];

export default function RefundsPage() {
  const queryClient = useQueryClient();
  const [tripIdSearch, setTripIdSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    tripId: '',
    amount: '',
    reason: '',
    notes: '',
  });
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery<{ refunds: Refund[]; total: number }>({
    queryKey: ['refunds', tripIdSearch],
    queryFn: async () => {
      const params = tripIdSearch ? `?tripId=${tripIdSearch}` : '';
      const res = await fetch(`/api/admin/refunds${params}`);
      return res.json();
    },
  });

  const issueMutation = useMutation({
    mutationFn: async (dto: typeof form) => {
      const res = await fetch('/api/admin/refunds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...dto, amount: parseFloat(dto.amount) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Refund failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refunds'] });
      setShowModal(false);
      setForm({ tripId: '', amount: '', reason: '', notes: '' });
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Refunds</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-teal-400 text-navy-950 px-4 py-2 rounded-xl text-sm font-bold hover:bg-teal-300 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Issue Refund
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Filter by Trip ID…"
          className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal-400"
          value={tripIdSearch}
          onChange={(e) => setTripIdSearch(e.target.value)}
        />
      </div>

      {/* Refund table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="text-left px-4 py-3 font-medium">Trip</th>
              <th className="text-left px-4 py-3 font-medium">Reason</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-right px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && !data?.refunds?.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No refunds found.
                </td>
              </tr>
            )}
            {data?.refunds?.map((refund) => (
              <tr key={refund.id} className="hover:bg-secondary/20">
                <td className="px-4 py-3">
                  <p className="text-white font-medium text-xs truncate max-w-xs">
                    {refund.trip?.pickupAddress} → {refund.trip?.dropoffAddress}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">{refund.tripId.slice(0, 8)}…</p>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-muted-foreground capitalize">
                    {refund.reason.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold text-white">
                  -${refund.amount.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  {new Date(refund.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Issue Refund Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6 space-y-5">
            <h2 className="text-lg font-bold text-white">Issue Refund</h2>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Trip ID
                </label>
                <input
                  className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-400"
                  placeholder="Trip UUID"
                  value={form.tripId}
                  onChange={(e) => setForm((p) => ({ ...p, tripId: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Amount ($)
                </label>
                <input
                  className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-1 focus:ring-teal-400"
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Reason
                </label>
                <select
                  className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-teal-400"
                  value={form.reason}
                  onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                >
                  <option value="">Select a reason…</option>
                  {REFUND_REASONS.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Notes
                </label>
                <textarea
                  className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-teal-400"
                  rows={3}
                  placeholder="Document the reason for this refund…"
                  value={form.notes}
                  onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowModal(false);
                  setError('');
                }}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2.5 text-sm font-medium hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => issueMutation.mutate(form)}
                disabled={
                  !form.tripId ||
                  !form.amount ||
                  !form.reason ||
                  !form.notes ||
                  issueMutation.isPending
                }
                className="flex-1 bg-teal-400 text-navy-950 rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
              >
                {issueMutation.isPending ? 'Processing…' : 'Issue Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
