import test from "node:test";
import assert from "node:assert/strict";

import { optimizeMix } from "../src/engine/optimizer.ts";
import { buildDefaultThresholds, DEFAULT_RULES } from "../src/domain/types.ts";

const stock = [
  { id: 1, produtor: "A", lote: "A1", peso: 8, fardos: 35, uhml: 1.17, str_val: 30, elg: 5.0, ui: 83, mic: 4.0, sf: 8.2, mst: 6.0, mat: 0.86, sci: 145 },
  { id: 2, produtor: "A", lote: "A2", peso: 7, fardos: 30, uhml: 1.18, str_val: 31, elg: 5.1, ui: 83, mic: 4.2, sf: 8.1, mst: 6.1, mat: 0.86, sci: 146 },
  { id: 3, produtor: "B", lote: "B1", peso: 10, fardos: 44, uhml: 1.19, str_val: 30.5, elg: 5.2, ui: 84, mic: 4.1, sf: 8.3, mst: 6.2, mat: 0.87, sci: 147 },
  { id: 4, produtor: "C", lote: "C1", peso: 9, fardos: 40, uhml: 1.18, str_val: 31.2, elg: 5.0, ui: 83.5, mic: 4.0, sf: 8.0, mst: 6.1, mat: 0.86, sci: 146 },
];

test("optimizer returns best and alternatives", () => {
  const result = optimizeMix({
    stock,
    targetWeight: 15,
    thresholds: buildDefaultThresholds(),
    rules: { ...DEFAULT_RULES, weightTol: 1.5, minLotPct: 4, maxLots: 6, maxProdPct: 60 },
    priority: "rotation_first",
    seed: 42,
  });
  assert.ok(result.best);
  assert.ok(Array.isArray(result.alternatives));
  assert.ok(result.alternatives.length >= 1);
  assert.ok(result.best.mix.length >= 1);
});
