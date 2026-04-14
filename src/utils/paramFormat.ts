import { PARAMS } from "../domain/types";

/** Decimal places per HVI parameter; SCI is a whole-number index in the UI. */
const PREC_MAP: Record<string, number> = {
  ...(Object.fromEntries(PARAMS.map((p) => [p.key, p.prec])) as Record<string, number>),
  sci: 0,
};

export function paramPrec(key: string): number {
  return PREC_MAP[key] ?? 2;
}

/** Stable numeric value for storage (avoids float artifacts from CSV/Excel). */
export function roundParam(key: string, value: number): number {
  const prec = PREC_MAP[key];
  if (prec === undefined) return value;
  return +Number(value).toFixed(prec);
}

/** Display string for tables, tooltips, and exports. */
export function fmtParam(key: string, value: number): string {
  const prec = PREC_MAP[key];
  if (prec === undefined) return String(value);
  return Number(value).toFixed(prec);
}
