import { PARAMS, type Thresholds, roundParamLimit } from "../domain/types.js";
import type { Lot } from "../domain/stock.js";

export function missingRequiredHviParams(lot: Lot): string[] {
  return PARAMS
    .filter((p) => {
      const v = lot[p.key as keyof Lot] as number;
      return !Number.isFinite(v) || v === 0;
    })
    .map((p) => p.label);
}

/** Lotes utilizáveis na engine: recalcula os parâmetros obrigatórios atuais. */
export function isLotUsableForOptimization(lot: Lot): boolean {
  return missingRequiredHviParams(lot).length === 0;
}

export function filterUsableLots(lots: Lot[]): Lot[] {
  return lots.filter(isLotUsableForOptimization);
}

export interface BaselineResult {
  thresholds: Thresholds;
  /** Lotes com todas as medidas não nulas e ≠ 0 usados nas estatísticas */
  sampleLots: number;
  /** Médias por parâmetro (peso do lote como peso estatístico) */
  means: Record<string, number>;
}

/** Folga (8% da extensão do estoque) aplicada **para dentro** do min–max dos lotes. */
const INNER_PAD_RATIO = 0.08;

export interface HviParamStats {
  min: number;
  max: number;
  mean: number;
}

/**
 * Estatísticas HVI por parâmetro a partir de lotes utilizáveis (HVI completo).
 * Uma chave fica `null` se não houver nenhum valor finito nesse parâmetro.
 */
export function collectHviParamStats(
  lots: Lot[],
): Record<string, HviParamStats | null> | null {
  const usable = lots.filter(isLotUsableForOptimization);
  if (!usable.length) return null;

  const byKey: Record<string, HviParamStats | null> = {};
  for (const p of PARAMS) {
    const key = p.key as keyof Lot;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    let sumW = 0;
    let wSum = 0;
    for (const l of usable) {
      const v = l[key] as number;
      if (!Number.isFinite(v)) continue;
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
      wSum += v * l.peso;
      sumW += l.peso;
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV) || minV === Number.POSITIVE_INFINITY) {
      byKey[p.key] = null;
    } else {
      const mean = sumW > 0 ? wSum / sumW : (minV + maxV) / 2;
      byKey[p.key] = { min: minV, max: maxV, mean };
    }
  }
  return byKey;
}

/**
 * Limites iniciais da mistura: faixa com folga de 8% **para dentro** do min–max do estoque (HVI completo),
 * para a engine otimizar dentro do recorte disponível, com margem ajustável.
 */
export function computeQualityBaseline(lots: Lot[]): BaselineResult | null {
  const byParam = collectHviParamStats(lots);
  if (!byParam) return null;

  const usable = lots.filter(isLotUsableForOptimization);
  if (!usable.length) return null;

  const any = PARAMS.some((p) => byParam[p.key] !== null);
  if (!any) return null;

  const thresholds: Thresholds = {};
  const means: Record<string, number> = {};

  PARAMS.forEach((p) => {
    const st = byParam[p.key];
    if (!st) {
      means[p.key] = (p.defMin + p.defMax) / 2;
      thresholds[p.key] = { min: p.defMin, max: p.defMax };
      return;
    }

    means[p.key] = st.mean;
    const { min: minV, max: maxV } = st;
    const span = Math.max(maxV - minV, 1e-6);
    const pad = span * INNER_PAD_RATIO;
    const innerMin = minV + pad;
    const innerMax = maxV - pad;

    let minT: number;
    let maxT: number;

    if (innerMin < innerMax) {
      minT = roundParamLimit(innerMin, p.prec);
      maxT = roundParamLimit(innerMax, p.prec);
    } else {
      const mid = (minV + maxV) / 2;
      const step = 10 ** -p.prec;
      minT = roundParamLimit(mid - step, p.prec);
      maxT = roundParamLimit(mid + step, p.prec);
    }

    if (minT >= maxT) {
      const mid = (minV + maxV) / 2;
      const w = 2 * 10 ** -p.prec;
      minT = roundParamLimit(mid - w, p.prec);
      maxT = roundParamLimit(mid + w, p.prec);
    }
    if (minT >= maxT) {
      minT = roundParamLimit(minV, p.prec);
      maxT = roundParamLimit(maxV, p.prec);
    }
    if (minT > maxT) {
      const t = minT;
      minT = maxT;
      maxT = t;
    }

    thresholds[p.key] = { min: minT, max: maxT };
  });

  return { thresholds, sampleLots: usable.length, means };
}
