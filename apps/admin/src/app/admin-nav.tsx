'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Shield,
  AlertTriangle,
  DollarSign,
  FileText,
  Brain,
  BarChart2,
  LogOut,
} from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/drivers', label: 'Drivers', icon: Users },
  { href: '/safety', label: 'Safety', icon: Shield },
  { href: '/fraud', label: 'Fraud', icon: AlertTriangle },
  { href: '/earnings-floor', label: 'Earnings Floor', icon: DollarSign },
  { href: '/refunds', label: 'Refunds', icon: FileText },
  { href: '/ai', label: 'AI Models', icon: Brain },
  { href: '/marketplace', label: 'Marketplace', icon: BarChart2 },
];

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <aside className="fixed inset-y-0 left-0 w-56 bg-card border-r border-border flex flex-col z-40">
      {/* Brand */}
      <div className="px-4 py-5 border-b border-border">
        <span className="text-base font-bold text-teal-400">BidRide</span>
        <span className="ml-1.5 text-xs text-muted-foreground font-medium uppercase tracking-widest">
          Admin
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-teal-400/10 text-teal-400'
                  : 'text-muted-foreground hover:text-white hover:bg-secondary/50'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-2 py-3 border-t border-border">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-red-400 hover:bg-red-900/10 transition-colors disabled:opacity-50"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
