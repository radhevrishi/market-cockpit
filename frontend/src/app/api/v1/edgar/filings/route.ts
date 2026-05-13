// PATCH 0318 — SEC EDGAR M&A filing adapter.
//
// GET /api/v1/edgar/filings?cik=<10-digit-CIK>&form=<form-type>
//
// Polls the public SEC EDGAR submissions JSON for the requested CIK and
// returns the most-recent filings of the requested form type. Designed
// for the Special Situations / merger-arb pipeline — the relevant forms
// for US M&A are SC TO-T (third-party tender offer), SC TO-I (issuer
// tender offer), Schedule TO-C (preliminary communication), and 10-12B
// (registration of securities for a spin-off).
//
// Counterpart to /api/v1/earnings/nse-announcements (Patch 0309) for the
// US side. SEC's submissions API is public + rate-friendly, no auth
// required, but requires a User-Agent identifying the caller.
//
// Cached in KV 24h per (cik, form).
//
// Form types we care about (default if no form= passed: all M&A forms):
//   SC TO-T, SC TO-I, SC TO-C  — tender offers
//   SC 13E3                    — going private
//   DEFM14A                    — definitive merger proxy
//   8-K                        — material event (filter by item 1.01 / 2.01)
//   425                        — prospectus + 14a communication
//   10-12B, 10-12B/A           — spin-off registration

import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

const KEY = (cik: string, form: string) => `edgar:v1:${cik}:${form || 'ALL'}`;
const TTL_SECONDS = 24 * 60 * 60;

const M_AND_A_FORMS = new Set([
  'SC TO-T', 'SC TO-I', 'SC TO-C',
  'SC 13E3', 'SC 13E3/A',
  'DEFM14A', 'PREM14A',
  '425',
  '10-12B', '10-12B/A',
]);

interface EdgarFiling {
  accession: string;
  form: string;
  filed_at: string;          // YYYY-MM-DD
  primary_doc?: string;
  primary_doc_url?: string;
  description?: string;
}

interface EdgarResponse {
  cik: string;
  company_name?: string;
  filings: EdgarFiling[];
  source: 'EDGAR_DIRECT' | 'EDGAR_BLOCKED' | 'EDGAR_EMPTY' | 'KV_CACHED' | 'INVALID_CIK';
  cached_at?: number;
}

function pad10(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.padStart(10, '0').slice(-10);
}

async function fetchFromEdgar(cik: string, formFilter: string | null, signal?: AbortSignal): Promise<EdgarResponse> {
  const padded = pad10(cik);
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        // SEC explicitly requires this for rate-friendly access.
        'User-Agent': 'Market Cockpit institutional-research feedback@market-cockpit.app',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
    });
    if (res.status === 403 || res.status === 429) {
      return { cik: padded, filings: [], source: 'EDGAR_BLOCKED' };
    }
    if (res.status === 404) {
      return { cik: padded, filings: [], source: 'INVALID_CIK' };
    }
    if (!res.ok) {
      return { cik: padded, filings: [], source: 'EDGAR_BLOCKED' };
    }
    const data = await res.json();
    const company_name = data?.name || data?.entityName;
    const recent = data?.filings?.recent;
    if (!recent || !Array.isArray(recent.form)) {
      return { cik: padded, company_name, filings: [], source: 'EDGAR_EMPTY' };
    }

    // The recent block is column-oriented; zip into rows.
    const filings: EdgarFiling[] = [];
    const forms: string[] = recent.form;
    const accessions: string[] = recent.accessionNumber;
    const filedAts: string[] = recent.filingDate;
    const primaryDocs: string[] = recent.primaryDocument || [];
    const descriptions: string[] = recent.primaryDocDescription || [];

    for (let i = 0; i < forms.length; i++) {
      const form = forms[i];
      // Apply filter: explicit form= takes priority; else default to M&A forms
      if (formFilter && form !== formFilter) continue;
      if (!formFilter && !M_AND_A_FORMS.has(form)) continue;

      const accession = accessions[i];
      const accessionNoHyphens = accession.replace(/-/g, '');
      const primary = primaryDocs[i] || '';
      const docUrl = primary
        ? `https://www.sec.gov/Archives/edgar/data/${parseInt(padded, 10)}/${accessionNoHyphens}/${primary}`
        : undefined;

      filings.push({
        accession,
        form,
        filed_at: filedAts[i],
        primary_doc: primary,
        primary_doc_url: docUrl,
        description: descriptions[i],
      });
    }

    // Sort newest first.
    filings.sort((a, b) => (a.filed_at < b.filed_at ? 1 : -1));

    return { cik: padded, company_name, filings: filings.slice(0, 50), source: 'EDGAR_DIRECT' };
  } catch {
    return { cik: pad10(cik), filings: [], source: 'EDGAR_BLOCKED' };
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cikRaw = (req.nextUrl.searchParams.get('cik') || '').trim();
  if (!cikRaw || !/^\d{1,10}$/.test(cikRaw.replace(/\D/g, ''))) {
    return NextResponse.json({ error: 'invalid cik — pass numeric CIK, 1-10 digits' }, { status: 400 });
  }
  const cik = pad10(cikRaw);
  const formFilter = req.nextUrl.searchParams.get('form');
  const force = req.nextUrl.searchParams.get('force') === '1';

  if (isRedisAvailable() && !force) {
    const cached = await kvGet<EdgarResponse>(KEY(cik, formFilter || 'ALL'));
    if (cached) return NextResponse.json({ ...cached, source: 'KV_CACHED' });
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  const resolved = await fetchFromEdgar(cik, formFilter, controller.signal);
  clearTimeout(tid);

  if (resolved.source === 'EDGAR_DIRECT' && isRedisAvailable()) {
    await kvSet(KEY(cik, formFilter || 'ALL'), { ...resolved, cached_at: Date.now() }, TTL_SECONDS);
  }
  return NextResponse.json(resolved);
}
