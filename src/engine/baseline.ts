import { PARAMS, type Thresholds } from "../domain/types.js";
import type { Lot } from "../domain/stock.js";

/** Lotes utilizáveis na engine: exclui apenas os marcados como sem HVI completo no import. */
export function isLotUsableForOptimization(lot: Lot): boolean {
  return lot.hviComplete !== false;
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

const WIDE_PAD_RATIO = 0.08;

/**
 * Limites iniciais a partir do estoque: faixa min–max dos lotes avaliados + pequena folga.
 * Só usa lotes com HVI completo (mesma regra do CSV).
 */
export function computeQualityBaseline(lots: Lot[]): BaselineResult | null {
  const usable = lots.filter(isLotUsableForOptimization);
  if (!usable.length) return null;

  const thresholds: Thresholds = {};
  const means: Record<string, number> = {};
  const tw = usable.reduce((s, l) => s + l.peso, 0);
  if (tw <= 0) return null;

  PARAMS.forEach((p) => {
    const key = p.key as keyof Lot;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    let sumW = 0;
    let wMean = 0;
    usable.forEach((l) => {
      const v = l[key] as number;
      if (!Number.isFinite(v)) return;
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
      wMean += v * l.peso;
      sumW += l.peso;
    });
    means[p.key] = sumW > 0 ? wMean / sumW : (minV + maxV) / 2;
    const span = Math.max(maxV - minV, 1e-6);
    const pad = span * WIDE_PAD_RATIO;
    thresholds[p.key] = {
      min: +(minV - pad).toFixed(p.prec),
      max: +(maxV + pad).toFixed(p.prec),
    };
    if (thresholds[p.key].max < thresholds[p.key].min) {
      const m = (thresholds[p.key].min + thresholds[p.key].max) / 2;
      thresholds[p.key] = { min: m - 0.01, max: m + 0.01 };
    }
  });

  return { thresholds, sampleLots: usable.length, means };
}
