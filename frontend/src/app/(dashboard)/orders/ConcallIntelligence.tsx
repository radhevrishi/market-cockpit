'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useEffect, useMemo } from 'react';
import { SignalCard } from './components';
import { SECTOR_SIGNALS, TEXT3, TEXT1, BORDER } from './constants';
import { buildAliases, isFinancialCompany, extractSignals, computeSectorRelevance, meetsCompoundRequirement, getAgeWeight, deduplicateSignals, buildCompositeSignals, computeSignalScore, computeMRI, computeExpectationShift, generateWhyItMatters } from './helpers';
import { type CompanyConcallSummary, type ExtractedSignal, type SectorSignalDef, type CompositeSignal } from './types';

export function ConcallIntelligence() {
  const [loading, setLoading] = useState(false);
  const [summaries, setSummaries] = useState<CompanyConcallSummary[]>([]);
  const [lastFetched, setLastFetched] = useState('');
  const [expandedSym, setExpandedSym] = useState<string|null>(null);
  const [showAlphaOnly, setShowAlphaOnly] = useState(false);

  // Read screener stocks from localStorage
  // Combine ALL tracked stocks: Screener + Watchlist + Portfolio (so no stock is missed)
  // PATCH 0461 — memoize. Previously the localStorage parse + array build
  // ran on every render (every state change in the page). With 100+ tracked
  // stocks this is measurable per-render jank. We use useMemo + a manual
  // invalidation tick that listens to storage events + custom upload events.
  const [stocksTick, setStocksTick] = useState(0);
  useEffect(() => {
    const bump = () => setStocksTick(t => t + 1);
    window.addEventListener('storage', bump);
    window.addEventListener('mb-upload:updated', bump);
    window.addEventListener('conviction-beats:updated', bump);
    return () => {
      window.removeEventListener('storage', bump);
      window.removeEventListener('mb-upload:updated', bump);
      window.removeEventListener('conviction-beats:updated', bump);
    };
  }, []);
  const screenerStocks = useMemo<{symbol:string;company:string;sector:string;source:string;grade?:string;score?:number}[]>(() => {
    const seen = new Set<string>();
    const all: {symbol:string;company:string;sector:string;source:string;grade?:string;score?:number}[] = [];
    // 1. Multibagger screener stocks (mb_excel_scored_v2)
    try {
      const d = JSON.parse(localStorage.getItem('mb_excel_scored_v2')||'[]');
      if (Array.isArray(d)) d.forEach((r:any) => {
        const sym = (r.symbol||'').toUpperCase();
        if (sym && !seen.has(sym)) { seen.add(sym); all.push({symbol:r.symbol,company:r.company||r.symbol,sector:r.sector||'',grade:r.grade,score:r.score,source:'Screener'}); }
      });
    } catch {}
    // 2. Watchlist tickers (mc_watchlist_tickers)
    try {
      const wl = JSON.parse(localStorage.getItem('mc_watchlist_tickers')||'[]');
      if (Array.isArray(wl)) wl.forEach((sym:string) => {
        const s = sym.toUpperCase();
        if (s && !seen.has(s)) { seen.add(s); all.push({symbol:s,company:s,sector:'',source:'Watchlist'}); }
      });
    } catch {}
    // 3. Portfolio holdings (mc_portfolio_holdings)
    try {
      const pf = JSON.parse(localStorage.getItem('mc_portfolio_holdings')||'[]');
      if (Array.isArray(pf)) pf.forEach((h:any) => {
        const s = (h.symbol||'').toUpperCase();
        if (s && !seen.has(s)) { seen.add(s); all.push({symbol:s,company:h.company||s,sector:'',source:'Portfolio'}); }
      });
    } catch {}
    return all;
  }, [stocksTick]);

  async function fetchConcallData() {
    if (screenerStocks.length === 0) return;
    setLoading(true);
    // PATCH 0469 — 20s timeout per news request via shared AbortController
    const newsCtl = new AbortController();
    const newsTimer = setTimeout(() => newsCtl.abort(), 20_000);
    try {
      // Fetch broad news covering last 30 days
      const fetches = await Promise.allSettled([
        fetch('/api/v1/news?limit=500&importance_min=1&article_type=EARNINGS', { signal: newsCtl.signal }),
        fetch('/api/v1/news?limit=300&importance_min=1&article_type=CORPORATE', { signal: newsCtl.signal }),
        fetch('/api/v1/news?limit=200&importance_min=2&article_type=GENERAL', { signal: newsCtl.signal }),
      ]);
      clearTimeout(newsTimer);
      const arrays = await Promise.all(fetches.map(async r => {
        if (r.status !== 'fulfilled' || !r.value.ok) return [];
        try { const d = await r.value.json(); return Array.isArray(d) ? d : []; } catch { return []; }
      }));
      const allArticles = arrays.flat();
      const now = Date.now();
      const THIRTY_DAYS = 30 * 86400000;

      // Match articles to screener stocks
      const result: CompanyConcallSummary[] = [];
      // PATCH 0065: load any cached manual-paste signals BEFORE the loop so
      // we can merge them per stock + tag fidelity tier accurately.
      let manualStore: Record<string, { text?: string; signals?: ExtractedSignal[]; timestamp?: number }> = {};
      try {
        manualStore = JSON.parse(localStorage.getItem('mb_concall_manual_v1') || '{}');
      } catch { manualStore = {}; }

      for (const stock of screenerStocks) {
        const sym = stock.symbol.toUpperCase().replace(/\.NS$|\.BO$/i,'');
        // Build alias list for better Indian small-cap matching
        const aliases = buildAliases(sym, stock.company||sym);

        // ── Company families: when multiple tickers share a common prefix ─────────
        // e.g., BAJAJ → BAJAJCON, BAJAJAUTO, BAJAJFINSERV, BAJAJHLDNG
        // If an article's PRIMARY ticker is a DIFFERENT member of the same family,
        // we only include it if our company's specific name appears in the text.
        const FAMILY_PREFIXES = ['BAJAJ','TATA','ADANI','BIRLA','MAHINDRA','RELIANCE','HDFC','ICICI','KOTAK','L&T','LT','HCL'];
        const symFamily = FAMILY_PREFIXES.find(fp => sym.startsWith(fp));

        const relevant = allArticles.filter(a => {
          if (!a.published_at) return false;
          const age = now - new Date(a.published_at).getTime();
          if (age > THIRTY_DAYS) return false;
          const text = ((a.title||'')+(a.headline||'')+(a.summary||'')).toLowerCase();
          const artTickers = ((a.ticker_symbols||[]) as string[]).map((t:string)=>t.toUpperCase().replace(/\.NS$|\.BO$/i,''));

          // Primary ticker match (highest confidence):
          if (artTickers.includes(sym)) {
            // Cross-contamination guard: if the article's PRIMARY ticker is a DIFFERENT
            // company in the same family (e.g., BAJAJAUTO when we want BAJAJCON),
            // require our specific company name to appear in the text.
            const primaryTicker = artTickers[0];
            if (primaryTicker && primaryTicker !== sym && symFamily && primaryTicker.startsWith(symFamily)) {
              // Different company in same family — verify our name actually appears
              const nameInText = aliases.some(alias =>
                alias.length >= 8 && text.includes(alias.toLowerCase())
              );
              return nameInText;
            }
            return true;
          }

          // Alias match — use word-boundary awareness for short aliases
          for (const alias of aliases) {
            if (alias.length < 4) continue;
            // For long aliases (>= 8 chars): simple substring match is fine
            if (alias.length >= 8) {
              if (text.includes(alias)) return true;
              continue;
            }
            // For short aliases (4-7 chars): require word boundary
            const idx = text.indexOf(alias);
            if (idx === -1) continue;
            const before = idx === 0 || !/[a-z0-9]/.test(text[idx - 1]);
            const after = idx + alias.length >= text.length || !/[a-z0-9]/.test(text[idx + alias.length]);
            if (before && after) return true;
          }
          return false;
        });

        // Cross-stock sector signals: inject sector-wide signals for this company
        const sectorText = (stock.sector||'').toLowerCase();
        const sectorSignalArticles = allArticles.filter(a => {
          if (!a.published_at || (now - new Date(a.published_at).getTime()) > THIRTY_DAYS) return false;
          const text = ((a.title||'')+(a.headline||'')+(a.summary||'')).toLowerCase();
          return SECTOR_SIGNALS.some(ss =>
            ss.targetSectors.some(ts => sectorText.includes(ts)) &&
            ss.keywords.some(kw => text.includes(kw))
          );
        });

        // Don't skip 0-article companies — still show them with "no news" state
        // (helps user understand which companies have no press coverage)
        // Only skip if the company has truly nothing useful to display AND there are many stocks tracked
        // i.e., only skip if stock score is low-grade (D) AND 0 articles AND 0 sector signals
        if (relevant.length === 0 && sectorSignalArticles.length === 0) {
          // Show high-grade or watchlist/portfolio stocks even with no news
          const isHighPriority = ['A+','A','B+'].includes(stock.grade||'') || stock.source === 'Portfolio' || stock.source === 'Watchlist';
          if (!isHighPriority) continue; // skip D/C grade screener stocks with 0 articles
        }

        // For financial companies (exchanges, banks, NBFCs): only allow GUIDANCE/RESULTS signals
        // They don't get supply-chain, order, or capacity signals from articles
        const stockIsFinancial = isFinancialCompany(stock.sector||'', stock.company||'');

        // Extract signals — COMPANY signals first, then SECTOR signals (clearly separated)
        const rawSignals: ExtractedSignal[] = [];

        // Company signals: from articles that matched THIS company's ticker/name
        for (const a of relevant) {
          const fullText = [(a.title||''),(a.headline||''),(a.summary||'')].join(' ');
          const sigs = extractSignals(fullText, a.title||a.headline||'', a.published_at||'');
          // Financial companies: filter to only GUIDANCE/RESULTS type signals
          // (prevent commodity order language being interpreted as equipment orders)
          const filtered = stockIsFinancial
            ? sigs.filter(s => ['GUIDANCE_UP','GUIDANCE_DOWN','MARGIN','MARGIN_PRESSURE','EQUITY_DILUTION','REGULATORY_RISK'].includes(s.type))
            : sigs;
          rawSignals.push(...filtered);
        }

        // Sector signals: injected ONLY when relevance >= threshold AND compound requirement met
        // These do NOT affect signalScore (score uses COMPANY signals only) — purely context
        const stockMeta = { sector: stock.sector||'', company: stock.company||'' };
        const appliedSectorSignals = new Set<string>(); // deduplicate sector signals per company
        for (const a of sectorSignalArticles) {
          if (relevant.includes(a)) continue; // already processed as COMPANY
          const fullText = [(a.title||''),(a.headline||''),(a.summary||'')].join(' ');
          const fullTextLower = fullText.toLowerCase();
          // Match to specific sector signal definition (not just generic extraction)
          for (const ss of SECTOR_SIGNALS) {
            const alreadyApplied = appliedSectorSignals.has(ss.id);
            if (alreadyApplied) continue;
            // Relevance gate: company must be relevant enough to receive this signal
            const relevance = computeSectorRelevance(stockMeta, ss);
            if (relevance < ss.relevanceThreshold) continue;
            // Keyword gate: article must mention at least one keyword
            const hasKeyword = ss.keywords.some(kw => fullTextLower.includes(kw));
            if (!hasKeyword) continue;
            // Extract the specific sentence containing the matched keyword
            const matchedKw = ss.keywords.find(kw => fullTextLower.includes(kw));
            if (!matchedKw) continue;
            const idx = fullTextLower.indexOf(matchedKw);
            const sentStart = Math.max(0, fullText.lastIndexOf('.', idx - 1) + 1);
            const sentEnd = Math.min(fullText.length, (fullText.indexOf('.', idx + matchedKw.length) + 1) || fullText.length);
            const sentence = fullText.slice(sentStart, sentEnd).trim().split(' ').slice(0, 40).join(' ');
            // HARD VALIDATION: sentence must exist AND meet compound requirement
            if (sentence.length < 15) continue;
            if (!meetsCompoundRequirement(sentence, ss.compoundRequired)) continue;
            appliedSectorSignals.add(ss.id);
            rawSignals.push({
              type: 'DEMAND_CONSTRAINT', category: 'DEMAND', text: sentence,
              positive: true, strength: 3, horizon: '6-12M', isAlpha: true,
              temporality: 'CURRENT',
              subject: `${ss.subject} (${ss.signalType.replace(/_/g,' ')})`,
              origin: 'SECTOR', isForConcall: true,
              source: a.title || a.headline || '', date: a.published_at || '',
              ageWeight: getAgeWeight(a.published_at || ''),
              // Store sector metadata for richer display
              ...(({ sectorDef: ss } as any)),
            } as ExtractedSignal & { sectorDef: SectorSignalDef });
          }
        }

        // PATCH 0065: merge cached manual concall signals if present.
        // Manual signals tagged with source: 'Manual Concall Input' so we can
        // count them separately for the fidelity tier.
        const manualEntry = manualStore[stock.symbol.toUpperCase()];
        const manualSignals: ExtractedSignal[] = (manualEntry?.signals ?? []).map(s => ({
          ...s,
          source: 'Manual Concall Input',
        }));
        const combinedRaw = [...rawSignals, ...manualSignals];

        // DEDUPLICATION: merge same-type signals, preventing DEMAND_CONSTRAINT × 3
        const allSignals = deduplicateSignals(combinedRaw);

        const composite = buildCompositeSignals(allSignals);
        const signalScore = computeSignalScore(allSignals);
        const mriScore = computeMRI(allSignals);
        const expectationShift = computeExpectationShift(allSignals);
        // Dynamic why-it-matters using actual signal subjects
        const whyItMatters = generateWhyItMatters(composite, allSignals);
        const posCount = allSignals.filter(s=>s.positive).length;
        const negCount = allSignals.filter(s=>!s.positive).length;

        const trend: 'IMPROVING'|'STABLE'|'DETERIORATING'|'UNKNOWN' =
          allSignals.length === 0 ? 'UNKNOWN' :
          posCount > negCount * 2 ? 'IMPROVING' : negCount > posCount ? 'DETERIORATING' : 'STABLE';

        const hasConservativeStyle = allSignals.some(s=>s.type==='CONSERVATIVE_GUIDANCE');
        const hasBullish = allSignals.some(s=>['ORDER','DEMAND_CONSTRAINT','GUIDANCE_UP','VISIBILITY_CONFIDENCE'].includes(s.type));
        const tone = hasConservativeStyle && hasBullish ? 'Conservative-Bullish' : hasBullish ? 'Bullish' : negCount > 0 ? 'Cautious' : 'Neutral';

        const latestDate = [...relevant,...sectorSignalArticles].reduce((latest, a) =>
          !latest || (a.published_at && a.published_at > latest) ? a.published_at : latest, '');
        const ageHours = latestDate ? (now - new Date(latestDate).getTime()) / 3600000 : 9999;
        const freshness: 'FRESH'|'ACTIVE'|'STALE' = ageHours < 48 ? 'FRESH' : ageHours < 168 ? 'ACTIVE' : 'STALE';

        const alphaCount = allSignals.filter(s=>s.isAlpha).length;
        const surprisePotential: 'HIGH'|'MEDIUM'|'LOW' =
          (expectationShift >= 60 || allSignals.filter(s=>s.strength>=4&&s.positive).length>=2) ? 'HIGH' :
          allSignals.length >= 3 ? 'MEDIUM' : 'LOW';

        // "Missed by market" — strong signals but few articles (market hasn't priced it yet)
        const missedByMarket = alphaCount >= 2 && relevant.length <= 2 && signalScore >= 60;

        // Collect recent headlines for display (even when 0 signals)
        const recentHeadlines = relevant
          .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
          .slice(0, 5)
          .map(a => ({
            title: (a.title || a.headline || '').trim(),
            source: (a.source_name || a.source || '').trim(),
            date: a.published_at || '',
            url: a.url || a.source_url || '',
          }))
          .filter(h => h.title.length > 10);

        // PATCH 0065: Fidelity tier — what kind of evidence drives this card.
        // HIGH_MANUAL > MEDIUM_NEWS_ALPHA > LOW_NEWS_ONLY > NONE.
        // This becomes the primary sort key so manual transcripts always rise
        // to the top regardless of news-derived signal score.
        const manualSignalsCount = manualSignals.length;
        const hasManual = manualSignalsCount > 0;
        const newsArticleCount = relevant.length;
        let fidelity_tier: 'HIGH_MANUAL' | 'MEDIUM_NEWS_ALPHA' | 'LOW_NEWS_ONLY' | 'NONE';
        if (hasManual)                                          fidelity_tier = 'HIGH_MANUAL';
        else if (newsArticleCount >= 3 && alphaCount >= 1)      fidelity_tier = 'MEDIUM_NEWS_ALPHA';
        else if (newsArticleCount >= 1)                         fidelity_tier = 'LOW_NEWS_ONLY';
        else                                                    fidelity_tier = 'NONE';

        result.push({
          symbol: stock.symbol, company: stock.company, sector: stock.sector,
          grade: stock.grade, score: stock.score, source: (stock as any).source||'Screener',
          signals: allSignals.sort((a,b) => (b.strength * b.ageWeight) - (a.strength * a.ageWeight)),
          composite, signalScore, mriScore, expectationShift, trend, tone,
          surprisePotential, freshness, missedByMarket, whyItMatters,
          lastDate: latestDate, articleCount: relevant.length,
          alphaCount, noiseCount: allSignals.filter(s=>!s.isAlpha).length,
          recentHeadlines,
          // PATCH 0065: fidelity fields
          fidelity_tier,
          manual_signals_count: manualSignalsCount,
          manual_paste_iso: manualEntry?.timestamp ? new Date(manualEntry.timestamp).toISOString() : undefined,
        } as any);
      }

      // PATCH 0065: Sort by fidelity tier FIRST, then signal score.
      // Manual-transcript stocks always rise above news-only regardless of
      // news signal strength — so users always see their highest-confidence
      // evidence first.
      const FIDELITY_ORDER = { HIGH_MANUAL: 0, MEDIUM_NEWS_ALPHA: 1, LOW_NEWS_ONLY: 2, NONE: 3 };
      setSummaries(result.sort((a,b) => {
        const fa = FIDELITY_ORDER[(a as any).fidelity_tier as keyof typeof FIDELITY_ORDER] ?? 4;
        const fb = FIDELITY_ORDER[(b as any).fidelity_tier as keyof typeof FIDELITY_ORDER] ?? 4;
        if (fa !== fb) return fa - fb;
        return b.signalScore - a.signalScore;
      }));
      setLastFetched(new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
    } catch(e) { console.error('[Concall]',e); }
    finally { clearTimeout(newsTimer); }
    setLoading(false);
  }

  // PATCH 0874 — Fix silent no-op. Previous deps `[]` (eslint-disabled)
  // captured screenerStocks at first mount when it was empty, so the
  // guard `length > 0` was always false → fetchConcallData NEVER ran.
  // Tracking screenerStocks.length triggers the call once data arrives
  // asynchronously from the storage listener. fetchConcallData is a
  // plain (non-memoised) function recreated every render and reads
  // screenerStocks via closure, so it's left out of the dep array on
  // purpose (would cause an infinite loop).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (screenerStocks.length > 0) fetchConcallData(); }, [screenerStocks.length]);

  const ACCENT2 = '#a78bfa';
  // ── Manual Concall Input state — paste raw transcript/highlight text ──
  const [manualInput, setManualInput] = useState('');
  const [manualSymbol, setManualSymbol] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const MANUAL_KEY = 'mb_concall_manual_v1';

  const [manualParseStatus, setManualParseStatus] = useState<{type:'ok'|'warn'|'error';msg:string}|null>(null);

  function processManualInput() {
    if (!manualInput.trim() || !manualSymbol.trim()) return;
    const sym = manualSymbol.trim().toUpperCase();
    const sigs = extractSignals(manualInput, 'Manual Concall Input', new Date().toISOString());
    if (sigs.length === 0) {
      setManualParseStatus({type:'warn', msg:'No signals detected. Try phrases like "₹300 Cr order", "capacity expansion", "margin stable", "demand strong".'});
      return;
    }
    // Store manual signals in localStorage keyed by symbol
    try {
      const stored = JSON.parse(localStorage.getItem(MANUAL_KEY)||'{}');
      stored[sym] = { text: manualInput, signals: sigs, timestamp: Date.now() };
      localStorage.setItem(MANUAL_KEY, JSON.stringify(stored));
    } catch {}
    // Inject into existing summary or create new entry
    setSummaries(prev => {
      const existing = prev.find(s => s.symbol === sym);
      if (existing) {
        const merged = deduplicateSignals([...existing.signals, ...sigs]);
        const updated = { ...existing, signals: merged, signalScore: computeSignalScore(merged), mriScore: computeMRI(merged), alphaCount: merged.filter(s=>s.isAlpha).length, articleCount: existing.articleCount, composite: buildCompositeSignals(merged), whyItMatters: generateWhyItMatters(buildCompositeSignals(merged), merged) };
        return prev.map(s => s.symbol === sym ? updated : s).sort((a,b)=>b.signalScore-a.signalScore);
      }
      const stock = screenerStocks.find(s => s.symbol.toUpperCase() === sym);
      const newEntry: CompanyConcallSummary = {
        symbol: sym, company: stock?.company || sym, sector: stock?.sector || '', grade: stock?.grade, score: stock?.score, source: 'Manual',
        signals: sigs, composite: buildCompositeSignals(sigs), signalScore: computeSignalScore(sigs), mriScore: computeMRI(sigs),
        expectationShift: computeExpectationShift(sigs), trend: 'IMPROVING', tone: 'Bullish', surprisePotential: 'HIGH',
        freshness: 'FRESH', missedByMarket: false, whyItMatters: generateWhyItMatters(buildCompositeSignals(sigs), sigs),
        lastDate: new Date().toISOString(), articleCount: 0, alphaCount: sigs.filter(s=>s.isAlpha).length, noiseCount: sigs.filter(s=>!s.isAlpha).length,
        recentHeadlines: [{ title: 'Manual concall input', source: 'User paste', date: new Date().toISOString(), url: '' }],
      } as any;
      return [...prev, newEntry].sort((a,b)=>b.signalScore-a.signalScore);
    });
    setManualInput(''); setManualSymbol('');
    setManualParseStatus({type:'ok', msg:`✅ ${sigs.length} signal${sigs.length!==1?'s':''} extracted for ${sym}. Card updated above.`});
    setTimeout(() => { setShowManualInput(false); setManualParseStatus(null); }, 3000);
  }

  const displayed = showAlphaOnly ? summaries.filter(s=>s.alphaCount>0) : summaries;
  const toneColor = (t:string) => t.includes('Bull')?'#10b981':t==='Cautious'?'#ef4444':'#f59e0b';
  const freshColor = (f:string) => f==='FRESH'?'#10b981':f==='ACTIVE'?'#f59e0b':'#4A5B6C';
  const horizonColor = (h:string) => h==='0-3M'?'#ef4444':h==='3-6M'?'#f59e0b':h==='6-12M'?'#10b981':'#06b6d4';

  if (screenerStocks.length === 0) return (
    <div style={{textAlign:'center',padding:'60px 20px',color:TEXT3}}>
      <div style={{fontSize:40,marginBottom:12}}>🧠</div>
      <div style={{fontSize:16,fontWeight:700,color:TEXT1,marginBottom:8}}>No screener stocks loaded</div>
      <div style={{fontSize:13,color:TEXT3}}>Upload your Screener.in export in the Multibagger tab first. Concall Intelligence will automatically track your portfolio companies.</div>
    </div>
  );

  return (
    <div style={{padding:'0 0 20px'}}>
      {/* Header */}
      <div style={{padding:'16px 0 12px',borderBottom:`1px solid ${BORDER}`,marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:ACCENT2}}>🧠 Concall Intelligence — 30D Rolling Window</div>
            <div style={{fontSize:11,color:TEXT3,marginTop:2}}>
              Management signal extraction · MRI scoring · Signal vs Noise · {screenerStocks.length} companies tracked
              <span style={{color:'var(--mc-text-4)',marginLeft:8}}>
                ({screenerStocks.filter(s=>s.source==='Screener').length} Screener · {screenerStocks.filter(s=>s.source==='Watchlist').length} Watchlist · {screenerStocks.filter(s=>s.source==='Portfolio').length} Portfolio)
              </span>
            </div>
            <div style={{fontSize:10,color:'var(--mc-warn)',marginTop:4}}>
              💡 To add more stocks: in Screener.in click Export → downloads ALL results (all pages). Upload the CSV in Multibagger tab.
            </div>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={()=>setShowAlphaOnly(v=>!v)} style={{fontSize:11,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${showAlphaOnly?ACCENT2+'60':BORDER}`,background:showAlphaOnly?`${ACCENT2}18`:'transparent',color:showAlphaOnly?ACCENT2:TEXT3,cursor:'pointer'}}>
              ⭐ Alpha Only ({summaries.filter(s=>s.alphaCount>0).length})
            </button>
            <button onClick={()=>setShowManualInput(v=>!v)} style={{fontSize:11,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${showManualInput?'color-mix(in srgb, var(--mc-warn) 38%, transparent)':BORDER}`,background:showManualInput?`color-mix(in srgb, var(--mc-warn) 9%, transparent)`:'transparent',color:showManualInput?'var(--mc-warn)':TEXT3,cursor:'pointer'}}>
              📝 Paste Concall
            </button>
            <button onClick={fetchConcallData} disabled={loading} style={{fontSize:11,fontWeight:700,padding:'5px 12px',borderRadius:7,border:`1px solid ${BORDER}`,background:'transparent',color:TEXT3,cursor:'pointer'}}>
              {loading ? '⏳ Scanning...' : '↻ Refresh'}
            </button>
            {lastFetched && <span style={{fontSize:10,color:TEXT3}}>Updated {lastFetched}</span>}
          </div>
        </div>
        {/* Stats row */}
        {summaries.length > 0 && (
          <>
            <div style={{display:'flex',gap:16,marginTop:10,flexWrap:'wrap'}}>
              {[
                {label:'Companies tracked',value:summaries.length,color:ACCENT2},
                // PATCH 0065: surface fidelity counts so user sees coverage
                // quality at a glance — manual transcripts are the high-fidelity
                // source; news-only is the fallback.
                {label:'📝 Manual transcript',value:summaries.filter((s:any)=>s.fidelity_tier==='HIGH_MANUAL').length,color:'#10b981'},
                {label:'📰 News + alpha',value:summaries.filter((s:any)=>s.fidelity_tier==='MEDIUM_NEWS_ALPHA').length,color:'#22d3ee'},
                {label:'📰 News only',value:summaries.filter((s:any)=>s.fidelity_tier==='LOW_NEWS_ONLY').length,color:'#f59e0b'},
                {label:'📭 No coverage',value:summaries.filter((s:any)=>s.fidelity_tier==='NONE').length,color:'#64748b'},
                {label:'Improving',value:summaries.filter(s=>s.trend==='IMPROVING').length,color:'#10b981'},
                {label:'High surprise',value:summaries.filter(s=>s.surprisePotential==='HIGH').length,color:'#f59e0b'},
                {label:'Missed by market',value:summaries.filter(s=>s.missedByMarket).length,color:'#8b5cf6'},
              ].map(({label,value,color})=>(
                <div key={label} style={{textAlign:'center'}}>
                  <div style={{fontSize:18,fontWeight:900,color}}>{value}</div>
                  <div style={{fontSize:9,color:TEXT3}}>{label}</div>
                </div>
              ))}
            </div>
            {/* Sector breakdown strip */}
            {(() => {
              const bySector: Record<string,{count:number;alpha:number;improving:number}> = {};
              for (const s of summaries.filter(x=>x.alphaCount>0)) {
                const sec = (s.sector||'Unknown').replace(/&/g,'&').replace(/\s*\/\s*/g,'/').trim() || 'Other';
                if (!bySector[sec]) bySector[sec] = {count:0,alpha:0,improving:0};
                bySector[sec].count++;
                bySector[sec].alpha += s.alphaCount;
                if (s.trend==='IMPROVING') bySector[sec].improving++;
              }
              const sectorEntries = Object.entries(bySector).sort((a,b)=>b[1].alpha-a[1].alpha).slice(0,8);
              if (sectorEntries.length === 0) return null;
              return (
                <div style={{marginTop:10,display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                  <span style={{fontSize:9,fontWeight:700,color:TEXT3,letterSpacing:'0.5px'}}>SECTORS WITH SIGNALS:</span>
                  {sectorEntries.map(([sec,data])=>(
                    <span key={sec} style={{fontSize:9,fontWeight:700,padding:'3px 8px',borderRadius:5,
                      backgroundColor: data.improving > 0 ? 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)' : 'var(--mc-bg-4)',
                      color: data.improving > 0 ? 'var(--mc-bullish)' : TEXT3,
                      border: `1px solid ${data.improving > 0 ? 'color-mix(in srgb, var(--mc-bullish) 19%, transparent)' : 'var(--mc-bg-4)'}`,
                    }}>
                      {sec} · {data.alpha} signals{data.improving>0?` · ${data.improving}↑`:''}
                    </span>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ── Manual Concall Input — paste transcript / highlight text ── */}
      {showManualInput && (
        <div style={{marginBottom:14,padding:'14px 16px',backgroundColor:'color-mix(in srgb, var(--mc-warn) 3%, transparent)',border:'1px solid color-mix(in srgb, var(--mc-warn) 19%, transparent)',borderRadius:10}}>
          <div style={{fontSize:11,fontWeight:800,color:'var(--mc-warn)',marginBottom:8}}>
            📝 PASTE CONCALL HIGHLIGHTS — add transcript-level signals not in news articles
          </div>
          <div style={{fontSize:10,color:'var(--mc-text-4)',marginBottom:10}}>
            Paste raw concall text, investor presentation excerpts, or management commentary. The engine will extract signals and add to the relevant company.
          </div>
          <div style={{display:'flex',gap:8,marginBottom:8,flexWrap:'wrap'}}>
            <input value={manualSymbol} onChange={e=>setManualSymbol(e.target.value.toUpperCase())}
              placeholder="NSE Symbol (e.g. QPOWER)"
              style={{padding:'7px 12px',backgroundColor:'var(--mc-bg-1)',border:`1px solid ${BORDER}`,borderRadius:7,color:TEXT1,fontSize:12,width:180}}/>
            <button onClick={processManualInput} style={{padding:'7px 16px',borderRadius:7,border:'none',backgroundColor:'var(--mc-warn)',color:'#000',fontWeight:800,fontSize:12,cursor:'pointer'}}>
              Extract Signals →
            </button>
            <button onClick={()=>setShowManualInput(false)} style={{padding:'7px 12px',borderRadius:7,border:`1px solid ${BORDER}`,backgroundColor:'transparent',color:TEXT3,fontSize:12,cursor:'pointer'}}>
              Cancel
            </button>
          </div>
          <textarea value={manualInput} onChange={e=>setManualInput(e.target.value)}
            placeholder="Paste concall transcript highlights here...&#10;Example:&#10;'Insulator demand remains robust and we are operating at full capacity. We expect ₹300 crore order in the next few weeks. New capacity will go live in Q4 FY26. Commodity costs are being passed to customers so no near-term margin pressure.'"
            rows={6}
            style={{width:'100%',backgroundColor:'var(--mc-bg-1)',border:`1px solid ${BORDER}`,borderRadius:8,padding:'10px 12px',color:TEXT1,fontSize:12,resize:'vertical',boxSizing:'border-box',lineHeight:1.6}}
          />
          <div style={{fontSize:10,color:'var(--mc-text-4)',marginTop:6}}>
            💡 Signals extracted from this input are tagged as COMPANY origin with highest confidence. They are NOT from news articles — they are from management statements.
          </div>
          {/* Inline status feedback — replaces alert() */}
          {manualParseStatus && (
            <div style={{marginTop:8,padding:'8px 12px',borderRadius:7,
              backgroundColor: manualParseStatus.type==='ok'?'color-mix(in srgb, var(--mc-bullish) 8%, transparent)':manualParseStatus.type==='warn'?'color-mix(in srgb, var(--mc-warn) 8%, transparent)':'color-mix(in srgb, var(--mc-bearish) 8%, transparent)',
              border:`1px solid ${manualParseStatus.type==='ok'?'color-mix(in srgb, var(--mc-bullish) 19%, transparent)':manualParseStatus.type==='warn'?'color-mix(in srgb, var(--mc-warn) 19%, transparent)':'color-mix(in srgb, var(--mc-bearish) 19%, transparent)'}`,
              color: manualParseStatus.type==='ok'?'var(--mc-bullish)':manualParseStatus.type==='warn'?'var(--mc-warn)':'var(--mc-bearish)',
              fontSize:11, fontWeight:600,
            }}>
              {manualParseStatus.msg}
            </div>
          )}
        </div>
      )}

      {loading && summaries.length === 0 && (
        <div style={{textAlign:'center',padding:'40px 20px',color:TEXT3}}>
          <div style={{fontSize:28,marginBottom:8}}>⏳</div>
          <div style={{fontSize:13}}>Scanning {screenerStocks.length} companies for management signals...</div>
        </div>
      )}

      {/* Company signal cards — redesigned for maximum info density without expanding */}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {displayed.map(s => {
          const isExp = expandedSym === s.symbol;
          const gradeColor = (g:string|undefined) => ({
            'A+':'#10b981','A':'#34d399','B+':'#f59e0b','B':'#f97316','C':'#fb923c','D':'#ef4444'
          }[g||'']||TEXT3);
          const scoreColor = (n:number) => n>=70?'#10b981':n>=45?'#f59e0b':n>0?'#ef4444':'#334155';
          const bestSig = s.signals.find(sig=>sig.isAlpha&&sig.positive&&sig.origin==='COMPANY');
          const bestNegSig = s.signals.find(sig=>sig.isAlpha&&!sig.positive&&sig.origin==='COMPANY');
          const topHeadline = (s as any).recentHeadlines?.[0];
          const topNumerical = s.signals.find(sig=>sig.numerical)?.numerical;
          const borderColor = s.alphaCount>0
            ? (s.signalScore>=70?'#10b981':(s.trend==='DETERIORATING'?'#ef4444':'#a78bfa'))
            : BORDER;

          return (
            <div key={s.symbol} style={{
              backgroundColor:'var(--mc-bg-1)',
              border:`1px solid ${borderColor}50`,
              borderLeft:`3px solid ${borderColor}`,
              borderRadius:10, overflow:'hidden',
            }}>
              <button onClick={()=>setExpandedSym(isExp?null:s.symbol)} style={{width:'100%',textAlign:'left',background:'none',border:'none',cursor:'pointer',padding:'10px 14px 8px'}}>

                {/* ── ROW 1: Identity + Scores ── */}
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>

                  {/* Symbol + Grade */}
                  <div style={{flexShrink:0,minWidth:70}}>
                    <div style={{fontSize:13,fontWeight:800,color:TEXT1,letterSpacing:'-0.3px'}}>{s.symbol}</div>
                    <div style={{display:'flex',gap:4,alignItems:'center',marginTop:1}}>
                      {s.grade && <span style={{fontSize:8,fontWeight:700,color:gradeColor(s.grade),border:`1px solid ${gradeColor(s.grade)}40`,padding:'0px 4px',borderRadius:3}}>{s.grade}</span>}
                      {(s as any).source && (s as any).source !== 'Screener' && <span style={{fontSize:7,color:'var(--mc-text-4)',border:'1px solid var(--mc-bg-4)',padding:'0 3px',borderRadius:2}}>{(s as any).source}</span>}
                    </div>
                  </div>

                  {/* PATCH 0065: Fidelity tier badge — what kind of evidence drives this card */}
                  {(() => {
                    const ft = (s as any).fidelity_tier as string | undefined;
                    if (!ft) return null;
                    const cfg: Record<string, { label: string; color: string; bg: string }> = {
                      HIGH_MANUAL:        { label: '📝 manual', color: '#10b981', bg: '#10b98115' },
                      MEDIUM_NEWS_ALPHA:  { label: '📰 news+α',  color: '#22d3ee', bg: '#22d3ee15' },
                      LOW_NEWS_ONLY:      { label: '📰 news',    color: '#f59e0b', bg: '#f59e0b15' },
                      NONE:               { label: '📭 none',    color: '#64748b', bg: '#64748b15' },
                    };
                    const c = cfg[ft] ?? cfg.NONE;
                    const titleText = ft === 'HIGH_MANUAL'
                      ? `Manual transcript pasted${(s as any).manual_paste_iso ? ' on ' + new Date((s as any).manual_paste_iso).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : ''}. ${(s as any).manual_signals_count} signals from concall text. HIGH fidelity.`
                      : ft === 'MEDIUM_NEWS_ALPHA' ? `${s.articleCount} news articles with ${s.alphaCount} alpha signals. MEDIUM fidelity. Paste a real concall transcript for HIGH fidelity.`
                      : ft === 'LOW_NEWS_ONLY'    ? `${s.articleCount} news articles, no alpha signals. LOW fidelity. Paste concall transcript for higher confidence.`
                      : 'No coverage. Paste a concall transcript to populate.';
                    return (
                      <span title={titleText} style={{
                        flexShrink: 0, fontSize: 9, fontWeight: 700, padding: '2px 6px',
                        borderRadius: 4, color: c.color, backgroundColor: c.bg,
                        border: `1px solid ${c.color}40`, letterSpacing: '0.3px',
                      }}>
                        {c.label}
                      </span>
                    );
                  })()}

                  {/* Company + Sector */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:11,fontWeight:600,color:'var(--mc-text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.company}</div>
                    <div style={{fontSize:8,color:'var(--mc-text-4)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.sector||'—'}</div>
                  </div>

                  {/* Right: compact metrics strip */}
                  <div style={{display:'flex',gap:10,alignItems:'center',flexShrink:0}}>
                    {/* Signal score */}
                    <div style={{textAlign:'center',minWidth:32}}>
                      <div style={{fontSize:15,fontWeight:900,lineHeight:1,color:scoreColor(s.signalScore)}}>{s.articleCount===0?'—':s.signalScore}</div>
                      <div style={{fontSize:7,color:TEXT3,marginTop:1}}>SIG</div>
                    </div>
                    {/* MRI with bar */}
                    <div style={{textAlign:'center',minWidth:36}}>
                      <div style={{fontSize:12,fontWeight:700,color:s.mriScore>=70?'var(--mc-bullish)':s.mriScore===50?TEXT3:'var(--mc-warn)',lineHeight:1}}>{s.mriScore===50&&s.articleCount===0?'—':s.mriScore}</div>
                      <div style={{width:32,height:2,backgroundColor:'var(--mc-bg-4)',borderRadius:1,marginTop:2,overflow:'hidden'}}>
                        {s.articleCount>0&&<div style={{height:'100%',width:`${s.mriScore}%`,backgroundColor:s.mriScore>=70?'var(--mc-bullish)':s.mriScore>=50?'var(--mc-warn)':'var(--mc-bearish)',borderRadius:1}} />}
                      </div>
                      <div style={{fontSize:7,color:TEXT3}}>MRI</div>
                    </div>
                    {/* Trend + articles */}
                    <div style={{textAlign:'center',minWidth:40}}>
                      <div style={{fontSize:11,fontWeight:700,color:s.trend==='IMPROVING'?'var(--mc-bullish)':s.trend==='DETERIORATING'?'var(--mc-bearish)':s.trend==='UNKNOWN'?'#334155':'var(--mc-warn)'}}>
                        {s.trend==='IMPROVING'?'↑':s.trend==='DETERIORATING'?'↓':s.trend==='UNKNOWN'?'·':'→'} {s.trend==='UNKNOWN'?'—':s.trend.slice(0,4)}
                      </div>
                      <div style={{fontSize:7,color:TEXT3}}>{s.articleCount} art.</div>
                    </div>
                    {/* Freshness dot */}
                    <div style={{width:8,height:8,borderRadius:'50%',backgroundColor:s.freshness==='FRESH'?'var(--mc-bullish)':s.freshness==='ACTIVE'?'var(--mc-warn)':'#334155',flexShrink:0}} title={s.freshness} />
                    {/* Expand chevron */}
                    <span style={{fontSize:10,color:'#334155',marginLeft:2}}>{isExp?'▲':'▼'}</span>
                  </div>
                </div>

                {/* ── ROW 2: Signal evidence OR article headline — THE KEY INFO ROW ── */}
                <div style={{borderTop:'1px solid color-mix(in srgb, var(--mc-bg-4) 19%, transparent)',paddingTop:6}}>
                  {s.alphaCount > 0 && bestSig ? (
                    // HAS SIGNALS: show the best signal with evidence text
                    <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                      {/* Signal type pill */}
                      <span style={{
                        fontSize:8,fontWeight:800,flexShrink:0,marginTop:1,
                        padding:'1px 6px',borderRadius:4,
                        color:bestSig.positive?'var(--mc-bullish)':'var(--mc-bearish)',
                        backgroundColor:(bestSig.positive?'color-mix(in srgb, var(--mc-bullish) 8%, transparent)':'color-mix(in srgb, var(--mc-bearish) 8%, transparent)'),
                        border:`1px solid ${bestSig.positive?'color-mix(in srgb, var(--mc-bullish) 19%, transparent)':'color-mix(in srgb, var(--mc-bearish) 19%, transparent)'}`,
                        whiteSpace:'nowrap',
                      }}>
                        {bestSig.positive?'↑':'↓'} {(bestSig.subject||bestSig.type.replace(/_/g,' ')).slice(0,20)}
                        {topNumerical?` ₹${topNumerical.value}Cr`:''}
                      </span>
                      {/* Evidence text — the actual signal sentence */}
                      <div style={{flex:1,fontSize:10,color:'var(--mc-text-3)',lineHeight:1.4,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',textOverflow:'ellipsis'}}>
                        {bestSig.text && bestSig.text.length > 8
                          ? `"${bestSig.text.slice(0,120)}${bestSig.text.length>120?'…':'"'}`
                          : topHeadline?.title?.slice(0,100) || 'Expand for details'
                        }
                      </div>
                      {/* Negative signal warning if any */}
                      {bestNegSig && (
                        <span style={{fontSize:8,fontWeight:700,flexShrink:0,padding:'1px 5px',borderRadius:3,color:'var(--mc-bearish)',backgroundColor:'color-mix(in srgb, var(--mc-bearish) 6%, transparent)',border:'1px solid color-mix(in srgb, var(--mc-bearish) 15%, transparent)'}}>
                          ⚠ {(bestNegSig.subject||bestNegSig.type).replace(/_/g,' ').slice(0,12)}
                        </span>
                      )}
                    </div>
                  ) : s.articleCount > 0 && topHeadline ? (
                    // HAS ARTICLES BUT NO SIGNALS: show the latest article headline
                    <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                      <span style={{fontSize:8,flexShrink:0,color:'#334155',marginTop:1}}>📰</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:10,color:'var(--mc-text-4)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          {topHeadline.title.slice(0,100)}{topHeadline.title.length>100?'…':''}
                        </div>
                        <div style={{fontSize:8,color:'#334155',marginTop:1}}>
                          {topHeadline.source} · {topHeadline.date?new Date(topHeadline.date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):''}
                          <span style={{marginLeft:8,color:'var(--mc-text-4)'}}>{s.articleCount} article{s.articleCount!==1?'s':''}, 0 signals — expand to see all</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // PATCH 0054 + 0065: 0 ARTICLES — actionable empty state
                    // with click-to-prefill manual-paste flow. Clicking the
                    // CTA opens the panel AND fills in the symbol.
                    <div style={{fontSize:9,color:'var(--mc-text-4)',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                      <span>📭 No news + no concall transcript for {s.symbol}.</span>
                      <span
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setManualSymbol(s.symbol);
                          setShowManualInput(true);
                          // Scroll to top so the paste form is visible
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={{color:'var(--mc-accent)',fontWeight:600,cursor:'pointer',textDecoration:'underline'}}
                      >
                        ↑ Click here to paste {s.symbol}'s concall transcript →
                      </span>
                    </div>
                  )}
                </div>
              </button>

              {isExp && (
                <div style={{padding:'0 16px 16px',borderTop:`1px solid ${BORDER}`}}>
                  {s.signals.length === 0 ? (
                    // PATCH 0054 + 0065: actionable empty state with prefilled
                    // manual-paste CTA (clicks open the panel + sets symbol).
                    <div style={{padding:'16px 0',color:TEXT3,fontSize:11,textAlign:'left'}}>
                      <div style={{marginBottom:8,color:'var(--mc-text-3)',fontWeight:600}}>
                        {s.articleCount === 0 ? '📭 No coverage in 30D window' : `📰 ${s.articleCount} article${s.articleCount !== 1 ? 's' : ''} found, but none matched a forward-looking management signal`}
                      </div>
                      <div style={{color:'var(--mc-text-4)',fontSize:10,lineHeight:1.5,marginBottom:10}}>
                        Concall Intel processes earnings news AND optional concall transcripts. News headlines often use past tense
                        ('reported', 'achieved') which makes them low-confidence signals. <strong style={{color:'var(--mc-text-3)'}}>For a high-fidelity read</strong>, paste
                        the latest earnings call transcript (Q4 / Q3 of FY26). Manual transcripts give 5–10× more actionable signals than news-only coverage.
                      </div>
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setManualSymbol(s.symbol);
                          setShowManualInput(true);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        style={{
                          fontSize: 11, fontWeight: 700, padding: '6px 14px', borderRadius: 7,
                          border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', backgroundColor: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)',
                          color: 'var(--mc-bullish)', cursor: 'pointer',
                        }}
                      >
                        📝 Paste {s.symbol}'s concall transcript
                      </button>
                    </div>
                  ) : (
                    <div style={{marginTop:12}}>

                      {/* ── ARTICLE HEADLINES (always shown when articles exist) ── */}
                      {(s as any).recentHeadlines?.length > 0 && (
                        <div style={{marginBottom:14,padding:'10px 12px',backgroundColor:'#060E1A',border:'1px solid var(--mc-bg-4)',borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:800,color:'var(--mc-text-4)',letterSpacing:'1px',marginBottom:8}}>
                            📰 RECENT NEWS ({s.articleCount} article{s.articleCount!==1?'s':''} found for {s.company})
                            {s.alphaCount === 0 && <span style={{color:'var(--mc-warn)',marginLeft:6}}>— no actionable management signals detected yet</span>}
                          </div>
                          <div style={{display:'flex',flexDirection:'column',gap:5}}>
                            {(s as any).recentHeadlines.map((h: {title:string;source:string;date:string;url?:string}, hi: number) => (
                              <div key={hi} style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                                <span style={{fontSize:10,color:'#334155',flexShrink:0}}>›</span>
                                <div style={{flex:1,minWidth:0}}>
                                  {h.url ? (
                                    <a href={h.url} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'var(--mc-text-3)',lineHeight:1.4,textDecoration:'none',display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                                      {h.title}
                                    </a>
                                  ) : (
                                    <span style={{fontSize:11,color:'var(--mc-text-3)',lineHeight:1.4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{h.title}</span>
                                  )}
                                  <span style={{fontSize:9,color:'#334155'}}>{h.source}{h.date?' · '+new Date(h.date).toLocaleDateString('en-IN',{day:'numeric',month:'short'}):''}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {s.alphaCount === 0 && (
                            <div style={{marginTop:8,padding:'6px 8px',backgroundColor:'color-mix(in srgb, var(--mc-warn) 3%, transparent)',border:'1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)',borderRadius:5}}>
                              <span style={{fontSize:9,color:'var(--mc-warn)'}}>💡 To extract signals: paste the earnings call transcript in "📝 Paste Concall" above → instant signal extraction.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* No articles at all — explain why and what to do */}
                      {s.articleCount === 0 && (
                        <div style={{marginBottom:14,padding:'10px 12px',backgroundColor:'#060E1A',border:'1px solid var(--mc-bg-4)',borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:800,color:'#334155',marginBottom:6}}>📭 NO NEWS FOUND IN LAST 30 DAYS</div>
                          <div style={{fontSize:10,color:'var(--mc-text-4)',lineHeight:1.6}}>
                            No articles matching <strong style={{color:'var(--mc-text-4)'}}>{s.company}</strong> in the news database.
                            This can happen when: (1) the company uses a different name in press coverage,
                            (2) no significant news in 30 days, or (3) stock is too small for mainstream coverage.
                          </div>
                          <div style={{marginTop:8,padding:'6px 8px',backgroundColor:'color-mix(in srgb, var(--mc-accent) 3%, transparent)',border:'1px solid color-mix(in srgb, var(--mc-accent) 13%, transparent)',borderRadius:5}}>
                            <span style={{fontSize:9,color:'var(--mc-accent)'}}>💡 Use "📝 Paste Concall" above to directly paste earnings call highlights for this company.</span>
                          </div>
                        </div>
                      )}

                      {/* ── SIGNAL STACK (composite across articles) ── */}
                      {(s as any).composite && (s as any).composite.length > 0 && (
                        <div style={{marginBottom:14,padding:'12px 14px',backgroundColor:'#0A0F1A',border:'1px solid color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)',borderRadius:8}}>
                          <div style={{fontSize:10,fontWeight:800,color:ACCENT2,letterSpacing:'1px',marginBottom:8}}>📊 SIGNAL STACK — composite view across all articles</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            {(s as any).composite.map((c: CompositeSignal, ci: number) => {
                              const dc = c.direction==='UP'?'#10b981':c.direction==='DOWN'?'#ef4444':'#f59e0b';
                              return (
                                <div key={ci} style={{padding:'6px 10px',backgroundColor:dc+'10',border:`1px solid ${dc}30`,borderRadius:6,minWidth:90}}>
                                  <div style={{fontSize:10,fontWeight:700,color:dc}}>{c.direction==='UP'?'↑':c.direction==='DOWN'?'↓':'→'} {c.label}</div>
                                  <div style={{fontSize:8,color:'var(--mc-text-4)'}}>{c.count} signal{c.count!==1?'s':''} · str:{c.strength}/5</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── WHY IT MATTERS ── */}
                      {(s as any).whyItMatters && (
                        <div style={{marginBottom:14,padding:'10px 14px',backgroundColor:'color-mix(in srgb, var(--mc-warn) 3%, transparent)',border:'1px solid color-mix(in srgb, var(--mc-warn) 13%, transparent)',borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:800,color:'var(--mc-warn)',marginBottom:4}}>💡 WHY THIS MATTERS FOR YOUR POSITION</div>
                          <div style={{fontSize:11,color:'var(--mc-text-2)',lineHeight:1.5}}>{(s as any).whyItMatters}</div>
                        </div>
                      )}

                      {/* ── MISSED BY MARKET ── */}
                      {(s as any).missedByMarket && (
                        <div style={{marginBottom:14,padding:'10px 14px',backgroundColor:'color-mix(in srgb, var(--mc-state-persistent) 3%, transparent)',border:'1px solid color-mix(in srgb, var(--mc-state-persistent) 19%, transparent)',borderRadius:8}}>
                          <div style={{fontSize:10,fontWeight:800,color:'var(--mc-state-persistent)',marginBottom:4}}>🔍 POTENTIALLY MISSED BY MARKET</div>
                          <div style={{fontSize:11,color:'var(--mc-text-3)'}}>Strong alpha signals ({s.alphaCount}) found but only {s.articleCount} article(s) — low coverage suggests market hasn't fully priced this yet. Verify independently before acting.</div>
                        </div>
                      )}

                      {/* Alpha signals — split by origin: COMPANY vs SECTOR */}
                      {s.signals.filter(sig=>sig.isAlpha).length > 0 && (
                        <div style={{marginBottom:12}}>
                          {/* Company-specific signals */}
                          {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='COMPANY').length > 0 && (
                            <div style={{marginBottom:10}}>
                              <div style={{fontSize:10,fontWeight:800,color:'var(--mc-bullish)',letterSpacing:'1px',marginBottom:6}}>🏢 COMPANY SIGNALS — confirmed for {s.symbol}</div>
                              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='COMPANY').map((sig,i)=>(
                                  <SignalCard key={i} sig={sig} horizonColor={horizonColor} />
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Sector signals */}
                          {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='SECTOR').length > 0 && (
                            <div style={{marginBottom:10}}>
                              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                                <div style={{fontSize:10,fontWeight:800,color:'#06b6d4',letterSpacing:'1px'}}>🌍 SECTOR CONTEXT — does NOT affect score</div>
                                <span style={{fontSize:9,color:'var(--mc-text-4)',border:'1px solid var(--mc-bg-4)',padding:'1px 6px',borderRadius:3}}>Informational only</span>
                              </div>
                              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {s.signals.filter(sig=>sig.isAlpha&&sig.origin==='SECTOR').map((sig,i)=>{
                                  const sd = (sig as any).sectorDef as (SectorSignalDef|undefined);
                                  return (
                                    <div key={i} style={{padding:'10px 12px',backgroundColor:'#06b6d408',border:'1px solid #06b6d420',borderLeft:'3px solid #06b6d4',borderRadius:7}}>
                                      <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:4,flexWrap:'wrap'}}>
                                        <span style={{fontSize:11,fontWeight:800,color:'#06b6d4'}}>🌍 {sig.subject}</span>
                                        {sd && <span style={{fontSize:9,color:'var(--mc-text-4)',fontStyle:'italic'}}>driven by: {sd.driver}</span>}
                                        <span style={{fontSize:8,color:'var(--mc-text-4)',marginLeft:'auto'}}>{sig.date?new Date(sig.date).toLocaleDateString('en-IN'):''}</span>
                                      </div>
                                      {sd && <div style={{fontSize:10,color:'var(--mc-accent)',marginBottom:4}}>→ {sd.impact}</div>}
                                      {sig.text && sig.text.length >= 15 ? (
                                        <div style={{fontSize:11,color:'var(--mc-text-3)',lineHeight:1.5,backgroundColor:'#060E1A',padding:'5px 9px',borderRadius:5,borderLeft:'2px solid #06b6d430',marginBottom:3}}>
                                          "{sig.text}"
                                        </div>
                                      ) : (
                                        <div style={{fontSize:10,color:'var(--mc-warn)'}}>⚠ No direct evidence — sector inference only</div>
                                      )}
                                      <div style={{fontSize:9,color:'var(--mc-text-4)'}}>📰 {sig.source}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {/* Negative alpha */}
                          {s.signals.filter(sig=>sig.isAlpha&&!sig.positive).length > 0 && (
                            <div>
                              <div style={{fontSize:10,fontWeight:800,color:'var(--mc-bearish)',letterSpacing:'1px',marginBottom:6}}>⚠ RISK SIGNALS</div>
                              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {s.signals.filter(sig=>sig.isAlpha&&!sig.positive).map((sig,i)=>(
                                  <SignalCard key={i} sig={sig} horizonColor={horizonColor} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Noise signals */}
                      {s.signals.filter(sig=>!sig.isAlpha).length > 0 && (
                        <div>
                          <div style={{fontSize:10,fontWeight:800,color:TEXT3,letterSpacing:'1px',marginBottom:6}}>📰 NOISE SIGNALS — 1-5D relevance only</div>
                          <div style={{display:'flex',flexDirection:'column',gap:4}}>
                            {s.signals.filter(sig=>!sig.isAlpha).map((sig,i)=>(
                              <div key={i} style={{padding:'7px 10px',backgroundColor:'var(--mc-bg-4)',borderRadius:6,fontSize:10,color:'var(--mc-text-3)'}}>
                                <span style={{fontWeight:600,color:sig.positive?'var(--mc-bullish)':'var(--mc-bearish)'}}>{sig.type.replace(/_/g,' ')}</span>: {sig.text.slice(0,80)}...
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {summaries.length === 0 && !loading && (
        <div style={{textAlign:'center',padding:'40px 20px',color:TEXT3}}>
          <div style={{fontSize:30,marginBottom:8}}>🔍</div>
          <div style={{fontSize:13,fontWeight:600,color:TEXT1,marginBottom:6}}>No management signals found in last 30 days</div>
          <div style={{fontSize:11,color:TEXT3}}>Your screener stocks have {screenerStocks.length} companies loaded. Try refreshing or check back after earnings season.</div>
        </div>
      )}
    </div>
  );
}
