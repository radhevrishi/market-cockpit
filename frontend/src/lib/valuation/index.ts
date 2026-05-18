// ═══════════════════════════════════════════════════════════════════════════
// VALUATION ENGINE — top-level entry point
//
// computeValuations(row) → ValuationReport
//
// Wires together: input extraction → user overrides → scenario builder
// → all 10 models → consensus aggregation. Pure function, safe to call
// in render via useMemo.
// ═══════════════════════════════════════════════════════════════════════════

import { extractInputs, type AnyRow } from './inputs';
import { applyOverrides } from './overrides';
import { buildScenarios } from './scenario';
import { buildConsensus } from './consensus';
import { dcfModel } from './models/dcf';
import { reverseDcfModel } from './models/reverse-dcf';
import { grahamModel } from './models/graham';
import { evEbitdaModel } from './models/ev-ebitda';
import { peMultipleModel } from './models/pe-multiple';
import { epvModel } from './models/epv';
import { pegImpliedModel } from './models/peg';
import { justifiedPeModel } from './models/justified-pe';
import { pbRoeModel } from './models/pb-roe';
import { sectorPeBandModel } from './models/sector-pe-band';
import { ownerEarningsModel } from './models/owner-earnings';
import { assetFloorModel } from './models/asset-floor';
import type { ModelOutput, ValuationReport } from './types';

export * from './types';
export { extractInputs } from './inputs';
export { buildScenarios } from './scenario';
export { readOverrides, writeOverrides, clearOverrides, applyOverrides } from './overrides';
export type { ValuationOverrides } from './overrides';
export { getAssumptions, classifySector } from './assumptions';

/** Compute the full valuation report for a Multibagger row. */
export function computeValuations(row: AnyRow): ValuationReport {
  const base = extractInputs(row);
  const inp = applyOverrides(base);
  const sc = buildScenarios(inp);

  const models: ModelOutput[] = [
    dcfModel(inp, sc),
    reverseDcfModel(inp, sc),
    grahamModel(inp),
    evEbitdaModel(inp, sc),
    peMultipleModel(inp, sc),
    epvModel(inp, sc),
    pegImpliedModel(inp, sc),
    justifiedPeModel(inp, sc),
    pbRoeModel(inp, sc),
    sectorPeBandModel(inp, sc),
    ownerEarningsModel(inp, sc),
    assetFloorModel(inp),
  ];

  const consensus = buildConsensus(models, inp.cmp);

  return {
    symbol: inp.symbol,
    company: inp.company,
    cmp: inp.cmp,
    models,
    consensus,
    computedAt: Date.now(),
  };
}
