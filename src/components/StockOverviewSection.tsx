import { useMemo, useState } from "react";
import type { Lot } from "../domain/stock";
import {
  aggregateQualityBins,
  breakpointsToInputString,
  defaultPrecForOverviewKey,
  getBreakpointsForParam,
  OVERVIEW_PARAM_KEYS,
  parseBreakpointsInput,
  paramDefForKey,
} from "../domain/qualityOverview";

interface StockOverviewSectionProps {
  stock: Lot[];
  qualityBinBreakpoints: Record<string, number[] | undefined>;
  setQualityBinBreakpoints: (key: string, breakpoints: number[]) => void;
  resetQualityBinBreakpoints: (key: string) => void;
}

export function StockOverviewSection({
  stock,
  qualityBinBreakpoints,
  setQualityBinBreakpoints,
  resetQualityBinBreakpoints,
}: StockOverviewSectionProps) {
  const supplierRows = useMemo(() => {
    const m = new Map<string, { fardos: number; kg: number }>();
    for (const l of stock) {
      const cur = m.get(l.produtor) ?? { fardos: 0, kg: 0 };
      cur.fardos += l.fardos;
      cur.kg += l.peso * 1000;
      m.set(l.produtor, cur);
    }
    const totalKg = [...m.values()].reduce((s, r) => s + r.kg, 0);
    return [...m.entries()]
      .map(([name, v]) => ({
        name,
        fardos: v.fardos,
        kg: v.kg,
        pct: totalKg > 0 ? (v.kg / totalKg) * 100 : 0,
      }))
      .sort((a, b) => b.kg - a.kg);
  }, [stock]);

  return (
    <div className="stock-ov-wrap">
      <div className="stock-ov-head">
        <div className="card-h" style={{ marginBottom: 4 }}>
          Visão geral do estoque
        </div>
        <div style={{ fontSize: 12, color: "var(--tx3)" }}>
          Distribuição de volume (kg) do arquivo importado. Edite as faixas de qualidade em cada parâmetro quando
          necessário.
        </div>
      </div>

      <div className="stock-ov-body">
        <div className="stock-ov-left">
          <OverviewSupplierCard rows={supplierRows} />
        </div>
        <div className="stock-ov-bins">
          {OVERVIEW_PARAM_KEYS.map((key) => {
            const def = paramDefForKey(key);
            if (!def) return null;
            const bp = getBreakpointsForParam(key, qualityBinBreakpoints);
            const rows = aggregateQualityBins(stock, key, bp, def.prec);
            return (
              <QualityBinCard
                key={key}
                title={def.label}
                rows={rows}
                breakpoints={bp}
                prec={defaultPrecForOverviewKey(key)}
                onSaveBreakpoints={(next) => setQualityBinBreakpoints(key, next)}
                onResetBreakpoints={() => resetQualityBinBreakpoints(key)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function OverviewSupplierCard({
  rows,
}: {
  rows: { name: string; fardos: number; kg: number; pct: number }[];
}) {
  return (
    <div className="stock-ov-card stock-ov-card--supplier">
      <div className="stock-ov-card-h">Estoque por fornecedor</div>
      <table className="stock-ov-tbl stock-ov-tbl--supplier">
        <thead>
          <tr>
            <th className="stock-ov-tbl-faixa">Fornecedor</th>
            <th className="stock-ov-tbl-num">Fardos</th>
            <th className="stock-ov-tbl-num">kg</th>
            <th className="stock-ov-tbl-pct">% peso</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={{ fontWeight: 600, maxWidth: 200 }} className="ov-ellipsis stock-ov-tbl-faixa" title={r.name}>
                {r.name}
              </td>
              <td className="mono stock-ov-tbl-num">{r.fardos.toLocaleString("pt-BR")}</td>
              <td className="mono stock-ov-tbl-num">{r.kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
              <td className="mono stock-ov-tbl-pct" style={{ color: "var(--cy)" }}>
                {Number.isFinite(r.pct) ? r.pct.toFixed(1) : "—"}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityBinCard({
  title,
  rows,
  breakpoints,
  prec,
  onSaveBreakpoints,
  onResetBreakpoints,
}: {
  title: string;
  rows: { label: string; fardos: number; kg: number; pct: number }[];
  breakpoints: number[];
  prec: number;
  onSaveBreakpoints: (b: number[]) => void;
  onResetBreakpoints: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(() => breakpointsToInputString(breakpoints, prec));

  const openEdit = () => {
    setEditText(breakpointsToInputString(breakpoints, prec));
    setEditing(true);
  };

  const applyEdit = () => {
    const parsed = parseBreakpointsInput(editText);
    if (parsed == null) {
      alert("Use números separados por vírgula (ex: 81, 82, 83).");
      return;
    }
    onSaveBreakpoints(parsed);
    setEditing(false);
  };

  return (
    <div className="stock-ov-card">
      <div
        className="stock-ov-card-h"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
      >
        <span>{title}</span>
        <button type="button" className="btn btn-s btn-sm" onClick={openEdit} style={{ fontSize: 10 }}>
          Faixas
        </button>
      </div>
      {editing && (
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--bd)", background: "var(--sf3)" }}>
          <div style={{ fontSize: 10, color: "var(--tx3)", marginBottom: 6 }}>
            Pontos de corte (ordem crescente). Bins: ≤ primeiro, entre pares, &gt; último (+ linha AGUARDA… se HVI
            incompleto).
          </div>
          <input
            type="text"
            className="inp"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            style={{ width: "100%", fontSize: 12, marginBottom: 8 }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn btn-p btn-sm" onClick={applyEdit}>
              Aplicar
            </button>
            <button
              type="button"
              className="btn btn-s btn-sm"
              onClick={() => {
                onResetBreakpoints();
                setEditing(false);
              }}
            >
              Restaurar padrão
            </button>
            <button type="button" className="btn btn-d btn-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      <table className="stock-ov-tbl stock-ov-tbl--bins">
        <thead>
          <tr>
            <th className="stock-ov-tbl-faixa">Faixa</th>
            <th className="stock-ov-tbl-num">Fardos</th>
            <th className="stock-ov-tbl-num">kg</th>
            <th className="stock-ov-tbl-pct">% peso</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={`${title}-${ri}-${r.label}`}>
              <td className="stock-ov-tbl-faixa" style={{ fontSize: 11 }}>
                {r.label}
              </td>
              <td className="mono stock-ov-tbl-num">{r.fardos.toLocaleString("pt-BR")}</td>
              <td className="mono stock-ov-tbl-num">{r.kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
              <td className="mono stock-ov-tbl-pct" style={{ color: "var(--cy)" }}>
                {Number.isFinite(r.pct) ? r.pct.toFixed(1) : "—"}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
