import { PARAMS } from "../../domain/types.js";
import type { Lot } from "../../domain/stock.js";
import type { Thresholds, EngineRules } from "../../domain/types.js";
import {
  baleWeight,
  calcMixParams,
  checkViolations,
  computeConstraintSummary,
} from "../constraints.js";
import { filterUsableLots } from "../baseline.js";
import { violatesBaleCaps } from "../../domain/baleCaps.js";
import { optimizeMix, type OptimizerResult, type OptimizerAlternative } from "../optimizer.js";
import type { SolverInput, SolverOptions } from "./types.js";

function seededRandom(state: { v: number }): number {
  state.v = (1664525 * state.v + 1013904223) % 4294967296;
  return state.v / 4294967296;
}

function lotQualityScore(lot: Lot, thresholds: Thresholds): number {
  let score = 0;
  PARAMS.forEach((p) => {
    const t = thresholds[p.key];
    if (!t) return;
    const mid = (t.min + t.max) / 2;
    const range = Math.max(0.000001, t.max - t.min);
    const val = (lot[p.key as keyof Lot] as number) || 0;
    const dist = Math.abs(val - mid) / (range / 2);
    const side = p.good ? val - mid : mid - val;
    score += 1 - dist + (side > 0 ? 0.3 : -0.3);
  });
  return score;
}

function mixObjective(
  mix: Lot[],
  targetWeight: number,
  rules: EngineRules,
  thresholds: Thresholds,
  targetValues: Record<string, number> | null,
): number {
  const active = mix.filter((m) => (m.allocBales ?? 0) > 0);
  const params = calcMixParams(active);
  if (!params) return 1e12;

  const tw = params.weight;
  const tol = targetWeight * (rules.weightTol / 100);
  let penalty = 0;

  penalty += Math.max(0, Math.abs(tw - targetWeight) - tol) * 100;

  const violations = checkViolations(params, thresholds);
  penalty += violations.length * 500;

  const perProducer: Record<string, number> = {};
  active.forEach((l) => {
    perProducer[l.produtor] = (perProducer[l.produtor] || 0) + (l.allocWeight || 0);
  });
  Object.values(perProducer).forEach((w) => {
    const pct = tw > 0 ? (w / tw) * 100 : 0;
    penalty += Math.max(0, pct - rules.maxProdPct) * 50;
  });

  if (active.length > rules.maxLots) {
    penalty += (active.length - rules.maxLots) * 100;
  }

  active.forEach((l) => {
    const pct = tw > 0 ? ((l.allocWeight || 0) / tw) * 100 : 0;
    penalty += Math.max(0, rules.minLotPct - pct) * 30;
  });

  if (targetValues) {
    const mp = params as unknown as Record<string, number>;
    Object.entries(targetValues).forEach(([k, t]) => {
      if (!Number.isFinite(t)) return;
      const d = (mp[k] || 0) - t;
      penalty += d * d * 50;
    });
  }

  return penalty;
}

function cloneMixState(mix: Lot[]): Lot[] {
  return mix.map((l) => ({ ...l }));
}

function perturbSolution(
  mix: Lot[],
  rng: { v: number },
  _rules: EngineRules,
  _targetWeight: number,
): void {
  const active = mix.filter((m) => (m.allocBales ?? 0) > 0);
  const all = mix;
  if (!active.length) return;

  const moveType = seededRandom(rng);

  if (moveType < 0.5 && active.length >= 2) {
    // Swap: move 1-3 bales from one active lot to another
    const iA = Math.floor(seededRandom(rng) * active.length);
    let iB = Math.floor(seededRandom(rng) * active.length);
    if (iB === iA) iB = (iA + 1) % active.length;
    const from = active[iA];
    const to = active[iB];
    const maxMove = Math.min(3, (from.allocBales ?? 0) - 1, to.fardos - (to.allocBales ?? 0));
    if (maxMove >= 1) {
      const n = 1 + Math.floor(seededRandom(rng) * maxMove);
      from.allocBales! -= n;
      from.allocWeight = from.allocBales! * baleWeight(from);
      to.allocBales! += n;
      to.allocWeight = to.allocBales! * baleWeight(to);
    }
  } else if (moveType < 0.75) {
    // Add bales to an active lot or activate an idle lot
    const idle = all.filter((m) => (m.allocBales ?? 0) === 0 && m.fardos > 0);
    const candidates = [...active.filter((l) => (l.allocBales ?? 0) < l.fardos), ...idle];
    if (candidates.length) {
      const pick = candidates[Math.floor(seededRandom(rng) * candidates.length)];
      const maxAdd = Math.min(3, pick.fardos - (pick.allocBales ?? 0));
      if (maxAdd >= 1) {
        const n = 1 + Math.floor(seededRandom(rng) * maxAdd);
        pick.allocBales = (pick.allocBales ?? 0) + n;
        pick.allocWeight = pick.allocBales * baleWeight(pick);
      }
    }
  } else {
    // Remove bales from an active lot
    const pick = active[Math.floor(seededRandom(rng) * active.length)];
    const maxRem = Math.min(3, (pick.allocBales ?? 0) - 1);
    if (maxRem >= 1) {
      const n = 1 + Math.floor(seededRandom(rng) * maxRem);
      pick.allocBales! -= n;
      pick.allocWeight = pick.allocBales! * baleWeight(pick);
      if (pick.allocBales! <= 0) {
        pick.allocBales = 0;
        pick.allocWeight = 0;
      }
    }
  }
}

export function saOptimize(
  input: SolverInput,
  options: SolverOptions = {},
): OptimizerResult {
  const iterations = options.saIterations ?? 3000;
  const T0 = options.saT0 ?? 500;
  const Tmin = options.saTmin ?? 0.1;
  const alpha = options.saAlpha ?? 0.997;

  const classicResult = optimizeMix({
    stock: input.stock,
    targetWeight: input.targetWeight,
    thresholds: input.thresholds,
    rules: input.rules,
    priority: input.priority,
    seed: input.seed ?? Date.now(),
    targetValues: input.targetValues,
    baleSizeCaps: input.baleSizeCaps,
  });

  if (!classicResult.best || !classicResult.best.mix.length) {
    return classicResult;
  }

  const usable = filterUsableLots(input.stock);
  if (!usable.length) return classicResult;

  const fullMix = usable.map((l) => ({
    ...l,
    qScore: lotQualityScore(l, input.thresholds),
    allocBales: 0,
    allocWeight: 0,
  }));

  for (const allocated of classicResult.best.mix) {
    const target = fullMix.find((m) => m.id === allocated.id);
    if (target) {
      target.allocBales = allocated.allocBales ?? 0;
      target.allocWeight = allocated.allocWeight ?? 0;
    }
  }

  const targetVals = input.targetValues ?? null;
  let currentCost = mixObjective(fullMix, input.targetWeight, input.rules, input.thresholds, targetVals);
  let bestMix = cloneMixState(fullMix);
  let bestCost = currentCost;

  const rng = { v: ((input.seed ?? Date.now()) >>> 0) || 123456789 };
  let T = T0;

  for (let i = 0; i < iterations; i++) {
    const snapshot = cloneMixState(fullMix);
    perturbSolution(fullMix, rng, input.rules, input.targetWeight);
    if (violatesBaleCaps(fullMix, input.baleSizeCaps ?? null)) {
      for (let j = 0; j < fullMix.length; j++) {
        fullMix[j].allocBales = snapshot[j].allocBales ?? 0;
        fullMix[j].allocWeight = snapshot[j].allocWeight ?? 0;
      }
      continue;
    }
    const newCost = mixObjective(fullMix, input.targetWeight, input.rules, input.thresholds, targetVals);

    const delta = newCost - currentCost;
    const accept = delta < 0 || seededRandom(rng) < Math.exp(-delta / T);

    if (accept) {
      currentCost = newCost;
      if (newCost < bestCost) {
        bestCost = newCost;
        bestMix = cloneMixState(fullMix);
      }
    } else {
      for (let j = 0; j < fullMix.length; j++) {
        fullMix[j].allocBales = snapshot[j].allocBales ?? 0;
        fullMix[j].allocWeight = snapshot[j].allocWeight ?? 0;
      }
    }

    T = Math.max(Tmin, T * alpha);
  }

  const finalActive = bestMix.filter((m) => (m.allocBales ?? 0) > 0);
  const summary = computeConstraintSummary(bestMix, input.targetWeight, input.rules, input.thresholds);

  const saAlternative: OptimizerAlternative = {
    rankHint: 0,
    mode: "simulated_annealing",
    score: bestCost,
    feasible: summary.feasible,
    reasons: summary.reasons,
    params: summary.params,
    mix: finalActive.map((m) => ({ ...m })),
  };

  if (bestCost < classicResult.best.score) {
    return {
      best: saAlternative,
      alternatives: [saAlternative, classicResult.best, ...classicResult.alternatives.slice(0, 1)],
      diagnostics: classicResult.diagnostics,
    };
  }

  return {
    best: classicResult.best,
    alternatives: [classicResult.best, saAlternative, ...classicResult.alternatives.slice(0, 1)],
    diagnostics: classicResult.diagnostics,
  };
}
