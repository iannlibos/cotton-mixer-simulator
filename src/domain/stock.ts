import type { Thresholds } from "./types.js";

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
