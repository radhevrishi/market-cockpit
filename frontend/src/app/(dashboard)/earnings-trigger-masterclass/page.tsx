'use client';

// ═══════════════════════════════════════════════════════════════════════════
// EARNINGS TRIGGER MASTERCLASS — PATCH 1076
//
// Renders the 17-chapter "Why Some Q-Beats Become Multibaggers and Other
// Beats Get Punished" playbook in a dark-theme reader with:
//   • sticky TOC with chapter jumps + reading progress
//   • numbered chapter cards
//   • dot-leader callout boxes for the "ACTION RULE" blocks
//   • print-friendly via the existing design-system print stylesheet
//
// The source markdown lives at /public/playbooks/earnings-trigger-
// masterclass.md so a) the page bundle stays slim and b) the doc can be
// updated independently of code releases.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';

interface Chapter {
  id: string;
  num: string;          // "1", "2.1" etc.
  title: string;
  blocks: Block[];
}
interface Block {
  kind: 'h2' | 'h3' | 'p' | 'callout' | 'quote' | 'hr';
  text: string;
}

const SOURCE_URL = '/playbooks/earnings-trigger-masterclass.md';

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parse(md: string): Chapter[] {
  const lines = md.split('\n');
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  let buf: string[] = [];

  const flushPara = () => {
    if (buf.length === 0) return;
    const text = buf.join(' ').trim();
    buf = [];
    if (!text || !current) return;
    // Detect "ACTION RULE" callouts (all-caps prefix then text).
    if (/^[A-Z'A-Z][A-Z'\s]{3,40}\s+(RULE|ACTION RULE)\b/.test(text)) {
      current.blocks.push({ kind: 'callout', text });
    } else if (/^\*['"‘’].*[.!?‘’]\*\s*$/.test(text)) {
      current.blocks.push({ kind: 'quote', text });
    } else {
      current.blocks.push({ kind: 'p', text });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';

    // h2 = "**Chapter N • Title**" followed by "===="
    if (/^\*\*Chapter\s+\d+/i.test(line) && /^=+\s*$/.test(next)) {
      flushPara();
      if (current) chapters.push(current);
      const titleClean = line.replace(/\*\*/g, '').trim();
      const m = titleClean.match(/^Chapter\s+(\d+)\s*[•·-]\s*(.+)$/i);
      const num = m ? m[1] : String(chapters.length + 1);
      const title = m ? m[2] : titleClean;
      current = { id: slug(`chapter-${num}-${title}`), num, title, blocks: [] };
      i++; // skip the ==== line
      continue;
    }

    // h3 = "**N.M Subtitle**" followed by "----"
    if (/^\*\*\d+\.\d+/.test(line) && /^-{2,}\s*$/.test(next)) {
      flushPara();
      const titleClean = line.replace(/\*\*/g, '').trim();
      const m = titleClean.match(/^(\d+\.\d+)\s*[—\-•·]?\s*(.+)$/);
      if (current && m) {
        current.blocks.push({ kind: 'h3', text: `${m[1]} — ${m[2]}` });
      } else if (current) {
        current.blocks.push({ kind: 'h3', text: titleClean });
      }
      i++; // skip the ---- line
      continue;
    }

    if (/^={3,}\s*$/.test(line)) { flushPara(); continue; }
    if (/^-{3,}\s*$/.test(line)) {
      flushPara();
      if (current) current.blocks.push({ kind: 'hr', text: '' });
      continue;
    }

    if (line.trim() === '') {
      flushPara();
    } else {
      buf.push(line.trim());
    }
  }
  flushPara();
  if (current) chapters.push(current);
  return chapters;
}

function renderInline(text: string): React.ReactNode {
  // Convert **bold** and *italic* and `code` to spans. Conservative,
  // greedy left-to-right; nothing else is allowed.
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(
        <strong key={key++} style={{ color: 'var(--mc-text-0)' }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith('*')) {
      parts.push(
        <em key={key++} style={{ color: 'var(--mc-text-2)' }}>
          {tok.slice(1, -1)}
        </em>,
      );
    } else if (tok.startsWith('`')) {
      parts.push(
        <code
          key={key++}
          style={{
            background: 'var(--mc-bg-3)',
            color: 'var(--mc-cyan)',
            padding: '0 4px',
            borderRadius: 3,
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.9em',
          }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function EarningsTriggerMasterclassPage() {
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(SOURCE_URL, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(setRaw)
      .catch((e) => setError(String(e?.message || e)));
  }, []);

  const chapters = useMemo(() => (raw ? parse(raw) : []), [raw]);

  useEffect(() => {
    if (chapters.length === 0) return;
    const ids = chapters.map((c) => c.id);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.target.getBoundingClientRect().top - b.target.getBoundingClientRect().top));
        if (visible[0]) setActiveId((visible[0].target as HTMLElement).id);
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: [0, 0.5, 1] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [chapters]);

  if (error) {
    return (
      <div style={{ padding: 24, color: 'var(--mc-bearish)' }}>
        Masterclass content failed to load: {error}
      </div>
    );
  }

  if (!raw) {
    return (
      <div style={{ padding: 24, color: 'var(--mc-text-3)' }}>Loading masterclass…</div>
    );
  }

  const total = raw.length;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 280px) 1fr',
        gap: 24,
        padding: 20,
        background: 'var(--mc-bg-0)',
        color: 'var(--mc-text-1)',
        minHeight: '100%',
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      {/* ─── Sticky TOC ─────────────────────────────────────────────── */}
      <aside
        data-mc-no-print
        style={{
          position: 'sticky',
          top: 12,
          alignSelf: 'flex-start',
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto',
          background: 'var(--mc-bg-2)',
          border: '1px solid var(--mc-border-0)',
          borderRadius: 'var(--mc-radius-lg)',
          padding: 14,
        }}
      >
        <div
          style={{
            color: 'var(--mc-cyan)',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.6,
            marginBottom: 8,
          }}
        >
          📖 EARNINGS TRIGGER · MASTERCLASS
        </div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)', marginBottom: 14 }}>
          {chapters.length} chapters · {Math.round(total / 1000)}k chars
        </div>
        <nav>
          {chapters.map((c) => {
            const active = activeId === c.id;
            return (
              <a
                key={c.id}
                href={`#${c.id}`}
                style={{
                  display: 'block',
                  padding: '6px 8px',
                  margin: '2px 0',
                  borderRadius: 'var(--mc-radius-sm)',
                  textDecoration: 'none',
                  background: active ? 'var(--mc-bg-4)' : 'transparent',
                  color: active ? 'var(--mc-cyan)' : 'var(--mc-text-2)',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  borderLeft: `2px solid ${active ? 'var(--mc-cyan)' : 'transparent'}`,
                }}
              >
                <span style={{ color: 'var(--mc-text-4)', marginRight: 6, fontFamily: 'ui-monospace, monospace' }}>
                  {c.num.padStart(2, '0')}
                </span>
                {c.title}
              </a>
            );
          })}
        </nav>
      </aside>

      {/* ─── Body ──────────────────────────────────────────────────── */}
      <main
        ref={scrollRef}
        style={{
          maxWidth: 980,
        }}
      >
        <header style={{ marginBottom: 28 }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--mc-saffron)',
              letterSpacing: 0.6,
              fontWeight: 800,
              marginBottom: 4,
            }}
          >
            INSTITUTIONAL PLAYBOOK · JUNE 2026
          </div>
          <h1
            style={{
              color: 'var(--mc-text-0)',
              fontSize: 32,
              fontWeight: 900,
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            The Earnings Trigger Masterclass
          </h1>
          <p
            style={{
              color: 'var(--mc-text-3)',
              fontSize: 14,
              marginTop: 8,
              maxWidth: 720,
            }}
          >
            Why some Q-beats become multibaggers and other beats get punished — the seven-variable
            interaction, fifty-eight Indian case studies, three playbooks, decision trees and
            execution checklists.
          </p>
        </header>

        {chapters.map((c) => (
          <section
            key={c.id}
            id={c.id}
            style={{
              marginBottom: 36,
              padding: '22px 24px',
              background: 'var(--mc-bg-2)',
              border: '1px solid var(--mc-border-0)',
              borderRadius: 'var(--mc-radius-xl)',
              breakInside: 'avoid',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 12,
                marginBottom: 14,
                borderBottom: '1px solid var(--mc-border-0)',
                paddingBottom: 10,
              }}
            >
              <span
                style={{
                  background: 'var(--mc-cyan)',
                  color: 'var(--mc-bg-0)',
                  padding: '2px 10px',
                  borderRadius: 'var(--mc-radius-sm)',
                  fontWeight: 900,
                  fontSize: 12,
                  letterSpacing: 0.6,
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                CH {c.num.padStart(2, '0')}
              </span>
              <h2
                style={{
                  margin: 0,
                  color: 'var(--mc-text-0)',
                  fontSize: 22,
                  fontWeight: 800,
                }}
              >
                {c.title}
              </h2>
            </div>
            {c.blocks.map((b, i) => {
              if (b.kind === 'h3') {
                return (
                  <h3
                    key={i}
                    style={{
                      color: 'var(--mc-text-1)',
                      fontSize: 16,
                      fontWeight: 700,
                      margin: '18px 0 8px',
                      letterSpacing: 0.2,
                    }}
                  >
                    {renderInline(b.text)}
                  </h3>
                );
              }
              if (b.kind === 'hr') {
                return (
                  <hr
                    key={i}
                    style={{
                      border: 0,
                      borderTop: '1px dashed var(--mc-border-0)',
                      margin: '16px 0',
                    }}
                  />
                );
              }
              if (b.kind === 'callout') {
                return (
                  <div
                    key={i}
                    style={{
                      margin: '14px 0',
                      padding: '12px 14px',
                      background: 'var(--mc-bg-3)',
                      borderLeft: '3px solid var(--mc-saffron)',
                      borderRadius: 'var(--mc-radius-sm)',
                      color: 'var(--mc-text-1)',
                      fontSize: 14,
                      lineHeight: 1.55,
                    }}
                  >
                    {renderInline(b.text)}
                  </div>
                );
              }
              if (b.kind === 'quote') {
                return (
                  <blockquote
                    key={i}
                    style={{
                      margin: '12px 0',
                      padding: '8px 14px',
                      borderLeft: '3px solid var(--mc-cyan)',
                      color: 'var(--mc-text-2)',
                      fontStyle: 'italic',
                      fontSize: 14,
                      lineHeight: 1.55,
                    }}
                  >
                    {renderInline(b.text)}
                  </blockquote>
                );
              }
              return (
                <p
                  key={i}
                  style={{
                    color: 'var(--mc-text-1)',
                    fontSize: 14,
                    lineHeight: 1.65,
                    margin: '10px 0',
                  }}
                >
                  {renderInline(b.text)}
                </p>
              );
            })}
          </section>
        ))}

        <footer
          style={{
            marginTop: 24,
            color: 'var(--mc-text-4)',
            fontSize: 11,
            textAlign: 'center',
            paddingBottom: 40,
          }}
        >
          End of masterclass · PATCH 1076 · Source markdown:{' '}
          <code style={{ color: 'var(--mc-text-3)' }}>{SOURCE_URL}</code>
        </footer>
      </main>
    </div>
  );
}
