import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { fmtBRL } from "../engine/sequencer";
import { ThresholdLimitsEditor } from "./ThresholdLimitsEditor";
import { fmtKgFromTons, kgToTons, tonsToKg } from "../utils/weight";

export function PageStep2() {
  const {
    curStep,
    stockForMixture,
    targetWeight,
    mixName,
    suggestions,
    isGenerating,
    generationStatus,
    generationProgress,
    setTargetWeight,
    setMixName,
    runStrategies,
    selectSuggestion,
    hasCostData,
  } = useApp();

  const hcd = hasCostData();
  const [targetWeightKgText, setTargetWeightKgText] = useState(() => String(Math.round(tonsToKg(targetWeight))));

  useEffect(() => {
    if (stockForMixture.length) {
      const tP = stockForMixture.reduce((s, r) => s + r.peso, 0);
      setTargetWeight(Math.round(tP * 0.15 * 100) / 100 || 30);
    }
  }, [stockForMixture, setTargetWeight]);

  useEffect(() => {
    setTargetWeightKgText(String(Math.round(tonsToKg(targetWeight))));
  }, [targetWeight]);

  const steps = [
    { n: 1, l: "Estoque" },
    { n: 2, l: "Gerar" },
    { n: 3, l: "Revisar" },
  ];

  const avgCusto = stockForMixture.length
    ? stockForMixture.reduce((s, l) => s + l.custo * l.peso, 0) /
      stockForMixture.reduce((s, l) => s + l.peso, 0)
    : 0;

  return (
    <div className="page active page-step2" style={{ display: "block" }}>
      <div className="step-bar">
        {steps.map((s, i) => (
          <span key={s.n} style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <div
              className={`step-pill ${s.n === curStep ? "active" : ""} ${s.n < curStep ? "done" : ""}`}
            >
              <div className="num">{s.n < curStep ? "✓" : s.n}</div>
              {s.l}
            </div>
            {i < steps.length - 1 && <div className={`step-line ${s.n < curStep ? "done" : ""}`} />}
          </span>
        ))}
      </div>
      <div className="pg-title">Gerar Mistura</div>
      <div className="pg-sub">
        A engine gera <strong style={{ color: "var(--em, var(--cy))" }}>3 sugestões</strong>{" "}
        (Engine Otimizada, Monte Carlo e Simulated Annealing) para você comparar e escolher a melhor. Com
        sugestões prontas, elas surgem <strong>acima</strong> do bloco de limites; confira, ajuste e gere de novo
        se precisar.
      </div>
      <div className="card">
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label className="lbl">Peso Alvo (kg)</label>
            <input
              type="number"
              className="inp inp-num"
              value={targetWeightKgText}
              onChange={(e) => {
                const text = e.target.value;
                setTargetWeightKgText(text);
                const kg = Number(text.replace(",", "."));
                if (Number.isFinite(kg) && kg > 0) setTargetWeight(kgToTons(kg));
              }}
              step={1}
              style={{ width: 130 }}
            />
          </div>
          <div>
            <label className="lbl">Nome da Mistura</label>
            <input
              type="text"
              className="inp"
              value={mixName}
              onChange={(e) => setMixName(e.target.value)}
              placeholder="Ex: Mistura 225"
              style={{ width: 200 }}
            />
          </div>
          <button
            type="button"
            className="btn btn-p"
            style={{ height: 38 }}
            disabled={isGenerating}
            onClick={() => void runStrategies(targetWeight)}
          >
            {isGenerating ? "⚡ Gerando…" : "⚡ Gerar 3 Sugestões"}
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="sug-grid">
          {suggestions.map((s, i) => {
            const p = s.params;
            const v = s.violations;
            const nProds = [...new Set(s.lots.map((l) => l.produtor))].length;
            const wMatch = Math.abs(p.weight - targetWeight) <= Math.max(0.01, targetWeight * 0.005);
            const costVsAvg = p.custoTon > avgCusto
              ? `↑ ${fmtBRL(p.custoTon - avgCusto)} acima`
              : `↓ ${fmtBRL(avgCusto - p.custoTon)} abaixo`;

            return (
              <div
                key={i}
                className={`sug-card${i === 0 ? " best" : ""}`}
                onClick={() => selectSuggestion(i)}
              >
                {i === 0 && !s.strategy.id.startsWith("solver_") && (
                  <div className="sug-tag" style={{ background: "var(--cy)", color: "var(--bg)" }}>
                    Recomendada
                  </div>
                )}
                {s.strategy.id === "engine_optimized" && (
                  <div className="sug-tag" style={{ background: s.strategy.color, color: "#fff" }}>
                    Engine otimizada — {s.elapsed}ms
                  </div>
                )}
                {s.strategy.id.startsWith("solver_") && (
                  <div className="sug-tag" style={{ background: s.strategy.color, color: "#fff" }}>
                    Experimental — {s.elapsed}ms
                  </div>
                )}
                <div style={{ fontSize: 22, marginBottom: 6 }}>{s.strategy.icon}</div>
                <div className="sug-name" style={{ color: s.strategy.color }}>{s.strategy.name}</div>
                <div style={{ fontSize: 11, color: "var(--tx3)", marginBottom: 12, lineHeight: 1.4 }}>
                  {s.strategy.desc}
                </div>

                {hcd && (
                  <>
                    <div className="sug-row">
                      <span className="sug-label">R$/ton</span>
                      <span className="sug-val" style={{ color: "var(--cy)" }}>{fmtBRL(p.custoTon)}</span>
                    </div>
                    <div className="sug-row">
                      <span className="sug-label">Total</span>
                      <span className="sug-val" style={{ color: "var(--tx2)" }}>{fmtBRL(p.custoTotal)}</span>
                    </div>
                    <div className="sug-row">
                      <span className="sug-label">vs. Média</span>
                      <span className="sug-val" style={{ color: p.custoTon > avgCusto ? "var(--am)" : "var(--cy)", fontSize: 11 }}>
                        {costVsAvg}
                      </span>
                    </div>
                  </>
                )}

                <div className="sug-row">
                  <span className="sug-label">Peso</span>
                  <span className="sug-val" style={{ color: wMatch ? "var(--gn)" : "var(--am)" }}>
                    {fmtKgFromTons(p.weight)} kg
                  </span>
                </div>
                <div className="sug-row">
                  <span className="sug-label">Lotes</span>
                  <span className="sug-val">{s.lots.length}</span>
                </div>
                <div className="sug-row">
                  <span className="sug-label">Produtores</span>
                  <span className="sug-val">{nProds}</span>
                </div>
                <div className="sug-row">
                  <span className="sug-label">Qualidade</span>
                  <span className="sug-val" style={{ color: v.length === 0 ? "var(--gn)" : "var(--rd)" }}>
                    {v.length === 0 ? "✓ OK" : `${v.length} violação${v.length > 1 ? "ões" : ""}`}
                  </span>
                </div>

                <div style={{ marginTop: 12, textAlign: "center" }}>
                  <button
                    className="btn btn-p btn-sm"
                    style={{ background: s.strategy.color, width: "100%" }}
                    onClick={(e) => { e.stopPropagation(); selectSuggestion(i); }}
                  >
                    Selecionar →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <ThresholdLimitsEditor variant="compact" showStockRange />
      </div>

      {suggestions.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--tx3)" }}>
          <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>💰</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            Clique em &quot;Gerar 3 Sugestões&quot; para iniciar
          </div>
          <div style={{ fontSize: 12, marginTop: 6, maxWidth: 540, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
            Cada estratégia otimiza por um objetivo diferente, respeitando os mesmos limites de qualidade. Você escolhe a que faz mais sentido para o momento.
          </div>
        </div>
      )}

      {isGenerating && (
        <div className="gen-loading-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="gen-loading-card">
            <div className="gen-loading-title">Gerando sugestões…</div>
            <div className="gen-progress-wrap" aria-hidden>
              <div
                className="gen-progress-bar"
                style={{ width: `${Math.min(100, Math.max(0, generationProgress))}%` }}
              />
            </div>
            <div className="gen-loading-pct">{Math.min(100, Math.max(0, generationProgress))}%</div>
            <div className="gen-loading-status">{generationStatus}</div>
          </div>
        </div>
      )}
    </div>
  );
}
