import { useApp } from "../context/AppContext";
import { PARAMS } from "../domain/types";
import type { SolverMode } from "../engine/solvers/types";

const SOLVER_INFO: Record<SolverMode, { label: string; desc: string; badge?: string }> = {
  classic: {
    label: "Clássica",
    desc: "Engine original: greedy + local search com 5 tentativas (rotation/balanced/quality).",
  },
  montecarlo: {
    label: "Monte Carlo",
    desc: "Executa a engine clássica N vezes com seeds aleatórios e retorna o melhor resultado encontrado.",
    badge: "experimental",
  },
  sa: {
    label: "Simulated Annealing",
    desc: "Meta-heurística que perturba a solução clássica aceitando pioras temporárias para escapar de ótimos locais.",
    badge: "experimental",
  },
};

export function PageConfig() {
  const {
    curStep,
    setCurPage,
    stock,
    thresholds,
    rules,
    optimizationPriority,
    solverMode,
    solverOptions,
    updateThreshold,
    updateRule,
    setOptimizationPriority,
    applyQualityBaseline,
    setSolverMode,
    setSolverOptions,
  } = useApp();

  return (
    <div className="page active" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="pg-title">Parâmetros de Qualidade</div>
          <div className="pg-sub">
            Regras da engine e limites aceitáveis para cada parâmetro da mistura
          </div>
        </div>
        <button className="btn btn-s" onClick={() => setCurPage(curStep === 1 ? "step1" : curStep === 2 ? "step2" : "step3")}>
          ← Voltar ao Gerador
        </button>
      </div>

      <div className="card">
        <div className="card-h">⚙️ Regras da Engine</div>
        <div className="card-sub">Configurações que controlam como a engine gera as misturas</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 16 }}>
            <label className="lbl">Participação mínima por lote (%)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={1}
                max={15}
                step={1}
                value={rules.minLotPct}
                onChange={(e) => updateRule({ minLotPct: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: "var(--cy)" }}
              />
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--cy)", minWidth: 36, textAlign: "right" }}>
                {rules.minLotPct}%
              </span>
            </div>
          </div>
          <div style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 16 }}>
            <label className="lbl">Participação máxima por produtor (%)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={15}
                max={60}
                step={5}
                value={rules.maxProdPct}
                onChange={(e) => updateRule({ maxProdPct: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: "var(--am)" }}
              />
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--am)", minWidth: 36, textAlign: "right" }}>
                {rules.maxProdPct}%
              </span>
            </div>
          </div>
          <div style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 16 }}>
            <label className="lbl">Número máximo de lotes na mistura</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={4}
                max={25}
                step={1}
                value={rules.maxLots}
                onChange={(e) => updateRule({ maxLots: parseInt(e.target.value, 10) })}
                style={{ flex: 1, accentColor: "var(--pp)" }}
              />
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--pp)", minWidth: 36, textAlign: "right" }}>
                {rules.maxLots}
              </span>
            </div>
          </div>
          <div style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 16 }}>
            <label className="lbl">Rotação / Qualidade</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 9, color: "var(--tx3)", whiteSpace: "nowrap" }}>Melhor qualidade</span>
              <input
                type="range"
                min={0}
                max={100}
                step={10}
                value={rules.rotation}
                onChange={(e) => updateRule({ rotation: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: "var(--gn)" }}
              />
              <span style={{ fontSize: 9, color: "var(--tx3)", whiteSpace: "nowrap" }}>Girar estoque</span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--gn)", minWidth: 36, textAlign: "right" }}>
                {rules.rotation}%
              </span>
            </div>
          </div>
          <div style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 16 }}>
            <label className="lbl">Tolerância de peso alvo (%)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={rules.weightTol}
                onChange={(e) => updateRule({ weightTol: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: "var(--cy)" }}
              />
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--cy)", minWidth: 36, textAlign: "right" }}>
                {rules.weightTol}%
              </span>
            </div>
          </div>
          <div style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 16 }}>
            <label className="lbl">Prioridade da otimização</label>
            <select
              className="inp"
              value={optimizationPriority}
              onChange={(e) => setOptimizationPriority(e.target.value)}
            >
              <option value="strict_quality_first">Qualidade estrita</option>
              <option value="balanced">Balanceada</option>
              <option value="rotation_first">Giro de estoque</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="card-h" style={{ marginBottom: 4 }}>
              📊 Limites de Qualidade
            </div>
            <div className="card-sub" style={{ maxWidth: 560 }}>
              Faixas mín/máx da mistura. Use &quot;Baseline do estoque&quot; para alinhar aos lotes com HVI completo (ignora linhas zeradas no import).
            </div>
          </div>
          <button
            type="button"
            className="btn btn-s"
            disabled={!stock.length}
            onClick={() => applyQualityBaseline()}
            title="Define min/máx a partir do min–max dos lotes com medidas completas, com folga de 8%"
          >
            Baseline do estoque
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "130px 1fr 1fr",
            gap: 10,
            padding: "8px 0",
            borderBottom: "2px solid var(--bd)",
            marginBottom: 4,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)" }}>PARÂMETRO</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textAlign: "center" }}>MÍNIMO</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textAlign: "center" }}>MÁXIMO</div>
        </div>
        {PARAMS.map((p) => {
          const t = thresholds[p.key];
          const step = p.prec >= 3 ? 0.001 : p.prec === 2 ? 0.01 : 0.1;
          return (
            <div key={p.key} className="cfg-row">
              <div className="cfg-name">
                {p.label} {p.good ? <span style={{ color: "var(--gn)", fontSize: 10 }}>▲</span> : <span style={{ color: "var(--rd)", fontSize: 10 }}>▼</span>}
              </div>
              <div>
                <input
                  type="number"
                  className="inp inp-num"
                  value={t.min}
                  step={step}
                  style={{ width: "100%" }}
                  onChange={(e) => updateThreshold(p.key, "min", parseFloat(e.target.value))}
                />
              </div>
              <div>
                <input
                  type="number"
                  className="inp inp-num"
                  value={t.max}
                  step={step}
                  style={{ width: "100%" }}
                  onChange={(e) => updateThreshold(p.key, "max", parseFloat(e.target.value))}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-h">🧪 Engine de Otimização</div>
        <div className="card-sub">
          Selecione o algoritmo de otimização. A engine clássica é o padrão. As opções experimentais
          buscam melhores soluções com mais iterações, sem alterar a engine original.
        </div>
        <div className="solver-options">
          {(Object.keys(SOLVER_INFO) as SolverMode[]).map((mode) => {
            const info = SOLVER_INFO[mode];
            const selected = solverMode === mode;
            return (
              <button
                key={mode}
                type="button"
                className={`solver-card${selected ? " solver-card--active" : ""}`}
                onClick={() => setSolverMode(mode)}
              >
                <div className="solver-card-header">
                  <span className="solver-radio">{selected ? "◉" : "○"}</span>
                  <span className="solver-label">{info.label}</span>
                  {info.badge && <span className="solver-badge">{info.badge}</span>}
                </div>
                <div className="solver-desc">{info.desc}</div>
              </button>
            );
          })}
        </div>

        {solverMode === "montecarlo" && (
          <div className="solver-params">
            <label className="lbl">Número de iterações (Monte Carlo)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={5}
                max={50}
                step={5}
                value={solverOptions.mcIterations ?? 20}
                onChange={(e) => setSolverOptions({ mcIterations: parseInt(e.target.value, 10) })}
                style={{ flex: 1, accentColor: "var(--cy)" }}
              />
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--cy)", minWidth: 36, textAlign: "right" }}>
                {solverOptions.mcIterations ?? 20}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--tx3)", marginTop: 4 }}>
              Mais iterações = maior chance de encontrar a melhor solução, mas mais lento.
            </div>
          </div>
        )}

        {solverMode === "sa" && (
          <div className="solver-params">
            <label className="lbl">Iterações (Simulated Annealing)</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={500}
                max={10000}
                step={500}
                value={solverOptions.saIterations ?? 3000}
                onChange={(e) => setSolverOptions({ saIterations: parseInt(e.target.value, 10) })}
                style={{ flex: 1, accentColor: "var(--pp)" }}
              />
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--pp)", minWidth: 36, textAlign: "right" }}>
                {solverOptions.saIterations ?? 3000}
              </span>
            </div>
            <label className="lbl" style={{ marginTop: 12 }}>Temperatura inicial</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={100}
                max={2000}
                step={100}
                value={solverOptions.saT0 ?? 500}
                onChange={(e) => setSolverOptions({ saT0: parseInt(e.target.value, 10) })}
                style={{ flex: 1, accentColor: "var(--am)" }}
              />
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--am)", minWidth: 36, textAlign: "right" }}>
                {solverOptions.saT0 ?? 500}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--tx3)", marginTop: 4 }}>
              Temperatura alta aceita mais pioras inicialmente (exploração ampla). Mais iterações refinam melhor.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
