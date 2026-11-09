'use client';
// zzz1232 — Return Simulator: the owner's "EPS growth × P/E change" simulator plus the calculators that answer the
// multibagger questions (what growth do I need, what can I pay, how long to 5x, what does guidance imply, fair P/E for
// growth, dilution). All maths in lib/return-sim.ts (tested). Numbers stay in the browser; nothing is saved.
import { useMemo, useState } from 'react';
import { simulate, requiredGrowth, buyBelow, yearsToMultiple, cagrFor, guidanceToPrice, pegFair, sensitivity, epsAfterDilution } from '@/lib/return-sim';

const C = { panel: 'var(--mc-bg-1)', line: 'var(--mc-border-2)', txt: 'var(--mc-text-1)', mute: 'var(--mc-text-3)', dim: 'var(--mc-text-4)', green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', blue: '#3B82F6', amber: '#D97706' };
const pc = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const x = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}×`);
const inr = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `₹${Math.round(v).toLocaleString('en-IN')}`);
const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: d }));
const tone = (v: number | null | undefined) => (v == null ? C.mute : v >= 0 ? C.green : C.red);

function Box({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 14.5, fontWeight: 800, color: C.txt }}>{title}</div>
      <div style={{ fontSize: 12, color: C.mute, margin: '2px 0 12px' }}>{sub}</div>
      {children}
    </div>
  );
}
function In({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: C.dim, fontWeight: 700 }}>
      {label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="number" value={Number.isFinite(value) ? value : ''} step={step} onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ width: '100%', padding: '7px 9px', borderRadius: 7, border: `1px solid ${C.line}`, background: 'var(--mc-bg-0)', color: C.txt, fontSize: 14, fontWeight: 700 }} />
        {suffix && <span style={{ fontSize: 12, color: C.mute }}>{suffix}</span>}
      </span>
    </label>
  );
}
function Out({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div style={{ padding: '8px 10px', border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: C.dim, fontWeight: 800, letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 800, color: color || C.txt }}>{value}</div>
    </div>
  );
}
const grid = (n: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${n}px, 1fr))`, gap: 10 });

export default function ReturnSimulatorPage() {
  // 1. simulator
  const [g, setG] = useState(25), [pe0, setPe0] = useState(30), [pe1, setPe1] = useState(25), [yrs, setYrs] = useState(5), [inv, setInv] = useState(100000);
  const sim = useMemo(() => simulate(g / 100, pe0, pe1, yrs, inv), [g, pe0, pe1, yrs, inv]);
  const growths = [10, 15, 20, 25, 30, 40, 50];
  const exits = useMemo(() => Array.from(new Set([Math.round(pe0 * 0.5), Math.round(pe0 * 0.75), pe0, Math.round(pe0 * 1.25), Math.round(pe0 * 1.5)])).filter((v) => v > 0), [pe0]);
  const grid1 = useMemo(() => sensitivity(growths.map((v) => v / 100), exits, pe0, yrs), [exits, pe0, yrs]);   // eslint-disable-line react-hooks/exhaustive-deps
  // 2. required growth
  const [tr, setTr] = useState(25), [rp0, setRp0] = useState(40), [rp1, setRp1] = useState(25), [ry, setRy] = useState(5);
  const need = useMemo(() => requiredGrowth(tr / 100, rp0, rp1, ry), [tr, rp0, rp1, ry]);
  // 3. buy below
  const [eps, setEps] = useState(20), [bg, setBg] = useState(25), [by, setBy] = useState(5), [bpe, setBpe] = useState(25), [br, setBr] = useState(20), [bp, setBp] = useState(500);
  const bb = useMemo(() => buyBelow(eps, bg / 100, by, bpe, br / 100, bp), [eps, bg, by, bpe, br, bp]);
  // 4. multibagger timeline
  const [mm, setMm] = useState(5), [mr, setMr] = useState(30), [myr, setMyr] = useState(5);
  // 5. guidance to price
  const [rev, setRev] = useState(1000), [nm, setNm] = useState(12), [sh, setSh] = useState(5), [gpe, setGpe] = useState(30), [gpx, setGpx] = useState(1500), [gy, setGy] = useState(2);
  const gtp = useMemo(() => guidanceToPrice(rev, nm / 100, sh, gpe, gpx, gy), [rev, nm, sh, gpe, gpx, gy]);
  // 6. PEG + dilution
  const [pg, setPg] = useState(30), [peg, setPeg] = useState(1), [cpe, setCpe] = useState(45);
  const pf = useMemo(() => pegFair(pg, peg, cpe), [pg, peg, cpe]);
  const [dpg, setDpg] = useState(30), [dsh, setDsh] = useState(5);

  return (
    <div style={{ padding: '18px 20px', maxWidth: 1300, margin: '0 auto' }} data-testid="return-simulator">
      <h1 style={{ fontSize: 22, fontWeight: 900, color: C.txt, margin: 0 }}>🧮 Return Simulator</h1>
      <p style={{ fontSize: 13, color: C.mute, margin: '4px 0 16px' }}>A share's return is EPS growth and P/E change multiplied: (1 + return) = (1 + EPS growth) × (1 + yearly P/E change). Change any box — every answer updates.</p>

      <div style={{ display: 'grid', gap: 16 }}>
        <Box title="1 · Investment return simulator" sub="Try different valuations: how EPS growth and the change in P/E turn into your return.">
          <div style={grid(130)}>
            <In label="EPS GROWTH / YEAR" value={g} onChange={setG} suffix="%" />
            <In label="P/E TODAY" value={pe0} onChange={setPe0} />
            <In label="P/E AT EXIT" value={pe1} onChange={setPe1} />
            <In label="YEARS" value={yrs} onChange={setYrs} />
            <In label="AMOUNT INVESTED" value={inv} onChange={setInv} step={10000} suffix="₹" />
          </div>
          <div style={{ ...grid(150), marginTop: 12 }}>
            <Out label="P/E CHANGE PER YEAR" value={pc(sim?.peDrift)} color={tone(sim?.peDrift)} />
            <Out label="RETURN PER YEAR" value={pc(sim?.annualReturn)} color={tone(sim?.annualReturn)} big />
            <Out label="TOTAL MULTIPLE" value={x(sim?.multiple)} big />
            <Out label={`${inr(inv)} BECOMES`} value={inr(sim?.endValue)} color={C.green} big />
            <Out label="FROM EPS / FROM P/E" value={`${x(sim?.epsMultiple)} · ${x(sim?.peMultiple)}`} />
          </div>
          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <div style={{ fontSize: 11.5, color: C.dim, fontWeight: 800, marginBottom: 4 }}>RETURN PER YEAR FOR OTHER GROWTH × EXIT P/E ({yrs} years, P/E today {pe0})</div>
            <table style={{ borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead><tr><th style={{ padding: '4px 10px', color: C.dim, textAlign: 'left' }}>EPS growth ↓ / exit P/E →</th>{exits.map((e) => <th key={e} style={{ padding: '4px 10px', color: e === pe1 ? C.blue : C.dim }}>{e}</th>)}</tr></thead>
              <tbody>{growths.map((gr, i) => (
                <tr key={gr}><td style={{ padding: '4px 10px', fontWeight: 800, color: gr === g ? C.blue : C.txt }}>{gr}%</td>
                  {grid1[i].map((v, j) => <td key={j} style={{ padding: '4px 10px', textAlign: 'right', color: tone(v), fontWeight: v != null && v >= 0.25 ? 800 : 500, background: v != null && v >= 0.3 ? 'rgba(16,185,129,0.10)' : undefined }}>{pc(v, 0)}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </Box>

        <div style={grid(380)}>
          <Box title="2 · EPS growth you need" sub="For a target yearly return, given where the P/E starts and where you think it ends.">
            <div style={grid(110)}><In label="TARGET RETURN" value={tr} onChange={setTr} suffix="%" /><In label="P/E TODAY" value={rp0} onChange={setRp0} /><In label="P/E AT EXIT" value={rp1} onChange={setRp1} /><In label="YEARS" value={ry} onChange={setRy} /></div>
            <div style={{ ...grid(150), marginTop: 10 }}><Out label="EPS GROWTH NEEDED / YEAR" value={pc(need)} color={need != null && need > 0.35 ? C.red : C.txt} big /><Out label="P/E CHANGE / YEAR" value={pc(simulate(0, rp0, rp1, ry)?.peDrift)} /></div>
            {need != null && <div style={{ fontSize: 12, color: C.mute, marginTop: 8 }}>{need > 0.35 ? 'Above 35% a year for long is rare — the price already asks for a lot.' : need < 0.15 ? 'A modest growth bar — the return depends less on heroics.' : 'A demanding but achievable bar for a real compounder.'}</div>}
          </Box>
          <Box title="3 · Most you can pay (buy-below price)" sub="EPS × growth for N years × exit P/E, brought back at your target return.">
            <div style={grid(100)}><In label="EPS NOW" value={eps} onChange={setEps} suffix="₹" /><In label="GROWTH" value={bg} onChange={setBg} suffix="%" /><In label="YEARS" value={by} onChange={setBy} /><In label="EXIT P/E" value={bpe} onChange={setBpe} /><In label="TARGET RETURN" value={br} onChange={setBr} suffix="%" /><In label="PRICE NOW" value={bp} onChange={setBp} suffix="₹" /></div>
            <div style={{ ...grid(130), marginTop: 10 }}>
              <Out label="BUY BELOW" value={inr(bb?.maxPrice)} color={C.blue} big />
              <Out label="MARGIN OF SAFETY" value={pc(bb?.marginOfSafety)} color={tone(bb?.marginOfSafety)} />
              <Out label="RETURN FROM TODAY'S PRICE" value={pc(bb?.impliedReturn)} color={tone(bb?.impliedReturn)} />
              <Out label="PRICE IN YEAR N" value={inr(bb?.futurePrice)} />
            </div>
          </Box>
          <Box title="4 · Multibagger timeline" sub="How long a multiple takes at a yearly return — or the return a multiple needs.">
            <div style={grid(110)}><In label="MULTIPLE" value={mm} onChange={setMm} suffix="×" /><In label="RETURN / YEAR" value={mr} onChange={setMr} suffix="%" /><In label="IN YEARS" value={myr} onChange={setMyr} /></div>
            <div style={{ ...grid(150), marginTop: 10 }}>
              <Out label={`YEARS TO ${mm}× AT ${mr}%`} value={num(yearsToMultiple(mm, mr / 100), 1)} big />
              <Out label={`RETURN FOR ${mm}× IN ${myr} YEARS`} value={pc(cagrFor(mm, myr))} big />
            </div>
            <div style={{ fontSize: 12, color: C.mute, marginTop: 8 }}>Rule of 72: years to double ≈ 72 ÷ yearly return %.</div>
          </Box>
          <Box title="5 · Guidance → price" sub="A revenue target × net margin ÷ shares × P/E. Revenue in ₹ crore, shares in crore.">
            <div style={grid(100)}><In label="REVENUE TARGET" value={rev} onChange={setRev} suffix="Cr" /><In label="NET MARGIN" value={nm} onChange={setNm} suffix="%" /><In label="SHARES" value={sh} onChange={setSh} suffix="Cr" /><In label="P/E" value={gpe} onChange={setGpe} /><In label="PRICE NOW" value={gpx} onChange={setGpx} suffix="₹" /><In label="YEARS AWAY" value={gy} onChange={setGy} /></div>
            <div style={{ ...grid(130), marginTop: 10 }}>
              <Out label="PROFIT" value={`₹${num(gtp?.pat, 0)} Cr`} />
              <Out label="EPS" value={`₹${num(gtp?.eps, 1)}`} />
              <Out label="TARGET PRICE" value={inr(gtp?.targetPrice)} color={C.blue} big />
              <Out label="UPSIDE · PER YEAR" value={`${pc(gtp?.upside, 0)} · ${pc(gtp?.annual, 0)}`} color={tone(gtp?.upside)} />
            </div>
          </Box>
          <Box title="6 · Fair P/E for growth (PEG) and dilution" sub="P/E a growth rate earns at your PEG; and what new shares do to EPS growth.">
            <div style={grid(100)}><In label="GROWTH" value={pg} onChange={setPg} suffix="%" /><In label="PEG" value={peg} onChange={setPeg} step={0.1} /><In label="P/E NOW" value={cpe} onChange={setCpe} /></div>
            <div style={{ ...grid(150), marginTop: 10 }}><Out label="FAIR P/E" value={num(pf?.fairPe, 1)} color={C.blue} big /><Out label="P/E NOW vs FAIR" value={pc(pf?.gap, 0)} color={pf?.gap != null && pf.gap > 0 ? C.red : C.green} /></div>
            <div style={{ ...grid(100), marginTop: 12 }}><In label="PROFIT GROWTH" value={dpg} onChange={setDpg} suffix="%" /><In label="SHARE COUNT GROWTH" value={dsh} onChange={setDsh} suffix="%" /></div>
            <div style={{ ...grid(150), marginTop: 10 }}><Out label="EPS GROWTH AFTER DILUTION" value={pc(epsAfterDilution(dpg / 100, dsh / 100))} /></div>
          </Box>
        </div>
      </div>
    </div>
  );
}
