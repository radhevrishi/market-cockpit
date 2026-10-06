'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo } from 'react';
import { SECTOR_CALCULATOR_MAP } from '@/lib/valuation-calculators';
import { PLCell } from './components';
import { DIM, TEXT, BORDER } from './constants';
import { r2, r1, rsFmt, crFmt, epsFmt } from './helpers';

export function ForwardFairValueCalculator() {
  const [company, setCompany] = useState('');
  const [baseYear, setBaseYear] = useState('');
  const [price, setPrice] = useState(1431);
  const [shares, setShares] = useState(7.74);   // crore shares
  // base (current) P&L in ₹ Cr — defaults are Quality Power FY25 so the tab is usable before any upload
  const [bSales, setBSales] = useState(337);
  const [bOpm, setBOpm] = useState(19);
  const [bOI, setBOI] = useState(54);
  const [bDep, setBDep] = useState(5);
  const [bInt, setBInt] = useState(2);
  const [bTax, setBTax] = useState(11);
  // forward (target) P&L
  const [fSales, setFSales] = useState(800);
  const [fOpm, setFOpm] = useState(19);
  const [fOI, setFOI] = useState(54);
  const [fDep, setFDep] = useState(5);
  const [fInt, setFInt] = useState(2);
  const [fTax, setFTax] = useState(11);
  const [fShares, setFShares] = useState(7.74);
  // owner share % — reported net profit ÷ (PBT×(1−tax)). <100 = minority interest /
  // associates skimming profit before it reaches shareholders. Auto-derived from the
  // uploaded year so base EPS always reconciles to the REPORTED number, not a naive
  // PBT−tax that would overstate EPS (Quality Power reports ~67% to owners).
  const [bOwner, setBOwner] = useState(67);
  const [fOwner, setFOwner] = useState(67);
  const [years, setYears] = useState(1);
  const [peLow, setPeLow] = useState(40);
  const [peHigh, setPeHigh] = useState(60);
  const [peers, setPeers] = useState('');
  const [sector, setSector] = useState('');
  const [hist, setHist] = useState<{ yr: number; sales: number; opm: number; tax: number; pe: number }[]>([]);
  const [auto, setAuto] = useState<string[]>([]);   // human-readable list of assumptions applied
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setErr(null); setMsg(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sn = wb.SheetNames.find((n) => /data\s*sheet/i.test(n)) || wb.SheetNames.find((n) => /data/i.test(n));
      if (!sn) throw new Error('No "Data Sheet" tab found. Upload the standard Screener.in Excel export (it has a Data Sheet).');
      const ws: any = wb.Sheets[sn];
      const num = (a: string) => { const c = ws[a]; const v = c ? Number(c.v) : NaN; return Number.isFinite(v) ? v : NaN; };
      const st = (a: string) => { const c = ws[a]; return c && c.v != null ? String(c.v) : ''; };
      const cols = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      // rightmost annual P&L column: row 16 has a date AND row 17 (Sales) is a positive number
      let col = '';
      for (const cc of cols) { const s = num(cc + '17'); if (ws[cc + '16'] && ws[cc + '16'].v != null && Number.isFinite(s) && s > 0) col = cc; }
      if (!col) throw new Error('Could not locate the P&L rows (Sales at row 17) in the Data Sheet.');
      const sales = num(col + '17'), oi = num(col + '25'), dep = num(col + '26'), intr = num(col + '27'), pbt = num(col + '28'), tax = num(col + '29'), np = num(col + '30');
      const px = num('B8'), mcap = num('B9');
      let sh = (Number.isFinite(mcap) && Number.isFinite(px) && px > 0) ? mcap / px : NaN;
      if (!Number.isFinite(sh)) { const esc = num(col + '57'), fv = num('B7'); if (Number.isFinite(esc) && Number.isFinite(fv) && fv > 0) sh = esc / fv; }
      const g = (x: number) => (Number.isFinite(x) ? x : 0);
      const op = g(pbt) - g(oi) + g(dep) + g(intr);
      const opm = sales > 0 ? op / sales * 100 : 0;
      const taxPct = pbt > 0 ? g(tax) / pbt * 100 : 0;
      // owner share = reported net profit ÷ after-tax profit (captures minority interest)
      const afterTax = g(pbt) * (1 - taxPct / 100);
      const owner = (afterTax > 0 && Number.isFinite(np) && np > 0) ? Math.min(100, np / afterTax * 100) : 100;
      // date can arrive as a JS Date (cellDates), an Excel serial number, or a string
      const yr = (() => {
        const dv = ws[col + '16'] ? ws[col + '16'].v : null;
        if (dv instanceof Date) return String(dv.getFullYear());
        if (typeof dv === 'number' && dv > 20000) return String(new Date(Math.round((dv - 25569) * 86400000)).getUTCFullYear());
        const m = String(dv ?? '').match(/(19|20)\d{2}/);
        return m ? m[0] : '';
      })();
      const fy = yr ? `FY${Number(yr) % 100}` : '';
      setCompany(st('B1')); setBaseYear(fy);
      if (Number.isFinite(px)) setPrice(r2(px)); if (Number.isFinite(sh)) { setShares(r2(sh)); setFShares(r2(sh)); }
      setBSales(r1(sales)); setBOpm(r1(opm)); setBOI(r1(oi)); setBDep(r1(dep)); setBInt(r1(intr)); setBTax(r1(taxPct)); setBOwner(r1(owner));
      // ── parse the FULL P&L history so the forward assumptions come from the
      //    company's own track record, not a guess. Per annual column: sales, OPM
      //    (derived), effective tax %, and the year-end P/E (row-90 price ÷ EPS).
      const H: { yr: number; sales: number; opm: number; tax: number; pe: number }[] = [];
      for (const cc of cols) {
        const s = num(cc + '17'); if (!(Number.isFinite(s) && s > 0)) continue;
        const dvv = ws[cc + '16'] ? ws[cc + '16'].v : null;
        let y = 0;
        if (dvv instanceof Date) y = dvv.getFullYear();
        else if (typeof dvv === 'number' && dvv > 20000) y = new Date(Math.round((dvv - 25569) * 86400000)).getUTCFullYear();
        else { const mm = String(dvv ?? '').match(/(19|20)\d{2}/); y = mm ? Number(mm[0]) : 0; }
        const oi2 = num(cc + '25'), dep2 = num(cc + '26'), int2 = num(cc + '27'), pbt2 = num(cc + '28'), tax2 = num(cc + '29'), np2 = num(cc + '30');
        const op2 = g(pbt2) - g(oi2) + g(dep2) + g(int2);
        const yprice = num(cc + '90');
        const yeps = (Number.isFinite(np2) && sh > 0) ? np2 / sh : NaN;
        const ype = (Number.isFinite(yprice) && Number.isFinite(yeps) && yeps > 0) ? yprice / yeps : NaN;
        H.push({ yr: y, sales: s, opm: r1(s > 0 ? op2 / s * 100 : 0), tax: r1(pbt2 > 0 ? g(tax2) / pbt2 * 100 : 0), pe: Number.isFinite(ype) ? r1(ype) : 0 });
      }
      setHist(H);
      const recent = H.slice(-4);
      const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
      const avgOpm = avg(recent.map((h) => h.opm).filter((x) => x > 0)) || opm;
      const avgTax = avg(recent.map((h) => h.tax).filter((x) => x > 0)) || taxPct;
      const peHistVals = H.map((h) => h.pe).filter((x) => x > 0);
      let peL = peLow, peH = peHigh, peSrc = 'kept your current band — pick a sector below for a peer band';
      if (peHistVals.length >= 2) { peL = r1(Math.min(...peHistVals)); peH = r1(Math.max(...peHistVals)); peSrc = `the stock's own year-end P/E range (${peL}–${peH}×)`; }
      else if (peHistVals.length === 1) { peL = r1(peHistVals[0] * 0.85); peH = r1(peHistVals[0] * 1.15); peSrc = `history (~${r1(peHistVals[0])}×, ±15%)`; }
      const depPct = sales > 0 ? dep / sales * 100 : 0;
      // ── auto-fill the FORWARD column: everything derives from history so you only
      //    have to type the revenue target (and nudge margin if you disagree).
      setFSales(r1(sales));                                  // ← you override this with the target
      setFOpm(r1(opm));                                      // margin HELD at the latest FY (current structure) — your knob
      setFOI(r1(oi));                                        // other income held flat (non-operating)
      setFInt(r1(intr));                                     // interest held flat (debt-driven)
      setFDep(r1(dep));                                      // dep auto-scales with revenue as you type
      setFTax(r1(taxPct));                                   // tax held at the latest effective rate
      setFOwner(r1(owner));                                  // owner share held at reported structure
      setPeLow(peL); setPeHigh(peH);
      setAuto([
        `OPM held at latest ${r1(opm)}% (hist ${recent.length}-yr avg ${r1(avgOpm)}%, range in hint — nudge if you expect margin change)`,
        `Depreciation scales with revenue (~${r1(depPct)}% of sales)`,
        `Other income ₹${r1(oi)} Cr & interest ₹${r1(intr)} Cr held flat (non-operating)`,
        `Tax held at latest ${r1(taxPct)}% (hist avg ${r1(avgTax)}%)`,
        `Owner share ${r1(owner)}%${owner < 97 ? ' (minority interest — reconciles EPS to reported)' : ''}`,
        `P/E band from ${peSrc}`,
      ]);
      const reportedEps = (Number.isFinite(np) && sh > 0) ? np / sh : NaN;
      setMsg(`Loaded ${st('B1') || 'company'} · base ${fy || '—'} · price ${rsFmt(px)} · ${g(sh).toFixed(2)} Cr shares · Sales ${crFmt(sales)} · reported EPS ${epsFmt(reportedEps)}. Forward assumptions auto-set from history — just type your revenue target →`);
    } catch (e: any) { setErr(e?.message || 'Could not read that file.'); }
  };

  const wf = (s: number, opm: number, oi: number, dep: number, intr: number, tax: number, owner: number, sh: number) => {
    const op = s * opm / 100;
    const pbt = op + oi - dep - intr;
    const pat = pbt * (1 - tax / 100) * (owner / 100);   // after tax AND minority interest → owners' profit
    const eps = sh > 0 ? pat / sh : 0;
    return { op, pbt, pat, eps };
  };
  const base = useMemo(() => wf(bSales, bOpm, bOI, bDep, bInt, bTax, bOwner, shares), [bSales, bOpm, bOI, bDep, bInt, bTax, bOwner, shares]);
  const fwd = useMemo(() => wf(fSales, fOpm, fOI, fDep, fInt, fTax, fOwner, fShares || shares), [fSales, fOpm, fOI, fDep, fInt, fTax, fOwner, fShares, shares]);
  const curPE = base.eps > 0 && price > 0 ? price / base.eps : 0;
  const tgtLow = fwd.eps * peLow, tgtHigh = fwd.eps * peHigh, tgtMid = fwd.eps * (peLow + peHigh) / 2;
  const upMid = price > 0 ? (tgtMid / price - 1) * 100 : 0;
  const yrs = Math.max(0.25, years || 1);
  const cagr = (t: number) => (price > 0 && t > 0 ? (Math.pow(t / price, 1 / yrs) - 1) * 100 : 0);
  const peerAvg = useMemo(() => { const xs = peers.split(/[^0-9.]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }, [peers]);
  const salesGrowth = bSales > 0 ? (fSales / bSales - 1) * 100 : 0;
  const upCol = upMid >= 25 ? 'var(--mc-bullish)' : upMid >= 0 ? 'var(--mc-cyan)' : 'var(--mc-bearish)';
  // typing the forward revenue auto-rescales depreciation (held at a constant % of
  // sales); other income & interest stay flat. This is why revenue is the only input
  // you must give — everything operating follows, and margin/tax are your knobs.
  const setFwdRevenue = (v: number) => { const depPct = bSales > 0 ? bDep / bSales : 0; setFSales(v); setFDep(r1(depPct * v)); };
  const impliedFwdPE = fwd.eps > 0 && price > 0 ? price / fwd.eps : 0;
  const latest = hist.length ? hist[hist.length - 1] : null;
  const cagrTo = (nBack: number) => {
    if (!latest || hist.length < 2) return 0;
    const target = latest.yr - nBack;
    let best = hist[0]; for (const h of hist) if (Math.abs(h.yr - target) < Math.abs(best.yr - target)) best = h;
    const dy = latest.yr - best.yr; return (dy > 0 && best.sales > 0) ? (Math.pow(latest.sales / best.sales, 1 / dy) - 1) * 100 : 0;
  };
  const cagr3 = cagrTo(3), cagr5 = cagrTo(5);
  const cagrMax = (() => { if (hist.length < 2) return 0; const f = hist[0], l = hist[hist.length - 1]; const dy = l.yr - f.yr; return (dy > 0 && f.sales > 0) ? (Math.pow(l.sales / f.sales, 1 / dy) - 1) * 100 : 0; })();
  const opmStats = (() => { const xs = hist.slice(-6).map((h) => h.opm).filter((x) => x > 0); if (!xs.length) return null; return { avg: xs.reduce((s, b) => s + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) }; })();
  const applyCagr = (c: number) => setFwdRevenue(r1(bSales * Math.pow(1 + c / 100, yrs)));
  const chipBtn: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, color: 'var(--mc-cyan)', background: 'transparent', border: '1px solid var(--mc-cyan)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' };

  const Waterfall = ({ w, tint }: { w: { op: number; pbt: number; pat: number; eps: number }; tint: string }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 11.5, color: DIM }}>
      <span>Op Profit <b style={{ color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{crFmt(w.op)}</b></span>
      <span>PBT <b style={{ color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{crFmt(w.pbt)}</b></span>
      <span>PAT <b style={{ color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{crFmt(w.pat)}</b></span>
      <span>EPS <b style={{ color: tint, fontFamily: 'ui-monospace, monospace' }}>{epsFmt(w.eps)}</b></span>
    </div>
  );

  return (
    <div>
      <div style={{ fontSize: 12.5, color: DIM, lineHeight: 1.6, marginBottom: 14 }}>
        <strong style={{ color: 'var(--mc-cyan)' }}>Fair value from a full P&amp;L build-up.</strong> Upload a Screener.in Excel (its <em>Data Sheet</em> tab) to auto-fill the latest year, or type it in. Set your <strong style={{ color: TEXT }}>forward target</strong> — revenue, OPM, tax — and it walks the P&amp;L down to forward EPS, then applies a peer P/E band to give a target-price range, upside, and the CAGR that implies.
      </div>

      {/* upload */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.25)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
        <label style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--mc-cyan)', cursor: 'pointer', border: '1px solid var(--mc-cyan)', borderRadius: 6, padding: '8px 14px' }}>
          📥 Upload Screener.in Excel
          <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] || null)} />
        </label>
        <div style={{ fontSize: 11.5, color: msg ? 'var(--mc-bullish)' : err ? 'var(--mc-bearish)' : DIM, lineHeight: 1.5, flex: 1, minWidth: 220 }}>
          {err ? `⚠ ${err}` : msg ? `✓ ${msg}` : 'The standard Screener.in export (with the START / Data Sheet tabs). Parses company, price, shares and the latest year’s Sales / Other Income / Dep / Interest / PBT / Tax automatically.'}
        </div>
      </div>

      {company && (
        <div style={{ fontSize: 13, fontWeight: 900, color: TEXT, marginBottom: 10 }}>{company}{baseYear ? <span style={{ color: DIM, fontWeight: 700, fontSize: 11.5 }}> · base {baseYear}</span> : null}</div>
      )}

      {/* shares + price */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <PLCell label="Current price (₹)" value={price} onChange={setPrice} />
        <PLCell label="Shares (Cr)" value={shares} onChange={(v) => { setShares(v); if (!fShares) setFShares(v); }} />
        <PLCell label="Current P/E (auto)" value={r1(curPE)} readOnly suffix="×" accent="var(--mc-warn)" />
      </div>

      {/* two-column P&L */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 8 }}>
        {/* CURRENT */}
        <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: DIM, letterSpacing: 0.5, marginBottom: 10 }}>📅 CURRENT {baseYear ? `· ${baseYear}` : '(base year)'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <PLCell label="Revenue" value={bSales} onChange={setBSales} suffix="Cr" />
            <PLCell label="OPM" value={bOpm} onChange={setBOpm} suffix="%" />
            <PLCell label="Other income" value={bOI} onChange={setBOI} suffix="Cr" />
            <PLCell label="Depreciation" value={bDep} onChange={setBDep} suffix="Cr" />
            <PLCell label="Interest" value={bInt} onChange={setBInt} suffix="Cr" />
            <PLCell label="Tax rate" value={bTax} onChange={setBTax} suffix="%" />
            <PLCell label="Owner share" value={bOwner} onChange={setBOwner} suffix="%" />
          </div>
          <Waterfall w={base} tint="var(--mc-warn)" />
          {bOwner < 97 && <div style={{ fontSize: 10, color: 'var(--mc-warn)', marginTop: 6, lineHeight: 1.5 }}>⚠ Owner share {r1(bOwner)}% — minority interest / associates take a cut before profit reaches shareholders. EPS here matches the <b>reported</b> number, not a naive PBT−tax. Keep this on the forward year unless the structure changes.</div>}
        </div>
        {/* FORWARD */}
        <div style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.3)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: 'var(--mc-cyan)', letterSpacing: 0.5, marginBottom: 10 }}>🎯 FORWARD TARGET{salesGrowth ? ` · revenue ${salesGrowth > 0 ? '+' : ''}${Math.round(salesGrowth)}%` : ''}</div>
          <div style={{ fontSize: 10, color: DIM, marginBottom: 8 }}>Type only <b style={{ color: 'var(--mc-cyan)' }}>Revenue</b> — dep auto-scales, the rest is auto-set from history. Nudge OPM if you have a margin view.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <PLCell label="Revenue (target)" value={fSales} onChange={setFwdRevenue} suffix="Cr" accent="var(--mc-cyan)" />
            <PLCell label="OPM" value={fOpm} onChange={setFOpm} suffix="%" />
            <PLCell label="Other income" value={fOI} onChange={setFOI} suffix="Cr" />
            <PLCell label="Depreciation" value={fDep} onChange={setFDep} suffix="Cr" />
            <PLCell label="Interest" value={fInt} onChange={setFInt} suffix="Cr" />
            <PLCell label="Tax rate" value={fTax} onChange={setFTax} suffix="%" />
            <PLCell label="Owner share" value={fOwner} onChange={setFOwner} suffix="%" />
          </div>
          {hist.length >= 2 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 10, color: DIM }}>Grow at hist CAGR × {yrs}yr:</span>
              {cagr3 > 0 && <button style={chipBtn} onClick={() => applyCagr(cagr3)}>3Y {r1(cagr3)}%</button>}
              {cagr5 > 0 && <button style={chipBtn} onClick={() => applyCagr(cagr5)}>5Y {r1(cagr5)}%</button>}
              {cagrMax > 0 && <button style={chipBtn} onClick={() => applyCagr(cagrMax)}>full {r1(cagrMax)}%</button>}
            </div>
          )}
          {opmStats && (
            <div style={{ fontSize: 10, marginTop: 6, color: fOpm > opmStats.max + 0.5 ? 'var(--mc-warn)' : DIM }}>
              Hist OPM avg <b>{r1(opmStats.avg)}%</b> · range {r1(opmStats.min)}–{r1(opmStats.max)}%{fOpm > opmStats.max + 0.5 ? ' — your OPM is above the historical peak ⚠' : ''}
            </div>
          )}
          <Waterfall w={fwd} tint="var(--mc-cyan)" />
        </div>
      </div>

      {auto.length > 0 && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '11px 14px', marginBottom: 8, marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', marginBottom: 6 }}>⚙ Assumptions auto-applied to the forward year <span style={{ color: DIM, fontWeight: 600 }}>(all editable above)</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
            {auto.map((a, i) => <span key={i} style={{ fontSize: 10.5, color: DIM }}>• {a}</span>)}
          </div>
        </div>
      )}

      {/* exit multiple */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px', marginBottom: 16, marginTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: DIM, letterSpacing: 0.5, marginBottom: 10 }}>🏷️ EXIT MULTIPLE (P/E) &amp; HORIZON</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <PLCell label="P/E low" value={peLow} onChange={setPeLow} suffix="×" />
          <PLCell label="P/E high" value={peHigh} onChange={setPeHigh} suffix="×" />
          <PLCell label="Years to target" value={years} onChange={setYears} suffix="yr" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 210 }}>
            <span style={{ fontSize: 10.5, color: DIM, fontWeight: 700 }}>Sector → peer P/E band</span>
            <select value={sector} onChange={(e) => {
              const k = e.target.value; setSector(k);
              const hint = (SECTOR_CALCULATOR_MAP as any)[k]?.multipleHint || '';
              const m = hint.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
              if (m) { setPeLow(Number(m[1])); setPeHigh(Number(m[2])); }
            }} style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 9px', borderRadius: 4, fontSize: 12.5, fontWeight: 600 }}>
              <option value="">— pick sector for peer band —</option>
              {Object.keys(SECTOR_CALCULATOR_MAP).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {sector && (SECTOR_CALCULATOR_MAP as any)[sector]?.calc !== 'PE' && (
              <span style={{ fontSize: 9.5, color: 'var(--mc-warn)' }}>this sector is usually valued on {(SECTOR_CALCULATOR_MAP as any)[sector].calc.replace('_', '/')} — the P/E band is a rough proxy</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 10.5, color: DIM, fontWeight: 700 }}>Peer P/Es (comma-sep) → avg helper</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={peers} onChange={(e) => setPeers(e.target.value)} placeholder="e.g. 42, 55, 48"
                style={{ background: 'var(--mc-bg-0)', color: TEXT, border: `1px solid ${BORDER}`, padding: '7px 9px', borderRadius: 4, fontSize: 13, fontFamily: 'ui-monospace, monospace', flex: 1, minWidth: 90 }} />
              {peerAvg > 0 && (
                <button onClick={() => { setPeLow(r1(peerAvg * 0.85)); setPeHigh(r1(peerAvg * 1.15)); }} title="Set band to peer-avg ±15%"
                  style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-cyan)', background: 'transparent', border: '1px solid var(--mc-cyan)', borderRadius: 5, padding: '6px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>avg {r1(peerAvg)}× → band</button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RESULT */}
      <div style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(16,185,129,0.05))', border: `1px solid ${upCol}55`, borderLeft: `4px solid ${upCol}`, borderRadius: 8, padding: '16px 18px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: TEXT, fontFamily: 'ui-monospace, monospace' }}>{epsFmt(fwd.eps)}</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>FORWARD EPS</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: impliedFwdPE > peHigh ? 'var(--mc-bearish)' : impliedFwdPE < peLow ? 'var(--mc-bullish)' : 'var(--mc-warn)', fontFamily: 'ui-monospace, monospace' }}>{r1(impliedFwdPE)}×</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>MARKET-IMPLIED FWD P/E</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: upCol, fontFamily: 'ui-monospace, monospace' }}>{rsFmt(tgtLow)}–{rsFmt(tgtHigh)}</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>TARGET PRICE ({peLow}–{peHigh}× P/E)</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: upCol, fontFamily: 'ui-monospace, monospace' }}>{upMid > 0 ? '+' : ''}{Math.round(upMid)}%</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>UPSIDE AT MIDPOINT</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: upCol, fontFamily: 'ui-monospace, monospace' }}>{cagr(tgtLow) > 0 ? '+' : ''}{Math.round(cagr(tgtLow))}–{Math.round(cagr(tgtHigh))}%</div>
            <div style={{ fontSize: 9.5, color: DIM, fontWeight: 700, letterSpacing: 0.4, marginTop: 2 }}>IMPLIED CAGR / {yrs}yr</div>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: DIM, lineHeight: 1.6, marginTop: 12 }}>
          Forward Op Profit <b style={{ color: TEXT }}>{crFmt(fwd.op)}</b> → PBT <b style={{ color: TEXT }}>{crFmt(fwd.pbt)}</b> → PAT <b style={{ color: TEXT }}>{crFmt(fwd.pat)}</b> → EPS <b style={{ color: 'var(--mc-cyan)' }}>{epsFmt(fwd.eps)}</b>. At <b style={{ color: TEXT }}>{peLow}–{peHigh}×</b> that is <b style={{ color: upCol }}>{rsFmt(tgtLow)}–{rsFmt(tgtHigh)}</b> vs today’s <b style={{ color: TEXT }}>{rsFmt(price)}</b> (current P/E <b style={{ color: 'var(--mc-warn)' }}>{r1(curPE)}×</b>). {upMid >= 25 ? 'Base-case upside clears the 25% buy bar.' : upMid < 0 ? 'Priced above fair value at these assumptions — wait or raise the growth/margin case.' : 'Modest upside — check whether the forward P/E is really sustainable.'} Educational, not investment advice.
        </div>
      </div>
    </div>
  );
}
