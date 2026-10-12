# Registro de decisões (ADR curto)

Formato: contexto → decisão → consequências. Decisões "nossas, não do vídeo" sobre regras de setups
também ficam aqui. Ao mudar uma decisão, **não apague**: marque como "Substituída por ADR-XXXX".

---

## ADR-0001 — Monorepo TypeScript com pnpm workspaces (12/10/2026)

**Contexto.** SPEC §5 pede uma única implementação da lógica, usada por navegador, servidor, scanner e backtest.
**Decisão.** Monorepo pnpm: `apps/web`, `apps/server`, `packages/core`, `packages/data`, `packages/shared`.
Pacotes internos exportam o código-fonte TypeScript (`exports: ./src/index.ts`), sem etapa de build: o Vite
compila no front e o `tsx` executa no servidor.
**Consequências.** Sem build intermediário; o typecheck roda por pacote (`pnpm -r typecheck`). Em produção o
servidor roda com `tsx` (ver Fase 8).

## ADR-0002 — TypeScript 6.0 (não 7.0) (12/10/2026)

**Contexto.** O npm tem TypeScript 7.0.2, mas o `typescript-eslint` 8.71 declara suporte a `>=4.8.4 <6.1.0`.
**Decisão.** Fixar `typescript ~6.0.3`. Reavaliar quando o typescript-eslint suportar a 7.
**Consequências.** No TS 6, `types` padrão é `[]`: cada `tsconfig` declara `"types": ["node"]` quando precisa.

## ADR-0003 — Biblioteca de gráficos: TradingView Lightweight Charts v5 (12/10/2026)

**Contexto.** Protótipo em `tools/chart-prototype/` (resultados no README de lá). Ambas rolam 10 mil candles a
60 fps. A KLineCharts traz 16 desenhos nativos; a Lightweight Charts não traz nenhum.
**Decisão.** Usar **Lightweight Charts 5.2.1** e construir nossa camada de desenhos com *series primitives*.
**Motivos.**
1. Princípio 4 (lógica única): os indicadores vêm do `packages/core` e viram simples séries de linha. Na
   KLineCharts o caminho natural é o motor de indicadores dela, que duplicaria a lógica.
2. As ferramentas mais importantes da SPEC (zona de preço, posição comprada/vendida com quantidade, régua,
   desenho → alerta com um clique, sincronização entre aparelhos) **não existem prontas em nenhuma das duas**;
   o modelo de dados dos desenhos é nosso de qualquer jeito.
3. `setCrosshairPosition` público para o modo 3 escalas; painéis nativos na v5; mantida pelo TradingView.
**Custo de oportunidade (honesto).** Vamos escrever ~10 ferramentas de desenho e a interação por toque, algo
que a KLineCharts daria quase pronto. Risco: UX de desenho no celular depende de nós.
**Licença.** Apache-2.0 com exigência de aviso e link para tradingview.com: mantemos `attributionLogo: true`
e o aviso na tela "Sobre".
**Não usar** a biblioteca "Advanced Charts" do TradingView (licença restrita).

## ADR-0004 — SQLite com better-sqlite3 + Drizzle (12/10/2026)

**Decisão.** `better-sqlite3` (síncrono, rápido, compila com node-gyp se não houver binário pronto) com
Drizzle ORM e migrações geradas por `drizzle-kit` em `apps/server/drizzle/`. WAL ligado.
**Alternativa descartada.** `node:sqlite` nativo do Node 22 — ainda experimental e sem driver Drizzle.

## ADR-0005 — Tempo em UTC; exibição em São Paulo (12/10/2026)

Armazenamento: milissegundos UTC. Exibição: `America/Sao_Paulo`, datas DD/MM/AAAA (SPEC §3.8).

## ADR-0006 — Convenção de tempo dos candles e agregação (12/10/2026)

- Intradiário: `time` = instante UTC da abertura do candle.
- Diário, semanal, mensal: `time` = **meia-noite UTC da data de pregão** (data local da bolsa).
- Semana ISO, **começa na segunda-feira**; o candle semanal leva a data da segunda mesmo se for feriado.
- Mês civil; o candle mensal leva a data do dia 1.
- Intradiário → maior: baldes alinhados ao relógio (60m = hh:00). Nos EUA o 1º candle de 60m vai de 9h30 a 10h00.
- Semanal e mensal de ações (Alpaca, brapi) são **montados a partir do diário** no Radar. Na Binance usamos os
  klines nativos, que seguem exatamente a mesma convenção (00:00 UTC, segunda-feira, dia 1).

## ADR-0007 — Dados simulados só em desenvolvimento (12/10/2026)

A fonte `sim:` só existe com `RADAR_SIMULATED=1` e é **proibida em produção** (o servidor recusa iniciar).
A interface mostra a faixa "DADOS SIMULADOS" sempre que um gráfico usa essa fonte.

## ADR-0008 — Convenções exatas dos indicadores (12/10/2026)

Validadas contra uma implementação independente em pandas (`tools/reference/`), tolerância relativa 1e-9.

| Indicador | Convenção |
|---|---|
| MMA | média aritmética de n |
| MME | alfa = 2/(n+1); **semente = MMA dos n primeiros** (como TA-Lib e TradingView); 1º valor no índice n−1 |
| Média de Wilder | alfa = 1/n; semente = MMA dos n primeiros |
| Bollinger | MMA(n) ± k × desvio-padrão **populacional** (÷ n), como o TradingView |
| True Range | 1º candle = máxima − mínima |
| ATR | Wilder(TR) |
| ADX / ±DI | DM e TR desde o 2º candle; Wilder com semente; DI desde o índice n; ADX = Wilder(DX), desde 2n−1. Nos primeiros ~100 candles pode diferir levemente do TradingView, que trata o aquecimento de outro jeito |
| Stop ATR | ATR com **MME(20)**; multiplicador 3 no diário e intradiário, 2 no semanal e mensal. Em alta: stop = máx(stop anterior, fech. − m×ATR); vira quando o **fechamento** cruza o stop anterior. Começa "em alta" (só afeta o aquecimento). *Decisão nossa* |
| IFR | Wilder; perda média zero → 100 (ou 50 se ganho também zero) |
| Estocástico | lento 14/3/3; amplitude zero → 50 |
| VWAP | ancorada no pregão (zera a cada data local) |

Entrada `NaN` não altera o estado do indicador (permite encadear).

## ADR-0009 — Histórico longo da B3 via COTAHIST (12/10/2026)

**Contexto.** O plano gratuito da brapi tem só **3 meses** de histórico (🟡 FAQ da brapi). O E1 pede 10 anos.
**Decisão.** O servidor emenda o histórico importado dos arquivos anuais COTAHIST da B3 (gratuitos, oficiais)
com os 3 meses da brapi. O COTAHIST **não é ajustado por proventos**: o gráfico informa isso e o laboratório
avisa sobre gaps suspeitos (prováveis desdobramentos). Pergunta ao usuário em `OPEN_QUESTIONS.md` #5.
**Risco.** O layout do COTAHIST foi escrito de memória (❌ não verificado no PDF). Validar com um arquivo real.

## ADR-0010 — Cache com tempo mínimo entre buscas por fonte (12/10/2026)

brapi: 15 min por série (cota de 15 mil/mês). Alpaca: 2 min intradiário, 30 min diário. Binance: sempre busca.
Se a fonte falhar, o servidor devolve o cache com o erro e a data do último dado válido (princípio 1).

## ADR-0011 — `TRUST_PROXY` desligado por padrão (12/10/2026)

Só ligar atrás do proxy HTTPS (Caddy). Sem isso, um cliente poderia forjar `X-Forwarded-For` e driblar o
limite de requisições.

## ADR-0013 — Alertas: regras de avaliação e entrega (12/10/2026)

Decisões nossas (a SPEC §10 não detalha):

- **Mesma lógica do gráfico**: `AlertRuntime` em `packages/core/src/alerts` usa os mesmos indicadores, o mesmo
  motor de setups e a mesma conversão tempo↔barra (`TimeIndex`, movida para o core) que o navegador.
- **Borda, não estado**: dispara quando a condição passa de falsa para verdadeira; nunca repete enquanto ela
  continua verdadeira. O histórico usado para aquecer nunca dispara.
- **No toque** olha a máxima/mínima do candle em formação; **no fechamento** só o candle fechado. Setups e
  indicadores são sempre no fechamento (o servidor recusa "no toque" para eles).
- **Linhas de tendência e raios** são prolongados para a direita e avaliados no espaço de **barras**, igual ao
  desenho na tela (num gráfico com fins de semana, a linha não "anda" pelo relógio). **Zonas** valem para a
  direita, sem fim. A escala do alerta decide as barras.
- **Candle repetido ou mais antigo** (reconexão) é ignorado; um candle em formação mais novo sem o fechamento
  do anterior fecha o anterior (para não perder alerta de fechamento).
- **Uma vez** (padrão) desliga o alerta após disparar; **sempre** rearma, com intervalo mínimo (padrão 15 min).
- **Anti-duplicação**: chave única por usuário (`id do alerta + candle + evento`) no banco.
- **Fonte caiu**: alerta de sistema se a fonte ficar com erro por mais de 3 minutos (uma vez por queda).
- **Silêncio** no horário de Brasília; o disparo fica no histórico como "silenciado" e nada é enviado.
- **Telegram**: bot do próprio usuário; token cifrado no servidor (SecretBox) e nunca devolvido ao navegador;
  1 mensagem/s por chat e respeito a `retry_after`. **E-mail**: SMTP do `.env`. **Push**: chaves VAPID do
  `.env` ou geradas uma vez em `vapid.json` (trocar invalida as assinaturas); 404/410 apagam a assinatura.
- Alertas de **stop e alvo de planos** ficam para a Fase 5 (planos ainda não existem).

## ADR-0014 — Modo Treino ao vivo: execução realista com preço real (12/10/2026)

Pedido explícito do usuário: aprender com dinheiro fictício, mas **sempre com dados reais e atuais**.
Decisões nossas:

- **Preço real da fonte**, nunca simulado (o simulador só existe em desenvolvimento e é proibido em produção).
  Ativos com atraso (B3 pela brapi) executam no preço atrasado, e a posição mostra o aviso.
- **Só vale o que negociou depois da ordem**: o servidor reconstrói, a cada atualização do candle de 1 min,
  a faixa negociada desde a atualização anterior (máxima/mínima novas). Limitação: toques entre duas
  atualizações que não renovam a máxima/mínima do minuto não são vistos (com a Binance, a cada 1–2 s, o
  efeito é pequeno; com fontes por consulta, maior).
- **Custos sempre**: meio spread + derrapagem em ticks nas ordens a mercado e stop; limitada não derrapa e
  só executa se o preço passar **além** do limite; taxas proporcionais e corretagem em toda execução.
  Padrões por mercado em DATA_SOURCES §14, editáveis por conta.
- Gap contra no stop → abertura; alvo com gap a favor → no alvo; stop e alvo juntos → stop; no intervalo
  da entrada, só o stop (mesmas regras do backtest, `fills.ts`).
- **Só compras** nesta versão: venda a descoberto exige aluguel de ações ou margem, custos que ainda não
  simulamos — liberar sem eles deixaria o treino melhor que o real.
- **Sem alavancagem**: a compra precisa caber no saldo (cotação do dólar incluída).
- **Dólar**: USDT/BRL ao vivo da Binance como aproximação do dólar; se faltar, a cotação manual da conta;
  sem nenhuma das duas, a ordem é recusada com explicação. A cotação usada fica em cada execução.
- **Reinício** com novo saldo encerra posições pelo último preço e cancela ordens; o histórico fica (fases).
- **Stop só anda a favor**: afastar exige confirmação e grava "stop movido para trás" (estatística de
  disciplina). Trade sem stop não tem R e conta como indisciplina.
- **IR simulado** só para a B3 (motor `apurarB3`); cripto e EUA mostram "ainda não simulado".
- Chave **Treino/Real** nas preferências do servidor (treino é o padrão); no Real a faixa some e o Radar
  continua sem enviar ordens.
