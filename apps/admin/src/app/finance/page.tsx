'use client';

import { useEffect, useState, useCallback } from 'react';

interface RevenueSummary {
  grossRevenue: number;
  netRevenue: number;
  totalRefunds: number;
  platformCommission: number;
  tipRevenue: number;
  paymentCount: number;
  refundCount: number;
}

interface PayoutSummary {
  totalPaid: number;
  payoutCount: number;
  pendingAvailable: number;
  pendingHeld: number;
  failedPayouts: { id: string; driverId: string; amount: number; failureReason: string | null; createdAt: string }[];
}

interface Liabilities {
  totalAvailableWalletBalance: number;
  totalPendingWalletBalance: number;
  totalOutstanding: number;
  driverCount: number;
  partialRefundOutstanding: number;
}

interface RefundTotals {
  totalAmount: number;
  count: number;
  byReason: { reason: string; total: number; count: number }[];
}

interface FailedPayment {
  id: string;
  tripId: string;
  amount: number;
  stripePaymentIntentId: string;
  createdAt: string;
}

interface ReconciliationEntry {
  id: string;
  stripeObjectId: string;
  stripeObjectType: string;
  stripeAmount: number;
  localAmount: number | null;
  status: string;
  mismatchReason: string | null;
  createdAt: string;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

const STATUS_BADGE: Record<string, string> = {
  mismatch: 'bg-red-900 text-red-200',
  orphan: 'bg-amber-900 text-amber-200',
  matched: 'bg-teal-900 text-teal-200',
  resolved: 'bg-slate-700 text-slate-300',
};

export default function FinanceCenterPage() {
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [payouts, setPayouts] = useState<PayoutSummary | null>(null);
  const [liabilities, setLiabilities] = useState<Liabilities | null>(null);
  const [refunds, setRefunds] = useState<RefundTotals | null>(null);
  const [failedPayments, setFailedPayments] = useState<FailedPayment[]>([]);
  const [mismatches, setMismatches] = useState<ReconciliationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'payouts' | 'refunds' | 'reconciliation'>('overview');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [revRes, payRes, liabRes, refRes, failRes, reconRes] = await Promise.all([
        fetch('/api/admin/finance/revenue'),
        fetch('/api/admin/finance/payouts'),
        fetch('/api/admin/finance/liabilities'),
        fetch('/api/admin/finance/refunds'),
        fetch('/api/admin/finance/failed-payments'),
        fetch('/api/admin/finance/reconciliation'),
      ]);
      const [rev, pay, liab, ref, fail, recon] = await Promise.all([
        revRes.json(),
        payRes.json(),
        liabRes.json(),
        refRes.json(),
        failRes.json(),
        reconRes.json(),
      ]);
      setRevenue(rev);
      setPayouts(pay);
      setLiabilities(liab);
      setRefunds(ref);
      setFailedPayments(Array.isArray(fail) ? fail : []);
      setMismatches(Array.isArray(recon) ? recon : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'payouts', label: 'Driver Payouts' },
    { key: 'refunds', label: 'Refunds' },
    { key: 'reconciliation', label: `Reconciliation${mismatches.length > 0 ? ` (${mismatches.length})` : ''}` },
  ] as const;

  return (
    <div className="min-h-screen bg-[#0A2342] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Finance Center</h1>
          <button
            onClick={() => void fetchAll()}
            className="px-4 py-2 bg-[#00D4C6] text-[#0A2342] font-semibold rounded-lg hover:opacity-90"
          >
            Refresh
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 border-b border-slate-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.key
                  ? 'bg-[#00D4C6] text-[#0A2342]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="text-slate-400 text-center py-12">Loading financial data...</div>
        )}

        {/* ── Overview ── */}
        {!loading && activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Gross Revenue (30d)', value: fmt(revenue?.grossRevenue ?? 0), accent: true },
                { label: 'Net Revenue (30d)', value: fmt(revenue?.netRevenue ?? 0), accent: true },
                { label: 'Platform Commission', value: fmt(revenue?.platformCommission ?? 0) },
                { label: 'Tip Revenue', value: fmt(revenue?.tipRevenue ?? 0) },
              ].map((card) => (
                <div key={card.label} className="bg-slate-800 rounded-xl p-4">
                  <div className="text-slate-400 text-xs mb-1">{card.label}</div>
                  <div className={`text-xl font-bold font-mono ${card.accent ? 'text-[#00D4C6]' : 'text-white'}`}>
                    {card.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Outstanding Liabilities */}
            <div className="bg-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Outstanding Liabilities</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-slate-400 text-xs">Available Wallet Balance</div>
                  <div className="text-white font-mono font-bold">{fmt(liabilities?.totalAvailableWalletBalance ?? 0)}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Pending (2h hold)</div>
                  <div className="text-white font-mono font-bold">{fmt(liabilities?.totalPendingWalletBalance ?? 0)}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Total Outstanding</div>
                  <div className="text-amber-400 font-mono font-bold">{fmt(liabilities?.totalOutstanding ?? 0)}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-xs">Active Drivers</div>
                  <div className="text-white font-bold">{liabilities?.driverCount ?? 0}</div>
                </div>
              </div>
            </div>

            {/* Failed Payments */}
            {failedPayments.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
                  Failed Payments ({failedPayments.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-xs border-b border-slate-700">
                        <th className="text-left pb-2">Trip ID</th>
                        <th className="text-left pb-2">Amount</th>
                        <th className="text-left pb-2">Stripe PI</th>
                        <th className="text-left pb-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedPayments.slice(0, 10).map((p) => (
                        <tr key={p.id} className="border-b border-slate-700/50">
                          <td className="py-2 font-mono text-xs text-slate-300">{p.tripId.slice(0, 8)}…</td>
                          <td className="py-2 font-mono text-red-400">{fmt(Number(p.amount))}</td>
                          <td className="py-2 font-mono text-xs text-slate-400">{p.stripePaymentIntentId}</td>
                          <td className="py-2 text-xs text-slate-400">{new Date(p.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Driver Payouts ── */}
        {!loading && activeTab === 'payouts' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="text-slate-400 text-xs mb-1">Total Paid (30d)</div>
                <div className="text-[#F4B400] text-xl font-bold font-mono">{fmt(payouts?.totalPaid ?? 0)}</div>
                <div className="text-slate-500 text-xs mt-1">{payouts?.payoutCount ?? 0} payouts</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="text-slate-400 text-xs mb-1">Pending Available</div>
                <div className="text-white text-xl font-bold font-mono">{fmt(payouts?.pendingAvailable ?? 0)}</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="text-slate-400 text-xs mb-1">Held (2h)</div>
                <div className="text-slate-300 text-xl font-bold font-mono">{fmt(payouts?.pendingHeld ?? 0)}</div>
              </div>
            </div>

            {payouts?.failedPayouts && payouts.failedPayouts.length > 0 && (
              <div className="bg-slate-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
                  Failed Payouts ({payouts.failedPayouts.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-xs border-b border-slate-700">
                        <th className="text-left pb-2">Driver ID</th>
                        <th className="text-left pb-2">Amount</th>
                        <th className="text-left pb-2">Reason</th>
                        <th className="text-left pb-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.failedPayouts.map((p) => (
                        <tr key={p.id} className="border-b border-slate-700/50">
                          <td className="py-2 font-mono text-xs text-slate-300">{p.driverId.slice(0, 8)}…</td>
                          <td className="py-2 font-mono text-red-400">{fmt(Number(p.amount))}</td>
                          <td className="py-2 text-xs text-slate-400">{p.failureReason ?? '—'}</td>
                          <td className="py-2 text-xs text-slate-400">{new Date(p.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Refunds ── */}
        {!loading && activeTab === 'refunds' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="text-slate-400 text-xs mb-1">Total Refunded (30d)</div>
                <div className="text-red-400 text-xl font-bold font-mono">{fmt(refunds?.totalAmount ?? 0)}</div>
                <div className="text-slate-500 text-xs mt-1">{refunds?.count ?? 0} refunds</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-4">
                <div className="text-slate-400 text-xs mb-1">Payment Count</div>
                <div className="text-white text-xl font-bold">{revenue?.paymentCount ?? 0}</div>
                <div className="text-slate-500 text-xs mt-1">
                  Refund rate: {revenue?.paymentCount ? ((refunds?.count ?? 0) / revenue.paymentCount * 100).toFixed(1) : '0.0'}%
                </div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">By Reason</h2>
              <div className="space-y-2">
                {(refunds?.byReason ?? []).map((r) => (
                  <div key={r.reason} className="flex items-center justify-between py-2 border-b border-slate-700/50">
                    <div className="text-sm text-slate-300 capitalize">{r.reason.replace(/_/g, ' ')}</div>
                    <div className="flex gap-6 text-right">
                      <div className="text-xs text-slate-400">{r.count}x</div>
                      <div className="font-mono font-bold text-red-400 w-20">{fmt(r.total)}</div>
                    </div>
                  </div>
                ))}
                {(refunds?.byReason ?? []).length === 0 && (
                  <div className="text-slate-500 text-sm">No refunds in this period.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Reconciliation ── */}
        {!loading && activeTab === 'reconciliation' && (
          <div className="space-y-4">
            <div className="bg-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">
                Stripe Reconciliation — Mismatches &amp; Orphans
              </h2>
              {mismatches.length === 0 ? (
                <div className="text-[#00D4C6] text-sm">All records reconciled.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-xs border-b border-slate-700">
                        <th className="text-left pb-2">Stripe ID</th>
                        <th className="text-left pb-2">Type</th>
                        <th className="text-left pb-2">Stripe Amt</th>
                        <th className="text-left pb-2">Local Amt</th>
                        <th className="text-left pb-2">Status</th>
                        <th className="text-left pb-2">Reason</th>
                        <th className="text-left pb-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mismatches.map((m) => (
                        <tr key={m.id} className="border-b border-slate-700/50">
                          <td className="py-2 font-mono text-xs text-slate-300">{m.stripeObjectId}</td>
                          <td className="py-2 text-xs text-slate-400">{m.stripeObjectType}</td>
                          <td className="py-2 font-mono text-white">{fmt(Number(m.stripeAmount))}</td>
                          <td className="py-2 font-mono text-slate-400">
                            {m.localAmount != null ? fmt(Number(m.localAmount)) : '—'}
                          </td>
                          <td className="py-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[m.status] ?? 'bg-slate-700 text-slate-300'}`}>
                              {m.status}
                            </span>
                          </td>
                          <td className="py-2 text-xs text-slate-400 max-w-xs truncate">{m.mismatchReason ?? '—'}</td>
                          <td className="py-2 text-xs text-slate-400">{new Date(m.createdAt).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
