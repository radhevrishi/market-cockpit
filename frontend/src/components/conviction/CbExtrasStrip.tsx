'use client';
// zzz1231 — the extra Conviction Beats figures, one look on the India and USA cards:
// gross profit growth · Rule of 40 (FCF margin % + quarterly revenue growth YoY) · ROCE trend · liquidity
// (free float / traded value) and, for names the Quality Preset keeps, founder-led + moat (AI read, lib/cb-founder-moat).
import { gpCell, r40Cell, roceTrendCell, liquidityCell, type CbMarket } from '@/lib/cb-extras';
import { founderCell, moatCell } from '@/lib/cb-founder-moat';
import { TONE_COLOR, type MetricCell } from '@/lib/cb-metric-view';

function Chip({ c, testId }: { c: MetricCell; testId: string }) {
  return (
    <span data-testid={testId} title={c.title} style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 9.5, color: 'var(--mc-text-4)', letterSpacing: 0.3, fontWeight: 700 }}>{c.label}</span>{' '}
      <strong style={{ fontSize: 10.5, color: TONE_COLOR[c.tone] }}>{c.text}</strong>
    </span>
  );
}
const Dot = () => <span style={{ color: 'var(--mc-text-4)', opacity: 0.4 }}>·</span>;

export default function CbExtrasStrip({ e, market, showAi }: { e: any; market: CbMarket; showAi?: boolean }) {
  const x = e?.cbx;
  const ai = e?.cbfm;
  return (
    <div data-testid="cb-extras" style={{ display: 'flex', gap: '4px 10px', fontSize: 10, flexWrap: 'wrap', alignItems: 'baseline', color: 'var(--mc-text-3)' }}>
      <Chip testId="cb-gp" c={gpCell(x)} /><Dot />
      <Chip testId="cb-r40" c={r40Cell(x)} /><Dot />
      <Chip testId="cb-roce-trend" c={roceTrendCell(x)} /><Dot />
      <Chip testId="cb-liq" c={liquidityCell(x, market)} />
      {showAi && (<><Dot /><Chip testId="cb-founder" c={founderCell(ai)} /><Dot /><Chip testId="cb-moat" c={moatCell(ai)} /></>)}
    </div>
  );
}
