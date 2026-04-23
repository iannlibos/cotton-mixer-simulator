import { useApp } from "../context/AppContext";
import { ThresholdLimitsEditor } from "./ThresholdLimitsEditor";

export function PageConfig() {
  const {
    curStep,
    setCurPage,
    rules,
    optimizationPriority,
    updateRule,
    setOptimizationPriority,
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
        <ThresholdLimitsEditor variant="full" />
      </div>
    </div>
  );
}
