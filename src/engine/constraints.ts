import { ALL_KEYS, PARAMS, Thresholds } from "../domain/types.js";
import type { Lot, MixParams } from "../domain/stock.js";
import { roundParam } from "../utils/paramFormat.js";

export function weightedAverage(lots: Lot[], key: string, weightKey: string): number {
  const tw = lots.reduce((sum, lot) => sum + (lot[weightKey as keyof Lot] as number || 0), 0);
  if (!tw) return 0;
  return lots.reduce((sum, lot) => sum + (lot[key as keyof Lot] as number || 0) * (lot[weightKey as keyof Lot] as number || 0), 0) / tw;
}

/**
 * Média ponderada por peso apenas entre lotes com medida ≠ 0 (zeros = ainda não avaliado).
 * Retorna `null` se não houver nenhum lote com dado.
 */
export function weightedAverageExcludingZero(lots: Lot[], key: string, weightKey: string): number | null {
  const withData = lots.filter((lot) => {
    const v = lot[key as keyof Lot] as number;
    return v != null && Number.isFinite(v) && v !== 0;
  });
  if (!withData.length) return null;
  return weightedAverage(withData, key, weightKey);
}

export function calcMixParams(lots: Lot[]): MixParams | null {
  const tw = lots.reduce((sum, lot) => sum + (lot.allocWeight || 0), 0);
  if (!tw) return null;
  const weight = +tw.toFixed(2);
  const result: Record<string, number> = {
    weight,
    bales: lots.reduce((sum, lot) => sum + (lot.allocBales || 0), 0),
  };
  ALL_KEYS.forEach((k) => {
    result[k] = roundParam(k, weightedAverage(lots, k, "allocWeight"));
  });
  result.custoTon = +weightedAverage(lots, "custo", "allocWeight").toFixed(2);
  result.custoTotal = +((result.custoTon * weight).toFixed(2));
  return result as unknown as MixParams;
}

export interface Violation {
  key: string;
  label: string;
  type: "below" | "above";
  val: number;
  limit: number;
}

export function checkViolations(params: MixParams | null, thresholds: Thresholds): Violation[] {
  if (!params) return [];
  const out: Violation[] = [];
  PARAMS.forEach((param) => {
    const t = thresholds[param.key];
    if (!t) return;
    const val = params[param.key as keyof MixParams];
    if (val < t.min) {
      out.push({ key: param.key, label: param.label, type: "below", val, limit: t.min });
    }
    if (val > t.max) {
      out.push({ key: param.key, label: param.label, type: "above", val, limit: t.max });
    }
  });
  return out;
}

export function totalWeight(mix: Lot[]): number {
  return mix.reduce((sum, lot) => sum + (lot.allocWeight || 0), 0);
}

export function producerWeight(mix: Lot[], producer: string): number {
  return mix
    .filter((lot) => lot.produtor === producer && (lot.allocBales || 0) > 0)
    .reduce((sum, lot) => sum + (lot.allocWeight || 0), 0);
}

export function baleWeight(lot: Lot): number {
  return lot.fardos > 0 ? lot.peso / lot.fardos : 0.213;
}

/**
 * Peso mínimo a alocar num lote que estava vazio para que, no total `currentTotalWeight + x`,
 * a participação do lote seja ≥ minLotPct (fração m).
 */
export function minWeightForNewLotShare(currentTotalWeight: number, minLotPct: number): number {
  const m = minLotPct / 100;
  if (m >= 1) return Number.POSITIVE_INFINITY;
  return (m / (1 - m)) * currentTotalWeight;
}

/**
 * Fardos mínimos para abrir um lote (alloc = 0) respeitando participação mínima.
 * Retorna Infinity se o estoque do lote for insuficiente para atingir o mínimo.
 */
export function minBalesToOpenNewLot(
  currentTotalWeight: number,
  baleW: number,
  minLotPct: number,
  maxFardosAvailable: number
): number {
  if (baleW <= 0 || maxFardosAvailable <= 0) return Number.POSITIVE_INFINITY;
  const minW = minWeightForNewLotShare(currentTotalWeight, minLotPct);
  const bales = Math.max(1, Math.ceil(minW / baleW - 1e-9));
  if (bales > maxFardosAvailable) return Number.POSITIVE_INFINITY;
  return bales;
}

/**
 * Fardos adicionais mínimos para um lote já ativo (peso lotWeight no total currentTotalWeight)
 * atingir participação ≥ minLotPct após o acréscimo no mesmo lote.
 * Retorna Infinity se maxAdditionalBales for insuficiente.
 */
export function minBalesToBringActiveLotToMin(
  lotWeight: number,
  currentTotalWeight: number,
  baleW: number,
  minLotPct: number,
  maxAdditionalBales: number
): number {
  const m = minLotPct / 100;
  if (m >= 1) return 1;
  if (baleW <= 0 || currentTotalWeight <= 0) return 1;
  if (lotWeight / currentTotalWeight >= m - 1e-9) return 1;
  const needW = (m * currentTotalWeight - lotWeight) / (1 - m);
  if (needW <= 0) return 1;
  const bales = Math.max(1, Math.ceil(needW / baleW - 1e-9));
  if (bales > maxAdditionalBales) return Number.POSITIVE_INFINITY;
  return bales;
}

/** Verifica participação mínima por lote na mistura atual. */
export function mixMeetsMinLotPct(mix: Lot[], rules: { minLotPct: number }): boolean {
  const active = mix.filter((m) => (m.allocBales || 0) > 0);
  const tw = totalWeight(mix);
  if (!active.length || tw <= 0) return true;
  return active.every(
    (l) => ((l.allocWeight || 0) / tw) * 100 >= rules.minLotPct - 1e-7
  );
}

export interface ConstraintSummary {
  feasible: boolean;
  reasons: string[];
  params: MixParams | null;
  violations: Violation[];
}

export function computeConstraintSummary(
  mix: Lot[],
  targetWeight: number,
  rules: { weightTol: number; maxLots: number; maxProdPct: number; minLotPct: number },
  thresholds: Thresholds
): ConstraintSummary {
  const active = mix.filter((m) => (m.allocBales || 0) > 0);
  const params = calcMixParams(active);
  if (!params) {
    return {
      feasible: false,
      reasons: ["Sem lotes alocados."],
      params: null,
      violations: [],
    };
  }

  const violations = checkViolations(params, thresholds);
  const reasons: string[] = [];
  const tolWeight = targetWeight * (rules.weightTol / 100);
  if (Math.abs(params.weight - targetWeight) > Math.max(0.01, tolWeight)) {
    reasons.push("Peso fora da tolerância.");
  }
  if (violations.length) reasons.push("Parâmetros de qualidade fora da faixa.");

  const lotsCount = active.length;
  if (lotsCount > rules.maxLots) reasons.push("Número de lotes acima do máximo permitido.");

  const tw = totalWeight(active);
  const producerGroups: Record<string, number> = {};
  active.forEach((lot) => {
    producerGroups[lot.produtor] = (producerGroups[lot.produtor] || 0) + (lot.allocWeight || 0);
  });
  Object.values(producerGroups).forEach((w) => {
    if (tw > 0 && (w / tw) * 100 > rules.maxProdPct + 1e-9) {
      reasons.push("Participação de produtor acima do limite.");
    }
  });

  active.forEach((lot) => {
    if (tw > 0 && ((lot.allocWeight || 0) / tw) * 100 < rules.minLotPct - 1e-9) {
      reasons.push("Participação mínima por lote não atendida.");
    }
  });

  return {
    feasible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    params,
    violations,
  };
}

export interface Diagnostic {
  code: string;
  message: string;
  suggestion: string;
}

export function infeasibilityDiagnosis(
  stock: Lot[],
  targetWeight: number,
  rules: { maxProdPct: number; minLotPct: number; maxLots: number }
): Diagnostic[] {
  const totalStockWeight = stock.reduce((sum, lot) => sum + (lot.peso || 0), 0);
  const diagnostics: Diagnostic[] = [];
  if (totalStockWeight < targetWeight) {
    diagnostics.push({
      code: "INSUFFICIENT_STOCK",
      message: `Estoque insuficiente (${totalStockWeight.toFixed(2)} ton < ${targetWeight.toFixed(2)} ton).`,
      suggestion: "Reduzir peso alvo ou incluir mais lotes no estoque.",
    });
  }
  const maxByProducers = [...new Set(stock.map((s) => s.produtor))].length * (rules.maxProdPct / 100) * targetWeight;
  if (maxByProducers < targetWeight) {
    diagnostics.push({
      code: "PRODUCER_CAP_TOO_STRICT",
      message: "Limite por produtor inviabiliza atingir o peso alvo com os produtores disponíveis.",
      suggestion: "Aumentar `maxProdPct` ou reduzir peso alvo.",
    });
  }
  if (rules.maxLots < Math.ceil(100 / Math.max(rules.minLotPct, 1))) {
    diagnostics.push({
      code: "LOT_LIMIT_CONFLICT",
      message: "Conflito potencial entre `maxLots` e `minLotPct`.",
      suggestion: "Aumentar `maxLots` ou reduzir `minLotPct`.",
    });
  }
  return diagnostics;
}
