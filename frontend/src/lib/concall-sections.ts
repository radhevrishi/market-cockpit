// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0389 — Concall PDF section extractor.
//
// Per user feedback: "Right now your engine likely scores entire PDF
// indiscriminately. That creates massive noise. Only score forward-looking
// sections: Management Commentary / Outlook / Guidance / Q&A / MD&A."
//
// Strategy: heuristically find section headers in the extracted PDF text
// and return only the forward-looking sections. Concall PDFs in India
// follow predictable layouts (operator intro → management commentary →
// Q&A → closing remarks). Investor presentations have headers like
// "FY26 Outlook", "Guidance", "Business Highlights".
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractedSections {
  // Forward-looking sections (the ones we WANT to score)
  management_commentary: string;
  outlook_guidance: string;
  qna: string;
  highlights: string;
  // Combined forward-looking text ready for scoring
  forward_text: string;
  // Boilerplate / non-relevant (excluded from scoring)
  boilerplate: string;
  // Diagnostics
  total_chars: number;
  forward_chars: number;
  found_sections: string[];
}

// ─── Section header patterns ───────────────────────────────────────────────
// Each pattern: regex that matches a section START, plus a label.
// We split the PDF into segments at these boundaries.

interface SectionMarker {
  label: 'management_commentary' | 'outlook_guidance' | 'qna' | 'highlights' | 'boilerplate';
  patterns: RegExp[];
}

const SECTION_MARKERS: SectionMarker[] = [
  // Management commentary — most valuable
  {
    label: 'management_commentary',
    patterns: [
      /management\s+commentary/i,
      /management\s+discussion(?:\s+and\s+analysis)?/i,
      /\bMD&A\b/i,
      /chairman['']?s?\s+(?:remarks?|message|address|note|statement)/i,
      /CEO\s+(?:remarks?|message|address|note|commentary)/i,
      /CFO\s+(?:remarks?|commentary|comments)/i,
      /managing\s+director\s+(?:remarks?|message)/i,
      /opening\s+remarks?/i,
      /business\s+(?:performance|highlights|update|review)/i,
      /operational\s+(?:performance|highlights|update|review)/i,
    ],
  },
  // Outlook / guidance — most valuable
  {
    label: 'outlook_guidance',
    patterns: [
      /\boutlook\b/i,
      /\bguidance\b/i,
      /forward[- ]?looking/i,
      /way\s+forward/i,
      /future\s+(?:outlook|prospects|growth)/i,
      /strategic\s+(?:priorities|outlook|focus|initiatives)/i,
      /FY\s*2\d\s*outlook/i,
      /\bH[12]\s*FY\s*2\d\b/i,
      /near[- ]term\s+outlook/i,
      /medium[- ]term\s+outlook/i,
      /long[- ]term\s+outlook/i,
    ],
  },
  // Q&A — captures management responses
  {
    label: 'qna',
    patterns: [
      /question\s+and\s+answer/i,
      /\bQ\s*&\s*A\b/i,
      /Q[&\s]+A\s+session/i,
      /analyst\s+(?:Q&A|questions)/i,
      /moderator:/i,  // common Q&A delimiter
    ],
  },
  // Highlights / financials
  {
    label: 'highlights',
    patterns: [
      /(?:key\s+)?financial\s+highlights/i,
      /key\s+(?:metrics|highlights|takeaways)/i,
      /quarterly\s+highlights/i,
      /performance\s+highlights/i,
    ],
  },
  // Boilerplate to EXCLUDE
  {
    label: 'boilerplate',
    patterns: [
      /safe\s+harbo[u]?r/i,
      /forward[- ]?looking\s+statements?\s+disclaimer/i,
      /this\s+presentation\s+(?:contains|may\s+contain)/i,
      /disclaimer:?/i,
      /legal\s+notice/i,
      /\bcompany\s+overview\b/i,
      /about\s+(?:the\s+)?company/i,
      /\bESG\b\s+(?:initiatives|performance|highlights)/i,
      /sustainability\s+(?:report|initiatives)/i,
      /corporate\s+social\s+responsibility/i,
      /investor\s+contacts?/i,
      /thank\s+you\s+for\s+(?:joining|attending|your)/i,
    ],
  },
];

// ─── Extractor ─────────────────────────────────────────────────────────────

export function extractSections(text: string): ExtractedSections {
  const result: ExtractedSections = {
    management_commentary: '',
    outlook_guidance: '',
    qna: '',
    highlights: '',
    forward_text: '',
    boilerplate: '',
    total_chars: text.length,
    forward_chars: 0,
    found_sections: [],
  };

  if (!text || text.length < 500) {
    // Too short for section detection — treat whole text as forward (best effort)
    result.forward_text = text;
    result.forward_chars = text.length;
    return result;
  }

  // Build an index of section start positions
  type Hit = { pos: number; label: SectionMarker['label']; matched: string };
  const hits: Hit[] = [];
  for (const marker of SECTION_MARKERS) {
    for (const re of marker.patterns) {
      const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m: RegExpExecArray | null;
      while ((m = globalRe.exec(text)) !== null) {
        hits.push({ pos: m.index, label: marker.label, matched: m[0] });
      }
    }
  }
  hits.sort((a, b) => a.pos - b.pos);

  if (hits.length === 0) {
    // No section headers found — fall back to scoring whole document
    // but exclude trailing boilerplate (last 10% of text)
    const cutoff = Math.floor(text.length * 0.9);
    result.forward_text = text.slice(0, cutoff);
    result.forward_chars = result.forward_text.length;
    result.boilerplate = text.slice(cutoff);
    return result;
  }

  // Walk through hits, attribute the text BETWEEN consecutive hits to the
  // section the EARLIER hit labels
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1];
    const start = h.pos;
    const end = next ? next.pos : Math.min(text.length, start + 25_000);
    const segment = text.slice(start, end).trim();
    if (!segment) continue;

    if (h.label === 'boilerplate') {
      result.boilerplate += '\n' + segment;
      continue;
    }
    result.found_sections.push(`${h.label}:${h.matched}`);
    switch (h.label) {
      case 'management_commentary': result.management_commentary += '\n' + segment; break;
      case 'outlook_guidance':       result.outlook_guidance     += '\n' + segment; break;
      case 'qna':                     result.qna                  += '\n' + segment; break;
      case 'highlights':              result.highlights           += '\n' + segment; break;
    }
  }

  // If we somehow found only boilerplate, fall back to first 70% of text
  const forward = (
    result.management_commentary + '\n' +
    result.outlook_guidance + '\n' +
    result.qna + '\n' +
    result.highlights
  ).trim();

  if (forward.length < 500) {
    const cutoff = Math.floor(text.length * 0.7);
    result.forward_text = text.slice(0, cutoff);
  } else {
    result.forward_text = forward;
  }
  result.forward_chars = result.forward_text.length;
  return result;
}
