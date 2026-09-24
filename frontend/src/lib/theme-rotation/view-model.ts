// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — VIEW MODEL  (zzz795)
//
// The one function that turns the server board plus the browser-side evidence
// into what the page renders: every theme's seven layers, its flags, its
// research tier and "Why:" line, its trend word, the week-over-week diff, the
// cross-theme flows and the summary strip. Pure: the page calls it inside a
// useMemo and the scenario tests call it directly.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  CatalystInput, CrossFlow, Flag, HistoryDiff, Payload, PrintInput, ThemeAssessment, ThemeRow, Tier, TrendRead, WeeklySnapshot,
} from './types';
import { buildLayers } from './layers';
import { detectCrossFlows, detectFlags } from './detectors';
import { assessTheme, rankAssessments } from './ranking';
import { diffHistory, trendForTheme } from './history';

export interface ViewInputs {
  payload: Payload;
  now: Date;
  /** Graded strong prints by theme; null = bench not loaded on this device. */
  printsByTheme: Record<string, PrintInput[]> | null;
  benchLabel: string;
  /** Catalysts by theme; null = no feed could be read. */
  catalystsByTheme: Record<string, CatalystInput[]> | null;
  catalystWindowDays: number;
  pesByTheme: Record<string, number[]>;
  allPEs: number[];
  snapshots: WeeklySnapshot[];
  currentWeek: string;
  /** Names inside a theme most likely to benefit next (for cross-theme flow). */
  beneficiariesOf: (themeId: string) => string[];
}

export interface ThemeView {
  row: ThemeRow;
  a: ThemeAssessment;
  rank: number;
  trend: TrendRead;
}

export interface SummaryModel {
  regime: 'risk-on' | 'risk-off' | 'mixed' | null;
  regimeLine: string;
  tierCounts: Record<Tier, number>;
  early: string[];
  crowded: string[];
  breakdown: string[];
  shortBreak: string[];
}

export interface ViewModel {
  themes: ThemeView[];
  byId: Map<string, ThemeView>;
  diff: HistoryDiff;
  flows: CrossFlow[];
  summary: SummaryModel;
}

const flagIds = (vs: ThemeView[], k: Flag['kind']) => vs.filter((v) => v.a.flags.some((f) => f.kind === k)).map((v) => v.row.id);

export function buildViewModel(inp: ViewInputs): ViewModel {
  const { payload } = inp;
  const rows = (payload.themes || []).filter((t) => t.ok !== false && t.ret);
  const benchName = payload.benchmark?.name || 'the benchmark';
  const views: ThemeView[] = rows.map((row) => {
    const layers = buildLayers(row, {
      benchName, benchRet: payload.benchmarkRet,
      prints: inp.printsByTheme ? (inp.printsByTheme[row.id] || []) : null,
      benchLabel: inp.benchLabel,
      catalysts: inp.catalystsByTheme ? (inp.catalystsByTheme[row.id] || []) : null,
      catalystWindowDays: inp.catalystWindowDays,
      themePEs: inp.pesByTheme[row.id] || [], allPEs: inp.allPEs,
      now: inp.now,
    });
    const flags = detectFlags(row, layers, payload.benchmarkRet?.y1);
    const a = assessTheme(row.id, layers, flags);
    return { row, a, rank: 0, trend: trendForTheme(row, inp.snapshots) };
  });
  const ranked = rankAssessments(views.map((v) => ({ ...v, tier: v.a.tier, sortKey: v.a.sortKey, name: v.row.name, id: v.row.id })));
  const themes: ThemeView[] = ranked.map((v, i) => ({ row: v.row, a: v.a, rank: i + 1, trend: v.trend }));
  const byId = new Map(themes.map((v) => [v.row.id, v]));

  const current: Record<string, { tier: Tier; verdict?: string }> = {};
  for (const v of themes) current[v.row.id] = { tier: v.a.tier, verdict: v.row.verdict };
  const diff = diffHistory(inp.currentWeek, current, inp.snapshots, rows);
  const flows = detectCrossFlows(rows, inp.beneficiariesOf);

  const tierCounts: Record<Tier, number> = { top: 0, look: 0, monitor: 0, low: 0 };
  for (const v of themes) tierCounts[v.a.tier]++;
  const b = payload.breadth || null;
  const benchLine = b?.benchAbove50 === true ? `${benchName} is above its 50-day line` : b?.benchAbove50 === false ? `${benchName} is below its 50-day line` : '';
  const regimeLine = b
    ? `${b.above50} of ${b.themes} themes are above their 50-day line${benchLine ? `; ${benchLine}` : ''}. ${b.newHigh} themes sit near 1-year highs and ${b.newLow} near 1-year lows.`
    : 'Market condition not available.';

  return {
    themes, byId, diff, flows,
    summary: {
      regime: b?.regime ?? null, regimeLine, tierCounts,
      early: flagIds(themes, 'early-rotation'),
      crowded: flagIds(themes, 'crowded'),
      breakdown: flagIds(themes, 'breakdown'),
      shortBreak: flagIds(themes, 'short-term-break'),
    },
  };
}

/** The compact overlay the page posts to the weekly snapshot. */
export function overlayFromView(vm: ViewModel): Record<string, { t: Tier; r: number; e: number; c: number; f: Flag['kind'][] }> {
  const out: Record<string, { t: Tier; r: number; e: number; c: number; f: Flag['kind'][] }> = {};
  for (const v of vm.themes) {
    out[v.row.id] = {
      t: v.a.tier, r: v.rank,
      e: v.a.layers.earnings.evidence?.length || 0,
      c: v.a.layers.catalysts.evidence?.length || 0,
      f: v.a.flags.map((f) => f.kind),
    };
  }
  return out;
}
