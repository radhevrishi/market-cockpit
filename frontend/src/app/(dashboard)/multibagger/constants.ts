// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// Shared API base — respects NEXT_PUBLIC_API_URL env var so all fetch() calls
// resolve consistently when the base URL changes (fixes #13: mixed /api/v1 vs /api)
export const API_BASE = (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) || '/api/v1';

// ── Design tokens — institutional scale ───────────────────────────────────────
export const BG      = '#0a0a0f';
export const CARD_BG = '#13131a';
export const CARD2   = '#191926';
export const BORDER  = 'rgba(255,255,255,0.08)';
export const TEXT    = '#e2e8f0';
export const MUTED   = '#64748b';
export const PURPLE  = '#a78bfa';
export const ACCENT  = '#38bdf8';
export const GREEN   = '#10b981';
export const RED     = '#ef4444';
export const ORANGE  = '#f97316';
export const YELLOW  = '#f59e0b';

// Font scale — institutional / terminal grade
export const F = { xs:11, sm:13, md:15, lg:17, xl:20, h1:24, h2:20, h3:17 };
