'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronRight, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';

interface Driver {
  id: string;
  legalFirstName: string;
  legalLastName: string;
  status: 'pending' | 'under_review' | 'action_required' | 'approved' | 'declined' | 'suspended';
  appliedAt: string;
  totalTrips: number;
  avgRating: number;
  currentBadge: 'verified' | 'trusted' | 'vip';
  backgroundCheckStatus: string;
}

const STATUS_CONFIG = {
  pending:          { label: 'Pending',       color: 'text-yellow-400 bg-yellow-900/20', icon: Clock },
  under_review:     { label: 'Under Review',  color: 'text-blue-400 bg-blue-900/20',   icon: Clock },
  action_required:  { label: 'Action Needed', color: 'text-orange-400 bg-orange-900/20', icon: AlertCircle },
  approved:         { label: 'Approved',      color: 'text-teal-400 bg-teal-900/20',   icon: CheckCircle },
  declined:         { label: 'Declined',      color: 'text-red-400 bg-red-900/20',     icon: XCircle },
  suspended:        { label: 'Suspended',     color: 'text-red-400 bg-red-900/20',     icon: XCircle },
};

// Chip label → DriverStatus enum value (null = no filter)
const QUICK_FILTERS: Array<{ label: string; status: string | null }> = [
  { label: 'All', status: null },
  { label: 'Pending', status: 'pending' },
  { label: 'Under Review', status: 'under_review' },
  { label: 'Action Required', status: 'action_required' },
  { label: 'Approved', status: 'approved' },
  { label: 'Declined', status: 'declined' },
  { label: 'Suspended', status: 'suspended' },
];

export default function DriversPage() {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('All');

  const { data: drivers, isLoading } = useQuery<Driver[]>({
    queryKey: ['drivers', search, activeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const filter = QUICK_FILTERS.find((f) => f.label === activeFilter);
      if (filter?.status) params.set('status', filter.status);
      const res = await fetch(`/api/admin/drivers?${params}`);
      return res.json();
    },
    staleTime: 30000,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Driver Management</h1>
        <span className="text-sm text-muted-foreground">
          {drivers?.length ?? 0} drivers
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, phone, or ID…"
          className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal-400"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Quick Filter Chips */}
      <div className="flex gap-2 flex-wrap">
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.label}
            onClick={() => setActiveFilter(filter.label)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeFilter === filter.label
                ? 'bg-teal-400 text-navy-950 border-teal-400'
                : 'bg-card text-muted-foreground border-border hover:border-teal-400/50'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Driver List */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading && (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading drivers…</div>
        )}

        {!isLoading && (!drivers || drivers.length === 0) && (
          <div className="p-6 text-center text-muted-foreground text-sm">No drivers found.</div>
        )}

        <div className="divide-y divide-border">
          {drivers?.map((driver) => {
            const statusCfg = STATUS_CONFIG[driver.status];
            const StatusIcon = statusCfg.icon;

            return (
              <Link
                key={driver.id}
                href={`/drivers/${driver.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/30 transition-colors group"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-semibold text-white">
                    {driver.legalFirstName[0]}{driver.legalLastName[0]}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white text-sm">
                      {driver.legalFirstName} {driver.legalLastName}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      Applied {new Date(driver.appliedAt).toLocaleDateString()}
                    </span>
                    {driver.status === 'approved' && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{driver.totalTrips} trips</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">★ {Number(driver.avgRating).toFixed(1)}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Badge */}
                <span className="text-xs text-teal-400 capitalize hidden sm:block">
                  {driver.currentBadge}
                </span>

                {/* Arrow */}
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-white transition-colors flex-shrink-0" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
