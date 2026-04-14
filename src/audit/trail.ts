import type { Lot } from "../domain/stock.js";

export async function sha256String(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildStockFingerprint(stock: Lot[]): Promise<string> {
  const normalized = stock
    .map((l) => ({
      produtor: l.produtor,
      lote: l.lote,
      peso: Number((l.peso || 0).toFixed(4)),
      fardos: l.fardos || 0,
      uhml: l.uhml || 0,
      str_val: l.str_val || 0,
      elg: l.elg || 0,
      ui: l.ui || 0,
      mic: l.mic || 0,
      sf: l.sf || 0,
      mst: l.mst || 0,
      mat: l.mat || 0,
    }))
    .sort((a, b) => `${a.produtor}-${a.lote}`.localeCompare(`${b.produtor}-${b.lote}`));
  return sha256String(JSON.stringify(normalized));
}

export interface AuditRecord {
  ts: string;
  optimizerVersion: string;
  stockFingerprint: string;
  rulesSnapshot: Record<string, unknown>;
  thresholdsSnapshot: Record<string, unknown>;
  mixName: string;
  selected: {
    mode: string | null;
    score: number | null;
    feasible: boolean;
    reasons: string[];
  };
  alternatives: Array<{
    mode: string;
    score: number;
    feasible: boolean;
    reasons: string[];
  }>;
  diagnostics: Array<{ code: string; message: string; suggestion: string }>;
}

export async function buildAuditRecord({
  stock,
  rules,
  thresholds,
  optimizerVersion,
  best,
  alternatives,
  diagnostics,
  mixName,
}: {
  stock: Lot[];
  rules: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  optimizerVersion: string;
  best: { mode?: string; score?: number; feasible?: boolean; reasons?: string[] } | null;
  alternatives: Array<{ mode: string; score: number; feasible: boolean; reasons: string[] }>;
  diagnostics: Array<{ code: string; message: string; suggestion: string }>;
  mixName: string;
}): Promise<AuditRecord> {
  return {
    ts: new Date().toISOString(),
    optimizerVersion,
    stockFingerprint: await buildStockFingerprint(stock),
    rulesSnapshot: structuredClone(rules),
    thresholdsSnapshot: structuredClone(thresholds),
    mixName,
    selected: {
      mode: best?.mode || null,
      score: best?.score ?? null,
      feasible: best?.feasible ?? false,
      reasons: best?.reasons || [],
    },
    alternatives: (alternatives || []).map((a) => ({
      mode: a.mode,
      score: a.score,
      feasible: a.feasible,
      reasons: a.reasons,
    })),
    diagnostics: diagnostics || [],
  };
}
