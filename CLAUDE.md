# CLAUDE.md — guia para sessões do Claude Code no projeto Radar

**Leia primeiro, em toda sessão:** este arquivo, `docs/ROADMAP.md` e `docs/DECISIONS.md`. A especificação
completa (fonte da verdade) está em `docs/SPEC.md` — só altere com pedido explícito do usuário (a última
mudança, em 26/10/2026, criou a §23: notícias e previsão honesta; ADR-0032). Continue de onde o roadmap parou.

## O que é

Radar: PWA pessoal (PT-BR) para ver gráficos, receber alertas, planejar trades, verificar estratégias
(backtest honesto com custos, IR e CDI), treinar com dinheiro fictício, **notícias em tempo real** e
**previsão de direção honesta** (probabilidade + placar ao vivo, nunca certeza). **Não envia ordens.**
Usuário único, brasileiro, iniciante em trading, **dev web** (JS/Node/React/Vite/Prisma/SQL): docs técnicas
podem usar linguagem técnica; a interface continua em PT-BR simples.

## Princípios inegociáveis (resumo da SPEC §3)

1. Nunca inventar dados. Falhou a fonte → mostrar erro + data do último dado válido. Simulado só em dev,
   com faixa "DADOS SIMULADOS" (`RADAR_SIMULATED=1`, proibido em produção).
2. Todo gráfico mostra fonte, atraso e qualidade do volume.
3. Cético: nada promete lucro; estatística sempre com amostra, período, custos, IR, CDI e buy & hold.
4. **Uma única implementação da lógica** em `packages/core` (indicadores, setups, risco, backtest, impostos).
   Navegador, servidor, scanner e backtest importam o mesmo código. Proibido duplicar.
5. Sem look-ahead: sinais só com candle fechado (exceto "intrabar" explícito); pivôs só existem a partir do
   candle em que se confirmam.
6. Sem scraping; só APIs oficiais/públicas; app atrás de login.
7. PT-BR, R$ 1.234,56, DD/MM/AAAA, exibição em America/Sao_Paulo, armazenamento em UTC.
8. Mobile primeiro (375 px), desktop poderoso.

## Estrutura

```
apps/web          PWA React 19 + Vite 8 + Tailwind 4 + Lightweight Charts 5 (src/chart, src/pages)
apps/server       Fastify 5 + @fastify/websocket + SQLite (better-sqlite3 + Drizzle; migrações em drizzle/)
packages/core     lógica pura: indicators/, candles/, setups/ (detectores), alerts/, paper/, tax/, backtest/
                  (motor, métricas, Monte Carlo, walk-forward), experiments/ (E2, E6, E7, comparação)
packages/data     adaptadores de fontes (Binance, Alpaca, brapi, BCB, COTAHIST, simulador) + fixtures
packages/shared   tipos, schemas zod, protocolo WS, formatação PT-BR
agents/mt5-bridge agente Python do MetaTrader 5 (Fase 7)
tools/reference   referência independente em pandas para os indicadores
tools/chart-prototype  protótipo que decidiu a biblioteca de gráficos
docs/             SPEC, ROADMAP, DECISIONS, DATA_SOURCES, OPEN_QUESTIONS e guias para o usuário
```

Pacotes internos exportam o fonte TS (`exports: ./src/index.ts`); não há build intermediário.

## Comandos

```bash
pnpm install
cp .env.example .env            # em dev, RADAR_SIMULATED=1 permite testar sem internet
pnpm dev                        # servidor :8787 + web :5173 (proxy /api e /ws)
pnpm check                      # lint + typecheck + testes unitários
pnpm test                       # Vitest (todos os pacotes)
pnpm test:live                  # testes contra APIs reais (precisa de internet)
pnpm test:e2e                   # Playwright (sobe servidor simulado + web)
pnpm --filter @radar/web build  # build do PWA
pnpm --filter @radar/server db:generate   # nova migração após mudar src/db/schema.ts
python3 tools/reference/generate_candles.py && python3 tools/reference/indicators_reference.py
```

Os E2E sobem o servidor com `RATE_LIMIT_MAX=100000` (o padrão de produção, 600/min por IP, estoura com vários
testes por segundo). Não edite páginas `.md` da Biblioteca enquanto roda E2E: o Vite recarrega a página no meio.

No ambiente do Claude Code na nuvem, o Chromium está em `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`:
`PW_CHROMIUM_PATH=<caminho> pnpm test:e2e`. **Não use `pkill -f` com padrões que aparecem no próprio
comando** (mata o shell); pare servidores pela porta: `fuser -k 8787/tcp 5173/tcp`.

## Convenções

- TypeScript estrito (`noUncheckedIndexedAccess`). TS fixado em 6.0 (ADR-0002).
- Indicadores: classes `Stream` com `next` (fecha) e `peek` (candle em formação); funções em lote são laços
  sobre o stream. Convenções numéricas em ADR-0008; qualquer mudança exige atualizar a referência pandas.
- Tempo dos candles: ADR-0006 (intradiário = instante UTC; diário+ = meia-noite UTC da data de pregão).
- Números arbitrários da SPEC marcados com * viram parâmetros com schema zod; decisões "nossas, não do vídeo"
  vão para `DECISIONS.md`.
- Fatos externos (limites, endpoints, preços, impostos) só entram no código depois de registrados em
  `docs/DATA_SOURCES.md` com link, data e selo (✅/🟡/❌/🔌).
- Commits pequenos, Conventional Commits, mensagens em PT-BR. Nunca commitar `.env`.
- **Cuidado com `.gitignore`:** só `/data/` da raiz é ignorado (já houve bug ignorando `packages/data`).
- Nada está pronto sem teste. Testes de setups: fixtures feitas à mão com casos positivos, negativos e borda.
- Interface e docs para o usuário em PT-BR simples, sem jargão técnico.

## Relatório ao fim de cada sessão (SPEC §21)

1. O que ficou pronto e como ver; 2. o que não funciona/não foi testado e por quê; 3. fatos não verificados e
riscos; 4. perguntas necessárias; 5. próximo passo.
