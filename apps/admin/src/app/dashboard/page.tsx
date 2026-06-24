'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  AlertTriangle,
  Car,
  Shield,
  TrendingUp,
  Clock,
  Users,
} from 'lucide-react';

interface LiveMetrics {
  activeTrips: number;
  onlineDrivers: number;
  openSosSessions: number;
  avgResponseTimeSeconds: number;
  slaBreachCount: number;
  todayGmv: number;
}

interface ActivityFeedItem {
  id: string;
  type: 'sos' | 'trip' | 'driver' | 'fraud';
  message: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<LiveMetrics>({
    activeTrips: 0,
    onlineDrivers: 0,
    openSosSessions: 0,
    avgResponseTimeSeconds: 0,
    slaBreachCount: 0,
    todayGmv: 0,
  });
  const [feed, setFeed] = useState<ActivityFeedItem[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const s = io(process.env.NEXT_PUBLIC_API_URL ?? 'https://api.bidride.com', {
      // Cookie is HttpOnly — browser sends it automatically with withCredentials
      withCredentials: true,
      transports: ['websocket'],
    });

    s.on('ops:activity', (data: Partial<LiveMetrics>) => {
      setMetrics((prev) => ({ ...prev, ...data }));
    });

    s.on('safety:sos_new', (data: { sosId: string; tripId: string }) => {
      setFeed((prev) => [
        {
          id: data.sosId,
          type: 'sos',
          message: `SOS activated on trip ${data.tripId.slice(0, 8)}…`,
          timestamp: new Date().toISOString(),
          severity: 'critical',
        },
        ...prev.slice(0, 49),
      ]);
      setMetrics((prev) => ({ ...prev, openSosSessions: prev.openSosSessions + 1 }));
    });

    s.on('fraud:alert', (data: { userId: string }) => {
      setFeed((prev) => [
        {
          id: data.userId,
          type: 'fraud',
          message: `Fraud alert — account ${data.userId.slice(0, 8)}… auto-held`,
          timestamp: new Date().toISOString(),
          severity: 'warning',
        },
        ...prev.slice(0, 49),
      ]);
    });

    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Live Operations</h1>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          <span className="text-sm text-muted-foreground">Live</span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          label="Active Trips"
          value={metrics.activeTrips.toString()}
          icon={<Car className="w-5 h-5" />}
          color="teal"
        />
        <MetricCard
          label="Online Drivers"
          value={metrics.onlineDrivers.toString()}
          icon={<Users className="w-5 h-5" />}
          color="teal"
        />
        <MetricCard
          label="Open SOS"
          value={metrics.openSosSessions.toString()}
          icon={<Shield className="w-5 h-5" />}
          color={metrics.openSosSessions > 0 ? 'red' : 'teal'}
          urgent={metrics.openSosSessions > 0}
        />
        <MetricCard
          label="Avg Response (SOS)"
          value={`${metrics.avgResponseTimeSeconds}s`}
          icon={<Clock className="w-5 h-5" />}
          color={metrics.avgResponseTimeSeconds > 90 ? 'red' : 'teal'}
          target="< 90s SLA"
        />
        <MetricCard
          label="SLA Breaches"
          value={metrics.slaBreachCount.toString()}
          icon={<AlertTriangle className="w-5 h-5" />}
          color={metrics.slaBreachCount > 0 ? 'red' : 'teal'}
        />
        <MetricCard
          label="Today's GMV"
          value={`$${metrics.todayGmv.toFixed(2)}`}
          icon={<TrendingUp className="w-5 h-5" />}
          color="gold"
          mono
        />
      </div>

      {/* Activity Feed */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Live Activity Feed
          </h2>
        </div>
        <div className="divide-y divide-border max-h-80 overflow-y-auto">
          {feed.length === 0 && (
            <div className="px-4 py-6 text-center text-muted-foreground text-sm">
              No activity yet. Waiting for events…
            </div>
          )}
          {feed.map((item) => (
            <FeedItem key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  color,
  urgent,
  target,
  mono,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: 'teal' | 'red' | 'gold';
  urgent?: boolean;
  target?: string;
  mono?: boolean;
}) {
  const colorMap = {
    teal: 'text-teal-400',
    red: 'text-red-400',
    gold: 'text-yellow-400',
  };

  return (
    <div
      className={`bg-card rounded-xl border p-4 ${
        urgent ? 'border-red-500 shadow-lg shadow-red-900/30' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={colorMap[color]}>{icon}</span>
      </div>
      <p
        className={`text-3xl font-extrabold ${colorMap[color]} ${mono ? 'font-mono-financial' : ''}`}
      >
        {value}
      </p>
      {target && (
        <p className="text-xs text-muted-foreground mt-1">{target}</p>
      )}
    </div>
  );
}

function FeedItem({ item }: { item: ActivityFeedItem }) {
  const severityColors = {
    info: 'bg-teal-500',
    warning: 'bg-yellow-500',
    critical: 'bg-red-500 animate-pulse',
  };

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityColors[item.severity]}`} />
      <span className="flex-1 text-sm text-white">{item.message}</span>
      <span className="text-xs text-muted-foreground flex-shrink-0">
        {new Date(item.timestamp).toLocaleTimeString()}
      </span>
    </div>
  );
}
