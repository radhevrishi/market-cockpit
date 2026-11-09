// zzz1233 — runs the verification of held-back Transformational Gainers rows (lib/transformational/verify). Server only.
import { kvGet, kvMGet, kvSet, kvIncrByFloat } from '../kv';
import { loadReviewed } from './reviewed';
import type { TgItem, TgMarket } from './core';
import { VERIFY_DAILY_MAX, VERIFY_DAY_KEY, VERIFY_KEY, VERIFY_PER_CALL, VERIFY_SYSTEM, VERIFY_TOOL, dueForRetry, parseVerifyAnswer, ruleVerdict, verifyUserText, type TgVerify } from './verify';

const MODEL = 'claude-haiku-4-5-20251001';   // mapped to the configured provider's model by the meter
const TTL = 120 * 86_400;

export async function loadVerifies(ids: string[]): Promise<Map<string, TgVerify>> {
  const m = new Map<string, TgVerify>();
  if (!ids.length) return m;
  const vals = await kvMGet<TgVerify>(ids.map(VERIFY_KEY)).catch(() => [] as Array<TgVerify | null>);
  ids.forEach((id, i) => { if (vals[i]) m.set(id, vals[i] as TgVerify); });
  return m;
}

const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** The filing's text, or '' when it cannot be read. */
export async function readFilingText(url: string | null): Promise<string> {
  if (!url) return '';
  try {
    if (/sec\.gov/i.test(url)) { const { fetchEdgarText } = await import('../ai-gainers/edgar-research'); return (await fetchEdgarText(url, 15_000)) || ''; }
    if (/\.pdf(\?|$)/i.test(url) || /AttachLive|AttachHis|nsearchives|corporate-?announcements?\/.*pdf/i.test(url)) {
      const { extractPdfText } = await import('../pdf-text-extractor');
      const r = await extractPdfText(url);
      return r.source === 'FAILED' ? '' : r.text || '';
    }
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketCockpit/1.0)' }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return '';
    const ct = r.headers.get('content-type') || '';
    if (/pdf/i.test(ct)) { const { extractPdfText } = await import('../pdf-text-extractor'); const p = await extractPdfText(url); return p.source === 'FAILED' ? '' : p.text || ''; }
    return strip(await r.text());
  } catch { return ''; }
}

export async function verifyOne(x: TgItem, prev: TgVerify | null, aiAllowed: boolean): Promise<{ v: TgVerify | null; usedAi: boolean }> {
  const now = new Date();
  const rule = ruleVerdict(x, now);
  if (rule) return { v: rule, usedAi: false };
  const tries = (prev?.tries || 0) + 1;
  const doc = await readFilingText(x.sourceUrl);
  if (doc.replace(/\s+/g, ' ').length < 300) {
    return { v: { verdict: 'NOT_VERIFIABLE', reason: x.sourceUrl ? 'The company filing could not be read (unreadable or too short) — tried again in 3 days.' : 'No company filing is linked — only press text, which is not enough under the criteria.', kind: null, quote: null, by: 'rules', at: now.toISOString().slice(0, 10), tries }, usedAi: false };
  }
  if (!aiAllowed) return { v: null, usedAi: false };
  const { anthropicMessages, modelConfigured } = await import('../anthropic-meter');
  if (!modelConfigured()) return { v: null, usedAi: false };
  try {
    const resp = await anthropicMessages('transformational-verify', {
      model: MODEL, max_tokens: 500, system: VERIFY_SYSTEM,
      tools: [VERIFY_TOOL as any], tool_choice: { type: 'tool', name: VERIFY_TOOL.name },
      messages: [{ role: 'user', content: verifyUserText(x, doc) }],
    } as any, { signal: AbortSignal.timeout(45_000) });
    if (!resp.ok) return { v: null, usedAi: true };
    const j: any = await resp.json();
    return { v: parseVerifyAnswer((j?.content || []).find((c: any) => c?.type === 'tool_use')?.input, doc, now, tries), usedAi: true };
  } catch { return { v: null, usedAi: true }; }
}

/** Decide the held-back rows not decided yet (or due for a retry). `ids` = only those rows. */
export async function runVerify(opts: { ids?: string[]; market?: TgMarket; days?: number; deadlineMs?: number } = {}): Promise<{ decided: number; accepted: number; rejected: number; unverifiable: number; pending: number; aiUsed: number; note: string | null }> {
  const all = await loadReviewed(opts.days ?? 75, opts.market);
  const held = all.filter((x) => x.needsCheck && (!opts.ids?.length || opts.ids.includes(x.id)));
  const prev = await loadVerifies(held.map((x) => x.id));
  const todo = held.filter((x) => dueForRetry(prev.get(x.id)));
  const used = Number(await kvGet<number>(VERIFY_DAY_KEY()).catch(() => 0)) || 0;
  let room = Math.max(0, VERIFY_DAILY_MAX - used);
  const deadline = Date.now() + (opts.deadlineMs ?? 100_000);
  let decided = 0, accepted = 0, rejected = 0, unverifiable = 0, aiUsed = 0, i = 0, n = 0;
  const worker = async () => {
    while (i < todo.length && Date.now() < deadline && n < VERIFY_PER_CALL * 2) {
      const x = todo[i++]; n++;
      const aiAllowed = room > 0;
      if (aiAllowed) room--;   // reserved; given back when no AI call was made
      const { v, usedAi } = await verifyOne(x, prev.get(x.id) || null, aiAllowed);
      if (usedAi) { aiUsed++; await kvIncrByFloat(VERIFY_DAY_KEY(), 1, 2 * 86_400).catch(() => null); } else if (aiAllowed) room++;
      if (!v) continue;
      await kvSet(VERIFY_KEY(x.id), v, TTL).catch(() => undefined);
      decided++;
      if (v.verdict === 'ACCEPTED') accepted++; else if (v.verdict === 'REJECTED') rejected++; else unverifiable++;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const pending = todo.length - decided;
  return { decided, accepted, rejected, unverifiable, pending, aiUsed, note: room <= 0 && pending > 0 ? `Daily AI check limit reached (${VERIFY_DAILY_MAX}) — the rest are checked tomorrow.` : null };
}
