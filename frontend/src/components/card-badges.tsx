// ═══════════════════════════════════════════════════════════════════════════
// THE BADGE ROW IS NOW OPT-IN, ON BOTH MARKETS.                     (zzz696)
//
// A card carried up to fourteen chips before the first number: the quadrant
// and its two scores, the quarter, the sector, the market cap, the EPS beat,
// two guidance chips, ELITE, MULTIBAGGER, Rule of 40, ROCE, SETUP and PEAD.
// Every one of them is a real output and each was added for a reason — and
// together they push revenue, margin and cash, which is what the card is FOR,
// a full row further down the page. On a screen of twenty cards that is a
// wall of colour to read past twenty times.
//
// So they are hidden by default and shown on request. One switch, one stored
// preference, both markets — India and US read the same key, because a reader
// who wants a quiet card wants it quiet on both tabs, and two independent
// toggles is a setting you have to remember to set twice.
//
// WHAT IS NEVER HIDDEN, and why the switch is not simply "hide that row":
//
//   · the TIER. On the US bench the tier chip is the first of `extraChips`
//     and sits in this row; on the Opportunities tab it is the section
//     heading above the card. It is the verdict, not a badge.
//   · PRELIM · GAAP pending. That is not a label, it is a warning that the
//     figures on the card are provisional and the cash flow has not arrived.
//     Hiding a caveat to reduce clutter is how a reader ends up trusting a
//     number the engine already doubted.
//   · the PRICE on the India card, which shares the same row.
//
// The state lives in one module-level store rather than in each card, so
// twenty cards flip together on one click instead of twenty re-reads of
// localStorage. `useSyncExternalStore` gives the server the same answer it
// gives the first client render — hidden — so the markup matches and there is
// no hydration flash of a row that is about to disappear.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useSyncExternalStore, useCallback } from 'react';

const KEY = 'mc.cardBadges.v1';

/** Hidden until the reader asks for them. */
const DEFAULT_SHOWN = false;

let _shown: boolean | null = null;          // null = not yet read from storage
const _listeners = new Set<() => void>();

function read(): boolean {
  if (_shown !== null) return _shown;
  // A blocked or empty localStorage is not an error here — it just means the
  // reader has no stored preference yet, which is the default.
  try {
    const v = window.localStorage.getItem(KEY);
    _shown = v === null ? DEFAULT_SHOWN : v === '1';
  } catch {
    _shown = DEFAULT_SHOWN;
  }
  return _shown;
}

function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  // Another tab changing the preference should move this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    _shown = e.newValue === null ? DEFAULT_SHOWN : e.newValue === '1';
    _listeners.forEach((l) => l());
  };
  window.addEventListener('storage', onStorage);
  return () => {
    _listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/** True when the badge chips should render. Safe to call from any card. */
export function useCardBadges(): [boolean, (next: boolean) => void] {
  const shown = useSyncExternalStore(subscribe, read, () => DEFAULT_SHOWN);
  const set = useCallback((next: boolean) => {
    _shown = next;
    try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* preference is a convenience, never load-bearing */ }
    _listeners.forEach((l) => l());
  }, []);
  return [shown, set];
}

/** The switch. Same control on the India and US toolbars. */
export function CardBadgesToggle({ compact = false }: { compact?: boolean }) {
  const [shown, set] = useCardBadges();
  return (
    <button
      type="button"
      onClick={() => set(!shown)}
      aria-pressed={shown}
      title={
        shown
          ? 'Hide the badge chips — quadrant, quarter, sector, market cap, beat, guidance, ELITE / MULTIBAGGER / R40 / ROCE / SETUP / PEAD. The tier, any PRELIM warning and the price always stay.'
          : 'Show the badge chips — quadrant, quarter, sector, market cap, beat, guidance, ELITE / MULTIBAGGER / R40 / ROCE / SETUP / PEAD. Hidden by default so the numbers come first.'
      }
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        fontSize: compact ? 10 : 11, fontWeight: 700,
        padding: compact ? '3px 8px' : '4px 10px', borderRadius: 999,
        border: `1px solid ${shown ? 'color-mix(in srgb, var(--mc-cyan) 45%, transparent)' : 'var(--mc-bg-4)'}`,
        backgroundColor: shown ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'var(--mc-bg-1)',
        color: shown ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22, height: 12, borderRadius: 999, position: 'relative', flexShrink: 0,
          backgroundColor: shown ? 'var(--mc-cyan)' : 'var(--mc-bg-4)',
          transition: 'background-color 120ms ease',
        }}
      >
        <span
          style={{
            position: 'absolute', top: 2, left: shown ? 12 : 2,
            width: 8, height: 8, borderRadius: 999, backgroundColor: 'var(--mc-bg-0, #0B1220)',
            transition: 'left 120ms ease',
          }}
        />
      </span>
      {shown ? 'Badges on' : 'Badges off'}
    </button>
  );
}
