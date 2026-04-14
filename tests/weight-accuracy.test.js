import test from "node:test";
import assert from "node:assert/strict";

import { optimizeMix } from "../src/engine/optimizer.ts";
import { runAllStrategies } from "../src/engine/strategies.ts";
import { buildDefaultThresholds, DEFAULT_RULES } from "../src/domain/types.ts";

function makeLot(id, produtor, lote, fardos, opts = {}) {
  const peso = fardos * 0.213;
  return {
    id, produtor, lote, peso, fardos, avgBaleKg: 213, custo: opts.custo || 6200,
    uhml: opts.uhml ?? 29.8, str_val: opts.str_val ?? 30.5, elg: opts.elg ?? 5.1,
    ui: opts.ui ?? 83, mic: opts.mic ?? 4.1, sf: opts.sf ?? 8.5, mst: opts.mst ?? 6.2,
    mat: opts.mat ?? 0.86, sci: opts.sci ?? 146,
  };
}

function buildRealisticStock() {
  return [
    makeLot(1,  "PROD_A", "A-001", 53, { uhml: 30.2, str_val: 31.0, mic: 4.0, custo: 5800 }),
    makeLot(2,  "PROD_A", "A-002", 40, { uhml: 29.9, str_val: 30.8, mic: 4.2, custo: 5900 }),
    makeLot(3,  "PROD_B", "B-001", 60, { uhml: 29.5, str_val: 29.5, mic: 4.3, custo: 6100 }),
    makeLot(4,  "PROD_B", "B-002", 45, { uhml: 30.1, str_val: 31.2, mic: 3.9, custo: 6300 }),
    makeLot(5,  "PROD_C", "C-001", 70, { uhml: 29.7, str_val: 30.0, mic: 4.1, custo: 6000 }),
    makeLot(6,  "PROD_C", "C-002", 35, { uhml: 30.5, str_val: 32.0, mic: 4.0, custo: 6500 }),
    makeLot(7,  "PROD_D", "D-001", 55, { uhml: 29.8, str_val: 30.5, mic: 4.2, custo: 5700 }),
    makeLot(8,  "PROD_E", "E-001", 48, { uhml: 30.0, str_val: 31.5, mic: 4.1, custo: 6200 }),
    makeLot(9,  "PROD_F", "F-001", 42, { uhml: 29.6, str_val: 30.2, mic: 4.4, custo: 5500 }),
    makeLot(10, "PROD_G", "G-001", 65, { uhml: 30.3, str_val: 31.8, mic: 3.8, custo: 6800 }),
    makeLot(11, "PROD_H", "H-001", 38, { uhml: 29.9, str_val: 30.0, mic: 4.0, custo: 6100 }),
  ];
}

test("all 3 strategies hit target weight within tolerance for 68-ton target", async () => {
  const stock = buildRealisticStock();
  const targetW = 68;
  const thresholds = buildDefaultThresholds();
  const rules = { ...DEFAULT_RULES };
  const results = await runAllStrategies(stock, targetW, rules, thresholds);

  assert.ok(results.length >= 1, "Should produce at least 1 strategy result");

  const tol = targetW * rules.weightTol / 100;
  for (const r of results) {
    const diff = Math.abs(r.params.weight - targetW);
    assert.ok(
      diff <= Math.max(0.5, tol),
      `Strategy "${r.strategy.name}": weight ${r.params.weight.toFixed(2)} ton ` +
      `deviates by ${diff.toFixed(2)} from target ${targetW} (tol=${tol.toFixed(2)})`
    );
  }
});

test("all 3 strategies hit target weight for 30-ton target", async () => {
  const stock = buildRealisticStock();
  const targetW = 30;
  const thresholds = buildDefaultThresholds();
  const rules = { ...DEFAULT_RULES };
  const results = await runAllStrategies(stock, targetW, rules, thresholds);

  assert.ok(results.length >= 1, "Should produce at least 1 strategy result");

  const tol = targetW * rules.weightTol / 100;
  for (const r of results) {
    const diff = Math.abs(r.params.weight - targetW);
    assert.ok(
      diff <= Math.max(0.5, tol),
      `Strategy "${r.strategy.name}": weight ${r.params.weight.toFixed(2)} ton ` +
      `deviates by ${diff.toFixed(2)} from target ${targetW} (tol=${tol.toFixed(2)})`
    );
  }
});

test("weight accuracy with tight constraints (many parameters enabled)", async () => {
  const stock = buildRealisticStock();
  const targetW = 50;
  const thresholds = buildDefaultThresholds();
  thresholds.uhml = { min: 29.6, max: 30.4 };
  thresholds.str_val = { min: 29.5, max: 32.0 };
  thresholds.mic = { min: 3.9, max: 4.3 };
  const rules = { ...DEFAULT_RULES, maxProdPct: 30 };
  const results = await runAllStrategies(stock, targetW, rules, thresholds);

  assert.ok(results.length >= 1, "Should produce at least 1 strategy result");

  for (const r of results) {
    const diff = Math.abs(r.params.weight - targetW);
    assert.ok(
      diff <= 1.0,
      `Strategy "${r.strategy.name}": weight ${r.params.weight.toFixed(2)} ton ` +
      `deviates by ${diff.toFixed(2)} from target ${targetW} (max 1.0 ton)`
    );
  }
});

test("weight should not be drastically below target (regression test)", async () => {
  const stock = buildRealisticStock();
  const targetW = 68;
  const thresholds = buildDefaultThresholds();
  const rules = { ...DEFAULT_RULES };
  const results = await runAllStrategies(stock, targetW, rules, thresholds);

  for (const r of results) {
    assert.ok(
      r.params.weight >= targetW * 0.5,
      `REGRESSION: Strategy "${r.strategy.name}" returned ${r.params.weight.toFixed(2)} ton, ` +
      `which is less than 50% of target ${targetW}. The engine must not stall at seed weight.`
    );
  }
});

test("optimizer: nenhum lote ativo fica abaixo de minLotPct (evita fragmentação)", () => {
  const stock = buildRealisticStock();
  const targetW = 50;
  const thresholds = buildDefaultThresholds();
  const rules = { ...DEFAULT_RULES, minLotPct: 6 };
  const result = optimizeMix({
    stock,
    targetWeight: targetW,
    thresholds,
    rules,
    seed: 12345,
  });
  assert.ok(result.best?.mix?.length, "deve haver mistura");
  const tw = result.best.mix.reduce((s, l) => s + (l.allocWeight || 0), 0);
  for (const l of result.best.mix) {
    const pct = tw > 0 ? ((l.allocWeight || 0) / tw) * 100 : 0;
    assert.ok(
      pct >= rules.minLotPct - 0.2,
      `lote ${l.lote}: ${pct.toFixed(2)}% < ${rules.minLotPct}%`
    );
  }
});

test("Limpar Estoque sem custo prioriza giro: maior fornecedor no estoque entra na mistura", async () => {
  const thresholds = buildDefaultThresholds();
  const rules = { ...DEFAULT_RULES };
  const big1 = makeLot(1, "FORN_GRANDE", "G1", 200, {
    custo: 0,
    uhml: 29.9,
    str_val: 30.5,
    mic: 4.1,
  });
  const big2 = makeLot(2, "FORN_GRANDE", "G2", 150, {
    custo: 0,
    uhml: 30.0,
    str_val: 30.6,
    mic: 4.0,
  });
  const small1 = makeLot(3, "PEQ_A", "S1", 30, {
    custo: 0,
    uhml: 29.5,
    str_val: 28.0,
    mic: 4.4,
  });
  const small2 = makeLot(4, "PEQ_B", "S2", 25, {
    custo: 0,
    uhml: 29.4,
    str_val: 28.5,
    mic: 4.35,
  });
  const stock = [big1, big2, small1, small2];
  const targetW = 35;
  const results = await runAllStrategies(stock, targetW, rules, thresholds);
  const cleanup = results.find((r) => r.strategy.id === "cleanup");
  assert.ok(cleanup, "deve gerar estratégia Limpar Estoque");
  const bigW = cleanup.lots
    .filter((l) => l.produtor === "FORN_GRANDE")
    .reduce((s, l) => s + (l.allocWeight || 0), 0);
  assert.ok(
    bigW > 1,
    "o fornecedor com maior peso no estoque deve ter participação relevante (giro)"
  );
});
