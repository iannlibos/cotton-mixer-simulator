import { useState } from "react";
import { useApp } from "../context/AppContext";

interface SectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, icon, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card rules-section">
      <button
        type="button"
        className="rules-section-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span className="rules-section-title">{title}</span>
        <span className="rules-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="rules-section-body">{children}</div>}
    </div>
  );
}

function FormulaBlock({ label, formula }: { label: string; formula: string }) {
  return (
    <div className="rules-formula">
      <div className="rules-formula-label">{label}</div>
      <code className="rules-formula-code">{formula}</code>
    </div>
  );
}

function RuleItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rules-item">
      <div className="rules-item-title">{title}</div>
      <div className="rules-item-body">{children}</div>
    </div>
  );
}

export function PageRules() {
  const { curStep, setCurPage } = useApp();

  return (
    <div className="page active" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="pg-title">Regras de Negócio</div>
          <div className="pg-sub">
            Documentação das regras, fórmulas e lógica usadas nas engines de geração de misturas e sequências
          </div>
        </div>
        <button
          className="btn btn-s"
          onClick={() => setCurPage(curStep === 1 ? "step1" : curStep === 2 ? "step2" : "step3")}
        >
          ← Voltar
        </button>
      </div>

      {/* ── SEÇÃO 1: ENGINE DE MISTURA ── */}
      <Section title="Engine de Mistura (Optimizer)" icon="🔧" defaultOpen>
        <RuleItem title="Visão Geral">
          <p>
            A engine principal (<code>optimizeMix</code>) gera misturas de algodão tentando minimizar uma
            função objetivo multi-critério. São executadas <strong>5 tentativas</strong> com modos alternados
            (<em>rotation → balanced → quality → rotation → balanced</em>) e a melhor solução factível vence.
          </p>
        </RuleItem>

        <RuleItem title="Parâmetros de Controle (EngineRules)">
          <table className="rules-table">
            <thead>
              <tr>
                <th>Parâmetro</th>
                <th>Padrão</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>minLotPct</code></td><td>6%</td><td>Participação mínima de cada lote no peso total da mistura</td></tr>
              <tr><td><code>maxProdPct</code></td><td>35%</td><td>Peso máximo de um único produtor na mistura</td></tr>
              <tr><td><code>maxLots</code></td><td>12</td><td>Número máximo de lotes distintos na mistura</td></tr>
              <tr><td><code>rotation</code></td><td>70%</td><td>Peso do fator de rotação de estoque na função objetivo (0=qualidade, 100=giro)</td></tr>
              <tr><td><code>weightTol</code></td><td>0.5%</td><td>Tolerância percentual em relação ao peso alvo</td></tr>
            </tbody>
          </table>
        </RuleItem>

        <RuleItem title="Score de Qualidade por Lote">
          <p>
            Cada lote recebe um <code>qScore</code> que mede proximidade ao ponto médio da faixa de cada parâmetro HVI,
            com bônus para o lado "bom" (ex: UHML alto é melhor, MIC baixo é melhor).
          </p>
          <FormulaBlock
            label="Score de qualidade por parâmetro"
            formula="score += (1 − |valor − ponto_médio| / (faixa/2)) + (lado_bom ? +0.3 : −0.3)"
          />
        </RuleItem>

        <RuleItem title="Função Objetivo (Penalidades)">
          <p>A engine minimiza uma soma ponderada de penalidades:</p>
          <FormulaBlock
            label="Função Objetivo"
            formula="F = Σ(penalidade_i × peso_i)"
          />
          <table className="rules-table">
            <thead>
              <tr>
                <th>Penalidade</th>
                <th>Cálculo</th>
                <th>Multiplicador base</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Peso fora da tolerância</td><td><code>max(0, |peso − alvo| − tolerância) × 100</code></td><td>×1.0</td></tr>
              <tr><td>Violações de qualidade</td><td><code>n_violações × 500</code></td><td>×1.5 a ×2.3</td></tr>
              <tr><td>Produtor acima do máximo</td><td><code>Σ max(0, pct_produtor − maxProdPct) × 50</code></td><td>×1.1 a ×1.2</td></tr>
              <tr><td>Excesso de lotes</td><td><code>max(0, n_lotes − maxLots) × 100</code></td><td>×1.0 a ×1.1</td></tr>
              <tr><td>Participação mínima</td><td><code>Σ max(0, minLotPct − pct_lote)</code></td><td>×1.1 a ×1.4</td></tr>
              <tr><td>Target de parâmetros</td><td><code>Σ ((valor − target) / range)² × 100</code></td><td>×1.8 a ×2.0</td></tr>
            </tbody>
          </table>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--tx3)" }}>
            Os multiplicadores variam conforme a prioridade selecionada (qualidade estrita, balanceada ou giro de estoque).
          </p>
        </RuleItem>

        <RuleItem title="Recompensas (termos negativos)">
          <table className="rules-table">
            <thead>
              <tr><th>Termo</th><th>Descrição</th></tr>
            </thead>
            <tbody>
              <tr><td>Rotação</td><td>Favorece uso de lotes com menor qScore (girar estoque de qualidade inferior)</td></tr>
              <tr><td>Diversidade</td><td>Bônus proporcional ao número de produtores distintos na mistura</td></tr>
            </tbody>
          </table>
        </RuleItem>

        <RuleItem title="Etapas do Algoritmo">
          <ol className="rules-steps">
            <li>
              <strong>Seed por produtor</strong> — Abre pelo menos 1 lote de cada produtor disponível, respeitando
              o mínimo de fardos para atingir <code>minLotPct</code>.
            </li>
            <li>
              <strong>Greedy fill</strong> — Preenche até o peso alvo, avaliando cada candidato pelo score da
              função objetivo (com jitter para diversificação). Adiciona fardos em blocos de 1 a 4.
            </li>
            <li>
              <strong>Enforce constraints (8 passes)</strong> — Remove lotes abaixo de <code>minLotPct</code>,
              depois preenche novamente. Repete até estabilizar.
            </li>
            <li>
              <strong>Trim to target</strong> — Remove fardos de lotes com maior qScore até atingir o peso alvo.
            </li>
            <li>
              <strong>Enforce constraints (8 passes)</strong> — Nova rodada de enforce + refill.
            </li>
            <li>
              <strong>Local improve</strong> — Hill-climbing de swap de 1 fardo: tenta trocar 1 fardo entre
              qualquer par de lotes (ativos e inativos), aceitando apenas melhorias. Até 1500 iterações.
            </li>
            <li>
              <strong>Enforce final (6 passes)</strong> — Última rodada de remoção/refill.
            </li>
          </ol>
        </RuleItem>

        <RuleItem title="Seleção do Resultado">
          <p>
            Das 5 tentativas, todas são ranqueadas pelo score. Soluções <strong>factíveis</strong> (sem
            violações) têm prioridade. Se nenhuma for factível, a de menor penalidade total é retornada.
            As 3 melhores alternativas são disponibilizadas para o usuário.
          </p>
        </RuleItem>

        <RuleItem title="Diagnósticos de Infactibilidade">
          <p>Quando a engine não encontra solução factível, analisa e reporta:</p>
          <ul className="rules-list">
            <li><strong>INSUFFICIENT_STOCK</strong> — Peso total do estoque é menor que o alvo</li>
            <li><strong>PRODUCER_CAP_TOO_STRICT</strong> — O limite por produtor impede atingir o peso com os produtores disponíveis</li>
            <li><strong>LOT_LIMIT_CONFLICT</strong> — Conflito entre maxLots e minLotPct (matematicamente impossível)</li>
            <li><strong>NO_EVALUATED_LOTS</strong> — Nenhum lote com HVI completo</li>
          </ul>
        </RuleItem>
      </Section>

      {/* ── SEÇÃO 2: ENGINE DE ESTRATÉGIAS ── */}
      <Section title="Engine de Estratégias (Sugestões)" icon="🎯">
        <RuleItem title="Visão Geral">
          <p>
            A engine de estratégias (<code>runAllStrategies</code>) gera 3 sugestões base; no passo 2 o app acrescenta a 4ª (otimizador / solver).
            distintos. Cada estratégia usa um score normalizado diferente para ranquear os lotes.
          </p>
        </RuleItem>

        <RuleItem title="As 3 Estratégias">
          <table className="rules-table">
            <thead>
              <tr><th>Estratégia</th><th>Objetivo</th><th>Critérios de Scoring</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Limpar Estoque</strong></td>
                <td>Priorizar giro, consumir lotes problemáticos</td>
                <td>
                  Qualidade inversa (28%), volume (16%), custo alto (17%),
                  share do produtor no estoque (34%), heterogeneidade (5%)
                </td>
              </tr>
              <tr>
                <td><strong>Menor Custo / Melhor Qualidade</strong></td>
                <td>Minimizar R$/ton ou maximizar qualidade</td>
                <td>
                  Com custo: custo (50%), qualidade inversa (20%), volume (30%).
                  Sem custo: qualidade (40%), qualidade inversa (26%), volume (22%), share (12%)
                </td>
              </tr>
              <tr>
                <td><strong>Balanceado</strong></td>
                <td>Equilíbrio entre todos os critérios</td>
                <td>
                  Com custo: qualidade parcial (35%), volume (30%), custo (35%).
                  Sem custo: qualidade parcial (42%), volume (38%), share (20%)
                </td>
              </tr>
            </tbody>
          </table>
        </RuleItem>

        <RuleItem title="Componentes do Score">
          <table className="rules-table">
            <thead>
              <tr><th>Componente</th><th>Descrição</th></tr>
            </thead>
            <tbody>
              <tr><td><code>qNorm</code></td><td>Qualidade normalizada (0–1) baseada no IQ do lote vs. min/max do estoque</td></tr>
              <tr><td><code>volumePressure</code></td><td>Peso do lote / peso médio dos lotes — favorece lotes volumosos</td></tr>
              <tr><td><code>costRatio</code></td><td>Custo do lote / mediana de custo do estoque</td></tr>
              <tr><td><code>producerShareNorm</code></td><td>Share do produtor no estoque total (normalizado) — favorece consumir produtores com mais estoque</td></tr>
              <tr><td><code>heteroNorm</code></td><td>Fator de heterogeneidade — favorece usar múltiplos lotes do mesmo produtor</td></tr>
            </tbody>
          </table>
        </RuleItem>

        <RuleItem title="Fases do Algoritmo">
          <ol className="rules-steps">
            <li>
              <strong>Seed</strong> — 1 lote por produtor (ou 2 em "Limpar Estoque" para produtores com mais lotes).
            </li>
            <li>
              <strong>Fill com relaxação progressiva</strong> — Preenche até o peso alvo. Se não
              conseguir com faixas de qualidade estritas, relaxa progressivamente (0% → 5% → 10% → 25% → 50%
              da largura da faixa).
            </li>
            <li>
              <strong>Enforce minLotPct</strong> — Remove lotes abaixo do mínimo e refaz fill.
            </li>
            <li>
              <strong>Swap refinement (30 rounds)</strong> — Troca fardos entre lotes buscando melhorar o
              objetivo (custo médio para "Menor Custo", score ponderado para as demais).
            </li>
            <li>
              <strong>Convergência (10 rounds)</strong> — Trim de sobrepeso, enforce de produtor %, enforce de
              minLotPct, fill com relaxação. Repete até estabilizar ou convergir ao peso alvo.
            </li>
          </ol>
        </RuleItem>

        <RuleItem title="Quality Index (IQ)">
          <p>O IQ é um indicador 0–100 de quão próximo o lote está do centro das faixas de qualidade:</p>
          <FormulaBlock
            label="IQ por parâmetro"
            formula="score = max(0, (1 − |valor − meio| / (faixa/2)) × 100) + (lado_bom > 0 ? 5 : 0)"
          />
          <FormulaBlock
            label="IQ final"
            formula="IQ = média(scores de todos os parâmetros HVI)"
          />
          <table className="rules-table" style={{ marginTop: 8 }}>
            <thead><tr><th>Faixa</th><th>Classificação</th></tr></thead>
            <tbody>
              <tr><td>≥ 75</td><td style={{ color: "#10b981" }}>Excelente</td></tr>
              <tr><td>55–74</td><td style={{ color: "#22d3ee" }}>Bom</td></tr>
              <tr><td>35–54</td><td style={{ color: "#fbbf24" }}>Regular</td></tr>
              <tr><td>&lt; 35</td><td style={{ color: "#ef4444" }}>Fraco</td></tr>
            </tbody>
          </table>
        </RuleItem>
      </Section>

      {/* ── SEÇÃO 3: GERADOR DE SEQUÊNCIAS ── */}
      <Section title="Gerador de Sequências" icon="📦">
        <RuleItem title="Visão Geral">
          <p>
            O gerador de sequências (<code>generateSequences</code>) distribui os fardos da mistura em
            sequências de alimentação da linha de produção, garantindo homogeneidade ao longo do processo.
          </p>
        </RuleItem>

        <RuleItem title="Cálculos Iniciais">
          <FormulaBlock
            label="Peso por fardo"
            formula="baleWtKg = pesoTotal × 1000 / totalFardos"
          />
          <FormulaBlock
            label="Fardos por sequência (forçado par)"
            formula="targetBps = arredondar(seqKg / baleWtKg), ajustado para par, mínimo 2"
          />
          <FormulaBlock
            label="Número de sequências"
            formula="nSeq = argmin(|bps × baleWtKg − seqKg|) entre floor(used/targetBps) e floor(used/targetBps)+1"
          />
        </RuleItem>

        <RuleItem title="Paridade">
          <p>
            O total de fardos usados é forçado a ser <strong>par</strong>. Se o estoque tem número ímpar de
            fardos, 1 fardo é descartado (o de menor IQ, pois o pool é ordenado por IQ decrescente).
          </p>
        </RuleItem>

        <RuleItem title="Distribuição">
          <ol className="rules-steps">
            <li>
              <strong>Pool de fardos</strong> — Cada fardo alocado na mistura vira uma entrada no pool,
              com o IQ do lote de origem. Pool ordenado por IQ decrescente.
            </li>
            <li>
              <strong>Round-robin</strong> — Fardos distribuídos ciclicamente entre as N sequências
              (fardo 0 → seq 0, fardo 1 → seq 1, ..., fardo N → seq 0, ...).
            </li>
            <li>
              <strong>Balanceamento de paridade</strong> — Se alguma sequência ficou com número ímpar de
              fardos, transfere 1 fardo para outra sequência ímpar para equalizar.
            </li>
          </ol>
        </RuleItem>

        <RuleItem title="Ordenação Interna (por Sequência)">
          <ol className="rules-steps">
            <li>
              <strong>Ordenar por IQ</strong> — Fardos da sequência são ordenados por IQ decrescente.
            </li>
            <li>
              <strong>Pareamento alto+baixo</strong> — O fardo de maior IQ é pareado com o de menor,
              o 2.º maior com o 2.º menor, e assim por diante. Isso garante que cada par tenha qualidade
              mista, evitando concentrações.
            </li>
            <li>
              <strong>Heterogeneidade de pares</strong> — Os pares são reordenados para que pares consecutivos
              usem produtores diferentes no fardo principal (posição A), evitando sequências longas de um mesmo
              fornecedor.
            </li>
            <li>
              <strong>Split A/B</strong> — Cada par é distribuído nos lados A e B da linha de alimentação com
              alternância: pares pares colocam (alto→A, baixo→B), pares ímpares invertem (baixo→A, alto→B).
            </li>
          </ol>
        </RuleItem>

        <RuleItem title="Resultado">
          <p>
            O resultado final são N sequências, cada uma com lados A e B balanceados por qualidade e
            diversificados por produtor. A interface permite ajustes manuais (swap de fardos entre sequências)
            e exportação em PDF.
          </p>
        </RuleItem>
      </Section>
    </div>
  );
}
