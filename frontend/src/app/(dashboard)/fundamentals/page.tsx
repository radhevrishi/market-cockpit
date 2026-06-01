'use client';

// ============================================================================
// FUNDAMENTALS ANALYZER (PATCH 1120)
// In-app, upload-driven analytics for Screener.in bulk exports.
// Drop any CSV (20 / 30 / 80 stocks — any size). Analytics key off the column
// fields, not the row count. No external chart deps (inline SVG + CSS bars).
// ============================================================================

import { useState, useMemo, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'mc:fundamentals:data:v1';
const STORAGE_NAME = 'mc:fundamentals:name:v1';
// Identity for de-dup: NSE code, else BSE code, else Name (uppercased).
const rowKey = (d: Record<string, string>) => ((d['NSE Code'] || d['BSE Code'] || d['Name'] || '').trim().toUpperCase());

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

export default function FundamentalsAnalyzerPage() {
  const [data, setData] = useState<Row[]>([]);
  const [fname, setFname] = useState<string>('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>('');

  // Load saved data on mount (persists across tab switches until Clear)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) setData(parsed);
      }
      const nm = localStorage.getItem(STORAGE_NAME);
      if (nm) setFname(nm);
    } catch {}
  }, []);

  // Merge new rows into existing — accumulate across uploads, de-dup by ticker, NEW data wins.
  const handleText = useCallback((text: string, name: string) => {
    try {
      const incoming = toObjects(parseCSV(text));
      if (!incoming.length) { setError('No data rows found in that file.'); return; }
      setData((prev) => {
        const map = new Map<string, Row>();
        prev.forEach((r) => map.set(rowKey(r), r));
        incoming.forEach((r) => map.set(rowKey(r), r)); // new upload overrides existing on same ticker
        const merged = Array.from(map.values());
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
        return merged;
      });
      setFname(name);
      try { localStorage.setItem(STORAGE_NAME, name); } catch {}
      setError('');
    } catch (e: any) { setError('Could not parse that CSV: ' + (e?.message || e)); }
  }, []);

  const clearAll = useCallback(() => {
    setData([]); setFname(''); setError('');
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(STORAGE_NAME); } catch {}
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
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Drop a Screener.in CSV here, or click “Upload CSV”</div>
            <div style={{ color: COL.muted, fontSize: 12 }}>Any number of stocks. Expected columns include:</div>
            <div style={{ color: COL.dim, fontSize: 11.5, marginTop: 8, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>{SAMPLE_HINT}</div>
          </div>
        ) : (
          <Dashboard data={data} />
        )}
      </div>
    </div>
  );
}

const chip: any = { background: '#1b2330', border: `1px solid ${COL.line}`, borderRadius: 6, padding: '3px 9px', color: COL.muted, fontSize: 11 };
const drop: any = { border: `1px dashed ${COL.line2}`, borderRadius: 8, padding: '8px 14px', color: COL.muted, fontSize: 12, cursor: 'pointer', background: COL.panel2 };

// ============================================================================
function Dashboard({ data }: { data: Row[] }) {
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

  const leaders = (key: string, dir: 'desc' | 'asc') => {
    const v = data.filter((d) => !isNaN(num(d[key])));
    v.sort((a, b) => (dir === 'desc' ? num(b[key]) - num(a[key]) : num(a[key]) - num(b[key])));
    return v.slice(0, 10);
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

  return (
    <div>
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

      {/* Growth quadrant */}
      <Card title="Growth quadrant — Sales vs Profit growth (TTM)" dot={COL.cyan} hint="bubble = market cap">
        <Quadrant data={data} name={name} />
      </Card>

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
          <th style={thR}></th><th style={thL}>Company</th><th style={thR}>{unit === 'x' ? 'Value (x)' : 'Value %'}</th>
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
              <td style={{ ...tdR, fontWeight: 700, color: unit === 'x' ? COL.txt : pcCol(val) }}>
                {unit === 'x' ? fmt(val, 2) + 'x' : pctStr(val)}
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

function MATable({ rows, dmaKey, name, nse }: {
  rows: Row[]; dmaKey: string; name: (d: Row) => string; nse: (d: Row) => string;
}) {
  if (!rows.length) return <div style={{ color: COL.dim, fontSize: 12, padding: '8px 2px' }}>None in this bucket.</div>;
  return (
    <table style={tbl}>
      <thead>
        <tr><th style={thR}></th><th style={thL}>Company</th><th style={thR}>CMP</th><th style={thR}>{dmaKey}</th><th style={thR}>% vs MA</th></tr>
      </thead>
      <tbody>
        {rows.map((d, i) => {
          const cmp = num(d['Current Price']); const dma = num(d[dmaKey]);
          const pct = dma ? ((cmp - dma) / dma) * 100 : NaN;
          return (
            <tr key={i}>
              <td style={tdDim}>{i + 1}</td>
              <td style={tdL}><b>{name(d)}</b><span style={nseS}>{nse(d)}</span></td>
              <td style={tdR}>{fmt(cmp, 1)}</td>
              <td style={tdR}>{fmt(dma, 1)}</td>
              <td style={{ ...tdR, color: pcCol(pct), fontWeight: 700 }}>{pct >= 0 ? '+' : ''}{fmt(pct, 1)}%</td>
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
