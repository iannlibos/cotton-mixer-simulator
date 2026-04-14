import test from "node:test";
import assert from "node:assert/strict";

import { parseStockRows } from "../src/io/csv.ts";

test("csv parser validates required columns", () => {
  const { errors } = parseStockRows([{ foo: 1 }]);
  assert.ok(errors.length > 0);
});

test("csv parser parses normalized rows", () => {
  const rows = [
    { PRODUTOR: "X", LOTE: "L1", PESO: "5.5", FARDOS: "24", UHML: "1.18", STR: "30", UI: "83", MIC: "4.1", SF: "8.1", ELG: "5.0", MAT: "0.86", MST: "6", SCI: "145" },
    { PRODUTOR: "Y", LOTE: "L2", PESO: "6.0", FARDOS: "27", UHML: "1.19", STR: "31", UI: "84", MIC: "4.0", SF: "8.0", ELG: "5.1", MAT: "0.87", MST: "6.1", SCI: "146" },
  ];
  const parsed = parseStockRows(rows);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.lots.length, 2);
  assert.equal(parsed.lots[0].produtor, "X");
  // UHML is standardized to mm internally; input in inches is converted.
  assert.equal(parsed.lots[0].uhml, 29.97);
});

test("csv parser accepts TOTAL (kg) column name (normalized to TOTAL_KG)", () => {
  const rows = [
    {
      PRODUTOR: "X",
      LOTE: "L1",
      "TOTAL (kg)": "5500",
      UHML: "1.18",
      STR: "30",
      UI: "83",
      MIC: "4.1",
      SF: "8.1",
      ELG: "5.0",
      MAT: "0.86",
      MST: "6",
      SCI: "145",
    },
  ];
  const parsed = parseStockRows(rows);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.lots.length, 1);
  assert.equal(parsed.lots[0].peso, 5.5);
});

test("csv parser rounds MIC/MST to stable decimals (float noise)", () => {
  const rows = [
    {
      PRODUTOR: "Z",
      LOTE: "LZ",
      PESO: "1",
      UHML: "30",
      STR: "30",
      UI: "80",
      MIC: "5.070000000000001",
      SF: "8",
      ELG: "6",
      MAT: "0.86",
      MST: "6.400000000000001",
      SCI: "124",
    },
  ];
  const parsed = parseStockRows(rows);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.lots[0].mic, 5.07);
  assert.equal(parsed.lots[0].mst, 6.4);
  assert.equal(parsed.lots[0].sci, 124);
  assert.equal(parsed.lots[0].hviComplete, true);
});

test("csv parser marks HVI incomplete when any quality field is zero", () => {
  const rows = [
    {
      PRODUTOR: "A",
      LOTE: "L1",
      PESO: "10",
      UHML: "30",
      STR: "0",
      UI: "80",
      MIC: "4",
      SF: "8",
      ELG: "5",
      MAT: "0.86",
      MST: "6",
      SCI: "120",
    },
  ];
  const parsed = parseStockRows(rows);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.lots[0].hviComplete, false);
  assert.ok(parsed.warnings.some((w) => w.includes("medidas HVI incompletas")));
});
