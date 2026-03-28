'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, ExternalLink, Check, Info, RefreshCw, Globe, Shield, User, Save, Moon, Sun } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiStatus {
  ai_available: boolean;
  anthropic_key_configured: boolean;
  message: string;
}

interface HealthResponse {
  services?: {
    ai?: 'configured' | 'not_configured' | 'present';
    alpha_vantage?: 'configured' | 'not_configured' | 'present';
  };
}

interface UserProfile {
  id: string;
  user_id: string;
  display_name: string | null;
  timezone: string;
  preferred_markets: string[];
  preferred_themes: string[];
  notification_channels: Record<string, boolean>;
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[#2A3B4C] bg-[#0D1B2E]/40">
        <Icon className="w-4 h-4 text-[#0F7ABF]" />
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-[#1E2D45] last:border-0 gap-4">
      <div className="min-w-0">
        <p className="text-sm text-white font-medium">{label}</p>
        {description && <p className="text-xs text-[#4A5B6C] mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
      ok
        ? 'bg-green-500/20 border-green-500/30 text-green-400'
        : 'bg-red-500/20 border-red-500/30 text-red-400'
    }`}>
      {ok ? <Check className="w-3 h-3" /> : <span>×</span>}
      {label}
    </span>
  );
}

// ─── Display Preferences (localStorage + backend sync) ────────────────────────

const PREF_KEY = 'mc_prefs';
const TIMEZONE_OPTIONS = [
  { value: 'Asia/Kolkata', label: 'IST — India Standard Time (UTC+5:30)' },
  { value: 'UTC', label: 'UTC — Coordinated Universal Time' },
  { value: 'America/New_York', label: 'EST/EDT — US Eastern Time' },
  { value: 'America/Los_Angeles', label: 'PST/PDT — US Pacific Time' },
  { value: 'Europe/London', label: 'GMT/BST — UK Time' },
  { value: 'Europe/Berlin', label: 'CET/CEST — Central European Time' },
  { value: 'Asia/Singapore', label: 'SGT — Singapore Time (UTC+8)' },
  { value: 'Asia/Tokyo', label: 'JST — Japan Standard Time (UTC+9)' },
];

const REFRESH_INTERVALS = [
  { value: '15000', label: 'Every 15 seconds' },
  { value: '30000', label: 'Every 30 seconds' },
  { value: '60000', label: 'Every 1 minute' },
  { value: '300000', label: 'Every 5 minutes' },
];

function getLocalPrefs() {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}'); } catch { return {}; }
}

function saveLocalPrefs(p: Record<string, string>) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

function DisplayPrefs() {
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Record<string, string>>({});
  const [isDark, setIsDark] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Get browser's local timezone
  const getBrowserTimezone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  };

  // Load local prefs immediately, with browser timezone as default
  useEffect(() => {
    const localPrefs = getLocalPrefs();
    setPrefs(p => ({
      ...p,
      ...localPrefs,
      timezone: localPrefs.timezone || getBrowserTimezone(),
    }));
  }, []);

  // Load theme preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isDarkMode = document.documentElement.classList.contains('dark');
      setIsDark(isDarkMode);
    }
  }, []);

  // Load backend profile and merge into prefs
  const { data: profile } = useQuery<UserProfile>({
    queryKey: ['auth', 'me'],
    queryFn: async () => { const { data } = await api.get('/auth/me'); return data; },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  // When backend profile loads, merge markets + timezone
  useEffect(() => {
    if (!profile) return;
    setPrefs(p => ({
      ...p,
      markets: profile.preferred_markets?.join(',') ?? p.markets,
      timezone: profile.timezone ?? p.timezone ?? getBrowserTimezone(),
    }));
  }, [profile]);

  const profileMutation = useMutation({
    mutationFn: (updates: Partial<UserProfile>) => api.patch('/auth/me', updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  const set = (key: string, value: string) => setPrefs(p => ({ ...p, [key]: value }));

  const toggleTheme = () => {
    const newVal = !isDark;
    setIsDark(newVal);
    if (typeof window !== 'undefined') {
      document.documentElement.classList.toggle('dark', newVal);
      localStorage.setItem('theme', newVal ? 'dark' : 'light');
    }
  };

  const handleSave = async () => {
    setSaveState('saving');
    saveLocalPrefs(prefs);

    // Sync markets preference to backend
    try {
      const marketsArr = prefs.markets ? prefs.markets.split(',') : profile?.preferred_markets ?? ['IN', 'US'];
      await profileMutation.mutateAsync({
        preferred_markets: marketsArr,
        timezone: prefs.timezone || profile?.timezone || 'UTC',
      });
      setSaveState('saved');
    } catch {
      // Local save still succeeded, show partial success
      setSaveState('error');
    }
    setTimeout(() => setSaveState('idle'), 2500);
  };

  const chips = (key: string, options: { value: string; label: string }[]) => (
    <div className="flex gap-2">
      {options.map(o => (
        <button key={o.value} onClick={() => set(key, o.value)}
          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
            (prefs[key] ?? options[0].value) === o.value
              ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white'
              : 'bg-[#0D1B2E] border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <Row label="Default currency" description="Symbol shown on P&L and values">
        {chips('currency', [{ value: 'INR', label: '🇮🇳 INR' }, { value: 'USD', label: '🇺🇸 USD' }])}
      </Row>
      <Row label="Date format" description="How dates appear across the app">
        {chips('dateFormat', [{ value: 'DD MMM', label: 'DD MMM' }, { value: 'MMM D', label: 'MMM D' }, { value: 'YYYY-MM-DD', label: 'ISO' }])}
      </Row>
      <Row label="Timezone" description="Used for market hours and scheduling">
        <select
          value={prefs.timezone || getBrowserTimezone()}
          onChange={e => set('timezone', e.target.value)}
          className="bg-[#0D1B2E] border border-[#2A3B4C] text-white rounded-lg px-3 py-1.5 text-xs focus:border-[#0F7ABF] outline-none max-w-sm"
        >
          {TIMEZONE_OPTIONS.map(tz => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </Row>
      <Row label="Price refresh interval" description="How often prices update">
        <select 
          value={prefs.refreshInterval || '60000'}
          onChange={e => set('refreshInterval', e.target.value)}
          className="bg-[#0D1B2E] border border-[#2A3B4C] text-white rounded-lg px-3 py-1.5 text-xs focus:border-[#0F7ABF] outline-none"
        >
          {REFRESH_INTERVALS.map(interval => (
            <option key={interval.value} value={interval.value}>{interval.label}</option>
          ))}
        </select>
      </Row>
      <Row label="Theme" description="Dark or light mode">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-1.5 text-white hover:border-[#0F7ABF] transition-colors"
          title="Toggle theme"
        >
          {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
          <span className="text-xs font-medium">{isDark ? 'Dark' : 'Light'}</span>
        </button>
      </Row>
      <Row label="News default region" description="Which market's news loads first">
        {chips('newsRegion', [
          { value: 'ALL', label: 'All' },
          { value: 'IN', label: '🇮🇳 India' },
          { value: 'US', label: '🇺🇸 US' },
        ])}
      </Row>
      <Row label="Default markets" description="Synced to your account profile">
        {chips('markets', [
          { value: 'IN,US', label: '🌐 Both' },
          { value: 'IN', label: '🇮🇳 India' },
          { value: 'US', label: '🇺🇸 US' },
        ])}
      </Row>
      <div className="pt-4">
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className="flex items-center gap-2 bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {saveState === 'saving' ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</>
          ) : saveState === 'saved' ? (
            <><Check className="w-4 h-4" /> Preferences Saved</>
          ) : (
            <><Save className="w-4 h-4" /> Save Preferences</>
          )}
        </button>
        {profile?.display_name && (
          <p className="text-[#4A5B6C] text-xs mt-2">
            Signed in as <span className="text-[#8899AA]">{profile.display_name}</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Profile Section ─────────────────────────────────────────────────────────

function ProfileSection() {
  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['auth', 'me'],
    queryFn: async () => { const { data } = await api.get('/auth/me'); return data; },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const [displayName, setDisplayName] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const qc = useQueryClient();

  // Get browser's local timezone
  const getBrowserTimezone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  };

  useEffect(() => {
    if (profile?.display_name) setDisplayName(profile.display_name);
  }, [profile]);

  const handleSaveName = async () => {
    if (!displayName.trim()) return;
    setSaveState('saving');
    try {
      await api.patch('/auth/me', { display_name: displayName.trim() });
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
    setTimeout(() => setSaveState('idle'), 2000);
  };

  if (isLoading) return <p className="text-[#4A5B6C] text-sm py-2">Loading profile…</p>;

  // Use browser timezone as fallback if profile.timezone is null/undefined
  const displayTimezone = profile?.timezone || getBrowserTimezone();

  return (
    <div>
      <Row label="Display name" description="How you appear in the app">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveName()}
            placeholder="Your name"
            className="bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-1.5 text-white text-xs w-36 focus:outline-none focus:border-[#0F7ABF] transition-colors placeholder-[#4A5B6C]"
          />
          <button
            onClick={handleSaveName}
            disabled={saveState === 'saving' || !displayName.trim()}
            className="text-[#0F7ABF] hover:text-[#38A9E8] disabled:opacity-40 transition-colors"
          >
            {saveState === 'saved' ? <Check className="w-4 h-4 text-green-400" /> : <Save className="w-4 h-4" />}
          </button>
        </div>
      </Row>
      <Row label="Timezone" description="Used for brief scheduling">
        <span className="text-[#8899AA] text-xs font-mono">{displayTimezone}</span>
      </Row>
      <Row label="Preferred markets">
        <span className="text-[#8899AA] text-xs">{profile?.preferred_markets?.join(', ') ?? '—'}</span>
      </Row>
    </div>
  );
}

// ─── API Keys Section ─────────────────────────────────────────────────────────

function StatusBadgeWithBackend({ status, isLoading, label }: { status: 'present' | 'configured' | 'not_configured' | 'offline' | 'checking'; isLoading?: boolean; label?: string }) {
  if (status === 'checking' || isLoading) {
    return <span className="text-[#4A5B6C] text-xs">Checking…</span>;
  }

  if (status === 'offline') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-gray-500/20 border-gray-500/30 text-gray-400" title="Backend offline">
        <span>◯</span>
        Backend offline
      </span>
    );
  }

  const ok = status === 'present' || status === 'configured';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
      ok
        ? 'bg-green-500/20 border-green-500/30 text-green-400'
        : 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400'
    }`}>
      {ok ? <Check className="w-3 h-3" /> : <span>⚠</span>}
      {ok ? 'Configured' : 'Not set — add to .env'}
    </span>
  );
}

function ApiKeysSection() {
  const [apiKeyStatus, setApiKeyStatus] = useState<'present' | 'not_configured' | 'offline' | 'checking'>('checking');
  const [avKeyStatus, setAvKeyStatus] = useState<'present' | 'not_configured' | 'offline' | 'checking'>('checking');
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);

  const parseHealth = (health: HealthResponse) => {
    const aiStatus = health.services?.ai;
    setApiKeyStatus(aiStatus === 'present' || aiStatus === 'configured' ? 'present' : 'not_configured');
    const avStatus = health.services?.alpha_vantage;
    setAvKeyStatus(avStatus === 'present' || avStatus === 'configured' ? 'present' : 'not_configured');
  };

  useEffect(() => {
    const checkHealth = async () => {
      setIsLoadingHealth(true);
      try {
        const { data } = await api.get('/health');
        parseHealth(data as HealthResponse);
      } catch {
        setApiKeyStatus('offline');
        setAvKeyStatus('offline');
      } finally {
        setIsLoadingHealth(false);
      }
    };

    checkHealth();
  }, []);

  const handleRefresh = async () => {
    setIsLoadingHealth(true);
    try {
      const { data } = await api.get('/health');
      parseHealth(data as HealthResponse);
      const health = data as HealthResponse;
      const aiStatus = health.services?.ai;
      if (aiStatus === 'present' || aiStatus === 'configured') {
        toast.success('API keys checked!');
      } else {
        toast.error('API key not set in .env');
      }
    } catch {
      setApiKeyStatus('offline');
      setAvKeyStatus('offline');
      toast.error('Backend offline');
    } finally {
      setIsLoadingHealth(false);
    }
  };

  return (
    <div>
      <Row label="Anthropic API key" description="Powers morning briefs, evening briefs, and AI chat">
        <div className="flex items-center gap-2">
          <StatusBadgeWithBackend status={apiKeyStatus} isLoading={isLoadingHealth} />
          <button onClick={handleRefresh} className="text-[#4A5B6C] hover:text-[#8899AA] transition-colors" title="Recheck">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHealth ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </Row>
      <Row label="Alpha Vantage key" description="Enhanced fundamental data (optional)">
        <StatusBadgeWithBackend status={avKeyStatus} isLoading={isLoadingHealth} />
      </Row>

      <div className="mt-4 bg-[#0D1B2E]/60 border border-[#2A3B4C] rounded-xl p-4">
        <div className="flex items-start gap-2 mb-3">
          <Info className="w-4 h-4 text-[#0F7ABF] shrink-0 mt-0.5" />
          <p className="text-xs text-[#8899AA] font-semibold">How to add API keys</p>
        </div>
        <ol className="space-y-1.5 text-xs text-[#4A5B6C] ml-5 list-decimal">
          <li>Open the <strong className="text-[#8899AA]">market-cockpit</strong> folder on your computer</li>
          <li>Open the <strong className="text-[#8899AA]">.env</strong> file in Notepad / TextEdit</li>
          <li>Find the line and paste your key: <code className="bg-[#1A2B3C] border border-[#2A3B4C] px-1.5 py-0.5 rounded text-[#0F7ABF]">ANTHROPIC_API_KEY=sk-ant-api03-…</code></li>
          <li>Save the file, then run <strong className="text-[#8899AA]">stop.sh</strong> then <strong className="text-[#8899AA]">start.sh</strong></li>
        </ol>
        <div className="flex flex-wrap gap-4 mt-4">
          <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-[#0F7ABF] hover:text-[#38A9E8] transition-colors">
            Get Anthropic key <ExternalLink className="w-3 h-3" />
          </a>
          <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-[#0F7ABF] hover:text-[#38A9E8] transition-colors">
            Get Alpha Vantage key <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="mb-2">
        <h1 className="text-lg font-bold text-white">Settings</h1>
        <p className="text-[#4A5B6C] text-sm mt-0.5">Configure your Market Cockpit experience</p>
      </div>

      <Section title="Profile" icon={User}>
        <ProfileSection />
      </Section>

      <Section title="API Keys" icon={Key}>
        <ApiKeysSection />
      </Section>

      <Section title="Display Preferences" icon={Globe}>
        <DisplayPrefs />
      </Section>

      <Section title="Data & Privacy" icon={Shield}>
        <Row label="Data storage" description="Where your data lives">
          <span className="text-xs text-green-400 font-semibold">Local only</span>
        </Row>
        <Row label="External connections" description="Services Market Cockpit contacts">
          <span className="text-[#8899AA] text-xs">Yahoo Finance, Anthropic (if key set)</span>
        </Row>
        <Row label="Account" description="Your portfolio data never leaves your machine">
          <span className="text-[#4A5B6C] text-xs">No cloud sync</span>
        </Row>
      </Section>

      <Section title="About Market Cockpit" icon={Info}>
        <Row label="Version">
          <span className="text-[#4A5B6C] text-xs font-mono">v1.0.0</span>
        </Row>
        <Row label="Stack">
          <span className="text-[#4A5B6C] text-xs">FastAPI · Next.js · PostgreSQL · Redis · Claude AI</span>
        </Row>
        <Row label="Market data">
          <a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-[#0F7ABF] hover:text-[#38A9E8] transition-colors">
            Yahoo Finance <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </Row>
      </Section>
    </div>
  );
}
