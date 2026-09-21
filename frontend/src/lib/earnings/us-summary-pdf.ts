// ═══════════════════════════════════════════════════════════════════════════
// THE AI SUMMARY, AS A PAGE YOU CAN KEEP.                            (zzz693)
//
// The structured reading only existed inside an expanded card. You could read
// it, and then it was gone — you could not put it beside the next quarter's,
// email it, or mark it up before a decision. This writes the same verified
// object to an A4 page.
//
// IT IS WHITE. The card is dark because a screen full of cards is read at a
// glance in a dim room; a page is read in daylight, annotated in pen, and
// sometimes printed. A dark PDF is unreadable in all three and empties a
// cartridge doing it. So the page is white, the rules are hairlines, and the
// only colour is on the guidance band and the two verdict edges — the three
// places where colour carries meaning rather than decoration.
//
// IT RENDERS WHAT WAS VERIFIED, AND NOTHING ELSE. The input is the same
// `structured` object the card renders, which the route has already checked
// figure-by-figure against the release text. This adds no figure, computes no
// figure, and reorders nothing. A section the release was silent on is
// omitted rather than printed empty, exactly as on the card — a blank heading
// on a page you keep for three months reads as a bug, not as an absence.
//
// The footer carries the provenance: the accession, the source URL, the model
// that read it, and the generation timestamp. Without those the page is an
// assertion; with them it is a document you can audit back to EDGAR.
//
// jsPDF + autotable are already dependencies (the India report uses them).
// The import is dynamic so neither reaches the bundle until a download is
// actually asked for.
// ═══════════════════════════════════════════════════════════════════════════

import type { CommentaryScore } from './commentary-score';

export interface UsSummaryPdfInput {
  ticker: string;
  company?: string | null;
  quarter?: string | null;
  tier?: string | null;
  filingDate?: string | null;
  sourceUrl?: string | null;
  model?: string | null;
  /** The verified `structured` object from /api/v1/us/ai-summary. */
  d: any;
  /** Optional — printed as its own block when present. */
  commentary?: CommentaryScore | null;
}

// Ink-friendly tokens. Text is near-black; colour is reserved for meaning.
const INK = [23, 29, 41] as [number, number, number];
const INK2 = [71, 85, 105] as [number, number, number];
const MUTED = [130, 142, 158] as [number, number, number];
const RULE = [219, 225, 232] as [number, number, number];
const GREEN = [21, 128, 61] as [number, number, number];
const RED = [185, 28, 28] as [number, number, number];
const AMBER = [180, 120, 8] as [number, number, number];
const BLUE = [29, 78, 137] as [number, number, number];

const GUIDE_LABEL: Record<string, { label: string; rgb: [number, number, number] }> = {
  raised: { label: 'GUIDANCE RAISED', rgb: GREEN },
  initiated: { label: 'GUIDANCE INITIATED', rgb: BLUE },
  maintained: { label: 'GUIDANCE MAINTAINED', rgb: AMBER },
  lowered: { label: 'GUIDANCE LOWERED', rgb: RED },
  withdrawn: { label: 'GUIDANCE WITHDRAWN', rgb: RED },
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const has = (v: unknown): boolean => str(v).length > 1;

/** jsPDF's helvetica has no Unicode beyond Latin-1, so anything that would
 *  render as a black box is replaced with an ASCII equivalent up front. */
function ascii(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/[↑▲]/g, '+')
    .replace(/[↓▼]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E]/g, '');
}

export async function exportUsSummaryPdf(input: UsSummaryPdfInput): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { d } = input;
  if (!d || typeof d !== 'object') throw new Error('There is no verified summary to export.');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const M = 16;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const W = pageW - M * 2;
  const BOTTOM = pageH - 20;

  doc.setFont('helvetica', 'normal');
  let y = M;

  /** Break the page before writing a block that would not fit. */
  const room = (needed: number) => {
    if (y + needed > BOTTOM) { doc.addPage(); y = M; }
  };

  /** Wrapped body text. Returns the height consumed. */
  const para = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; lead?: number } = {},
  ) => {
    const size = opts.size ?? 9.5;
    const indent = opts.indent ?? 0;
    const lead = opts.lead ?? size * 0.48;
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(opts.color ?? INK2));
    const lines = doc.splitTextToSize(ascii(text), W - indent) as string[];
    for (const ln of lines) {
      room(lead + 1);
      doc.text(ln, M + indent, y + size * 0.35);
      y += lead;
    }
  };

  const heading = (label: string, color: [number, number, number] = MUTED) => {
    room(9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.6);
    doc.setTextColor(...color);
    doc.text(ascii(label.toUpperCase()), M, y + 2.6);
    y += 5.4;
  };

  // ── A SECTION OPENS ATOMICALLY ─────────────────────────────────────────
  //
  // The first render of this put a divider rule and a heading through the
  // page-break check SEPARATELY, and the SMTC test page showed what that
  // costs: the "Not disclosed" rule was drawn at the foot of page 1, and its
  // heading and single line went to page 2 — a dangling hairline under
  // nothing, and a second page holding one sentence. Both read as a bug on a
  // page someone keeps for three months.
  //
  // So a section reserves its rule, its heading and one line of body in a
  // single check, and breaks before the rule rather than after it. Nothing
  // downstream needs to know: the call sites just say `section('Segments')`.
  const SECTION_OPENER_MM = 16;
  const section = (label: string, color: [number, number, number] = MUTED, divider = true) => {
    room(SECTION_OPENER_MM);
    // A divider separates this section from the one ABOVE it. At the top of a
    // fresh page there is nothing above it, so the rule would be a line under
    // the page edge — decoration pretending to be structure.
    if (divider && y > M) {
      doc.setDrawColor(...RULE);
      doc.setLineWidth(0.2);
      doc.line(M, y, pageW - M, y);
      y += 4;
    }
    heading(label, color);
  };

  // ── Word wrap with a first-line offset ─────────────────────────────────
  //
  // A bullet reads "> Label detail detail detail", where Label is bold and
  // sits on the first line next to the marker, and the detail wraps under it
  // at the marker's indent. jsPDF's splitTextToSize wraps to ONE width, which
  // cannot express "first line is narrower because the label is on it" — and
  // the obvious workaround, wrapping twice and slicing the remainder by string
  // length, silently drops or duplicates a word whenever the two wraps
  // disagree. So the wrap is done once, here, at word level, with the first
  // line measured against its own narrower width.
  const wrapOffset = (text: string, firstW: number, restW: number): string[] => {
    const words = ascii(text).split(/\s+/).filter(Boolean);
    const out: string[] = [];
    let line = '';
    let width = firstW;
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (doc.getTextWidth(trial) <= width || !line) {
        line = trial;
      } else {
        out.push(line);
        line = w;
        width = restW;
      }
    }
    if (line) out.push(line);
    return out;
  };

  /** "> label  detail" — coloured marker, bold label, hanging indent. */
  const bullet = (label: string, detail: string, color: [number, number, number]) => {
    const lab = has(label) ? ascii(label.replace(/[:.]\s*$/, '')) : '';
    const det = has(detail) ? ascii(detail) : '';
    if (!lab && !det) return;
    room(6);

    const X = M + 5;              // text column
    const LEAD = 4.15;

    // Marker.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...color);
    doc.text('>', M + 1, y + 3.1);

    // Bold label on the first line.
    let labelW = 0;
    if (lab) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(`${lab} `, X, y + 3.1);
      labelW = doc.getTextWidth(`${lab} `);
    }

    // Detail, first line beside the label and the rest under it.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK2);
    if (det) {
      const lines = wrapOffset(det, W - 5 - labelW, W - 5);
      lines.forEach((ln, i) => {
        if (i > 0) room(LEAD);
        doc.text(ln, i === 0 ? X + labelW : X, y + 3.1);
        y += LEAD;
      });
    } else {
      y += LEAD;
    }
    y += 0.6;
  };

  // ── Header ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text(ascii(input.company || input.ticker), M, y + 6);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK2);
  const subBits = [input.ticker, input.quarter, input.filingDate ? `filed ${String(input.filingDate).slice(0, 10)}` : '']
    .filter((x) => has(x));
  doc.text(ascii(subBits.join('   |   ')), M, y + 2);
  // Tier on the right, as text rather than a filled badge — no ink blocks.
  if (has(input.tier)) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(ascii(String(input.tier).toUpperCase()), pageW - M, y + 2, { align: 'right' });
  }
  y += 6;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  doc.line(M, y, pageW - M, y);
  y += 6;

  // ── 1. Verdict ─────────────────────────────────────────────────────────
  if (has(d.verdict_line)) {
    para(str(d.verdict_line), { size: 12, bold: true, color: INK, lead: 6 });
    y += 3;
  }

  // ── 2. Guidance ────────────────────────────────────────────────────────
  const act = str(d.guidance?.action);
  if (act && act !== 'none' && GUIDE_LABEL[act]) {
    const g = GUIDE_LABEL[act];
    room(14);
    // A left edge in the guidance colour, not a filled band.
    const top = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...g.rgb);
    doc.text(ascii(g.label), M + 4, y + 3.2);
    y += 5.2;
    const gDetail = [str(d.guidance?.detail), str(d.guidance?.period) ? `(${str(d.guidance.period)})` : '']
      .filter(Boolean).join(' ');
    if (gDetail) para(gDetail, { size: 9.5, color: INK, indent: 4 });
    doc.setDrawColor(...g.rgb);
    doc.setLineWidth(1.1);
    doc.line(M + 0.6, top, M + 0.6, y - 0.5);
    y += 4;
  } else {
    section('Guidance', MUTED, false);
    para('This release gives no forward guidance.', { size: 9.5, color: AMBER });
    y += 3;
  }

  // ── 3. Commentary score ────────────────────────────────────────────────
  if (input.commentary) {
    const c = input.commentary;
    room(16);
    section('Commentary score');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...INK);
    doc.text(`${c.score}`, M, y + 4);
    doc.setFontSize(10);
    doc.setTextColor(...INK2);
    doc.text(`/ 100    ${ascii(c.grade)}`, M + 11, y + 4);
    y += 8;
    para(
      `Measures how much management disclosed, not how good the quarter was. Read from ${c.source}.`,
      { size: 8.2, color: MUTED },
    );
    y += 1.5;
    for (const comp of c.components) {
      room(5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.4);
      doc.setTextColor(...INK);
      doc.text(ascii(comp.label), M, y + 2.8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...(comp.points < 0 ? RED : INK2));
      doc.text(`${comp.points > 0 ? '' : ''}${comp.points} / ${comp.max}`, M + 26, y + 2.8);
      doc.setTextColor(...MUTED);
      const why = doc.splitTextToSize(ascii(comp.because), W - 44) as string[];
      doc.text(why[0] || '', M + 44, y + 2.8);
      y += 4.2;
      for (let i = 1; i < why.length; i++) {
        room(4.2);
        doc.text(why[i], M + 44, y + 2.8);
        y += 4.2;
      }
    }
    y += 3;
  }

  // ── 3b. v6: why the margin moved, and what is coming ───────────  (zzz699)
  const mb: any = (d as any).margin_bridge;
  const mbDrivers: any[] = Array.isArray(mb?.drivers) ? mb.drivers : [];
  if (mb && (mbDrivers.length || has(mb.opm_change_pp))) {
    section('Why the margin moved');
    const VERD: Record<string, [string, [number, number, number]]> = {
      predominantly_structural: ['MOSTLY STRUCTURAL', GREEN],
      predominantly_cyclical: ['MOSTLY CYCLICAL', AMBER],
      mixed: ['MIXED', BLUE],
      not_explained: ['NOT EXPLAINED', MUTED],
    };
    const [vt, vc] = VERD[str(mb.verdict)] || VERD.not_explained;
    room(6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK);
    if (has(mb.opm_change_pp)) doc.text(ascii(str(mb.opm_change_pp)), M, y + 3.2);
    doc.setFontSize(8.5); doc.setTextColor(...vc);
    doc.text(vt, M + (has(mb.opm_change_pp) ? 22 : 0), y + 3.2);
    y += 6;
    for (const dr of mbDrivers) {
      const nat = str(dr?.nature);
      const col = nat === 'structural' ? GREEN : nat === 'cyclical' ? AMBER : RED;
      const word = nat === 'structural' ? 'structural - repeats'
        : nat === 'cyclical' ? 'cyclical - will not repeat' : 'one-off';
      bullet('', `${str(dr?.detail)}  (${word})`, col);
    }
    const PNL: Record<string, string> = {
      gross_profit: 'gross profit', ebitda: 'EBITDA', operating_income: 'operating income',
      other_income: 'other income', finance_cost: 'finance cost', tax: 'tax',
      exceptional: 'an exceptional item', no_divergence: 'no line - growth tracks revenue',
    };
    const pnl = PNL[str(mb.where_in_pnl)];
    if (pnl) para(`Growth first diverges from revenue at ${pnl}.`, { size: 8.5, color: MUTED });
    y += 1.5;
  }

  const cats: any[] = Array.isArray((d as any).catalysts) ? (d as any).catalysts : [];
  if (cats.length) {
    section('Catalysts');
    for (const c of cats) {
      const sub = [str(c?.size_vs_company), str(c?.expected_impact_period) && str(c?.expected_impact_period) !== 'not stated'
        ? `impact from ${str(c.expected_impact_period)}` : '']
        .filter((x) => x && x !== 'not quantified').join(' - ');
      const st = str(c?.status) && str(c?.status) !== 'not_stated'
        ? ` [${str(c.status).replace(/_/g, ' ')}]` : '';
      bullet(str(c?.title) + st, sub, BLUE);
    }
    y += 1.5;
  }

  const capexP: any[] = Array.isArray((d as any).capex_projects) ? (d as any).capex_projects : [];
  if (capexP.length) {
    section('Capacity and capex');
    for (const c of capexP) {
      const sub = [str(c?.amount), str(c?.capacity_added),
        str(c?.completion_period) && str(c.completion_period) !== 'not stated' ? `completes ${str(c.completion_period)}` : '',
        str(c?.revenue_from) && str(c.revenue_from) !== 'not stated' ? `earns from ${str(c.revenue_from)}` : '']
        .filter(Boolean).join(' - ');
      bullet(str(c?.name), sub, INK2);
    }
    y += 1.5;
  }

  const kv = (obj: any, keys: string[], labels: Record<string, string>) =>
    keys.map((k) => ({ k, v: str(obj?.[k]) })).filter((r) => has(r.v))
      .map((r) => `${labels[r.k]}: ${r.v}`);
  const utLines = kv((d as any).utilisation, ['current', 'prior', 'expected', 'expected_by', 'basis'],
    { current: 'Now', prior: 'Was', expected: 'Expected', expected_by: 'By', basis: 'Basis' });
  if (utLines.length) { section('Utilisation'); para(utLines.join('   |   '), { size: 9.5, color: INK }); y += 1.5; }

  const obLines = kv((d as any).order_book,
    ['closing_value', 'growth', 'order_inflow', 'book_to_bill', 'execution_period', 'concentration'],
    { closing_value: 'Order book', growth: 'Growth', order_inflow: 'Inflow', book_to_bill: 'Book-to-bill', execution_period: 'Executes over', concentration: 'Concentration' });
  if (obLines.length) { section('Order book'); para(obLines.join('   |   '), { size: 9.5, color: INK }); y += 1.5; }

  if (has((d as any).operating_leverage_evidence)) {
    section('Operating leverage');
    para(str((d as any).operating_leverage_evidence), { size: 9.5 });
    y += 1.5;
  }

  const oneOffs: any[] = Array.isArray((d as any).one_offs) ? (d as any).one_offs : [];
  if (oneOffs.length) {
    section('One-offs - what will not repeat', RED);
    for (const o of oneOffs) {
      const amt = has(o?.amount) ? ` - ${str(o.amount)}` : '';
      const rec = str(o?.recurring) === 'will_not_recur' ? ' (will not recur)' : '';
      bullet(str(o?.direction) === 'gain' ? '+' : '-', `${str(o?.item)}${amt}${rec}`,
        str(o?.direction) === 'gain' ? AMBER : RED);
    }
    y += 1.5;
  }

  // ── 4. Positives / negatives ───────────────────────────────────────────
  const pos: any[] = Array.isArray(d.positives) ? d.positives : [];
  const neg: any[] = Array.isArray(d.negatives) ? d.negatives : [];
  if (pos.length) {
    section('What went right', GREEN);
    for (const it of pos) bullet(str(it?.label), str(it?.detail), GREEN);
    y += 1.5;
  }
  if (neg.length) {
    section('What did not', RED, false);
    for (const it of neg) bullet(str(it?.label), str(it?.detail), RED);
    y += 1.5;
  } else if (pos.length) {
    section('What did not', RED, false);
    para('The release contains no stated negative.', { size: 9.5, color: MUTED });
    y += 1.5;
  }

  // ── 5. Segments ────────────────────────────────────────────────────────
  const segs: any[] = Array.isArray(d.segments) ? d.segments : [];
  if (segs.length) {
    section('Segments');
    for (const s of segs) {
      const dir = str(s?.direction);
      const arrow = dir === 'up' ? '+' : dir === 'down' ? '-' : '=';
      const col = dir === 'up' ? GREEN : dir === 'down' ? RED : INK2;
      bullet(`${arrow} ${str(s?.name)}`, str(s?.detail), col);
    }
    y += 1.5;
  }

  // ── 6. Mix, management, new business ───────────────────────────────────
  if (has(d.mix_shift)) {
    section('Mix shift');
    para(str(d.mix_shift), { size: 9.5 });
    y += 1.5;
  }
  if (has(d.management)) {
    section('Management', MUTED, false);
    para(str(d.management), { size: 9.5 });
    y += 1.5;
  }
  const nb: string[] = (Array.isArray(d.new_business) ? d.new_business : []).filter(has);
  if (nb.length) {
    section('New business', MUTED, false);
    for (const n of nb) bullet('', str(n), BLUE);
    y += 1.5;
  }

  // ── 7. Capital allocation ──────────────────────────────────────────────
  const cap = d.capital && typeof d.capital === 'object' ? d.capital : {};
  const capRows = (['capex', 'buyback', 'dividend', 'debt'] as const)
    .map((k) => ({ k, v: str(cap[k]) })).filter((r) => has(r.v));
  if (capRows.length) {
    section('Capital allocation');
    for (const r of capRows) {
      bullet(r.k.charAt(0).toUpperCase() + r.k.slice(1), r.v, INK2);
    }
    y += 1.5;
  }

  // ── 8. What decides the next few quarters ──────────────────────────────
  const watch: string[] = (Array.isArray(d.watch_next) ? d.watch_next : []).filter(has);
  if (watch.length) {
    section('What decides the next few quarters');
    for (const w of watch) bullet('', str(w), AMBER);
    y += 1.5;
  }

  // ── 9. Not disclosed — last and quiet ──────────────────────────────────
  const nd: string[] = (Array.isArray(d.not_disclosed) ? d.not_disclosed : []).filter(has);
  if (nd.length) {
    section('Not disclosed in this release');
    for (const n of nd) {
      room(4.6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      const lines = doc.splitTextToSize(`- ${ascii(str(n))}`, W - 2) as string[];
      for (const ln of lines) { room(4.15); doc.text(ln, M + 1, y + 3.1); y += 4.15; }
    }
    y += 1.5;
  }

  // ── Footer on every page ───────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(M, pageH - 15, pageW - M, pageH - 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    const prov = [
      'Written from the company\'s own press release only - no news, no estimates, no market reaction.',
      'Every figure is checked against the release before it is shown. Empty sections mean the release is silent.',
      'Educational, not investment advice.',
    ].join(' ');
    const lines = doc.splitTextToSize(ascii(prov), W - 22) as string[];
    let fy = pageH - 11.5;
    for (const ln of lines.slice(0, 3)) { doc.text(ln, M, fy); fy += 2.9; }
    doc.text(`${p} / ${pages}`, pageW - M, pageH - 11.5, { align: 'right' });
    if (has(input.sourceUrl) || has(input.model)) {
      doc.setFontSize(6.4);
      const src = [
        has(input.sourceUrl) ? `Source: ${str(input.sourceUrl)}` : '',
        has(input.model) ? `Read by ${str(input.model)}` : '',
        `Generated ${stamp}`,
      ].filter(Boolean).join('   |   ');
      const sl = doc.splitTextToSize(ascii(src), W) as string[];
      doc.text(sl[0] || '', M, pageH - 3.2);
    }
  }

  const safe = `${input.ticker || 'summary'}-${(input.quarter || '').replace(/[^A-Za-z0-9]+/g, '')}`
    .replace(/-+$/, '');
  doc.save(`${safe}-ai-summary.pdf`);
}
