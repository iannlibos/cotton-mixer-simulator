import type { Lot, MixParams } from "../domain/stock.js";
import type { Thresholds } from "../domain/types.js";
import type { EngineRules } from "../domain/types.js";
import {
  baleWeight,
  computeConstraintSummary,
  infeasibilityDiagnosis,
  minBalesToBringActiveLotToMin,
  minBalesToOpenNewLot,
  producerWeight,
  totalWeight,
} from "./constraints.js";
import { filterUsableLots } from "./baseline.js";
import {
  lotQualityScore,
  buildObjectiveWeights,
  objectiveScore,
  localImprove,
  type ObjectiveWeights,
} from "./shared-improve.js";

export { lotQualityScore, buildObjectiveWeights, objectiveScore, localImprove };
export type { ObjectiveWeights };

function seededRandom(seedState: { value: number }): number {
  const s = seedState;
  s.value = (1664525 * s.value + 1013904223) % 4294967296;
  return s.value / 4294967296;
}

function buildSeedState(seed: number = Date.now()): { value: number } {
  return { value: (seed >>> 0) || 123456789 };
}

function cloneStock(stock: Lot[], thresholds: Thresholds): Lot[] {
  return stock.map((lot) => ({
    ...lot,
    qScore: lotQualityScore(lot, thresholds),
    allocBales: 0,
    allocWeight: 0,
  }));
}

function canAdd(
  lot: Lot,
  mix: Lot[],
  rules: EngineRules,
  targetWeight: number,
  incBales: number
): boolean {
  if (incBales < 1) return false;
  const tw = totalWeight(mix);
  const bw = baleWeight(lot);
  const activeBefore = mix.filter((m) => m.allocBales! > 0).length;
  if (lot.allocBales === 0 && activeBefore >= rules.maxLots) return false;

  if ((lot.allocBales ?? 0) === 0) {
    const minOpen = minBalesToOpenNewLot(tw, bw, rules.minLotPct, lot.fardos);
    if (minOpen === Number.POSITIVE_INFINITY || incBales < minOpen) return false;
  }

  const deltaW = incBales * bw;
  const projectedWeight = tw + deltaW;
  const producerProjected = producerWeight(mix, lot.produtor) + deltaW;
  const pct = projectedWeight > 0 ? (producerProjected / projectedWeight) * 100 : 0;
  if (pct > rules.maxProdPct + 0.5) return false;

  const maxOver = targetWeight * (rules.weightTol / 100) + 0.3;
  if (projectedWeight > targetWeight + maxOver) return false;

  return true;
}

function sortMixForMode(
  mix: Lot[],
  mode: "rotation" | "quality" | "balanced"
): Lot[] {
  const sorted = [...mix];
  if (mode === "rotation") {
    sorted.sort((a, b) => (a.qScore || 0) - (b.qScore || 0));
  } else if (mode === "quality") {
    sorted.sort((a, b) => (b.qScore || 0) - (a.qScore || 0));
  } else {
    sorted.sort((a, b) => Math.abs(a.qScore || 0) - Math.abs(b.qScore || 0));
  }
  return sorted;
}

/** Continua adicionando fardos até o peso alvo (usado após cortes por minLotPct). */
function greedyFillRemaining(
  mix: Lot[],
  sorted: Lot[],
  targetWeight: number,
  rules: EngineRules,
  thresholds: Thresholds,
  seedState: { value: number },
  objectiveWeights: ObjectiveWeights,
  targetValues: Record<string, number> | null
): void {
  const maxOver = targetWeight * (rules.weightTol / 100) + 0.3;
  let guard = 0;
  while (guard < 120000) {
    guard++;
    const tw = totalWeight(mix);
    if (tw >= targetWeight) break;

    let candidate: { lot: Lot; inc: number } | null = null;
    let best = Number.POSITIVE_INFINITY;

    for (let i = 0; i < sorted.length; i++) {
      const lot = sorted[i];
      if (lot.allocBales! >= lot.fardos) continue;

      const bw = baleWeight(lot);
      const ab = lot.allocBales ?? 0;
      const roomW = targetWeight + maxOver - tw;
      const roomBales = Math.max(0, Math.floor(roomW / bw - 1e-9));
      if (roomBales < 1) continue;

      let inc = Math.min(
        tw + bw * 4 <= targetWeight ? 4 : 1,
        lot.fardos - ab,
        roomBales
      );
      if (ab === 0) {
        const minOpen = minBalesToOpenNewLot(tw, bw, rules.minLotPct, lot.fardos - ab);
        if (minOpen === Number.POSITIVE_INFINITY) continue;
        inc = Math.max(inc, minOpen);
      } else if (tw > 0) {
        const w0 = lot.allocWeight ?? 0;
        if ((w0 / tw) * 100 < rules.minLotPct - 1e-7) {
          const minFix = minBalesToBringActiveLotToMin(
            w0,
            tw,
            bw,
            rules.minLotPct,
            lot.fardos - ab
          );
          if (minFix === Number.POSITIVE_INFINITY) continue;
          inc = Math.max(inc, minFix);
        }
      }
      inc = Math.min(inc, lot.fardos - ab, roomBales);
      if (inc < 1) continue;

      if (!canAdd(lot, mix, rules, targetWeight, inc)) continue;

      const jitter = seededRandom(seedState) * 0.015;
      lot.allocBales = ab + inc;
      lot.allocWeight = lot.allocBales * baleWeight(lot);
      const score =
        objectiveScore(mix, targetWeight, rules, thresholds, objectiveWeights, targetValues) + jitter;
      lot.allocBales = ab;
      lot.allocWeight = ab * baleWeight(lot);

      if (score < best) {
        best = score;
        candidate = { lot, inc };
      }
    }

    if (!candidate) break;
    const cl = candidate.lot;
    cl.allocBales = (cl.allocBales ?? 0) + candidate.inc;
    cl.allocWeight = (cl.allocBales ?? 0) * baleWeight(cl);
  }
}

function allocateGreedy(
  mix: Lot[],
  targetWeight: number,
  rules: EngineRules,
  thresholds: Thresholds,
  mode: "rotation" | "quality" | "balanced",
  seedState: { value: number },
  objectiveWeights: ObjectiveWeights,
  targetValues: Record<string, number> | null = null
): void {
  const sorted = sortMixForMode(mix, mode);

  const minBalesPerProducer = Math.max(
    1,
    Math.floor((targetWeight * 1000) / (Math.max(1, new Set(mix.map((m) => m.produtor)).size) * 213) / 6)
  );
  const byProducer: Record<string, Lot[]> = {};
  sorted.forEach((l) => {
    if (!byProducer[l.produtor]) byProducer[l.produtor] = [];
    byProducer[l.produtor].push(l);
  });

  const prodOrder = [...new Set(sorted.map((m) => m.produtor))];
  let twRun = 0;
  for (const prod of prodOrder) {
    const lots = byProducer[prod];
    const pick = lots[0];
    if (!pick) continue;
    const bw = baleWeight(pick);
    const minOpen = minBalesToOpenNewLot(twRun, bw, rules.minLotPct, pick.fardos);
    if (minOpen === Number.POSITIVE_INFINITY) continue;
    const add = Math.min(Math.max(minBalesPerProducer, minOpen), pick.fardos);
    pick.allocBales = add;
    pick.allocWeight = add * bw;
    twRun += pick.allocWeight;
  }

  greedyFillRemaining(mix, sorted, targetWeight, rules, thresholds, seedState, objectiveWeights, targetValues);
}

function enforceMinLotParticipation(mix: Lot[], rules: EngineRules): void {
  let changed = true;
  while (changed) {
    changed = false;
    const active = mix.filter((m) => m.allocBales! > 0);
    const tw = totalWeight(active);
    active.forEach((l) => {
      const pct = tw > 0 ? ((l.allocWeight || 0) / tw) * 100 : 0;
      if (pct < rules.minLotPct && l.allocBales! > 0) {
        l.allocBales = 0;
        l.allocWeight = 0;
        changed = true;
      }
    });
  }
}

function trimToTarget(mix: Lot[], targetWeight: number): void {
  let tw = totalWeight(mix);
  const active = mix.filter((m) => m.allocBales! > 0).sort((a, b) => (b.qScore || 0) - (a.qScore || 0));
  for (const lot of active) {
    while (tw > targetWeight + 0.01 && lot.allocBales! > 1) {
      lot.allocBales! -= 1;
      lot.allocWeight = lot.allocBales! * baleWeight(lot);
      tw = totalWeight(mix);
    }
    if (tw <= targetWeight + 0.01) break;
  }
}

export interface OptimizerAlternative {
  rankHint: number;
  mode: string;
  score: number;
  feasible: boolean;
  reasons: string[];
  params: MixParams | null;
  mix: Lot[];
}

export interface OptimizerResult {
  best: OptimizerAlternative | null;
  alternatives: OptimizerAlternative[];
  diagnostics: { code: string; message: string; suggestion: string }[];
}

export function optimizeMix({
  stock,
  targetWeight,
  thresholds,
  rules,
  priority = "rotation_first",
  seed = Date.now(),
  targetValues = null,
}: {
  stock: Lot[];
  targetWeight: number;
  thresholds: Thresholds;
  rules: EngineRules;
  priority?: string;
  seed?: number;
  targetValues?: Record<string, number> | null;
}): OptimizerResult {
  const usableStock = filterUsableLots(stock);
  const diagnostics = infeasibilityDiagnosis(usableStock, targetWeight, rules);
  if (stock.length && !usableStock.length) {
    diagnostics.push({
      code: "NO_EVALUATED_LOTS",
      message: "Nenhum lote com todas as medidas HVI preenchidas (valores zerados contam como não avaliados).",
      suggestion: "Complete as análises HVI ou importe apenas linhas com dados; lotes incompletos permanecem no estoque para consulta.",
    });
  }
  const weights = buildObjectiveWeights(priority, rules.rotation);
  const modes: ("rotation" | "balanced" | "quality")[] = ["rotation", "balanced", "quality", "rotation", "balanced"];
  const alternatives: OptimizerAlternative[] = [];
  const seedState = buildSeedState(seed);

  if (!usableStock.length) {
    return {
      best: null,
      alternatives: [],
      diagnostics,
    };
  }

  modes.forEach((mode, idx) => {
    const mix = cloneStock(usableStock, thresholds);
    allocateGreedy(mix, targetWeight, rules, thresholds, mode, seedState, weights, targetValues);
    for (let pass = 0; pass < 8; pass++) {
      enforceMinLotParticipation(mix, rules);
      greedyFillRemaining(
        mix,
        sortMixForMode(mix, mode),
        targetWeight,
        rules,
        thresholds,
        seedState,
        weights,
        targetValues
      );
    }
    trimToTarget(mix, targetWeight);
    for (let pass = 0; pass < 8; pass++) {
      enforceMinLotParticipation(mix, rules);
      greedyFillRemaining(
        mix,
        sortMixForMode(mix, mode),
        targetWeight,
        rules,
        thresholds,
        seedState,
        weights,
        targetValues
      );
    }
    localImprove(mix, targetWeight, rules, thresholds, weights, targetValues);
    for (let pass = 0; pass < 6; pass++) {
      enforceMinLotParticipation(mix, rules);
      greedyFillRemaining(
        mix,
        sortMixForMode(mix, mode),
        targetWeight,
        rules,
        thresholds,
        seedState,
        weights,
        targetValues
      );
    }

    const summary = computeConstraintSummary(mix, targetWeight, rules, thresholds);
    const score = objectiveScore(mix, targetWeight, rules, thresholds, weights, targetValues);

    alternatives.push({
      rankHint: idx + 1,
      mode,
      score,
      feasible: summary.feasible,
      reasons: summary.reasons,
      params: summary.params,
      mix: mix.filter((m) => m.allocBales! > 0).map((m) => ({ ...m })),
    });
  });

  alternatives.sort((a, b) => a.score - b.score);
  const feasible = alternatives.filter((a) => a.feasible);
  const best = feasible[0] || alternatives[0] || null;

  return {
    best,
    alternatives: alternatives.slice(0, 3),
    diagnostics,
  };
}

export function explainRelaxationSuggestion(result: OptimizerResult): string | null {
  if (result.best?.feasible) return null;
  const reasons = result.best?.reasons || [];
  if (reasons.some((r) => r.includes("Peso fora"))) {
    return "Sugestão: aumentar `weightTol` em +0.3 p.p.";
  }
  if (reasons.some((r) => r.includes("Participação mínima por lote"))) {
    return "Sugestão: reduzir `minLotPct` em 1-2 p.p.";
  }
  if (reasons.some((r) => r.includes("Participação de produtor"))) {
    return "Sugestão: aumentar `maxProdPct` em 5 p.p.";
  }
  if (reasons.some((r) => r.includes("Parâmetros de qualidade"))) {
    return "Sugestão: revisar limites de qualidade para os parâmetros mais críticos.";
  }
  return "Sugestão: revisar regras e peso alvo para ampliar factibilidade.";
}
