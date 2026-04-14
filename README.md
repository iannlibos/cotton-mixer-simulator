# Nortex · Gerador de Misturas

Aplicativo React + TypeScript para otimização de misturas de algodão. Migrado de HTML/JS para React/TypeScript com deploy na Vercel.

## Desenvolvimento

```bash
npm install
npm run dev
```

Abre em `http://localhost:5173`

## Build (produção)

```bash
npm run build
```

Gera a pasta `dist/` pronta para deploy estático.

## Deploy na Vercel

1. Conecte o repositório à Vercel
2. O `vercel.json` já está configurado:
   - Build: `npm run build`
   - Output: `dist`

A Vercel detecta automaticamente o comando de build e pasta de saída.

## Testes

```bash
npm test
```

Os testes usam tsx para executar arquivos TypeScript.

## Estrutura do Projeto

- `src/domain/` – Tipos e regras de negócio
- `src/engine/` – Otimizador e constraints
- `src/io/` – Leitura de CSV (PapaParse)
- `src/audit/` – Trilha de auditoria
- `src/components/` – Componentes React
- `src/context/` – Estado global (React Context)

## Funcionalidades preservadas

- Upload de CSV com estoque (PapaParse)
- Engine de otimização (5 modos, hill-climbing)
- Parâmetros de qualidade configuráveis
- Regras (minLotPct, maxProdPct, maxLots, rotation, weightTol)
- Alternativas da engine (3 melhores)
- Edição manual de alocação
- Adicionar/remover lotes da mistura
- Exportação PDF (jsPDF + autotable)
- Histórico em localStorage
- Gráfico de variação do estoque (Chart.js)
