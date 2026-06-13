// ─── Unified price-source factory ───────────────────────────────────────────
// 10y-ops Section 7.3: lets ops flip the price source via env var alone,
// no code change. Three modes:
//
//   PRICE_SOURCE=yahoo     — original Yahoo Finance scrape (default)
//   PRICE_SOURCE=bhavcopy  — NSE bhavcopy only (current_price, prev_close,
//                            gap_pct, d1_pct — no 52w/MAs/RS rating)
//   PRICE_SOURCE=hybrid    — bhavcopy primary; fall back to Yahoo whenever
//                            bhavcopy fails the day's fetch. Best reliability.
//
// The "right" long-term answer is hybrid: bhavcopy gives canonical NSE EOD
// (no scrape risk) and Yahoo backfills the trailing-1y derived fields. When
// Yahoo dies we lose only the MA/52w overlay; we don't lose today's price.

import { CanonicalEvent } from '../types.js';
import { enrichWithPrices } from './yahoo-price.js';
import { enrichWithBhavcopy } from './nse-bhavcopy.js';

export type PriceSourceMode = 'yahoo' | 'bhavcopy' | 'hybrid';

function readMode(): PriceSourceMode {
  const raw = (process.env.PRICE_SOURCE || 'yahoo').toLowerCase();
  if (raw === 'bhavcopy' || raw === 'hybrid') return raw;
  return 'yahoo';
}

export async function enrichPriceUnified(
  events: CanonicalEvent[],
  opts?: { budgetMs?: number },
): Promise<CanonicalEvent[]> {
  const mode = readMode();
  console.log(`[price-source] mode=${mode}, events=${events.length}`);

  if (mode === 'yahoo') {
    return enrichWithPrices(events, opts);
  }

  if (mode === 'bhavcopy') {
    return enrichWithBhavcopy(events);
  }

  // hybrid: bhavcopy first (fast, canonical for today), then overlay Yahoo
  // for the trailing-1y fields. If bhavcopy fails entirely, fall through to
  // Yahoo so we don't ship empty.
  let stage = events;
  try {
    stage = await enrichWithBhavcopy(events);
    const withPrice = stage.filter((e) => (e as any).current_price != null).length;
    console.log(`[price-source] hybrid: bhavcopy filled ${withPrice}/${events.length}`);
  } catch (e: any) {
    console.warn(`[price-source] hybrid: bhavcopy failed (${e?.message || e}), pure Yahoo`);
    return enrichWithPrices(events, opts);
  }

  // Yahoo overlay — only adds the fields bhavcopy didn't fill (52w, MAs, RS)
  try {
    const yahoo = await enrichWithPrices(stage, opts);
    // Merge: keep bhavcopy fields where present, take Yahoo fields where bhavcopy is null
    return stage.map((bhav, i) => {
      const y = yahoo[i] as any;
      const b = bhav as any;
      return {
        ...y,
        // bhavcopy fields take precedence — they're canonical NSE
        current_price: b.current_price ?? y.current_price ?? null,
        prev_close: b.prev_close ?? y.prev_close ?? null,
        gap_pct: b.gap_pct ?? y.gap_pct ?? null,
        d1_pct: b.d1_pct ?? y.d1_pct ?? null,
        price_scraped_at: b.price_scraped_at ?? y.price_scraped_at,
      };
    });
  } catch (e: any) {
    console.warn(`[price-source] hybrid: Yahoo overlay failed (${e?.message || e}), returning bhavcopy-only`);
    return stage;
  }
}
