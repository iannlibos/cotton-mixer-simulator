import test from "node:test";
import assert from "node:assert/strict";

import {
  isLotUsableForOptimization,
  missingRequiredHviParams,
} from "../src/engine/baseline.ts";

const completeLot = {
  id: 1,
  produtor: "JOSE EDUARDO BROCCO",
  lote: "302",
  peso: 31.33,
  fardos: 135,
  avgBaleKg: 232.07,
  custo: 0,
  sci: 248,
  str_val: 31.7,
  uhml: 31.44,
  ui: 83.8,
  mic: 4.41,
  sf: 8.8,
  elg: 8.4,
  mat: 0.864,
  mst: 0,
};

test("lot usability ignores stale hviComplete flag and optional MST/MAT", () => {
  assert.equal(
    isLotUsableForOptimization({ ...completeLot, mat: 0, mst: 0, hviComplete: false }),
    true,
  );
});

test("lot usability still requires current objective parameters", () => {
  const lot = { ...completeLot, str_val: 0, hviComplete: true };

  assert.equal(isLotUsableForOptimization(lot), false);
  assert.deepEqual(missingRequiredHviParams(lot), ["STR"]);
});
