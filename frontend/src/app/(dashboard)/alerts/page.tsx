'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, Trash2, ToggleLeft, ToggleRight, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Newspaper, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Skeleton, TableRowSkeleton } from '@/components/ui/Skeleton';
import { timeAgo } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertRule {
  id: string;
  name: string;
  rule_type: 'PRICE' | 'NEWS';
  ticker?: string;
  exchange?: string;
  is_active: boolean;
  conditions: Record<string, unknown>;
  news_conditions?: Record<string, unknown>;
  cooldown_minutes: number;
  created_at: string;
}

interface AlertInstance {
  id: string;
  rule_id: string;
  triggered_at: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAlertRules() {
  return useQuery<AlertRule[]>({
    queryKey: ['alerts', 'rules'],
    queryFn: async () => { const { data } = await api.get('/alerts/rules'); return data; },
  });
}

function useAlertInstances() {
  return useQuery<AlertInstance[]>({
    queryKey: ['alerts', 'instances'],
    queryFn: async () => { const { data } = await api.get('/alerts/instances?limit=30'); return data; },
    refetchInterval: 30_000,
  });
}

// ─── Create Alert Modal ───────────────────────────────────────────────────────

const PRESETS = [
  { name: 'Price up 5%',    type: 'PRICE', ticker: '', exchange: 'NSE', conditions: { direction: 'UP',   threshold_pct: 5  }, icon: '📈' },
  { name: 'Price down 5%',  type: 'PRICE', ticker: '', exchange: 'NSE', conditions: { direction: 'DOWN', threshold_pct: 5  }, icon: '📉' },
  { name: 'Price up 3%',    type: 'PRICE', ticker: '', exchange: 'NSE', conditions: { direction: 'UP',   threshold_pct: 3  }, icon: '⬆️' },
  { name: 'Price down 3%',  type: 'PRICE', ticker: '', exchange: 'NSE', conditions: { direction: 'DOWN', threshold_pct: 3  }, icon: '⬇️' },
  { name: 'High importance news', type: 'NEWS', ticker: '', exchange: 'NSE', conditions: {}, news_conditions: { min_importance: 80 }, icon: '📰' },
];

function CreateAlertModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'preset' | 'form'>('preset');
  const [form, setForm] = useState({
    name: '', rule_type: 'PRICE' as 'PRICE' | 'NEWS',
    ticker: '', exchange: 'NSE',
    direction: 'UP' as 'UP' | 'DOWN', threshold_pct: '5',
    min_importance: '70', cooldown_minutes: '60',
  });
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      // Validate required fields
      if (!form.name.trim()) throw new Error('Alert name is required');
      if (form.rule_type === 'PRICE' && !form.ticker.trim()) {
        throw new Error('Ticker is required for price alerts');
      }

      const ruleTypeMap = { 'PRICE': 'PRICE_LEVEL', 'NEWS': 'NEWS_TRIGGER' };
      const payload: Record<string, unknown> = {
        name: form.name,
        rule_type: ruleTypeMap[form.rule_type as keyof typeof ruleTypeMap],
        ticker: form.ticker.toUpperCase() || 'ANY',  // Use 'ANY' for news alerts
        exchange: form.exchange,
        is_active: true,
        cooldown_minutes: Number(form.cooldown_minutes),
        notification_channels: { IN_APP: true },
        conditions: form.rule_type === 'PRICE'
          ? { direction: form.direction, threshold_pct: Number(form.threshold_pct) }
          : {},
        news_conditions: form.rule_type === 'NEWS'
          ? { min_importance: Number(form.min_importance) }
          : null,
      };
      await api.post('/alerts/rules', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts', 'rules'] });
      toast.success(`Alert created for ${form.ticker || 'news'}`);
      onClose();
    },
    onError: (err: any) => {
      const raw = err?.response?.data?.detail;
      let errorMsg = 'Failed to create alert. Please try again.';

      if (typeof raw === 'string') {
        errorMsg = raw;
      } else if (Array.isArray(raw)) {
        // Pydantic validation errors come as [{type, loc, msg, input}, ...]
        const cleanedErrors = raw.map((e: any) => {
          if (typeof e === 'string') return e;
          if (e?.msg) {
            // Extract field name from location if available
            const field = Array.isArray(e.loc) && e.loc.length > 0 ? `${e.loc[0]}: ` : '';
            return field + e.msg;
          }
          return 'Validation error';
        }).join('; ');
        errorMsg = cleanedErrors || 'Invalid alert configuration. Please check all fields.';
      } else if (raw && typeof raw === 'object') {
        errorMsg = raw?.msg || raw?.message || 'Invalid alert configuration.';
      }

      // Clean up generic Pydantic errors
      if (errorMsg.includes('Input should be a valid')) {
        errorMsg = 'Invalid alert configuration. Please check all required fields.';
      }

      setError(errorMsg);
      toast.error(errorMsg);
    },
  });

  function applyPreset(p: typeof PRESETS[0]) {
    setForm(f => ({
      ...f,
      rule_type: p.type as 'PRICE' | 'NEWS',
      name: p.name,
      ticker: '',  // Always clear ticker so user specifies their own
      direction: (p.conditions as any).direction ?? 'UP',
      threshold_pct: String((p.conditions as any).threshold_pct ?? '5'),
      min_importance: String((p.news_conditions as any)?.min_importance ?? '70'),
    }));
    setStep('form');
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#2A3B4C]">
          <h2 className="text-white font-bold text-base">Create Alert</h2>
          <button onClick={onClose} className="text-[#4A5B6C] hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {step === 'preset' ? (
          <div className="p-5 space-y-3">
            <p className="text-[#8899AA] text-sm mb-4">Choose a preset or start from scratch</p>
            {PRESETS.map((p, i) => (
              <button key={i} onClick={() => applyPreset(p)}
                className="w-full flex items-center gap-3 bg-[#0D1B2E]/60 hover:bg-[#0D1B2E] border border-[#2A3B4C] hover:border-[#0F7ABF]/50 rounded-xl px-4 py-3 transition-colors text-left">
                <span className="text-xl">{p.icon}</span>
                <span className="text-white text-sm font-medium">{p.name}</span>
              </button>
            ))}
            <button onClick={() => setStep('form')}
              className="w-full flex items-center gap-3 bg-transparent border border-dashed border-[#2A3B4C] hover:border-[#0F7ABF]/50 rounded-xl px-4 py-3 transition-colors text-left">
              <Plus className="w-5 h-5 text-[#4A5B6C]" />
              <span className="text-[#4A5B6C] text-sm">Custom alert</span>
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[#8899AA] text-xs mb-1 block">Alert Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. RELIANCE price spike" className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2 text-white text-sm focus:border-[#0F7ABF] outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[#8899AA] text-xs mb-1 block">Ticker</label>
                <input value={form.ticker} onChange={e => setForm(f => ({ ...f, ticker: e.target.value.toUpperCase() }))}
                  placeholder="e.g. NVDA, RELIANCE" className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2 text-white text-sm focus:border-[#0F7ABF] outline-none" />
              </div>
              <div>
                <label className="text-[#8899AA] text-xs mb-1 block">Exchange</label>
                <select value={form.exchange} onChange={e => setForm(f => ({ ...f, exchange: e.target.value }))}
                  className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2 text-white text-sm focus:border-[#0F7ABF] outline-none">
                  <option value="NSE">NSE</option><option value="BSE">BSE</option>
                  <option value="NYSE">NYSE</option><option value="NASDAQ">NASDAQ</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[#8899AA] text-xs mb-1 block">Alert Type</label>
              <div className="flex gap-2">
                {(['PRICE', 'NEWS'] as const).map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, rule_type: t }))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-colors ${form.rule_type === t ? 'bg-[#0F7ABF] border-[#0F7ABF] text-white' : 'border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF]'}`}>
                    {t === 'PRICE' ? '📈 Price' : '📰 News'}
                  </button>
                ))}
              </div>
            </div>

            {form.rule_type === 'PRICE' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#8899AA] text-xs mb-1 block">Direction</label>
                  <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value as 'UP' | 'DOWN' }))}
                    className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2 text-white text-sm focus:border-[#0F7ABF] outline-none">
                    <option value="UP">⬆ Price Up</option><option value="DOWN">⬇ Price Down</option>
                  </select>
                </div>
                <div>
                  <label className="text-[#8899AA] text-xs mb-1 block">Threshold %</label>
                  <input type="number" value={form.threshold_pct} onChange={e => setForm(f => ({ ...f, threshold_pct: e.target.value }))}
                    className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2 text-white text-sm focus:border-[#0F7ABF] outline-none" />
                </div>
              </div>
            )}

            {form.rule_type === 'NEWS' && (
              <div>
                <label className="text-[#8899AA] text-xs mb-1 block">Min Importance Score (0–100)</label>
                <input type="number" min="0" max="100" value={form.min_importance} onChange={e => setForm(f => ({ ...f, min_importance: e.target.value }))}
                  className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2 text-white text-sm focus:border-[#0F7ABF] outline-none" />
              </div>
            )}

            <div>
              <label className="text-[#8899AA] text-xs mb-1 block">Cooldown (minutes)</label>
              <input type="number" value={form.cooldown_minutes} onChange={e => setForm(f => ({ ...f, cooldown_minutes: e.target.value }))}
                className="w-full bg-[#0D1B2E] border border-[#2A3B4C] rounded-lg px-3 py-2 text-white text-sm focus:border-[#0F7ABF] outline-none" />
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setStep('preset')} className="flex-1 py-2 rounded-lg border border-[#2A3B4C] text-[#8899AA] text-sm hover:border-[#0F7ABF] transition-colors">← Back</button>
              <button onClick={() => createMutation.mutate()}
                disabled={
                  !form.name ||
                  (form.rule_type === 'PRICE' && !form.ticker) ||
                  createMutation.isPending
                }
                className="flex-1 py-2 rounded-lg bg-[#0F7ABF] text-white text-sm font-medium disabled:opacity-50 hover:bg-[#0E6DAD] transition-colors">
                {createMutation.isPending ? 'Creating…' : 'Create Alert'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Alert Rule Card ──────────────────────────────────────────────────────────

function AlertRuleCard({ rule, onToggle, onDelete }: { rule: AlertRule; onToggle: () => void; onDelete: () => void }) {
  const cond = rule.conditions as any;
  const newsC = rule.news_conditions as any;

  return (
    <div className={`bg-[#1A2B3C] border rounded-xl px-5 py-4 transition-colors ${rule.is_active ? 'border-[#2A3B4C]' : 'border-[#2A3B4C]/50 opacity-60'}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${rule.rule_type === 'PRICE' ? 'bg-blue-500/20' : 'bg-orange-500/20'}`}>
          {rule.rule_type === 'PRICE'
            ? (cond?.direction === 'DOWN' ? <TrendingDown className="w-4 h-4 text-blue-400" /> : <TrendingUp className="w-4 h-4 text-blue-400" />)
            : <Newspaper className="w-4 h-4 text-orange-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold mb-0.5">{rule.name}</p>
          <div className="flex flex-wrap gap-2 mb-1">
            {rule.ticker && <span className="text-xs bg-[#0D1B2E] border border-[#2A3B4C] rounded px-2 py-0.5 text-[#8899AA]">{rule.ticker} · {rule.exchange}</span>}
            {rule.rule_type === 'PRICE' && cond?.threshold_pct && (
              <span className="text-xs bg-[#0D1B2E] border border-[#2A3B4C] rounded px-2 py-0.5 text-[#8899AA]">
                {cond.direction === 'UP' ? '⬆' : '⬇'} {cond.threshold_pct}% move
              </span>
            )}
            {rule.rule_type === 'NEWS' && newsC?.min_importance && (
              <span className="text-xs bg-[#0D1B2E] border border-[#2A3B4C] rounded px-2 py-0.5 text-[#8899AA]">
                Importance ≥ {newsC.min_importance}
              </span>
            )}
            <span className="text-xs bg-[#0D1B2E] border border-[#2A3B4C] rounded px-2 py-0.5 text-[#4A5B6C]">
              cooldown {rule.cooldown_minutes}m
            </span>
          </div>
          <p className="text-[#4A5B6C] text-xs">Created {timeAgo(rule.created_at)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onToggle} title={rule.is_active ? 'Disable' : 'Enable'} className="text-[#4A5B6C] hover:text-[#0F7ABF] transition-colors">
            {rule.is_active ? <ToggleRight className="w-6 h-6 text-green-400" /> : <ToggleLeft className="w-6 h-6" />}
          </button>
          <button onClick={onDelete} className="text-[#4A5B6C] hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'history'>('rules');
  const qc = useQueryClient();

  const { data: rules, isLoading: rulesLoading, error: rulesError, refetch: refetchRules } = useAlertRules();
  const { data: instances, isLoading: histLoading, error: histError, refetch: refetchHist } = useAlertInstances();

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await api.patch(`/alerts/rules/${id}`, { is_active });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', 'rules'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/alerts/rules/${id}`); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', 'rules'] }),
  });

  const activeCount = (rules ?? []).filter(r => r.is_active).length;
  const triggeredToday = (instances ?? []).filter(i => {
    const d = new Date(i.triggered_at);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {showCreate && <CreateAlertModal onClose={() => setShowCreate(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Smart Alerts</h1>
          <p className="text-[#4A5B6C] text-xs mt-0.5">Get notified on price moves and breaking news</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#0F7ABF] hover:bg-[#0E6DAD] text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> New Alert
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Active Alerts', value: activeCount, icon: Bell, color: 'text-green-400' },
          { label: 'Triggered Today', value: triggeredToday, icon: Check, color: 'text-blue-400' },
          { label: 'Total Rules', value: (rules ?? []).length, icon: AlertCircle, color: 'text-[#8899AA]' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl px-4 py-3 flex items-center gap-3">
            <Icon className={`w-5 h-5 ${color} shrink-0`} />
            <div>
              <p className="text-white text-lg font-bold leading-none">{value}</p>
              <p className="text-[#4A5B6C] text-xs mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#0D1B2E] rounded-xl p-1 border border-[#2A3B4C] w-fit">
        {[{ id: 'rules' as const, label: '⚙️ Alert Rules' }, { id: 'history' as const, label: '📋 Trigger History' }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-[#1A2B3C] text-white' : 'text-[#4A5B6C] hover:text-[#8899AA]'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Rules tab */}
      {activeTab === 'rules' && (
        <div className="space-y-3">
          {rulesError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> Failed to load alert rules.
              <button onClick={() => refetchRules()} className="ml-auto text-xs hover:text-red-300 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Retry</button>
            </div>
          )}
          {rulesLoading
            ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
            : !(rules ?? []).length
            ? (
              <div className="text-center py-16 border-2 border-dashed border-[#2A3B4C] rounded-2xl">
                <Bell className="w-10 h-10 text-[#2A3B4C] mx-auto mb-3" />
                <p className="text-white font-semibold mb-1">No alerts yet</p>
                <p className="text-[#4A5B6C] text-sm mb-4">Create your first alert to get notified on price moves</p>
                <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 bg-[#0F7ABF] text-white px-4 py-2 rounded-xl text-sm font-medium">
                  <Plus className="w-4 h-4" /> Create Alert
                </button>
              </div>
            )
            : (rules ?? []).map(rule => (
                <AlertRuleCard key={rule.id} rule={rule}
                  onToggle={() => toggleMutation.mutate({ id: rule.id, is_active: !rule.is_active })}
                  onDelete={() => deleteMutation.mutate(rule.id)} />
              ))
          }
        </div>
      )}

      {/* History tab */}
      {activeTab === 'history' && (
        <div className="space-y-2">
          {histError && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> Failed to load trigger history.
              <button onClick={() => refetchHist()} className="ml-auto text-xs hover:text-red-300 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Retry</button>
            </div>
          )}
          {histLoading
            ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)
            : !(instances ?? []).length
            ? <p className="text-[#4A5B6C] text-sm text-center py-12">No alerts triggered in the last 30 days</p>
            : (instances ?? []).map(inst => (
                <div key={inst.id} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl px-4 py-3 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-orange-400 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm">{inst.message || 'Alert triggered'}</p>
                    <p className="text-[#4A5B6C] text-xs mt-0.5">{timeAgo(inst.triggered_at)}</p>
                  </div>
                </div>
              ))
          }
        </div>
      )}
    </div>
  );
}
