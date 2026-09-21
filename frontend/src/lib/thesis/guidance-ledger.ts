// ═══════════════════════════════════════════════════════════════════════════
// THE PROMISE LEDGER — WHAT THEY SAID, AND WHAT HAPPENED.           (zzz715)
//
// The owner's "promise vs reality" engine. Management says utilisation will
// go from 60% to 85% by FY27. Six months later nobody checks. The company
// says something new, the market listens to the new thing, and the old promise
// is never marked to market.
//
// So every forward statement this portal reads gets WRITTEN DOWN, with the
// date it was made and the filing it came from, and every subsequent quarter
// is checked against the promises still open.
//
// WHAT IS HONEST ABOUT THE FIRST RUN, and why it is said on screen: a ledger
// has nothing to compare against until it has two entries. The first time a
// holding is read, the only thing this module can do is RECORD the promise.
// It says exactly that rather than manufacturing a comparison, because an
// engine that produces a verdict on its first run has not checked anything —
// it has guessed, and the owner would have no way to tell the difference.
//
// STORED PER BROWSER. localStorage, same as the portfolio and the conviction
// bench, so the ledger lives where the book lives. The honest cost: it does
// not follow him to another machine, and it is stated in the UI rather than
// left to be discovered when a promise silently has no history.
// ═══════════════════════════════════════════════════════════════════════════

const KEY = 'mc.thesis.promises.v1';

export interface Promise_ {
  symbol: string;
  /** What was promised, in management's own terms. */
  metric: string;
  /** The stated target — a string, because filings say "85%", "₹1,500 Cr",
   *  "double digit". Never coerced to a number it did not state. */
  target: string;
  /** When management said it would happen. */
  by: string | null;
  /** When we recorded it, and from where. */
  recordedAt: string;
  sourceUrl: string | null;
  /** Closed out once a later quarter has been checked against it. */
  outcome?: { checkedAt: string; actual: string; verdict: 'met' | 'missed' | 'partial' | 'open' } | null;
}

type Store = Record<string, Promise_[]>;

function read(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o as Store : {};
  } catch { return {}; }
}

function write(s: Store): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(s)); }
  catch { /* the ledger is a record, never load-bearing for the page */ }
}

export function promisesFor(symbol: string): Promise_[] {
  return read()[symbol.toUpperCase()] || [];
}

/**
 * Record every forward statement in a summary that has a target attached.
 *
 * Deliberately narrow: only statements with BOTH a metric and a stated target
 * are recorded. "We are optimistic about demand" is not a promise anyone can
 * be held to, and filling the ledger with unfalsifiable sentences would make
 * it useless within two quarters.
 */
export function recordPromises(symbol: string, summary: any, sourceUrl: string | null): number {
  if (typeof window === 'undefined' || !summary) return 0;
  const sym = symbol.toUpperCase();
  const now = new Date().toISOString();
  const found: Promise_[] = [];

  const said = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s.length > 0 && !/^(not\s+\w+|n\/?a|none|unknown|—|-)$/i.test(s);
  };

  const ut = summary.utilisation || {};
  if (said(ut.expected)) {
    found.push({ symbol: sym, metric: 'Capacity utilisation', target: String(ut.expected),
      by: said(ut.expected_by) ? String(ut.expected_by) : null, recordedAt: now, sourceUrl, outcome: null });
  }
  const g = summary.guidance;
  if (g?.action && g.action !== 'none' && said(g.detail)) {
    found.push({ symbol: sym, metric: `Guidance (${g.action})`, target: String(g.detail),
      by: said(g.period) ? String(g.period) : null, recordedAt: now, sourceUrl, outcome: null });
  }
  for (const c of (Array.isArray(summary.capex_projects) ? summary.capex_projects : [])) {
    if (said(c?.completion_period)) {
      found.push({ symbol: sym, metric: `Capex commissioning — ${c?.name || 'programme'}`,
        target: said(c?.capacity_added) ? String(c.capacity_added) : 'commissioning',
        by: String(c.completion_period), recordedAt: now, sourceUrl, outcome: null });
    }
    if (said(c?.revenue_from)) {
      found.push({ symbol: sym, metric: `Revenue from capex — ${c?.name || 'programme'}`,
        target: 'revenue contribution begins', by: String(c.revenue_from),
        recordedAt: now, sourceUrl, outcome: null });
    }
  }
  if (!found.length) return 0;

  const store = read();
  const existing = store[sym] || [];
  // Same metric + same target = the same promise restated, not a new one. A
  // ledger that grows by one line every time the page is opened is a ledger
  // nobody reads.
  const seen = new Set(existing.map((p) => `${p.metric}|${p.target}|${p.by || ''}`));
  const fresh = found.filter((p) => !seen.has(`${p.metric}|${p.target}|${p.by || ''}`));
  if (!fresh.length) return 0;
  store[sym] = [...existing, ...fresh].slice(-40);
  write(store);
  return fresh.length;
}

export interface PromiseCheck {
  gap: boolean;
  detail: string;
  /** ── THE COMPARISON ITSELF, not a verdict about it.            (zzz727)
   *
   *  "Running behind plan" is only sayable when there is a plan and an actual
   *  to put beside it. These three fields are what the card prints, and
   *  assessThesis discards a gap that arrives without them — which stops the
   *  state from ever being reached on the strength of weak-looking growth. */
  plan?: string | null;
  actual?: string | null;
  variance?: string | null;
  direction?: 'behind' | 'ahead';
  open: Promise_[];
  /** True on the first read of a holding — nothing to compare against yet. */
  firstRun: boolean;
}

/**
 * Check the latest evidence against promises recorded EARLIER. Promises made
 * in the same reading are excluded: a statement cannot be evidence against
 * itself, and letting it be is how a system produces a confident verdict on
 * its first run.
 */
export function checkPromises(symbol: string, summary: any | null): PromiseCheck {
  const all = promisesFor(symbol);
  const cutoff = Date.now() - 60_000;       // anything recorded in this session's read
  const open = all.filter((p) => !p.outcome?.verdict || p.outcome.verdict === 'open')
    .filter((p) => Date.parse(p.recordedAt) < cutoff);

  if (!open.length) {
    return {
      gap: false, open: [], firstRun: true,
      detail: all.length
        ? 'Promises are on file but none is old enough to check against this quarter yet.'
        : 'No earlier promise on file for this holding — this reading records the first one. A promise can only be checked against a LATER quarter, so there is nothing to grade today.',
    };
  }

  const said = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  const pctIn = (s: unknown): number | null => {
    const m = said(s) ? String(s).match(/-?\d+(?:\.\d+)?/) : null;
    const v = m ? Number(m[0]) : NaN;
    return Number.isFinite(v) ? v : null;
  };

  const utNow = pctIn(summary?.utilisation?.current);
  const misses: string[] = [];
  let plan: string | null = null, actual: string | null = null, variance: string | null = null;
  let direction: 'behind' | 'ahead' = 'behind';
  for (const p of open) {
    if (/utilisation/i.test(p.metric) && utNow != null) {
      const t = pctIn(p.target);
      // A 3pp tolerance both ways: filings round, and a ledger that fires on
      // rounding is a ledger that gets ignored. Symmetric because beating a
      // plan is as much a reason to re-underwrite as missing one.
      if (t == null) continue;
      if (utNow < t - 3 || utNow > t + 3) {
        direction = utNow < t ? 'behind' : 'ahead';
        plan = `${p.metric} ${p.target}${p.by ? ` by ${p.by}` : ''}`;
        actual = String(summary.utilisation.current);
        variance = `${utNow - t >= 0 ? '+' : ''}${(utNow - t).toFixed(0)}pp vs plan`;
        misses.push(`${p.metric}: stated ${p.target}${p.by ? ` by ${p.by}` : ''}, actual ${summary.utilisation.current}.`);
      }
    }
  }
  if (summary?.guidance?.action === 'lowered') {
    const prior = open.find((p) => /guidance/i.test(p.metric));
    if (prior) {
      direction = 'behind';
      plan = plan || `${prior.metric} ${prior.target}${prior.by ? ` by ${prior.by}` : ''}`;
      actual = actual || (said(summary.guidance.detail) ? String(summary.guidance.detail) : 'guidance lowered');
      variance = variance || 'guidance cut against the figure previously stated';
      misses.push(`${prior.metric}: previously ${prior.target}; this quarter guidance was lowered${said(summary.guidance.detail) ? ` — ${summary.guidance.detail}` : ''}.`);
    }
  }

  if (!misses.length) {
    return { gap: false, open, firstRun: false,
      detail: `${open.length} promise${open.length > 1 ? 's' : ''} on file, none of them materially missed or beaten by this quarter's evidence.` };
  }
  return {
    gap: true, open, firstRun: false, plan, actual, variance, direction,
    detail: `Measured against what management itself documented: ${misses.join(' ')}`,
  };
}

export function clearPromises(symbol?: string): void {
  if (typeof window === 'undefined') return;
  if (!symbol) { try { window.localStorage.removeItem(KEY); } catch { /* noop */ } return; }
  const s = read(); delete s[symbol.toUpperCase()]; write(s);
}
