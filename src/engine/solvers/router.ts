import { optimizeMix, type OptimizerResult } from "../optimizer.js";
import { monteCarloOptimize } from "./montecarlo.js";
import { saOptimize } from "./annealing.js";
import type { SolverMode, SolverInput, SolverOptions, SolverResult } from "./types.js";

export async function solverRouter(
  mode: SolverMode,
  input: SolverInput,
  options: SolverOptions = {},
): Promise<SolverResult> {
  const t0 = performance.now();

  let classicResult: OptimizerResult | null = null;
  let solverResult: OptimizerResult;

  if (mode === "classic") {
    solverResult = optimizeMix({
      stock: input.stock,
      targetWeight: input.targetWeight,
      thresholds: input.thresholds,
      rules: input.rules,
      priority: input.priority,
      seed: input.seed,
      targetValues: input.targetValues,
      baleSizeCaps: input.baleSizeCaps,
    });
  } else {
    classicResult = optimizeMix({
      stock: input.stock,
      targetWeight: input.targetWeight,
      thresholds: input.thresholds,
      rules: input.rules,
      priority: input.priority,
      seed: input.seed,
      targetValues: input.targetValues,
      baleSizeCaps: input.baleSizeCaps,
    });

    if (mode === "montecarlo") {
      solverResult = await monteCarloOptimize(input, options);
    } else {
      solverResult = saOptimize(input, options);
    }
  }

  const elapsed = Math.round(performance.now() - t0);
  const solverScore = solverResult.best?.score ?? null;
  const classicScore = classicResult?.best?.score ?? (mode === "classic" ? solverScore : null);

  let improvement: number | null = null;
  if (classicScore != null && solverScore != null && classicScore !== 0) {
    improvement = ((classicScore - solverScore) / Math.abs(classicScore)) * 100;
  }

  return {
    result: solverResult,
    solverMode: mode,
    elapsed,
    classicScore,
    solverScore,
    improvement,
  };
}
