'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        let detail = `Login failed (${res.status})`;
        try {
          const data = await res.json();
          detail = data.detail || detail;
        } catch {
          detail = `Server error (${res.status}): ${res.statusText}`;
        }
        throw new Error(detail);
      }
      const data = await res.json();
      localStorage.setItem('token', data.access_token);
      router.push('/');
    } catch (err: unknown) {
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        setError('Service temporarily unavailable. Please try again in a moment.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D1B2E] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <BarChart3 className="w-8 h-8 text-[#0F7ABF]" />
            <span className="text-2xl font-bold text-white tracking-wide">MARKET COCKPIT</span>
          </div>
          <p className="text-[#8899AA] text-sm">India + US Equity Intelligence Platform</p>
        </div>

        {/* Card */}
        <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl p-8 shadow-2xl">
          <h1 className="text-xl font-semibold text-white mb-6">Sign in to your cockpit</h1>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-4 py-3 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] focus:ring-1 focus:ring-[#0F7ABF] transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-4 py-3 pr-12 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] focus:ring-1 focus:ring-[#0F7ABF] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4A5B6C] hover:text-[#8899AA] transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-[#4A5B6C] text-sm">Don&apos;t have an account? </span>
            <Link href="/register" className="text-[#0F7ABF] hover:text-[#38A9E8] text-sm font-medium transition-colors">
              Create account
            </Link>
          </div>
        </div>

        <p className="text-center text-[#2A3B4C] text-xs mt-6">
          For personal use only · Not financial advice
        </p>
      </div>
    </div>
  );
}
