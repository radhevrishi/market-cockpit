'use client';
// zzz1166 — on an AI Daily Gainers card: whether the event is transformational, its theme, and the multibagger chance (rules,
// plus the AI read when one is stored). The same rule as the Transformational Gainers board (lib/transformational/core).
import React, { createContext, useContext, useMemo } from 'react';
import NavLink from '@/components/NavLink';
import { R, tint } from '@/components/special-situations/radar-tokens';
import { MbChip } from './MbChip';
import { transformationalFrom, tgKindWord, type AiMb } from '@/lib/transformational/core';

/** AI reads by "MARKET:TICKER" (the newest stored read for the company). */
export const TgAiContext = createContext<Record<string, AiMb>>({});

export function TgCardBadge({ it }: { it: any }) {
  const ai = useContext(TgAiContext);
  const tg = useMemo(() => {
    try { const m = it?.market === 'US' ? 'US' : 'IN'; return transformationalFrom([it], m, '2000-01-01')[0] || null; } catch { return null; }
  }, [it]);
  if (!tg) return null;
  const c = tg.strength === 'TRANSFORMATIONAL' ? R.green : tg.strength === 'INFLECTION' ? R.cyan : R.amber;
  return (
    <div data-testid="tg-badge" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start', padding: '6px 8px', borderRadius: 8, background: tint(c, 7), border: `1px solid ${tint(c, 40)}` }}>
      <NavLink href="/transformational-gainers" title="Listed on the 60-day Transformational Gainers board" style={{ fontSize: 11, fontWeight: 800, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: '3px 8px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
        🧬 {tg.strength === 'TRANSFORMATIONAL' ? 'TRANSFORMATIONAL' : tg.strength === 'INFLECTION' ? 'INFLECTION' : 'NOTABLE'} · {tgKindWord(tg.kind)}
      </NavLink>
      <span title={tg.themeWhy || ''} style={{ fontSize: 11, fontWeight: 700, color: R.cyan, border: `1px solid ${R.border}`, borderRadius: 999, padding: '3px 8px' }}>{tg.theme}</span>
      <MbChip mb={tg.mb} ai={ai[`${tg.market}:${tg.ticker}`] || null} />
    </div>
  );
}
