import { useApp } from "../context/AppContext";
import { ThresholdLimitsEditor } from "./ThresholdLimitsEditor";

const PRIORITY_OPTIONS = [
  {
    id: "rotation_first",
    title: "Produtor com maior estoque",
    tag: "Padrão",
    desc: "Aproxima a mistura da participação de cada produtor no estoque disponível, dando mais giro para quem concentra maior volume.",
    weights: "Mais peso para proporcionalidade por produtor, mantendo qualidade e regras como restrições.",
  },
  {
    id: "low_quality_first",
    title: "Piores lotes primeiro",
    tag: "Giro crítico",
    desc: "Tenta consumir primeiro os lotes com pior encaixe de qualidade, desde que a mistura final continue dentro dos limites.",
    weights: "Mais peso para uso de lotes de menor qualidade, com penalidade forte para violações.",
  },
  {
    id: "balanced",
    title: "Balanceada",
    tag: "Equilíbrio",
    desc: "Distribui a decisão entre qualidade, giro de estoque, diversidade de produtores e aderência ao peso alvo.",
    weights: "Pesos intermediários para cenários sem uma prioridade operacional dominante.",
  },
  {
    id: "strict_quality_first",
    title: "Qualidade conservadora",
    tag: "Qualidade",
    desc: "Prefere preservar margem de qualidade antes de buscar giro agressivo dos lotes ou proporcionalidade do estoque.",
    weights: "Mais peso para qualidade e targets, reduzindo incentivo ao uso de lotes piores.",
  },
];

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
          <div style={{ gridColumn: "1 / -1", background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <label className="lbl">Estratégia de geração da mistura</label>
                <div style={{ fontSize: 12, color: "var(--tx3)", marginTop: 4 }}>
                  Escolha como a engine deve priorizar os lotes quando houver mais de uma mistura viável.
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {PRIORITY_OPTIONS.map((option) => {
                const active = optimizationPriority === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setOptimizationPriority(option.id)}
                    style={{
                      textAlign: "left",
                      background: active ? "rgba(34, 211, 238, 0.12)" : "var(--sf)",
                      border: active ? "1px solid var(--cy)" : "1px solid var(--bd)",
                      borderRadius: "var(--r)",
                      padding: 14,
                      color: "var(--tx)",
                      cursor: "pointer",
                      boxShadow: active ? "0 0 0 1px rgba(34, 211, 238, 0.18) inset" : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                      <strong style={{ fontSize: 14 }}>{option.title}</strong>
                      <span
                        style={{
                          fontSize: 10,
                          color: active ? "var(--cy)" : "var(--tx3)",
                          border: `1px solid ${active ? "var(--cy)" : "var(--bd)"}`,
                          borderRadius: 999,
                          padding: "2px 7px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {option.tag}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--tx2)", lineHeight: 1.45, marginBottom: 10 }}>
                      {option.desc}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--tx3)", lineHeight: 1.4 }}>
                      {option.weights}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <ThresholdLimitsEditor variant="full" />
      </div>
    </div>
  );
}
