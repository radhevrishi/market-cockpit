// zzz1305 — DAILY BEST PICKS: the email (HTML on a white page + a plain-text copy + a short Telegram version). Pure.
import { esc, emailShell, TABLE, TH, TD } from '@/lib/owner-briefs/common';
import { FAMILY_WORD, regimeRule, type MarketRegime, type Mkt, type Scored, type Selection, type Freshness } from './score';

export interface SourceStatus { id: string; label: string; state: 'ok' | 'stale' | 'failed' | 'empty'; asOf: string | null; note: string | null; count: number | null }
export interface RenderInput {
  dateLabel: string; today: string; regimes: Record<Mkt, MarketRegime | null>; sel: Selection; sources: SourceStatus[];
  candidates: number; tookMs: number; version: string; siteUrl: string;
}
export interface Rendered { subject: string; html: string; text: string; telegram: string; quiet: boolean }

const FLAG: Record<Mkt, string> = { IN: '🇮🇳', US: '🇺🇸' };
const money = (m: Mkt, v: number | null | undefined) => (v == null ? '—' : m === 'IN' ? `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(2)}` : `$${v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`);
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`);
const capWord = (m: Mkt, mc: number | null | undefined) => (mc == null ? '' : m === 'IN' ? `₹${Math.round(mc).toLocaleString('en-IN')} Cr` : mc >= 1000 ? `$${(mc / 1000).toFixed(1)}B` : `$${Math.round(mc)}M`);
const FRESH_COL: Record<Freshness, string> = { NEW: '#047857', 'NEW CATALYST': '#047857', UPGRADED: '#1d4ed8', TRIGGERED: '#7c3aed', REPEAT: '#6b7280' };
const REG_COL: Record<string, string> = { BULL: '#047857', RECOVERY: '#0e7490', PULLBACK: '#b45309', CORRECTION: '#b45309', BEAR: '#b91c1c', UNKNOWN: '#6b7280' };

function snapshot(s: Scored): string {
  const t = s.tech; if (!t) return 'no trend data';
  const parts: string[] = [];
  if (t.stage != null) parts.push(`Stage ${t.stage}${t.stage === 2 && t.health === 1 ? ' (losing pace)' : ''}`);
  if (t.rs != null) parts.push(`RS ${Math.round(t.rs)}`);
  if (t.px != null && t.sma50 != null) parts.push(`${pct((t.px / t.sma50 - 1) * 100)} vs 50-day`);
  const cap = capWord(s.market, t.mc); if (cap) parts.push(cap);
  return parts.join(' · ');
}
function entryLine(s: Scored): string {
  const e = s.entry; if (!e) return '—';
  const stop = e.stop != null ? `stop ${money(s.market, e.stop)}` : '';
  const risk = e.riskPct != null ? ` (${e.riskPct.toFixed(1)}% risk)` : '';
  const trig = e.trigger != null ? `above ${money(s.market, e.trigger)} · ` : '';
  return `${e.kind}: ${trig}${stop}${risk}`;
}
const keyTrigger = (s: Scored) => s.evidence.find((e) => e.family !== 'SETUP') ?? s.evidence[0];
const riskLine = (s: Scored) => [...s.warnings, ...(s.tech?.stage === 2 && s.tech?.health === 1 ? ['Stage 2 losing pace'] : [])][0] || '—';
const tools = (s: Scored) => [...new Set(s.evidence.map((e) => e.tool))];
const links = (s: Scored, site: string) => {
  const m = s.market === 'IN' ? 'IN' : 'US';
  const u = keyTrigger(s)?.url;
  return [`<a href="${site}/charts?m=${m}&t=${encodeURIComponent(s.ticker)}">Chart</a>`, `<a href="${site}/company-lab?add=${encodeURIComponent(s.ticker)}">Company Lab</a>`, u ? `<a href="${esc(u)}">Filing</a>` : ''].filter(Boolean).join(' · ');
};

function pulseLines(m: Mkt, r: MarketRegime | null): string[] {
  if (!r) return [`${FLAG[m]} ${m === 'IN' ? 'India' : 'USA'}: regime could not be read — treated as CORRECTION (half size, support entries only).`];
  const rule = regimeRule(r.kind);
  const out = [`${FLAG[m]} ${m === 'IN' ? 'India' : 'USA'} — ${r.kind}${r.drawdownPct != null ? ` (${r.drawdownPct.toFixed(1)}% from high)` : ''}: ${rule.word}; ${rule.size}.`];
  const bits: string[] = [];
  if (r.indexName && r.indexChg != null) bits.push(`${r.indexName} ${pct(r.indexChg)} last session`);
  if (r.above50 != null) bits.push(`${Math.round(r.above50)}% of stocks above their 50-day`);
  if (r.vix != null) bits.push(`${m === 'IN' ? 'India VIX' : 'VIX'} ${r.vix.toFixed(1)}${r.vixBand ? ` (${r.vixBand})` : ''}`);
  if (bits.length) out.push(`   ${bits.join(' · ')}`);
  return out;
}

export function renderEmail(x: RenderInput): Rendered {
  const { sel } = x;
  const quiet = sel.top.length === 0 && sel.addOn.length === 0;
  const failed = x.sources.filter((s) => s.state === 'failed');
  const stale = x.sources.filter((s) => s.state === 'stale');
  const regWord = (m: Mkt) => `${FLAG[m]} ${x.regimes[m]?.kind ?? '?'} ${sel.top.filter((s) => s.market === m).length}`;
  const health = failed.length ? ` · ⚠ ${failed.length} source${failed.length > 1 ? 's' : ''} failed` : stale.length ? ` · ⚠ ${stale.length} stale` : '';
  const subject = quiet
    ? `Best Picks · ${x.dateLabel} · No high-conviction picks today · ${FLAG.IN} ${x.regimes.IN?.kind ?? '?'} · ${FLAG.US} ${x.regimes.US?.kind ?? '?'}${health}`
    : `Best Picks · ${x.dateLabel} · ${regWord('IN')} · ${regWord('US')}${health}`;

  const H: string[] = []; const T: string[] = [];
  const sec = (title: string) => { H.push(`<h3 style="margin:18px 0 6px;font-size:15px;color:#111827">${esc(title)}</h3>`); T.push('', title.toUpperCase()); };

  if (failed.length || stale.length) {
    const msg = [...failed.map((s) => `${s.label} failed${s.note ? ` (${s.note})` : ''}`), ...stale.map((s) => `${s.label} is stale${s.asOf ? ` (as of ${s.asOf})` : ''}`)].join('; ');
    H.push(`<div style="border:1px solid #f59e0b;background:#fffbeb;color:#92400e;padding:8px 10px;border-radius:6px;margin:6px 0 10px">⚠ Partial data: ${esc(msg)}. Those sources added no points today.</div>`);
    T.push(`⚠ Partial data: ${msg}.`);
  }

  sec('1 · Market pulse');
  for (const m of ['IN', 'US'] as Mkt[]) {
    const ls = pulseLines(m, x.regimes[m]);
    H.push(`<div style="margin:2px 0"><b style="color:${REG_COL[x.regimes[m]?.kind ?? 'UNKNOWN']}">${esc(ls[0])}</b>${ls[1] ? `<br><span style="color:#4b5563">${esc(ls[1].trim())}</span>` : ''}</div>`);
    T.push(...ls);
  }

  const pickTable = (rows: Array<Scored & { fresh: Freshness }>) => {
    H.push(`<table style="${TABLE}"><tr>${['#', 'Company', 'Score', 'Flagged by', 'Key trigger', 'Trend / entry', 'Main risk'].map((h) => `<th style="${TH}">${h}</th>`).join('')}</tr>`);
    rows.forEach((s, i) => {
      const k = keyTrigger(s);
      H.push(`<tr><td style="${TD}">${i + 1}</td>`
        + `<td style="${TD}"><b>${esc(s.ticker)}</b> ${FLAG[s.market]} <span style="color:${FRESH_COL[s.fresh]};font-size:11px;font-weight:700">${esc(s.fresh)}</span><br><span style="color:#4b5563">${esc(s.company)}</span><br><span style="font-size:12px">${links(s, x.siteUrl)}</span></td>`
        + `<td style="${TD}"><b style="font-size:16px">${s.score}</b><br><span style="color:#6b7280;font-size:11px">${s.familyCount} famil${s.familyCount === 1 ? 'y' : 'ies'}</span></td>`
        + `<td style="${TD}">${tools(s).map((t) => `<span style="display:inline-block;border:1px solid #d1d5db;border-radius:4px;padding:0 4px;margin:1px;font-size:11px">${esc(t)}</span>`).join(' ')}${s.quality.length ? `<br><span style="color:#047857;font-size:11px">${esc(s.quality.join(' · '))}</span>` : ''}</td>`
        + `<td style="${TD}">${esc(k?.line || '—')}${k?.date ? ` <span style="color:#6b7280">(${esc(k.date)})</span>` : ''}</td>`
        + `<td style="${TD}">${esc(snapshot(s))}<br><span style="color:#1d4ed8">${esc(entryLine(s))}</span></td>`
        + `<td style="${TD};color:#b45309">${esc(riskLine(s))}</td></tr>`);
      T.push(`${i + 1}. ${s.ticker} ${FLAG[s.market]} [${s.fresh}] score ${s.score} — ${s.company}`,
        `   Flagged by: ${tools(s).join(', ')}${s.quality.length ? ` · ${s.quality.join(', ')}` : ''}`,
        `   Trigger: ${k?.line || '—'}${k?.date ? ` (${k.date})` : ''}`,
        `   Trend: ${snapshot(s)} · ${entryLine(s)}`,
        `   Risk: ${riskLine(s)}`);
    });
    H.push('</table>');
  };

  sec(quiet ? '2 · Top picks — none today' : `2 · Top picks (${sel.top.length})`);
  if (sel.top.length) pickTable(sel.top);
  else {
    const why = 'No name had a catalyst AND a second independent confirmation, a healthy Stage 2 trend and a clean risk check today. No pick is better than a forced one.';
    H.push(`<p style="color:#374151">${esc(why)}</p>`); T.push(why);
  }
  if (sel.nearMiss.length) {
    H.push(`<p style="margin:6px 0 2px;color:#374151"><b>Closest misses</b> (one check short):</p><ul style="margin:0 0 8px 18px;padding:0">${sel.nearMiss.slice(0, 3).map((s) => `<li>${esc(s.ticker)} ${FLAG[s.market]} (score ${s.score}) — missed: ${esc(s.vetoes[0])}</li>`).join('')}</ul>`);
    T.push('Closest misses:', ...sel.nearMiss.slice(0, 3).map((s) => `- ${s.ticker} ${FLAG[s.market]} (score ${s.score}) — missed: ${s.vetoes[0]}`));
  }
  if (sel.addOn.length) {
    sec(`Already in your book — still qualifies (${sel.addOn.length})`);
    pickTable(sel.addOn);
  }

  sec('3 · New catalysts & watch');
  const watchRow = (s: Scored, why: string) => {
    const k = keyTrigger(s);
    return { html: `<li><b>${esc(s.ticker)}</b> ${FLAG[s.market]} — ${esc(k?.line || '')}${k?.date ? ` (${esc(k.date)})` : ''} <span style="color:#6b7280">· ${esc(why)}</span></li>`, text: `- ${s.ticker} ${FLAG[s.market]} — ${k?.line || ''}${k?.date ? ` (${k.date})` : ''} · ${why}` };
  };
  const groups: Array<[string, Array<{ html: string; text: string }>]> = [
    ['New catalysts (last 3 days), not confirmed yet', sel.newCatalysts.map((s) => watchRow(s, s.vetoes[0] || 'needs a second confirmation'))],
    ['Held back by the market regime', sel.regimeHeld.map((s) => watchRow(s, `score ${s.score} · ${regimeRule(x.regimes[s.market]?.kind ?? 'UNKNOWN').word}`))],
    ['Already ran — wait for a pullback', sel.rewardedWatch.map((s) => watchRow(s, s.rewarded || 'already rewarded'))],
    ['Still valid (sent before, nothing new)', sel.stillValid.map((s) => ({ html: `<li>${esc(s.ticker)} ${FLAG[s.market]} score ${s.score}</li>`, text: `- ${s.ticker} ${FLAG[s.market]} score ${s.score}` }))],
  ];
  let anyWatch = false;
  for (const [title, rows] of groups) {
    if (!rows.length) continue;
    anyWatch = true;
    H.push(`<p style="margin:8px 0 2px"><b>${esc(title)}</b></p><ul style="margin:0 0 6px 18px;padding:0">${rows.map((r) => r.html).join('')}</ul>`);
    T.push(`${title}:`, ...rows.map((r) => r.text));
  }
  if (!anyWatch) { H.push('<p style="color:#6b7280">Nothing new to watch today.</p>'); T.push('Nothing new to watch today.'); }

  sec('4 · System health');
  H.push(`<table style="${TABLE}"><tr><th style="${TH}">Source</th><th style="${TH}">State</th><th style="${TH}">As of</th><th style="${TH}">Note</th></tr>`
    + x.sources.map((s) => `<tr><td style="${TD}">${esc(s.label)}</td><td style="${TD};color:${s.state === 'ok' ? '#047857' : s.state === 'failed' ? '#b91c1c' : '#b45309'}">${s.state}${s.count != null ? ` (${s.count})` : ''}</td><td style="${TD}">${esc(s.asOf || '—')}</td><td style="${TD}">${esc(s.note || '')}</td></tr>`).join('')
    + '</table>');
  T.push(...x.sources.map((s) => `- ${s.label}: ${s.state}${s.count != null ? ` (${s.count})` : ''}${s.asOf ? ` · ${s.asOf}` : ''}${s.note ? ` · ${s.note}` : ''}`));
  const foot = `${x.candidates} companies scored · built in ${(x.tookMs / 1000).toFixed(1)} s · rules ${x.version} · not investment advice; figures come from the app's own stored data.`;
  H.push(`<p style="color:#6b7280;font-size:12px;margin-top:10px">${esc(foot)}<br>How a pick is chosen: a catalyst (result, guidance raise, business event or radar change) plus a second independent confirmation, a healthy Stage 2 trend above the 200-day, small / mid size, enough trading, and not already run up 40%+ in 3 months. <a href="${x.siteUrl}/best-picks">Full scoring for every company →</a></p>`);
  T.push('', foot, `Full scoring: ${x.siteUrl}/best-picks`);

  const tg = [subject, ...(sel.top.length ? sel.top.map((s, i) => `${i + 1}. ${s.ticker} ${FLAG[s.market]} ${s.score} — ${keyTrigger(s)?.line || ''}`.slice(0, 160)) : ['No high-conviction picks today.']), `Details: ${x.siteUrl}/best-picks`].join('\n');
  return { subject, html: emailShell(`Daily Best Picks — ${x.dateLabel}`, H.join('')), text: T.join('\n').trim(), telegram: tg, quiet };
}
