import type { Thresholds } from "./types.js";

/**
 * Tamanho físico do fardo do lote:
 * - "P" (pequeno): 1,10 × 0,58 m
 * - "G" (grande): 1,40 × 0,58 m
 * Quando ausente (undefined/null), o lote ainda não teve seu tamanho informado.
 */
export type BaleSize = "P" | "G";

/** Dimensões físicas dos fardos e da área útil da abertura (metros). */
export const BALE_WIDTH_M = 0.58;
export const BALE_P_LENGTH_M = 1.1;
export const BALE_G_LENGTH_M = 1.4;
export const OPENING_AREA_LENGTH_M = 45.35;
/**
 * Largura útil do braço do Blendomat: 2,20 m — dimensão escolhida
 * para caber exatamente dois fardos P transversais (2 × 1,10 m).
 */
export const OPENING_AREA_WIDTH_M = 2.2;

export interface Lot {
  id: number;
  produtor: string;
  lote: string;
  peso: number;
  fardos: number;
  avgBaleKg: number;
  custo: number;
  sci: number;
  str_val: number;
  uhml: number;
  ui: number;
  mic: number;
  sf: number;
  elg: number;
  mat: number;
  mst: number;
  /** Tamanho do fardo do lote (P ou G). Pode estar ausente até o dado entrar no sistema. */
  tamanho?: BaleSize | null;
  allocBales?: number;
  allocWeight?: number;
  qScore?: number;
  /** false = import com alguma medida HVI zero/ausente (não entra na otimização). */
  hviComplete?: boolean;
}

export interface MixParams {
  weight: number;
  bales: number;
  uhml: number;
  str_val: number;
  elg: number;
  ui: number;
  mic: number;
  sf: number;
  mst: number;
  mat: number;
  sci: number;
  custoTon: number;
  custoTotal: number;
}

export interface HistoryRecord {
  id: number;
  name: string;
  date: string;
  params: MixParams;
  thresholds: Thresholds;
  score: number;
  lots: Lot[];
}
