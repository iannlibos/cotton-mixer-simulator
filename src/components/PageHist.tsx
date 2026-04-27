import { useMemo, useState } from "react";
import { useApp } from "../context/AppContext";
import { PARAMS, type Thresholds } from "../domain/types";
import { buildPDF } from "../utils/pdf";
import { fmtBRL } from "../engine/sequencer";
import type { Lot } from "../domain/stock";
import { fmtParam } from "../utils/paramFormat";
import { nextSortState, sortRows, type SortColumn } from "../utils/tableSort";
import { fmtKgFromTons } from "../utils/weight";

function sortMark(sort: { key: string; asc: boolean } | null, k: string) {
  if (!sort || sort.key !== k) return null;
  return <span className="th-sort-ind">{sort.asc ? "▲" : "▼"}</span>;
}

export function PageHist() {
  const {
    history,
    histDetailIndex,
    setCurStep,
    deleteHistory,
    thresholds: globalThresholds,
    openSeqPlanner,
  } = useApp();

  const h =
    histDetailIndex != null && histDetailIndex < history.length ? history[histDetailIndex] : null;

  const [histSort, setHistSort] = useState<{ key: string; asc: boolean } | null>(null);

  const tw = h ? h.lots.reduce((s, l) => s + (l.allocWeight || 0), 0) : 0;
  const hcd = h ? h.params.custoTon > 0 : false;
  const thresholdSnapshot: Thresholds = h?.thresholds ?? globalThresholds;

  const cellClsHist = (key: string, v: number) => {
    const p = PARAMS.find((x) => x.key === key);
    const t = thresholdSnapshot[key as keyof Thresholds];
    if (!p || !t) return "";
    const warn = (p.good && v < t.min) || (!p.good && v > t.max);
    return warn ? "cell-warn" : "";
  };

  const histGetters = useMemo((): Record<string, SortColumn<Lot>> => {
    const g: Record<string, SortColumn<Lot>> = {
      pl: { get: (l) => `${l.produtor}\t${l.lote}` },
      bales: { get: (l) => l.allocBales ?? 0, numeric: true },
      tamanho: { get: (l) => l.tamanho ?? "" },
      weight: { get: (l) => l.allocWeight ?? 0, numeric: true },
      disp: { get: (l) => l.peso, numeric: true },
      pct: { get: (l) => (tw > 0 ? ((l.allocWeight || 0) / tw) * 100 : 0), numeric: true },
      uhml: { get: (l) => l.uhml, numeric: true },
      str_val: { get: (l) => l.str_val, numeric: true },
      elg: { get: (l) => l.elg, numeric: true },
      ui: { get: (l) => l.ui, numeric: true },
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

  const sortedHistLots = useMemo(() => {
    if (!h) return [];
    return sortRows(h.lots, histSort?.key ?? null, histSort?.asc ?? true, histGetters);
  }, [h, histSort, histGetters]);

  const handleHistSort = (key: string) => {
    if (!histGetters[key]) return;
    setHistSort((s) => nextSortState(s, key));
  };

  if (!h) {
    return (
      <div className="page active" style={{ display: "block" }}>
        <div className="pg-title">Histórico</div>
        <button className="btn btn-s" onClick={() => setCurStep(1)}>← Novo Gerador</button>
      </div>
    );
  }

  const handleExportPDF = () => {
    const doc = buildPDF(h.name, h.date, h.params, h.lots, h.thresholds || globalThresholds);
    doc.save(h.name.replace(/\s+/g, "_") + ".pdf");
  };

  const handleDelete = () => {
    if (confirm(`Excluir "${h.name}"?`) && histDetailIndex != null) {
      deleteHistory(histDetailIndex);
      setCurStep(1);
    }
  };

  return (
    <div className="page active" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div className="pg-title">{h.name}</div>
          <div className="pg-sub" style={{ marginBottom: 0 }}>
            {h.date} · {h.lots.length} lotes · {fmtKgFromTons(h.params.weight)} kg
            {hcd && ` · ${fmtBRL(h.params.custoTon)}/ton · Total: ${fmtBRL(h.params.custoTotal)}`}
            {" "}· Score: {h.score}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-s" onClick={() => setCurStep(1)}>← Novo</button>
          <button className="btn btn-p btn-sm" onClick={() => openSeqPlanner(h)}>📋 Sequências</button>
          <button className="btn btn-s btn-sm" onClick={handleExportPDF}>📄 PDF</button>
          <button className="btn btn-d btn-sm" onClick={handleDelete}>🗑 Excluir</button>
        </div>
      </div>
      <div className="mx">
        {hcd && (
          <div className="mx-item" style={{ borderColor: "rgba(34,211,238,.3)", background: "rgba(34,211,238,.06)" }}>
            <div className="mx-lbl">R$/ton</div>
            <div className="mx-val" style={{ color: "var(--cy)" }}>{fmtBRL(h.params.custoTon)}</div>
            <div className="mx-rng">{fmtBRL(h.params.custoTotal)} total</div>
          </div>
        )}
        {PARAMS.filter((p) => p.key !== "mat").map((p) => {
          const v = h.params[p.key as keyof typeof h.params] as number;
          const t = h.thresholds?.[p.key] || globalThresholds[p.key];
          const ok = v >= t.min && v <= t.max;
          return (
            <div key={p.key} className={`mx-item ${ok ? "ok" : "danger"}`}>
              <div className="mx-lbl">{p.label}</div>
              <div className="mx-val" style={{ color: ok ? "var(--gn)" : "var(--rd)" }}>{v.toFixed(p.prec)}</div>
              <div className="mx-rng mono">{t.min} — {t.max}</div>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-h">Composição</div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ textAlign: "left", paddingLeft: 12 }} onClick={() => handleHistSort("pl")}>
                  Produtor / Lote{sortMark(histSort, "pl")}
                </th>
                <th onClick={() => handleHistSort("bales")}>Fardos{sortMark(histSort, "bales")}</th>
                <th
                  onClick={() => handleHistSort("tamanho")}
                  title="Tamanho do fardo (P = 1,10m · G = 1,40m)"
                >
                  Tam.{sortMark(histSort, "tamanho")}
                </th>
                <th onClick={() => handleHistSort("weight")}>Peso (kg){sortMark(histSort, "weight")}</th>
                <th onClick={() => handleHistSort("disp")}>Disp. (kg){sortMark(histSort, "disp")}</th>
                <th onClick={() => handleHistSort("pct")}>%{sortMark(histSort, "pct")}</th>
                {hcd && (
                  <th onClick={() => handleHistSort("custo")}>
                    R$/ton{sortMark(histSort, "custo")}
                  </th>
                )}
                {hcd && (
                  <th onClick={() => handleHistSort("lotCost")}>
                    Custo{sortMark(histSort, "lotCost")}
                  </th>
                )}
                <th onClick={() => handleHistSort("uhml")}>UHML (mm){sortMark(histSort, "uhml")}</th>
                <th onClick={() => handleHistSort("str_val")}>STR{sortMark(histSort, "str_val")}</th>
                <th onClick={() => handleHistSort("elg")}>ELG{sortMark(histSort, "elg")}</th>
                <th onClick={() => handleHistSort("ui")}>UI{sortMark(histSort, "ui")}</th>
                <th onClick={() => handleHistSort("mic")}>MIC{sortMark(histSort, "mic")}</th>
                <th onClick={() => handleHistSort("sf")}>SF{sortMark(histSort, "sf")}</th>
                <th onClick={() => handleHistSort("sci")}>SCI{sortMark(histSort, "sci")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedHistLots.map((l, i) => {
                const usage = l.peso > 0 ? ((l.allocWeight || 0) / l.peso) * 100 : 0;
                const is100 = usage >= 99.5;
                return (
                  <tr key={l.id != null ? l.id : i}>
                    <td><strong>{l.produtor}</strong> <span style={{ color: "var(--tx3)", fontSize: 10 }}>{l.lote}</span></td>
                    <td className="mono">{l.allocBales}</td>
                    <td className="mono" style={{ textAlign: "center", color: "var(--tx2)" }}>
                      {l.tamanho ?? "—"}
                    </td>
                    <td className="mono">{fmtKgFromTons(l.allocWeight || 0)}</td>
                    <td
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: is100 ? "var(--rd)" : usage > 80 ? "var(--am)" : "var(--tx3)",
                      }}
                    >
                      {fmtKgFromTons(l.peso)}
                    </td>
                    <td className="mono">{tw > 0 ? (((l.allocWeight || 0) / tw) * 100).toFixed(1) : "0"}%</td>
                    {hcd && <td className="mono" style={{ color: "var(--cy)" }}>{fmtBRL(l.custo)}</td>}
                    {hcd && <td className="mono">{fmtBRL(l.custo * (l.allocWeight || 0))}</td>}
                    <td className={`mono ${cellClsHist("uhml", l.uhml)}`}>{fmtParam("uhml", l.uhml)}</td>
                    <td className={`mono ${cellClsHist("str_val", l.str_val)}`}>{fmtParam("str_val", l.str_val)}</td>
                    <td className={`mono ${cellClsHist("elg", l.elg)}`}>{fmtParam("elg", l.elg)}</td>
                    <td className={`mono ${cellClsHist("ui", l.ui)}`}>{fmtParam("ui", l.ui)}</td>
                    <td className={`mono ${cellClsHist("mic", l.mic)}`}>{fmtParam("mic", l.mic)}</td>
                    <td className={`mono ${cellClsHist("sf", l.sf)}`}>{fmtParam("sf", l.sf)}</td>
                    <td className="mono" style={{ color: "var(--tx3)" }}>{fmtParam("sci", l.sci)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
