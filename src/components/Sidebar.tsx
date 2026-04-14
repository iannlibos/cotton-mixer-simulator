import { useApp } from "../context/AppContext";
import { fmtBRL } from "../engine/sequencer";

type SidebarProps = {
  collapsed: boolean;
  onToggleSidebar: () => void;
};

export function Sidebar({ collapsed, onToggleSidebar }: SidebarProps) {
  const {
    curStep,
    curPage,
    stock,
    currentMix,
    history,
    setCurStep,
    setCurPage,
    viewHistory,
  } = useApp();

  const isStepActive = (n: number) =>
    curPage === "step1" || curPage === "step2" || curPage === "step3"
      ? curStep === n
      : false;

  const isStepDone = (n: number) => curStep > n;
  const isStepUnlocked = (n: number) =>
    n < curStep || (n === 2 && stock.length > 0) || (n === 3 && currentMix.length > 0);

  const steps = [
    { n: 1, label: "Carregar Estoque" },
    { n: 2, label: "Gerar Mistura" },
    { n: 3, label: "Revisar e Salvar" },
  ];

  return (
    <div className={`sb${collapsed ? " sb--collapsed" : ""}`}>
      <div className="sb-hd">
        <button
          type="button"
          className="sb-toggle"
          onClick={onToggleSidebar}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? "▶" : "◀"}
        </button>
        <div className="sb-brand">
          <div className="sb-logo">
            <div className="sb-dot" />
            <span className="sb-tag">Nortex</span>
          </div>
          <div className="sb-name">Gerador de Misturas</div>
        </div>
      </div>
      <div className="sb-steps">
        {steps.map((s) => (
          <div
            key={s.n}
            className={`sb-step ${isStepActive(s.n) ? "active" : ""} ${isStepDone(s.n) ? "done" : ""} ${isStepUnlocked(s.n) ? "unlocked" : ""}`}
            data-s={s.n}
            onClick={() => isStepUnlocked(s.n) && setCurStep(s.n)}
          >
            <div className="sb-num">{isStepDone(s.n) ? "✓" : s.n}</div>
            <div className="sb-step-label">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="sb-divider" />
      <div className="sb-config">
        <button
          className={`sb-cfg-btn ${curPage === "config" ? "active" : ""}`}
          onClick={() => setCurPage("config")}
          title="Parâmetros"
        >
          <span style={{ fontSize: 14 }}>⚙️</span>
          <span className="sb-cfg-txt" style={{ fontSize: 13, fontWeight: 600, color: "var(--tx2)" }}>
            Parâmetros
          </span>
        </button>
        <button
          className={`sb-cfg-btn ${curPage === "rules" ? "active" : ""}`}
          onClick={() => setCurPage("rules")}
          title="Regras de Negócio"
        >
          <span style={{ fontSize: 14 }}>📘</span>
          <span className="sb-cfg-txt" style={{ fontSize: 13, fontWeight: 600, color: "var(--tx2)" }}>
            Regras
          </span>
        </button>
      </div>
      <div className="sb-hist">
        <div className="sb-section">Histórico</div>
        <div id="histList">
          {history.length === 0 ? (
            <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--tx3)" }}>
              Nenhuma mistura
            </div>
          ) : (
            history.map((h, i) => (
              <div
                key={h.id}
                className="sb-hist-item"
                onClick={() => viewHistory(i)}
              >
                <div
                  className="sb-hist-dot"
                  style={{
                    background:
                      h.score >= 80 ? "var(--gn)" : h.score >= 50 ? "var(--am)" : "var(--rd)",
                  }}
                />
                <div className="sb-hist-name">{h.name}</div>
                <div className="sb-hist-date" style={{ color: h.params.custoTon ? "var(--cy)" : "var(--tx3)" }}>
                  {h.params.custoTon ? fmtBRL(h.params.custoTon) : h.date}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
