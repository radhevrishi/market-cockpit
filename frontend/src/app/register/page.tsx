'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, AlertCircle } from 'lucide-react';

const TIMEZONES = ['Asia/Kolkata', 'America/New_York', 'America/Chicago', 'Europe/London'];
const MARKETS = ['IN', 'US'];
const THEMES = ['AI_INFRA', 'SEMICONDUCTORS', 'DEFENSE', 'NUCLEAR', 'SPACE', 'GRID_TECH'];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: '', password: '', displayName: '', timezone: 'Asia/Kolkata',
  });
  const [markets, setMarkets] = useState<string[]>(['IN', 'US']);
  const [themes, setThemes] = useState<string[]>(['AI_INFRA', 'DEFENSE']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const toggle = (list: string[], setList: (v: string[]) => void, val: string) =>
    setList(list.includes(val) ? list.filter(x => x !== val) : [...list, val]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          display_name: form.displayName,
          timezone: form.timezone,
          preferred_markets: markets,
          preferred_themes: themes,
        }),
      });
      if (!res.ok) {
        let detail = `Registration failed (${res.status})`;
        try {
          const data = await res.json();
          detail = data.detail || detail;
        } catch {
          // Response wasn't JSON — use status text
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
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      key={label}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
        active
          ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white'
          : 'bg-transparent border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#0D1B2E] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <BarChart3 className="w-8 h-8 text-[#0F7ABF]" />
            <span className="text-2xl font-bold text-white tracking-wide">MARKET COCKPIT</span>
          </div>
          <p className="text-[#8899AA] text-sm">Create your investor profile</p>
        </div>

        <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl p-8 shadow-2xl">
          <h1 className="text-xl font-semibold text-white mb-6">Set up your cockpit</h1>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-red-400 text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {[
              { label: 'Display Name', key: 'displayName', type: 'text', placeholder: 'Rishi V' },
              { label: 'Email', key: 'email', type: 'email', placeholder: 'you@example.com' },
              { label: 'Password', key: 'password', type: 'password', placeholder: '••••••••' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-2">{label}</label>
                <input
                  type={type}
                  value={form[key as keyof typeof form]}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  required
                  placeholder={placeholder}
                  className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-4 py-3 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] focus:ring-1 focus:ring-[#0F7ABF] transition-colors"
                />
              </div>
            ))}

            <div>
              <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-2">Timezone</label>
              <select
                value={form.timezone}
                onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
                className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-[#0F7ABF] transition-colors"
              >
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-2">Markets</label>
              <div className="flex gap-2">
                {MARKETS.map(m => chip(m === 'IN' ? '🇮🇳 India' : '🇺🇸 US', markets.includes(m), () => toggle(markets, setMarkets, m)))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8899AA] uppercase tracking-wider mb-2">Focus Themes</label>
              <div className="flex flex-wrap gap-2">
                {THEMES.map(t => chip(t.replace('_', ' '), themes.includes(t), () => toggle(themes, setThemes, t)))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors text-sm"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <span className="text-[#4A5B6C] text-sm">Already have an account? </span>
            <Link href="/login" className="text-[#0F7ABF] hover:text-[#38A9E8] text-sm font-medium">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
