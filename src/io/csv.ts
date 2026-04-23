import Papa from "papaparse";
import { PARAMS } from "../domain/types.js";
import type { BaleSize, Lot } from "../domain/stock.js";
import { roundParam } from "../utils/paramFormat.js";

/** Chaves usadas em getField / ALIASES para cada parâmetro de qualidade. */
const PARAM_CSV_KEYS: Record<string, string> = {
  uhml: "UHML",
  str_val: "STR",
  elg: "ELG",
  ui: "UI",
  mic: "MIC",
  sf: "SF",
  mst: "MST",
  mat: "MAT",
};

function rowHasFullHviMeasures(row: Record<string, unknown>, hmap: Record<string, string>): boolean {
  for (const p of PARAMS) {
    const field = PARAM_CSV_KEYS[p.key];
    if (!field) return false;
    const raw = parseNumber(getField(row, field, hmap));
    if (raw == null || raw === 0) return false;
  }
  return true;
}

const REQUIRED_COLUMNS = ["PRODUTOR", "LOTE", "PESO"];
const ALIASES: Record<string, string[]> = {
  PRODUTOR: ["PRODUTOR", "FORNECEDOR", "PRODUCER", "SUPPLIER"],
  LOTE: ["LOTE", "LOT", "BATCH"],
  FARDOS: ["FARDOS", "BALES", "QTD"],
  PESO: ["PESO", "PESO_TON", "PESO_(TON)", "WEIGHT"],
  PESO_KG: ["TOTAL_(KG)", "TOTAL (KG)", "PESO_(KG)", "TOTAL_KG", "WEIGHT_KG", "PESO_KG"],
  CUSTO: ["CUSTO", "CUSTO_TON", "PRECO", "PRICE", "R$/TON", "CUSTO_(R$/TON)"],
  MST: ["MST", "UMIDADE"],
  UHML: ["UHML", "UHML_(MM)", "UHML_(IN)"],
  STR: ["STR"],
  SCI: ["SCI"],
  UI: ["UI"],
  MIC: ["MIC"],
  ELG: ["ELG"],
  MAT: ["MAT"],
  SF: ["SF"],
  TAMANHO: ["TAMANHO", "TAM", "SIZE", "TAMANHO_FARDO", "BALE_SIZE", "TIPO_FARDO"],
};

function parseBaleSize(value: unknown): BaleSize | null {
  if (value == null) return null;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;
  if (raw === "P" || raw.startsWith("PEQ")) return "P";
  if (raw === "G" || raw.startsWith("GRA")) return "G";
  return null;
}

function normalizeHeader(input: string): string {
  return String(input || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function headerLookup(row: Record<string, unknown>): Record<string, string> {
  const map: Record<string, string> = {};
  Object.keys(row || {}).forEach((k) => {
    map[normalizeHeader(k)] = k;
  });
  return map;
}

/** True if the header map contains any known column for mass (tonnes or kg). */
function hasWeightColumn(hmap: Record<string, string>): boolean {
  const keys = [...(ALIASES.PESO || []), ...(ALIASES.PESO_KG || [])];
  return keys.some((alias) => hmap[normalizeHeader(alias)]);
}

function getField(row: Record<string, unknown>, key: string, hmap?: Record<string, string>): unknown {
  const lookup = hmap || headerLookup(row);
  const candidates = ALIASES[key] || [key];
  for (const c of candidates) {
    const h = lookup[normalizeHeader(c)];
    if (h != null && row[h] != null && row[h] !== "") return row[h];
  }
  return null;
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const normalized = String(value).replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function validateRanges(lot: Lot): string[] {
  const warnings: string[] = [];
  const checks: [string, number | undefined, number, number][] = [
    // UHML is standardized in millimeters (mm).
    ["UHML", lot.uhml, 20.32, 38.1],
    ["STR", lot.str_val, 20, 45],
    ["UI", lot.ui, 70, 90],
    ["MIC", lot.mic, 2, 7],
    ["SF", lot.sf, 3, 20],
    ["ELG", lot.elg, 3, 9],
    ["MAT", lot.mat, 0.7, 1],
    ["MST", lot.mst, 2, 15],
  ];
  checks.forEach(([k, v, min, max]) => {
    if (v != null && (v < min || v > max)) {
      warnings.push(`${k} fora de faixa plausível (${v}).`);
    }
  });
  return warnings;
}

export interface ParseResult {
  lots: Lot[];
  errors: string[];
  warnings: string[];
}

export function parseStockRows(rows: Record<string, unknown>[]): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lots: Lot[] = [];
  const lotKeySet = new Set<string>();

  const first = rows[0] || {};
  const hmap = headerLookup(first as Record<string, unknown>);

  const hasProdutor = !!(hmap[normalizeHeader("PRODUTOR")] || hmap[normalizeHeader("FORNECEDOR")] || hmap[normalizeHeader("PRODUCER")] || hmap[normalizeHeader("SUPPLIER")]);
  const hasLote = !!(hmap[normalizeHeader("LOTE")] || hmap[normalizeHeader("LOT")] || hmap[normalizeHeader("BATCH")]);
  if (!hasProdutor) errors.push("Coluna obrigatória ausente: PRODUTOR");
  if (!hasLote) errors.push("Coluna obrigatória ausente: LOTE");
  if (!hasWeightColumn(hmap)) {
    errors.push(
      "Coluna obrigatória ausente: informe massa do lote (ex.: PESO em toneladas, ou TOTAL (kg) / equivalente em kg)."
    );
  }
  if (errors.length) return { lots: [], errors, warnings };

  const uhmlMmHeader = hmap[normalizeHeader("UHML_(MM)")] || hmap[normalizeHeader("UHML_MM")] || null;
  const uhmlInHeader = hmap[normalizeHeader("UHML_(IN)")] || hmap[normalizeHeader("UHML_IN")] || null;
  const uhmlSamples = rows
    .slice(0, 10)
    .map((r) => parseNumber(getField(r, "UHML", hmap)))
    .filter((v): v is number => v != null && v > 0);
  // If we can infer the unit from the header, prefer it; otherwise use a heuristic:
  // values > 5 are almost certainly already in millimeters, while typical inch values are ~1.0–1.4.
  const uhmlIsMm =
    (!!uhmlMmHeader && !uhmlInHeader) ||
    (!uhmlMmHeader && !uhmlInHeader && uhmlSamples.length > 0 && uhmlSamples.some((v) => v > 5));

  rows.forEach((row, idx) => {
    const i = idx + 1;
    const produtor = String(getField(row, "PRODUTOR", hmap) || "").trim();
    const lote = String(getField(row, "LOTE", hmap) || "").trim() || `L-${i}`;

    let peso = parseNumber(getField(row, "PESO", hmap)) || 0;
    if (peso <= 0) {
      const pesoKg = parseNumber(getField(row, "PESO_KG", hmap));
      if (pesoKg != null && pesoKg > 0) peso = pesoKg / 1000;
    }

    const fardosValue = parseNumber(getField(row, "FARDOS", hmap));
    const fardos = Number.isFinite(fardosValue) && fardosValue! > 0 ? Math.round(fardosValue!) : Math.round((peso * 1000) / 213);

    if (!produtor) {
      errors.push(`Linha ${i}: PRODUTOR vazio.`);
      return;
    }
    if (peso <= 0) {
      warnings.push(`Linha ${i}: PESO inválido ou zero; linha ignorada.`);
      return;
    }

    const uniqueKey = `${produtor}::${lote}`;
    if (lotKeySet.has(uniqueKey)) {
      errors.push(`Linha ${i}: lote duplicado (${produtor} / ${lote}).`);
      return;
    }
    lotKeySet.add(uniqueKey);

    let uhml = parseNumber(getField(row, "UHML", hmap)) || 0;
    // Standardize UHML to millimeters (mm) internally.
    if (!uhmlIsMm && uhml > 0 && uhml < 5) uhml = uhml * 25.4; // inches → mm

    const custoRaw = parseNumber(getField(row, "CUSTO", hmap)) || 0;
    const pesoTon = +peso.toFixed(2);
    const hviComplete = rowHasFullHviMeasures(row, hmap);
    if (!hviComplete) {
      warnings.push(
        `Linha ${i}: medidas HVI incompletas ou zeradas; lote fica no estoque mas é ignorado na geração de misturas até haver dados.`,
      );
    }

    const mstRaw = parseNumber(getField(row, "MST", hmap));
    const tamanho = parseBaleSize(getField(row, "TAMANHO", hmap));
    const lot: Lot = {
      id: idx,
      produtor,
      lote,
      peso: pesoTon,
      fardos,
      avgBaleKg: fardos > 0 ? +((pesoTon / fardos) * 1000).toFixed(2) : 0,
      custo: +custoRaw.toFixed(2),
      sci: roundParam("sci", parseNumber(getField(row, "SCI", hmap)) || 0),
      str_val: roundParam("str_val", parseNumber(getField(row, "STR", hmap)) || 0),
      uhml: +uhml.toFixed(2),
      ui: roundParam("ui", parseNumber(getField(row, "UI", hmap)) || 0),
      mic: roundParam("mic", parseNumber(getField(row, "MIC", hmap)) || 0),
      sf: roundParam("sf", parseNumber(getField(row, "SF", hmap)) || 0),
      elg: roundParam("elg", parseNumber(getField(row, "ELG", hmap)) || 0),
      mat: roundParam("mat", parseNumber(getField(row, "MAT", hmap)) || 0),
      mst: roundParam("mst", mstRaw != null && Number.isFinite(mstRaw) ? mstRaw : 0),
      tamanho,
      hviComplete,
    };

    validateRanges(lot).forEach((msg) => warnings.push(`Linha ${i}: ${msg}`));
    lots.push(lot);
  });

  return { lots, errors, warnings };
}

export function parseCSVFile(file: File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => {
        resolve(parseStockRows((res.data || []) as Record<string, unknown>[]));
      },
      error: (err) => {
        resolve({
          lots: [],
          errors: [`Falha no parse do CSV: ${err.message}`],
          warnings: [],
        });
      },
    });
  });
}

export { REQUIRED_COLUMNS };
