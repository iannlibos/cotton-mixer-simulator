import { optimizeMix } from "../optimizer.js";
import type { SolverInput, SolverOptions } from "./types.js";
import type { OptimizerResult } from "../optimizer.js";
import { yieldToUi } from "../yield-ui.js";

export async function monteCarloOptimize(
  input: SolverInput,
  options: SolverOptions = {},
): Promise<OptimizerResult> {
  const iterations = options.mcIterations ?? 20;
  const baseSeed = input.seed ?? Date.now();

  let bestResult: OptimizerResult | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < iterations; i++) {
    options.onMcProgress?.(
      `Monte Carlo: iteração ${i + 1}/${iterations}…`,
      i + 1,
      iterations,
    );
    if (options.onMcProgress) await yieldToUi();

    const seed = baseSeed + i * 7919;
    const result = optimizeMix({
      stock: input.stock,
      targetWeight: input.targetWeight,
      thresholds: input.thresholds,
      rules: input.rules,
      priority: input.priority,
      seed,
      targetValues: input.targetValues,
    });

    if (result.best) {
      const score = result.best.score;
      if (score < bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }
  }

  if (bestResult) return bestResult;

  return optimizeMix({
    stock: input.stock,
    targetWeight: input.targetWeight,
    thresholds: input.thresholds,
    rules: input.rules,
    priority: input.priority,
    seed: baseSeed,
    targetValues: input.targetValues,
  });
}
