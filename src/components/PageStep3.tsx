import { useMemo, useState } from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, registerables } from "chart.js";
import { Bar } from "react-chartjs-2";
import { useApp } from "../context/AppContext";
import { PARAMS } from "../domain/types";
import { baleWeight, weightedAverage } from "../engine/constraints";
import { buildPDF } from "../utils/pdf";
import { fmtBRL } from "../engine/sequencer";
import type { Lot } from "../domain/stock";
import { fmtParam } from "../utils/paramFormat";
import { nextSortState, sortRows, type SortColumn } from "../utils/tableSort";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ...registerables);

function sortMark(sort: { key: string; asc: boolean } | null, k: string) {
  if (!sort || sort.key !== k) return null;
  return <span className="th-sort-ind">{sort.asc ? "▲" : "▼"}</span>;
}

export function PageStep3() {
  const {
    curStep,
    stock,
    currentMix,
    thresholds,
    targets,
    targetWeight,
    mixName,
    setTarget,
    setCurStep,
    lastOptimization,
    lastCsvWarnings,
    runWithTargets,
    applyAlternative,
    addLotToMix,
    setCurrentMix,
    removeLotFromMix,
    editAllocation,
    saveMix,
    getParams,
    getViolations,
    getExplainRelaxation,
    weightOk,
    cellCls,
    hasCostData,
    lastSolverResult,
  } = useApp();

  const [availOpen, setAvailOpen] = useState(false);
  const hcd = hasCostData();

  const params = getParams();
  const violations = getViolations(params);
  const usedP = [...new Set(currentMix.map((m) => m.produtor))];
  const allP = [...new Set(stock.map((s) => s.produtor))];
  const wTol = targetWeight * 0.005;
  const wMatch = params ? Math.abs(params.weight - targetWeight) <= Math.max(0.01, wTol) : false;

  const avgStockCost = stock.length ? weightedAverage(stock, "custo", "peso") : 0;

  let score = 100;
  if (params) {
    violations.forEach((v) => {
      const t = thresholds[v.key];
      const range = Math.max(0.0001, t.max - t.min);
      const dist = Math.abs(v.type === "below" ? t.min - v.val : v.val - t.max);
      score -= Math.min(25, (dist / range) * 100);
    });
    if (!wMatch) score -= 10;
    if (hcd && params.custoTon > avgStockCost) score = Math.min(100, score + 5);
  }
  score = Math.max(0, Math.round(score));
  const sC = score >= 80 ? "var(--gn)" : score >= 50 ? "var(--am)" : "var(--rd)";

  const availData = stock.filter((s) => !currentMix.some((m) => m.id === s.id));

  const deltaData = stock.map((r) => {
    const a = currentMix.find((m) => m.id === r.id);
    const alloc = a?.allocWeight || 0;
    return { ...r, alloc, after: r.peso - alloc, pct: r.peso > 0 && alloc > 0 ? -((alloc / r.peso) * 100) : 0 };
  });

  const byP: Record<string, { before: number; after: number }> = {};
  stock.forEach((r) => {
    if (!byP[r.produtor]) byP[r.produtor] = { before: 0, after: 0 };
    const alloc = currentMix.find((m) => m.id === r.id)?.allocWeight || 0;
    byP[r.produtor].before += r.peso;
    byP[r.produtor].after += r.peso - alloc;
  });
  const chartLabels = Object.keys(byP);
  const chartData = {
    labels: chartLabels,
    datasets: [
      { label: "Antes", data: chartLabels.map((n) => +byP[n].before.toFixed(1)), backgroundColor: "rgba(34,211,238,.25)", borderRadius: 4 },
      { label: "Depois", data: chartLabels.map((n) => +byP[n].after.toFixed(1)), backgroundColor: "rgba(16,185,129,.5)", borderRadius: 4 },
    ],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "#e8eaf0" } } },
    scales: {
      y: { grid: { color: "#2a3352" }, ticks: { color: "#9aa1b9" } },
      x: { grid: { display: false }, ticks: { color: "#e8eaf0" } },
    },
  };

  const tw = currentMix.reduce((s, l) => s + (l.allocWeight || 0), 0);

  const [mixSort, setMixSort] = useState<{ key: string; asc: boolean } | null>(null);
  const [availSort, setAvailSort] = useState<{ key: string; asc: boolean } | null>(null);
  const [deltaSort, setDeltaSort] = useState<{ key: string; asc: boolean } | null>(null);

  const mixGetters = useMemo((): Record<string, SortColumn<Lot>> => {
    const g: Record<string, SortColumn<Lot>> = {
      pl: { get: (l) => `${l.produtor}\t${l.lote}` },
      bales: { get: (l) => l.allocBales ?? 0, numeric: true },
      weight: { get: (l) => l.allocWeight ?? 0, numeric: true },
      disp: { get: (l) => l.peso, numeric: true },
      pct: { get: (l) => (tw > 0 ? ((l.allocWeight || 0) / tw) * 100 : 0), numeric: true },
      uhml: { get: (l) => l.uhml, numeric: true },
      str_val: { get: (l) => l.str_val, numeric: true },
      elg: { get: (l) => l.elg, numeric: true },
      mic: { get: (l) => l.mic, numeric: true },
      sf: { get: (l) => l.sf, numeric: true },
      sci: { get: (l) => l.sci, numeric: true },
    };
    if (hcd) {
      g.custo = { get: (l) => l.custo, numeric: true };
      g.lotCost = { get: (l) => l.custo * (l.allocWeight || 0), numeric: true };
    }
    return g;
  }, [tw, hcd]);

  const handleMixSort = (key: string) => {
    if (!mixGetters[key]) return;
    const next = nextSortState(mixSort, key);
    setMixSort(next);
    setCurrentMix(sortRows(currentMix, next.key, next.asc, mixGetters));
  };

  const availGetters = useMemo((): Record<string, SortColumn<Lot>> => {
    const g: Record<string, SortColumn<Lot>> = {
      prod: { get: (l) => l.produtor },
      lote: { get: (l) => l.lote },
      peso: { get: (l) => l.peso, numeric: true },
      uhml: { get: (l) => l.uhml, numeric: true },
      str_val: { get: (l) => l.str_val, numeric: true },
      elg: { get: (l) => l.elg, numeric: true },
      mic: { get: (l) => l.mic, numeric: true },
      sf: { get: (l) => l.sf, numeric: true },
    };
    if (hcd) g.custo = { get: (l) => l.custo, numeric: true };
    return g;
  }, [hcd]);

  type DeltaRow = (typeof deltaData)[number];
  const deltaGetters = useMemo(
    (): Record<string, SortColumn<DeltaRow>> => ({
      produtor: { get: (r) => r.produtor },
      lote: { get: (r) => r.lote },
      antes: { get: (r) => r.peso, numeric: true },
      alloc: { get: (r) => r.alloc, numeric: true },
      after: { get: (r) => r.after, numeric: true },
      delta: { get: (r) => r.pct, numeric: true },
    }),
    []
  );

  const sortedAvail = useMemo(
    () => sortRows(availData, availSort?.key ?? null, availSort?.asc ?? true, availGetters),
    [availData, availSort, availGetters]
  );
  const sortedDelta = useMemo(
    () => sortRows(deltaData, deltaSort?.key ?? null, deltaSort?.asc ?? true, deltaGetters),
    [deltaData, deltaSort, deltaGetters]
  );

  const handleAvailSort = (key: string) => {
    if (!availGetters[key]) return;
    setAvailSort((s) => nextSortState(s, key));
  };
  const handleDeltaSort = (key: string) => {
    if (!deltaGetters[key]) return;
    setDeltaSort((s) => nextSortState(s, key));
  };

  const alternatives = lastOptimization?.alternatives || [];

  const handleSave = () => {
    if (!weightOk(targetWeight)) return;
    saveMix(mixName || "Mistura " + Date.now());
  };

  const handleExportPDF = () => {
    if (!params) return;
    const doc = buildPDF(mixName || "Mistura", new Date().toLocaleDateString("pt-BR"), params, currentMix, thresholds);
    doc.save((mixName || "Mistura").replace(/\s+/g, "_") + ".pdf");
  };

  const steps = [
    { n: 1, l: "Estoque" },
    { n: 2, l: "Gerar" },
    { n: 3, l: "Revisar" },
  ];

  function costColor(c: number, avg: number): string {
    if (c < avg * 0.9) return "var(--cy)";
    if (c > avg * 1.1) return "var(--rd)";
    return "var(--tx2)";
  }

  return (
    <div className="page active" style={{ display: "block" }}>
      <div className="step-bar">
        {steps.map((s, i) => (
          <span key={s.n} style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <div className={`step-pill ${s.n === curStep ? "active" : ""} ${s.n < curStep ? "done" : ""}`}>
              <div className="num">{s.n < curStep ? "✓" : s.n}</div>
              {s.l}
            </div>
            {i < steps.length - 1 && <div className={`step-line ${s.n < curStep ? "done" : ""}`} />}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div className="pg-title">{mixName || "Revisar Mistura"}</div>
          <div className="pg-sub" style={{ marginBottom: 0 }}>
            {params ? `${currentMix.length} lotes · ${usedP.length} produtores · ${params.bales} fardos · ${params.weight.toFixed(2)} ton` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-s btn-sm" onClick={() => setCurStep(2)}>← Voltar</button>
          <button className="btn btn-s btn-sm" onClick={handleExportPDF}>📄 PDF</button>
          <button className={`btn btn-p ${!wMatch ? "btn-disabled" : ""}`} onClick={handleSave}>💾 Salvar</button>
        </div>
      </div>

      <div id="alertsBox" style={{ marginBottom: 12 }}>
        {lastCsvWarnings.length ? <div className="alert alert-info">CSV com {lastCsvWarnings.length} alertas de qualidade.</div> : null}
        {!wMatch && params ? <div className="alert alert-warn">⚖️ Peso fora da tolerância alvo.</div> : null}
        {violations.map((v) => {
          const def = PARAMS.find((p) => p.key === v.key);
          const prec = def?.prec ?? 3;
          return (
            <div key={v.key} className="alert alert-danger">
              ⚠️ <strong>{v.label}</strong> {v.type === "below" ? "abaixo" : "acima"}:{" "}
              <span className="mono">{v.val.toFixed(prec)}</span> (limite: {v.limit})
            </div>
          );
        })}
        {getExplainRelaxation() ? <div className="alert alert-warn">{getExplainRelaxation()}</div> : null}
        {wMatch && !violations.length ? (
          <div className="alert alert-ok">
            ✅ Qualidade OK, peso atingido{hcd && params ? ` — mistura consumindo ${fmtBRL(params.custoTon)}/ton do estoque` : ""}
          </div>
        ) : null}
      </div>

      {PARAMS.some((p) => targets[p.key] != null) && (
        <div style={{ marginBottom: 12 }}>
                   <button type="button" className="btn btn-amber" onClick={() => void runWithTargets(targetWeight)}>🎯 Regenerar com Targets</button>
          <span style={{ fontSize: 11, color: "var(--tx3)", marginLeft: 10 }}>Targets editados nos KPIs abaixo</span>
        </div>
      )}

      {alternatives.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-h">Alternativas Geradas pela Engine</div>
          <div className="card-sub">Compare as 3 melhores composições</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
            {alternatives.slice(0, 3).map((alt, idx) => (
              <div key={idx} style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Alternativa {idx + 1}</div>
                <div className="mono" style={{ fontSize: 11, color: alt.feasible ? "var(--gn)" : "var(--am)", marginBottom: 8 }}>
                  {alt.feasible ? "Factível" : "Com alertas"}
                </div>
                <button className="btn btn-s btn-sm" style={{ width: "100%" }} onClick={() => applyAlternative(idx)}>Aplicar alternativa</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`step3-kpi-grid${hcd ? " step3-kpi-grid--cost" : ""}`} style={{ gap: 14, marginBottom: 14 }}>
        <div>
          {hcd && params && (
            <div className="card" style={{ textAlign: "center", padding: 16, marginBottom: 12, borderColor: "rgba(34,211,238,.3)", background: "rgba(34,211,238,.04)" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--cy)", textTransform: "uppercase", letterSpacing: 1 }}>Custo da Mistura</div>
              <div className="mono" style={{ fontSize: 28, fontWeight: 900, color: "var(--cy)", margin: "6px 0" }}>{fmtBRL(params.custoTon)}</div>
              <div style={{ fontSize: 10, color: "var(--tx3)" }}>R$/ton</div>
              <div style={{ fontSize: 12, color: "var(--tx2)", marginTop: 6 }}>Total: {fmtBRL(params.custoTotal)}</div>
              <div style={{ fontSize: 11, fontWeight: 700, marginTop: 8 }}>
                {params.custoTon > avgStockCost ? (
                  <span style={{ color: "var(--am)" }}>↑ {fmtBRL(params.custoTon - avgStockCost)}/ton acima da média</span>
                ) : (
                  <span style={{ color: "var(--cy)" }}>↓ {fmtBRL(avgStockCost - params.custoTon)}/ton abaixo da média</span>
                )}
              </div>
            </div>
          )}
          <div className="card" style={{ textAlign: "center", padding: 16, marginBottom: 0 }}>
            <div className="gauge">
              <svg width={96} height={96} viewBox="0 0 100 100">
                <circle cx={50} cy={50} r={42} stroke="var(--sf3)" strokeWidth={8} fill="none" />
                <circle cx={50} cy={50} r={42} stroke={sC} strokeWidth={8} fill="none" strokeLinecap="round" strokeDasharray={264} strokeDashoffset={264 - (264 * score) / 100} />
              </svg>
              <div className="gauge-v">
                <div className="gauge-n" style={{ color: sC }}>{score}</div>
                <div className="gauge-l">Score</div>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700 }}>
              {score >= 80 ? <span style={{ color: "var(--gn)" }}>Excelente</span> : score >= 50 ? <span style={{ color: "var(--am)" }}>Atenção</span> : <span style={{ color: "var(--rd)" }}>Fora</span>}
            </div>
            <div style={{ marginTop: 10, textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--tx3)" }}>
                <span>Produtores</span>
                <span>{usedP.length}/{allP.length}</span>
              </div>
              <div className="prog">
                <div className="prog-f" style={{ width: `${(usedP.length / Math.max(1, allP.length)) * 100}%`, background: "var(--cy)" }} />
              </div>
            </div>
          </div>
        </div>
        <div className="step3-kpis-col">
          {lastSolverResult && lastSolverResult.solverMode !== "classic" && (
            <div className="solver-result-badge" role="status">
              <span className="solver-result-badge__label">
                Engine: {lastSolverResult.solverMode === "montecarlo" ? "Monte Carlo" : "Simulated Annealing"}
              </span>
              <span className="solver-result-badge__sep" aria-hidden />
              <span>{lastSolverResult.elapsed}ms</span>
              {lastSolverResult.improvement != null && (
                <>
                  <span className="solver-result-badge__sep" aria-hidden />
                  <span className={lastSolverResult.improvement > 0.1 ? "improvement-pos" : lastSolverResult.improvement < -0.1 ? "improvement-neg" : "improvement-zero"}>
                    {lastSolverResult.improvement > 0 ? "+" : ""}{lastSolverResult.improvement.toFixed(1)}% vs clássica
                  </span>
                </>
              )}
            </div>
          )}
          <div className="mx">
            {params && (
              <>
                <div className="mx-item accent">
                <div className="mx-lbl">Peso</div>
                <div className="mx-val">{params.weight.toFixed(2)}</div>
                <div className="mx-rng mono">alvo: {targetWeight} ton</div>
                <div className="mx-st" style={{ color: wMatch ? "var(--gn)" : "var(--am)" }}>{wMatch ? "✓ Atingido" : `Faltam ${Math.max(0, targetWeight - params.weight).toFixed(2)}`}</div>
              </div>
              {hcd && (
                <div className="mx-item" style={{ borderColor: "rgba(34,211,238,.3)", background: "rgba(34,211,238,.06)" }}>
                  <div className="mx-lbl">R$/ton</div>
                  <div className="mx-val" style={{ color: "var(--cy)" }}>{fmtBRL(params.custoTon)}</div>
                  <div className="mx-rng mono">média: {fmtBRL(avgStockCost)}</div>
                  <div className="mx-st" style={{ color: params.custoTon > avgStockCost ? "var(--am)" : "var(--cy)" }}>
                    {params.custoTon > avgStockCost ? "↑ Limpando estoque" : "↓ Abaixo da média"}
                  </div>
                </div>
              )}
              {PARAMS.filter((p) => p.key !== "mat").map((p) => {
                const v = params[p.key as keyof typeof params] as number;
                const t = thresholds[p.key];
                const ok = v >= t.min && v <= t.max;
                const tgtVal = targets[p.key] ?? "";
                return (
                  <div key={p.key} className={`mx-item ${ok ? "ok" : "danger"}`}>
                    <div className="mx-lbl">{p.label}</div>
                    <div className="mx-val" style={{ color: ok ? "var(--gn)" : "var(--rd)" }}>{v.toFixed(p.prec)}</div>
                    <div className="mx-rng mono">{t.min} — {t.max}</div>
                    <div className="mx-st">{ok ? "✓ OK" : "⚠ Fora"}</div>
                    <div className="mx-tgt">
                      <span style={{ fontSize: 8, color: "var(--am)", fontWeight: 700 }}>🎯</span>
                      <input type="number" value={tgtVal === "" ? "" : tgtVal} step={p.prec >= 3 ? 0.001 : p.prec === 2 ? 0.01 : 0.1} placeholder="—" onChange={(e) => setTarget(p.key, e.target.value === "" ? null : parseFloat(e.target.value))} />
                    </div>
                  </div>
                );
              })}
            </>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="card-h">Composição da Mistura</div>
          <div style={{ fontSize: 11, color: "var(--tx3)" }}>Edite fardos ou peso · Clique cabeçalho para ordenar</div>
        </div>
        <div className="tbl-scroll" style={{ maxHeight: 400 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingLeft: 12 }} onClick={() => handleMixSort("pl")}>
                  Produtor / Lote{sortMark(mixSort, "pl")}
                </th>
                <th onClick={() => handleMixSort("bales")}>Fardos{sortMark(mixSort, "bales")}</th>
                <th onClick={() => handleMixSort("weight")}>Peso (ton){sortMark(mixSort, "weight")}</th>
                <th onClick={() => handleMixSort("disp")}>Disp.{sortMark(mixSort, "disp")}</th>
                <th onClick={() => handleMixSort("pct")}>%{sortMark(mixSort, "pct")}</th>
                {hcd && (
                  <th onClick={() => handleMixSort("custo")}>
                    R$/ton{sortMark(mixSort, "custo")}
                  </th>
                )}
                {hcd && (
                  <th onClick={() => handleMixSort("lotCost")}>
                    Custo Lote{sortMark(mixSort, "lotCost")}
                  </th>
                )}
                <th onClick={() => handleMixSort("uhml")}>UHML (mm){sortMark(mixSort, "uhml")}</th>
                <th onClick={() => handleMixSort("str_val")}>STR{sortMark(mixSort, "str_val")}</th>
                <th onClick={() => handleMixSort("elg")}>ELG{sortMark(mixSort, "elg")}</th>
                <th onClick={() => handleMixSort("mic")}>MIC{sortMark(mixSort, "mic")}</th>
                <th onClick={() => handleMixSort("sf")}>SF{sortMark(mixSort, "sf")}</th>
                <th onClick={() => handleMixSort("sci")}>SCI{sortMark(mixSort, "sci")}</th>
                <th className="th-static" />
              </tr>
            </thead>
            <tbody>
              {currentMix.map((l, i) => {
                const pct = tw > 0 ? ((l.allocWeight || 0) / tw * 100).toFixed(1) : "0";
                const bw = baleWeight(l);
                const usage = l.peso > 0 ? ((l.allocWeight || 0) / l.peso * 100) : 0;
                const is100 = usage >= 99.5;
                const lotCost = l.custo * (l.allocWeight || 0);
                return (
                  <tr key={l.id + "-" + i} style={is100 ? { background: "var(--rdbg)" } : undefined}>
                    <td>
                      <span style={{ fontWeight: 700 }}>{l.produtor}</span>{" "}
                      <span style={{ color: "var(--tx3)", fontSize: 10 }}>{l.lote}</span>
                      {is100 && <span style={{ fontSize: 9, color: "var(--rd)", marginLeft: 4 }}>100%</span>}
                    </td>
                    <td>
                      <input type="number" className="inp inp-sm inp-num mono" value={l.allocBales || 0} min={1} max={l.fardos} onChange={(e) => editAllocation(i, "bales", parseInt(e.target.value, 10) || 1)} />
                    </td>
                    <td>
                      <input type="number" className="inp inp-sm inp-num mono" value={(l.allocWeight || 0).toFixed(2)} min={bw} max={l.peso} step={0.01} style={{ width: 75 }} onChange={(e) => editAllocation(i, "weight", parseFloat(e.target.value) || bw)} />
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: is100 ? "var(--rd)" : usage > 80 ? "var(--am)" : "var(--tx3)" }}>{l.peso.toFixed(2)}</td>
                    <td className="mono" style={{ color: "var(--cy)" }}>{pct}%</td>
                    {hcd && <td className="mono" style={{ color: costColor(l.custo, avgStockCost), fontWeight: 700 }}>{fmtBRL(l.custo)}</td>}
                    {hcd && <td className="mono" style={{ fontSize: 11, color: "var(--tx2)" }}>{fmtBRL(lotCost)}</td>}
                    <td className={`mono ${cellCls("uhml", l.uhml)}`}>{fmtParam("uhml", l.uhml)}</td>
                    <td className={`mono ${cellCls("str_val", l.str_val)}`}>{fmtParam("str_val", l.str_val)}</td>
                    <td className={`mono ${cellCls("elg", l.elg)}`}>{fmtParam("elg", l.elg)}</td>
                    <td className={`mono ${cellCls("mic", l.mic)}`}>{fmtParam("mic", l.mic)}</td>
                    <td className={`mono ${cellCls("sf", l.sf)}`}>{fmtParam("sf", l.sf)}</td>
                    <td className="mono" style={{ color: "var(--tx3)" }}>{fmtParam("sci", l.sci)}</td>
                    <td>
                      <button className="btn btn-d btn-sm" style={{ padding: "2px 6px", fontSize: 9 }} onClick={() => removeLotFromMix(i)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {params && (
                <tr style={{ background: "var(--sf3)", fontWeight: 700 }}>
                  <td style={{ textAlign: "left", paddingLeft: 12 }}>TOTAL</td>
                  <td className="mono">{params.bales}</td>
                  <td className="mono">{params.weight.toFixed(2)}</td>
                  <td></td>
                  <td className="mono">100%</td>
                  {hcd && <td className="mono" style={{ color: "var(--cy)" }}>{fmtBRL(params.custoTon)}</td>}
                  {hcd && <td className="mono" style={{ color: "var(--cy)" }}>{fmtBRL(params.custoTotal)}</td>}
                  <td className="mono">{fmtParam("uhml", params.uhml)}</td>
                  <td className="mono">{fmtParam("str_val", params.str_val)}</td>
                  <td className="mono">{fmtParam("elg", params.elg)}</td>
                  <td className="mono">{fmtParam("mic", params.mic)}</td>
                  <td className="mono">{fmtParam("sf", params.sf)}</td>
                  <td className="mono" style={{ color: "var(--tx3)" }}>{fmtParam("sci", params.sci)}</td>
                  <td></td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {availData.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 0" }} onClick={() => setAvailOpen(!availOpen)}>
              <span style={{ fontSize: 10, color: "var(--cy)", transition: "transform .2s", transform: availOpen ? "rotate(90deg)" : "" }}>▶</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--cy)" }}>{availData.length} lotes disponíveis no estoque</span>
            </div>
            {availOpen && (
              <div style={{ marginTop: 8 }}>
                <div className="tbl-scroll" style={{ maxHeight: 260 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th className="th-static" />
                        <th onClick={() => handleAvailSort("prod")}>Produtor{sortMark(availSort, "prod")}</th>
                        <th onClick={() => handleAvailSort("lote")}>Lote{sortMark(availSort, "lote")}</th>
                        <th onClick={() => handleAvailSort("peso")}>Peso{sortMark(availSort, "peso")}</th>
                        {hcd && (
                          <th onClick={() => handleAvailSort("custo")}>
                            R$/ton{sortMark(availSort, "custo")}
                          </th>
                        )}
                        <th onClick={() => handleAvailSort("uhml")}>UHML (mm){sortMark(availSort, "uhml")}</th>
                        <th onClick={() => handleAvailSort("str_val")}>STR{sortMark(availSort, "str_val")}</th>
                        <th onClick={() => handleAvailSort("elg")}>ELG{sortMark(availSort, "elg")}</th>
                        <th onClick={() => handleAvailSort("mic")}>MIC{sortMark(availSort, "mic")}</th>
                        <th onClick={() => handleAvailSort("sf")}>SF{sortMark(availSort, "sf")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAvail.map((r) => (
                        <tr key={r.id}>
                          <td style={{ textAlign: "center" }}>
                            <button className="btn btn-p btn-sm" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => addLotToMix(r.id)}>+</button>
                          </td>
                          <td>{r.produtor}</td>
                          <td style={{ fontWeight: 400, color: "var(--tx3)" }}>{r.lote}</td>
                          <td className="mono">{r.peso.toFixed(2)}</td>
                          {hcd && <td className="mono" style={{ color: costColor(r.custo, avgStockCost), fontWeight: 700 }}>{fmtBRL(r.custo)}</td>}
                          <td className={`mono ${cellCls("uhml", r.uhml)}`}>{fmtParam("uhml", r.uhml)}</td>
                          <td className={`mono ${cellCls("str_val", r.str_val)}`}>{fmtParam("str_val", r.str_val)}</td>
                          <td className={`mono ${cellCls("elg", r.elg)}`}>{fmtParam("elg", r.elg)}</td>
                          <td className={`mono ${cellCls("mic", r.mic)}`}>{fmtParam("mic", r.mic)}</td>
                          <td className={`mono ${cellCls("sf", r.sf)}`}>{fmtParam("sf", r.sf)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-h">Variação do Estoque após Mistura</div>
        <div className="card-sub">Impacto no estoque disponível</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { l: "Antes", v: stock.reduce((s, r) => s + r.peso, 0).toFixed(1) + " ton", c: "var(--tx)" },
            { l: "Alocado", v: currentMix.reduce((s, l) => s + (l.allocWeight || 0), 0).toFixed(2) + " ton", c: "var(--am)" },
            { l: "Depois", v: (stock.reduce((s, r) => s + r.peso, 0) - currentMix.reduce((s, l) => s + (l.allocWeight || 0), 0)).toFixed(1) + " ton", c: "var(--cy)" },
            { l: "Consumo", v: ((currentMix.reduce((s, l) => s + (l.allocWeight || 0), 0) / Math.max(0.001, stock.reduce((s, r) => s + r.peso, 0))) * 100).toFixed(1) + "%", c: "var(--rd)" },
          ].map((k) => (
            <div key={k.l} style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 10, textAlign: "center" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tx3)", textTransform: "uppercase" }}>{k.l}</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: k.c, marginTop: 3 }}>{k.v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="tbl-scroll" style={{ maxHeight: 300 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ textAlign: "left", paddingLeft: 12 }} onClick={() => handleDeltaSort("produtor")}>
                    Produtor{sortMark(deltaSort, "produtor")}
                  </th>
                  <th onClick={() => handleDeltaSort("lote")}>Lote{sortMark(deltaSort, "lote")}</th>
                  <th onClick={() => handleDeltaSort("antes")}>Antes{sortMark(deltaSort, "antes")}</th>
                  <th onClick={() => handleDeltaSort("alloc")}>Alocado{sortMark(deltaSort, "alloc")}</th>
                  <th onClick={() => handleDeltaSort("after")}>Depois{sortMark(deltaSort, "after")}</th>
                  <th onClick={() => handleDeltaSort("delta")}>Δ{sortMark(deltaSort, "delta")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedDelta.map((r) => (
                  <tr key={r.id}>
                    <td>{r.produtor}</td>
                    <td style={{ fontWeight: 400, color: "var(--tx3)" }}>{r.lote}</td>
                    <td className="mono">{r.peso.toFixed(2)}</td>
                    <td className={`mono ${r.alloc > 0 ? "delta-neg" : ""}`}>{r.alloc > 0 ? r.alloc.toFixed(2) : "—"}</td>
                    <td className="mono">{r.after.toFixed(2)}</td>
                    <td className={`mono ${r.alloc > 0 ? "delta-neg" : ""}`}>{r.alloc > 0 ? r.pct.toFixed(0) + "%" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ height: 280 }}>
            <Bar data={chartData} options={chartOptions} />
          </div>
        </div>
      </div>
    </div>
  );
}
