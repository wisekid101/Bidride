'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Mail, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as any).message ?? 'Login failed. Check your credentials.');
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError('Unable to reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-teal-400/10 border border-teal-400/30 mb-4">
            <Lock className="w-6 h-6 text-teal-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">BidiRide Admin</h1>
          <p className="text-sm text-muted-foreground mt-1">Authorized personnel only</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 bg-red-900/20 border border-red-700 rounded-xl px-4 py-3 mb-4">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
              Email address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-secondary border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-400"
                placeholder="you@bidride.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-secondary border border-border rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-400/50 focus:border-teal-400"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-400 hover:bg-teal-300 disabled:opacity-50 text-navy-950 font-bold py-3 rounded-xl text-sm transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Session expires after 8 hours. All access is logged.
        </p>
      </div>
    </div>
  );
}
