# Relatório de Aceite (Parcial)

## Escopo validado
- Refatoração para módulos (`src/domain`, `src/engine`, `src/io`, `src/ui`, `src/audit`).
- Engine multi-start com busca local e fallback explicável.
- Validação de CSV com colunas obrigatórias, duplicidade e faixas plausíveis.
- Auditoria com fingerprint SHA-256 do estoque e snapshots de regras/limites.

## Evidências
- Testes automatizados em `tests/*.test.js`.
- Linter sem erros nos arquivos alterados.

## Critérios do plano
- Tempo de resposta `< 2s` para ~1000 lotes: **pendente de benchmark real em ambiente do cliente**.
- Rastreabilidade da mistura: **atendido** via `ntx_audit` no `localStorage`.
- Estabilidade entre versões: **base inicial criada** com testes de regressão unitários.

## Próxima validação recomendada
- Rodar prova de carga com estoques reais anonimizados (100, 500, 1000 lotes).
- Capturar p95 de tempo de otimização por cenário.
