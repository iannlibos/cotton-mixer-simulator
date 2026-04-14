import { PARAMS } from "../domain/types.js";
import type { Lot, MixParams } from "../domain/stock.js";
import type { Thresholds } from "../domain/types.js";
import type { EngineRules } from "../domain/types.js";
import { ALL_KEYS } from "../domain/types.js";
import {
  baleWeight,
  calcMixParams,
  checkViolations,
  minBalesToBringActiveLotToMin,
  minBalesToOpenNewLot,
  weightedAverage,
} from "./constraints.js";
import { filterUsableLots } from "./baseline.js";
import { lotQualityScore, buildObjectiveWeights, localImprove } from "./shared-improve.js";
import { yieldToUi } from "./yield-ui.js";

export interface Strategy {
  id: string;
  name: string;
  icon: string;
  color: string;
  desc: string;
  score: (l: Lot) => number;
}

export interface StrategyResult {
  strategy: Strategy;
  lots: Lot[];
  params: MixParams;
  violations: ReturnType<typeof checkViolations>;
  elapsed: number;
}

function qualityIndex(l: Lot, thresholds: Thresholds): number {
  let total = 0, count = 0;
  PARAMS.forEach(p => {
    const t = thresholds[p.key];
    if (!t) return;
    const mid = (t.min + t.max) / 2;
    const halfR = (t.max - t.min) / 2;
    if (!halfR) return;
    const val = (l[p.key as keyof Lot] as number) || 0;
    const dist = Math.abs(val - mid) / halfR;
    let score = Math.max(0, (1 - dist) * 100);
    const side = p.good ? (val - mid) : (mid - val);
    if (side > 0) score = Math.min(100, score + 5);
    total += score;
    count++;
  });
  return count > 0 ? total / count : 50;
}

export function iqColor(iq: number): string {
  if (iq >= 75) return "#10b981";
  if (iq >= 55) return "#22d3ee";
  if (iq >= 35) return "#fbbf24";
  return "#ef4444";
}

export function iqLabel(iq: number): string {
  if (iq >= 75) return "Excelente";
  if (iq >= 55) return "Bom";
  if (iq >= 35) return "Regular";
  return "Fraco";
}

export { qualityIndex };

function hasCostData(stock: Lot[]): boolean {
  return stock.some(s => s.custo > 0);
}

function medianCost(stock: Lot[]): number {
  const c = stock.map(s => s.custo).filter(x => x > 0).sort((a, b) => a - b);
  return c[Math.floor(c.length / 2)] || 1;
}

function volumePressure(l: Lot, stock: Lot[]): number {
  if (!stock.length) return 1;
  const avgPeso = stock.reduce((s, x) => s + x.peso, 0) / stock.length;
  return avgPeso > 0 ? (l.peso / avgPeso) : 1;
}

function costRatio(l: Lot, stock: Lot[]): number {
  if (!hasCostData(stock)) return 0;
  const mc = medianCost(stock);
  return mc > 0 ? l.custo / mc : 0;
}

/** Peso relativo do fornecedor no estoque utilizável (0–1), para priorizar giro sem depender só de custo. */
function producerWeightsForNorm(usable: Lot[]): {
  totalW: number;
  byProdW: Record<string, number>;
  lotsPerProd: Record<string, number>;
} {
  const byProdW: Record<string, number> = {};
  const lotsPerProd: Record<string, number> = {};
  let totalW = 0;
  for (const x of usable) {
    totalW += x.peso;
    byProdW[x.produtor] = (byProdW[x.produtor] || 0) + x.peso;
    lotsPerProd[x.produtor] = (lotsPerProd[x.produtor] || 0) + 1;
  }
  return { totalW, byProdW, lotsPerProd };
}

function qNorm(l: Lot, stock: Lot[], thresholds: Thresholds): number {
  const qiAll = stock.map(s => qualityIndex(s, thresholds));
  const qMin = Math.min(...qiAll), qMax = Math.max(...qiAll);
  return (qMax !== qMin) ? ((qualityIndex(l, thresholds) - qMin) / (qMax - qMin)) : 0.5;
}

export function buildStrategies(stock: Lot[], thresholds: Thresholds): Strategy[] {
  const usable = filterUsableLots(stock);
  if (!usable.length) {
    return [
      {
        id: "cleanup",
        name: "Limpar Estoque",
        icon: "🧹",
        color: "#ef4444",
        desc: "Sem lotes utilizáveis.",
        score: () => 0,
      },
      {
        id: "cheapest",
        icon: "💰",
        color: "#22d3ee",
        name: "Menor Custo",
        desc: "Sem lotes utilizáveis.",
        score: () => 0,
      },
      {
        id: "balanced",
        name: "Balanceado",
        icon: "⚖️",
        color: "#a78bfa",
        desc: "Sem lotes utilizáveis.",
        score: () => 0,
      },
    ];
  }

  const hcd = hasCostData(usable);
  const { totalW, byProdW, lotsPerProd } = producerWeightsForNorm(usable);

  const uniqProdShares = [...new Set(usable.map((l) => (totalW > 0 ? (byProdW[l.produtor] || 0) / totalW : 0)))];
  const minPS = uniqProdShares.length ? Math.min(...uniqProdShares) : 0;
  const maxPS = uniqProdShares.length ? Math.max(...uniqProdShares) : 1;
  const psSpan = maxPS > minPS ? maxPS - minPS : 1;

  function producerShareNorm(l: Lot): number {
    const ps = totalW > 0 ? (byProdW[l.produtor] || 0) / totalW : 0;
    return maxPS > minPS ? (ps - minPS) / psSpan : 0.5;
  }

  const heteroRaw = usable.map((l) =>
    (lotsPerProd[l.produtor] || 0) >= 2 ? 1 - l.peso / (byProdW[l.produtor] || 1) : 0
  );
  const hMin = heteroRaw.length ? Math.min(...heteroRaw) : 0;
  const hMax = heteroRaw.length ? Math.max(...heteroRaw) : 1;
  const hSpan = hMax > hMin ? hMax - hMin : 1;
  const heteroNormById: Record<number, number> = {};
  usable.forEach((l, i) => {
    const r = heteroRaw[i] ?? 0;
    heteroNormById[l.id] = hMax > hMin ? (r - hMin) / hSpan : 0;
  });

  const scoreBase = (l: Lot) => ({
    q: qNorm(l, usable, thresholds),
    vp: volumePressure(l, usable),
    cr: costRatio(l, usable),
    psn: producerShareNorm(l),
    hn: heteroNormById[l.id] ?? 0,
  });

  return [
    {
      id: "cleanup",
      name: "Limpar Estoque",
      icon: "🧹",
      color: "#ef4444",
      desc: hcd
        ? "Prioriza giro (peso do fornecedor no estoque), lotes volumosos, qualidade mais baixa e custo alto. Evita ignorar o maior fornecedor e favorece misturar mais de um lote do mesmo produtor."
        : "Prioriza giro do fornecedor no estoque, lotes volumosos e qualidade mais baixa. Evita ignorar o maior fornecedor e favorece misturar mais de um lote do mesmo produtor.",
      score: (l: Lot) => {
        const { q, vp, cr, psn, hn } = scoreBase(l);
        return hcd
          ? (1 - q) * 0.28 + vp * 0.16 + cr * 0.17 + psn * 0.34 + hn * 0.05
          : (1 - q) * 0.26 + vp * 0.17 + psn * 0.47 + hn * 0.10;
      },
    },
    {
      id: "cheapest",
      icon: "💰",
      color: "#22d3ee",
      name: hcd ? "Menor Custo" : "Melhor Qualidade",
      desc: hcd
        ? "Minimiza R$/ton priorizando lotes baratos e volumosos."
        : "Prioriza lotes com melhor qualidade e maior volume em estoque. Considera o peso do fornecedor no estoque quando não há custo.",
      score: (l: Lot) => {
        const { q, vp, cr, psn } = scoreBase(l);
        return hcd
          ? cr * 0.50 + (1 - q) * 0.20 + vp * 0.30
          : (1 - q) * 0.26 + vp * 0.22 + q * 0.40 + psn * 0.12;
      },
    },
    {
      id: "balanced",
      name: "Balanceado",
      icon: "⚖️",
      color: "#a78bfa",
      desc: hcd
        ? "Equilíbrio entre custo, qualidade e giro de estoque."
        : "Equilíbrio entre qualidade, giro por fornecedor e volume. Diversifica o consumo.",
      score: (l: Lot) => {
        const { q, vp, cr, psn } = scoreBase(l);
        return hcd
          ? (1 - q * 0.5) * 0.35 + vp * 0.30 + cr * 0.35
          : (1 - q * 0.5) * 0.42 + vp * 0.38 + psn * 0.20;
      },
    },
  ];
}

function isParamEnabled(_k: string): boolean {
  return true;
}

export function optimizeStrategy(
  strategy: Strategy,
  stock: Lot[],
  targetW: number,
  rules: EngineRules,
  thresholds: Thresholds,
  priority = "rotation_first",
): StrategyResult | null {
  const usable = filterUsableLots(stock);
  if (!usable.length) return null;

  const mix = usable.map(l => ({
    ...l,
    sScore: strategy.score(l),
    allocBales: 0,
    allocWeight: 0,
  }));

  const isAsc = strategy.id === "cheapest" && hasCostData(stock);
  const sortFn = (a: Lot & { sScore: number }, b: Lot & { sScore: number }) =>
    isAsc ? (a.sScore - b.sScore) : (b.sScore - a.sScore);
  mix.sort(sortFn);

  let _tw = 0, _ac = 0;
  const _pw: Record<string, number> = {};
  const _ws: Record<string, number> = {};
  ALL_KEYS.forEach(k => { _ws[k] = 0; });
  _ws["custo"] = 0;

  function syncAll() {
    _tw = 0; _ac = 0;
    for (const k in _pw) _pw[k] = 0;
    ALL_KEYS.forEach(k => { _ws[k] = 0; });
    _ws["custo"] = 0;
    for (const m of mix) {
      if ((m.allocBales ?? 0) > 0) {
        _tw += m.allocWeight ?? 0;
        _ac++;
        _pw[m.produtor] = (_pw[m.produtor] || 0) + (m.allocWeight ?? 0);
        ALL_KEYS.forEach(k => {
          _ws[k] += ((m as unknown as Record<string, number>)[k] || 0) * (m.allocWeight ?? 0);
        });
        _ws["custo"] += (m.custo || 0) * (m.allocWeight ?? 0);
      }
    }
  }

  function apply(l: typeof mix[0], inc: number) {
    const wasAct = (l.allocBales ?? 0) > 0;
    const oldW = l.allocWeight ?? 0;
    l.allocBales = (l.allocBales ?? 0) + inc;
    if (l.allocBales < 0) l.allocBales = 0;
    l.allocWeight = l.allocBales * baleWeight(l);
    const dW = (l.allocWeight ?? 0) - oldW;
    _tw += dW;
    if (!wasAct && (l.allocBales ?? 0) > 0) _ac++;
    if (wasAct && (l.allocBales ?? 0) <= 0) _ac--;
    _pw[l.produtor] = (_pw[l.produtor] || 0) + dW;
    ALL_KEYS.forEach(k => {
      _ws[k] += ((l as unknown as Record<string, number>)[k] || 0) * dW;
    });
    _ws["custo"] += (l.custo || 0) * dW;
  }

  function canAddR(l: typeof mix[0], inc: number, relaxPct: number): boolean {
    const dW = inc * baleWeight(l);
    const newTW = _tw + dW;
    if (newTW <= 0) return true;
    const curPW = _pw[l.produtor] || 0;
    if (((curPW + dW) / newTW * 100) > rules.maxProdPct) return false;
    for (const p of PARAMS) {
      if (!isParamEnabled(p.key)) continue;
      const t = thresholds[p.key]; if (!t) continue;
      const range = t.max - t.min;
      const margin = range * relaxPct / 100;
      const avg = (_ws[p.key] + ((l as unknown as Record<string, number>)[p.key] || 0) * dW) / newTW;
      if (avg < t.min - margin - 0.0005 || avg > t.max + margin + 0.0005) return false;
    }
    return true;
  }

  // Phase 1: Seed — one lot from each producer (ou dois lotes distintos em Limpar Estoque para heterogeneidade)
  const byP: Record<string, typeof mix> = {};
  mix.forEach(l => { if (!byP[l.produtor]) byP[l.produtor] = []; byP[l.produtor].push(l); });
  const prods = Object.keys(byP);
  const seedPer = Math.max(1, Math.floor(targetW * 1000 / (prods.length * 213) / 6));
  const cleanupSplit = strategy.id === "cleanup";

  for (const prod of prods) {
    const lots = byP[prod].sort(sortFn);
    if (cleanupSplit && lots.length >= 2 && seedPer >= 2) {
      const a = lots[0];
      const b = lots[1];
      const n1 = Math.min(Math.floor(seedPer / 2), a.fardos);
      const n2 = Math.min(seedPer - n1, b.fardos);
      if (n1 > 0) apply(a, n1);
      if (n2 > 0) apply(b, n2);
      continue;
    }
    for (const lot of lots) {
      const n = Math.min(seedPer, lot.fardos);
      if (n > 0) { apply(lot, n); break; }
    }
  }

  // Phase 2: Fill to target weight (with progressive relaxation fallback)
  const sorted = [...mix].sort(sortFn);

  function fillW(relaxPct: number) {
    for (let rr = 0; rr < 500; rr++) {
      if (_tw >= targetW - 0.005) break;
      let addedAny = false;
      for (const l of sorted) {
        if (_tw >= targetW - 0.005) break;
        if ((l.allocBales ?? 0) >= l.fardos) continue;
        if ((l.allocBales ?? 0) === 0 && _ac >= rules.maxLots) continue;
        const rem = targetW - _tw;
        const bw = baleWeight(l);
        const ab = l.allocBales ?? 0;
        const maxBalesByRem = Math.max(0, Math.floor(rem / bw - 1e-9));
        if (maxBalesByRem < 1) continue;

        let inc = Math.min(
          rem > 10 ? 10 : (rem > 2 ? 3 : 1),
          l.fardos - ab,
          maxBalesByRem
        );
        if (ab === 0) {
          const mo = minBalesToOpenNewLot(_tw, bw, rules.minLotPct, l.fardos - ab);
          if (mo === Number.POSITIVE_INFINITY) continue;
          inc = Math.max(inc, mo);
        } else if (_tw > 0) {
          const w0 = l.allocWeight ?? 0;
          if ((w0 / _tw) * 100 < rules.minLotPct - 1e-7) {
            const mf = minBalesToBringActiveLotToMin(w0, _tw, bw, rules.minLotPct, l.fardos - ab);
            if (mf === Number.POSITIVE_INFINITY) continue;
            inc = Math.max(inc, mf);
          }
        }
        inc = Math.min(inc, l.fardos - ab, maxBalesByRem);
        if (inc < 1) continue;

        const meetsMin =
          ab > 0 && _tw > 0 && ((l.allocWeight ?? 0) / _tw) * 100 >= rules.minLotPct - 1e-7;
        if (canAddR(l, inc, relaxPct)) {
          apply(l, inc);
          addedAny = true;
        } else if (meetsMin && inc > 1 && canAddR(l, 1, relaxPct)) {
          apply(l, 1);
          addedAny = true;
        }
      }
      if (!addedAny) break;
    }
  }

  {
    const relaxLevels = [0, 5, 10, 25, 50];
    for (const rlx of relaxLevels) {
      if (_tw >= targetW - 0.005) break;
      fillW(rlx);
    }
  }

  // Phase 3: Enforce minLotPct
  for (let iter = 0; iter < 10; iter++) {
    syncAll();
    let removed = false;
    for (const l of mix) {
      if ((l.allocBales ?? 0) > 0 && _tw > 0 && ((l.allocWeight ?? 0) / _tw * 100) < rules.minLotPct) {
        apply(l, -(l.allocBales ?? 0));
        removed = true;
      }
    }
    if (!removed) break;
    const refillLevels = [0, 5, 10, 25];
    for (const rlx of refillLevels) {
      if (_tw >= targetW - 0.005) break;
      fillW(rlx);
    }
  }

  // Phase 4: Swap refinement (weight-aware)
  syncAll();
  const isMin = strategy.id === "cheapest";
  function objVal(): number {
    if (_tw <= 0) return isMin ? 1e9 : -1e9;
    if (isMin) {
      let c = 0;
      for (const m of mix) if ((m.allocBales ?? 0) > 0) c += m.custo * (m.allocWeight ?? 0);
      return c / _tw;
    }
    let s = 0;
    for (const m of mix) if ((m.allocBales ?? 0) > 0) s += m.sScore * (m.allocWeight ?? 0);
    return s / _tw;
  }

  for (let round = 0; round < 30; round++) {
    let improved = false;
    const active = mix.filter(m => (m.allocBales ?? 0) > 0);
    for (const out of active) {
      if ((out.allocBales ?? 0) <= 1) continue;
      for (const inp of sorted) {
        if (inp === out || (inp.allocBales ?? 0) >= inp.fardos) continue;
        if ((inp.allocBales ?? 0) === 0 && _ac >= rules.maxLots) continue;
        const befDev = Math.abs(_tw - targetW);
        const bef = objVal();
        apply(out, -1); apply(inp, 1); syncAll();
        let ok = true;
        if (Math.abs(_tw - targetW) > befDev + 0.5) ok = false;
        if (ok && _tw > 0) {
          const pp = (_pw[inp.produtor] || 0) / _tw * 100;
          if (pp > rules.maxProdPct) ok = false;
          if (ok) {
            for (const p of PARAMS) {
              if (!isParamEnabled(p.key)) continue;
              const t = thresholds[p.key]; if (!t) continue;
              if (_ws[p.key] / _tw < t.min - 0.0005 || _ws[p.key] / _tw > t.max + 0.0005) { ok = false; break; }
            }
          }
        }
        const aft = objVal();
        const better = isMin ? (aft < bef - 0.5) : (aft > bef + 0.001);
        if (better && ok) { improved = true; }
        else { apply(inp, -1); apply(out, 1); syncAll(); }
      }
    }
    if (!improved) break;
  }

  // Phase 5: Weight convergence loop
  // Iteratively enforces all constraints then fills weight with progressive
  // quality-threshold relaxation so the engine always hits the target.
  for (let conv = 0; conv < 10; conv++) {
    syncAll();
    const tw0 = _tw;

    // 5a: Trim if overweight
    if (_tw > targetW + 0.005) {
      const trim = [...mix.filter(m => (m.allocBales ?? 0) > 0)].sort((a, b) =>
        isAsc ? (b.sScore - a.sScore) : (a.sScore - b.sScore));
      for (const l of trim) {
        while (_tw > targetW + 0.005 && (l.allocBales ?? 0) > 1) { apply(l, -1); }
        if (_tw <= targetW + 0.005) break;
      }
    }

    // 5b: Producer % enforcement
    syncAll();
    for (let pass = 0; pass < 5; pass++) {
      let trimmed = false;
      for (const l of mix) {
        if ((l.allocBales ?? 0) <= 0) continue;
        const prodW = _pw[l.produtor] || 0;
        if (_tw > 0 && (prodW / _tw * 100) > rules.maxProdPct + 0.1) { apply(l, -1); trimmed = true; }
      }
      if (!trimmed) break;
      syncAll();
    }

    // 5c: minLotPct enforcement
    syncAll();
    for (const l of mix) {
      if ((l.allocBales ?? 0) > 0 && _tw > 0 && ((l.allocWeight ?? 0) / _tw * 100) < rules.minLotPct) {
        apply(l, -(l.allocBales ?? 0));
      }
    }

    // 5d: Fill if underweight with progressive relaxation
    syncAll();
    if (_tw < targetW - 0.005) {
      const levels = [0, 5, 10, 25, 50];
      for (const rlx of levels) {
        if (_tw >= targetW - 0.005) break;
        fillW(rlx);
      }
    }

    syncAll();
    if (Math.abs(_tw - targetW) <= 0.005) break;
    if (Math.abs(_tw - tw0) < 0.001) break;
  }

  syncAll();
  for (const m of mix) {
    (m as Lot).qScore = lotQualityScore(m, thresholds);
  }
  const objWeights = buildObjectiveWeights(priority, rules.rotation);
  localImprove(mix as unknown as Lot[], targetW, rules, thresholds, objWeights, null, 500);

  const result = mix.filter(m => (m.allocBales ?? 0) > 0);
  if (!result.length) return null;

  const params = calcMixParams(result);
  if (!params) return null;

  return {
    strategy,
    lots: result.map(l => ({ ...l })),
    params,
    violations: checkViolations(params, thresholds),
    elapsed: 0,
  };
}

export async function runAllStrategies(
  stock: Lot[],
  targetW: number,
  rules: EngineRules,
  thresholds: Thresholds,
  priority = "rotation_first",
  onProgress?: (label: string, stepIndex: number, stepTotal: number) => void,
): Promise<StrategyResult[]> {
  const strategies = buildStrategies(stock, thresholds);
  const results: StrategyResult[] = [];
  const n = strategies.length;

  for (let i = 0; i < n; i++) {
    const strat = strategies[i];
    onProgress?.(`Estratégia ${i + 1}/${n}: ${strat.name}…`, i, n);
    await yieldToUi();
    const t0 = performance.now();
    const result = optimizeStrategy(strat, stock, targetW, rules, thresholds, priority);
    const elapsed = Math.round(performance.now() - t0);
    if (result) {
      result.elapsed = elapsed;
      results.push(result);
    }
  }

  return results;
}

export interface RemainingAnalysis {
  empty: boolean;
  tw: number;
  totalBales: number;
  nLots: number;
  params: Record<string, number>;
  avgIQ: number;
  violations: { key: string; label: string; val: number; limit: number; type: string; }[];
  prodConc: { produtor: string; peso: number; pct: number; }[];
  recs: { param: string; msg: string; }[];
}

export function analyzeRemaining(
  mixLots: Lot[],
  stock: Lot[],
  thresholds: Thresholds,
): RemainingAnalysis {
  const allocated: Record<number, number> = {};
  mixLots.forEach(l => { allocated[l.id] = (allocated[l.id] || 0) + (l.allocBales ?? 0); });

  const remaining = stock.map(l => {
    const used = allocated[l.id] || 0;
    const remBales = l.fardos - used;
    if (remBales <= 0) return null;
    return { ...l, fardos: remBales, peso: remBales * baleWeight(l) };
  }).filter(Boolean) as Lot[];

  if (!remaining.length) return { empty: true, tw: 0, totalBales: 0, nLots: 0, params: {}, avgIQ: 0, violations: [], prodConc: [], recs: [] };

  const tw = remaining.reduce((s, l) => s + l.peso, 0);
  const totalBales = remaining.reduce((s, l) => s + l.fardos, 0);
  const params: Record<string, number> = {};
  ALL_KEYS.forEach(k => { params[k] = weightedAverage(remaining, k, "peso"); });
  params.custoTon = weightedAverage(remaining, "custo", "peso");

  const iqs = remaining.map(l => ({ iq: qualityIndex(l, thresholds), peso: l.peso }));
  const avgIQ = iqs.reduce((s, x) => s + x.iq * x.peso, 0) / tw;

  const violations: RemainingAnalysis["violations"] = [];
  PARAMS.forEach(p => {
    const t = thresholds[p.key]; if (!t) return;
    const v = params[p.key];
    if (v < t.min) violations.push({ key: p.key, label: p.label, val: v, limit: t.min, type: "below" });
    if (v > t.max) violations.push({ key: p.key, label: p.label, val: v, limit: t.max, type: "above" });
  });

  const byProd: Record<string, number> = {};
  remaining.forEach(l => { byProd[l.produtor] = (byProd[l.produtor] || 0) + l.peso; });
  const prodConc = Object.entries(byProd).sort((a, b) => b[1] - a[1]).map(([produtor, peso]) => ({
    produtor, peso, pct: peso / tw * 100,
  }));

  const recs: RemainingAnalysis["recs"] = [];
  violations.forEach(v => {
    const prec = PARAMS.find(p => p.key === v.key)?.prec || 2;
    const dir = v.type === "below"
      ? `acima de ${v.limit.toFixed(prec)}`
      : `abaixo de ${v.limit.toFixed(prec)}`;
    recs.push({ param: v.label, msg: `Próxima compra: priorizar lotes com ${v.label} ${dir}` });
  });

  return { empty: false, tw, totalBales, nLots: remaining.length, params, avgIQ, violations, prodConc, recs };
}
