import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "../context/AppContext";
import { collectHviParamStats } from "../engine/baseline";
import { PARAMS, formatParamLimit, roundParamLimit, type ParamDef } from "../domain/types";

const MISTURA_MIN_TITLE = "Limites mínimo da mistura que será gerada";
const MISTURA_MAX_TITLE = "Limites máximo da mistura que será gerada";

function ThresholdLimitInput({
  value,
  param,
  side,
  onCommit,
}: {
  value: number;
  param: ParamDef;
  side: "min" | "max";
  onCommit: (n: number) => void;
}) {
  const { prec } = param;
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft !== null ? draft : formatParamLimit(value, prec);

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className="inp inp-num"
      value={display}
      title={side === "min" ? MISTURA_MIN_TITLE : MISTURA_MAX_TITLE}
      aria-label={`${param.label} — ${side === "min" ? MISTURA_MIN_TITLE : MISTURA_MAX_TITLE}`}
      style={{ width: "100%" }}
      onFocus={() => setDraft(formatParamLimit(value, prec))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const raw = draft.replace(",", ".").trim();
        setDraft(null);
        if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return;
        onCommit(roundParamLimit(n, prec));
      }}
    />
  );
}

function StockReadonlyCell({ value, prec }: { value: number | null; prec: number }) {
  const text =
    value !== null && Number.isFinite(value) ? formatParamLimit(value, prec) : "—";
  return (
    <div
      className="inp inp-num mono"
      style={{
        width: "100%",
        cursor: "default",
        pointerEvents: "none",
        userSelect: "none",
        opacity: 0.48,
        color: "var(--tx3)",
        fontSize: 12,
        background: "var(--bg)",
        border: "1px dashed var(--bd)",
        boxShadow: "none",
      }}
      title="Referência do estoque (somente leitura): limites observados nos lotes com HVI completo"
    >
      {text}
    </div>
  );
}

function MixLimitCell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        borderRadius: "var(--r, 8px)",
        padding: 2,
        background: "var(--sf1)",
        border: "1px solid var(--bd)",
        boxShadow: "0 0 0 1px color-mix(in srgb, var(--cy) 22%, transparent)",
      }}
    >
      {children}
    </div>
  );
}

export function ThresholdLimitsEditor({
  variant = "full",
  showStockRange = false,
}: {
  variant?: "full" | "compact";
  /** Na etapa Gerar: mostra colunas de min/máx do estoque (somente leitura) além dos limites da mistura. */
  showStockRange?: boolean;
}) {
  const { stockForMixture, thresholds, updateThreshold, applyQualityBaseline } = useApp();
  const compact = variant === "compact";

  const stockStats = useMemo(
    () => (showStockRange ? collectHviParamStats(stockForMixture) : null),
    [showStockRange, stockForMixture],
  );

  const colTemplate = showStockRange
    ? "minmax(88px, 1.15fr) minmax(64px, 0.7fr) minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(64px, 0.7fr)"
    : "minmax(100px, 1.1fr) repeat(2, minmax(0, 1fr))";

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: compact ? "flex-start" : "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: compact ? 8 : 0,
        }}
      >
        <div>
          <div className="card-h" style={{ marginBottom: compact ? 2 : 4, fontSize: compact ? 14 : undefined }}>
            Limites de qualidade (HVI)
          </div>
          <div className="card-sub" style={{ maxWidth: 640, fontSize: compact ? 11 : undefined, lineHeight: 1.45 }}>
            {showStockRange ? (
              <>
                O <strong>estoque</strong> mostra a faixa mín/máx dos lotes disponíveis (HVI completo). Os campos
                editáveis são os <strong>limites mín. e máx. da mistura a ser gerada</strong> (a engine respeita essa
                faixa). <strong>Baseline do estoque</strong> aplica 8% de folga <em>para dentro</em> da faixa do
                estoque, para você afinar o recorte.
              </>
            ) : (
              <>
                Defina a faixa mín/máx aceitável para a mistura gerada. <strong>Baseline do estoque</strong> aplica 8% de
                folga para <em>dentro</em> do min–max do estoque (HVI completo), para a otimização trabalhar nesse
                recorte.
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-s"
          style={{ flexShrink: 0 }}
          disabled={!stockForMixture.length}
          onClick={() => applyQualityBaseline()}
          title="Preenche limites da mistura com 8% de folga interna em relação ao min–max do estoque (HVI completo)"
        >
          Baseline do estoque
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: colTemplate,
          gap: 8,
          padding: compact ? "4px 0" : "8px 0",
          borderBottom: "2px solid var(--bd)",
          marginBottom: 4,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)" }}>PARÂMETRO</div>
        {showStockRange ? (
          <>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "var(--tx3)",
                textAlign: "center",
                opacity: 0.55,
              }}
              title="Mínimo observado no estoque (somente leitura)"
            >
              MÍN. ESTOQUE
            </div>
            <div
              style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textAlign: "center" }}
              title={MISTURA_MIN_TITLE}
            >
              MÍN. MISTURA
            </div>
            <div
              style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textAlign: "center" }}
              title={MISTURA_MAX_TITLE}
            >
              MÁX. MISTURA
            </div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: "var(--tx3)",
                textAlign: "center",
                opacity: 0.55,
              }}
              title="Máximo observado no estoque (somente leitura)"
            >
              MÁX. ESTOQUE
            </div>
          </>
        ) : (
          <>
            <div
              style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textAlign: "center" }}
              title={MISTURA_MIN_TITLE}
            >
              MÍN. MISTURA
            </div>
            <div
              style={{ fontSize: 10, fontWeight: 700, color: "var(--tx3)", textAlign: "center" }}
              title={MISTURA_MAX_TITLE}
            >
              MÁX. MISTURA
            </div>
          </>
        )}
      </div>
      {PARAMS.map((p) => {
        const t = thresholds[p.key];
        const st = showStockRange ? stockStats?.[p.key] : null;
        return (
          <div
            key={p.key}
            className="cfg-row"
            style={{
              padding: compact ? "6px 0" : undefined,
              display: "grid",
              gridTemplateColumns: colTemplate,
              gap: 8,
              alignItems: "center",
            }}
          >
            <div className="cfg-name" style={{ fontSize: compact ? 11 : undefined }}>
              {p.label}{" "}
              {p.good ? (
                <span style={{ color: "var(--gn)", fontSize: 10 }}>▲</span>
              ) : (
                <span style={{ color: "var(--rd)", fontSize: 10 }}>▼</span>
              )}
            </div>
            {showStockRange && (
              <>
                <StockReadonlyCell value={st?.min ?? null} prec={p.prec} />
                <MixLimitCell>
                  <ThresholdLimitInput
                    value={t.min}
                    param={p}
                    side="min"
                    onCommit={(n) => updateThreshold(p.key, "min", n)}
                  />
                </MixLimitCell>
                <MixLimitCell>
                  <ThresholdLimitInput
                    value={t.max}
                    param={p}
                    side="max"
                    onCommit={(n) => updateThreshold(p.key, "max", n)}
                  />
                </MixLimitCell>
                <StockReadonlyCell value={st?.max ?? null} prec={p.prec} />
              </>
            )}
            {!showStockRange && (
              <>
                <div>
                  <ThresholdLimitInput
                    value={t.min}
                    param={p}
                    side="min"
                    onCommit={(n) => updateThreshold(p.key, "min", n)}
                  />
                </div>
                <div>
                  <ThresholdLimitInput
                    value={t.max}
                    param={p}
                    side="max"
                    onCommit={(n) => updateThreshold(p.key, "max", n)}
                  />
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
