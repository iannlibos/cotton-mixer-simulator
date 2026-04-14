import { PARAMS, TARGET_RANGES } from "../domain/types.js";
import type { Lot, MixParams } from "../domain/stock.js";
import type { Thresholds, EngineRules } from "../domain/types.js";
import {
  baleWeight,
  calcMixParams,
  checkViolations,
  mixMeetsMinLotPct,
} from "./constraints.js";

export interface ObjectiveWeights {
  weight: number;
  quality: number;
  producer: number;
  lotCount: number;
  minLot: number;
  rotation: number;
  diversity: number;
  target: number;
}

export function lotQualityScore(lot: Lot, thresholds: Thresholds): number {
  let score = 0;
  PARAMS.forEach((p) => {
    const t = thresholds[p.key];
    if (!t) return;
    const mid = (t.min + t.max) / 2;
    const range = Math.max(0.000001, t.max - t.min);
    const val = lot[p.key as keyof Lot] || 0;
    const dist = Math.abs((val as number) - mid) / (range / 2);
    const side = p.good ? (val as number) - mid : mid - (val as number);
    const sideBonus = side > 0 ? 0.3 : -0.3;
    score += 1 - dist + sideBonus;
  });
  return score;
}

export function buildObjectiveWeights(
  priority: string,
  rotationPercent: number
): ObjectiveWeights {
  const rotationFactor = Math.max(0, Math.min(1, rotationPercent / 100));
  if (priority === "strict_quality_first") {
    return {
      weight: 1.0,
      quality: 2.3,
      producer: 1.2,
      lotCount: 1.1,
      minLot: 1.4,
      rotation: 0.4 * rotationFactor,
      diversity: 0.5,
      target: 1.8,
    };
  }
  if (priority === "balanced") {
    return {
      weight: 1.0,
      quality: 1.8,
      producer: 1.2,
      lotCount: 1.1,
      minLot: 1.2,
      rotation: 1.0 * rotationFactor,
      diversity: 0.8,
      target: 2.0,
    };
  }
  return {
    weight: 1.0,
    quality: 1.5,
    producer: 1.1,
    lotCount: 1.0,
    minLot: 1.1,
    rotation: 2.0 * rotationFactor,
    diversity: 0.9,
    target: 2.0,
  };
}

export function objectiveScore(
  mix: Lot[],
  targetWeight: number,
  rules: EngineRules,
  thresholds: Thresholds,
  objectiveWeights: ObjectiveWeights,
  targetValues: Record<string, number> | null = null
): number {
  const active = mix.filter((m) => m.allocBales! > 0);
  const params = calcMixParams(active);
  if (!params) return Number.POSITIVE_INFINITY;

  const violations = checkViolations(params, thresholds);
  const tw = params.weight;
  const tol = targetWeight * (rules.weightTol / 100);
  const weightPenalty = Math.max(0, Math.abs(tw - targetWeight) - tol) * 100;
  const qualityPenalty = violations.length * 500;

  const perProducer: Record<string, number> = {};
  active.forEach((l) => {
    perProducer[l.produtor] = (perProducer[l.produtor] || 0) + (l.allocWeight || 0);
  });
  const producerOver = Object.values(perProducer).reduce((sum, w) => {
    const pct = tw > 0 ? (w / tw) * 100 : 0;
    return sum + Math.max(0, pct - rules.maxProdPct);
  }, 0);
  const producerPenalty = producerOver * 50;

  const lotPenalty = active.length > rules.maxLots ? (active.length - rules.maxLots) * 100 : 0;

  const minLotPenalty = active.reduce((sum, l) => {
    const pct = tw > 0 ? ((l.allocWeight || 0) / tw) * 100 : 0;
    return sum + Math.max(0, rules.minLotPct - pct);
  }, 0);

  const rotationMetric = active.length
    ? active.reduce((s, l) => s + (l.qScore || 0) * ((l.allocWeight || 0) / tw), 0)
    : 0;
  const rotationReward = -rotationMetric;
  const diversityReward = Object.keys(perProducer).length;

  let targetPenalty = 0;
  if (targetValues) {
    Object.entries(targetValues).forEach(([k, t]) => {
      if (!Number.isFinite(t)) return;
      const range = TARGET_RANGES[k] || 1;
      const d = ((params[k as keyof MixParams] || 0) - t) / range;
      targetPenalty += d * d * 100;
    });
  }

  return (
    weightPenalty * objectiveWeights.weight +
    qualityPenalty * objectiveWeights.quality +
    producerPenalty * objectiveWeights.producer +
    lotPenalty * objectiveWeights.lotCount +
    minLotPenalty * objectiveWeights.minLot +
    targetPenalty * objectiveWeights.target +
    rotationReward * objectiveWeights.rotation +
    -diversityReward * objectiveWeights.diversity
  );
}

/** Hill-climbing por troca de 1 fardo. `maxLoops` menor (ex.: 500) nas strategies para manter tempo baixo. */
export function localImprove(
  mix: Lot[],
  targetWeight: number,
  rules: EngineRules,
  thresholds: Thresholds,
  objectiveWeights: ObjectiveWeights,
  targetValues: Record<string, number> | null = null,
  maxLoops = 1500
): void {
  let current = objectiveScore(mix, targetWeight, rules, thresholds, objectiveWeights, targetValues);
  let improved = true;
  let loops = 0;
  while (improved && loops < maxLoops) {
    loops++;
    improved = false;
    const active = mix.filter((m) => m.allocBales! > 0);
    const idle = mix.filter((m) => m.allocBales === 0);

    for (const outLot of active) {
      if (outLot.allocBales! <= 1) continue;
      const dec = 1;
      outLot.allocBales! -= dec;
      outLot.allocWeight = outLot.allocBales! * baleWeight(outLot);

      for (const inLot of [...idle, ...active]) {
        if (inLot.allocBales! >= inLot.fardos) continue;
        inLot.allocBales! += 1;
        inLot.allocWeight = inLot.allocBales! * baleWeight(inLot);

        const score = objectiveScore(mix, targetWeight, rules, thresholds, objectiveWeights, targetValues);
        const okMin = mixMeetsMinLotPct(mix, rules);
        if (score + 1e-6 < current && okMin) {
          current = score;
          improved = true;
          break;
        }

        inLot.allocBales! -= 1;
        inLot.allocWeight = inLot.allocBales! * baleWeight(inLot);
      }

      if (improved) break;
      outLot.allocBales! += dec;
      outLot.allocWeight = outLot.allocBales! * baleWeight(outLot);
    }
  }
}
