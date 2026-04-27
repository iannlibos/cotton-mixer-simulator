export interface ParamDef {
  key: string;
  label: string;
  good: boolean;
  defMin: number;
  defMax: number;
  prec: number;
}

export const PARAMS: ParamDef[] = [
  // UHML is standardized across the app in millimeters (mm).
  { key: "uhml", label: "UHML (mm)", good: true, defMin: 29.46, defMax: 30.99, prec: 2 },
  { key: "str_val", label: "STR", good: true, defMin: 29.0, defMax: 33.0, prec: 1 },
  { key: "elg", label: "ELG", good: true, defMin: 4.8, defMax: 5.5, prec: 2 },
  { key: "ui", label: "UI", good: true, defMin: 81.0, defMax: 85.0, prec: 1 },
  { key: "mic", label: "MIC", good: false, defMin: 3.8, defMax: 4.5, prec: 2 },
  { key: "sf", label: "SF", good: false, defMin: 7.0, defMax: 10.0, prec: 2 },
];

export const ALL_KEYS = ["uhml", "str_val", "elg", "ui", "mic", "sf", "mst", "mat", "sci"];

export interface EngineRules {
  minLotPct: number;
  maxProdPct: number;
  maxLots: number;
  rotation: number;
  weightTol: number;
}

export const DEFAULT_RULES: EngineRules = {
  minLotPct: 6,
  maxProdPct: 35,
  maxLots: 12,
  rotation: 70,
  weightTol: 0.5,
};

export const TARGET_RANGES: Record<string, number> = {
  uhml: 2.032,
  str_val: 3,
  elg: 1,
  ui: 4,
  mic: 0.6,
  sf: 3,
};

export const TARGET_TOL: Record<string, number> = {
  uhml: 0.254,
  str_val: 1,
  elg: 0.2,
  ui: 1,
  mic: 0.2,
  sf: 0.6,
};

export type Thresholds = Record<string, { min: number; max: number }>;

/** Arredonda limites ao número de casas decimais do parâmetro (evita floats longos na UI e no storage). */
export function roundParamLimit(n: number, prec: number): number {
  const f = 10 ** prec;
  return Math.round(n * f) / f;
}

/** Exibição estável dos limites (sem cauda de precisão binária). */
export function formatParamLimit(n: number, prec: number): string {
  if (!Number.isFinite(n)) return "";
  return String(roundParamLimit(n, prec));
}

export function buildDefaultThresholds(): Thresholds {
  const out: Thresholds = {};
  PARAMS.forEach((p) => {
    out[p.key] = { min: p.defMin, max: p.defMax };
  });
  return out;
}

export function ensureThresholds(raw: Thresholds | null | undefined): Thresholds {
  const th: Thresholds = raw && typeof raw === "object" ? structuredClone(raw) : buildDefaultThresholds();

  // Migration: older versions stored UHML in inches. If stored values look like inches, convert to mm.
  // Heuristic: realistic inch values are ~0.8–1.6; mm values are typically > 10.
  if (th.uhml && Number.isFinite(th.uhml.min) && Number.isFinite(th.uhml.max) && th.uhml.max > 0 && th.uhml.max < 5) {
    th.uhml = { min: th.uhml.min * 25.4, max: th.uhml.max * 25.4 };
  }

  PARAMS.forEach((p) => {
    if (!th[p.key]) th[p.key] = { min: p.defMin, max: p.defMax };
    if (!Number.isFinite(th[p.key].min)) th[p.key].min = p.defMin;
    if (!Number.isFinite(th[p.key].max)) th[p.key].max = p.defMax;
    if (th[p.key].max < th[p.key].min) {
      const mid = (p.defMin + p.defMax) / 2;
      th[p.key] = {
        min: roundParamLimit(mid - 0.1, p.prec),
        max: roundParamLimit(mid + 0.1, p.prec),
      };
    }
    th[p.key].min = roundParamLimit(th[p.key].min, p.prec);
    th[p.key].max = roundParamLimit(th[p.key].max, p.prec);
  });
  return th;
}
