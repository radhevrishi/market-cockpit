'use client';

// ═══════════════════════════════════════════════════════════════════════════
// DESK CHROME — THE SHARED FURNITURE OF A TERMINAL  (zzz653)
//
// Every one of these pages opens with four lines of prose explaining what the
// page is. The writing is good and the explanation is worth having — but it is
// DOCUMENTATION, and documentation at the top of a screen costs the reader the
// thing they actually came for. On the Conviction Beats tab, two hundred and
// fifty pixels of preamble and filter furniture sat above the first number.
//
// A terminal is read by somebody who already knows what the page is and has
// ninety seconds. It opens with STATE — what is true right now, in one line
// of figures — and keeps the explanation one click away for the day they need
// it. Nothing is deleted; it is demoted, which is a different thing and the
// reason this is a component rather than a delete.
//
// Two pieces:
//   · DeskHeader — title, live state as a row of labelled figures, and the
//     explanation folded behind an ⓘ that remembers whether it was open.
//   · deskNumerals — tabular figures. In a proportional font "1" is narrower
//     than "8", so a column of returns never lines up and the eye cannot scan
//     it. One CSS property fixes it and it is the single largest difference
//     between a page that looks like a dashboard and one that looks like a
//     terminal.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useEffect, useState } from 'react';

/** Put this on a page container. Every figure inside it becomes fixed-width,
 *  so columns of numbers align down the screen without a table. */
export const deskNumerals: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum" 1, "lnum" 1',
};

export interface DeskStat {
  /** The figure itself — kept short. A stat that needs a sentence is a note. */
  value: React.ReactNode;
  /** What it counts, in lower case. The value carries the emphasis. */
  label: string;
  color?: string;
  /** The full explanation, on hover. Everything the label had to leave out. */
  hint?: string;
  onClick?: () => void;
}

export function DeskHeader({
  icon, title, tagline, stats, about, storageKey, right,
}: {
  icon?: string;
  title: string;
  /** One short line, always visible — the page's standing claim. */
  tagline?: string;
  /** The state of the page right now, as figures. This is what replaces the
   *  paragraph: a reader learns more from "274 on the bench · 36 aligned" than
   *  from any sentence describing what a bench is. */
  stats?: DeskStat[];
  /** The prose that used to sit here, now behind the ⓘ. */
  about?: React.ReactNode;
  /** Remembering the toggle per page, so somebody who wants the explanation
   *  permanently open is not made to re-open it every visit. */
  storageKey?: string;
  right?: React.ReactNode;
}) {
  const [showAbout, setShowAbout] = useState(false);
  useEffect(() => {
    if (!storageKey) return;
    try { setShowAbout(localStorage.getItem(`mc-about-${storageKey}`) === '1'); } catch { /* private mode */ }
  }, [storageKey]);
  const toggleAbout = () => {
    setShowAbout((v) => {
      const n = !v;
      if (storageKey) { try { localStorage.setItem(`mc-about-${storageKey}`, n ? '1' : '0'); } catch { /* private mode */ } }
      return n;
    });
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, fontWeight: 900, color: 'var(--mc-text-0)', letterSpacing: -0.2, margin: 0 }}>
          {icon ? `${icon} ` : ''}{title}
        </h1>
        {tagline && (
          <span style={{ fontSize: 10.5, color: 'var(--mc-text-3)', border: '1px solid var(--mc-bg-4)', borderRadius: 20, padding: '2px 10px', whiteSpace: 'nowrap' }}>
            {tagline}
          </span>
        )}
        <button onClick={toggleAbout} title={showAbout ? 'Hide the explanation' : 'What is this page, and what are its rules?'}
          aria-expanded={showAbout}
          style={{
            fontSize: 10.5, fontWeight: 800, cursor: 'pointer', borderRadius: 20, padding: '2px 9px',
            border: `1px solid ${showAbout ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
            background: showAbout ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'transparent',
            color: showAbout ? 'var(--mc-cyan)' : 'var(--mc-text-3)',
          }}>
          ⓘ {showAbout ? 'hide' : 'about'}
        </button>
        <span style={{ flex: 1 }} />
        {right}
      </div>

      {/* ── STATE, AS FIGURES ──────────────────────────────────────────────
          The row a reader's eye lands on. Deliberately not cards: cards imply
          each number is a destination, and these are a sentence made of
          numbers meant to be read across in one pass. */}
      {stats && stats.length > 0 && (
        <div style={{
          ...deskNumerals,
          display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline',
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--mc-bg-4)',
        }}>
          {stats.map((s, i) => (
            <span key={i} title={s.hint} onClick={s.onClick}
              style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, cursor: s.onClick ? 'pointer' : s.hint ? 'help' : undefined }}>
              <b style={{ fontSize: 15, fontWeight: 900, color: s.color || 'var(--mc-text-0)', fontFamily: 'ui-monospace,monospace' }}>{s.value}</b>
              <span style={{ fontSize: 10.5, color: 'var(--mc-text-3)' }}>{s.label}</span>
            </span>
          ))}
        </div>
      )}

      {showAbout && about && (
        <div style={{
          marginTop: 9, padding: '10px 12px', borderRadius: 'var(--mc-radius)',
          background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
          fontSize: 11.5, color: 'var(--mc-text-2)', lineHeight: 1.65, maxWidth: 980,
        }}>
          {about}
        </div>
      )}
    </div>
  );
}
