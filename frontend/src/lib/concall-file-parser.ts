// ═══════════════════════════════════════════════════════════════════════════
// CLIENT-SIDE CONCALL FILE PARSER (PATCH 0684)
//
// Replaces the previous server-roundtrip via /api/concall/parse, which was
// hitting Vercel's 4.5 MB multipart body limit (HTTP 413) the moment a user
// dragged in a typical 3-file bundle (xlsx + 2 concall PDFs ≈ 4.3 MB).
//
// Same pipeline the Auto-Val panel already uses:
//   PDF        → pdf.js (CDN-loaded, shared with auto-valuation/engine.ts)
//   XLSX / XLS → xlsx (browser build via package.json `browser` field)
//   DOCX       → mammoth (browser build)
//   PPTX       → JSZip (slide XML <a:t> nodes)
//   TXT/MD/CSV → File.text()
//
// All parsing happens in the user's browser — nothing uploaded — so the size
// cap is whatever the tab can hold in memory, not Vercel's body limit.
// ═══════════════════════════════════════════════════════════════════════════

import { extractPdfText } from '@/app/(dashboard)/auto-valuation/engine';

export interface ParsedFile {
  name: string;
  kind: string;
  chars: number;
  text: string;
  error?: string;
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

async function parseXlsx(file: File): Promise<string> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const trimmed = csv.trim();
    if (trimmed.length === 0) continue;
    parts.push(`--- sheet: ${sheetName} ---\n${trimmed}`);
  }
  return parts.join('\n\n');
}

async function parseDocx(file: File): Promise<string> {
  // Mammoth's package.json `browser` field maps to mammoth.browser.js for
  // bundlers — webpack/Next picks it up automatically in client code.
  const mammoth: any = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const out = await mammoth.extractRawText({ arrayBuffer });
  return out.value || '';
}

async function parsePptx(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const slideEntries: string[] = [];
  zip.forEach((relPath) => {
    if (/^ppt\/slides\/slide\d+\.xml$/i.test(relPath)) slideEntries.push(relPath);
  });
  slideEntries.sort((a, b) => {
    const n = (s: string) => parseInt(s.match(/slide(\d+)/i)?.[1] || '0', 10);
    return n(a) - n(b);
  });
  const out: string[] = [];
  for (const e of slideEntries) {
    const xml = await zip.file(e)!.async('string');
    const fragments = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
    const slideText = fragments
      .map((f) => f.replace(/<[^>]+>/g, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (slideText) out.push(slideText);
  }
  return out.join('\n\n');
}

export async function parseFileToText(file: File): Promise<ParsedFile> {
  const ext = extOf(file.name);
  try {
    let text = '';
    let kind = ext || 'txt';
    if (ext === 'pdf') {
      text = await extractPdfText(file);
      kind = 'pdf';
    } else if (ext === 'xlsx' || ext === 'xls') {
      text = await parseXlsx(file);
      kind = ext;
    } else if (ext === 'docx') {
      text = await parseDocx(file);
      kind = 'docx';
    } else if (ext === 'pptx') {
      text = await parsePptx(file);
      kind = 'pptx';
    } else if (ext === 'txt' || ext === 'md' || ext === 'csv' || ext === '') {
      text = await file.text();
      kind = ext || 'txt';
    } else {
      return {
        name: file.name,
        kind: ext || 'unknown',
        chars: 0,
        text: '',
        error: `Unsupported file type: .${ext}. Use TXT / MD / CSV / PDF / DOCX / PPTX / XLSX / XLS.`,
      };
    }
    // Strip non-breaking spaces that PDFs love to emit; same logic the server
    // route used so downstream extractors see identical input.
    const cleaned = text.replace(/ /g, '').trim();
    return { name: file.name, kind, chars: cleaned.length, text: cleaned };
  } catch (err: any) {
    return {
      name: file.name,
      kind: ext || 'unknown',
      chars: 0,
      text: '',
      error: err?.message || 'parse failed',
    };
  }
}
