'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, RefreshCw, Copy, Bot, User, AlertCircle, Sparkles, Key, Sun, Moon } from 'lucide-react';
import { format } from 'date-fns';
import api from '@/lib/api';
import { Skeleton } from '@/components/ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiBrief {
  type: string;
  content: string | string[];
  generated_at?: string;
  model_version?: string | null;
  api_key_missing?: boolean;
  error?: boolean;
  error_message?: string;
  error_type?: string;
}

interface AiStatus {
  ai_available: boolean;
  anthropic_key_configured: boolean;
  message: string;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAiStatus() {
  return useQuery<AiStatus>({
    queryKey: ['ai', 'status'],
    queryFn: async () => { const { data } = await api.get('/ai/status'); return data; },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

function useMorningBrief() {
  return useQuery<ApiBrief>({
    queryKey: ['ai', 'brief', 'morning'],
    queryFn: async () => { const { data } = await api.get('/ai/brief/morning'); return data; },
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

function useEveningBrief() {
  return useQuery<ApiBrief>({
    queryKey: ['ai', 'brief', 'evening'],
    queryFn: async () => { const { data } = await api.get('/ai/brief/evening'); return data; },
    staleTime: 30 * 60_000,
    retry: 1,
  });
}

function useSavedBriefs() {
  return useQuery<ApiBrief[]>({
    queryKey: ['ai', 'briefs'],
    queryFn: async () => {
      const { data } = await api.get('/ai/briefs');
      return Array.isArray(data) ? data : (data?.briefs ?? []);
    },
    retry: 1,
  });
}

// ─── API Key Banner ───────────────────────────────────────────────────────────

function ApiKeyBanner() {
  return (
    <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-5">
      <Key className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-amber-300 text-sm font-semibold mb-1">Anthropic API key not configured</p>
        <p className="text-amber-200/70 text-xs leading-relaxed">
          AI features need an API key to work. Get your free key at{' '}
          <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="underline text-amber-300 hover:text-amber-200">
            console.anthropic.com
          </a>
          , then add it to your <code className="bg-amber-500/20 px-1 rounded">.env</code> file as{' '}
          <code className="bg-amber-500/20 px-1 rounded">ANTHROPIC_API_KEY=sk-ant-...</code> and restart.
        </p>
      </div>
    </div>
  );
}

// ─── Generate CTA Banner ──────────────────────────────────────────────────────

function GenerateCTA({
  type,
  label,
  Icon,
  accentClass,
  onGenerate,
  isGenerating,
  hasContent,
}: {
  type: 'morning' | 'evening';
  label: string;
  Icon: React.ElementType;
  accentClass: string;
  onGenerate: () => void;
  isGenerating: boolean;
  hasContent: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 rounded-xl px-5 py-3.5 border mb-5 ${accentClass}`}>
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs opacity-70">
            {hasContent ? 'Brief ready · Click to regenerate with latest data' : 'No brief yet · Generate now'}
          </p>
        </div>
      </div>
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-50 transition-colors whitespace-nowrap"
      >
        {isGenerating
          ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating…</>
          : <><Sparkles className="w-3.5 h-3.5" /> {hasContent ? 'Regenerate' : 'Generate Brief'}</>
        }
      </button>
    </div>
  );
}

// ─── Content Sanitizer ────────────────────────────────────────────────────

function sanitizeContent(content: unknown): string[] {
  if (!content) return [];

  // If it's already an array, return as is
  if (Array.isArray(content)) {
    return content.map(item => String(item)).filter(Boolean);
  }

  const str = String(content);

  // Check if content looks like a Python dict
  if (str.trim().startsWith('{') && str.includes("'")) {
    try {
      // Try to parse as Python dict by replacing single quotes with double quotes
      const jsonStr = str.replace(/'/g, '"');
      const parsed = JSON.parse(jsonStr);

      // Extract text values from the dict
      if (typeof parsed === 'object' && parsed !== null) {
        const lines: string[] = [];
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && value.trim()) {
            lines.push(value);
          }
        }
        return lines.length > 0 ? lines : [str];
      }
    } catch {
      // If parsing fails, return as is but with notice
      return [str];
    }
  }

  // Split by newlines if regular text
  return str.split('\n').filter(Boolean);
}

// ─── Brief Card ───────────────────────────────────────────────────────────────

function BriefCard({ brief, isLoading, error, onRefresh }: {
  brief: ApiBrief | undefined;
  isLoading: boolean;
  error: unknown;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyText = () => {
    if (!brief?.content) return;
    const text = Array.isArray(brief.content) ? brief.content.join('\n') : String(brief.content);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Check if the brief data itself contains an error flag
  if (brief && brief.error) {
    // Use error_message if provided by backend, otherwise fallback
    const errorMsg = brief.error_message
      ? brief.error_message
      : brief.api_key_missing
      ? 'API key is not configured'
      : 'Failed to generate brief';

    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="w-8 h-8 text-red-400" />
        <p className="text-[#8899AA] text-sm text-center">{errorMsg}</p>
        <button onClick={onRefresh} className="flex items-center gap-1.5 text-[#0F7ABF] text-sm hover:text-[#38A9E8]">
          <RefreshCw className="w-4 h-4" /> Try again
        </button>
      </div>
    );
  }

  if (error) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <AlertCircle className="w-8 h-8 text-red-400" />
      <p className="text-[#8899AA] text-sm">Could not load brief — is the backend running?</p>
      <button onClick={onRefresh} className="flex items-center gap-1.5 text-[#0F7ABF] text-sm hover:text-[#38A9E8]">
        <RefreshCw className="w-4 h-4" /> Try again
      </button>
    </div>
  );

  if (isLoading) return (
    <div className="space-y-3 py-4">
      <Skeleton className="h-4 w-1/2" />
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );

  if (!brief) return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <Sparkles className="w-8 h-8 text-[#0F7ABF]" />
      <p className="text-[#8899AA] text-sm">Brief not generated yet</p>
      <p className="text-[#4A5B6C] text-xs text-center max-w-xs">Use the Generate button above to create your personalised market brief</p>
    </div>
  );

  const bullets: string[] = sanitizeContent(brief.content);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[#4A5B6C] text-xs">
          {brief.generated_at
            ? `Generated ${format(new Date(brief.generated_at), 'MMM d, HH:mm')}`
            : 'Just generated'}
          {brief.model_version ? ` · ${brief.model_version}` : ''}
        </p>
        <div className="flex gap-2">
          <button onClick={copyText} className="flex items-center gap-1 text-[#4A5B6C] hover:text-[#8899AA] text-xs transition-colors">
            <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={onRefresh} className="flex items-center gap-1 text-[#4A5B6C] hover:text-[#8899AA] text-xs transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Regenerate
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {bullets.map((line, i) => {
          if (!line.trim()) return null;
          const emoji = line.match(/^[\p{Emoji}]/u)?.[0];
          const rest = emoji ? line.slice(emoji.length).trim() : line;
          const parts = rest.split(/\s*(?:—|–|:)\s*/);
          const label = parts.length > 1 ? parts[0] : null;
          const body  = parts.length > 1 ? parts.slice(1).join(' — ') : rest;
          return (
            <div key={i} className="bg-[#0D1B2E]/60 border border-[#2A3B4C] rounded-xl px-4 py-3.5 hover:border-[#0F7ABF]/30 transition-colors">
              <div className="flex gap-3">
                {emoji && <span className="text-lg shrink-0 mt-0.5">{emoji}</span>}
                <div>
                  {label && <p className="text-[#0F7ABF] text-xs font-semibold uppercase tracking-wide mb-0.5">{label}</p>}
                  <p className="text-[#C8D8E8] text-sm leading-relaxed">{body}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!brief.api_key_missing && (
        <p className="text-[#2A3B4C] text-[10px] mt-4 text-center">
          AI summary for informational use only · Not investment advice
        </p>
      )}
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

interface ChatMsg { role: 'user' | 'assistant'; content: string; ts: Date }

interface ChatResponse {
  message: string;
  response: string;
  generated_at?: string;
  error?: boolean;
  error_type?: string;
  error_message?: string;
  api_key_missing?: boolean;
}

function ChatTab({ aiAvailable, apiHasError }: { aiAvailable: boolean; apiHasError: boolean }) {
  // Determine initial greeting based on API status
  const initialGreeting = aiAvailable && !apiHasError
    ? "Hello! I'm your Market Desk AI. Ask me about your portfolio, a specific stock, upcoming earnings, or sector trends."
    : apiHasError
    ? "⚠️ AI service is currently unavailable. Please check your API configuration and credits."
    : "⚠️ Anthropic API key is not configured. Add it to .env and restart to enable.";

  const [messages, setMessages] = useState<ChatMsg[]>([{
    role: 'assistant',
    content: initialGreeting,
    ts: new Date(),
  }]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = useMutation({
    mutationFn: (message: string) => api.post('/ai/chat', { message }),
    onSuccess: (res) => {
      const data: ChatResponse = res.data;

      // Check if the response contains an error flag
      if (data?.error) {
        // Use error_message from backend if available
        const errorMsg = data.error_message
          ? `⚠️ ${data.error_message}`
          : data.api_key_missing
          ? '⚠️ API key not configured — add ANTHROPIC_API_KEY to .env and restart'
          : '⚠️ Failed to generate response. Please try again.';

        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg, ts: new Date() }]);
      } else {
        const reply = data?.response ?? String(data);
        setMessages(prev => [...prev, { role: 'assistant', content: reply, ts: new Date() }]);
      }
    },
    onError: () => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '⚠️ Could not reach the AI service. Check that the backend is running.',
        ts: new Date(),
      }]);
    },
  });

  const send = () => {
    const msg = input.trim();
    if (!msg || chatMutation.isPending) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg, ts: new Date() }]);
    chatMutation.mutate(msg);
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const SUGGESTIONS = [
    'Summarize my portfolio performance this week',
    'Which of my holdings reports earnings next?',
    'What sectors are moving today?',
    'Explain the AI infra theme basket',
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[400px]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'assistant' ? 'bg-[#0F7ABF]/20 text-[#0F7ABF]' : 'bg-[#2A3B4C] text-[#8899AA]'}`}>
              {msg.role === 'assistant' ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === 'assistant' ? 'bg-[#1A2B3C] border border-[#2A3B4C] text-[#C8D8E8]' : 'bg-[#0F7ABF] text-white'}`}>
              {msg.content}
              <p className={`text-[10px] mt-1 ${msg.role === 'assistant' ? 'text-[#4A5B6C]' : 'text-blue-200'}`}>{format(msg.ts, 'HH:mm')}</p>
            </div>
          </div>
        ))}
        {chatMutation.isPending && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-[#0F7ABF]/20 text-[#0F7ABF] flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-2xl px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                {[0,1,2].map(i => <span key={i} className="w-2 h-2 rounded-full bg-[#0F7ABF] animate-bounce" style={{ animationDelay: `${i*150}ms` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {messages.length <= 1 && aiAvailable && (
        <div className="flex flex-wrap gap-2 py-3">
          {SUGGESTIONS.map(s => (
            <button key={s} onClick={() => setInput(s)}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#1A2B3C] border border-[#2A3B4C] text-[#8899AA] hover:border-[#0F7ABF] hover:text-white transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 pt-3 border-t border-[#2A3B4C]">
        <input
          type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={aiAvailable ? 'Ask about a ticker, your portfolio, earnings…' : 'Configure API key to enable chat…'}
          disabled={!aiAvailable}
          className="flex-1 bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl px-4 py-3 text-white text-sm placeholder-[#4A5B6C] focus:outline-none focus:border-[#0F7ABF] transition-colors disabled:opacity-50"
        />
        <button onClick={send} disabled={!input.trim() || chatMutation.isPending || !aiAvailable}
          className="bg-[#0F7ABF] hover:bg-[#0E6DAD] disabled:opacity-40 text-white p-3 rounded-xl transition-colors">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Saved Briefs ─────────────────────────────────────────────────────────────

function SavedBriefsTab() {
  const { data, isLoading } = useSavedBriefs();
  return (
    <div className="space-y-3">
      {isLoading
        ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        : !data?.length
        ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📚</p>
            <p className="text-white font-semibold mb-1">No saved briefs yet</p>
            <p className="text-[#4A5B6C] text-sm">Generated briefs will appear here once the history feature is enabled</p>
          </div>
        )
        : data.map((brief, idx) => (
          <div key={idx} className="bg-[#1A2B3C] border border-[#2A3B4C] rounded-xl px-5 py-4 hover:border-[#0F7ABF]/40 transition-colors">
            <div className="flex items-center justify-between mb-1">
              <span className="text-white text-sm font-medium capitalize">{brief.type?.replace('_', ' ') ?? 'Brief'}</span>
              <span className="text-[#4A5B6C] text-xs">
                {brief.generated_at ? format(new Date(brief.generated_at), 'MMM d, HH:mm') : ''}
              </span>
            </div>
            <p className="text-[#8899AA] text-xs line-clamp-2">
              {Array.isArray(brief.content) ? brief.content[0] : String(brief.content).slice(0, 200)}
            </p>
          </div>
        ))
      }
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabId = 'morning' | 'evening' | 'chat' | 'saved';
const TABS: { id: TabId; label: string; emoji: string }[] = [
  { id: 'morning', label: 'Morning Brief', emoji: '☀️' },
  { id: 'evening', label: 'Evening Brief', emoji: '🌙' },
  { id: 'chat',    label: 'AI Chat',       emoji: '💬' },
  { id: 'saved',   label: 'Saved',         emoji: '📚' },
];

export default function AIDeskPage() {
  const [activeTab, setActiveTab] = useState<TabId>('morning');
  const qc = useQueryClient();
  const morning = useMorningBrief();
  const evening = useEveningBrief();
  const { data: aiStatus } = useAiStatus();

  // Determine AI availability and error status
  const briefHasError = !!(morning.data?.error || evening.data?.error);
  const briefErrorType = morning.data?.error_type || evening.data?.error_type;
  const briefCreditExhausted = briefErrorType === 'insufficient_credits' ||
    !!(morning.data?.error_message?.includes('credit') || evening.data?.error_message?.includes('credit'));

  // AI is truly available if: key is configured AND no runtime errors have occurred
  const aiAvailable = (aiStatus?.ai_available ?? true) && !briefHasError;
  const apiHasError: boolean = briefHasError && !briefCreditExhausted;

  const [generatingMorning, setGeneratingMorning] = useState(false);
  const [generatingEvening, setGeneratingEvening] = useState(false);

  const generateBrief = async (type: 'morning' | 'evening') => {
    const setter = type === 'morning' ? setGeneratingMorning : setGeneratingEvening;
    setter(true);
    try {
      await api.get(`/ai/brief/${type}`);
      await qc.invalidateQueries({ queryKey: ['ai', 'brief', type] });
    } catch {
      /* errors handled by BriefCard */
    } finally {
      setter(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-5">
        <Bot className="w-5 h-5 text-[#0F7ABF]" />
        <h1 className="text-lg font-bold text-white">AI Desk</h1>
        {aiStatus ? (
          <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
            aiAvailable && !briefHasError
              ? 'bg-green-500/20 border-green-500/30 text-green-400'
              : briefCreditExhausted
              ? 'bg-red-500/20 border-red-500/30 text-red-400'
              : 'bg-amber-500/20 border-amber-500/30 text-amber-400'
          }`}>
            {aiAvailable && !briefHasError ? '● Active' : aiStatus.anthropic_key_configured ? (briefCreditExhausted ? '○ No Credits' : '○ Error') : '○ Offline'}
          </span>
        ) : null}
      </div>

      {aiStatus && (!aiStatus.ai_available || briefCreditExhausted) && (
        briefCreditExhausted ? (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-5">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-semibold mb-1">Anthropic API credits exhausted</p>
              <p className="text-red-200/70 text-xs leading-relaxed">
                Your API credit balance is too low. Add credits at{' '}
                <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer" className="underline text-red-300 hover:text-red-200">
                  console.anthropic.com/settings/billing
                </a>
                {' '}to re-enable AI features.
              </p>
            </div>
          </div>
        ) : !aiStatus.anthropic_key_configured ? (
          <ApiKeyBanner />
        ) : (
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-5">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-semibold mb-1">AI service temporarily unavailable</p>
              <p className="text-red-200/70 text-xs leading-relaxed">
                The backend AI service is offline. Please check that the API server is running and try again in a moment.
              </p>
            </div>
          </div>
        )
      )}

      {/* Prominent generate CTAs — shown for morning and evening tabs */}
      {activeTab === 'morning' && (
        <GenerateCTA
          type="morning"
          label="Morning Market Brief"
          Icon={Sun}
          accentClass="bg-amber-500/10 border-amber-500/30 text-amber-300"
          onGenerate={() => generateBrief('morning')}
          isGenerating={generatingMorning || morning.isLoading}
          hasContent={!!morning.data}
        />
      )}
      {activeTab === 'evening' && (
        <GenerateCTA
          type="evening"
          label="Evening Market Wrap"
          Icon={Moon}
          accentClass="bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
          onGenerate={() => generateBrief('evening')}
          isGenerating={generatingEvening || evening.isLoading}
          hasContent={!!evening.data}
        />
      )}

      <div className="flex gap-1 bg-[#0D1B2E] rounded-xl p-1 border border-[#2A3B4C] mb-6">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-[#1A2B3C] text-white shadow' : 'text-[#4A5B6C] hover:text-[#8899AA]'
            }`}>
            <span>{tab.emoji}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'morning' && (
        <BriefCard brief={morning.data} isLoading={morning.isLoading} error={morning.error} onRefresh={() => morning.refetch()} />
      )}
      {activeTab === 'evening' && (
        <BriefCard brief={evening.data} isLoading={evening.isLoading} error={evening.error} onRefresh={() => evening.refetch()} />
      )}
      {activeTab === 'chat' && <ChatTab aiAvailable={aiAvailable} apiHasError={apiHasError} />}
      {activeTab === 'saved' && <SavedBriefsTab />}
    </div>
  );
}
