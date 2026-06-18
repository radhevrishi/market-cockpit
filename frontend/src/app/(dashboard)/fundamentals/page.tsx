'use client';

// ============================================================================
// FUNDAMENTALS ANALYZER (PATCH 1120)
// In-app, upload-driven analytics for Screener.in bulk exports.
// Drop any CSV (20 / 30 / 80 stocks — any size). Analytics key off the column
// fields, not the row count. No external chart deps (inline SVG + CSS bars).
// ============================================================================

import { useState, useMemo, useCallback, useEffect } from 'react';

// Identity for de-dup: NSE code, else BSE code, else Name (uppercased).
// PATCH 1101tt — rowKey now also recognises TradingView USA columns (Symbol / Ticker / Description)
// so USA CSV uploads don't all collapse to the same empty-string key.
const rowKey = (d: Record<string, string>) => ((d['NSE Code'] || d['BSE Code'] || d['Symbol'] || d['Ticker'] || d['Name'] || d['Description'] || d['Company name'] || d['Company'] || '').trim().toUpperCase());

type Row = Record<string, string>;

// ---- CSV parse (quote-aware) ----
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0, field = '', row: string[] = [], inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++; continue;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function toObjects(rows: string[][]): Row[] {
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  const out: Row[] = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0].trim() === '') continue;
    const o: Row = {};
    head.forEach((h, idx) => (o[h] = rows[r][idx]));
    out.push(o);
  }
  return out;
}
function num(v: any): number {
  if (v === undefined || v === null) return NaN;
  const s = ('' + v).trim();
  if (s === '' || s === '-') return NaN;
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? NaN : n;
}
type Stat = { mean: number; median: number; trimmed: number; n: number };
function stats(arr: number[]): Stat {
  const v = arr.filter((x) => !isNaN(x));
  if (!v.length) return { mean: NaN, median: NaN, trimmed: NaN, n: 0 };
  const s = [...v].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  let trimmed = mean;
  if (s.length >= 12) {
    const lo = s[Math.floor(s.length * 0.05)], hi = s[Math.ceil(s.length * 0.95) - 1];
    const t = s.filter((x) => x >= lo && x <= hi);
    if (t.length) trimmed = t.reduce((a, b) => a + b, 0) / t.length;
  }
  return { mean, median, trimmed, n: v.length };
}
function fmt(n: number, d = 1): string {
  if (isNaN(n)) return '—';
  const p = Math.pow(10, d);
  return (Math.round(n * p) / p).toLocaleString('en-IN');
}

const COL = {
  bg: '#0a0e14', panel: '#111722', panel2: '#0e141d', line: '#1e2733', line2: '#283545',
  txt: '#e6edf3', muted: '#8896a8', dim: '#5b6677',
  green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#58a6ff', violet: '#a78bfa', cyan: '#39d0d8',
};

const SAMPLE_HINT = 'Name, NSE Code, Sales growth, Profit growth, Return on capital employed, OPM, Price to Earning, PEG Ratio, Debt to equity …';

export default function FundamentalsAnalyzerPage({ scope: scopeProp = '' }: { scope?: string }) {
  // Per-tab storage: portfolio & watchlist keep separate saved lists so one never overwrites the other.
  // Scope may also arrive via the ?scope= query param so the home nav can deep-link directly into the
  // Watchlist (?scope=watchlist) or Portfolio (?scope=portfolio) fundamentals list.
  let scope = scopeProp;
  if (!scope && typeof window !== 'undefined') {
    try {
      const qp = new URLSearchParams(window.location.search).get('scope');
      if (qp === 'watchlist' || qp === 'portfolio') scope = qp;
    } catch {}
  }
  // PATCH 1101ss — Market dimension (India / USA). India uses existing Screener.in
  // parser; USA accepts TradingView CSV. Each market gets its own storage so the
  // two lists don't collide and the user can flip between them.
  const MARKET_KEY = scope ? 'mc:fundamentals:' + scope + ':market:v1' : 'mc:fundamentals:market:v1';
  const [market, setMarketState] = useState<'INDIA' | 'USA'>(() => {
    if (typeof window === 'undefined') return 'INDIA';
    try { return (localStorage.getItem(MARKET_KEY) as 'INDIA' | 'USA') || 'INDIA'; } catch { return 'INDIA'; }
  });
  const setMarket = (m: 'INDIA' | 'USA') => {
    setMarketState(m);
    try { localStorage.setItem(MARKET_KEY, m); } catch {}
  };
  const marketSuffix = market === 'USA' ? ':usa' : ''; // INDIA keeps legacy key for backwards compat
  const STORAGE_KEY = scope ? 'mc:fundamentals:' + scope + marketSuffix + ':data:v1' : 'mc:fundamentals' + marketSuffix + ':data:v1';
  const STORAGE_NAME = scope ? 'mc:fundamentals:' + scope + marketSuffix + ':name:v1' : 'mc:fundamentals' + marketSuffix + ':name:v1';
  const [data, setData] = useState<Row[]>([]);
  const [fname, setFname] = useState<string>('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>('');
  const mcPersist = (k: string, v: string): boolean => {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch (err) {
      setError("Couldn't save this list \u2014 it's too large for your browser's storage (about 5MB). Remove some rows or split it into a smaller list, then try again.");
      return false;
    }
  };

  // Load saved data on mount (persists across tab switches until Clear).
  // PATCH 1086 — watchlist scope render. The header reads STORAGE_NAME and
  // showed "Loaded: tar-earnings-watchlist.csv", but the body still rendered
  // the empty drop-zone because data was historically uploaded under the
  // unscoped key `mc:fundamentals:data:v1` (or a sibling scope), so the
  // scoped lookup `mc:fundamentals:watchlist:data:v1` returned nothing.
  // We now fall back through the scoped name + scoped key, then the unscoped
  // key, and finally the sibling-scope keys, so any saved list flows into
  // the analyzer and the dropzone gives way to the dashboard.
  // PATCH 1101oo — Strict-scope load + name consistency. BUG: user uploaded
  // latest-portfolio.csv with 52 stocks; after refresh saw same filename but
  // 49 DIFFERENT stocks. Two compounding causes:
  //   1. mcPersist swallowed quota-exceeded errors. Data write failed (too big)
  //      but name write succeeded (small). Storage left holding PREV data +
  //      NEW name → refresh = mismatch.
  //   2. Previous PATCH 1086 added fall-through to other scopes for migration;
  //      a portfolio mount could pick up watchlist data.
  // Fix: load STRICTLY from the scoped pair. If saved data is empty but a
  // name is present, clear the orphaned name so UI stops claiming a file is
  // loaded that isn't actually present.
  useEffect(() => {
    try {
      const rawData = localStorage.getItem(STORAGE_KEY);
      const rawName = localStorage.getItem(STORAGE_NAME);
      let parsedData: Row[] | null = null;
      if (rawData) {
        try {
          const parsed = JSON.parse(rawData);
          if (Array.isArray(parsed) && parsed.length) parsedData = parsed;
        } catch {}
      }
      if (parsedData) {
        setData(parsedData);
        if (rawName) setFname(rawName);
      } else if (rawName) {
        try { localStorage.removeItem(STORAGE_NAME); } catch {}
        setFname('');
      } else {
        // PATCH 1101ss — switching markets needs to CLEAR previous market's data
        // from React state, otherwise stale rows linger.
        setData([]);
        setFname('');
      }
    } catch {}
  }, [STORAGE_KEY, STORAGE_NAME]);

  // Merge new rows into existing — accumulate across uploads, de-dup by ticker, NEW data wins.
  // PATCH 1101oo — atomic data+name persistence. Previously the data write
  // could fail (quota exceeded on a large merged CSV) while the name write
  // succeeded (small payload), leaving storage with NEW name + OLD data.
  // Refresh then loaded the OLD data and showed the NEW filename — confusing
  // mismatch the user reported. Now: only write the name when data succeeded.
  const handleText = useCallback((text: string, name: string) => {
    try {
      const incoming = toObjects(parseCSV(text));
      if (!incoming.length) { setError('No data rows found in that file.'); return; }
      // PATCH 1101tt — Format detection. Reject cross-market uploads.
      const headers = Object.keys(incoming[0] || {});
      const isTradingViewUSA = headers.some(h =>
        h.includes('Forward non-GAAP') ||
        h.includes('Piotroski F-score') ||
        h.includes('Free cash flow margin %, Annual') ||
        h.includes('Performance %, 1 year')
      );
      const isScreenerIndia = headers.some(h =>
        h === 'NSE Code' || h === 'BSE Code' || h === 'Promoter holding' ||
        h.includes('Pledge') || h === 'ROCE 3yr avg' || h === 'Debtor days'
      );
      if (market === 'USA' && !isTradingViewUSA && isScreenerIndia) {
        setError(`❌ "${name}" looks like an India Screener.in CSV (has columns like NSE Code / Promoter holding). You're on the 🇺🇸 USA tab. Switch to 🇮🇳 INDIA before uploading this file, or upload a TradingView USA export here.`);
        return;
      }
      if (market === 'INDIA' && !isScreenerIndia && isTradingViewUSA) {
        setError(`❌ "${name}" looks like a TradingView USA CSV (has columns like Forward non-GAAP P/E / Piotroski F-score). You're on the 🇮🇳 INDIA tab. Switch to 🇺🇸 USA before uploading this file.`);
        return;
      }
      // Drop rows that don't have a usable symbol — prevents the dedup collision
      // that previously collapsed every USA row into the same empty-key bucket.
      const validIncoming = incoming.filter((r) => rowKey(r) !== '');
      if (!validIncoming.length) {
        setError(`No rows with a recognised Symbol / Ticker / NSE Code / BSE Code column found in "${name}".`);
        return;
      }
      setData((prev) => {
        const map = new Map<string, Row>();
        prev.forEach((r) => map.set(rowKey(r), r));
        validIncoming.forEach((r) => map.set(rowKey(r), r));
        const merged = Array.from(map.values());
        const dataOk = mcPersist(STORAGE_KEY, JSON.stringify(merged));
        if (dataOk) {
          mcPersist(STORAGE_NAME, name);
          setFname(name);
          setError('');
        } else {
          // Quota fail. Don't write the name — it would lie about what's
          // actually in storage. Force the in-memory rows back to prev so the
          // user's screen matches what will reload on refresh.
          try { localStorage.removeItem(STORAGE_NAME); } catch {}
          return prev;
        }
        return merged;
      });
    } catch (e: any) { setError('Could not parse that CSV: ' + (e?.message || e)); }
  }, [market, STORAGE_KEY, STORAGE_NAME]);

  const clearAll = useCallback(() => {
    setData([]); setFname(''); setError('');
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_NAME); } catch {}
  }, []);

  // Remove a single company from the loaded list (persists).
  const removeRow = useCallback((key: string) => {
    setData((prev) => {
      const next = prev.filter((r) => rowKey(r) !== key);
      try { mcPersist(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Manually add one or many tickers (comma/space separated). Creates placeholder rows
  // (Name + NSE Code only) that fill with metrics when a matching CSV is later uploaded.
  const addTickers = useCallback((raw: string) => {
    const syms = (raw || '').split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!syms.length) return;
    setData((prev) => {
      const map = new Map<string, Row>();
      prev.forEach((r) => map.set(rowKey(r), r));
      syms.forEach((s) => { if (!map.has(s)) map.set(s, { 'Name': s, 'NSE Code': s } as Row); });
      const merged = Array.from(map.values());
      try { mcPersist(STORAGE_KEY, JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, []);

  // Accept one or many files (multi-select or multi-drop); each merges in.
  const onFile = useCallback((files?: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files as any) as File[];
    arr.forEach((f) => {
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => handleText(String(ev.target?.result || ''), f.name);
      r.readAsText(f);
    });
  }, [handleText]);

  return (
    <div style={{ background: COL.bg, minHeight: '100vh', color: COL.txt, fontSize: 13, padding: '20px 22px 80px' }}>
      <div style={{ maxWidth: 1480, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, borderBottom: `1px solid ${COL.line}`, paddingBottom: 14, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 20, margin: 0, fontWeight: 700 }}>
              Fundamentals <span style={{ color: COL.cyan }}>Analyzer</span>
            </h1>
            <div style={{ color: COL.muted, fontSize: 12, marginTop: 4, maxWidth: 760 }}>
              Upload any Screener.in export — averages &amp; medians, top/bottom-10 leaders, growth quadrant, quality screens. Works at any size (20 / 30 / 80 stocks); analytics key off the column fields. Headline “avg” is trimmed (top/bottom 5% removed) so one outlier can’t distort it.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {/* PATCH 1101ss — INDIA/USA market toggle. Each market has its own
                saved list and accepts its own CSV format. */}
            <div style={{ display: 'flex', gap: 0, border: `1px solid ${COL.line2}`, borderRadius: 6, overflow: 'hidden' }}>
              {(['INDIA', 'USA'] as const).map((m) => {
                const active = market === m;
                const color = m === 'INDIA' ? '#10B981' : '#22D3EE';
                return (
                  <button
                    key={m}
                    onClick={() => setMarket(m)}
                    style={{
                      padding: '6px 12px', fontSize: 12, fontWeight: 800, letterSpacing: '0.3px',
                      background: active ? `${color}22` : 'transparent',
                      color: active ? color : COL.muted,
                      border: 'none', cursor: 'pointer',
                    }}
                  >{m === 'INDIA' ? '🇮🇳 INDIA' : '🇺🇸 USA'}</button>
                );
              })}
            </div>
            {fname ? <span style={chip}>Loaded: <b style={{ color: COL.txt }}>{fname}</b></span> : null}
            {data.length ? <span style={chip}><b style={{ color: COL.txt }}>{data.length}</b> stocks</span> : null}
            {data.length ? (
              <button
                onClick={clearAll}
                style={{ ...drop, borderColor: COL.line2, background: 'transparent', cursor: 'pointer' }}
              >✕ Clear list</button>
            ) : null}
            <label style={{ ...drop, borderColor: COL.line2 }}>
              ⤓ {data.length ? 'Add / upload CSV(s)' : 'Upload CSV(s)'}
              <input
                type="file"
                accept=".csv"
                multiple
                style={{ display: 'none' }}
                onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                onChange={(e) => onFile(e.target.files)}
              />
            </label>
          </div>
        </div>

        {error ? <div style={{ color: COL.red, marginTop: 14, fontSize: 12 }}>{error}</div> : null}

        {/* Empty state / dropzone */}
        {!data.length ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files); }}
            style={{
              marginTop: 40, border: `2px dashed ${dragging ? COL.cyan : COL.line2}`, borderRadius: 14,
              padding: '60px 24px', textAlign: 'center', background: COL.panel2, transition: '.15s',
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              {market === 'USA'
                ? 'Drop a TradingView USA CSV here, or click "Upload CSV"'
                : 'Drop a Screener.in CSV here, or click "Upload CSV"'}
            </div>
            <div style={{ color: COL.muted, fontSize: 12 }}>Any number of stocks. Expected columns include:</div>
            <div style={{ color: COL.dim, fontSize: 11.5, marginTop: 8, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
              {market === 'USA'
                ? 'Symbol · Description · Sector · Market capitalization · Revenue growth %, Annual YoY · Gross margin %, TTM · Free cash flow margin %, Annual · Forward P/E · EV/EBITDA · ROIC · ROCE · Net margin %, TTM · Performance %, 1 year (and 3M / 6M) · Beta 5y · EBITDA margin %, TTM · Target price · Analyst rating · Piotroski F-score · Altman Z-score'
                : SAMPLE_HINT}
            </div>
          </div>
        ) : market === 'USA' ? (
          <UsaFundamentalsDashboard data={data} onRemove={removeRow} onClear={clearAll} />
        ) : (
          <Dashboard data={data} onRemove={removeRow} onAdd={addTickers} onClear={clearAll} />
        )}
      </div>
    </div>
  );
}

const chip: any = { background: '#1b2330', border: `1px solid ${COL.line}`, borderRadius: 6, padding: '3px 9px', color: COL.muted, fontSize: 11 };
const drop: any = { border: `1px dashed ${COL.line2}`, borderRadius: 8, padding: '8px 14px', color: COL.muted, fontSize: 12, cursor: 'pointer', background: COL.panel2 };

// ============================================================================
// PATCH 1101ss — USA Fundamentals dashboard. Reads TradingView CSV columns
// and renders a US-centric table + key analytics. India columns (ROCE, debtor
// days, promoter holding, etc.) are absent in USA exports so we don't pretend
// they exist; instead we surface what TV actually provides.
function UsaFundamentalsDashboard({ data, onRemove, onClear }: { data: Row[]; onRemove: (key: string) => void; onClear: () => void }) {
  const [sortKey, setSortKey] = useState<string>('Market capitalization');
  const [sortDesc, setSortDesc] = useState(true);

  const get = (r: Row, ...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (v !== undefined && v !== '' && v !== null) return v;
    }
    return undefined;
  };
  const n = (v: any): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const p = parseFloat(String(v).replace(/[,$%]/g, ''));
    return isNaN(p) ? undefined : p;
  };

  type UsaRow = {
    raw: Row; symbol: string; company: string; sector: string;
    mcapB?: number; price?: number; r40?: number; fwdPe?: number; pe?: number;
    revAnn?: number; revQtr?: number; fcfMargin?: number; gpm?: number; opm?: number;
    roic?: number; roce?: number; roe?: number; netMargin?: number;
    perf1y?: number; perf3m?: number; perf6m?: number;
    rsRating?: number; beta?: number; ebitdaMargin?: number;
    epsGrowth?: number; pegFwd?: number; targetUpside?: number;
    piotroski?: number; analystRating?: string;
  };
  const rows: UsaRow[] = useMemo(() => data.map((r) => {
    const symbol = String(get(r, 'Symbol', 'Ticker') ?? '').trim().toUpperCase();
    const company = String(get(r, 'Description', 'Company name', 'Company') ?? '').trim();
    const sector = String(get(r, 'Sector', 'Industry') ?? '').trim();
    const mcap = n(get(r, 'Market capitalization', 'Market Cap'));
    const mcapB = mcap !== undefined ? Math.round(mcap / 1e9 * 100) / 100 : undefined;
    const price = n(get(r, 'Price', 'Last', 'Close'));
    const revAnn = n(get(r, 'Revenue growth %, Annual YoY', 'Revenue growth, Annual YoY'));
    const revQtr = n(get(r, 'Revenue growth %, Quarterly YoY', 'Revenue growth, Quarterly YoY'));
    const fcfMargin = n(get(r, 'Free cash flow margin %, Annual', 'FCF margin, Annual'));
    const gpm = n(get(r, 'Gross margin %, Trailing 12 months', 'Gross margin %, TTM'));
    const opm = n(get(r, 'Operating margin %, Trailing 12 months', 'Operating margin %, TTM'));
    const r40 = (revAnn !== undefined && fcfMargin !== undefined) ? Math.round(revAnn + fcfMargin) : undefined;
    const fwdPe = n(get(r, 'Forward non-GAAP price to earnings, Annual', 'Forward P/E', 'Fwd P/E'));
    const pe = n(get(r, 'Price to earnings ratio', 'P/E'));
    const roic = n(get(r, 'Return on invested capital %, Annual', 'ROIC'));
    const roce = n(get(r, 'Return on capital employed %, Annual', 'ROCE'));
    const roe = n(get(r, 'Return on equity %, Trailing 12 months', 'ROE TTM'));
    const netMargin = n(get(r, 'Net margin %, Trailing 12 months', 'Net margin TTM'));
    const perf1y = n(get(r, 'Performance %, 1 year', 'Performance, 1 Year %'));
    const perf3m = n(get(r, 'Performance %, 3 months'));
    const perf6m = n(get(r, 'Performance %, 6 months'));
    const beta = n(get(r, 'Beta, 5 years', 'Beta 5y', 'Beta'));
    const ebitdaMargin = n(get(r, 'EBITDA margin %, Trailing 12 months', 'EBITDA margin %, TTM'));
    const epsGrowth = n(get(r, 'Earnings per share diluted growth %, TTM YoY', 'EPS growth %, TTM YoY'));
    const peg = n(get(r, 'Price to earning to growth, Trailing 12 months', 'PEG'));
    const piotroski = n(get(r, 'Piotroski F-score, Trailing 12 months', 'Piotroski F-score, Annual'));
    const analystRating = String(get(r, 'Analyst Rating', 'Analyst rating') ?? '').trim() || undefined;
    const targetPrice = n(get(r, 'Target price, 1 year', 'Target price 1 year'));
    const targetUpside = (targetPrice && price && price > 0) ? Math.round(((targetPrice - price) / price) * 100) : undefined;
    let rsRating: number | undefined;
    if (perf1y !== undefined || perf3m !== undefined || perf6m !== undefined) {
      const p3 = perf3m ?? perf1y ?? 0;
      const p6 = perf6m ?? perf1y ?? 0;
      const p12 = perf1y ?? 0;
      const composite = 0.30 * p3 + 0.40 * p6 + 0.30 * p12;
      rsRating = Math.max(1, Math.min(99, Math.round(50 + composite * 0.5)));
    }
    return { raw: r, symbol, company, sector, mcapB, price, r40, fwdPe, pe, revAnn, revQtr, fcfMargin, gpm, opm, roic, roce, roe, netMargin, perf1y, perf3m, perf6m, rsRating, beta, ebitdaMargin, epsGrowth, pegFwd: peg, targetUpside, piotroski, analystRating };
  }), [data]);

  const sortedRows = useMemo(() => {
    const out = [...rows];
    const k = sortKey as keyof UsaRow;
    out.sort((a, b) => {
      const av = (a as any)[k]; const bv = (b as any)[k];
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortDesc ? bv - av : av - bv;
      return sortDesc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
    return out;
  }, [rows, sortKey, sortDesc]);

  // Summary stats
  const med = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : Math.round(s[m]);
  };
  const r40s = rows.map(r => r.r40).filter((x): x is number => typeof x === 'number');
  const rsRatings = rows.map(r => r.rsRating).filter((x): x is number => typeof x === 'number');
  const fwdPes = rows.map(r => r.fwdPe).filter((x): x is number => typeof x === 'number' && x > 0);
  const roics = rows.map(r => r.roic).filter((x): x is number => typeof x === 'number');
  const eliteR40 = r40s.filter(x => x >= 60).length;
  const passingR40 = r40s.filter(x => x >= 40).length;
  const topRs = rsRatings.filter(x => x >= 80).length;

  // Sector aggregation
  const sectorMap = new Map<string, { count: number; r40s: number[]; rs: number[] }>();
  for (const r of rows) {
    const s = r.sector || 'Unclassified';
    const cur = sectorMap.get(s) ?? { count: 0, r40s: [], rs: [] };
    cur.count++;
    if (typeof r.r40 === 'number') cur.r40s.push(r.r40);
    if (typeof r.rsRating === 'number') cur.rs.push(r.rsRating);
    sectorMap.set(s, cur);
  }
  const sectors = Array.from(sectorMap.entries())
    .map(([sec, v]) => ({ sec, count: v.count, medR40: med(v.r40s), medRs: med(v.rs) }))
    .sort((a, b) => b.medR40 - a.medR40);

  const headerCell: any = { padding: '8px 10px', fontSize: 10, fontWeight: 800, color: COL.muted, letterSpacing: '0.4px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'left' };
  const cell: any = { padding: '7px 10px', fontSize: 11, color: COL.txt, fontVariantNumeric: 'tabular-nums', borderTop: `1px solid ${COL.line}`, whiteSpace: 'nowrap' };
  const setSort = (k: string) => { if (sortKey === k) setSortDesc(!sortDesc); else { setSortKey(k); setSortDesc(true); } };
  const arrow = (k: string) => sortKey === k ? (sortDesc ? ' ↓' : ' ↑') : '';
  const colorR40 = (r: number) => r >= 80 ? '#10B981' : r >= 60 ? '#22D3EE' : r >= 40 ? '#3B82F6' : r >= 20 ? '#F59E0B' : r >= 0 ? '#FB923C' : '#EF4444';
  const colorRs = (r: number) => r >= 80 ? '#10B981' : r >= 60 ? '#22D3EE' : r >= 40 ? COL.muted : '#F59E0B';

  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {[
          { label: 'Stocks', val: rows.length, color: '#22D3EE' },
          { label: 'Median R40', val: med(r40s), color: '#22D3EE' },
          { label: 'R40 Elite (≥60)', val: eliteR40, color: '#10B981' },
          { label: 'R40 Pass (≥40)', val: passingR40, color: '#3B82F6' },
          { label: 'RS ≥80', val: topRs, color: '#10B981' },
          { label: 'Median Fwd P/E', val: med(fwdPes), color: '#F59E0B' },
          { label: 'Median ROIC %', val: med(roics), color: '#10B981' },
        ].map((s, i) => (
          <div key={i} style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: COL.muted, fontWeight: 700, letterSpacing: '0.4px' }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: s.color, marginTop: 2 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Sector heatmap */}
      {sectors.length > 0 && (
        <div style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: COL.cyan, marginBottom: 8, letterSpacing: '0.4px' }}>🇺🇸 SECTOR R40 / RS — median by sector</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sectors.map(s => (
              <div key={s.sec} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px 80px 60px', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: COL.txt, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sec}</span>
                <div style={{ position: 'relative', height: 10, background: COL.panel, borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(2, Math.min(100, (s.medR40 + 50) / 1.5))}%`, background: colorR40(s.medR40) }} />
                </div>
                <span style={{ color: colorR40(s.medR40), fontWeight: 800, textAlign: 'right' }}>R40 {s.medR40}</span>
                <span style={{ color: colorRs(s.medRs), fontWeight: 800, textAlign: 'right' }}>RS {s.medRs}</span>
                <span style={{ color: COL.muted, textAlign: 'right' }}>{s.count} cos</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PATCH 1101tt — Must Hold / Exit Triggers — strengths and risks count per stock.
          Builds parity with India fundamentals "Keep / Exit" sections. */}
      {(() => {
        const score = (r: UsaRow) => {
          const strengths: string[] = [];
          const triggers: string[] = [];
          if (typeof r.r40 === 'number') {
            if (r.r40 >= 60) strengths.push('R40 elite ≥60');
            else if (r.r40 < 0) triggers.push('R40 negative — cash burning');
          }
          if (typeof r.rsRating === 'number') {
            if (r.rsRating >= 80) strengths.push('RS Rating top 20%');
            else if (r.rsRating <= 20) triggers.push('RS bottom 20%');
          }
          if (typeof r.roic === 'number' && r.roic >= 20) strengths.push('ROIC ≥20% (Buffett tier)');
          else if (typeof r.roic === 'number' && r.roic < 5) triggers.push('ROIC <5%');
          if (typeof r.fcfMargin === 'number' && r.fcfMargin >= 15) strengths.push('FCF margin ≥15%');
          else if (typeof r.fcfMargin === 'number' && r.fcfMargin < 0) triggers.push('FCF negative');
          if (typeof r.ebitdaMargin === 'number' && r.ebitdaMargin >= 30) strengths.push('EBITDA margin ≥30%');
          if (typeof r.gpm === 'number' && r.gpm >= 60) strengths.push('Gross margin ≥60% (moat)');
          if (typeof r.netMargin === 'number' && r.netMargin >= 20) strengths.push('Net margin ≥20%');
          if (typeof r.perf1y === 'number' && r.perf1y >= 30) strengths.push('1Y return ≥30%');
          else if (typeof r.perf1y === 'number' && r.perf1y < -20) triggers.push('1Y return <-20%');
          if (typeof r.pegFwd === 'number' && r.pegFwd > 0 && r.pegFwd < 1) strengths.push('PEG <1 (cheap vs growth)');
          else if (typeof r.pegFwd === 'number' && r.pegFwd > 3) triggers.push('PEG >3 (rich)');
          if (typeof r.fwdPe === 'number' && r.fwdPe > 0 && r.fwdPe > 80) triggers.push('Fwd P/E >80');
          if (typeof r.beta === 'number' && r.beta >= 2) triggers.push('Beta ≥2 (volatile)');
          if (typeof r.piotroski === 'number' && r.piotroski >= 7) strengths.push('Piotroski ≥7/9');
          else if (typeof r.piotroski === 'number' && r.piotroski <= 3) triggers.push('Piotroski ≤3/9');
          if (typeof r.targetUpside === 'number' && r.targetUpside >= 20) strengths.push('Analyst upside ≥20%');
          else if (typeof r.targetUpside === 'number' && r.targetUpside <= -10) triggers.push('Analyst downside');
          return { strengths, triggers };
        };
        const scored = rows.map(r => ({ r, s: score(r) }));
        const mustHold = scored.filter(x => x.s.strengths.length >= 3).sort((a, b) => b.s.strengths.length - a.s.strengths.length).slice(0, 25);
        const exitTriggers = scored.filter(x => x.s.triggers.length >= 2).sort((a, b) => b.s.triggers.length - a.s.triggers.length).slice(0, 25);
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
            <div style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#10B981', marginBottom: 4, letterSpacing: '0.4px' }}>✅ MUST HOLD / KEEP CONVICTION ({mustHold.length})</div>
              <div style={{ fontSize: 10, color: COL.muted, marginBottom: 8 }}>≥3 institutional strengths. More green flags = stronger case to hold/add.</div>
              {mustHold.map(({ r, s }) => (
                <div key={r.symbol} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: 8, padding: '5px 0', borderTop: `1px solid ${COL.line}`, fontSize: 11 }}>
                  <span style={{ color: '#10B981', fontWeight: 800 }}>{r.symbol}</span>
                  <span style={{ color: COL.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.strengths.slice(0, 4).join(' · ')}</span>
                  <span style={{ color: '#10B981', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.strengths.length}</span>
                </div>
              ))}
              {mustHold.length === 0 && <div style={{ color: COL.muted, fontSize: 11 }}>No stocks meet ≥3 strengths.</div>}
            </div>
            <div style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#EF4444', marginBottom: 4, letterSpacing: '0.4px' }}>⚠️ EXIT / REVIEW TRIGGERS ({exitTriggers.length})</div>
              <div style={{ fontSize: 10, color: COL.muted, marginBottom: 8 }}>≥2 red flags. More triggers = stronger case to exit/trim.</div>
              {exitTriggers.map(({ r, s }) => (
                <div key={r.symbol} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', gap: 8, padding: '5px 0', borderTop: `1px solid ${COL.line}`, fontSize: 11 }}>
                  <span style={{ color: '#EF4444', fontWeight: 800 }}>{r.symbol}</span>
                  <span style={{ color: COL.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.triggers.slice(0, 4).join(' · ')}</span>
                  <span style={{ color: '#EF4444', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{s.triggers.length}</span>
                </div>
              ))}
              {exitTriggers.length === 0 && <div style={{ color: COL.muted, fontSize: 11 }}>No stocks flagged.</div>}
            </div>
          </div>
        );
      })()}

      {/* PATCH 1101tt — Leader grids (top 10 by various metrics, India parity). */}
      {(() => {
        const lead = (key: keyof UsaRow, desc = true, label: string, color: string, fmt: (v: number) => string) => {
          const filtered = rows.filter(r => typeof r[key] === 'number') as UsaRow[];
          const sorted = filtered.sort((a, b) => desc ? ((b[key] as number) - (a[key] as number)) : ((a[key] as number) - (b[key] as number))).slice(0, 10);
          return { label, color, items: sorted.map(r => ({ symbol: r.symbol, company: r.company, val: fmt(r[key] as number) })) };
        };
        const leaders = [
          lead('rsRating', true, 'Top 10 — RS Rating', '#10B981', (v) => String(v)),
          lead('r40', true, 'Top 10 — Rule of 40', '#22D3EE', (v) => String(v)),
          lead('roic', true, 'Top 10 — ROIC %', '#3B82F6', (v) => `${v.toFixed(0)}%`),
          lead('ebitdaMargin', true, 'Top 10 — EBITDA margin %', '#10B981', (v) => `${v.toFixed(0)}%`),
          lead('fcfMargin', true, 'Top 10 — FCF margin %', '#22D3EE', (v) => `${v.toFixed(0)}%`),
          lead('revAnn', true, 'Top 10 — Revenue growth %', '#10B981', (v) => `${v.toFixed(0)}%`),
          lead('perf1y', true, 'Top 10 — 1-year return %', '#F59E0B', (v) => `${v.toFixed(0)}%`),
          lead('targetUpside', true, 'Top 10 — Implied upside vs target', '#22D3EE', (v) => `${v >= 0 ? '↑' : '↓'} ${Math.abs(v)}%`),
          lead('pegFwd', false, 'Bottom 10 — PEG (cheapest)', '#10B981', (v) => v.toFixed(2)),
          lead('fwdPe', true, 'Top 10 — Richest Fwd P/E', '#EF4444', (v) => `${v.toFixed(0)}×`),
        ];
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {leaders.map(l => l.items.length === 0 ? null : (
              <div key={l.label} style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: l.color, marginBottom: 6, letterSpacing: '0.3px' }}>{l.label}</div>
                {l.items.map((it, i) => (
                  <div key={it.symbol} style={{ display: 'grid', gridTemplateColumns: '20px 60px 1fr auto', gap: 6, padding: '3px 0', fontSize: 10.5, borderTop: i === 0 ? 'none' : `1px solid ${COL.line}` }}>
                    <span style={{ color: COL.muted }}>#{i + 1}</span>
                    <span style={{ color: l.color, fontWeight: 700 }}>{it.symbol}</span>
                    <span style={{ color: COL.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.company}</span>
                    <span style={{ color: l.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{it.val}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })()}

      {/* PATCH 1101tt — Sector mix + Beta distribution */}
      {(() => {
        const sectorCounts = new Map<string, number>();
        for (const r of rows) {
          const s = r.sector || 'Unclassified';
          sectorCounts.set(s, (sectorCounts.get(s) ?? 0) + 1);
        }
        const sectorList = Array.from(sectorCounts.entries()).sort((a, b) => b[1] - a[1]);
        const betas = rows.map(r => r.beta).filter((x): x is number => typeof x === 'number');
        const betaBuckets = [
          { label: '< 0.7 defensive', test: (b: number) => b < 0.7, color: '#10B981' },
          { label: '0.7–1.0', test: (b: number) => b >= 0.7 && b < 1.0, color: '#22D3EE' },
          { label: '1.0–1.3', test: (b: number) => b >= 1.0 && b < 1.3, color: '#3B82F6' },
          { label: '1.3–2.0', test: (b: number) => b >= 1.3 && b < 2.0, color: '#F59E0B' },
          { label: '≥ 2.0 high-vol', test: (b: number) => b >= 2.0, color: '#EF4444' },
        ].map(b => ({ ...b, count: betas.filter(b.test).length }));
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
            <div style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: COL.cyan, marginBottom: 8, letterSpacing: '0.4px' }}>🧭 SECTOR MIX ({sectorList.length} groups)</div>
              {sectorList.map(([sec, n]) => (
                <div key={sec} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '4px 0', fontSize: 11, borderTop: `1px solid ${COL.line}` }}>
                  <span style={{ color: COL.txt }}>{sec}</span>
                  <span style={{ color: COL.muted, fontVariantNumeric: 'tabular-nums' }}>{n} ({Math.round(n / rows.length * 100)}%)</span>
                </div>
              ))}
            </div>
            <div style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: COL.cyan, marginBottom: 8, letterSpacing: '0.4px' }}>📈 BETA DISTRIBUTION</div>
              {betaBuckets.map(b => (
                <div key={b.label} style={{ display: 'grid', gridTemplateColumns: '140px 1fr auto', gap: 8, padding: '4px 0', fontSize: 11, borderTop: `1px solid ${COL.line}`, alignItems: 'center' }}>
                  <span style={{ color: b.color, fontWeight: 700 }}>{b.label}</span>
                  <div style={{ position: 'relative', height: 8, background: COL.panel, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.max(2, (b.count / Math.max(1, betas.length)) * 100)}%`, background: b.color }} />
                  </div>
                  <span style={{ color: b.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Main table */}
      <div style={{ background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${COL.line}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: COL.cyan, letterSpacing: '0.4px' }}>🇺🇸 USA Holdings — sortable</div>
          <button onClick={onClear} style={{ ...drop, color: COL.red, borderColor: '#EF444460', background: '#EF444411' }}>✕ Clear all</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: COL.panel }}>
              <th style={headerCell}>TICKER</th>
              <th style={headerCell}>COMPANY</th>
              <th style={headerCell}>SECTOR</th>
              <th style={headerCell as any} onClick={() => setSort('mcapB')}>MCAP $B{arrow('mcapB')}</th>
              <th style={headerCell as any} onClick={() => setSort('r40')}>R40{arrow('r40')}</th>
              <th style={headerCell as any} onClick={() => setSort('rsRating')}>RS{arrow('rsRating')}</th>
              <th style={headerCell as any} onClick={() => setSort('revAnn')}>REV YOY{arrow('revAnn')}</th>
              <th style={headerCell as any} onClick={() => setSort('fcfMargin')}>FCF M{arrow('fcfMargin')}</th>
              <th style={headerCell as any} onClick={() => setSort('ebitdaMargin')}>EBITDA M{arrow('ebitdaMargin')}</th>
              <th style={headerCell as any} onClick={() => setSort('roic')}>ROIC{arrow('roic')}</th>
              <th style={headerCell as any} onClick={() => setSort('fwdPe')}>FWD P/E{arrow('fwdPe')}</th>
              <th style={headerCell as any} onClick={() => setSort('pegFwd')}>PEG{arrow('pegFwd')}</th>
              <th style={headerCell as any} onClick={() => setSort('targetUpside')}>UPSIDE{arrow('targetUpside')}</th>
              <th style={headerCell as any} onClick={() => setSort('beta')}>BETA{arrow('beta')}</th>
              <th style={headerCell as any} onClick={() => setSort('piotroski')}>PIO{arrow('piotroski')}</th>
              <th style={headerCell}>✕</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => (
              <tr key={r.symbol}>
                <td style={{ ...cell, fontWeight: 800, color: COL.cyan }}>{r.symbol}</td>
                <td style={{ ...cell, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.company}</td>
                <td style={{ ...cell, color: COL.muted, fontSize: 10 }}>{r.sector}</td>
                <td style={cell}>{r.mcapB?.toLocaleString() ?? '—'}</td>
                <td style={{ ...cell, color: typeof r.r40 === 'number' ? colorR40(r.r40) : COL.muted, fontWeight: 800 }}>{r.r40 ?? '—'}</td>
                <td style={{ ...cell, color: typeof r.rsRating === 'number' ? colorRs(r.rsRating) : COL.muted, fontWeight: 800 }}>{r.rsRating ?? '—'}</td>
                <td style={cell}>{r.revAnn !== undefined ? `${r.revAnn.toFixed(0)}%` : '—'}</td>
                <td style={cell}>{r.fcfMargin !== undefined ? `${r.fcfMargin.toFixed(0)}%` : '—'}</td>
                <td style={cell}>{r.ebitdaMargin !== undefined ? `${r.ebitdaMargin.toFixed(0)}%` : '—'}</td>
                <td style={cell}>{r.roic !== undefined ? `${r.roic.toFixed(0)}%` : '—'}</td>
                <td style={cell}>{r.fwdPe !== undefined ? `${r.fwdPe.toFixed(0)}×` : '—'}</td>
                <td style={cell}>{r.pegFwd !== undefined ? r.pegFwd.toFixed(2) : '—'}</td>
                <td style={{ ...cell, color: typeof r.targetUpside === 'number' ? (r.targetUpside >= 20 ? '#10B981' : r.targetUpside >= 0 ? '#22D3EE' : '#EF4444') : COL.muted, fontWeight: 700 }}>
                  {r.targetUpside !== undefined ? `${r.targetUpside >= 0 ? '↑' : '↓'} ${Math.abs(r.targetUpside)}%` : '—'}
                </td>
                <td style={{ ...cell, color: typeof r.beta === 'number' ? (r.beta >= 2 ? '#EF4444' : r.beta >= 1.3 ? '#F59E0B' : '#10B981') : COL.muted }}>
                  {r.beta !== undefined ? r.beta.toFixed(1) : '—'}
                </td>
                <td style={{ ...cell, color: typeof r.piotroski === 'number' ? (r.piotroski >= 7 ? '#10B981' : r.piotroski >= 5 ? '#22D3EE' : '#F59E0B') : COL.muted, fontWeight: 700 }}>
                  {r.piotroski ?? '—'}
                </td>
                <td style={cell}>
                  <button onClick={() => onRemove(rowKey(r.raw))} style={{ background: 'transparent', border: 'none', color: COL.muted, cursor: 'pointer', fontSize: 14 }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: COL.dim, textAlign: 'center', marginTop: 6 }}>
        TradingView USA fundamentals · all metrics computed in-browser. R40 = revenue growth + FCF margin · RS = O&apos;Neil-style 1-99 from 3M/6M/1Y composite · Upside = vs analyst 1-year target · PEG = trailing.
      </div>
    </div>
  );
}

// ============================================================================
function Dashboard({ data, onRemove, onAdd, onClear }: { data: Row[]; onRemove: (key: string) => void; onAdd: (raw: string) => void; onClear: () => void }) {
  const [addVal, setAddVal] = useState('');
  const col = useCallback((k: string) => data.map((d) => num(d[k])), [data]);
  const name = (d: Row) => d['Name'] || '';
  const nse = (d: Row) => d['NSE Code'] || d['BSE Code'] || '';

  const kpiDefs: [string, string, string][] = [
    ['Sales growth', 'Sales growth (TTM)', '%'],
    ['Profit growth', 'Profit growth (TTM)', '%'],
    ['YOY Quarterly sales growth', 'Sales gr (YoY Qtr)', '%'],
    ['YOY Quarterly profit growth', 'Profit gr (YoY Qtr)', '%'],
    ['Sales growth 3Years', 'Sales CAGR 3Y', '%'],
    ['Profit growth 3Years', 'Profit CAGR 3Y', '%'],
    ['Return on capital employed', 'ROCE', '%'],
    ['Return on invested capital', 'ROIC', '%'],
    ['OPM', 'Operating margin', '%'],
    ['Return over 1year', '1-Year return', '%'],
    ['Price to Earning', 'P/E', 'x'],
    ['PEG Ratio', 'PEG', 'x'],
    ['Debt to equity', 'Debt / Equity', 'x'],
    ['Promoter holding', 'Promoter holding', '%'],
  ];

  const leaders = (key: string, dir: 'desc' | 'asc', n = 10) => {
    const v = data.filter((d) => !isNaN(num(d[key])));
    v.sort((a, b) => (dir === 'desc' ? num(b[key]) - num(a[key]) : num(a[key]) - num(b[key])));
    return v.slice(0, n);
  };

  // quality compounder score
  const quality = useMemo(() => {
    const z = (key: string) => {
      const s = stats(col(key));
      const arr = col(key).filter((x) => !isNaN(x));
      const sd = Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - s.mean, 2), 0) / Math.max(1, arr.length));
      return (d: Row) => { const v = num(d[key]); return isNaN(v) || sd === 0 ? 0 : (v - s.mean) / sd; };
    };
    const zRoce = z('Return on capital employed'), zP3 = z('Profit growth 3Years'), zS3 = z('Sales growth 3Years'), zOpm = z('OPM'), zDE = z('Debt to equity');
    return data.map((d) => ({ d, q: zRoce(d) * 1.2 + zP3(d) * 1.0 + zS3(d) * 0.8 + zOpm(d) * 0.6 - zDE(d) * 0.8 }))
      .sort((a, b) => b.q - a.q).slice(0, 12);
  }, [data, col]);

  // sector mix
  const sectors = useMemo(() => {
    const m: Record<string, number> = {};
    data.forEach((d) => { const g = d['Industry Group'] || 'Other'; m[g] = (m[g] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [data]);

  // moving-average position — only renders if the file has DMA columns (CMP vs 50/200-DMA)
  const [maMode, setMaMode] = useState<'below' | 'above'>('below');
  const hasMA = useMemo(() => data.some((d) => !isNaN(num(d['DMA 50'])) || !isNaN(num(d['DMA 200']))), [data]);
  const maList = (dmaKey: string, mode: 'below' | 'above') => {
    const v = data.filter((d) => {
      const cmp = num(d['Current Price']); const dma = num(d[dmaKey]);
      if (isNaN(cmp) || isNaN(dma)) return false;
      return mode === 'below' ? cmp < dma : cmp >= dma;
    });
    v.sort((a, b) => {
      const da = (num(a['Current Price']) - num(a[dmaKey])) / num(a[dmaKey]);
      const db = (num(b['Current Price']) - num(b[dmaKey])) / num(b[dmaKey]);
      return mode === 'below' ? da - db : db - da; // below: most-below first · above: most-above first
    });
    return v;
  };
  const ma50 = hasMA ? maList('DMA 50', maMode) : [];
  const ma200 = hasMA ? maList('DMA 200', maMode) : [];
  const withMA50 = data.filter((d) => !isNaN(num(d['DMA 50'])) && !isNaN(num(d['Current Price']))).length;
  const withMA200 = data.filter((d) => !isNaN(num(d['DMA 200'])) && !isNaN(num(d['Current Price']))).length;
  const maOn = maMode === 'below' ? COL.red : COL.green;

  // Fundamental + technical EXIT / REVIEW triggers — institutional deterioration checklist.
  const exitFlags = (d: Row): string[] => {
    const f: string[] = [];
    const pg = num(d['Profit growth']); if (!isNaN(pg) && pg < 0) f.push('Profit shrinking');
    const sg = num(d['Sales growth']); if (!isNaN(sg) && sg < 0) f.push('Sales shrinking');
    const qpg = num(d['YOY Quarterly profit growth']); if (!isNaN(qpg) && qpg < 0) f.push('Qtr profit down YoY');
    const pg3 = num(d['Profit growth 3Years']); if (!isNaN(pg) && !isNaN(pg3) && pg3 > 10 && pg < pg3 * 0.5) f.push('Profit decelerating vs 3Y');
    const opmL = num(d['OPM latest quarter']); const opmY = num(d['OPM last year']); if (!isNaN(opmL) && !isNaN(opmY) && opmL < opmY - 2) f.push('Margin squeeze');
    const de = num(d['Debt to equity']); if (!isNaN(de) && de > 1) f.push('High debt D/E>1');
    const cfo = num(d['CFO to PAT']); if (!isNaN(cfo) && cfo >= 0 && cfo < 0.5) f.push('Weak cash conversion');
    const roce = num(d['Return on capital employed']); if (!isNaN(roce) && roce < 10) f.push('Low ROCE<10');
    const peg = num(d['PEG Ratio']); if (!isNaN(peg) && peg > 2) f.push('Expensive PEG>2');
    const pe = num(d['Price to Earning']); if (!isNaN(pe) && pe > 80) f.push('Rich P/E>80');
    const chp = num(d['Change in promoter holding 3Years']); if (!isNaN(chp) && chp < -2) f.push('Promoter reducing');
    const pl = num(d['Pledged percentage']); if (!isNaN(pl) && pl > 15) f.push('High pledge');
    const cmp = num(d['Current Price']); const dma200 = num(d['DMA 200']); if (!isNaN(cmp) && !isNaN(dma200) && cmp < dma200) f.push('Below 200-DMA');
    const dma50 = num(d['DMA 50']); if (!isNaN(cmp) && !isNaN(dma50) && cmp < dma50) f.push('Below 50-DMA');
    return f;
  };
  const flagged = data.map((d) => ({ d, flags: exitFlags(d) })).filter((o) => o.flags.length > 0).sort((a, b) => b.flags.length - a.flags.length);

  // Fundamental + technical HOLD / KEEP signals — institutional quality checklist (the inverse of exit triggers).
  const holdFlags = (d: Row): string[] => {
    const f: string[] = [];
    const pg = num(d['Profit growth']); if (!isNaN(pg) && pg > 20) f.push('Profit compounding>20');
    const sg = num(d['Sales growth']); if (!isNaN(sg) && sg > 15) f.push('Sales growth>15');
    const qpg = num(d['YOY Quarterly profit growth']); if (!isNaN(qpg) && qpg > 20) f.push('Qtr profit accelerating');
    const pg3 = num(d['Profit growth 3Years']); if (!isNaN(pg3) && pg3 > 20) f.push('3Y profit compounder');
    const opmL = num(d['OPM latest quarter']); const opmY = num(d['OPM last year']); if (!isNaN(opmL) && !isNaN(opmY) && opmL > opmY + 2) f.push('Margin expanding');
    const de = num(d['Debt to equity']); if (!isNaN(de) && de < 0.3) f.push('Low debt D/E<0.3');
    const cfo = num(d['CFO to PAT']); if (!isNaN(cfo) && cfo >= 0.8) f.push('Strong cash conversion');
    const roce = num(d['Return on capital employed']); if (!isNaN(roce) && roce > 20) f.push('High ROCE>20');
    const peg = num(d['PEG Ratio']); if (!isNaN(peg) && peg > 0 && peg < 1) f.push('Attractive PEG<1');
    const chp = num(d['Change in promoter holding 3Years']); if (!isNaN(chp) && chp > 2) f.push('Promoter increasing');
    const pl = num(d['Pledged percentage']); if (!isNaN(pl) && pl === 0) f.push('Zero pledge');
    const r1 = num(d['Return over 1year']); if (!isNaN(r1) && r1 > 30) f.push('1Y return>30%');
    const cmp = num(d['Current Price']); const dma200 = num(d['DMA 200']); if (!isNaN(cmp) && !isNaN(dma200) && cmp > dma200) f.push('Above 200-DMA');
    const dma50 = num(d['DMA 50']); if (!isNaN(cmp) && !isNaN(dma50) && cmp > dma50) f.push('Above 50-DMA');
    return f;
  };
  const holders = data.map((d) => ({ d, flags: holdFlags(d) })).filter((o) => o.flags.length >= 2).sort((a, b) => b.flags.length - a.flags.length);

  // Margin movers — OPM latest quarter vs OPM last year (QoQ-style margin trend).
  const marginMovers = data.map((d) => ({ d, delta: num(d['OPM latest quarter']) - num(d['OPM last year']) })).filter((o) => !isNaN(o.delta));
  const marginUp = [...marginMovers].sort((a, b) => b.delta - a.delta).slice(0, 15);
  const marginDn = [...marginMovers].sort((a, b) => a.delta - b.delta).slice(0, 15);
  // PEG re-rating candidates — cheap relative to growth (PEG between 0 and 1, profit growing).
  const cheapGrowth = data.filter((d) => { const p = num(d['PEG Ratio']); const g = num(d['Profit growth']); return !isNaN(p) && p > 0 && p <= 1 && !isNaN(g) && g > 0; })
    .sort((a, b) => num(a['PEG Ratio']) - num(b['PEG Ratio'])).slice(0, 10);
  // Promoter stake change — only true buying (>0) / true reducing (<0); flat 0% excluded.
  const promUp = data.filter((d) => num(d['Change in promoter holding 3Years']) > 0).sort((a, b) => num(b['Change in promoter holding 3Years']) - num(a['Change in promoter holding 3Years'])).slice(0, 10);
  const promDn = data.filter((d) => num(d['Change in promoter holding 3Years']) < 0).sort((a, b) => num(a['Change in promoter holding 3Years']) - num(b['Change in promoter holding 3Years'])).slice(0, 10);

  const MoverTable = ({ rows }: { rows: { d: Row; delta: number }[] }) => (
    <table style={tbl}>
      <thead><tr><th style={thR}></th><th style={thL}>Company</th><th style={thR}>OPM now</th><th style={thR}>OPM 1Y</th><th style={thR}>Δ pp</th></tr></thead>
      <tbody>
        {rows.map((o, i) => (
          <tr key={i}>
            <td style={tdDim}>{i + 1}</td>
            <td style={tdL}><b>{name(o.d)}</b><span style={nseS}>{nse(o.d)}</span></td>
            <td style={tdR}>{isNaN(num(o.d['OPM latest quarter'])) ? '—' : fmt(num(o.d['OPM latest quarter']), 1) + '%'}</td>
            <td style={tdR}>{isNaN(num(o.d['OPM last year'])) ? '—' : fmt(num(o.d['OPM last year']), 1) + '%'}</td>
            <td style={{ ...tdR, fontWeight: 700, color: pcCol(o.delta) }}>{(o.delta >= 0 ? '+' : '') + fmt(o.delta, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div>
      {/* Moving averages — below/above 50-DMA & 200-DMA (renders only if file has DMA columns) */}
      {hasMA && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0 4px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: COL.dim, fontWeight: 700 }}>Moving averages — price vs DMA</div>
            <div style={{ display: 'flex', gap: 4, background: COL.panel2, border: `1px solid ${COL.line}`, borderRadius: 8, padding: 3 }}>
              {(['below', 'above'] as const).map((m) => (
                <button key={m} onClick={() => setMaMode(m)} style={{ padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: maMode === m ? (m === 'below' ? COL.red : COL.green) : 'transparent', color: maMode === m ? '#fff' : COL.muted }}>{m === 'below' ? '↓ Below MA' : '↑ Above MA'}</button>
              ))}
            </div>
          </div>
          <div style={grid2}>
            <Card title={`${maMode === 'below' ? 'Below' : 'Above'} 50-DMA — ${ma50.length} of ${withMA50}`} dot={maOn} hint={`price ${maMode === 'below' ? 'under' : 'over'} the 50-day moving average`}>
              <MATable rows={ma50} dmaKey="DMA 50" name={name} nse={nse} />
            </Card>
            <Card title={`${maMode === 'below' ? 'Below' : 'Above'} 200-DMA — ${ma200.length} of ${withMA200}`} dot={maOn} hint={`price ${maMode === 'below' ? 'under' : 'over'} the 200-day moving average`}>
              <MATable rows={ma200} dmaKey="DMA 200" name={name} nse={nse} />
            </Card>
          </div>
        </div>
      )}

      {/* Must hold / keep — fundamental + technical strength */}
      {holders.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 4px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: COL.dim, fontWeight: 700 }}>Must hold / keep conviction</div>
            <div style={{ fontSize: 11, color: COL.dim }}>{holders.length} of {data.length} names show fundamental or technical strength · ranked by strength count</div>
          </div>
          <Card title={`Keep / accumulate candidates — ${holders.length} strong`} dot={COL.green} hint="more green flags = stronger case to hold / add">
            <table style={tbl}>
              <thead><tr>
                <th style={thR}></th><th style={thL}>Company</th><th style={thR}>#</th>
                <th style={thL}>Strengths</th><th style={thR}>Profit gr.</th><th style={thR}>Sales gr.</th><th style={thR}>ROCE</th><th style={thR}>D/E</th>
              </tr></thead>
              <tbody>
                {holders.slice(0, 25).map((o, i) => {
                  const tech = (s: string) => s.indexOf('DMA') >= 0;
                  return (
                    <tr key={i}>
                      <td style={tdDim}>{i + 1}</td>
                      <td style={tdL}><b>{name(o.d)}</b><span style={nseS}>{nse(o.d)}</span></td>
                      <td style={{ ...tdR, fontWeight: 700, color: o.flags.length >= 5 ? COL.green : o.flags.length >= 3 ? COL.cyan : COL.muted }}>{o.flags.length}</td>
                      <td style={{ ...tdL, paddingTop: 7, paddingBottom: 7 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {o.flags.map((fl, k) => (
                            <span key={k} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', color: tech(fl) ? COL.cyan : COL.green, background: tech(fl) ? 'rgba(57,208,216,.12)' : 'rgba(63,185,80,.12)', border: `1px solid ${tech(fl) ? 'rgba(57,208,216,.3)' : 'rgba(63,185,80,.3)'}` }}>{fl}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ ...tdR, color: pcCol(num(o.d['Profit growth'])) }}>{pctStr(num(o.d['Profit growth']))}</td>
                      <td style={{ ...tdR, color: pcCol(num(o.d['Sales growth'])) }}>{pctStr(num(o.d['Sales growth']))}</td>
                      <td style={tdR}>{isNaN(num(o.d['Return on capital employed'])) ? '—' : fmt(num(o.d['Return on capital employed']), 1) + '%'}</td>
                      <td style={tdR}>{isNaN(num(o.d['Debt to equity'])) ? '—' : fmt(num(o.d['Debt to equity']), 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 10.5, color: COL.dim, marginTop: 8, lineHeight: 1.5 }}>
              <span style={{ color: COL.green }}>■</span> fundamental strengths (profit/sales compounding, margin expanding, low debt, strong cash conversion, high ROCE, attractive PEG, promoter adding, zero pledge, strong 1Y return) · <span style={{ color: COL.cyan }}>■</span> technical strengths (above 50/200-DMA). Strengths flag names to <b>hold / accumulate</b> — not automatic buys.
            </div>
          </Card>
        </div>
      )}

      {/* Exit / review triggers — fundamental + technical deterioration */}
      {flagged.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, margin: '0 0 4px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: COL.dim, fontWeight: 700 }}>Exit / review triggers</div>
            <div style={{ fontSize: 11, color: COL.dim }}>{flagged.length} of {data.length} names show fundamental or technical deterioration · ranked by trigger count</div>
          </div>
          <Card title={`Sell / trim candidates — ${flagged.length} flagged`} dot={COL.red} hint="more triggers = stronger case to exit / review">
            <table style={tbl}>
              <thead><tr>
                <th style={thR}></th><th style={thL}>Company</th><th style={thR}>#</th>
                <th style={thL}>Triggers</th><th style={thR}>Profit gr.</th><th style={thR}>Sales gr.</th><th style={thR}>ROCE</th><th style={thR}>D/E</th>
              </tr></thead>
              <tbody>
                {flagged.slice(0, 25).map((o, i) => {
                  const tech = (s: string) => s.indexOf('DMA') >= 0;
                  return (
                    <tr key={i}>
                      <td style={tdDim}>{i + 1}</td>
                      <td style={tdL}><b>{name(o.d)}</b><span style={nseS}>{nse(o.d)}</span></td>
                      <td style={{ ...tdR, fontWeight: 700, color: o.flags.length >= 4 ? COL.red : o.flags.length >= 2 ? COL.amber : COL.muted }}>{o.flags.length}</td>
                      <td style={{ ...tdL, paddingTop: 7, paddingBottom: 7 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {o.flags.map((fl, k) => (
                            <span key={k} style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', color: tech(fl) ? COL.amber : COL.red, background: tech(fl) ? 'rgba(210,153,34,.12)' : 'rgba(248,81,73,.12)', border: `1px solid ${tech(fl) ? 'rgba(210,153,34,.3)' : 'rgba(248,81,73,.3)'}` }}>{fl}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ ...tdR, color: pcCol(num(o.d['Profit growth'])) }}>{pctStr(num(o.d['Profit growth']))}</td>
                      <td style={{ ...tdR, color: pcCol(num(o.d['Sales growth'])) }}>{pctStr(num(o.d['Sales growth']))}</td>
                      <td style={tdR}>{isNaN(num(o.d['Return on capital employed'])) ? '—' : fmt(num(o.d['Return on capital employed']), 1) + '%'}</td>
                      <td style={tdR}>{isNaN(num(o.d['Debt to equity'])) ? '—' : fmt(num(o.d['Debt to equity']), 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 10.5, color: COL.dim, marginTop: 8, lineHeight: 1.5 }}>
              <span style={{ color: COL.red }}>■</span> fundamental triggers (profit/sales shrinking, margin squeeze, high debt, weak cash conversion, low ROCE, rich valuation, promoter selling, pledge) · <span style={{ color: COL.amber }}>■</span> technical triggers (below 50/200-DMA). Triggers flag names to <b>review</b> — not automatic sells.
            </div>
          </Card>
        </div>
      )}

      {/* Quality + ROCE */}
      <div style={grid2}>
        <Card title="Quality compounders" dot={COL.violet} hint="ROCE + 3Y growth + margins − leverage">
          <table style={tbl}>
            <thead><tr><th style={thR}></th><th style={thL}>Company</th><th style={thR}>Score</th><th style={thR}>ROCE</th><th style={thR}>Profit 3Y</th><th style={thR}>D/E</th></tr></thead>
            <tbody>
              {quality.map((o, i) => (
                <tr key={i}>
                  <td style={tdDim}>{i + 1}</td>
                  <td style={tdL}><b>{name(o.d)}</b><span style={nseS}>{nse(o.d)}</span></td>
                  <td style={{ ...tdR, color: COL.blue, fontWeight: 700 }}>{fmt(o.q, 2)}</td>
                  <td style={tdR}>{fmt(num(o.d['Return on capital employed']), 1)}%</td>
                  <td style={{ ...tdR, color: pcCol(num(o.d['Profit growth 3Years'])) }}>{pctStr(num(o.d['Profit growth 3Years']))}</td>
                  <td style={tdR}>{fmt(num(o.d['Debt to equity']), 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Top 10 — Return on capital employed" dot={COL.amber} hint="capital efficiency">
          <LeaderTable rows={leaders('Return on capital employed', 'desc')} valKey="Return on capital employed" unit="%" name={name} nse={nse}
            extra={[['Profit growth', 'Profit gr.', '%'], ['Debt to equity', 'D/E', 'x']]} />
        </Card>
      </div>

      {/* Margin trend — OPM latest quarter vs last year */}
      <div style={grid2}>
        <Card title="Top 15 — Margin expansion" dot={COL.green} hint="OPM latest qtr − OPM last year (pp)">
          <MoverTable rows={marginUp} />
        </Card>
        <Card title="Top 15 — Margin compression" dot={COL.red} hint="OPM squeeze vs last year (pp)">
          <MoverTable rows={marginDn} />
        </Card>
      </div>

      {/* Promoter conviction — change in promoter holding over 3 years */}
      <div style={grid2}>
        <Card title={`Promoter buying — 3Y change (${promUp.length})`} dot={COL.green} hint="rising promoter stake (skin in the game)">
          <LeaderTable rows={promUp} valKey="Change in promoter holding 3Years" unit="%" name={name} nse={nse}
            extra={[['Promoter holding', 'Holding', '%'], ['Pledged percentage', 'Pledge', '%']]} />
        </Card>
        <Card title={`Promoter reducing — 3Y change (${promDn.length})`} dot={COL.red} hint="falling promoter stake — watch">
          <LeaderTable rows={promDn} valKey="Change in promoter holding 3Years" unit="%" name={name} nse={nse}
            extra={[['Promoter holding', 'Holding', '%'], ['Pledged percentage', 'Pledge', '%']]} />
        </Card>
      </div>

      {/* KPI strip */}
      <SecTitle>Watchlist averages &amp; medians</SecTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(176px,1fr))', gap: 10 }}>
        {kpiDefs.map(([k, lab, u]) => {
          const s = stats(col(k));
          const unit = u === '%' ? '%' : u === 'x' ? 'x' : '';
          const head = s.trimmed;
          const cls = u === '%' ? (isNaN(head) ? COL.txt : head >= 0 ? COL.green : COL.red) : COL.blue;
          return (
            <div key={k} style={kpiCard}>
              <div style={{ fontSize: 10.5, letterSpacing: .4, textTransform: 'uppercase', color: COL.muted, marginBottom: 7, fontWeight: 600 }}>
                {lab}<span style={{ color: COL.dim, fontWeight: 500 }}> · avg</span>
              </div>
              <div style={{ fontSize: 23, fontWeight: 700, color: cls }}>{isNaN(head) ? '—' : fmt(head, 1) + unit}</div>
              <div style={{ fontSize: 11, color: COL.dim, marginTop: 4 }}>median <b style={{ color: COL.muted }}>{isNaN(s.median) ? '—' : fmt(s.median, 1) + unit}</b> · n={s.n}</div>
            </div>
          );
        })}
      </div>

      {/* Market Cap leaders (Top 15 / Bottom 15) */}
      <div style={grid2}>
        <Card title="Top 15 — Largest Market Cap">
          <LeaderTable rows={leaders('Market Capitalization', 'desc', 15)} valKey="Market Capitalization" unit=" Cr" name={name} nse={nse} />
        </Card>
        <Card title="Bottom 15 — Smallest Market Cap">
          <LeaderTable rows={leaders('Market Capitalization', 'asc', 15)} valKey="Market Capitalization" unit=" Cr" name={name} nse={nse} />
        </Card>
      </div>

      {/* Sales growth leaders */}
      <div style={grid2}>
        <Card title="Top 10 — Sales growth (TTM)" dot={COL.green} hint="highest revenue momentum">
          <LeaderTable rows={leaders('Sales growth', 'desc')} valKey="Sales growth" unit="%" name={name} nse={nse} />
        </Card>
        <Card title="Bottom 10 — Sales growth (TTM)" dot={COL.red} hint="weakest / shrinking">
          <LeaderTable rows={leaders('Sales growth', 'asc')} valKey="Sales growth" unit="%" name={name} nse={nse} />
        </Card>
      </div>

      {/* Profit growth leaders */}
      <div style={grid2}>
        <Card title="Top 10 — Profit growth (TTM)" dot={COL.green} hint="highest earnings momentum">
          <LeaderTable rows={leaders('Profit growth', 'desc')} valKey="Profit growth" unit="%" name={name} nse={nse} />
        </Card>
        <Card title="Bottom 10 — Profit growth (TTM)" dot={COL.red} hint="earnings under pressure">
          <LeaderTable rows={leaders('Profit growth', 'asc')} valKey="Profit growth" unit="%" name={name} nse={nse} />
        </Card>
      </div>

      {/* Quarterly momentum — YoY quarterly growth (most recent quarter vs year-ago quarter) */}
      <div style={grid2}>
        <Card title="Top 10 — Sales growth (YoY Qtr)" dot={COL.green} hint="latest-quarter revenue acceleration">
          <LeaderTable rows={leaders('YOY Quarterly sales growth', 'desc')} valKey="YOY Quarterly sales growth" unit="%" name={name} nse={nse}
            extra={[['Sales growth', 'TTM', '%']]} />
        </Card>
        <Card title="Top 10 — Profit growth (YoY Qtr)" dot={COL.green} hint="latest-quarter earnings acceleration">
          <LeaderTable rows={leaders('YOY Quarterly profit growth', 'desc')} valKey="YOY Quarterly profit growth" unit="%" name={name} nse={nse}
            extra={[['Profit growth', 'TTM', '%']]} />
        </Card>
      </div>

      {/* Quarterly momentum — decelerating / contracting */}
      <div style={grid2}>
        <Card title="Bottom 10 — Sales growth (YoY Qtr)" dot={COL.red} hint="latest-quarter revenue weakest">
          <LeaderTable rows={leaders('YOY Quarterly sales growth', 'asc')} valKey="YOY Quarterly sales growth" unit="%" name={name} nse={nse}
            extra={[['Sales growth', 'TTM', '%']]} />
        </Card>
        <Card title="Bottom 10 — Profit growth (YoY Qtr)" dot={COL.red} hint="latest-quarter earnings weakest">
          <LeaderTable rows={leaders('YOY Quarterly profit growth', 'asc')} valKey="YOY Quarterly profit growth" unit="%" name={name} nse={nse}
            extra={[['Profit growth', 'TTM', '%']]} />
        </Card>
      </div>

      {/* Valuation — value vs expensive */}
      <div style={grid2}>
        <Card title={`Re-rating value — PEG ≤ 1 with growth (${cheapGrowth.length})`} dot={COL.violet} hint="cheap relative to earnings growth">
          <LeaderTable rows={cheapGrowth} valKey="PEG Ratio" unit="x" name={name} nse={nse}
            extra={[['Profit growth', 'Profit gr.', '%'], ['Price to Earning', 'P/E', 'x']]} />
        </Card>
        <Card title="Top 10 — Richest P/E" dot={COL.amber} hint="priciest on earnings — valuation risk">
          <LeaderTable rows={leaders('Price to Earning', 'desc')} valKey="Price to Earning" unit="x" name={name} nse={nse}
            extra={[['Profit growth', 'Profit gr.', '%'], ['PEG Ratio', 'PEG', 'x']]} />
        </Card>
      </div>

      {/* 1Y return + sector */}
      <div style={grid2}>
        <Card title="Top 10 — 1-Year return" dot={COL.blue} hint="price performance">
          <LeaderTable rows={leaders('Return over 1year', 'desc')} valKey="Return over 1year" unit="%" name={name} nse={nse}
            extra={[['Profit growth', 'Profit gr.', '%'], ['Price to Earning', 'PE', 'x']]} />
        </Card>
        <Card title="Sector mix" dot={COL.cyan} hint={`${sectors.length} industry groups`}>
          <Bars items={sectors.slice(0, 12).map(([k, v]) => [k, v])} total={data.length} color={COL.cyan} />
        </Card>
      </div>

      {/* Histograms */}
      <div style={grid2}>
        <Card title="Distribution — Sales growth (TTM)" dot={COL.green}>
          <Histogram values={col('Sales growth')} color={COL.green} unit="Sales gr %" />
        </Card>
        <Card title="Distribution — Profit growth (TTM)" dot={COL.violet}>
          <Histogram values={col('Profit growth')} color={COL.violet} unit="Profit gr %" />
        </Card>
      </div>

      {/* Manage list — remove individual companies */}
      <div style={{ marginTop: 16 }}>
        <Card title={`Manage list — ${data.length} stocks`} dot={COL.dim} hint="add tickers · clear all · click ✕ to remove one">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              value={addVal}
              onChange={(e) => setAddVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(addVal); setAddVal(''); } }}
              placeholder="Add tickers — e.g. INFY, TCS, RELIANCE (Enter to add)"
              style={{ flex: 1, minWidth: 260, background: COL.panel2, border: `1px solid ${COL.line2}`, borderRadius: 8, padding: '8px 12px', color: COL.txt, fontSize: 12.5, outline: 'none' }}
            />
            <button
              onClick={() => { onAdd(addVal); setAddVal(''); }}
              style={{ background: COL.green, border: 'none', borderRadius: 8, padding: '8px 18px', color: '#0a0e14', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >+ Add</button>
            <button
              onClick={() => { if (confirm('Clear all ' + data.length + ' stocks from this list? Upload again to repopulate.')) onClear(); }}
              style={{ background: 'transparent', border: '1px solid ' + COL.red, borderRadius: 8, padding: '8px 18px', color: COL.red, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            >✕ Clear all</button>
          </div>
          <div style={{ fontSize: 10.5, color: COL.dim, marginBottom: 10 }}>New tickers are added as placeholders — upload a Screener.in CSV with the same code to fill in their metrics.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
            {data.map((d, i) => {
              const noData = isNaN(num(d['Sales growth'])) && isNaN(num(d['Profit growth'])) && isNaN(num(d['Current Price'])) && isNaN(num(d['Return on capital employed']));
              return (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: COL.panel2, border: `1px solid ${noData ? COL.amber : COL.line}`, borderRadius: 6, padding: '3px 4px 3px 9px', fontSize: 11.5 }}>
                <span style={{ color: COL.txt }}>{d['NSE Code'] || d['BSE Code'] || d['Name'] || '?'}</span>
                {noData ? <span title="No data yet — upload a Screener.in CSV with this code to fill metrics" style={{ color: COL.amber, fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .3 }}>no data</span> : null}
                <button onClick={() => onRemove(rowKey(d))} title="Remove" style={{ background: 'none', border: 'none', color: COL.red, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 3px' }}>✕</button>
              </span>
              );
            })}
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 28, color: COL.dim, fontSize: 11, borderTop: `1px solid ${COL.line}`, paddingTop: 14 }}>
        All metrics computed in-browser from the loaded file. Headline “avg” is a trimmed mean (extreme top/bottom 5% removed); raw median shown alongside. Quadrant clamps extreme outliers to the axis edge. Blanks excluded.
      </div>
    </div>
  );
}

// ---- small components ----
function SecTitle({ children }: { children: any }) {
  return <div style={{ fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: COL.dim, margin: '22px 0 10px', fontWeight: 700 }}>{children}</div>;
}
function Card({ title, dot, hint, children }: { title: string; dot: string; hint?: string; children: any }) {
  return (
    <div style={{ background: COL.panel, border: `1px solid ${COL.line}`, borderRadius: 10, padding: 14, marginTop: 16 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: dot, display: 'inline-block' }} />
        {title}
        {hint ? <span style={{ marginLeft: 'auto', fontSize: 10.5, color: COL.dim, fontWeight: 500 }}>{hint}</span> : null}
      </h3>
      {children}
    </div>
  );
}
function pcCol(n: number) { return isNaN(n) ? COL.muted : n >= 0 ? COL.green : COL.red; }
function pctStr(n: number) { return isNaN(n) ? '—' : (n >= 0 ? '+' : '') + fmt(n, 1) + '%'; }

function LeaderTable({ rows, valKey, unit, name, nse, extra }: {
  rows: Row[]; valKey: string; unit: string; name: (d: Row) => string; nse: (d: Row) => string;
  extra?: [string, string, string][];
}) {
  const ex = extra || [['Return on capital employed', 'ROCE', '%'], ['Price to Earning', 'PE', 'x']];
  return (
    <table style={tbl}>
      <thead>
        <tr>
          <th style={thR}></th><th style={thL}>Company</th><th style={thR}>{unit === 'x' ? 'Value (x)' : unit === '%' ? 'Value %' : 'Value (' + unit.trim() + ')'}</th>
          {ex.map((e, i) => <th key={i} style={thR}>{e[1]}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((d, i) => {
          const val = num(d[valKey]);
          return (
            <tr key={i}>
              <td style={tdDim}>{i + 1}</td>
              <td style={tdL}><b>{name(d)}</b><span style={nseS}>{nse(d)}</span></td>
              <td style={{ ...tdR, fontWeight: 700, color: unit === '%' ? pcCol(val) : COL.txt }}>
                {unit === 'x' ? fmt(val, 2) + 'x' : unit === '%' ? pctStr(val) : Math.round(val).toLocaleString('en-IN') + unit}
              </td>
              {ex.map((e, j) => {
                const ev = num(d[e[0]]);
                return <td key={j} style={tdR}>{isNaN(ev) ? '—' : fmt(ev, e[2] === 'x' ? 2 : 1) + (e[2] === '%' ? '%' : e[2] === 'x' ? 'x' : '')}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Bars({ items, total, color }: { items: [string, number][]; total: number; color: string }) {
  const max = Math.max(1, ...items.map((i) => i[1]));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
          <div style={{ width: 150, color: COL.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={k}>{k}</div>
          <div style={{ flex: 1, background: '#0d1420', borderRadius: 4, height: 14, position: 'relative' }}>
            <div style={{ width: `${(v / max) * 100}%`, background: color, height: '100%', borderRadius: 4, opacity: .85 }} />
          </div>
          <div style={{ width: 56, textAlign: 'right', color: COL.txt }}>{v} <span style={{ color: COL.dim }}>({Math.round((v / total) * 100)}%)</span></div>
        </div>
      ))}
    </div>
  );
}

function Histogram({ values, color, unit }: { values: number[]; color: string; unit: string }) {
  const bins: [number, number, string][] = [
    [-1e9, -25, '<-25'], [-25, 0, '-25–0'], [0, 15, '0–15'], [15, 30, '15–30'],
    [30, 50, '30–50'], [50, 75, '50–75'], [75, 100, '75–100'], [100, 1e9, '100+'],
  ];
  const v = values.filter((x) => !isNaN(x));
  const counts = bins.map((b) => v.filter((x) => x >= b[0] && x < b[1]).length);
  const max = Math.max(1, ...counts);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 200 }}>
        {counts.map((c, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{ fontSize: 10, color: COL.muted, marginBottom: 3 }}>{c || ''}</div>
            <div style={{ width: '100%', height: `${(c / max) * 100}%`, background: color, opacity: .85, borderRadius: '3px 3px 0 0', minHeight: c ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
        {bins.map((b, i) => <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9.5, color: COL.dim }}>{b[2]}</div>)}
      </div>
      <div style={{ textAlign: 'center', fontSize: 10.5, color: COL.dim, marginTop: 4 }}>{unit} bucket · # stocks</div>
    </div>
  );
}

// PATCH 1069 — Build a TradingView chart URL from a raw NSE/BSE symbol. We
// reuse the heuristic from TickerExportToolbar: 6-digit pure-numeric ⇒ BSE
// scrip code, alphabetic ⇒ NSE. Returns null when there's no usable symbol.
function tvUrlFor(raw: string): string | null {
  const t = (raw || '').toUpperCase().trim();
  const bare = t.replace(/^(NSE|BSE|NYSE|NASDAQ):/i, '');
  if (!bare) return null;
  const sym = /^\d{6}$/.test(bare) ? `BSE:${bare}` : `NSE:${bare}`;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(sym)}`;
}

function ChartLink({ symbol }: { symbol: string }) {
  const url = tvUrlFor(symbol);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${symbol} on TradingView (check candles, MAs)`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', fontSize: 11, fontWeight: 800,
        border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', borderRadius: 4,
        background: 'color-mix(in srgb, var(--mc-cyan) 7%, transparent)', color: 'var(--mc-cyan)',
        textDecoration: 'none', cursor: 'pointer', letterSpacing: 0.3,
        whiteSpace: 'nowrap',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      📈 Chart
    </a>
  );
}

function MATable({ rows, dmaKey, name, nse }: {
  rows: Row[]; dmaKey: string; name: (d: Row) => string; nse: (d: Row) => string;
}) {
  if (!rows.length) return <div style={{ color: COL.dim, fontSize: 12, padding: '8px 2px' }}>None in this bucket.</div>;
  return (
    <table style={tbl}>
      <thead>
        <tr><th style={thR}></th><th style={thL}>Company</th><th style={thR}>CMP</th><th style={thR}>{dmaKey}</th><th style={thR}>% vs MA</th><th style={thR}>Chart</th></tr>
      </thead>
      <tbody>
        {rows.map((d, i) => {
          const cmp = num(d['Current Price']); const dma = num(d[dmaKey]);
          const pct = dma ? ((cmp - dma) / dma) * 100 : NaN;
          const sym = nse(d);
          return (
            <tr key={i}>
              <td style={tdDim}>{i + 1}</td>
              <td style={tdL}><b>{name(d)}</b><span style={nseS}>{sym}</span></td>
              <td style={tdR}>{fmt(cmp, 1)}</td>
              <td style={tdR}>{fmt(dma, 1)}</td>
              <td style={{ ...tdR, color: pcCol(pct), fontWeight: 700 }}>{pct >= 0 ? '+' : ''}{fmt(pct, 1)}%</td>
              <td style={tdR}><ChartLink symbol={sym} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Quadrant({ data, name }: { data: Row[]; name: (d: Row) => string }) {
  const W = 760, H = 340, P = 44;
  const CL = 300, CLN = -100;
  const sx = (x: number) => P + ((Math.max(CLN, Math.min(CL, x)) - CLN) / (CL - CLN)) * (W - 2 * P);
  const sy = (y: number) => (H - P) - ((Math.max(CLN, Math.min(CL, y)) - CLN) / (CL - CLN)) * (H - 2 * P);
  let off = 0;
  const pts = data.map((d) => {
    const x = num(d['Sales growth']), y = num(d['Profit growth']);
    if (isNaN(x) || isNaN(y)) return null;
    if (x > CL || x < CLN || y > CL || y < CLN) off++;
    const cap = num(d['Market Capitalization']) || 100;
    let color = COL.red;
    if (x >= 0 && y >= 0) color = y >= x ? COL.green : COL.blue;
    if (y >= 15 && x >= 15) color = COL.green;
    if (y > 0 && x < 0) color = COL.amber;
    const r = Math.max(3, Math.min(20, Math.sqrt(cap) / 11));
    return { cx: sx(x), cy: sy(y), r, color, nm: name(d), x, y };
  }).filter(Boolean) as any[];
  const x0 = sx(0), y0 = sy(0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: COL.muted, marginBottom: 6 }}>
        <Leg c={COL.green} t="Compounders (both high)" /><Leg c={COL.amber} t="Margin expansion (profit>sales)" />
        <Leg c={COL.blue} t="Investing / margin squeeze (sales>profit)" /><Leg c={COL.red} t="Contraction" />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560, display: 'block' }}>
          <rect x={P} y={P} width={W - 2 * P} height={H - 2 * P} fill="#0d1420" stroke={COL.line} />
          <line x1={x0} y1={P} x2={x0} y2={H - P} stroke={COL.line2} strokeDasharray="3 3" />
          <line x1={P} y1={y0} x2={W - P} y2={y0} stroke={COL.line2} strokeDasharray="3 3" />
          {pts.map((p, i) => (
            <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={p.color + 'cc'} stroke={p.color} strokeWidth={1}>
              <title>{`${p.nm} · Sales ${p.x.toFixed(0)}%  Profit ${p.y.toFixed(0)}%`}</title>
            </circle>
          ))}
          <text x={W / 2} y={H - 10} fill={COL.muted} fontSize={11} textAnchor="middle">Sales growth % (TTM)</text>
          <text x={14} y={H / 2} fill={COL.muted} fontSize={11} textAnchor="middle" transform={`rotate(-90 14 ${H / 2})`}>Profit growth % (TTM)</text>
        </svg>
      </div>
      {off ? <div style={{ color: COL.dim, fontSize: 11, marginTop: 8 }}>{off} stock(s) had growth beyond ±{CL}% and were clamped to the chart edge to keep the quadrant readable.</div> : null}
    </div>
  );
}
function Leg({ c, t }: { c: string; t: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: c, display: 'inline-block' }} />{t}</span>;
}

// ---- style objects ----
const grid2: any = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
const kpiCard: any = { background: `linear-gradient(180deg,${COL.panel},${COL.panel2})`, border: `1px solid ${COL.line}`, borderRadius: 10, padding: '12px 13px' };
const tbl: any = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const thR: any = { textAlign: 'right', padding: '6px 8px', color: COL.dim, fontWeight: 600, fontSize: 10.5, letterSpacing: .4, textTransform: 'uppercase', borderBottom: `1px solid ${COL.line2}` };
const thL: any = { ...thR, textAlign: 'left' };
const tdR: any = { textAlign: 'right', padding: '6px 8px', borderBottom: `1px solid ${COL.line}` };
const tdL: any = { ...tdR, textAlign: 'left', color: COL.txt };
const tdDim: any = { ...tdR, color: COL.dim, width: 22 };
const nseS: any = { color: COL.dim, fontSize: 10.5, marginLeft: 6 };
