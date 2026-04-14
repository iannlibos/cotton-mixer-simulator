import {
  DEFAULT_RULES,
  PARAMS,
  TARGET_TOL,
  buildDefaultThresholds,
  ensureThresholds,
} from "../domain/types.js";
import {
  baleWeight,
  calcMixParams,
  checkViolations,
  weightedAverage,
} from "../engine/constraints.js";
import { explainRelaxationSuggestion, optimizeMix } from "../engine/optimizer.js";
import { parseCSVFile } from "../io/csv.js";
import { buildAuditRecord } from "../audit/trail.js";

const OPTIMIZER_VERSION = "2.0.0";

let stock = [];
let currentMix = [];
let history = JSON.parse(localStorage.getItem("ntx_hist") || "[]");
let auditTrail = JSON.parse(localStorage.getItem("ntx_audit") || "[]");
let curStep = 1;
let deltaChartI = null;
const targets = {};
let lastOptimization = null;
let lastCsvWarnings = [];

let thresholds = ensureThresholds(JSON.parse(localStorage.getItem("ntx_thresh") || "null"));
let rules = JSON.parse(localStorage.getItem("ntx_rules") || "null") || { ...DEFAULT_RULES };
let optimizationPriority = localStorage.getItem("ntx_priority") || "rotation_first";

function persistJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_e) {
    // no-op for local storage quota edge cases
  }
}

function isWarn(k, v) {
  const p = PARAMS.find((x) => x.key === k);
  const t = thresholds[k];
  if (!p || !t) return false;
  return (p.good && v < t.min) || (!p.good && v > t.max);
}

function cellCls(k, v) {
  return isWarn(k, v) ? "cell-warn" : "";
}

function weightOk() {
  const tw = parseFloat(document.getElementById("targetW").value) || 30;
  const tol = tw * (rules.weightTol / 100);
  const p = calcMixParams(currentMix);
  return p && Math.abs(p.weight - tw) <= Math.max(0.01, tol);
}

const sortSt = {};
function makeSort(tid, getData, renderFn) {
  sortSt[tid] = { col: null, asc: true };
  return function sort(ci, ck, num) {
    const s = sortSt[tid];
    if (s.col === ci) s.asc = !s.asc;
    else {
      s.col = ci;
      s.asc = true;
    }
    const d = getData();
    d.sort((a, b) => {
      let va = typeof ck === "function" ? ck(a) : a[ck];
      let vb = typeof ck === "function" ? ck(b) : b[ck];
      if (va == null) va = 0;
      if (vb == null) vb = 0;
      if (num) {
        va = parseFloat(va) || 0;
        vb = parseFloat(vb) || 0;
      } else {
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
      }
      return va < vb ? (s.asc ? -1 : 1) : va > vb ? (s.asc ? 1 : -1) : 0;
    });
    renderFn(d);
  };
}

function thH(cols, fn) {
  return cols
    .map(
      (c, i) =>
        `<th ${i === 0 ? 'style="text-align:left;padding-left:12px"' : ""} onclick="${fn}(${i},'${c.key}',${!!c.num})">${c.label}<span class="sa">▼</span></th>`,
    )
    .join("");
}

function renderStepBars() {
  [1, 2, 3].forEach((n) => {
    const el = document.getElementById("stepBar" + n);
    if (!el) return;
    const steps = [
      { n: 1, l: "Estoque" },
      { n: 2, l: "Gerar" },
      { n: 3, l: "Revisar" },
    ];
    el.innerHTML = steps
      .map((s, i) => {
        const cls = s.n === curStep ? "active" : s.n < curStep ? "done" : "";
        const line = i < steps.length - 1 ? `<div class="step-line${s.n < curStep ? " done" : ""}"></div>` : "";
        return `<div class="step-pill ${cls}"><div class="num">${s.n < curStep ? "✓" : s.n}</div>${s.l}</div>${line}`;
      })
      .join("");
  });
}

function updateSidebar() {
  document.querySelectorAll(".sb-step").forEach((s) => {
    const n = parseInt(s.dataset.s, 10);
    s.classList.remove("active", "done", "unlocked");
    if (n === curStep && document.getElementById("pg-step" + n).classList.contains("active")) s.classList.add("active");
    else if (n < curStep) s.classList.add("done", "unlocked");
    else if (n === curStep) s.classList.add("unlocked");
    else if (n === 2 && stock.length) s.classList.add("unlocked");
    else if (n === 3 && currentMix.length) s.classList.add("unlocked");
  });
  document
    .querySelector(".sb-cfg-btn")
    .classList.toggle("active", document.getElementById("pg-config").classList.contains("active"));
}

function goStep(n) {
  if (n === 2 && !stock.length) return;
  if (n === 3 && !currentMix.length) return;
  curStep = n;
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById("pg-step" + n).classList.add("active");
  updateSidebar();
  renderStepBars();
}

function goPage(pg) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById("pg-" + pg).classList.add("active");
  updateSidebar();
  if (pg === "config") buildConfig();
}

const skCols = [
  { label: "Produtor", key: "produtor" },
  { label: "Lote", key: "lote" },
  { label: "Peso (ton)", key: "peso", num: 1 },
  { label: "Fardos", key: "fardos", num: 1 },
  { label: "Peso Méd. Fardo (kg)", key: "avgBaleKg", num: 1 },
  { label: "UHML", key: "uhml", num: 1 },
  { label: "STR", key: "str_val", num: 1 },
  { label: "ELG", key: "elg", num: 1 },
  { label: "UI", key: "ui", num: 1 },
  { label: "MIC", key: "mic", num: 1 },
  { label: "SF", key: "sf", num: 1 },
  { label: "MST", key: "mst", num: 1 },
  { label: "MAT", key: "mat", num: 1 },
  { label: "SCI", key: "sci", num: 1 },
];
const sortStock = makeSort("skTable", () => stock, renderStockRows);
window.sortSk = (i, k, n) => sortStock(i, k, n);

function renderStockRows(data) {
  document.getElementById("skBody").innerHTML = data
    .map(
      (r) =>
        `<tr><td>${r.produtor}</td><td style="font-weight:400;color:var(--tx3)">${r.lote}</td><td class="mono">${r.peso.toFixed(2)}</td><td class="mono">${r.fardos}</td><td class="mono" style="color:var(--tx2)">${r.avgBaleKg > 0 ? r.avgBaleKg.toFixed(0) : "—"}</td><td class="mono ${cellCls("uhml", r.uhml)}">${r.uhml}</td><td class="mono ${cellCls("str_val", r.str_val)}">${r.str_val}</td><td class="mono ${cellCls("elg", r.elg)}">${r.elg}</td><td class="mono ${cellCls("ui", r.ui)}">${r.ui}</td><td class="mono ${cellCls("mic", r.mic)}">${r.mic}</td><td class="mono ${cellCls("sf", r.sf)}">${r.sf}</td><td class="mono ${cellCls("mst", r.mst)}">${r.mst}</td><td class="mono">${r.mat}</td><td class="mono" style="color:var(--tx3)">${r.sci}</td></tr>`,
    )
    .join("");
}

function renderStock() {
  if (!stock.length) return;
  document.getElementById("stockPanel").style.display = "block";
  document.getElementById("dropZone").style.display = "none";
  const prods = [...new Set(stock.map((s) => s.produtor))];
  const tP = stock.reduce((s, r) => s + r.peso, 0);
  const tF = stock.reduce((s, r) => s + r.fardos, 0);
  document.getElementById("skTitle").textContent = stock.length + " lotes carregados";
  document.getElementById("skSub").textContent =
    prods.length + " produtores · " + tP.toFixed(1) + " ton · " + tF.toLocaleString("pt-BR") + " fardos";
  document.getElementById("targetW").value = Math.round(tP * 0.15 * 100) / 100;

  const kpis = [
    { l: "Lotes", v: stock.length, c: "var(--cy)" },
    { l: "Produtores", v: prods.length, c: "var(--pp)" },
    { l: "Peso Total", v: tP.toFixed(1) + " ton", c: "var(--tx)" },
    { l: "Fardos", v: tF.toLocaleString("pt-BR"), c: "var(--tx)" },
  ];
  PARAMS.forEach((p) => {
    const a = weightedAverage(stock, p.key, "peso");
    kpis.push({ l: p.label, v: a.toFixed(p.prec), c: isWarn(p.key, a) ? "var(--am)" : "var(--gn)" });
  });
  kpis.push({ l: "SCI", v: weightedAverage(stock, "sci", "peso").toFixed(1), c: "var(--tx3)" });
  document.getElementById("skKPIs").innerHTML = kpis
    .map(
      (k) =>
        `<div style="background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:10px;text-align:center"><div style="font-size:9px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">${k.l}</div><div class="mono" style="font-size:16px;font-weight:800;color:${k.c};margin-top:3px">${k.v}</div></div>`,
    )
    .join("");
  document.getElementById("skHead").innerHTML = thH(skCols, "sortSk");
  renderStockRows(stock);
  updateSidebar();
}

async function parseCSV(file) {
  const { lots, errors, warnings } = await parseCSVFile(file);
  if (errors.length) {
    alert("Erros no CSV:\n- " + errors.join("\n- "));
    return;
  }
  lastCsvWarnings = warnings;
  stock = lots;
  renderStock();
}

function resetStock() {
  stock = [];
  currentMix = [];
  lastOptimization = null;
  Object.keys(targets).forEach((k) => delete targets[k]);
  document.getElementById("stockPanel").style.display = "none";
  document.getElementById("dropZone").style.display = "";
  document.getElementById("fileIn").value = "";
  document.getElementById("skKPIs").innerHTML = "";
  document.getElementById("skBody").innerHTML = "";
  document.getElementById("mixName").value = "";
  document.getElementById("tgtBar").style.display = "none";
  const altCard = document.getElementById("alternativesCard");
  if (altCard) altCard.style.display = "none";
  const altBox = document.getElementById("alternativesBox");
  if (altBox) altBox.innerHTML = "";
  curStep = 1;
  goStep(1);
  updateSidebar();
}

function updRule() {
  rules.minLotPct = parseFloat(document.getElementById("rule_minLotPct").value);
  rules.maxProdPct = parseFloat(document.getElementById("rule_maxProdPct").value);
  rules.maxLots = parseInt(document.getElementById("rule_maxLots").value, 10);
  rules.rotation = parseFloat(document.getElementById("rule_rotation").value);
  rules.weightTol = parseFloat(document.getElementById("rule_weightTol").value);
  document.getElementById("rule_minLotPct_val").textContent = rules.minLotPct + "%";
  document.getElementById("rule_maxProdPct_val").textContent = rules.maxProdPct + "%";
  document.getElementById("rule_maxLots_val").textContent = rules.maxLots;
  document.getElementById("rule_rotation_val").textContent = rules.rotation + "%";
  document.getElementById("rule_weightTol_val").textContent = rules.weightTol + "%";
  persistJSON("ntx_rules", rules);
  const badge = document.getElementById("ruleSaved");
  badge.style.display = "inline";
  clearTimeout(badge._t);
  badge._t = setTimeout(() => {
    badge.style.display = "none";
  }, 1500);
}

function loadRuleSliders() {
  document.getElementById("rule_minLotPct").value = rules.minLotPct;
  document.getElementById("rule_maxProdPct").value = rules.maxProdPct;
  document.getElementById("rule_maxLots").value = rules.maxLots;
  document.getElementById("rule_rotation").value = rules.rotation;
  document.getElementById("rule_weightTol").value = rules.weightTol;
  updRule();
}

function updT(k, s, v) {
  thresholds[k][s] = parseFloat(v);
  thresholds = ensureThresholds(thresholds);
  persistJSON("ntx_thresh", thresholds);
}

function buildConfig() {
  const el = document.getElementById("cfgRows");
  el.innerHTML = "";
  PARAMS.forEach((p) => {
    const t = thresholds[p.key];
    const step = p.prec >= 3 ? 0.001 : p.prec === 2 ? 0.01 : 0.1;
    el.innerHTML += `<div class="cfg-row"><div class="cfg-name">${p.label} ${p.good ? '<span style="color:var(--gn);font-size:10px">▲</span>' : '<span style="color:var(--rd);font-size:10px">▼</span>'}</div><div><input type="number" class="inp inp-num" value="${t.min}" step="${step}" style="width:100%" onchange="updT('${p.key}','min',this.value)"></div><div><input type="number" class="inp inp-num" value="${t.max}" step="${step}" style="width:100%" onchange="updT('${p.key}','max',this.value)"></div></div>`;
  });
  const box = document.getElementById("rulesGrid");
  if (box && !document.getElementById("prioritySel")) {
    const card = document.createElement("div");
    card.style.cssText = "background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:16px";
    card.innerHTML = `<label class="lbl">Prioridade da otimização</label><select id="prioritySel" class="inp"><option value="strict_quality_first">Qualidade estrita</option><option value="balanced">Balanceada</option><option value="rotation_first">Giro de estoque</option></select><div style="font-size:11px;color:var(--tx3);margin-top:6px">Controla os pesos da função objetivo da engine.</div>`;
    box.appendChild(card);
    document.getElementById("prioritySel").value = optimizationPriority;
    document.getElementById("prioritySel").onchange = (e) => {
      optimizationPriority = e.target.value;
      localStorage.setItem("ntx_priority", optimizationPriority);
    };
  }
  loadRuleSliders();
}

function applyOptimizationResult(result, targetWeight) {
  lastOptimization = result;
  if (!result.best) {
    alert("Não foi possível gerar mistura. Revise regras e estoque.");
    return false;
  }
  currentMix = result.best.mix;
  if (!currentMix.length) {
    alert("Nenhum lote foi alocado.");
    return false;
  }
  curStep = 3;
  goStep(3);
  renderResult(targetWeight);
  return true;
}

function collectActiveTargets() {
  const active = {};
  PARAMS.forEach((p) => {
    if (targets[p.key] != null && Number.isFinite(targets[p.key])) active[p.key] = targets[p.key];
  });
  return Object.keys(active).length ? active : null;
}

function runEngine() {
  if (!stock.length) {
    alert("Carregue o estoque primeiro.");
    return;
  }
  const targetWeight = parseFloat(document.getElementById("targetW").value) || 30;
  const result = optimizeMix({
    stock,
    targetWeight,
    thresholds,
    rules,
    priority: optimizationPriority,
    seed: Date.now(),
  });
  applyOptimizationResult(result, targetWeight);
}

function runWithTargets() {
  if (!stock.length) return;
  const targetValues = collectActiveTargets();
  if (!targetValues) {
    alert("Preencha ao menos um target.");
    return;
  }
  const targetWeight = parseFloat(document.getElementById("targetW").value) || 30;
  const result = optimizeMix({
    stock,
    targetWeight,
    thresholds,
    rules,
    priority: optimizationPriority,
    seed: Date.now(),
    targetValues,
  });
  applyOptimizationResult(result, targetWeight);
}

const mixCols = [
  { label: "Produtor / Lote", key: "produtor" },
  { label: "Fardos", key: "allocBales", num: 1 },
  { label: "Peso (ton)", key: "allocWeight", num: 1 },
  { label: "Disp. (ton)", key: "peso", num: 1 },
  { label: "%", key: "allocWeight", num: 1 },
  { label: "UHML", key: "uhml", num: 1 },
  { label: "STR", key: "str_val", num: 1 },
  { label: "ELG", key: "elg", num: 1 },
  { label: "UI", key: "ui", num: 1 },
  { label: "MIC", key: "mic", num: 1 },
  { label: "SF", key: "sf", num: 1 },
  { label: "MST", key: "mst", num: 1 },
  { label: "SCI", key: "sci", num: 1 },
  { label: "", key: "_" },
];
const sortMix = makeSort("mixTable", () => [...currentMix], (d) => {
  currentMix = d;
  renderMixRows();
});
window.sortMx = (i, k, n) => sortMix(i, k, n);

function setTarget(key, val) {
  targets[key] = val === "" ? null : parseFloat(val);
  document.getElementById("tgtBar").style.display = PARAMS.some((p) => targets[p.key] != null) ? "block" : "none";
}

function computeUiScore(params, targetW, violations) {
  const wTol = targetW * (rules.weightTol / 100);
  const wMatch = Math.abs(params.weight - targetW) <= Math.max(0.01, wTol);
  let score = 100;
  violations.forEach((v) => {
    const t = thresholds[v.key];
    const range = Math.max(0.0001, t.max - t.min);
    const dist = Math.abs(v.type === "below" ? t.min - v.val : v.val - t.max);
    score -= Math.min(25, (dist / range) * 100);
  });
  if (!wMatch) score -= 10;
  return Math.max(0, Math.round(score));
}

function applyAlternative(idx) {
  const alts = lastOptimization?.alternatives || [];
  const alt = alts[idx];
  if (!alt || !Array.isArray(alt.mix) || !alt.mix.length) return;
  currentMix = alt.mix.map((m) => ({ ...m }));
  lastOptimization.best = alt;
  renderResult();
}

function renderAlternativesPanel(targetW) {
  const card = document.getElementById("alternativesCard");
  const box = document.getElementById("alternativesBox");
  if (!card || !box) return;
  const alternatives = (lastOptimization?.alternatives || []).slice(0, 3);
  if (!alternatives.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  box.innerHTML = alternatives
    .map((alt, idx) => {
      const params = alt.params || calcMixParams(alt.mix || []);
      if (!params) return "";
      const v = checkViolations(params, thresholds);
      const uiScore = computeUiScore(params, targetW, v);
      const pCount = new Set((alt.mix || []).map((m) => m.produtor)).size;
      const activeCls = lastOptimization?.best === alt ? "var(--cybd)" : "var(--bd)";
      const feas = alt.feasible ? "Factível" : "Com alertas";
      return `<div style="background:var(--sf2);border:1px solid ${activeCls};border-radius:var(--r);padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:12px;font-weight:700;color:var(--tx)">Alternativa ${idx + 1}</div>
          <div class="mono" style="font-size:11px;color:${alt.feasible ? "var(--gn)" : "var(--am)"}">${feas}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
          <div style="font-size:10px;color:var(--tx3)">Score</div><div class="mono" style="text-align:right">${uiScore}</div>
          <div style="font-size:10px;color:var(--tx3)">Peso</div><div class="mono" style="text-align:right">${params.weight.toFixed(2)} ton</div>
          <div style="font-size:10px;color:var(--tx3)">Lotes</div><div class="mono" style="text-align:right">${(alt.mix || []).length}</div>
          <div style="font-size:10px;color:var(--tx3)">Produtores</div><div class="mono" style="text-align:right">${pCount}</div>
        </div>
        <div style="font-size:10px;color:${v.length ? "var(--am)" : "var(--gn)"};margin-bottom:8px">${v.length ? `${v.length} violação(ões) de qualidade` : "Sem violações de qualidade"}</div>
        <button class="btn btn-s btn-sm" style="width:100%" onclick="applyAlternative(${idx})">Aplicar alternativa</button>
      </div>`;
    })
    .join("");
}

function renderResult() {
  const params = calcMixParams(currentMix);
  if (!params) return;
  const targetW = parseFloat(document.getElementById("targetW").value) || 30;
  const name = document.getElementById("mixName").value || "Mistura " + (history.length + 225);
  const violations = checkViolations(params, thresholds);
  const usedP = [...new Set(currentMix.map((m) => m.produtor))];
  const allP = [...new Set(stock.map((s) => s.produtor))];
  const wTol = targetW * (rules.weightTol / 100);
  const wMatch = Math.abs(params.weight - targetW) <= Math.max(0.01, wTol);
  document.getElementById("resTitle").textContent = name;
  document.getElementById("resSub").textContent = `${currentMix.length} lotes · ${usedP.length} produtores · ${params.bales} fardos · ${params.weight.toFixed(2)} ton`;
  document.getElementById("saveBtn").classList.toggle("btn-disabled", !wMatch);

  let alerts = "";
  if (lastCsvWarnings.length) {
    alerts += `<div class="alert alert-info">CSV com ${lastCsvWarnings.length} alertas de qualidade de dados (consulte importação).</div>`;
  }
  if (!wMatch) alerts += `<div class="alert alert-warn">Peso fora da tolerância alvo.</div>`;
  violations.forEach((v) => {
    alerts += `<div class="alert alert-danger">⚠️ ${v.label} fora da faixa: ${v.val.toFixed(3)} (limite ${v.type === "below" ? "mín" : "máx"} ${v.limit})</div>`;
  });
  if (lastOptimization?.diagnostics?.length) {
    alerts += lastOptimization.diagnostics.map((d) => `<div class="alert alert-info">${d.message}</div>`).join("");
  }
  if (lastOptimization && !lastOptimization.best?.feasible) {
    const hint = explainRelaxationSuggestion(lastOptimization);
    if (hint) alerts += `<div class="alert alert-warn">${hint}</div>`;
  }
  if (wMatch && !violations.length) alerts += `<div class="alert alert-ok">✅ Mistura dentro dos limites.</div>`;
  document.getElementById("alertsBox").innerHTML = alerts;
  renderAlternativesPanel(targetW);

  const score = computeUiScore(params, targetW, violations);
  const sC = score >= 80 ? "var(--gn)" : score >= 50 ? "var(--am)" : "var(--rd)";
  document.getElementById("gArc").style.strokeDashoffset = 264 - (264 * score) / 100;
  document.getElementById("gArc").style.stroke = sC;
  document.getElementById("gNum").textContent = score;
  document.getElementById("gNum").style.color = sC;
  document.getElementById("gStatus").innerHTML =
    score >= 80
      ? '<span style="color:var(--gn)">Excelente</span>'
      : score >= 50
        ? '<span style="color:var(--am)">Atenção</span>'
        : '<span style="color:var(--rd)">Fora</span>';

  let mxH = `<div class="mx-item accent"><div class="mx-lbl">Peso Mistura</div><div class="mx-val">${params.weight.toFixed(2)}</div><div class="mx-rng mono">alvo: ${targetW} ton</div></div>`;
  PARAMS.filter((p) => p.key !== "mat").forEach((p) => {
    const v = params[p.key];
    const t = thresholds[p.key];
    const ok = v >= t.min && v <= t.max;
    const tgtVal = targets[p.key] != null ? targets[p.key] : "";
    mxH += `<div class="mx-item ${ok ? "ok" : "danger"}"><div class="mx-lbl">${p.label}</div><div class="mx-val">${v.toFixed(p.prec)}</div><div class="mx-rng mono">${t.min} — ${t.max}</div><div class="mx-st">${ok ? "✓ OK" : "⚠ Fora"}</div><div class="mx-tgt"><span style="font-size:8px;color:var(--am);font-weight:700">🎯</span><input type="number" value="${tgtVal}" step="${p.prec >= 3 ? 0.001 : p.prec === 2 ? 0.01 : 0.1}" placeholder="—" onchange="setTarget('${p.key}',this.value)"></div></div>`;
  });
  document.getElementById("mxBox").innerHTML = mxH;
  document.getElementById("pCnt").textContent = `${usedP.length}/${allP.length}`;
  document.getElementById("pBar").style.width = `${(usedP.length / Math.max(1, allP.length)) * 100}%`;
  document.getElementById("mixHead").innerHTML = thH(mixCols, "sortMx");
  renderMixRows();
  renderAvail();
  renderDelta();
}

function renderMixRows() {
  const tw = currentMix.reduce((s, l) => s + l.allocWeight, 0);
  document.getElementById("mixBody").innerHTML = currentMix
    .map((l, i) => {
      const pct = tw > 0 ? ((l.allocWeight / tw) * 100).toFixed(1) : "0";
      const bW = baleWeight(l);
      return `<tr><td><span style="font-weight:700">${l.produtor}</span> <span style="color:var(--tx3);font-size:10px">${l.lote}</span></td><td><input type="number" class="inp inp-sm inp-num mono" value="${l.allocBales}" min="1" max="${l.fardos}" data-i="${i}" data-f="bales" onchange="editA(this)"></td><td><input type="number" class="inp inp-sm inp-num mono" value="${l.allocWeight.toFixed(2)}" min="${bW.toFixed(3)}" max="${l.peso}" step="0.01" data-i="${i}" data-f="weight" onchange="editA(this)" style="width:75px"></td><td class="mono">${l.peso.toFixed(2)}</td><td class="mono">${pct}%</td><td class="mono ${cellCls("uhml", l.uhml)}">${l.uhml}</td><td class="mono ${cellCls("str_val", l.str_val)}">${l.str_val}</td><td class="mono ${cellCls("elg", l.elg)}">${l.elg}</td><td class="mono ${cellCls("ui", l.ui)}">${l.ui}</td><td class="mono ${cellCls("mic", l.mic)}">${l.mic}</td><td class="mono ${cellCls("sf", l.sf)}">${l.sf}</td><td class="mono ${cellCls("mst", l.mst)}">${l.mst}</td><td class="mono">${l.sci}</td><td><button class="btn btn-d btn-sm" onclick="rmLot(${i})" style="padding:2px 6px;font-size:9px">✕</button></td></tr>`;
    })
    .join("");
  updTotals();
}

function editA(el) {
  const l = currentMix[parseInt(el.dataset.i, 10)];
  const bW = baleWeight(l);
  if (el.dataset.f === "bales") {
    l.allocBales = Math.max(1, Math.min(l.fardos, parseInt(el.value, 10) || 1));
    l.allocWeight = l.allocBales * bW;
  } else {
    l.allocWeight = Math.max(bW, Math.min(l.peso, parseFloat(el.value) || bW));
    l.allocBales = Math.max(1, Math.round(l.allocWeight / bW));
  }
  renderResult();
}

function rmLot(i) {
  currentMix.splice(i, 1);
  if (currentMix.length) renderResult();
  else goStep(2);
}

function updTotals() {
  const p = calcMixParams(currentMix);
  if (!p) return;
  document.getElementById("tB").textContent = p.bales;
  document.getElementById("tW").textContent = p.weight.toFixed(2);
  const f = { uhml: "tUHML", str_val: "tSTR", elg: "tELG", ui: "tUI", mic: "tMIC", sf: "tSF", mst: "tMST", sci: "tSCI" };
  Object.entries(f).forEach(([k, id]) => {
    const el = document.getElementById(id);
    const pr = PARAMS.find((x) => x.key === k);
    el.textContent = p[k].toFixed(pr ? pr.prec : 1);
    el.style.color = isWarn(k, p[k]) ? "var(--am)" : "var(--gn)";
  });
}

let availData = [];
let availOpen = false;
const availCols = [
  { label: "", key: "_add" },
  { label: "Produtor", key: "produtor" },
  { label: "Lote", key: "lote" },
  { label: "Peso (ton)", key: "peso", num: 1 },
  { label: "Fardos", key: "fardos", num: 1 },
  { label: "UHML", key: "uhml", num: 1 },
  { label: "STR", key: "str_val", num: 1 },
  { label: "ELG", key: "elg", num: 1 },
  { label: "UI", key: "ui", num: 1 },
  { label: "MIC", key: "mic", num: 1 },
  { label: "SF", key: "sf", num: 1 },
  { label: "MST", key: "mst", num: 1 },
  { label: "SCI", key: "sci", num: 1 },
];
const sortAvail = makeSort("availTable", () => availData, renderAvailRows);
window.sortAv = (i, k, n) => sortAvail(i, k, n);

function toggleAvail() {
  availOpen = !availOpen;
  document.getElementById("availBody").style.display = availOpen ? "block" : "none";
  document.getElementById("availArrow").style.transform = availOpen ? "rotate(90deg)" : "";
}

function renderAvailRows(data) {
  document.getElementById("availTbody").innerHTML = data
    .map(
      (r) =>
        `<tr><td style="text-align:center"><button class="btn btn-p btn-sm" onclick="addLot(${r.id})" style="padding:3px 8px;font-size:10px">+ Adicionar</button></td><td>${r.produtor}</td><td style="font-weight:400;color:var(--tx3)">${r.lote}</td><td class="mono">${r.peso.toFixed(2)}</td><td class="mono">${r.fardos}</td><td class="mono ${cellCls("uhml", r.uhml)}">${r.uhml}</td><td class="mono ${cellCls("str_val", r.str_val)}">${r.str_val}</td><td class="mono ${cellCls("elg", r.elg)}">${r.elg}</td><td class="mono ${cellCls("ui", r.ui)}">${r.ui}</td><td class="mono ${cellCls("mic", r.mic)}">${r.mic}</td><td class="mono ${cellCls("sf", r.sf)}">${r.sf}</td><td class="mono ${cellCls("mst", r.mst)}">${r.mst}</td><td class="mono">${r.sci}</td></tr>`,
    )
    .join("");
}

function renderAvail() {
  const mixIds = new Set(currentMix.map((m) => m.id));
  availData = stock.filter((s) => !mixIds.has(s.id));
  const sec = document.getElementById("availSection");
  if (!availData.length) {
    sec.style.display = "none";
    return;
  }
  sec.style.display = "block";
  document.getElementById("availTitle").textContent = `${availData.length} lotes disponíveis no estoque`;
  document.getElementById("availHead").innerHTML = thH(availCols, "sortAv");
  renderAvailRows(availData);
}

function addLot(stockId) {
  const lot = stock.find((s) => s.id === stockId);
  if (!lot) return;
  const entry = { ...lot, allocBales: 1, allocWeight: baleWeight(lot) };
  currentMix.push(entry);
  renderResult();
}

function renderDelta() {
  if (!currentMix.length || !stock.length) return;
  const map = {};
  currentMix.forEach((l) => (map[l.id] = { weight: l.allocWeight }));
  const tB = stock.reduce((s, r) => s + r.peso, 0);
  const tA = currentMix.reduce((s, l) => s + l.allocWeight, 0);
  document.getElementById("deltaKPIs").innerHTML = [
    { l: "Antes", v: tB.toFixed(1) + " ton", c: "var(--tx)" },
    { l: "Alocado", v: tA.toFixed(2) + " ton", c: "var(--am)" },
    { l: "Depois", v: (tB - tA).toFixed(1) + " ton", c: "var(--cy)" },
    { l: "Consumo", v: ((tA / tB) * 100).toFixed(1) + "%", c: "var(--rd)" },
  ]
    .map(
      (k) =>
        `<div style="background:var(--sf2);border:1px solid var(--bd);border-radius:var(--r);padding:10px;text-align:center"><div style="font-size:9px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">${k.l}</div><div class="mono" style="font-size:18px;font-weight:800;color:${k.c};margin-top:3px">${k.v}</div></div>`,
    )
    .join("");

  const rows = stock.map((r) => {
    const alloc = map[r.id]?.weight || 0;
    const after = r.peso - alloc;
    const pct = r.peso > 0 && alloc > 0 ? -((alloc / r.peso) * 100) : 0;
    return `<tr><td>${r.produtor}</td><td style="font-weight:400;color:var(--tx3)">${r.lote}</td><td class="mono">${r.peso.toFixed(2)}</td><td class="mono">${alloc > 0 ? alloc.toFixed(2) : "—"}</td><td class="mono">${after.toFixed(2)}</td><td class="mono">${alloc > 0 ? pct.toFixed(0) + "%" : "—"}</td></tr>`;
  });
  document.getElementById("deltaHead").innerHTML = thH(
    [
      { label: "Produtor", key: "produtor" },
      { label: "Lote", key: "lote" },
      { label: "Antes", key: "peso", num: 1 },
      { label: "Alocado", key: "alloc", num: 1 },
      { label: "Depois", key: "after", num: 1 },
      { label: "Δ", key: "pct", num: 1 },
    ],
    "sortDt",
  );
  document.getElementById("deltaBody").innerHTML = rows.join("");

  const byP = {};
  stock.forEach((r) => {
    if (!byP[r.produtor]) byP[r.produtor] = { before: 0, after: 0 };
    const alloc = map[r.id]?.weight || 0;
    byP[r.produtor].before += r.peso;
    byP[r.produtor].after += r.peso - alloc;
  });
  const names = Object.keys(byP);
  if (deltaChartI) deltaChartI.destroy();
  deltaChartI = new Chart(document.getElementById("deltaChart"), {
    type: "bar",
    data: {
      labels: names,
      datasets: [
        { label: "Antes", data: names.map((n) => +byP[n].before.toFixed(1)), backgroundColor: "rgba(34,211,238,.25)", borderRadius: 4 },
        { label: "Depois", data: names.map((n) => +byP[n].after.toFixed(1)), backgroundColor: "rgba(16,185,129,.5)", borderRadius: 4 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

async function saveMix() {
  if (!weightOk()) return;
  const params = calcMixParams(currentMix);
  const name = document.getElementById("mixName").value || "Mistura " + (history.length + 225);
  const score = parseInt(document.getElementById("gNum").textContent || "80", 10);
  const rec = {
    id: Date.now(),
    name,
    date: new Date().toLocaleDateString("pt-BR"),
    params,
    thresholds: structuredClone(thresholds),
    score,
    lots: currentMix.map((l) => ({ ...l })),
  };
  history.unshift(rec);
  persistJSON("ntx_hist", history);

  if (lastOptimization) {
    const audit = await buildAuditRecord({
      stock,
      rules,
      thresholds,
      optimizerVersion: OPTIMIZER_VERSION,
      best: lastOptimization.best,
      alternatives: lastOptimization.alternatives,
      diagnostics: lastOptimization.diagnostics,
      mixName: name,
    });
    auditTrail.unshift(audit);
    persistJSON("ntx_audit", auditTrail);
  }

  renderHistList();
  resetStock();
  viewH(0);
}

function renderHistList() {
  const el = document.getElementById("histList");
  if (!history.length) {
    el.innerHTML = '<div style="padding:8px 14px;font-size:12px;color:var(--tx3)">Nenhuma mistura</div>';
    return;
  }
  el.innerHTML = history
    .map(
      (h, i) =>
        `<div class="sb-hist-item" onclick="viewH(${i})"><div class="sb-hist-dot" style="background:${h.score >= 80 ? "var(--gn)" : h.score >= 50 ? "var(--am)" : "var(--rd)"}"></div><div class="sb-hist-name">${h.name}</div><div class="sb-hist-date">${h.date}</div></div>`,
    )
    .join("");
}

function viewH(i) {
  const h = history[i];
  if (!h) return;
  goPage("hist");
  document.getElementById("hdTitle").textContent = h.name;
  document.getElementById("hdSub").textContent = `${h.date} · ${h.lots.length} lotes · ${h.params.bales} fardos · ${h.params.weight.toFixed(2)} ton · Score: ${h.score}`;
  let mxH = "";
  PARAMS.filter((p) => p.key !== "mat").forEach((p) => {
    const v = h.params[p.key];
    const t = h.thresholds?.[p.key] || thresholds[p.key];
    const ok = v >= t.min && v <= t.max;
    mxH += `<div class="mx-item ${ok ? "ok" : "danger"}"><div class="mx-lbl">${p.label}</div><div class="mx-val" style="color:${ok ? "var(--gn)" : "var(--rd)"}">${v.toFixed(p.prec)}</div><div class="mx-rng mono">${t.min} — ${t.max}</div></div>`;
  });
  document.getElementById("hdMx").innerHTML = mxH;
  const tw = h.lots.reduce((s, l) => s + l.allocWeight, 0);
  document.getElementById("hdHead").innerHTML = thH(
    [
      { label: "Produtor / Lote", key: "produtor" },
      { label: "Fardos", key: "allocBales", num: 1 },
      { label: "Peso (ton)", key: "allocWeight", num: 1 },
      { label: "%", key: "allocWeight", num: 1 },
      { label: "UHML", key: "uhml", num: 1 },
      { label: "STR", key: "str_val", num: 1 },
      { label: "ELG", key: "elg", num: 1 },
      { label: "UI", key: "ui", num: 1 },
      { label: "MIC", key: "mic", num: 1 },
      { label: "SF", key: "sf", num: 1 },
      { label: "MST", key: "mst", num: 1 },
      { label: "SCI", key: "sci", num: 1 },
    ],
    "sortHd",
  );
  document.getElementById("hdBody").innerHTML = [...h.lots]
    .sort((a, b) => b.allocWeight - a.allocWeight)
    .map((l) => `<tr><td><strong>${l.produtor}</strong> <span style="color:var(--tx3);font-size:10px">${l.lote}</span></td><td class="mono">${l.allocBales}</td><td class="mono">${l.allocWeight.toFixed(2)}</td><td class="mono">${((l.allocWeight / tw) * 100).toFixed(1)}%</td><td class="mono">${l.uhml}</td><td class="mono">${l.str_val}</td><td class="mono">${l.elg}</td><td class="mono">${l.ui}</td><td class="mono">${l.mic}</td><td class="mono">${l.sf}</td><td class="mono">${l.mst}</td><td class="mono">${l.sci}</td></tr>`)
    .join("");
  document.getElementById("hdDel").onclick = () => {
    if (confirm(`Excluir "${h.name}"?`)) {
      history.splice(i, 1);
      persistJSON("ntx_hist", history);
      renderHistList();
      goStep(1);
    }
  };
  document.getElementById("hdPdfBtn").onclick = () => exportPDFFromHist(h);
}

function buildPDF(name, date, params, lots, th) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("landscape", "mm", "a4");
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(11, 15, 26);
  doc.rect(0, 0, w, 28, "F");
  doc.setTextColor(34, 211, 238);
  doc.setFontSize(9);
  doc.text("NORTEX · GERADOR DE MISTURAS", 14, 12);
  doc.setTextColor(232, 234, 240);
  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text(name, 14, 22);
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.setTextColor(154, 161, 185);
  doc.text(`${date}  |  ${lots.length} lotes  |  ${params.bales} fardos  |  ${params.weight.toFixed(2)} ton`, w - 14, 22, { align: "right" });
  let y = 36;
  doc.setFontSize(10);
  doc.setTextColor(34, 211, 238);
  doc.setFont(undefined, "bold");
  doc.text("PARÂMETROS", 14, y);
  y += 7;
  doc.autoTable({
    startY: y,
    head: [["Parâmetro", "Valor", "Mín", "Máx", "Status"]],
    body: PARAMS.filter((p) => p.key !== "mat").map((p) => {
      const v = params[p.key];
      const t = th[p.key] || thresholds[p.key];
      return [p.label, v.toFixed(p.prec), t.min, t.max, v >= t.min && v <= t.max ? "OK" : "FORA"];
    }),
    theme: "grid",
  });
  y = doc.lastAutoTable.finalY + 10;
  doc.text("COMPOSIÇÃO", 14, y);
  y += 5;
  const tw = params.weight;
  doc.autoTable({
    startY: y,
    head: [["Produtor", "Lote", "Fardos", "Peso (ton)", "%", "UHML", "STR", "ELG", "UI", "MIC", "SF", "MST", "SCI"]],
    body: [...lots].sort((a, b) => b.allocWeight - a.allocWeight).map((l) => [l.produtor, l.lote, l.allocBales, l.allocWeight.toFixed(2), ((l.allocWeight / tw) * 100).toFixed(1) + "%", l.uhml, l.str_val, l.elg, l.ui, l.mic, l.sf, l.mst, l.sci]),
    theme: "grid",
  });
  return doc;
}

function exportPDF() {
  const p = calcMixParams(currentMix);
  if (!p) return;
  const n = document.getElementById("mixName").value || "Mistura";
  buildPDF(n, new Date().toLocaleDateString("pt-BR"), p, currentMix, thresholds).save(n.replace(/\s+/g, "_") + ".pdf");
}
function exportPDFFromHist(h) {
  buildPDF(h.name, h.date, h.params, h.lots, h.thresholds || thresholds).save(h.name.replace(/\s+/g, "_") + ".pdf");
}

function bootstrapUpload() {
  const dz = document.getElementById("dropZone");
  const fi = document.getElementById("fileIn");
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("dragover");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    if (e.dataTransfer.files.length) parseCSV(e.dataTransfer.files[0]);
  });
  dz.addEventListener("click", () => fi.click());
  fi.addEventListener("change", () => {
    if (fi.files.length) parseCSV(fi.files[0]);
  });
}

window.goStep = goStep;
window.goPage = goPage;
window.resetStock = resetStock;
window.runEngine = runEngine;
window.runWithTargets = runWithTargets;
window.setTarget = setTarget;
window.editA = editA;
window.rmLot = rmLot;
window.toggleAvail = toggleAvail;
window.addLot = addLot;
window.saveMix = saveMix;
window.viewH = viewH;
window.exportPDF = exportPDF;
window.updRule = updRule;
window.updT = updT;
window.applyAlternative = applyAlternative;
window.sortDt = () => {};
window.sortHd = () => {};

renderHistList();
renderStepBars();
updateSidebar();
bootstrapUpload();
