// zzz1089 — debt ÷ equity and the year's cash from operations / profit for an India company, read straight from its screener.in
// page when the stock-screener snapshot and the earnings feed have no figure (E2E, MAPROIN, MPIMANIPAL showed "—"). Pure: takes
// the boiled-down page (InRaw). D/E = Borrowings ÷ (Equity Capital + Reserves) at the latest balance-sheet date on the page.
import type { InRaw } from './screener/in-assemble';

type Table = { headers: string[]; rows: Record<string, (number | null)[]> };
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r2 = (v: number) => Math.round(v * 100) / 100;
function row(t: Table | null | undefined, ...labels: string[]): (number | null)[] | null {
  if (!t) return null;
  for (const l of labels) { const k = Object.keys(t.rows).find((x) => x.replace(/\s+/g, ' ').trim().toLowerCase() === l.toLowerCase()); if (k) return t.rows[k]; }
  return null;
}
const isPeriod = (h: string) => /^[A-Z][a-z]{2} \d{4}$/.test(String(h || '').trim());

export interface FinFallback {
  de: number | null;
  /** 'balance sheet Mar 2026' */
  deBasis: string | null;
  cfo: number | null; pat: number | null;
  /** 'Mar 2026' — the fiscal year of cfo / pat */
  fy: string | null;
}

export function finFallbackFromRaw(raw: Pick<InRaw, 'T'> | null | undefined): FinFallback {
  const out: FinFallback = { de: null, deBasis: null, cfo: null, pat: null, fy: null };
  if (!raw?.T) return out;
  const BS = raw.T.bs as Table | null, CF = raw.T.cf as Table | null, A = raw.T.a as Table | null;
  if (BS) {
    const eqc = row(BS, 'Equity Capital'), res = row(BS, 'Reserves'), bor = row(BS, 'Borrowings', 'Borrowing');
    for (let i = BS.headers.length - 1; i >= 0; i--) {
      if (!isPeriod(BS.headers[i]) || !eqc || !fin(eqc[i])) continue;
      const eq = (eqc[i] as number) + (fin(res?.[i]) ? (res![i] as number) : 0);
      const debt = fin(bor?.[i]) ? (bor![i] as number) : 0;
      out.de = eq > 0 ? r2(debt / eq) : 99;
      out.deBasis = `balance sheet ${BS.headers[i].trim()}`;
      break;
    }
  }
  if (CF && A) {
    const cfo = row(CF, 'Cash from Operating Activity'), np = row(A, 'Net Profit');
    for (let i = CF.headers.length - 1; i >= 0; i--) {
      const h = CF.headers[i];
      if (!isPeriod(h) || !cfo || !fin(cfo[i])) continue;
      const j = A.headers.findIndex((x) => x.trim() === h.trim());
      if (j < 0 || !np || !fin(np[j])) continue;
      out.cfo = cfo[i] as number; out.pat = np[j] as number; out.fy = h.trim();
      break;
    }
  }
  return out;
}

/** The ratio from the fallback figures (same rule as the feed: no ratio for a loss or a profit near zero). */
export function fallbackRatio(f: Pick<FinFallback, 'cfo' | 'pat'>): number | null {
  if (!fin(f.cfo) || !fin(f.pat) || f.pat <= 0) return null;
  const r = f.cfo / f.pat;
  return Math.abs(r) > 50 ? null : Math.round(r * 100) / 100;
}
