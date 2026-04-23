import type { Lot } from "./stock.js";
import { PARAMS, type ParamDef } from "./types.js";
import { paramPrec } from "../utils/paramFormat.js";

/** Pontos de corte internos (bins: (−∞, b0], (b0, b1], …, (b_{n−1}, ∞)). */
export const DEFAULT_QUALITY_BIN_BREAKPOINTS: Record<string, number[]> = {
  ui: [81, 82, 83, 84, 85],
  uhml: [28, 29, 30, 31, 32, 33],
  str_val: [28, 29, 30, 31, 32],
  elg: [5.5, 6.0, 6.5, 7.0],
  mic: [4.0, 4.5, 5.0, 5.5],
  sf: [8, 9, 10],
  mst: [6, 7, 8],
  mat: [0.85, 0.87, 0.89],
};

export const OVERVIEW_PARAM_KEYS = PARAMS.map((p) => p.key);

export interface QualityBinRow {
  label: string;
  fardos: number;
  kg: number;
  pct: number;
}

function binIndex(value: number, breakpoints: number[]): number {
  let i = 0;
  while (i < breakpoints.length && value > breakpoints[i]) i++;
  return i;
}

function formatBound(v: number, prec: number): string {
  return Number(v).toLocaleString("pt-BR", {
    minimumFractionDigits: prec,
    maximumFractionDigits: prec,
  });
}

export function binLabel(index: number, breakpoints: number[], prec: number): string {
  if (breakpoints.length === 0) return "Todos";
  if (index === 0) return `≤ ${formatBound(breakpoints[0], prec)}`;
  if (index === breakpoints.length)
    return `> ${formatBound(breakpoints[breakpoints.length - 1], prec)}`;
  const lo = breakpoints[index - 1];
  const hi = breakpoints[index];
  return `${formatBound(lo, prec)} a ${formatBound(hi, prec)}`;
}

function isPendingForOverview(lot: Lot, key: keyof Lot): boolean {
  if (lot.hviComplete === false) return true;
  const v = lot[key] as number;
  return !Number.isFinite(v) || v === 0;
}

export function aggregateQualityBins(
  lots: Lot[],
  paramKey: string,
  breakpoints: number[],
  prec: number,
): QualityBinRow[] {
  const key = paramKey as keyof Lot;
  const rows: QualityBinRow[] = [];
  const nBins = breakpoints.length + 1;
  const pendingIdx = nBins;

  const fardos = new Array<number>(nBins + 1).fill(0);
  const kg = new Array<number>(nBins + 1).fill(0);

  const totalKg = lots.reduce((s, l) => s + l.peso * 1000, 0);

  for (const lot of lots) {
    const wKg = lot.peso * 1000;
    if (isPendingForOverview(lot, key)) {
      fardos[pendingIdx] += lot.fardos;
      kg[pendingIdx] += wKg;
      continue;
    }
    const v = lot[key] as number;
    const idx = binIndex(v, breakpoints);
    fardos[idx] += lot.fardos;
    kg[idx] += wKg;
  }

  for (let i = 0; i < nBins; i++) {
    rows.push({
      label: binLabel(i, breakpoints, prec),
      fardos: fardos[i],
      kg: kg[i],
      pct: totalKg > 0 ? (kg[i] / totalKg) * 100 : 0,
    });
  }

  const hasPending = fardos[pendingIdx] > 0 || kg[pendingIdx] > 0;
  if (hasPending) {
    rows.push({
      label: "AGUARDA…",
      fardos: fardos[pendingIdx],
      kg: kg[pendingIdx],
      pct: totalKg > 0 ? (kg[pendingIdx] / totalKg) * 100 : 0,
    });
  }

  return rows;
}

export function getBreakpointsForParam(
  paramKey: string,
  overrides: Record<string, number[] | undefined> | undefined,
): number[] {
  const o = overrides?.[paramKey];
  if (o?.length) {
    return [...o].sort((a, b) => a - b);
  }
  return [...(DEFAULT_QUALITY_BIN_BREAKPOINTS[paramKey] ?? [])];
}

export function paramDefForKey(key: string): ParamDef | undefined {
  return PARAMS.find((p) => p.key === key);
}

export function parseBreakpointsInput(raw: string): number[] | null {
  const parts = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number.parseFloat(p.replace(",", "."));
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

export function breakpointsToInputString(b: number[], prec: number): string {
  return b.map((x) => x.toFixed(prec)).join(", ");
}

export function defaultPrecForOverviewKey(key: string): number {
  const d = paramDefForKey(key);
  return d ? d.prec : paramPrec(key);
}
