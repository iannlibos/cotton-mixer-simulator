# Baseline da Engine Original

## Entrada
- Estoque via CSV com colunas: produtor, lote, peso, fardos e parâmetros de qualidade.
- Regras configuráveis: `minLotPct`, `maxProdPct`, `maxLots`, `rotation`, `weightTol`.
- Limites por parâmetro em `thresholds`.

## Estratégia observada no protótipo
1. Cria cópia do estoque (`freshMix`) e calcula `lotScore` por distância ao midpoint dos limites.
2. `allocateBase`: alocação mínima inicial por produtor.
3. `fillRemaining`: adiciona fardos incrementalmente respeitando:
   - peso alvo,
   - `maxLots`,
   - `maxProdPct`,
   - e sem violar qualidade.
4. `enforceMinLotPct`: remove lotes com participação abaixo do mínimo e redistribui.
5. `trimExcess`: reduz excesso de peso removendo fardos.

## Pontos fracos identificados
- Busca essencialmente gulosa com pouca exploração de alternativas.
- Diagnóstico de inviabilidade é limitado.
- Validação de dados CSV fraca (ausentes/outliers/duplicidade).
- Sem trilha de auditoria formal da execução.

## Critérios de equivalência usados na refatoração
- Manter as mesmas regras de negócio (limites, tolerância, cap por produtor/lotes).
- Preservar output principal: mistura factível dentro de limites quando existir.
- Melhorar robustez com multi-start, busca local e alternativas ranqueadas.
