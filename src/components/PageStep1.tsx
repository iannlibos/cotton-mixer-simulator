import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { PARAMS } from "../domain/types";
import { isLotUsableForOptimization } from "../engine/baseline";
import { weightedAverageExcludingZero } from "../engine/constraints";
import { fmtBRL } from "../engine/sequencer";
import type { Lot } from "../domain/stock";
import { fmtParam } from "../utils/paramFormat";
import { nextSortState, sortRows, type SortColumn } from "../utils/tableSort";
import { StockOverviewSection } from "./StockOverviewSection";

function sortMark(sort: { key: string; asc: boolean } | null, k: string) {
  if (!sort || sort.key !== k) return null;
  return <span className="th-sort-ind">{sort.asc ? "▲" : "▼"}</span>;
}

export function PageStep1() {
  const {
    stock,
    stockForMixture,
    excludedFromMixIds,
    qualityBinBreakpoints,
    curStep,
    loadStockFromFile,
    resetStock,
    setCurStep,
    isWarn,
    toggleLotExcludedFromMix,
    setLotsIncludedInMixture,
    includeAllLotsInMixture,
    excludeAllLotsInMixture,
    toggleProducerMixSelection,
    setQualityBinBreakpoints,
    resetQualityBinBreakpoints,
  } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const mixHeaderRef = useRef<HTMLInputElement>(null);

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
  const [baleSizeFilter, setBaleSizeFilter] = useState<"all" | "P" | "G" | "none">("all");

  const excludedSet = useMemo(() => new Set(excludedFromMixIds), [excludedFromMixIds]);

  const prodsFile = useMemo(() => [...new Set(stock.map((s) => s.produtor))], [stock]);
  const tPFile = stock.reduce((s, r) => s + r.peso, 0);
  const tFFile = stock.reduce((s, r) => s + r.fardos, 0);
  const pendingHvi = useMemo(
    () => stock.filter((l) => !isLotUsableForOptimization(l)).length,
    [stock]
  );

  const mix = stockForMixture;
  const prodsInMix = useMemo(() => [...new Set(mix.map((s) => s.produtor))], [mix]);
  const tPmix = mix.reduce((s, r) => s + r.peso, 0);
  const tFmix = mix.reduce((s, r) => s + r.fardos, 0);
  const hcdMix = mix.some((s) => s.custo > 0);
  const hcdFile = stock.some((s) => s.custo > 0);
  const avgCustoMix = hcdMix ? weightedAverageExcludingZero(mix, "custo", "peso") : null;

  const filteredStock = useMemo(() => {
    let rows = stock;
    if (baleSizeFilter === "P") rows = rows.filter((l) => l.tamanho === "P");
    else if (baleSizeFilter === "G") rows = rows.filter((l) => l.tamanho === "G");
    else if (baleSizeFilter === "none") rows = rows.filter((l) => l.tamanho == null);
    return rows;
  }, [stock, baleSizeFilter]);

  const allEligibleInMix = useMemo(() => {
    if (!stock.length) return true;
    return stock
      .filter((l) => isLotUsableForOptimization(l))
      .every((l) => !excludedSet.has(l.id));
  }, [stock, excludedSet]);

  const producerInMix = (name: string) =>
    stock.some(
      (l) => l.produtor === name && isLotUsableForOptimization(l) && !excludedSet.has(l.id)
    );

  const producerCards = useMemo(() => {
    const m = new Map<string, { kg: number; eligibleLots: number; kgEligible: number }>();
    for (const l of stock) {
      const cur = m.get(l.produtor) ?? { kg: 0, eligibleLots: 0, kgEligible: 0 };
      cur.kg += l.peso * 1000;
      if (isLotUsableForOptimization(l)) {
        cur.eligibleLots += 1;
        cur.kgEligible += l.peso * 1000;
      }
      m.set(l.produtor, cur);
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.kg - a.kg);
  }, [stock]);

  const visibleEligible = useMemo(
    () => filteredStock.filter((l) => isLotUsableForOptimization(l)),
    [filteredStock]
  );

  const allVisibleIncluded =
    visibleEligible.length > 0 && visibleEligible.every((l) => !excludedSet.has(l.id));
  const someVisibleExcluded = visibleEligible.some((l) => excludedSet.has(l.id));

  useEffect(() => {
    const el = mixHeaderRef.current;
    if (!el) return;
    el.indeterminate = someVisibleExcluded && !allVisibleIncluded && visibleEligible.length > 0;
  }, [someVisibleExcluded, allVisibleIncluded, visibleEligible.length]);

  function fmtCardAvg(key: string, avg: number | null): { text: string; warn: boolean } {
    if (avg == null) return { text: "—", warn: false };
    return { text: fmtParam(key, avg), warn: isWarn(key, avg) };
  }

  const stockGetters = useMemo((): Record<string, SortColumn<Lot>> => {
    const g: Record<string, SortColumn<Lot>> = {
      prod: { get: (r) => r.produtor },
      lote: { get: (r) => r.lote },
      tamanho: { get: (r) => r.tamanho ?? "" },
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
    if (hcdFile) g.custo = { get: (r) => r.custo, numeric: true };
    return g;
  }, [hcdFile]);

  const sortedStock = useMemo(
    () => sortRows(filteredStock, stockSort?.key ?? null, stockSort?.asc ?? true, stockGetters),
    [filteredStock, stockSort, stockGetters]
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

  const goGenerate = () => {
    if (!stockForMixture.length) {
      alert("Marque ao menos um lote para participar da mistura.");
      return;
    }
    setCurStep(2);
  };

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
            Aceita: FORNECEDOR/PRODUTOR, LOTE, FARDOS, TAMANHO (P/G), TOTAL(kg)/PESO(ton), STR, UHML (mm ou in; convertido para mm), UI, MIC, SF, ELG, MST, SCI, CUSTO
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
              <div style={{ fontSize: 12, color: "var(--tx3)", lineHeight: 1.5 }}>
                Arquivo: {prodsFile.length} produtores · {tPFile.toFixed(1)} ton · {tFFile.toLocaleString("pt-BR")} fardos
                {pendingHvi > 0 ? (
                  <span> · {pendingHvi} lote{pendingHvi > 1 ? "s" : ""} com HVI pendente (não elegíveis)</span>
                ) : null}
                <br />
                <strong style={{ color: "var(--cy)" }}>{mix.length}</strong> lotes selecionados para a mistura ·{" "}
                {prodsInMix.length} produtores · {tPmix.toFixed(1)} ton · {tFmix.toLocaleString("pt-BR")} fardos
                {baleSizeFilter !== "all" && <span> · {filteredStock.length} lotes com o filtro de fardo ativo</span>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-d btn-sm" onClick={resetStock}>
                ✕ Limpar estoque
              </button>
              <button className="btn btn-p" onClick={goGenerate}>
                Continuar → Gerar Mistura
              </button>
            </div>
          </div>

          <div style={{ margin: "0 0 20px" }}>
            <div className="card-h" style={{ marginBottom: 6 }}>
              Composição — fornecedores e fardo
            </div>
            <div style={{ fontSize: 12, color: "var(--tx3)", marginBottom: 10 }}>
              Use os fornecedores para incluir ou retirar <strong>todos</strong> os lotes elegíveis (HVI completo) da
              mistura. A tabela abaixo lista o arquivo completo; o filtro de tamanho só restringe a exibição. A visão
              geral fica após a tabela.
            </div>
            <div className="prod-filter-row">
              <button
                type="button"
                className={`prod-filter-chip ${allEligibleInMix ? "prod-filter-chip--on" : ""}`}
                onClick={includeAllLotsInMixture}
              >
                Todos
              </button>
              {producerCards.map((p) => {
                const nEl = p.eligibleLots;
                const hasEl = nEl > 0;
                const inMix = producerInMix(p.name);
                return (
                  <button
                    key={p.name}
                    type="button"
                    disabled={!hasEl}
                    className={`prod-filter-chip ${!hasEl ? "prod-filter-chip--off" : inMix ? "prod-filter-chip--on" : "prod-filter-chip--off"}`}
                    onClick={() => toggleProducerMixSelection(p.name)}
                    title={
                      hasEl
                        ? `${nEl} ${nEl === 1 ? "lote elegível" : "lotes elegíveis"} · ${p.kgEligible.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg — clique para incluir ou excluir da mistura`
                        : "Nenhum lote elegível (HVI pendente)"
                    }
                  >
                    <span className="prod-filter-name">{p.name}</span>
                    <span className="prod-filter-meta">{nEl}</span>
                  </button>
                );
              })}
            </div>
            <div className="prod-filter-row" style={{ marginTop: 10, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx3)", marginRight: 4 }}>Fardo (exibição)</span>
              {(
                [
                  { id: "all" as const, label: "Todas" },
                  { id: "P" as const, label: "P" },
                  { id: "G" as const, label: "G" },
                  { id: "none" as const, label: "Sem tam." },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`prod-filter-chip ${baleSizeFilter === id ? "prod-filter-chip--on" : ""}`}
                  onClick={() => setBaleSizeFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--tx3)" }}>Lotes na mistura (só HVI completo):</span>
            <button type="button" className="btn btn-s btn-sm" onClick={includeAllLotsInMixture}>
              Marcar todos
            </button>
            <button type="button" className="btn btn-d btn-sm" onClick={excludeAllLotsInMixture}>
              Desmarcar todos
            </button>
          </div>

          <div style={{ fontSize: 11, color: "var(--tx3)", marginBottom: 8 }}>
            Indicadores do estoque que será considerado na mistura (elegíveis e com checkbox marcada):
          </div>
          <div className="mx" style={{ marginBottom: 20 }}>
            {[
              { l: "Lotes", v: String(mix.length), c: "var(--cy)" },
              { l: "Produtores", v: String(prodsInMix.length), c: "var(--pp)" },
              { l: "Peso Total", v: tPmix.toFixed(1) + " ton", c: "var(--tx)" },
              ...(hcdMix
                ? [
                    {
                      l: "Custo Médio",
                      v: avgCustoMix != null ? fmtBRL(avgCustoMix) + "/ton" : "—",
                      c: "var(--cy)",
                    },
                    {
                      l: "Custo Min",
                      v:
                        mix.filter((s) => s.custo > 0).length > 0
                          ? fmtBRL(Math.min(...mix.map((s) => s.custo).filter((c) => c > 0))) + "/ton"
                          : "—",
                      c: "var(--gn)",
                    },
                    {
                      l: "Custo Max",
                      v:
                        mix.length > 0
                          ? fmtBRL(Math.max(...mix.map((s) => s.custo))) + "/ton"
                          : "—",
                      c: "var(--rd)",
                    },
                  ]
                : [{ l: "Fardos", v: tFmix.toLocaleString("pt-BR"), c: "var(--tx)" }]),
              ...PARAMS.map((p) => {
                const a = weightedAverageExcludingZero(mix, p.key, "peso");
                const { text, warn } = fmtCardAvg(p.key, a);
                return { l: p.label, v: text, c: warn ? "var(--am)" : "var(--gn)" };
              }),
              (() => {
                const sciAvg = weightedAverageExcludingZero(mix, "sci", "peso");
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

          <div className="card-h" style={{ marginBottom: 8 }}>
            Lotes do arquivo
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 24 }}>
            {filteredStock.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: "center",
                  color: "var(--tx3)",
                  border: "1px dashed var(--bd)",
                  borderRadius: "var(--r)",
                }}
              >
                Nenhum lote corresponde ao filtro de tamanho de fardo. Ajuste &quot;Todas&quot;, P, G ou Sem tam.
              </div>
            ) : null}
            <table className="tbl" style={{ display: filteredStock.length === 0 ? "none" : "table" }}>
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: "center" }}>
                    <input
                      ref={mixHeaderRef}
                      type="checkbox"
                      disabled={visibleEligible.length === 0}
                      checked={allVisibleIncluded && visibleEligible.length > 0}
                      onChange={() => {
                        const ids = visibleEligible.map((l) => l.id);
                        if (allVisibleIncluded) {
                          setLotsIncludedInMixture(ids, false);
                        } else {
                          setLotsIncludedInMixture(ids, true);
                        }
                      }}
                      title="Incluir / excluir lotes visíveis na mistura (apenas HVI completo)"
                      aria-label="Selecionar lotes visíveis para mistura"
                    />
                  </th>
                  <th style={{ textAlign: "left", paddingLeft: 12 }} onClick={() => handleStockSort("prod")}>
                    Produtor{sortMark(stockSort, "prod")}
                  </th>
                  <th onClick={() => handleStockSort("lote")}>Lote{sortMark(stockSort, "lote")}</th>
                  <th onClick={() => handleStockSort("tamanho")} title="Tamanho do fardo (P = 1,10m · G = 1,40m)">
                    Tam.{sortMark(stockSort, "tamanho")}
                  </th>
                  <th onClick={() => handleStockSort("peso")}>Peso{sortMark(stockSort, "peso")}</th>
                  <th onClick={() => handleStockSort("fardos")}>Fardos{sortMark(stockSort, "fardos")}</th>
                  {hcdFile && (
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
                {sortedStock.map((r) => {
                  const eligible = isLotUsableForOptimization(r);
                  return (
                  <tr
                    key={r.id}
                    className={[
                      eligible && excludedSet.has(r.id) ? "row-mix-off" : "",
                      !eligible ? "row-hvi-pending" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        disabled={!eligible}
                        checked={eligible && !excludedSet.has(r.id)}
                        onChange={() => toggleLotExcludedFromMix(r.id)}
                        title={
                          eligible
                            ? "Incluir na mistura"
                            : "HVI incompleto — lote não pode compor a mistura até o laboratório concluir as medidas"
                        }
                        aria-label={`Incluir lote ${r.lote} na mistura`}
                      />
                    </td>
                    <td>{r.produtor}</td>
                    <td style={{ fontWeight: 400, color: "var(--tx3)" }}>{r.lote}</td>
                    <td className="mono" style={{ textAlign: "center", color: "var(--tx2)" }}>
                      {r.tamanho ?? "—"}
                    </td>
                    <td className="mono">{r.peso.toFixed(2)}</td>
                    <td className="mono">{r.fardos}</td>
                    {hcdFile && (
                      <td
                        className="mono"
                        style={{
                          color:
                            avgCustoMix != null && r.custo > 0
                              ? r.custo < avgCustoMix * 0.9
                                ? "var(--cy)"
                                : r.custo > avgCustoMix * 1.1
                                  ? "var(--rd)"
                                  : "var(--tx2)"
                              : "var(--tx2)",
                          fontWeight: 700,
                        }}
                      >
                        {fmtBRL(r.custo)}
                      </td>
                    )}
                    <td className={`mono ${isWarn("uhml", r.uhml) ? "cell-warn" : ""}`}>{fmtParam("uhml", r.uhml)}</td>
                    <td className={`mono ${isWarn("str_val", r.str_val) ? "cell-warn" : ""}`}>
                      {fmtParam("str_val", r.str_val)}
                    </td>
                    <td className={`mono ${isWarn("elg", r.elg) ? "cell-warn" : ""}`}>{fmtParam("elg", r.elg)}</td>
                    <td className={`mono ${isWarn("ui", r.ui) ? "cell-warn" : ""}`}>{fmtParam("ui", r.ui)}</td>
                    <td className={`mono ${isWarn("mic", r.mic) ? "cell-warn" : ""}`}>{fmtParam("mic", r.mic)}</td>
                    <td className={`mono ${isWarn("sf", r.sf) ? "cell-warn" : ""}`}>{fmtParam("sf", r.sf)}</td>
                    <td className={`mono ${isWarn("mst", r.mst) ? "cell-warn" : ""}`}>{fmtParam("mst", r.mst)}</td>
                    <td className="mono" style={{ color: "var(--tx3)" }}>{fmtParam("sci", r.sci)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <StockOverviewSection
            stock={stock}
            qualityBinBreakpoints={qualityBinBreakpoints}
            setQualityBinBreakpoints={setQualityBinBreakpoints}
            resetQualityBinBreakpoints={resetQualityBinBreakpoints}
          />
        </div>
      )}
    </div>
  );
}
