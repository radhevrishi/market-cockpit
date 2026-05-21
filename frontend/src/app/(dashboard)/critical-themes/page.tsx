'use client';

// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL THEMES (PATCH 0627)
//
// Institutional view of high-conviction structural themes for the next 10+
// years. India + USA separately, each with 6-8 monopoly / policy-backed
// themes, curated leader stocks (governance-filtered), and asymmetric
// risk/reward.
//
// Data lives in /lib/critical-themes.ts. To add a theme: edit that lib;
// this page auto-reflects.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { getThemesByRegion, type CriticalTheme, type ThemeRegion } from '@/lib/critical-themes';

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

function ThemeBlock({ t }: { t: CriticalTheme }) {
  const accent = t.region === 'US' ? '#F87171' : '#22D3EE';
  return (
    <div style={{
      background: CARD,
      border: `1px solid ${BORDER}`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 8,
      padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: TEXT }}>
          🔥 {t.name} <span style={{ marginLeft: 4 }}>{t.emoji}</span>
        </h2>
        <span style={{ fontSize: 10, color: accent, background: `${accent}22`, padding: '2px 8px', borderRadius: 3, fontWeight: 800, letterSpacing: '0.5px' }}>
          RANK #{t.priorityRank}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13, lineHeight: 1.65, marginTop: 6 }}>
        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>WHY</span>
        <span style={{ color: TEXT }}>{t.why}</span>

        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>LEADERS</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {t.leaders.map((l) => (
            <Link key={l.ticker} href={`/stock-sheet?ticker=${encodeURIComponent(l.ticker)}${t.region === 'US' ? '&market=us' : ''}`}
              style={{
                fontSize: 12, padding: '4px 10px',
                background: `${accent}15`, border: `1px solid ${accent}50`,
                color: accent, textDecoration: 'none', borderRadius: 4, fontWeight: 700,
              }}
              title={l.note || ''}
            >
              {l.ticker} · {l.name}
              {l.exchange && <span style={{ marginLeft: 4, fontSize: 9, color: DIM, fontWeight: 600 }}>({l.exchange})</span>}
            </Link>
          ))}
        </div>

        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BEAR</span>
        <span style={{ color: '#FCA5A5' }}>{t.bearCase}</span>

        <span style={{ color: DIM, fontWeight: 800, letterSpacing: '0.5px' }}>BULL</span>
        <span style={{ color: '#10B981' }}>{t.bullCase}</span>
      </div>
    </div>
  );
}

function PlaybookCallout({ region, themes }: { region: ThemeRegion; themes: CriticalTheme[] }) {
  const top = themes.slice(0, 5);
  const accent = region === 'US' ? '#F87171' : '#22D3EE';
  return (
    <div style={{
      background: `linear-gradient(180deg, ${accent}12 0%, transparent 100%)`,
      border: `1px solid ${accent}40`,
      borderRadius: 8,
      padding: '18px 20px',
      marginBottom: 16,
    }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: accent, letterSpacing: '0.5px', marginBottom: 10 }}>
        🎯 INVESTOR PLAYBOOK — {region === 'US' ? 'USA' : 'INDIA'}
      </div>
      <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.7, marginBottom: 10 }}>
        Top {top.length} themes most likely to dominate the next bull cycle in {region === 'US' ? 'the US' : 'India'}:
      </div>
      <ol style={{ margin: '0 0 14px 22px', fontSize: 13, color: TEXT, lineHeight: 1.8 }}>
        {top.map((t) => (
          <li key={t.id}><b>{t.emoji} {t.name}</b> — {t.bullCase}</li>
        ))}
      </ol>
      <div style={{ fontSize: 12, color: DIM, lineHeight: 1.65, fontStyle: 'italic' }}>
        <b style={{ color: TEXT }}>Accumulation strategy:</b> Assume 2-3 year bear ahead. Build positions in tranches at -30%, -50%, -70% drawdowns from current price.
        Never max-size on a single name. Cap individual theme exposure at 25% of book. Prefer leaders with clean balance sheets, trustworthy management, and proven execution — filter any name with audit issues, family disputes, board conflicts, or weak governance.
      </div>
    </div>
  );
}

export default function CriticalThemesPage() {
  const [region, setRegion] = useState<ThemeRegion>('IN');
  const themes = useMemo(() => getThemesByRegion(region), [region]);

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: TEXT }}>🔥 Critical Themes</h1>
            <div style={{ marginTop: 4, fontSize: 13, color: DIM, lineHeight: 1.55 }}>
              Choke-point investment themes for the next 10+ years — monopoly-driven, policy-backed, structurally tailwind-aligned.
            </div>
          </div>
          {/* Region toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['IN', 'US'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRegion(r)}
                style={{
                  fontSize: 12,
                  padding: '6px 14px',
                  background: region === r ? (r === 'US' ? '#F87171' : '#22D3EE') : 'transparent',
                  border: `1px solid ${region === r ? (r === 'US' ? '#F87171' : '#22D3EE') : '#1E2D45'}`,
                  color: region === r ? '#0A0E1A' : TEXT,
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                }}
              >
                {r === 'US' ? '🇺🇸 USA' : '🇮🇳 INDIA'}
              </button>
            ))}
          </div>
        </div>

        <PlaybookCallout region={region} themes={themes} />

        {themes.map((t) => <ThemeBlock key={t.id} t={t} />)}

        <div style={{
          marginTop: 8,
          padding: '12px 16px',
          fontSize: 11,
          color: DIM,
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          lineHeight: 1.6,
        }}>
          Leaders curated for clean balance sheets, trustworthy management, and proven execution. Names with audit issues, promoter-family disputes, board conflicts, or weak governance are excluded. To add a theme: edit <code style={{ background: '#1A2540', padding: '1px 4px', borderRadius: 3 }}>frontend/src/lib/critical-themes.ts</code> — this page auto-reflects.
        </div>
      </div>
    </div>
  );
}
