import { useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { PARAMS } from "../domain/types";
import { weightedAverageExcludingZero } from "../engine/constraints";
import { fmtBRL } from "../engine/sequencer";
import type { Lot } from "../domain/stock";
import { fmtParam } from "../utils/paramFormat";
import { nextSortState, sortRows, type SortColumn } from "../utils/tableSort";

function sortMark(sort: { key: string; asc: boolean } | null, k: string) {
  if (!sort || sort.key !== k) return null;
  return <span className="th-sort-ind">{sort.asc ? "▲" : "▼"}</span>;
}

export function PageStep1() {
  const {
    stock,
    curStep,
    loadStockFromFile,
    resetStock,
    setCurStep,
    isWarn,
  } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadStockFromFile(e.dataTransfer.files[0]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add("dragover");
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("dragover");
  };

  const [stockSort, setStockSort] = useState<{ key: string; asc: boolean } | null>(null);

  const prods = [...new Set(stock.map((s) => s.produtor))];
  const tP = stock.reduce((s, r) => s + r.peso, 0);
  const tF = stock.reduce((s, r) => s + r.fardos, 0);
  const hcd = stock.some(s => s.custo > 0);
  const avgCusto = hcd ? weightedAverageExcludingZero(stock, "custo", "peso") : null;

  function fmtCardAvg(key: string, avg: number | null): { text: string; warn: boolean } {
    if (avg == null) return { text: "—", warn: false };
    return { text: fmtParam(key, avg), warn: isWarn(key, avg) };
  }

  const stockGetters = useMemo((): Record<string, SortColumn<Lot>> => {
    const g: Record<string, SortColumn<Lot>> = {
      prod: { get: (r) => r.produtor },
      lote: { get: (r) => r.lote },
      peso: { get: (r) => r.peso, numeric: true },
      fardos: { get: (r) => r.fardos, numeric: true },
      uhml: { get: (r) => r.uhml, numeric: true },
      str_val: { get: (r) => r.str_val, numeric: true },
      elg: { get: (r) => r.elg, numeric: true },
      ui: { get: (r) => r.ui, numeric: true },
      mic: { get: (r) => r.mic, numeric: true },
      sf: { get: (r) => r.sf, numeric: true },
      mst: { get: (r) => r.mst, numeric: true },
      sci: { get: (r) => r.sci, numeric: true },
    };
    if (hcd) g.custo = { get: (r) => r.custo, numeric: true };
    return g;
  }, [hcd]);

  const sortedStock = useMemo(
    () => sortRows(stock, stockSort?.key ?? null, stockSort?.asc ?? true, stockGetters),
    [stock, stockSort, stockGetters]
  );

  const handleStockSort = (key: string) => {
    if (!stockGetters[key]) return;
    setStockSort((s) => nextSortState(s, key));
  };

  const steps = [
    { n: 1, l: "Estoque" },
    { n: 2, l: "Gerar" },
    { n: 3, l: "Revisar" },
  ];

  return (
    <div className="page active" style={{ display: "block" }}>
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
      <div className="pg-title">Carregar Estoque</div>
      <div className="pg-sub">
        Importe CSV com dados analíticos HVI. Coluna de custo (R$/ton) é opcional.
      </div>

      {!stock.length ? (
        <div
          className="upz"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && loadStockFromFile(e.target.files[0])}
          />
          <div style={{ fontSize: 42, marginBottom: 12, opacity: 0.6 }}>📦</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
            Arraste o CSV aqui ou clique para selecionar
          </div>
          <div style={{ fontSize: 13, color: "var(--tx3)" }}>
            Aceita: FORNECEDOR/PRODUTOR, LOTE, FARDOS, TOTAL(kg)/PESO(ton), STR, UHML (mm ou in; convertido para mm), UI, MIC, SF, ELG, MST, SCI, CUSTO
          </div>
          <button className="btn btn-p" style={{ marginTop: 16 }}>
            Selecionar Arquivo
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div className="card-h">{stock.length} lotes carregados</div>
              <div style={{ fontSize: 12, color: "var(--tx3)" }}>
                {prods.length} produtores · {tP.toFixed(1)} ton · {tF.toLocaleString("pt-BR")} fardos
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-d btn-sm" onClick={resetStock}>
                ✕ Limpar estoque
              </button>
              <button className="btn btn-p" onClick={() => setCurStep(2)}>
                Continuar → Gerar Mistura
              </button>
            </div>
          </div>
          <div className="mx" style={{ marginBottom: 16 }}>
            {[
              { l: "Lotes", v: String(stock.length), c: "var(--cy)" },
              { l: "Produtores", v: String(prods.length), c: "var(--pp)" },
              { l: "Peso Total", v: tP.toFixed(1) + " ton", c: "var(--tx)" },
              ...(hcd ? [
                {
                  l: "Custo Médio",
                  v: avgCusto != null ? fmtBRL(avgCusto) + "/ton" : "—",
                  c: "var(--cy)",
                },
                { l: "Custo Min", v: fmtBRL(Math.min(...stock.map(s => s.custo).filter(c => c > 0))) + "/ton", c: "var(--gn)" },
                { l: "Custo Max", v: fmtBRL(Math.max(...stock.map(s => s.custo))) + "/ton", c: "var(--rd)" },
              ] : [
                { l: "Fardos", v: tF.toLocaleString("pt-BR"), c: "var(--tx)" },
              ]),
              ...PARAMS.map((p) => {
                const a = weightedAverageExcludingZero(stock, p.key, "peso");
                const { text, warn } = fmtCardAvg(p.key, a);
                return { l: p.label, v: text, c: warn ? "var(--am)" : "var(--gn)" };
              }),
              (() => {
                const sciAvg = weightedAverageExcludingZero(stock, "sci", "peso");
                const { text } = fmtCardAvg("sci", sciAvg);
                return { l: "SCI", v: text, c: "var(--tx3)" };
              })(),
            ].map((k) => (
              <div
                key={k.l}
                style={{
                  background: "var(--sf2)",
                  border: "1px solid var(--bd)",
                  borderRadius: "var(--r)",
                  padding: 10,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "var(--tx3)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {k.l}
                </div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: k.c, marginTop: 3 }}>
                  {k.v}
                </div>
              </div>
            ))}
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ textAlign: "left", paddingLeft: 12 }} onClick={() => handleStockSort("prod")}>
                    Produtor{sortMark(stockSort, "prod")}
                  </th>
                  <th onClick={() => handleStockSort("lote")}>Lote{sortMark(stockSort, "lote")}</th>
                  <th onClick={() => handleStockSort("peso")}>Peso{sortMark(stockSort, "peso")}</th>
                  <th onClick={() => handleStockSort("fardos")}>Fardos{sortMark(stockSort, "fardos")}</th>
                  {hcd && (
                    <th onClick={() => handleStockSort("custo")}>
                      R$/ton{sortMark(stockSort, "custo")}
                    </th>
                  )}
                  <th onClick={() => handleStockSort("uhml")}>UHML (mm){sortMark(stockSort, "uhml")}</th>
                  <th onClick={() => handleStockSort("str_val")}>STR{sortMark(stockSort, "str_val")}</th>
                  <th onClick={() => handleStockSort("elg")}>ELG{sortMark(stockSort, "elg")}</th>
                  <th onClick={() => handleStockSort("ui")}>UI{sortMark(stockSort, "ui")}</th>
                  <th onClick={() => handleStockSort("mic")}>MIC{sortMark(stockSort, "mic")}</th>
                  <th onClick={() => handleStockSort("sf")}>SF{sortMark(stockSort, "sf")}</th>
                  <th onClick={() => handleStockSort("mst")}>MST{sortMark(stockSort, "mst")}</th>
                  <th onClick={() => handleStockSort("sci")}>SCI{sortMark(stockSort, "sci")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedStock.map((r) => (
                  <tr key={r.id}>
                    <td>{r.produtor}</td>
                    <td style={{ fontWeight: 400, color: "var(--tx3)" }}>{r.lote}</td>
                    <td className="mono">{r.peso.toFixed(2)}</td>
                    <td className="mono">{r.fardos}</td>
                    {hcd && (
                      <td className="mono" style={{
                        color:
                          avgCusto != null && r.custo > 0
                            ? r.custo < avgCusto * 0.9
                              ? "var(--cy)"
                              : r.custo > avgCusto * 1.1
                                ? "var(--rd)"
                                : "var(--tx2)"
                            : "var(--tx2)",
                        fontWeight: 700,
                      }}>{fmtBRL(r.custo)}</td>
                    )}
                    <td className={`mono ${isWarn("uhml", r.uhml) ? "cell-warn" : ""}`}>{fmtParam("uhml", r.uhml)}</td>
                    <td className={`mono ${isWarn("str_val", r.str_val) ? "cell-warn" : ""}`}>{fmtParam("str_val", r.str_val)}</td>
                    <td className={`mono ${isWarn("elg", r.elg) ? "cell-warn" : ""}`}>{fmtParam("elg", r.elg)}</td>
                    <td className={`mono ${isWarn("ui", r.ui) ? "cell-warn" : ""}`}>{fmtParam("ui", r.ui)}</td>
                    <td className={`mono ${isWarn("mic", r.mic) ? "cell-warn" : ""}`}>{fmtParam("mic", r.mic)}</td>
                    <td className={`mono ${isWarn("sf", r.sf) ? "cell-warn" : ""}`}>{fmtParam("sf", r.sf)}</td>
                    <td className={`mono ${isWarn("mst", r.mst) ? "cell-warn" : ""}`}>{fmtParam("mst", r.mst)}</td>
                    <td className="mono" style={{ color: "var(--tx3)" }}>{fmtParam("sci", r.sci)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
