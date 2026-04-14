import type { Lot } from "../../domain/stock.js";
import type { Thresholds, EngineRules } from "../../domain/types.js";
import type { OptimizerResult } from "../optimizer.js";

export type SolverMode = "classic" | "montecarlo" | "sa";

export interface SolverInput {
  stock: Lot[];
  targetWeight: number;
  thresholds: Thresholds;
  rules: EngineRules;
  priority?: string;
  seed?: number;
  targetValues?: Record<string, number> | null;
}

export interface SolverOptions {
  mcIterations?: number;
  saIterations?: number;
  saT0?: number;
  saTmin?: number;
  saAlpha?: number;
  /** Chamado a cada iteração do Monte Carlo (para UI). */
  onMcProgress?: (label: string, current: number, total: number) => void;
}

export interface SolverResult {
  result: OptimizerResult;
  solverMode: SolverMode;
  elapsed: number;
  classicScore: number | null;
  solverScore: number | null;
  improvement: number | null;
}
