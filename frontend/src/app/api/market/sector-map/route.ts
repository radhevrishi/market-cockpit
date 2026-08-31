// ─────────────────────────────────────────────────────────────────────────────
// /api/market/sector-map  (zzz513)
//
// The NSE quotes feed returns sector="Other" (and an empty industry) for a large
// chunk of small/micro-caps, which made the Risk Desk's "sector exposure" and
// Position Sizing's guardrails collapse into one giant "Other"/"Unknown" bucket.
//
// The Screener.in CSVs bundled under public/data/screener/*.csv DO carry a clean,
// human-readable "Industry Group" per NSE code (Pharmaceuticals & Biotechnology,
// Auto Components, Chemicals & Petrochemicals, Ferrous Metals, …). This route
// reads them once, builds a { NSE_CODE: "Industry Group" } map, caches it, and
// serves it so any page can resolve a real sector without guessing.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Parse ONE CSV line respecting double-quoted fields (company names contain commas).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const norm = (s: string) => (s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();

// zzz513b — curated fallback for well-known NSE names that aren't in any of the
// bundled Screener screens (so they'd otherwise read "Unclassified"). Labels use
// the exact Screener "Industry Group" taxonomy so they merge with the CSV map.
// The CSV map always WINS over this; curated only fills genuine gaps.
const CURATED: Record<string, string> = {
  JAMNAAUTO: 'Auto Components', SCHAEFFLER: 'Auto Components', NRBBEARING: 'Auto Components',
  MENONBE: 'Auto Components', LUMAXTECH: 'Auto Components', LUMAXIND: 'Auto Components',
  ALKYLAMINE: 'Chemicals & Petrochemicals', HSCL: 'Chemicals & Petrochemicals',
  TANFACIND: 'Chemicals & Petrochemicals', JUBLINGREA: 'Chemicals & Petrochemicals',
  ULTRAMAR: 'Chemicals & Petrochemicals', NOCIL: 'Chemicals & Petrochemicals',
  VIYASH: 'Pharmaceuticals & Biotechnology', NGLFINE: 'Pharmaceuticals & Biotechnology',
  BETA: 'Pharmaceuticals & Biotechnology', GUFICBIO: 'Pharmaceuticals & Biotechnology',
  WENDT: 'Industrial Products', TIMETECHNO: 'Industrial Products', GOODLUCK: 'Industrial Products',
  JNKINDIA: 'Industrial Products', CARBORUNIV: 'Industrial Products', GRPLTD: 'Industrial Products',
  EXICOM: 'Electrical Equipment', SBCL: 'Electrical Equipment', MARINE: 'Electrical Equipment',
  ASTRAMICRO: 'Aerospace & Defense', PARAS: 'Aerospace & Defense', AVANTEL: 'Aerospace & Defense',
  TATATECH: 'IT - Services', PICCADIL: 'Beverages', IFBAGRO: 'Beverages',
  DREDGECORP: 'Engineering Services', DEEPINDS: 'Oil', JINDRILL: 'Oil',
  IRMENERGY: 'Gas', GAIL: 'Gas',
};

let _cache: { map: Record<string, string>; count: number; at: number } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6h — CSVs refresh via GitHub Actions a few times a day

async function buildMap(): Promise<{ map: Record<string, string>; count: number }> {
  const dir = path.join(process.cwd(), 'public', 'data', 'screener');
  const map: Record<string, string> = {};
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.csv')); } catch { return { map, count: 0 }; }

  for (const file of files) {
    let text = '';
    try { text = await fs.readFile(path.join(dir, file), 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) continue;
    const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const iNse = header.findIndex((h) => h === 'nse code');
    // Prefer the broad "Industry Group"; fall back to the granular "Industry".
    const iGroup = header.findIndex((h) => h === 'industry group');
    const iIndustry = header.findIndex((h) => h === 'industry');
    if (iNse < 0 || (iGroup < 0 && iIndustry < 0)) continue;
    for (let r = 1; r < lines.length; r++) {
      if (!lines[r]) continue;
      const cells = parseCsvLine(lines[r]);
      const ticker = norm(cells[iNse] || '');
      if (!ticker) continue;
      const sec = ((iGroup >= 0 ? cells[iGroup] : '') || (iIndustry >= 0 ? cells[iIndustry] : '') || '').trim();
      if (sec && !map[ticker]) map[ticker] = sec;
    }
  }
  // Fill remaining gaps from the curated list (CSV always wins).
  for (const [t, s] of Object.entries(CURATED)) { if (!map[t]) map[t] = s; }
  return { map, count: Object.keys(map).length };
}

export async function GET() {
  const now = Date.now();
  if (!_cache || now - _cache.at > TTL_MS) {
    const { map, count } = await buildMap();
    _cache = { map, count, at: now };
  }
  return NextResponse.json(
    { count: _cache.count, sectors: _cache.map, generated_at: new Date(_cache.at).toISOString() },
    { headers: { 'Cache-Control': 'public, max-age=1800' } },
  );
}
