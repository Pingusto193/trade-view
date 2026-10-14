# Roadmap do Radar

Fases da SPEC §20. `[x]` = pronto e testado; `[~]` = feito, mas com limitação registrada; `[ ]` = a fazer.
Cada fase termina com o app rodando, testes passando, este arquivo atualizado e relatório ao usuário.

## Fase 0 — Fundação

- [x] Monorepo pnpm (apps/web, apps/server, packages/core, packages/data, packages/shared)
- [x] TypeScript estrito, ESLint, Prettier, Vitest
- [x] CI no GitHub Actions (lint, formato, tipos, testes, build, referência pandas, E2E)
- [x] Docs iniciais: SPEC, CLAUDE.md, ROADMAP, DECISIONS, DATA_SOURCES, OPEN_QUESTIONS
- [x] Protótipo e decisão da biblioteca de gráficos (ADR-0003, `tools/chart-prototype/`)
- [~] Verificação das fontes de dados — feita por busca na web; acesso direto às APIs bloqueado no ambiente
      de desenvolvimento (ver `DATA_SOURCES.md`). **Testes reais pendentes:** `pnpm test:live`.
- [x] `pnpm dev` sobe web e servidor

## Fase 1 — Gráfico vivo

- [x] Candles, agregação (semanal começa na segunda, mensal no dia 1), Heikin-Ashi, linha
- [x] Indicadores do preset "Padrão do canal" + opcionais, conferidos contra referência pandas (1e-9)
- [x] Motor incremental de indicadores em Web Worker (candle em formação com `peek`)
- [~] Cripto em tempo real (Binance REST + WebSocket) — implementado e testado com fixtures/WS falso;
      **não testado contra a Binance real** (rede bloqueada aqui)
- [~] Ações dos EUA (Alpaca: SIP 15 min + IEX ao vivo, volume parcial) — idem, precisa de chave
- [~] B3 atrasada (brapi) + importação do histórico COTAHIST — idem; layout do COTAHIST não verificado
- [x] Timeframes 1m a mensal; selo de fonte, atraso, volume e estado do mercado
- [x] Modo 3 escalas com cursor sincronizado e abas no celular
- [x] PWA instalável (manifest, ícones, service worker), tela guiada de instalação
- [x] E2E: abre gráfico, troca escala, 1m atualiza sozinho (simulado), 3 escalas, 375 px
- [ ] Critério "BTC no 1m atualiza sozinho" **com dados reais**: rodar `pnpm dev` com internet

## Fase 2 — Desenhos, contas e listas

- [x] Login (argon2id, cookie HttpOnly/SameSite, 2FA TOTP opcional), cadastro fechado após a 1ª conta, convites
- [x] Proteção contra força bruta (5 erros/15 min por IP e por e-mail), CSRF por origem, rotas exigem login
- [x] Desenhos persistentes e sincronizados: linha horizontal, tendência, raio, vertical, zona, canal,
      Fibonacci, régua, posição comprada/vendida (quantidade pela calculadora), texto — travar, ocultar,
      cor, "só nesta escala"/"em todas", lista de desenhos, atalhos (Alt+letra, Esc, Delete)
- [x] **Critério:** E2E "linha desenhada no PC aparece no celular sem recarregar"
- [x] Watchlists no servidor (criar, renomear, reordenar, apagar) com cotação e variação
- [x] Presets de indicadores no servidor (editor; prontos protegidos, "salvar como novo")
- [x] Preferências sincronizadas (servidor é a fonte da verdade; localStorage só cache)
- [ ] Toque longo testado em aparelho real (só testado em navegador com toque emulado)

## Fase 3 — Setups e contexto

- [x] Primitivas de price action (pivôs sem look-ahead, inside bar, candles de força, volume, rompimentos)
- [x] Detectores 9.1, 9.2, 9.3, recuo à média, consolidação, elástico, reflexividade (revisados e
  corrigidos; decisões na ADR-0012)
- [x] Teste "alterar candles futuros não muda sinais passados" (`lookahead.test.ts`, modo estrito)
- [x] Painel de contexto (tendência, ADX, alinhamento, média respeitada, maturidade, vento a favor)
- [x] Marcações no gráfico com o "porquê"; Biblioteca completa (33 páginas conferidas contra o código)
- [x] Editor de parâmetros dos setups (Mais → Parâmetros dos setups; ADR-0021)

## Fase 4 — Alertas

- [x] Avaliação no servidor (toque/fechamento), alertas de preço, desenho, indicador, setup, sistema
  (lógica em `packages/core/src/alerts`, servidor em `apps/server/src/alerts`; stop/alvo de planos → Fase 5)
- [~] Web Push (VAPID), Telegram, e-mail; teste por canal, anti-duplicação, silêncio, histórico — feito e
  testado com canais falsos; **entrega real não testada** (sem internet aqui e sem iPhone): falta o critério
  "um alerta de preço chega no iPhone com o app instalado"
- [x] Tela guiada de notificações no iPhone (Alertas › Canais) + `docs/GUIA_NOTIFICACOES.md`

## Fase 5 — Risco, plano, diário e Modo Treino ao vivo

- [x] Calculadora de posição por mercado (`/calculadora`); plano de trade com checklist e avisos (boleta
  do treino e diário real; ADR-0022)
- [x] Diário com eventos (stop movido para trás, parciais, breakeven) e estatísticas — treino e **diário
  real** (`/diario`) com IR estimado e comparação treino × real (ADR-0022)
- [~] Painel Brasil (CDI, Selic, IR da B3 com apuração mensal): página Brasil com Selic e CDI do Banco
  Central (cache, erro honesto com último dado válido), treino comparado ao CDI do mesmo período e IR
  simulado no diário. **Não testado contra o BCB real** (rede bloqueada aqui; testado com respostas no
  formato do SGS)
- [x] Chave Treino/Real, conta fictícia com **saldo editável**, ordens simuladas executadas pelo servidor
  com preço real (a mercado, limitada, stop, stop/alvo da posição), custos, diário básico e IR simulado
  da B3 — prioridade pedida pelo usuário (ADR-0014). Falta: venda a descoberto, parciais pela boleta,
  plano de trade completo e feedback por trade

## Fase 6 — Laboratório e treino completo

- [x] Backtest barra a barra com os mesmos detectores, custos, tamanho pelo risco, IR (B3), CDI e buy & hold
  (`packages/core/src/backtest`)
- [~] Métricas e antiautoengano: amostra, treino/teste 70/30, sensibilidade, Monte Carlo, registro de
  tentativas, veredito (ADR-0016) e tela `/laboratorio` com curva de capital, distribuição de R e
  resultado por mês/ano; walk-forward do parâmetro principal. Falta: aviso de sobrevivência específico por
  composição de índice no laboratório (os experimentos já avisam)
- [~] Experimentos E1–E7 (`/laboratorio/experimentos`, ADR-0017): prontos e testados com dados simulados; os
  números reais dependem da rede liberada no servidor e, para 10 anos de B3, de importar o COTAHIST
- [x] Painel de prontidão (Treino e diálogo de mudar para Real; ADR-0018)
- [x] Feedback depois de cada trade de treino (Diário → "Ver feedback"; ADR-0019)
- [ ] Replay, exercícios de leitura, trilha

## Fase 7 — B3 e forex em tempo real, scanner e fundamentos

- [ ] Agente MT5 (Python) com simulador e guia
- [ ] Forex
- [~] Scanner multi-mercado e filtro de reflexividade (`/scanner`, ADR-0020): pronto e testado com dados
  simulados; resultados reais dependem do servidor publicado; fundamentos ligados (item abaixo)
- [~] Fundamentos (SEC EDGAR, CVM) (ADR-0024): adaptadores da SEC (companyfacts + company_tickers) e da
  CVM (DFP anual + FCA para ticker → CNPJ), cálculo único no core (LPA composto em 2 anos e receita sem
  queda), cache no SQLite, scanner, alertas de reflexividade e laboratório sem look-ahead. **Não testado
  contra as fontes reais** (SEC e CVM bloqueadas no ambiente; fixtures fictícias feitas à mão; layout da
  CVM conferido só em fonte secundária). Falta: o gráfico do navegador consultar os fundamentos e rodar
  `SEC_USER_AGENT=... pnpm test:live`

## Fase 8 — Produção

- [~] Docker Compose + Caddy (HTTPS), guia de publicação (`docs/GUIA_PUBLICACAO.md`), backup
  (`pnpm --filter @radar/server backup`), imagem testada no CI — adiantado para o usuário usar com dados
  reais. Falta: HTTPS real testado com domínio, alternativas de hospedagem (planos B–D), revisão de
  segurança completa

## Fase 9 — Assistente com IA (opcional)

- [ ] Assistente crítico com a chave do usuário, limite de custo mensal
