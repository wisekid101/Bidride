'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Eye, ExternalLink, Clock } from 'lucide-react';

interface FraudAlert {
  id: string;
  userId: string;
  userType: 'rider' | 'driver';
  userName: string;
  fraudProbability: number;
  triggerReason: string;
  tripId?: string;
  createdAt: string;
  status: 'pending' | 'reviewed' | 'cleared';
  holdActive: boolean;
}

const FRAUD_THRESHOLD_LABEL = 90;

export default function FraudPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'pending' | 'reviewed'>('pending');
  const [selected, setSelected] = useState<FraudAlert | null>(null);

  const { data: alerts, isLoading } = useQuery<FraudAlert[]>({
    queryKey: ['fraud-alerts', activeTab],
    queryFn: async () => {
      const res = await fetch(`/api/admin/fraud?status=${activeTab}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const reviewMutation = useMutation({
    mutationFn: async ({
      alertId,
      decision,
      notes,
    }: {
      alertId: string;
      decision: 'clear' | 'escalate';
      notes: string;
    }) => {
      const res = await fetch(`/api/admin/fraud/${alertId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes }),
      });
      if (!res.ok) throw new Error('Review failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fraud-alerts'] });
      setSelected(null);
    },
  });

  const [reviewNotes, setReviewNotes] = useState('');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Fraud Detection</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-flagged when fraud probability ≥ {FRAUD_THRESHOLD_LABEL}%. All decisions require human review.
          </p>
        </div>
        <div className="bg-red-900/20 text-red-400 text-sm font-medium px-3 py-1.5 rounded-full border border-red-900">
          No Automated Bans
        </div>
      </div>

      {/* Policy reminder */}
      <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-yellow-400">Human Review Required</p>
          <p className="text-xs text-yellow-400/80 mt-1">
            Account holds are automatic. Permanent actions (suspension, ban) require a human admin decision.
            Do not take permanent action without reviewing all context.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        {(['pending', 'reviewed'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-teal-400 text-teal-400'
                : 'border-transparent text-muted-foreground hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Alert table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading && (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading alerts…</div>
        )}
        {!isLoading && (!alerts || alerts.length === 0) && (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No {activeTab} fraud alerts.
          </div>
        )}

        <div className="divide-y divide-border">
          {alerts?.map((alert) => (
            <div
              key={alert.id}
              className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/30 cursor-pointer"
              onClick={() => {
                setSelected(alert);
                setReviewNotes('');
              }}
            >
              {/* Probability badge */}
              <div className="w-14 text-center">
                <span
                  className={`text-sm font-bold font-mono ${
                    alert.fraudProbability >= 95
                      ? 'text-red-400'
                      : alert.fraudProbability >= 90
                      ? 'text-orange-400'
                      : 'text-yellow-400'
                  }`}
                >
                  {alert.fraudProbability}%
                </span>
              </div>

              {/* User info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{alert.userName}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground capitalize">
                    {alert.userType}
                  </span>
                  {alert.holdActive && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-800">
                      Hold Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{alert.triggerReason}</p>
              </div>

              {/* Time */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {new Date(alert.createdAt).toLocaleString()}
              </div>

              <Eye className="w-4 h-4 text-muted-foreground" />
            </div>
          ))}
        </div>
      </div>

      {/* Review Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">{selected.userName}</h2>
                <p className="text-sm text-muted-foreground capitalize">{selected.userType}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold font-mono text-red-400">
                  {selected.fraudProbability}%
                </p>
                <p className="text-xs text-muted-foreground">fraud probability</p>
              </div>
            </div>

            <div className="bg-secondary/50 rounded-xl p-4 space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                Trigger Reason
              </p>
              <p className="text-sm text-white">{selected.triggerReason}</p>
              {selected.tripId && (
                <a
                  href={`/trips/${selected.tripId}`}
                  className="flex items-center gap-1 text-xs text-teal-400 hover:underline"
                >
                  View Trip <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {selected.holdActive && (
              <div className="bg-red-900/20 border border-red-800 rounded-xl p-3 text-sm text-red-400">
                Account is currently on payment hold. Clearing this alert will release the hold.
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Review Notes (required)
              </label>
              <textarea
                className="w-full bg-secondary border border-border rounded-xl p-3 text-sm text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-teal-400"
                rows={3}
                placeholder="Document your findings and decision rationale…"
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSelected(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2.5 text-sm font-medium hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  reviewMutation.mutate({
                    alertId: selected.id,
                    decision: 'clear',
                    notes: reviewNotes,
                  })
                }
                disabled={!reviewNotes.trim() || reviewMutation.isPending}
                className="flex-1 bg-teal-400 text-navy-950 rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
              >
                Clear Alert
              </button>
              <button
                onClick={() =>
                  reviewMutation.mutate({
                    alertId: selected.id,
                    decision: 'escalate',
                    notes: reviewNotes,
                  })
                }
                disabled={!reviewNotes.trim() || reviewMutation.isPending}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50"
              >
                Escalate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
