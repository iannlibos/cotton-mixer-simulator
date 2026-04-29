import type { Lot } from "./stock.js";

/** Limites globais de fardos P e G disponibilizados para o gerador de mistura (somente lotes classificados). */
export interface BaleSizeCaps {
  maxP: number;
  maxG: number;
}

export interface BaleAvailability {
  totalP: number;
  totalG: number;
  avgKgPerP: number;
  avgKgPerG: number;
}

export function computeBaleAvailability(stock: Lot[]): BaleAvailability {
  let pF = 0;
  let gF = 0;
  let pKg = 0;
  let gKg = 0;
  for (const l of stock) {
    if (l.tamanho === "P") {
      pF += l.fardos;
      pKg += l.peso * 1000;
    } else if (l.tamanho === "G") {
      gF += l.fardos;
      gKg += l.peso * 1000;
    }
  }
  return {
    totalP: pF,
    totalG: gF,
    avgKgPerP: pF > 0 ? pKg / pF : 0,
    avgKgPerG: gF > 0 ? gKg / gF : 0,
  };
}

/** Total de fardos P e G atualmente alocados na mistura em construção. */
export function totalsAllocatedPG(mix: Lot[]): { p: number; g: number } {
  let p = 0;
  let g = 0;
  for (const l of mix) {
    const ab = l.allocBales ?? 0;
    if (l.tamanho === "P") p += ab;
    else if (l.tamanho === "G") g += ab;
  }
  return { p, g };
}

/**
 * Quantos fardos a mais este lote pode receber sem ultrapassar o próprio estoque
 * nem os tetos globais P/G (lotes sem tamanho não entram na contagem dos tetos).
 */
export function maxAdditionalBalesForLot(lot: Lot, mix: Lot[], caps: BaleSizeCaps | null): number {
  const ab = lot.allocBales ?? 0;
  const ownRoom = Math.max(0, lot.fardos - ab);
  if (!caps) return ownRoom;
  const { p, g } = totalsAllocatedPG(mix);
  if (lot.tamanho === "P") return Math.min(ownRoom, Math.max(0, caps.maxP - p));
  if (lot.tamanho === "G") return Math.min(ownRoom, Math.max(0, caps.maxG - g));
  return ownRoom;
}

export function violatesBaleCaps(mix: Lot[], caps: BaleSizeCaps | null): boolean {
  if (!caps) return false;
  const { p, g } = totalsAllocatedPG(mix);
  return p > caps.maxP + 1e-9 || g > caps.maxG + 1e-9;
}

/** Estimativa do peso máximo da mistura (kg) usando médias ponderadas por massa do estoque por tamanho. */
export function estimateMaxMixWeightKg(capP: number, capG: number, avail: BaleAvailability): number {
  const p = Math.max(0, capP);
  const g = Math.max(0, capG);
  return p * avail.avgKgPerP + g * avail.avgKgPerG;
}
