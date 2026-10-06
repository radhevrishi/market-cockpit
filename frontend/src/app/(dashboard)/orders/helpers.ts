// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { DECISION_COLORS, TEXT3, GREEN, YELLOW, RED, MANUAL_ALIASES, ALIAS_BLOCKLIST, ALWAYS_EXCLUDED_FROM_INDUSTRIAL_SIGNALS, COMPOUND_EXTRACT_PATTERNS, CONCALL_PATTERNS, NEWS_FEED_PATTERNS, HEADLINE_PATTERNS } from './constants';
import { type ActionFlag, type ImpactLevel, type SignalTemporality, type NumericalExtract, type SectorSignalDef, type ConcallSignalType, type ExtractedSignal, type SignalOrigin, type CompositeSignal, type SignalCategory } from './types';

// ── Helpers ──
export const remapActionLabel = (a: ActionFlag): ActionFlag => {
  if (a === 'BUY' || a === 'ADD') return 'MONITOR';
  return a;
};
export const actionColor = (a: ActionFlag) => DECISION_COLORS[a] || TEXT3;
export const actionBg = (a: ActionFlag) => {
  const colorMap: Record<ActionFlag, string> = {
    'BUY': 'rgba(16,185,129,0.12)',
    'ADD': 'rgba(5,150,105,0.12)',
    'HOLD': 'rgba(251,191,36,0.12)',
    'WATCH': 'rgba(167,139,250,0.12)',
    'TRIM': 'rgba(249,115,22,0.12)',
    'EXIT': 'rgba(239,68,68,0.12)',
    'AVOID': 'rgba(100,116,139,0.08)',
    'MONITOR': 'rgba(15,122,191,0.12)',
  };
  return colorMap[a] || 'rgba(100,116,139,0.08)';
};
export const impactColor = (l: ImpactLevel) => l === 'HIGH' ? GREEN : l === 'MEDIUM' ? YELLOW : TEXT3;
export const impactBg = (l: ImpactLevel) => l === 'HIGH' ? 'rgba(16,185,129,0.12)' : l === 'MEDIUM' ? 'rgba(251,191,36,0.10)' : 'rgba(100,116,139,0.06)';
export const biasColor = (b: string) => b === 'Bullish' ? GREEN : b === 'Bearish' ? RED : YELLOW;
export const sentimentColor = (s: string) => s === 'Bullish' ? GREEN : s === 'Bearish' ? RED : TEXT3;
export const fmtCr = (v: number | null): string => {
  if (v === null || v === undefined || v === 0) return '—';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  if (v >= 1) return `₹${Math.round(v)} Cr`;
  return `₹${Math.round(v * 100)}L`;
};
export const fmtPrice = (v: number | null | undefined): string => {
  if (v === null || v === undefined || v === 0) return 'N/A';
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toFixed(2)}`;
};
export const fmtDate = (d: string) => {
  try {
    // Handle DD-MM-YYYY format
    if (d.length === 10 && d[2] === '-') {
      const [dd, mm, yyyy] = d.split('-');
      const dt = new Date(`${yyyy}-${mm}-${dd}`);
      if (!isNaN(dt.getTime())) return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    }
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch { return d; }
};
export const eventTypeIcon = (t: string) => {
  if (t.includes('Order') || t.includes('Contract') || t.includes('LOI')) return '📋';
  if (t.includes('Capex') || t.includes('Expansion')) return '🏗️';
  if (t.includes('M&A') || t.includes('Demerger')) return '🤝';
  if (t.includes('JV') || t.includes('Partnership')) return '🔗';
  if (t.includes('Fund') || t.includes('QIP')) return '💰';
  if (t.includes('Buyback')) return '🔄';
  if (t.includes('Dividend')) return '💵';
  if (t.includes('Guidance')) return '🎯';
  if (t.includes('Mgmt')) return '👤';
  if (t.includes('Block') || t.includes('Bulk')) return '📊';
  return '📌';
};
  // PATCH 0251


/** Filter out GOVERNANCE / Mgmt Change signals — not useful for portfolio decisions */
export const _filterGovNoise = (list: any[]) =>
  list.filter(s => {
    const et = (s.eventType || '').toLowerCase();
    if (et === 'mgmt change' || et === 'board appointment' || et === 'board meeting') return false;
    const sc = (s.signalClass || '').toLowerCase();
    if (sc === 'governance' && (et.includes('change') || et.includes('appointment') || et.includes('board'))) return false;
    return true;
  });
// ── Forward/Backward Tagger ───────────────────────────────────────────────────
export function tagTemporality(sentence: string): SignalTemporality {
  const s = sentence.toLowerCase();
  // PATCH 0054: Expanded FORWARD word list to include commercial verbs that
  // imply future execution. "wins ₹500cr order" is materially forward — the
  // order will fulfil over future quarters even though the verb is past
  // tense. Previously these were tagged HISTORICAL, killing alpha for 96%
  // of news-derived signals.
  const forwardWords = [
    'expect','anticipate','plan to','going forward','next quarter','upcoming',
    'will see','should see','likely to','over the next','in the coming','target',
    'guidance','outlook','forecast','aspire','project to','aim to',
    // Commercial future-execution verbs
    'wins','won','win','secured','bagged','awarded','bags','grabs',
    'to deliver','will deliver','will commission','to commission','will supply',
    'inaugurated','launches','launched','announces','announced',
    'orders received','order received','order book','contract worth','deal worth',
    'expansion','expand','expanding','ramp up','ramping','breaks ground','broke ground',
    'sets up','setting up','to invest','investment of','capex',
  ];
  const historicalWords = [
    'last quarter','last year','previously','was','had been',
    'fy23','fy24','reported','achieved',
    // PATCH 0054: keep "in qN" but require NOT followed by FY26+ (current quarters
    // shouldn't be HISTORICAL) — we leave the simple includes() but mitigate
    // via FORWARD-list precedence (FORWARD wins if both match).
    'in q1','in q2','in q3','in q4',
  ];
  if (forwardWords.some(w => s.includes(w))) return 'FORWARD';
  if (historicalWords.some(w => s.includes(w))) return 'HISTORICAL';
  return 'CURRENT';
}
// PATCH 0054: Some signal types are inherently forward-looking by their
// commercial nature — winning an order, securing a contract, commissioning
// a plant, raising guidance. Past-tense reporting of these events shouldn't
// kill their alpha status.
export function isCommerciallyForward(type: string): boolean {
  return /^(ORDER|CONTRACT_WIN|EXPORT_DEAL|CAPACITY_ANNOUNCEMENT|CAPACITY_EXPANSION|GUIDANCE_UP|DEMAND_CONSTRAINT|CAPEX|CAPEX_RAISE|INVESTMENT_ANNOUNCEMENT|COMMISSIONING|TENDER_AWARDED|MERGER|ACQUISITION|FUNDRAISE|QIP|IPO_ANNOUNCEMENT)/i.test(type);
}
// ── Numerical Extractor ───────────────────────────────────────────────────────
export function extractNumerical(text: string): NumericalExtract | undefined {
  // Match ₹XXX crore/lakh, or X Cr/Lakh patterns
  const m1 = text.match(/₹\s*([\d,]+(?:\.\d+)?)\s*(cr|crore|lakh|lac|mn|bn|billion)/i);
  const m2 = text.match(/([\d,]+(?:\.\d+)?)\s*(crore|cr|lakh|lac)\s+(order|contract|revenue|sales)/i);
  const timingWords = ['next few weeks','next quarter','q1','q2','q3','q4','fy','this year','by march','by june','by september','by december','h1','h2'];
  const timing = timingWords.find(t => text.toLowerCase().includes(t));
  const match = m1 || m2;
  if (!match) return undefined;
  const raw = match[1].replace(/,/g,'');
  const unit = (match[2]||'').toLowerCase();
  const value = parseFloat(raw) * (unit.startsWith('lakh') || unit.startsWith('lac') ? 0.01 : unit.startsWith('bn') || unit.startsWith('billion') ? 100 : 1);
  return { value: Math.round(value * 10) / 10, unit: 'Cr', currency: 'INR', timing };
}
// ── Signal Age Decay ─────────────────────────────────────────────────────────
export function getAgeWeight(dateStr: string): number {
  if (!dateStr) return 0.5;
  const ageDays = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (ageDays <= 3)  return 1.0;
  if (ageDays <= 10) return 0.8;
  if (ageDays <= 20) return 0.6;
  return 0.4;
}
// ── Company Alias Generator v2 — smarter matching for Indian small-caps ──────
export function buildAliases(symbol: string, companyName: string): string[] {
  const sym = symbol.toUpperCase().replace(/\.NS$|\.BO$/i, '');
  const aliases: string[] = [];
  const name = companyName.toLowerCase().trim();

  // 1. Always add the full company name (most specific, least ambiguous)
  if (name.length >= 4) aliases.push(name);

  // 2. Manual overrides first — highest precision
  const manualExtra = MANUAL_ALIASES[sym] ?? [];
  for (const m of manualExtra) aliases.push(m.toLowerCase());

  // 3. Strip common business suffixes but keep meaningful parts
  const cleaned = name
    .replace(/\b(ltd|limited|pvt|private|industries|solutions|technologies|technology|systems|services|engineering|enterprises|corporation|corp|inc|company)\b/g, '')
    .replace(/[&+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 4. Use cleaned name only if it's meaningfully different and long enough
  if (cleaned.length >= 8 && cleaned !== name) aliases.push(cleaned);

  // 5. Two-word combos from cleaned name (require both words >= 4 chars)
  const words = cleaned.split(/\s+/).filter(w => w.length >= 4);
  if (words.length >= 2) {
    const twoWord = words.slice(0, 2).join(' ');
    if (twoWord.length >= 8) aliases.push(twoWord);
  }

  // 6. Single-word from first word ONLY if it's:
  //    - long enough (>= 7 chars to avoid generic words)
  //    - NOT in the blocklist
  //    - NOT a common word that appears everywhere
  if (words.length >= 1) {
    const firstWord = words[0];
    if (firstWord.length >= 7 && !ALIAS_BLOCKLIST.has(firstWord)) {
      aliases.push(firstWord);
    }
  }

  // 7. NSE symbol itself (only if >= 4 chars — minimum to be meaningful)
  const symLower = sym.toLowerCase();
  if (symLower.length >= 4) aliases.push(symLower);

  return [...new Set(aliases.filter(a => a.length >= 4))];
}
// Company-level financial check (catches companies where sector tag is generic but company is financial)
export function isFinancialCompany(sector: string, company: string): boolean {
  const sl = sector.toLowerCase();
  const cl = company.toLowerCase();
  // Explicit sector matches
  if (ALWAYS_EXCLUDED_FROM_INDUSTRIAL_SIGNALS.has(sl)) return true;
  // Regex pattern — catches "capital markets", "financial services", "exchange" etc.
  return /\b(bank|finance|capital market|exchange|commodity exchange|broker|insurance|invest|asset manag|fund|nbfc|fintech|payment|trading platform)\b/i.test(sl + ' ' + cl);
}
// Compute how relevant a sector signal is for a specific company (0.0 – 1.0)
// Rule: relevance < threshold → signal NOT propagated to this company
export function computeSectorRelevance(company: {sector:string;company:string}, sig: SectorSignalDef): number {
  const sl = (company.sector||'').toLowerCase();
  const cl = (company.company||'').toLowerCase();

  // Hard block: financial/exchange/service sector companies — NEVER get industrial signals
  // FIXED: Removed the '!== DEMAND_SURGE' exception that was letting pharma signals through to IIFL
  if (isFinancialCompany(sl, cl)) return 0;

  if (sig.excludeSectors.some(e => sl.includes(e.toLowerCase()) || cl.includes(e.toLowerCase()))) return 0;
  if (sig.targetSectors.some(t => sl.includes(t.toLowerCase()) || cl.includes(t.toLowerCase()))) return 0.85;
  if (sig.beneficiaryProducts.some(b => sl.includes(b.toLowerCase()) || cl.includes(b.toLowerCase()))) return 0.7;
  return 0.2; // default very low — most stocks don't benefit from any given sector signal
}
// Check if compound requirement is met: both product AND state keyword in same sentence
export function meetsCompoundRequirement(sentence: string, compound?: {product: string[]; state: string[]}): boolean {
  if (!compound) return true;
  const s = sentence.toLowerCase();
  const hasProduct = compound.product.some(p => s.includes(p));
  const hasState   = compound.state.some(st => s.includes(st));
  return hasProduct && hasState;
}
// ── Subject Extractor — "WHAT" field that prevents generic DEMAND_CONSTRAINT everywhere ──
// Maps raw article text + signal type → a specific subject ("Insulators", "₹300Cr", "Q4 FY26")
export function extractSubject(type: ConcallSignalType, text: string): string {
  const t = text.toLowerCase();
  // Product/material subjects — detect WHAT is constrained
  if (t.includes('insulator')) return 'Insulators';
  if (t.includes('transformer')) return 'Transformers';
  if (t.includes('cable') || t.includes('conductor')) return 'Cables/Conductors';
  if (t.includes('solar') || t.includes('module') || t.includes('panel')) return 'Solar';
  if (t.includes('semiconductor') || t.includes('chip')) return 'Semiconductors';
  if (t.includes('defence') || t.includes('defense') || t.includes('military')) return 'Defence';
  if (t.includes('railway') || t.includes('rail')) return 'Railways';
  if (t.includes('water') || t.includes('sewage') || t.includes('municipal')) return 'Water Infra';
  if (t.includes('real estate') || t.includes('housing') || t.includes('construction')) return 'Real Estate';
  if (t.includes('pharma') || t.includes('drug') || t.includes('api')) return 'Pharma';
  if (t.includes('export') || t.includes('overseas') || t.includes('international')) return 'Export';
  // Order subject: use numerical extract or generic
  if (type === 'ORDER' || type === 'LTA') {
    const m = text.match(/₹\s*[\d,.]+\s*(cr|crore|lakh)/i);
    if (m) return m[0].trim();
    return 'Order Pipeline';
  }
  // Capex subject: extract timing
  if (type === 'CAPEX') {
    const m = text.match(/[Qq][1-4]\s*[Ff][Yy]\s*\d{2,4}/i) || text.match(/[Ff][Yy]\s*\d{2,4}/i);
    if (m) return `Capacity (${m[0].toUpperCase()})`;
    return 'Capacity Expansion';
  }
  if (type === 'CAPEX_DELAY') return 'Expansion Delay';
  if (type === 'MARGIN' || type === 'MARGIN_PRESSURE') return 'Operating Margin';
  if (type === 'PRICING') return 'Pricing Power';
  if (type === 'GUIDANCE_UP') return 'Management Outlook';
  if (type === 'GUIDANCE_DOWN') return 'Guidance Risk';
  if (type === 'CONSERVATIVE_GUIDANCE') return 'Conservative Management';
  if (type === 'VISIBILITY_CONFIDENCE') return 'Order Visibility';
  if (type === 'EXPORT_DEMAND') return 'Export Orders';
  if (type === 'DEBT_REDUCTION') return 'Balance Sheet';
  if (type === 'DEMAND_CONSTRAINT') return 'Supply Constraint';
  return type.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}
// ── Signal Deduplicator — merges same-type signals, increments strength ──────
// Fixes: DEMAND_CONSTRAINT × 3 → DEMAND_CONSTRAINT (Strength 4, merged)
export function deduplicateSignals(signals: ExtractedSignal[]): ExtractedSignal[] {
  // Key = type + origin (company-specific ORDER stays separate from sector ORDER)
  const grouped = new Map<string, ExtractedSignal[]>();
  for (const s of signals) {
    const key = `${s.type}:${s.origin}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }
  const deduped: ExtractedSignal[] = [];
  for (const group of grouped.values()) {
    // Pick the best (highest strength × ageWeight, with evidence text)
    const withText = group.filter(s => s.text && s.text.length > 10);
    const best = (withText.length > 0 ? withText : group).sort((a,b) => (b.strength * b.ageWeight) - (a.strength * a.ageWeight))[0];
    // Merge subjects from all duplicates
    const subjects = [...new Set(group.map(s => s.subject).filter(Boolean))].slice(0, 3);
    const mergedStrength = Math.min(5, best.strength + Math.floor((group.length - 1) / 2)) as 1|2|3|4|5;
    deduped.push({ ...best, subject: subjects.join(' + ') || best.subject, strength: mergedStrength, dupCount: group.length });
  }
  return deduped.sort((a,b) => (b.strength * b.ageWeight) - (a.strength * a.ageWeight));
}
export function extractSignals(articleText: string, source: string, date: string): ExtractedSignal[] {
  const text = articleText.toLowerCase();
  const results: ExtractedSignal[] = [];
  const ageWeight = getAgeWeight(date);

  // Process compound patterns FIRST (higher specificity, higher confidence)
  for (const cp of COMPOUND_EXTRACT_PATTERNS) {
    // Split into sentences first
    const sentences = articleText.split(/[.!?]/).map(s => s.trim()).filter(s => s.length >= 15);
    for (const sentence of sentences) {
      const sl = sentence.toLowerCase();
      const hasProduct = cp.products.some(p => sl.includes(p));
      const hasState   = cp.states.some(s => sl.includes(s));
      if (hasProduct && hasState) {
        const numerical = extractNumerical(sentence);
        const temporality = tagTemporality(sentence);
        // PATCH 0054: alpha is preserved when (a) temporality isn't strictly
        // historical, OR (b) the signal type is commercially forward (an
        // ORDER / CONTRACT_WIN / COMMISSIONING extends into future quarters
        // even when reported in past tense), OR (c) a quantified ₹X cr
        // commitment was extracted (concrete value = actionable).
        const effectiveAlpha = cp.isAlpha && (
          temporality !== 'HISTORICAL' ||
          isCommerciallyForward(cp.type) ||
          numerical !== undefined
        );
        // Avoid duplicating if same type already found with better evidence
        if (!results.some(r => r.type === cp.type && r.subject === cp.subject)) {
          results.push({
            type: cp.type, category: cp.category, text: sentence.split(' ').slice(0,40).join(' '),
            positive: cp.positive, strength: cp.strength, horizon: cp.horizon,
            isAlpha: effectiveAlpha, temporality, numerical,
            subject: cp.subject, origin: 'COMPANY', isForConcall: true,
            source, date, ageWeight,
          });
        }
        break; // one compound signal per pattern per article
      }
    }
  }

  // Process generic concall patterns
  for (const p of CONCALL_PATTERNS) {
    let matched = false;
    let matchedText = '';

    // Layer 1: Keyword match
    for (const kw of p.keywords) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
        const end = Math.min(articleText.length, (text.indexOf('.', idx + kw.length) + 1) || articleText.length);
        matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 40).join(' ');
        matched = true;
        break;
      }
    }

    // Layer 2: Semantic match (only if Layer 1 missed)
    if (!matched) {
      for (const sem of p.semantic) {
        if (text.includes(sem)) {
          const idx = text.indexOf(sem);
          const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
          const end = Math.min(articleText.length, (text.indexOf('.', idx + sem.length) + 1) || articleText.length);
          matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 40).join(' ');
          matched = true;
          break;
        }
      }
    }

    // EVIDENCE INTEGRITY: only create signal if we extracted actual text (≥15 chars)
    // This prevents signals without traceable evidence — the core trust issue
    if (matched && matchedText.length >= 15) {
      const temporality = tagTemporality(matchedText);
      const numerical = extractNumerical(matchedText);
      // PATCH 0054: same loosened alpha gate (see above)
      const effectiveAlpha = p.isAlpha && (
        temporality !== 'HISTORICAL' ||
        isCommerciallyForward(p.type) ||
        numerical !== undefined
      );
      const subject = extractSubject(p.type, matchedText);
      results.push({
        type: p.type, category: p.category, text: matchedText,
        positive: p.positive, strength: p.strength, horizon: p.horizon,
        isAlpha: effectiveAlpha, temporality,
        numerical, isForConcall: true,
        subject, origin: 'COMPANY', // extractSignals = company match; sector signals tagged separately
        source, date, ageWeight,
      });
    }
  }

  // Process news-feed patterns (analyst cap etc.) — tagged differently
  for (const p of NEWS_FEED_PATTERNS) {
    for (const kw of [...p.keywords, ...p.semantic]) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
        const end = Math.min(articleText.length, (text.indexOf('.', idx + kw.length) + 1) || articleText.length);
        const matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 40).join(' ');
        if (matchedText.length >= 15) {
          results.push({
            type: p.type, category: p.category, text: matchedText,
            positive: p.positive, strength: p.strength, horizon: '0-3M',
            isAlpha: p.isAlpha, temporality: 'CURRENT' as const,
            isForConcall: false,
            subject: extractSubject(p.type, matchedText), origin: 'COMPANY' as SignalOrigin,
            source, date, ageWeight,
          });
        }
        break;
      }
    }
  }

  // ── HEADLINE PATTERNS — catch news-style language that CONCALL_PATTERNS misses ──
  // These run last and only add signals if no stronger signal of the same type already exists.
  for (const p of HEADLINE_PATTERNS) {
    // Skip if we already have a stronger signal of this type from management language
    const existingOfType = results.filter(r => r.type === p.type);
    const bestExisting = existingOfType.reduce((best, r) => Math.max(best, r.strength), 0);
    if (bestExisting >= p.strength + 1) continue; // already have a better signal

    let matched = false;
    let matchedText = '';
    for (const kw of p.keywords) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        // Grab the surrounding sentence (or whole short headline)
        const start = Math.max(0, text.lastIndexOf('.', idx - 1) + 1);
        const end = Math.min(articleText.length, (text.indexOf('.', idx + kw.length) + 1) || articleText.length);
        matchedText = articleText.slice(start, end).trim().split(' ').slice(0, 50).join(' ');
        // For very short headlines, use full text
        if (matchedText.length < 15 && articleText.length < 200) {
          matchedText = articleText.trim().split(' ').slice(0, 50).join(' ');
        }
        if (matchedText.length >= 10) { matched = true; break; }
      }
    }
    if (matched && matchedText.length >= 10) {
      const temporality = tagTemporality(matchedText);
      const numerical = extractNumerical(matchedText);
      results.push({
        type: p.type, category: p.category,
        text: matchedText,
        positive: p.positive, strength: p.strength, horizon: p.horizon,
        isAlpha: p.isAlpha, temporality,
        numerical, isForConcall: false, // headline = news, not concall
        subject: p.subject, origin: 'COMPANY' as SignalOrigin,
        source, date, ageWeight,
      });
    }
  }

  return results;
}
// ── Multi-Article Signal Aggregation ─────────────────────────────────────────
export function buildCompositeSignals(signals: ExtractedSignal[]): CompositeSignal[] {
  const cats = new Map<SignalCategory, ExtractedSignal[]>();
  for (const s of signals) {
    if (!cats.has(s.category)) cats.set(s.category, []);
    cats.get(s.category)!.push(s);
  }
  const composites: CompositeSignal[] = [];
  for (const [cat, sigs] of cats) {
    if (sigs.length === 0) continue;
    const posCount = sigs.filter(s=>s.positive).length;
    const negCount = sigs.filter(s=>!s.positive).length;
    const direction: 'UP'|'DOWN'|'STABLE' = posCount > negCount ? 'UP' : negCount > posCount ? 'DOWN' : 'STABLE';
    const compositeStrength = Math.min(5, Math.round(sigs.reduce((s,sig)=>s+sig.strength * sig.ageWeight,0) / sigs.length) + (sigs.length >= 3 ? 1 : 0));
    const catLabels: Record<string, string> = {
      DEMAND:'Demand', MARGIN:'Margin', CAPEX:'Capacity', PRICING:'Pricing',
      GUIDANCE:'Guidance', SUPPLY_CHAIN:'Supply Chain', RISK:'Risk', MGMT_STYLE:'Management Style',
    };
    composites.push({
      category: cat,
      label: catLabels[cat] || cat,
      direction,
      strength: compositeStrength as 1|2|3|4|5,
      evidence: sigs.filter(s=>s.isAlpha).slice(0,3).map(s=>s.text),
      count: sigs.length,
    });
  }
  return composites.sort((a,b) => b.strength - a.strength);
}
// ── Expectation Shift Score ───────────────────────────────────────────────────
export function computeExpectationShift(signals: ExtractedSignal[]): number {
  // HIGH SHIFT: new information materially different from steady-state
  // LOW SHIFT: confirmatory / steady-state
  let shift = 0;
  const HIGH_SHIFT_TYPES: ConcallSignalType[] = ['DEMAND_CONSTRAINT','LTA','GUIDANCE_UP','GUIDANCE_DOWN','ANALYST_CAP','CONSERVATIVE_GUIDANCE','VISIBILITY_CONFIDENCE'];
  const forwardAlpha = signals.filter(s=>s.isAlpha && s.temporality==='FORWARD');
  shift += forwardAlpha.length * 12;
  shift += signals.filter(s=>HIGH_SHIFT_TYPES.includes(s.type)).length * 8;
  shift += signals.filter(s=>s.numerical !== undefined).length * 10; // numerical = concrete = high shift
  shift -= signals.filter(s=>s.temporality==='HISTORICAL').length * 5; // historical = no shift
  return Math.max(0, Math.min(100, shift));
}
// ── Why It Matters Generator ──────────────────────────────────────────────────
// Upgraded: uses actual signal subjects for dynamic, company-specific narrative
export function generateWhyItMatters(composites: CompositeSignal[], signals: ExtractedSignal[]): string {
  const demandSig = signals.find(s=>s.type==='DEMAND_CONSTRAINT'&&s.positive&&s.text);
  const orderSig  = signals.find(s=>s.type==='ORDER'&&s.positive&&s.text);
  const capexSig  = signals.find(s=>s.type==='CAPEX'&&s.positive&&s.text);
  const marginSig = signals.find(s=>s.type==='MARGIN'&&s.positive&&s.text);
  const guidanceSig = signals.find(s=>s.type==='GUIDANCE_UP'&&s.positive&&s.text);
  const negSigs   = signals.filter(s=>!s.positive&&s.isAlpha&&s.text);

  if (signals.length === 0) return 'No traceable management signals in 30D window.';

  // Build specific narrative using subjects (e.g., "Insulators constrained, ₹300Cr order pipeline")
  const parts: string[] = [];
  if (demandSig) parts.push(`${demandSig.subject} constrained${demandSig.origin==='SECTOR'?' (sector-wide)':' (company confirmed)'}`);
  if (orderSig)  parts.push(`${orderSig.subject || 'order pipeline'} confirmed`);
  if (capexSig)  parts.push(`${capexSig.subject || 'capacity'} expanding`);
  if (marginSig) parts.push(`${marginSig.subject || 'margins'} stable`);
  if (guidanceSig) parts.push(`management ${guidanceSig.subject?.toLowerCase() || 'outlook'} positive`);

  const negParts = negSigs.slice(0,2).map(s=>`${s.subject || s.type} risk`);

  if (parts.length === 0 && negParts.length > 0) {
    return `Risk signals: ${negParts.join(' + ')}. No positive confirmation. Watch closely.`;
  }
  if (parts.length >= 3 && negParts.length === 0) {
    return `${parts.slice(0,-1).join(' + ')} → ${parts[parts.length-1]} → revenue acceleration likely 2-4 quarters.`;
  }
  if (parts.length >= 2 && negParts.length === 0) {
    return `${parts.join(' + ')} → multi-signal convergence, improving conviction.`;
  }
  if (parts.length >= 1 && negParts.length > 0) {
    return `${parts.join(' + ')} but ${negParts.join(' + ')} — mixed signals, monitor resolution.`;
  }
  if (parts.length === 1) {
    const isOnlySector = signals.filter(s=>s.isAlpha&&s.positive).every(s=>s.origin==='SECTOR');
    return isOnlySector
      ? `${parts[0]} — sector signal only. No company-specific confirmation found. Low conviction.`
      : `${parts[0]} — single signal. Needs corroboration before sizing up.`;
  }
  return 'Insufficient signals for synthesis. Verify manually.';
}
// ── Fixed MRI Score (incorporates management style signals) ──────────────────
export function computeMRI(signals: ExtractedSignal[]): number {
  // MRI = management reliability — only company-confirmed signals contribute
  const companySigs = signals.filter(s => s.origin === 'COMPANY' && s.text && s.text.length >= 8);
  if (companySigs.length === 0) return 50; // neutral: no company data
  let score = 50;
  score += companySigs.filter(s=>s.type==='GUIDANCE_UP'||s.type==='CONSERVATIVE_GUIDANCE').length * 10;
  score += companySigs.filter(s=>s.type==='VISIBILITY_CONFIDENCE').length * 8;
  score += companySigs.filter(s=>s.isAlpha&&s.positive&&s.temporality==='FORWARD').length * 5;
  score -= companySigs.filter(s=>s.type==='CAPEX_DELAY'||s.type==='ORDER_EXECUTION_DELAY').length * 10;
  score -= companySigs.filter(s=>s.type==='GUIDANCE_DOWN').length * 12;
  score -= companySigs.filter(s=>!s.positive&&s.isAlpha).length * 4;
  const hasConservative = companySigs.some(s=>s.type==='CONSERVATIVE_GUIDANCE');
  const hasStrong = companySigs.some(s=>s.strength>=4&&s.positive);
  if (hasConservative && hasStrong) score += 10; // underpromise-overdeliver pattern
  return Math.max(10, Math.min(95, score));
}
// ── Fixed Signal Score (corrected weights: alpha 1.0, negative -1.2, noise 0.3) ─
export function computeSignalScore(signals: ExtractedSignal[]): number {
  // CRITICAL: Only COMPANY-matched signals score. Sector signals are context, not evidence.
  // This prevents "Data center power demand" → phantom 100 score for every electrical company.
  // Lowered threshold to 8 chars: headline-style signals like "wins order" are < 15 chars
  // but are valid COMPANY evidence (defense orders, quarterly results etc.)
  const companySignals = signals.filter(s => s.origin === 'COMPANY' && s.text && s.text.length >= 8);
  if (companySignals.length === 0) return 0; // no company evidence = score 0
  const weightedSum = companySignals.reduce((sum, s) => {
    let w = s.strength * s.ageWeight;
    if (s.isAlpha && s.positive)    w *= 1.0;
    else if (!s.positive && s.isAlpha) w *= -1.2;
    else if (!s.isAlpha)            w *= 0.3;
    return sum + w;
  }, 0);
  // Scale by coverage: more articles = higher confidence (log scale)
  const coverageMultiplier = 1 + Math.log2(1 + companySignals.length) * 0.15;
  return Math.max(0, Math.min(100, Math.round((50 + weightedSum * 4) * coverageMultiplier)));
}
