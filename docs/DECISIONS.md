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

## ADR-0012 — Setups: decisões nossas (12/10/2026)

Decisões nossas (não do vídeo nem da SPEC) ao levar as §8–§9 para `packages/core/src/setups`. Nomes entre crases
são parâmetros de `params.ts` (padrão entre parênteses); os outros números são constantes no código.

**Geral e execução**
- Uma ocorrência ativa por setup e por lado: sinal novo do mesmo lado é ignorado enquanto houver outra aberta.
- Gatilhos são ordem stop intrabar (máxima + 1 tick); `pa.breakoutByClose` só vale para rompimento de nível. O
  tick a mais ou a menos é arredondado ao tick mais próximo (fora da grade: 0,5 a 1,5 tick). Alvo em R sobre o
  preço real de execução, arredondado ao tick (pode dar 1,999R).
- Stop já movido que é atingido = `saida-dinamica` (execução intrabar no stop, não fechamento). Sempre há stop
  de proteção: a opção "sem stop, com confirmação explícita" da §8.2 não existe.
- Radar do recuo e da consolidação e encerramentos sem execução gravam `price = null` (a §8 pede preço sempre).
- **Risco conhecido — candle da entrada.** Nele só o stop é conferido, e conta como atingido após a entrada se o
  candle chega lá, de qualquer cor (conservador, SPEC §12.1; `fills.ts`). Em passeios aleatórios: cerca de
  30–40% de "stop no mesmo candle" no 9.2/9.3 (10–20% no 9.1), muitos em candles de alta, em que a mínima deve
  ter vindo antes: resultados pessimistas. Resolver exige dados da escala menor (opção da §12.1, não feita).

**Pivôs e primitivas**
- Pivôs (`pa.pivotN` = 2): empate estrito à esquerda e não estrito à direita (em topos/fundos duplos idênticos
  vale o primeiro); um candle pode ser topo e fundo ao mesmo tempo. Estrutura: dois últimos topos e fundos
  confirmados, sem exigir alternância; preços iguais = indefinida.
- Pivô de alta: topo intermediário = maior máxima estritamente entre F1 e F2 (não precisa ser topo confirmado);
  vale qualquer fechamento acima dele enquanto F1 e F2 forem os dois últimos fundos; sinaliza uma vez por F2.
- Inclinação = (MA[t] − MA[t − `pa.slopeLookback`]) ÷ ATR14[t]; plana abaixo de `pa.flatSlope` (0,15); acentuada
  a partir de `pa.steepSlope` (1,0); "virando" (virada em 1 candle) tem prioridade.
- Força e ignição: corpo médio dos 20 candles anteriores (sem o atual) e cor certa. Martelo: corpo todo no terço
  superior, de qualquer cor. Amplitude zero nunca é padrão. Volume relativo: MMA21 dos 21 anteriores; secando =
  média do trecho abaixo da MMA21 de antes dele e inclinação negativa.
- Falso rompimento: fechar de novo no nível ou abaixo, a partir do candle seguinte (fechar no nível = dentro).

**Contexto e escala maior**
- Tendência (painel e escala maior, mesma função): alta = ADX ≥ 20, estrutura de alta, MMA50 subindo no candle e
  inclinação ≥ `pa.flatSlope`; baixa, o espelho; resto, lateral; "indefinida" sem MMA50, inclinação (55 candles)
  ou ADX. ADX de 20 a 25, inclusive: zona cinzenta.
- Média respeitada: a que segurou ≥ 2 dos últimos 3 a 5 fundos confirmados (mínima até `pa.respectNearAtr` (0,5)
  ATR e fechamento acima, no candle do fundo); empate: a mais curta (9, 21, 50, 100, 200). Só compra.
- Maturidade (experimental, só em alta): jovem = MMA50 virou para cima há até 20 candles E fechou acima do
  último topo confirmado até a virada; cansada = preço mais de 8 ATR acima da MMA200, MMA50 achatando
  (inclinação de 10 candles < a dos 10 anteriores) E volume médio das altas < o das baixas nos últimos 20;
  madura = médias alinhadas há 30 candles ou mais.
- Vento: maior em baixa = "Vento CONTRA para compras" qualquer que seja esta escala; maior em alta e esta em
  baixa = contra para vendas; maior lateral ou esta lateral/indefinida = neutro.
- Escala maior (1m→5m, 5m→15m, 15m/30m→60m, 60m→1d, 1d→1w, 1w→1M): agregada no fuso da bolsa se a origem é
  intradiária, em UTC se diária+ (ADR-0006); semana conta no mês da sua segunda. Só muda quando chega o 1º
  candle menor do período seguinte (conservador). "Indefinida" = sem dados.
- `higher`/`respectedMa` do motor são só para testes: gráfico, backtest e alertas passam `tf`/`tz` e o motor
  calcula a cada candle. O painel (31+ candles fechados, no último fechado) usa a mesma escala maior do motor.
- Aviso vermelho: em radar, armado e acionado (não no encerrado), compra com a escala maior em baixa e venda com
  ela em alta; vai em `notes`, `againstHigher` e no texto do alerta. Só o recuo bloqueia por isso.

**Setups 9.1, 9.2 e 9.3**
- Começam direto em "armado". Saída dinâmica (`exit.mode = 'dynamic'`, também no 9.2/9.3): MME9 virou contra,
  até no candle da entrada → stop 1 tick além do extremo desse candle, valendo do seguinte em diante.
- 9.1: filtros só no candle-sinal. `trendFilter` = MMA50[t] > MMA50[t−1]; `lateralFilter` (ligado) = ADX ≥
  `adxMin` (20) e |inclinação da MMA50| ≥ `pa.flatSlope`. O E1 alterna só o `trendFilter`.
- 9.1: o gatilho desloca (`trailTrigger`) a cada candle enquanto a MME9 não cair; o stop do `stopMode` (mínima
  do sinal ou fundo anterior = último fundo confirmado, sem limite de idade) é mantido, só desce se a menor
  mínima desde o sinal ficar abaixo dele e nunca sobe antes do acionamento. MME9 caindo antes = `desarme`.
- 9.2/9.3: pernada = MME9[t] > MME9[t−1], sem mínimo de fechamentos crescentes (o candle que virou a MME9 já é
  referência); zera com a MME9 sem subir, mas o desarme exige MME9 caindo. Sem filtro de ADX.
- 9.2/9.3: a pernada segue acompanhada durante a ocorrência; depois do trade pode armar de novo, inclusive no
  candle em que o trade encerrou. Stop = menor mínima desde o candle após a referência − 1 tick.
- 9.3 (`consecutive`, ligado): fechar igual à referência quebra a sequência; fechamentos que armaram uma
  ocorrência ou que ocorrem durante ela não contam, e a contagem recomeça quando ela termina.

**Recuo à média**
- Tendência = estrutura de alta, MMA50 subindo no candle, MME21 subindo (inclinação com `pa.slopeLookback`
  positiva) e escala maior não em baixa (lateral ou sem dados deixam passar).
- `ma = 'auto'` usa a média respeitada (pode ser MMA100/MMA200; sem nenhuma, MME21), fixa durante a ocorrência.
- Radar: mínima ≤ média + `nearAtr` (0,5) × ATR14 e fechamento abaixo do último topo. Arma no fechamento de
  qualquer candle na região (e fechamento ≥ média − 0,5 ATR), inclusive o do radar; força, martelo e inside bar
  só somam 1 ponto. Cada candle novo na região refaz gatilho (máxima + 1 tick) e stop. `expiryBars` (5) conta do
  1º "armado"; radar sem armar expira com `radarExpiryBars` (15): arma de S a S+N.
- Pontos: volume secando, amplitude < `smallerRangeRatio` (0,7) × a do impulso, fundo anterior preservado; −1
  por alerta. `requireHealthy`: ≥ 2 pontos (sem o padrão) e nenhum alerta.
- Escala maior em baixa invalida antes do gatilho (sabida na abertura); perder o fundo anterior ao topo (não o
  do recuo) ou a média virar e ser perdida, no fechamento, só invalidam se a ordem stop não executou.
- Stop `pullback-low`: menor mínima desde o topo − 1 tick. Condução: fechou abaixo da MME9 → stop 1 tick abaixo
  da mínima. Não feitos: alvo no topo anterior, parcial 2R/3R, Stop ATR e ponto por volume no gatilho.

**Consolidação**
- Caixa = maior janela válida de `minBars` (8) a `maxBars` − 1 candles até o candle anterior; todo candle que
  fecha dentro (inclusive o do radar) entra nela e topo/base acompanham os pavios. Tendência antes = fechamento
  acima da MMA50 e MMA50 acima da de 5 candles antes, no candle anterior à caixa.
- Amplitude até `maxRangeAtr` (3) × ATR14 anterior à caixa (passou: cancela); acima de `maxBars` (40) sem
  romper, expira, e nova caixa só no candle seguinte. Contração: Bollinger 20/2 no menor quintil dos últimos 120
  OU ATR5 < ATR20 (leitura de "ATR5/ATR20 caindo"). Sem dado de volume, a caixa não é filtrada por volume (o
  radar avisa).
- Rompimento exige corpo ≥ `breakoutBodyMult` (1,2) × média dos 20 anteriores (qualquer cor) e volume; sem eles
  cancela. Sem dado de volume: com `requireVolume` cancela explicando; desligado, arma com "sem dado de volume".
  Entrada `breakout`: na abertura do candle seguinte, a qualquer preço.
- Reteste: mínima até `retestAtr` (0,25) ATR acima do topo; gatilho = máxima + 1 tick, rolando a cada candle;
  expira em `retestExpiryBars` (10). A ordem stop vem antes do fechamento; fechar dentro só invalida sem
  execução. Stop mais curto = 1 tick abaixo da menor mínima desde o reteste (limitado ao topo da caixa).
- Depois da entrada: alerta de falso rompimento na janela `pa.falseBreakBars` (2) contada da entrada; condução =
  fechou abaixo da MME9 em queda → stop na mínima desse candle − 1 tick.

**Elástico**
- Sem `requireConfirmation`, o candle que fechou fora já arma; com ela, sem martelo/força o gatilho não rola.
- Gatilho na média central ou além: no candle que fechou fora só sai o radar com nota e o gatilho passa ao
  seguinte; depois disso cancela (inclusive se a média chega ao gatilho armado).
- Cancela se a máxima (venda: mínima) tocar a média do candle atual; `expiryBars` (5) conta do candle que fechou
  fora. Alvo = média central do candle anterior. Com `stopMode = 'outside-bar'` (padrão), o gatilho não passa
  para um candle inteiro além do stop.
- Gap além da média na entrada: executa e o alvo fecha na mesma abertura ("cancelado", 0R antes dos custos).
  Média chega à entrada com posição aberta: `saida-dinamica`, nunca "alvo" com prejuízo.
- Parcial (`partialAt1R`) = 50% em 1R (constante); o stop não vai à entrada; resultR = 0,5 × 1R + 0,5 × R final;
  stop e 1R no mesmo candle = stop sem parcial. O backtest realiza a parcial (campo `partial`).

**Reflexividade**
- `weeklyOnly` (ligado): só roda em '1w'. Topo de 52 semanas = 52 candles (constante da SPEC). Fundamento nulo é
  "não verificado", nunca forte; LPA abaixo de `minEpsGrowth` ou receita em queda conhecidos suprimem.
- Confirmação = pivô de alta e, em até `confirmBars` (8) candles, MME9 e MME21 subindo (fechar abaixo de F2
  volta a esperar); "apoiado nas médias ou rompendo resistência" não é checado além do pivô.
- Gatilho = máxima + 1 tick, rolando sem expirar; stop = F2 − 1 tick; fechar abaixo dele invalida. O radar
  expira quando t − início passa de `radarExpiryBars` (104). "MME21/MMA50 descendo" = menor que no anterior.
- Saída: `exit.targetR` (3R) ou condução (`exit.mode = 'dynamic'`): fechou abaixo da MME21 → stop móvel na
  mínima desse candle − 1 tick. Só existe a 1ª parte da entrada em etapas.

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

## ADR-0015 — Plano de trade e anti-revanche no Treino (12/10/2026)

- O plano (SPEC §11) fica **Liberado** só com: setup (ou "leitura própria"), 3 escalas, stop técnico, alvo
  (se o critério for alvo fixo), tamanho, motivo técnico (mín. 15 letras), print do gráfico (automático,
  JPEG reduzido) e os 5 itens do checklist psicológico (§22).
- No **treino ele não bloqueia** a compra: o botão avisa "conta como indisciplina" e o diário mede
  **disciplina** = trades com plano liberado, com stop e sem stop movido para trás (o Painel de prontidão
  exige ≥ 90%).
- **Anti-revanche**: pausa recomendada a partir de 2 stops no dia ou 4 em 7 dias (padrões *, editáveis
  nas preferências). Nunca bloqueia (SPEC: "nunca bloqueia de forma irreversível").
- Os avisos automáticos vistos na hora da entrada ficam gravados no plano (o que você sabia ao entrar).

## ADR-0016 — Laboratório: veredito, sensibilidade e o que fica de fora (12/10/2026)

Decisões nossas (não do vídeo nem da SPEC), todas visíveis na tela:

- **Veredito em degraus**, do mais cético ao menos: inconclusivo (< 30 trades) → reprovado (expectativa
  ≤ 0 depois de custos, ou resultado ≤ 0 depois do IR simulado) → evidência fraca (< 30 trades no teste)
  → reprovado (teste fora da amostra ≤ 0 em R ou em dinheiro depois do IR) → promissor (vizinho do
  parâmetro com expectativa ≤ 0, ou perdeu para o CDI) → evidência fraca (< 100 trades no total) →
  aprovado. "Aprovado" sempre vem com "passado não garante futuro".
- **Sensibilidade**: varia só o número "*" principal dos 2 primeiros setups escolhidos (alvo em R
  1,5/2/2,5/3; desvios da Bollinger 2,5/3/3,5; queda mínima da reflexividade 40/50/60%). Estabilidade =
  os vizinhos imediatos do valor usado também positivos.
- **Monte Carlo**: 5.000 reamostragens com semente fixa (42) por execução, para caber no tempo de resposta;
  a SPEC pede 10 mil* — fica como parâmetro a subir quando o laboratório rodar em segundo plano.
- **Só compras por padrão**: vender a descoberto exige aluguel (B3) ou margem (cripto), que ainda não
  simulamos; ligar "Incluir vendas" grava o aviso "resultado otimista".
- **Moeda**: o resultado fica na moeda do ativo; quando não é real, o aviso diz que a comparação com o
  CDI ignora o câmbio.
- **Registro de tentativas**: toda execução fica salva; "variações" = mesmo usuário + ativo + conjunto de
  setups (qualquer parâmetro). Acima de 5, aviso explícito de desconfiança.
- **Walk-forward** (adicionado depois): treino ancorado em 50% do período e 5 trechos de teste; em cada
  corte escolhe o melhor valor do número "*" principal do 1º setup usando só trades já encerrados e mede no
  trecho seguinte. Expectativa fora da amostra ≤ 0 impede o "aprovado" (fica "promissor").
- Ainda não feito: aviso de viés de sobrevivência específico para "composição atual de índice" no
  laboratório (hoje o aviso é genérico, em toda execução; os experimentos avisam pela lista escolhida).

## ADR-0017 — Experimentos "Verificar o youtuber" (12/10/2026)

Decisões nossas para a SPEC §12.4 (tela `/laboratorio/experimentos`):

- **Mesmo motor**: E1, E3, E4, E5 e a Reflexividade do E7 rodam `runBacktest` com os detectores do app, custos
  padrão do mercado, risco de 1% por trade, R$ 10 mil e só compras. Resultados em R de todos os ativos somados.
- **Comparação**: teste t de Welch na diferença de expectativa (R por trade); |t| ≥ 2 (≈ 95%) = "maior que o
  barulho do acaso", senão "dentro do barulho". "Teste" = últimos 30% do período de cada ativo.
- **Histórico pedido**: diário 2.600 candles (~10 anos), semanal 1.040 (~20 anos), mensal 240, 60 min 5.000;
  ativo com menos de 80 candles fechados ou escala que a fonte não oferece vira linha de erro (nunca inventa).
- **Conjuntos sugeridos** (editáveis): 20 ações conhecidas da B3, 5 criptos e 5 ativos dos EUA. Composição e
  liquidez não verificadas hoje (🟡); a lista atual é viés de sobrevivência e isso aparece nas limitações.
- **E2**: além da curva normal (0,135% por lado), compara com um passeio aleatório normal de mesma volatilidade
  medido com a mesma régua (20 séries, semente fixa), porque a banda de 20 candles não segue a curva normal nem
  num mundo normal. "Voltou à média" = tocou a média central em até 10 candles; casos sem 10 candles depois
  ficam fora.
- **E6**: stop típico = 1 × ATR14 (mediana), custo de ida e volta = 2 × (taxa + meio spread + derrapagem) +
  corretagem diluída em R$ 10 mil; IR só na B3, 20% em 5/15/60 min e 15% no diário, sobre o que sobra (sem
  isenção nem compensação). Supõe os 40% de acerto do vídeo em qualquer escala (premissa, não fato).
- **E7**: compra ingênua no 1º fechamento a −50% do topo de 52 semanas, segurando 52 semanas sem stop e sem
  custos (otimista de propósito); cada queda conta uma vez. Reflexividade sem fundamentos (não verificados).
- Execução em segundo plano, um ativo por vez, uma por usuário; servidor reiniciado marca a execução como erro.

## ADR-0018 — Painel de prontidão (13/10/2026)

Régua nossa para a SPEC §13 (editável em Treino → Painel de prontidão → "Ajustar a régua"; nunca bloqueia):

- **Amostra**: 100 trades no total, 30 ao vivo. Enquanto o replay não existe, só os ao vivo contam.
- **Expectativa**: média de R (já com custos) > 0 **e** resultado da conta depois do IR simulado (DARFs +
  saldo abaixo do mínimo) > 0 — o IR pode transformar um pequeno lucro em prejuízo.
- **CDI**: retorno da conta depois do IR maior que o CDI acumulado desde o início (ou o reinício) da conta;
  sem dado do Banco Central = "sem dados", nunca aprovado.
- **Disciplina** ≥ 90%: plano liberado, com stop, stop nunca afastado e risco na entrada até o limite das
  preferências (`maxRiskPct`, 2%). Risco = |entrada − stop inicial| × quantidade, em % do patrimônio de
  trades fechados naquele momento (posições abertas não entram: aproximação).
- **Queda máxima** da conta (trades fechados) até 20% do pico.
- Contagem, R e disciplina usam **todas as gerações** da conta (reiniciar não apaga a evidência); dinheiro,
  CDI e queda usam a geração atual. Trades de gerações antigas não têm o risco medido (o saldo inicial
  delas não fica guardado): não reprovam a disciplina, mas aparecem contados à parte.

## ADR-0019 — Feedback depois do trade de treino (13/10/2026)

Decisões nossas para a SPEC §13 (Treino → Diário → "Ver feedback"), calculadas com os candles reais da
escala do setup do plano (sem plano: diário) e o mesmo detector do app:

- **Gatilho**: só candles FECHADOS antes do candle que contém a abertura (sem look-ahead); ao menos 60
  candles antes, senão "sem dados". O preço comparado é o de mercado **antes** do meio spread e da
  derrapagem (senão uma compra abaixo do gatilho pareceria "no gatilho"). Folga de meio tick.
- **Realizou cedo**: saída à mão com lucro **ou alvo aproximado e executado**; olha até 20 candles depois do
  candle da saída com o mesmo modelo de execução do backtest (stop e alvo no mesmo candle = stop).
- **Stop**: afastado se houve evento "stop movido para trás" **ou** se o stop na saída ficou abaixo do
  inicial ou foi retirado (ex.: compra adicional com stop menor). Entrada abaixo do stop por gap: risco
  planejado "não se aplica".
- **Setup puro**: a mesma ocorrência até encerrar (R do detector, sem custos); diferença de até 0,1R
  conta como igual. Ativo com atraso: abertura e saída descontam o atraso da fonte.
- **Limitações conhecidas**: parâmetros dos setups e limite de risco são os de hoje, não os do dia da
  entrada (se você mudar no editor de parâmetros depois, o feedback de trades antigos muda junto); com
  várias saídas, o tipo de
  saída é o da última e o preço é o médio.

## ADR-0020 — Scanner multi-mercado (13/10/2026)

Decisões nossas para a SPEC §14 (tela `/scanner`; lógica em `packages/core/src/scanner`):

- **Mesma lógica do gráfico**: cada ativo passa pelo mesmo motor de setups e pelo painel de contexto, só
  com candles FECHADOS (o candle em formação nunca entra). Mínimo de 31 candles fechados por ativo.
- **Limites**: até 60 ativos por varredura (20 no intradiário), um ativo por vez, usando o cache e o tempo
  mínimo entre buscas de cada fonte (ADR-0010); ativos além do limite são contados e avisados.
- **Agenda**: diária (confere a cada minuto se há pregão novo fechado pela sessão da fonte, com folga de
  5 min + atraso da fonte) e, só para listas, a cada candle intradiário fechado. Servidor reiniciado no
  meio = execução marcada como erro explicado.
- **Fundamentos**: sem fonte ligada, o filtro de fundamentos nunca "passa"; o filtro pronto "Distorção
  (reflexividade)" mostra à parte quem passa só na parte gráfica ("fundamentos não verificados").
- **Escala semanal**: no diário, o semanal é montado a partir de 600 candles diários (~120 semanas); nas
  outras escalas é pedido à parte (~5 anos).

## ADR-0021 — Editor de parâmetros dos setups (13/10/2026)

- **Onde vale**: um único conjunto de parâmetros por usuário, salvo nas preferências do servidor. Vale
  para o gráfico (ao abrir de novo), alertas, scanner, feedback do treino e laboratório.
- **Campos**: rótulos em português escritos à mão (`apps/web/src/lib/setup-param-fields.ts`); um teste
  garante que todo parâmetro do schema tem campo e que os limites batem com o schema.
- **Regras entre campos** que o schema não cobre e que fariam o setup nunca aparecer: caixa mínima <
  máxima (consolidação), inclinação plana < acentuada, volume alto ≤ estrondoso. Salvar fica bloqueado.
- **"Ligado"** vale para gráfico, alertas e scanner. No laboratório quem escolhe são as caixinhas: o
  servidor liga os setups marcados mesmo que estejam desligados nas preferências (decisão nossa, para
  não aparecer "0 trades" sem explicação).
- **Antiautoengano**: aviso fixo no topo da tela; cada variação de parâmetro testada no laboratório já
  conta como tentativa (ADR-0016). O laboratório mostra "parâmetros: padrão" ou "personalizados (N)",
  contando só os setups marcados e a leitura dos candles.
- **Fora daqui**: custos (corretagem, spread, slippage) e parâmetros dos experimentos E1–E7 continuam
  fixos nos padrões; os experimentos sempre usam os padrões para serem comparáveis.

## ADR-0022 — Diário real, calculadora por mercado e comparação treino × real (13/10/2026)

- **Diário real** (`/diario`): o usuário digita as execuções da corretora (entrada, parciais, aumento,
  saída), com custos em R$ e câmbio do dia nos ativos em moeda estrangeira. O Radar não envia ordens.
  Resultado, R e IR são calculados a partir das execuções (`realTrade` no core), nunca digitados.
- **Custo médio**: entradas formam o preço médio em R$; cada saída realiza (saída − médio) × qtd ×
  valor do ponto, menos a taxa dela e a parte proporcional das taxas de entrada. O R usa o risco da
  primeira montagem da posição (entrada média até a primeira saída × maior quantidade).
- **Stop só anda a favor**: afastar exige confirmação e grava "stop movido para trás" (conta na
  disciplina). Tirar o stop conta como para trás. Stop no preço médio grava "breakeven".
- **IR estimado**: só B3 (ações com a isenção de R$ 20 mil; minicontratos sem isenção). Day trade =
  saída no mesmo dia (São Paulo) de uma entrada — simplificação; a corretora pode casar diferente.
  Cripto, EUA e forex ficam de fora (regras em disputa ou próprias; DATA_SOURCES §9).
- **Estatísticas**: `journalStats` (core) é a única implementação; o treino passou a usá-la. Sem
  saldo inicial no real, a "pior queda" é só em R$.
- **Comparação treino × real** (`compareJournals`): só conclui com ≥ 20 trades encerrados em cada
  lado; "diferença grande" = R médio ≥ 0,3R menor, acerto ou disciplina ≥ 15 p.p. menor, ou ≥ 10% dos
  trades com stop para trás. Limites nossos, arbitrários. Replay entra quando existir.
- **Calculadora** (`/calculadora`): ações da B3 (lote 100 + fracionário), WIN (R$ 0,20/ponto), WDO
  (R$ 10/ponto), EUA (ações inteiras), cripto e forex (passo editável; forex em lotes de 100.000 na
  moeda de cotação). Fatos 🟡 em DATA_SOURCES §5 e §8.
- **Plano com setup vazio** passou a ser aceito (antes a boleta do treino recusava com "parâmetros
  inválidos"); a falta conta como plano incompleto.
- **Menu**: no modo Real, a barra de baixo do celular mostra "Diário" no lugar de "Treino".

## ADR-0025 — Replay candle a candle (13/10/2026)

(ADR-0023 e ADR-0024 ficam para o agente MT5/forex e para os fundamentos, feitos em paralelo.)

- **O futuro fica no servidor**: a sessão guarda o trecho inteiro, mas a API só entrega os candles já
  revelados (`cursor`). Revelar é sempre para a frente; nada volta.
- **Aquecimento**: 250 candles antes do início (indicadores e detectores começam "quentes"); mínimo de
  60 candles depois. Sem histórico suficiente na fonte, a sessão é recusada com o motivo (brapi grátis
  tem ~3 meses: B3 diária só funciona com o COTAHIST importado).
- **Sorteio**: ativo dos conjuntos sugeridos (simulados em dev) e início sorteados; ativo, datas e fonte
  ficam ocultos até encerrar (eixo de tempo e data da legenda escondidos). O nível de preço ainda pode
  dar pista — limitação aceita.
- **Execução**: o mesmo motor do treino ao vivo (`orderFill`/`exitHit`), um candle = um intervalo.
  Ordem a mercado executa na ABERTURA do candle seguinte (decide-se com o candle fechado). Stop antes do
  alvo no mesmo candle; no candle da entrada só o stop. Uma posição por vez, só compra (como o treino).
- **Dinheiro**: capital fictício em R$; ativos em dólar usam o câmbio de HOJE, fixo na sessão
  (simplificação: o resultado em R não muda; o em R$ é aproximado).
- **Feedback**: `tradeFeedback` do core, só com os candles revelados (nunca mostra o futuro).
- **Estatísticas**: os trades de todas as sessões formam o "diário do replay" (`journalStats`), comparado
  com o treino ao vivo e o real no Diário real.
- **Gráfico**: o mesmo `ChartView` com fonte trocável; desenhos do replay ficam na chave
  `replay:<sessão>`, separados dos do ativo.

## ADR-0026 — Exercícios de leitura e trilha (13/10/2026)

- **Gabarito = detector**: o exercício corta uma série real (diário, ativo sorteado e oculto) num
  candle fechado e pergunta o que o detector vê ali. Nada é escrito à mão; com parâmetros
  personalizados, o gabarito segue os parâmetros do usuário.
- **Sem pistas**: positivos e negativos têm as MESMAS perguntas (contar perguntas não entrega a
  resposta); no negativo, as opções de preço giram em torno da máxima/mínima do último candle. O gráfico
  do exercício não mostra datas nem marcações de setups (seriam a resposta). O gabarito e os 30 candles
  de "depois" ficam no servidor até a resposta, e cada exercício é corrigido uma vez só.
- **Níveis** (nossos): 1 = tem setup armado? qual?; 2 = + gatilho e stop; 3 = + escala maior contra?
  "Qual?" aceita qualquer setup de compra armado no candle. Sem setup, responder "não" dispensa as
  outras perguntas; "sim" erra todas.
- **Desfecho**: o que o setup puro fez depois (acionou? R sem custos) e a variação do preço; o texto
  lembra que um caso não prova nada.
- **Trilha**: 10 módulos na ordem da SPEC; cada um com leitura (marcada pelo usuário), exercícios
  perfeitos no nível pedido (com foco nos setups do módulo) e missão de replay (trades com plano
  liberado do setup). Metas arbitrárias, para ritmo — não provam habilidade (isso é o Painel de
  prontidão).

