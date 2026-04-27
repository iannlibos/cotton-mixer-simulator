import test from "node:test";
import assert from "node:assert/strict";

import {
  calcMixParams,
  checkViolations,
  computeConstraintSummary,
  weightedAverageExcludingZero,
} from "../src/engine/constraints.ts";
import { buildDefaultThresholds, DEFAULT_RULES } from "../src/domain/types.ts";

test("calcMixParams computes weighted average correctly", () => {
  const lots = [
    { allocWeight: 10, allocBales: 40, uhml: 30.48, str_val: 30, elg: 5, ui: 82, mic: 4, sf: 9, mst: 6, mat: 0.86, sci: 145 },
    { allocWeight: 20, allocBales: 80, uhml: 27.94, str_val: 32, elg: 5.2, ui: 83, mic: 4.1, sf: 8, mst: 6.2, mat: 0.87, sci: 150 },
  ];
  const p = calcMixParams(lots);
  assert.equal(p.weight, 30);
  assert.equal(p.bales, 120);
  assert.equal(p.uhml, 28.79); // rounded to 2 decimals per PARAMS
});

test("checkViolations flags out-of-range params", () => {
  const thresholds = buildDefaultThresholds();
  const params = { uhml: 25.4, str_val: 31, elg: 5, ui: 83, mic: 6, sf: 8, mst: 6, mat: 0.86 };
  const violations = checkViolations(params, thresholds);
  assert.ok(violations.some((v) => v.key === "uhml"));
  assert.ok(violations.some((v) => v.key === "mic"));
});

test("checkViolations ignores MST as a generation objective", () => {
  const thresholds = buildDefaultThresholds();
  const params = { uhml: 30, str_val: 31, elg: 5, ui: 83, mic: 4, sf: 8, mst: 99, mat: 0.86 };
  const violations = checkViolations(params, thresholds);
  assert.equal(violations.some((v) => v.key === "mst"), false);
});

test("weightedAverageExcludingZero ignores zero measures", () => {
  const lots = [
    { peso: 10, uhml: 30, str_val: 0, elg: 0, ui: 0, mic: 0, sf: 0, mst: 0, mat: 0, sci: 0 },
    { peso: 10, uhml: 28, str_val: 31, elg: 5, ui: 82, mic: 4, sf: 8, mst: 6, mat: 0.86, sci: 100 },
  ];
  assert.equal(weightedAverageExcludingZero(lots, "uhml", "peso"), 29);
  assert.equal(weightedAverageExcludingZero(lots, "str_val", "peso"), 31);
  assert.equal(weightedAverageExcludingZero([lots[0]], "uhml", "peso"), 30);
  assert.equal(weightedAverageExcludingZero([{ peso: 1, uhml: 0 }], "uhml", "peso"), null);
});

test("computeConstraintSummary marks feasible mix", () => {
  const thresholds = buildDefaultThresholds();
  const rules = { ...DEFAULT_RULES, weightTol: 1.0 };
  // Four producers at 5 ton each (25% < maxProdPct 35%); params stay in-band vs defaults
  const mix = [
    { produtor: "A", allocWeight: 5, allocBales: 22, uhml: 29.97, str_val: 30, elg: 5, ui: 83, mic: 4, sf: 8, mst: 6, mat: 0.86, sci: 145 },
    { produtor: "B", allocWeight: 5, allocBales: 22, uhml: 30.23, str_val: 31, elg: 5.1, ui: 83, mic: 4.1, sf: 8.2, mst: 6.3, mat: 0.86, sci: 146 },
    { produtor: "C", allocWeight: 5, allocBales: 22, uhml: 29.72, str_val: 30.5, elg: 5, ui: 82, mic: 4, sf: 8.1, mst: 6.1, mat: 0.86, sci: 144 },
    { produtor: "D", allocWeight: 5, allocBales: 22, uhml: 30.48, str_val: 31, elg: 5.05, ui: 84, mic: 4.05, sf: 8, mst: 6.2, mat: 0.87, sci: 147 },
  ];
  const summary = computeConstraintSummary(mix, 20, rules, thresholds);
  assert.equal(summary.feasible, true);
  assert.equal(summary.reasons.length, 0);
});
