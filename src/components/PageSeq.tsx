import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useApp } from "../context/AppContext";
import { PARAMS } from "../domain/types";
import {
  generateSequences,
  computeSeqParams,
  fmtBRL,
  iqColor,
  seqParamOk,
  type SeqSide,
  type SeqBale,
} from "../engine/sequencer";
import { fmtParam } from "../utils/paramFormat";
import { buildSeqPDF } from "../utils/pdf";

function iqLabel(iq: number): string {
  if (iq >= 75) return "Excelente";
  if (iq >= 55) return "Bom";
  if (iq >= 35) return "Regular";
  return "Fraco";
}

export function PageSeq() {
  const { seqHistRecord, thresholds, setCurStep, viewHistory, history } = useApp();

  const [seqWeight, setSeqWeight] = useState(9000);
  const [minProds, setMinProds] = useState(3);
  const [sequences, setSequences] = useState<SeqSide[]>([]);
  const [baleWtKg, setBaleWtKg] = useState(0);
  const [bps, setBps] = useState(0);
  const [nSeq, setNSeq] = useState(0);
  const [used, setUsed] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [totalBales, setTotalBales] = useState(0);
  const [isOdd, setIsOdd] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ si: number; side: "a" | "b"; bi: number } | null>(null);
  const [generated, setGenerated] = useState(false);

  const dragSrc = useRef<{ si: number; side: "a" | "b"; bi: number } | null>(null);

  const h = seqHistRecord;

  const doGenerate = useCallback(() => {
    if (!h) return;
    const totalW = h.params.weight;
    const tBales = h.lots.reduce((s, l) => s + (l.allocBales ?? 0), 0);
    const data = { name: h.name, lots: h.lots, totalWeight: totalW, totalBales: tBales };
    const result = generateSequences(data, seqWeight, minProds, thresholds);

    setSequences(result.sequences);
    setBaleWtKg(result.baleWtKg);
    setBps(result.bps);
    setNSeq(result.nSeq);
    setUsed(result.used);
    setDropped(result.dropped);
    setTotalBales(result.totalBales);
    setIsOdd(result.isOdd);
    setSelected(null);
    setGenerated(true);
  }, [h, seqWeight, minProds, thresholds]);

  // Auto-generate on mount
  useEffect(() => {
    if (h && !generated) {
      doGenerate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const swapBales = (si1: number, side1: "a" | "b", bi1: number, si2: number, side2: "a" | "b", bi2: number) => {
    const newSeqs = sequences.map(s => ({ a: [...s.a], b: [...s.b] }));
    const tmp = newSeqs[si1][side1][bi1];
    newSeqs[si1][side1][bi1] = newSeqs[si2][side2][bi2];
    newSeqs[si2][side2][bi2] = tmp;
    setSequences(newSeqs);
    setSelected(null);
  };

  const handleDragStart = (si: number, side: "a" | "b", bi: number) => {
    dragSrc.current = { si, side, bi };
  };

  const handleDrop = (si: number, side: "a" | "b", bi: number) => {
    const src = dragSrc.current;
    if (!src) return;

    if (src.si === si && src.side === side && src.bi !== bi) {
      const newSeqs = sequences.map(s => ({ a: [...s.a], b: [...s.b] }));
      const arr = newSeqs[si][side];
      const [moved] = arr.splice(src.bi, 1);
      arr.splice(bi, 0, moved);
      setSequences(newSeqs);
    } else if (src.si !== si || src.side !== side) {
      swapBales(src.si, src.side, src.bi, si, side, bi);
    }
    dragSrc.current = null;
  };

  const legendEntries = useMemo(() => {
    if (!h) return [] as { prod: string; lots: string[] }[];
    const pl: Record<string, string[]> = {};
    h.lots.forEach(l => {
      if (!pl[l.produtor]) pl[l.produtor] = [];
      if (!pl[l.produtor].includes(l.lote)) pl[l.produtor].push(l.lote);
    });
    return Object.entries(pl)
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { sensitivity: "base" }))
      .map(([prod, ls]) => ({
        prod,
        lots: [...ls].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true })),
      }));
  }, [h]);

  if (!h) {
    return (
      <div className="page page--wide active" style={{ display: "block" }}>
        <div className="pg-title">Planejador de Sequências</div>
        <p style={{ color: "var(--tx3)" }}>Nenhuma mistura selecionada para sequenciar.</p>
        <button className="btn btn-s" onClick={() => setCurStep(1)}>← Voltar</button>
      </div>
    );
  }

  const goBack = () => {
    const idx = history.findIndex(x => x.name === h.name);
    if (idx >= 0) viewHistory(idx);
    else setCurStep(1);
  };

  const handleSeqPDF = () => {
    if (!h || !sequences.length) return;
    const doc = buildSeqPDF({
      mixName: h.name,
      params: h.params,
      lots: h.lots,
      seqWeightKg: seqWeight,
      baleWtKg,
      sequences,
      thresholds,
      bps,
      used,
      dropped,
      totalBales,
    });
    doc.save(`${(h.name || "sequencias").replace(/\s+/g, "_")}_sequencias.pdf`);
  };

  const renderBale = (b: SeqBale, si: number, side: "a" | "b", bi: number) => {
    const bg = iqColor(b.iq);
    const hl = highlight && b.produtor !== highlight ? 0.12 : 1;
    const hb = highlight && b.produtor === highlight;
    const isSel = selected && selected.si === si && selected.side === side && selected.bi === bi;

    return (
      <div
        key={`${si}-${side}-${bi}`}
        className={`seq-bale${isSel ? " selected" : ""}`}
        style={{
          background: bg,
          opacity: hl,
          boxShadow: hb ? "0 0 0 2px #fff inset" : isSel ? "0 0 0 3px var(--am)" : undefined,
        }}
        draggable
        title={`${b.lote} — ${b.produtor}\nIQ: ${b.iq.toFixed(0)} (${iqLabel(b.iq)})\nUHML (mm): ${fmtParam("uhml", b.uhml)} · STR: ${fmtParam("str_val", b.str_val)} · ELG: ${fmtParam("elg", b.elg)}\nUI: ${fmtParam("ui", b.ui)} · MIC: ${fmtParam("mic", b.mic)} · SF: ${fmtParam("sf", b.sf)}\nR$${b.custo}/ton`}
        onClick={() => {
          if (isSel) setSelected(null);
          else setSelected({ si, side, bi });
        }}
        onDragStart={() => handleDragStart(si, side, bi)}
        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); }}
        onDragLeave={(e) => e.currentTarget.classList.remove("drag-over")}
        onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("drag-over"); handleDrop(si, side, bi); }}
        onDragEnd={() => { dragSrc.current = null; }}
      >
        <div className="seq-bale-lote">
          <span className="seq-bale-lote-id">{b.lote}</span>
          <span className="seq-bale-prod">{b.produtor}</span>
        </div>
        <div className="seq-bale-info">{b.iq.toFixed(0)}</div>
      </div>
    );
  };

  return (
    <div className="page page--wide active" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div className="pg-title">Sequências — {h.name}</div>
          <div className="pg-sub" style={{ marginBottom: 0 }}>
            {h.params.weight.toFixed(2)} ton · {h.lots.reduce((s, l) => s + (l.allocBales ?? 0), 0)} fardos
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-s" onClick={goBack}>← Voltar</button>
          <button type="button" className="btn btn-s btn-sm" onClick={handleSeqPDF} disabled={!generated || !sequences.length}>
            📄 PDF
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <div>
            <label className="lbl">Peso por Sequência (kg)</label>
            <input type="number" className="inp inp-num" value={seqWeight} min={500} step={500} style={{ width: 130 }} onChange={(e) => setSeqWeight(parseInt(e.target.value) || 9000)} />
          </div>
          <div>
            <label className="lbl">Mín. Produtores / Seq</label>
            <input type="number" className="inp inp-num" value={minProds} min={1} max={20} step={1} style={{ width: 80 }} onChange={(e) => setMinProds(parseInt(e.target.value) || 3)} />
          </div>
          <button className="btn btn-p" onClick={doGenerate}>🔄 Gerar Sequências</button>
        </div>

        {generated && (
          <>
            {(isOdd || dropped > 0) && (
              <div className="seq-notice">
                ⚠️ Mistura com <strong>{totalBales}</strong> fardos{isOdd ? " (ímpar)" : ""}.
                {dropped > 0 && <> <strong>{dropped}</strong> fardo{dropped > 1 ? "s" : ""} removido{dropped > 1 ? "s" : ""} para manter sequências pares.</>}
                {" "}Utilizados: <strong>{used}</strong> fardos.
              </div>
            )}

            <div className="mx" style={{ marginBottom: 12 }}>
              {[
                { l: "Sequências", v: String(nSeq), c: "var(--cy)" },
                { l: "Fardos/Seq", v: String(bps), c: "var(--tx)" },
                { l: "Peso/Seq", v: `${(bps * baleWtKg).toFixed(0)} kg`, c: "var(--cy)" },
                { l: "Peso Fardo", v: `${baleWtKg.toFixed(0)} kg`, c: "var(--tx2)" },
                { l: "Fardos", v: `${used}/${totalBales}`, c: dropped > 0 ? "var(--am)" : "var(--tx2)" },
              ].map(k => (
                <div key={k.l} style={{ background: "var(--sf2)", border: "1px solid var(--bd)", borderRadius: "var(--r)", padding: 10, textAlign: "center" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tx3)", textTransform: "uppercase", letterSpacing: 0.5 }}>{k.l}</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: k.c, marginTop: 3 }}>{k.v}</div>
                </div>
              ))}
            </div>

            <div className="seq-legend">
              {legendEntries.map(({ prod: p, lots: ls }) => {
                const act = highlight === p;
                return (
                  <div
                    key={p}
                    className={`seq-leg-btn${act ? " active" : ""}`}
                    onClick={() => setHighlight(highlight === p ? null : p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setHighlight(highlight === p ? null : p);
                      }
                    }}
                  >
                    <div>
                      <div className="seq-leg-name">{p}</div>
                      <div className="seq-leg-lots">{ls.join(", ")}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {sequences.map((seq, si) => {
        const all = [...seq.a, ...seq.b];
        const n = all.length;
        const wt = n * baleWtKg;
        const last = n < bps * 0.8;
        const prds = [...new Set(all.map(b => b.produtor))];
        const lts = [...new Set(all.map(b => b.lote))];
        const sp = computeSeqParams(all);

        const swapOpen = selected && selected.si === si;
        const candidates: { b: SeqBale; si: number; side: "a" | "b"; bi: number }[] = [];
        if (swapOpen) {
          sequences.forEach((s2, si2) => {
            if (si2 === si) return;
            s2.a.forEach((b, bi2) => candidates.push({ b, si: si2, side: "a", bi: bi2 }));
            s2.b.forEach((b, bi2) => candidates.push({ b, si: si2, side: "b", bi: bi2 }));
          });
          candidates.sort((a, b) => b.b.iq - a.b.iq);
        }

        return (
          <div key={si} className={`seq-card${last ? " is-last" : ""}`}>
            <div className="seq-header">
              <div>
                <span style={{ fontSize: 15, fontWeight: 800, color: "var(--cy)" }}>Seq {si + 1}</span>
                {last && <span style={{ fontSize: 10, color: "var(--am)", fontWeight: 700, marginLeft: 6 }}>RESTANTE</span>}
                <span style={{ fontSize: 11, color: "var(--tx3)", marginLeft: 8 }}>
                  {n} fardos · {wt.toFixed(0)} kg · {prds.length} prod · {lts.length} lotes
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: iqColor(sp.iq || 0) }}>
                  IQ {(sp.iq || 0).toFixed(0)}
                </div>
                <div style={{ fontSize: 9, color: "var(--tx3)" }}>{iqLabel(sp.iq || 0)}</div>
              </div>
            </div>

            <div className="seq-side">
              <div className="seq-side-label">▲ Lado A ({seq.a.length})</div>
              <div className="seq-bales">{seq.a.map((b, bi) => renderBale(b, si, "a", bi))}</div>
            </div>
            <div className="seq-divider" />
            <div className="seq-side">
              <div className="seq-side-label">▼ Lado B ({seq.b.length})</div>
              <div className="seq-bales">{seq.b.map((b, bi) => renderBale(b, si, "b", bi))}</div>
            </div>

            {swapOpen && selected && (
              <div className="seq-swap open">
                <div className="seq-swap-title">
                  🔄 Trocar <strong>{seq[selected.side][selected.bi]?.lote}</strong>{" "}
                  <span style={{ fontWeight: 600, color: "var(--tx2)" }}>{seq[selected.side][selected.bi]?.produtor}</span>{" "}
                  (IQ {seq[selected.side][selected.bi]?.iq.toFixed(0)}) — selecione o substituto:{" "}
                  <span style={{ cursor: "pointer", color: "var(--tx3)", marginLeft: 8 }} onClick={() => setSelected(null)}>✕ fechar</span>
                </div>
                <div className="seq-swap-pool">
                  {candidates.map((c, ci) => (
                    <div
                      key={ci}
                      className="seq-swap-bale"
                      style={{ background: iqColor(c.b.iq) }}
                      title={`${c.b.lote} — ${c.b.produtor}\nIQ: ${c.b.iq.toFixed(0)} | Seq ${c.si + 1}`}
                      onClick={() => swapBales(si, selected.side, selected.bi, c.si, c.side, c.bi)}
                    >
                      <span className="seq-swap-bale-lote">{c.b.lote}</span>
                      <span className="seq-swap-bale-prod">{c.b.produtor}</span>
                      <span className="seq-swap-bale-iq">{c.b.iq.toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="seq-params">
              {["uhml", "str_val", "elg", "ui", "mic", "sf", "mst"].map(k => {
                const p = PARAMS.find(x => x.key === k);
                if (!p) return null;
                const v = sp[k] || 0;
                const ok = seqParamOk(k, v, thresholds);
                return (
                  <div key={k} className="seq-p">
                    <div className="seq-p-lbl">{p.label}</div>
                    <div className="seq-p-val" style={{ color: ok ? "var(--gn)" : "var(--rd)" }}>
                      {v.toFixed(p.prec)}
                    </div>
                  </div>
                );
              })}
              <div className="seq-p">
                <div className="seq-p-lbl">R$/ton</div>
                <div className="seq-p-val" style={{ color: "var(--cy)" }}>{fmtBRL(sp.custo || 0)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
