# PROMPT PARA O CLAUDE CODE — Projeto "Radar"

> **Primeira tarefa:** salve este documento inteiro, sem alterações, em `docs/SPEC.md`. Ele é a fonte da verdade do projeto em todas as sessões futuras.

---

## 1. Missão

Construa o **Radar**: uma plataforma web pessoal, instalável como aplicativo (PWA) no iPhone e no PC, para **análise, planejamento e verificação de estratégias de trading**. O usuário é um único brasileiro iniciante, que vai operar **cripto, ações dos EUA, ações e futuros da B3 e forex**. As ordens são executadas fora do Radar (MetaTrader 5 ou site da corretora). **O Radar não envia ordens.**

O Radar tem quatro trabalhos:

1. **Ver** — gráficos de velas verde e vermelho, em tempo real ou quase, com desenhos, indicadores e várias escalas lado a lado. Estilo MetaTrader/TradingView, porém mais simples e prático.
2. **Avisar** — alertas de preço, de desenhos e de setups no celular (push), no Telegram e por e-mail.
3. **Planejar** — checklist e plano de trade com cálculo de posição pelo risco, antes de cada operação.
4. **Verificar** — backtest honesto, estatísticas reais do diário e um "laboratório" que testa se as regras ensinadas funcionam de verdade, com custos, impostos brasileiros e comparação com o CDI.
5. **Treinar** — um **Modo Treino** com dinheiro fictício, replay do passado, exercícios e feedback, para o usuário aprender o processo inteiro sem arriscar dinheiro real (seção 13).

O item 4 é o diferencial. O usuário aprendeu os setups com um youtuber que vende assinatura. O Radar trata cada regra como **hipótese a ser testada**, nunca como verdade.

---

## 2. Sobre o usuário

- Brasileiro (fuso America/Sao_Paulo), iniciante em trading e **não é programador**. Toda documentação para ele deve ser em PT-BR, passo a passo, sem pressupor conhecimento técnico.
- Uso estritamente pessoal. Pode haver sistema de contas, mas é um usuário.
- Vai publicar o código no GitHub dele e hospedar por conta própria, com custo zero sempre que possível.
- Quer o app no iPhone, com notificações, e também no computador.
- Quer interface em português, prática e visual.
- **Ainda não confirmou**: se tem PC Windows onde o MetaTrader 5 possa ficar aberto (necessário para B3 em tempo real gratuita), qual é o capital e se o foco será day trade ou swing. Registre isso em `docs/OPEN_QUESTIONS.md`, adote os padrões deste documento e siga em frente.
- Valoriza a verdade acima do conforto: dados verificáveis, incertezas explícitas, riscos e custos sempre visíveis, comparação com alternativas como o CDI.

---

## 3. Princípios inegociáveis

1. **Nunca inventar dados.** Nenhum preço, candle, fundamento, taxa ou estatística fabricado. Se a fonte falhar, a interface mostra o erro e a data do último dado válido. Dados simulados só em modo de desenvolvimento, com a faixa visível "DADOS SIMULADOS".
2. **Transparência da fonte.** Todo gráfico mostra a fonte, o atraso (tempo real, atrasado X min ou fechamento anterior) e se o volume é completo ou parcial.
3. **Cético por padrão.** Nenhum texto do app promete lucro. Toda estatística mostra o tamanho da amostra e o período. Resultados de backtest sempre incluem custos e, quando aplicável, IR, ao lado do CDI e do buy & hold.
4. **Uma única implementação da lógica.** Indicadores, detecção de setups, gestão de risco e backtest vivem num pacote compartilhado (`packages/core`) e são usados igualmente pelo navegador, pelo servidor de alertas, pelo scanner e pelo backtest. Proibido duplicar lógica.
5. **Sem look-ahead.** Nenhum sinal pode usar informação de candle ainda não fechado, exceto quando explicitamente marcado como "intrabar" (alerta de toque). Topos e fundos só existem a partir do candle em que se confirmam.
6. **Respeito a termos de uso e licenças.** Sem scraping de TradingView, Investing, Yahoo ou similares. Só APIs oficiais ou públicas, dentro dos termos. O app fica atrás de login, porque dados de bolsa são licenciados para uso pessoal e não podem ser redistribuídos publicamente.
7. **Nada de envio de ordens a corretoras.** Fora de escopo.
8. **PT-BR e Brasil.** Interface em português; números no formato R$ 1.234,56; datas DD/MM/AAAA; exibição no fuso de São Paulo; armazenamento em UTC.
9. **Mobile primeiro, desktop poderoso.** Funciona bem num iPhone com 375 px de largura e aproveita telas grandes.

---

## 4. Como você deve trabalhar (sessões longas e autônomas)

Este é um projeto grande, para muitas sessões. Trabalhe de forma autônoma e contínua.

- **Comece agora, sem esperar aprovação de plano.** Ao iniciar:
  1. salve este documento em `docs/SPEC.md`;
  2. crie `CLAUDE.md` com as convenções do projeto, comandos e estrutura, para orientar sessões futuras;
  3. crie `docs/ROADMAP.md` com as fases da seção 20 em checkboxes;
  4. crie `docs/DECISIONS.md` (registro de decisões em formato ADR curto);
  5. crie `docs/DATA_SOURCES.md` e `docs/OPEN_QUESTIONS.md`;
  6. comece a Fase 0.
- **Continuidade.** Em toda sessão nova, leia primeiro `CLAUDE.md`, `docs/ROADMAP.md` e `docs/DECISIONS.md`, e continue de onde parou. Se o contexto da conversa ficar longo, confie nos arquivos de `docs/`, não na memória da conversa.
- **Não pare no fim de uma fase** se ainda houver espaço para trabalhar: siga para a próxima, sempre deixando o app funcionando.
- **Verifique antes de depender.** Tudo o que descreve o mundo atual (limites de planos gratuitos, endpoints, preços, versões de bibliotecas, regras fiscais, especificações de contratos) deve ser checado na documentação oficial antes de virar código. Registre em `docs/DATA_SOURCES.md` o fato, o link e a data da verificação. Se não houver rede para verificar, marque **NÃO VERIFICADO** e implemente atrás de um adaptador que permita trocar depois.
- **Seu ambiente pode bloquear a internet.** Se as APIs de mercado não forem acessíveis daqui, desenvolva contra fixtures gravadas ou sintéticas, com nomes claros, e deixe os testes de integração reais marcados para rodar quando houver rede. Nunca afirme ter testado algo que não testou.
- **Quando perguntar.** Só pare para perguntar ao usuário diante de decisão cara ou irreversível sem padrão razoável (gastar dinheiro, apagar dados). No resto, escolha o padrão mais sensato, registre em `DECISIONS.md` e continue.
- **Fatias verticais.** Mantenha o app rodando ponta a ponta o tempo todo. Prefira algo pequeno funcionando a algo grande pela metade.
- **Commits pequenos e frequentes**, com mensagens claras (Conventional Commits). Nunca commite segredos (`.env`, chaves).
- **Qualidade.** TypeScript estrito, lint e testes. Nada está "pronto" sem teste (seção 19).
- **Relatório ao fim de cada sessão** no formato da seção 21.

---

## 5. Arquitetura

Padrão a seguir. Se a verificação mostrar algo melhor, ajuste e registre o motivo em `DECISIONS.md`.

Monorepo TypeScript com pnpm workspaces:

```
apps/web          → PWA (React + Vite + TypeScript + Tailwind): gráficos, desenhos, painéis
apps/server       → Node (Fastify) + WebSocket + agendador: dados em tempo real, alertas, scanner, push, API
packages/core     → lógica pura e testada: candles e agregação, indicadores, primitivas de price action,
                    detectores de setups, contexto e tendência, risco e posição, backtest, estatísticas, impostos
packages/data     → adaptadores de fontes de dados com interface única
packages/shared   → tipos e schemas (zod) compartilhados
agents/mt5-bridge → agente Python (Windows) que lê o MetaTrader 5 e envia ao servidor
docs/             → especificação, decisões e guias para o usuário
```

- **Banco**: SQLite (um usuário, simples, backup fácil), com ORM tipado (ex.: Drizzle) e migrações.
- **Biblioteca de gráficos**: faça um protótipo rápido comparando duas opções e registre a decisão:
  - **TradingView Lightweight Charts**: open source, leve, visual familiar. Não traz ferramentas de desenho prontas; elas exigem plugins (series primitives). Confirme na documentação atual.
  - **KLineCharts**: open source, com desenhos e indicadores nativos. Confirme na documentação atual.
  - Critérios: ferramentas de desenho, uso por toque no celular, desempenho com 10 mil candles, licença e manutenção.
  - Não use a biblioteca "Advanced Charts" do TradingView sem verificar a licença, que exige aprovação e tem restrições de uso.
- **Cálculos pesados** no navegador rodam em Web Worker.
- **Contêineres**: Docker Compose para o servidor, com proxy de HTTPS automático (ex.: Caddy).
- **Tempo real**: o navegador conecta ao seu servidor por WebSocket, e o servidor agrega as fontes. Chaves de API nunca vão para o navegador.

Modelo de dados mínimo: usuários e sessões, preferências, watchlists, ativos, desenhos, presets de indicadores, alertas e disparos, canais de notificação e assinaturas de push, eventos de setups (com histórico de estados), planos de trade, trades do diário (real, paper, replay) e eventos de trade (incluindo "stop movido"), execuções de backtest (parâmetros, universo, resultados, hash), cache de candles, cache de fundamentos, séries macroeconômicas.

---

## 6. Dados de mercado

Interface única de adaptador em `packages/data`:

- `searchSymbols(texto)`
- `getCandles(símbolo, timeframe, de, até)`
- `subscribe(símbolo, timeframe)`, que entrega o candle em formação e o candle fechado
- `getMeta(símbolo)`, que informa fonte, atraso, horário de pregão, tick size, lote, moeda e se o volume é completo

Fontes candidatas — **todas a verificar** antes de usar:

| Mercado | Fonte candidata | Cuidados |
|---|---|---|
| Cripto | API pública de exchange (ex.: Binance REST + WebSocket de klines) | A Binance bloqueia algumas regiões, como IPs dos EUA. O servidor deve ficar em região permitida, de preferência no Brasil. Prever adaptador de outra exchange. O volume é da exchange, não do mercado todo. |
| Ações EUA | Plano gratuito de provedor como Alpaca (tempo real via IEX, histórico consolidado com atraso) ou similar | O feed IEX é uma fração do mercado: **o volume intradiário fica subestimado**. Use barras consolidadas para o volume de candles fechados e marque o volume ao vivo como "parcial". |
| B3, tempo real | MetaTrader 5 da corretora do usuário, via `agents/mt5-bridge` | Só funciona com o PC Windows ligado e o MT5 aberto. |
| B3, atrasado | API gratuita (ex.: brapi.dev) | Verificar limites, token, atraso e termos. Mostrar "atrasado X min". |
| Forex | MT5 de corretora de forex (via bridge), API de corretora com conta demo (ex.: OANDA, verificar se aceita residentes no Brasil) ou provedor gratuito | O volume no forex é "tick volume" da corretora: **desligue ou rotule as regras de volume em forex**. |
| Fundamentos EUA | SEC EDGAR, API "companyfacts" (gratuita, exige User-Agent identificado) | Lucro por ação e receita trimestrais e anuais. |
| Fundamentos Brasil | CVM Dados Abertos (DFP/ITR) | Processar CSVs e atualizar periodicamente. |
| Juros e CDI | Banco Central, API SGS (verificar os códigos das séries da Selic meta e do CDI) | Usado no benchmark e no painel Brasil. |

Regras de dados:

- **Agregação**: semanal e mensal construídos a partir do diário de forma consistente, respeitando feriados e horários de cada bolsa. Cripto funciona 24/7 e forex 24/5. Documente a convenção (ex.: semana começa na segunda).
- **Ajustes**: use séries ajustadas por proventos e desdobramentos no backtest; marque quando a fonte não ajusta.
- **Cache**: o histórico baixado fica no SQLite, respeitando os termos de uso, para backtest e para reduzir chamadas.
- **Limites de requisição**: fila, backoff e indicação visual quando o limite for atingido.
- **Estado do mercado**: aberto, fechado ou pré-abertura por bolsa, visível no app.
- **Agente MT5 (Python, Windows)**:
  - usa o pacote oficial `MetaTrader5` e lê candles e ticks por polling;
  - envia ao servidor por conexão **de saída** autenticada (WebSocket com token), sem abrir portas no PC;
  - reconecta sozinho e tem lista de símbolos configurável;
  - pode rodar duas instâncias (uma para a corretora da B3, outra para a de forex);
  - inclui um simulador para testar sem MT5;
  - vem com o guia `docs/GUIA_MT5.md` para leigo: instalar Python, configurar e deixar iniciando com o Windows.

---

## 7. Gráfico e ferramentas

- Candles verde (alta) e vermelho (baixa), com cores configuráveis. Linha e Heikin-Ashi como opções.
- Timeframes: 1m, 5m, 15m, 30m, 60m, diário, semanal e mensal.
- **Modo 3 escalas ("visão fractal")**: três gráficos do mesmo ativo lado a lado, com cursor sincronizado e rótulos **Contexto / Setup / Gatilho**. No celular, viram abas deslizáveis. Mapeamentos padrão:
  - operação no diário → semanal + diário + 60m;
  - operação no semanal → mensal + semanal + diário;
  - day trade no 15m → 60m (com o diário disponível) + 15m + 5m.
- Busca de ativos unificada entre mercados. Listas de observação (watchlists) com selos dos setups detectados.
- **Ferramentas de desenho**:
  - linha horizontal, linha de tendência, raio e linha vertical;
  - **zona de preço (retângulo)**, porque suporte e resistência são regiões, não linhas;
  - canal paralelo;
  - Fibonacci (retração e projeção);
  - régua de medição (em % e em preço);
  - **ferramenta de posição comprada/vendida**, com entrada, stop, alvo, relação risco/retorno e quantidade calculada;
  - texto e notas.
- Os desenhos persistem no servidor por ativo e sincronizam entre aparelhos. Podem ser travados, ocultados e copiados entre timeframes. Atalhos no desktop, toque longo no celular.
- Qualquer linha ou zona desenhada vira alerta com um clique.

**Indicadores do preset "Padrão do canal" (ligados por padrão):**

| Indicador | Parâmetros |
|---|---|
| Média móvel exponencial | 9 (destaque: branca, tracejada, mais grossa) |
| Média móvel exponencial | 21 |
| Média móvel aritmética | 50 |
| Média móvel aritmética | 200 |
| Volume | com média aritmética de 21 do volume |
| ADX com +DI e −DI | 14, com linhas de referência em 20, 25 e 40 |
| ATR | 14 (exibição) |
| Stop ATR (trailing) | ATR de 20 com média exponencial; multiplicador 2 no semanal e 3 no diário |
| Bandas de Bollinger | 20 períodos, **3 desvios**, média central aritmética de 20 |

Opcionais, desligados por padrão: MACD, IFR, estocástico, VWAP e Bollinger de 2 desvios. Presets salvos: "Padrão do canal", "Limpo" e personalizados.

Cada indicador deve ser testado contra valores de referência (seção 19).

---

## 8. Motor de setups

Todos os detectores ficam em `packages/core` e são **determinísticos**, **parametrizáveis** (schema zod, editável na interface) e **incrementais**. Cada detector emite eventos com este ciclo de vida:

`radar` (contexto favorável, observar) → `armado` (condição cumprida, gatilho definido) → `acionado` (gatilho rompido) → `encerrado` (stop, alvo, saída dinâmica, desarme ou expiração)

Todo evento registra preço, horário, motivo e parâmetros usados.

Onde os vídeos não especificam uma regra, você **escolhe um padrão**, documenta como **"decisão nossa, não do vídeo"** e o expõe como parâmetro. Os números marcados com **\*** são padrões iniciais arbitrários: devem ser calibrados no laboratório (seção 12), **sem overfitting**.

### 8.1 Primitivas de price action (objetivas)

- **Topos e fundos (pivôs de swing)**: fractal com N = 2\* candles de cada lado. Um topo ou fundo só existe **a partir do candle em que se confirma**, N candles depois. Isso é obrigatório para evitar look-ahead.
- **Pivô de alta**: um fundo F2 mais alto que o fundo anterior F1, seguido de fechamento acima do topo intermediário entre eles. Pivô de baixa: espelhado.
- **Tendência por estrutura**: alta quando os últimos dois topos e dois fundos são ascendentes; baixa quando são descendentes; caso contrário, indefinida.
- **Inclinação da média**: (MA[t] − MA[t−5\*]) ÷ ATR14, classificada como acentuada, suave, plana (módulo abaixo de 0,15\*) ou virando.
- **Média virou para cima**: MA[t] > MA[t−1] e MA[t−1] ≤ MA[t−2]. Para baixo: espelhado.
- **Inside bar**: máxima menor que a máxima anterior e mínima maior que a mínima anterior.
- **Candle de força (alta)**: corpo ≥ 1,5\* vez a média dos corpos dos últimos 20 candles, com fechamento no quarto superior da amplitude.
- **Barra de ignição**: corpo ≥ 2\* vezes a média e sombra superior ≤ 10%\* da amplitude.
- **Martelo**: sombra inferior ≥ 2\* vezes o corpo, sombra superior ≤ 25%\* da amplitude e corpo no terço superior.
- **Doji**: corpo ≤ 10%\* da amplitude.
- **Volume**:
  - "acima da média": volume maior que a média de 21;
  - "muito acima": ≥ 1,5\* vez a média;
  - "estrondoso": ≥ 2\* vezes a média;
  - "secando": média do volume no trecho menor que a média de 21 anterior, com inclinação negativa.
- **Rompimento válido**: por **fechamento** além do nível. Pavio não conta (configurável).
- **Falso rompimento**: rompe por fechamento e, em até 2\* candles, volta a fechar dentro da região.

### 8.2 Setup 9.1 de compra (atribuído a Larry Williams)

- Usa a média móvel **exponencial** de 9, obrigatoriamente.
- **Condição**: a MME9 vinha caindo e **vira para cima**. O candle que a virou é o **candle-sinal**.
- **Gatilho**: rompimento da máxima do candle-sinal mais 1 tick.
- *Decisão nossa, não do vídeo*: se o gatilho não for rompido no candle seguinte e a MME9 continuar subindo, o gatilho passa para a máxima do novo candle. Se a MME9 virar para baixo antes do acionamento, o setup é cancelado.
- **Saída fixa**: stop 1 tick abaixo da mínima do candle-sinal (alternativa: abaixo do fundo anterior) e alvo em 2R (alternativa: 3R).
- **Saída dinâmica**: sem alvo. Quando a MME9 virar para baixo, o stop vai para 1 tick abaixo da mínima do candle que a virou, e a saída ocorre se essa mínima for perdida.
- *Decisão nossa*: o vídeo sugere operar sem stop na versão dinâmica. O Radar sempre mantém um stop de proteção inicial na mínima do candle-sinal, salvo confirmação explícita do usuário.
- **Filtro de contexto**: só comprar com a MMA50 apontando para cima. O youtuber afirma que esse filtro "muda tudo", mas não mostrou números. Implemente com filtro ligado e desligado para o Experimento E1.
- Não operar em mercado lateral (ADX < 20\* ou MMA50 plana).
- Versão de venda: espelhada, marcada como "espelhada — não descrita nos vídeos".

### 8.3 Setup 9.2 de compra

- MME9 apontando para cima, com fechamentos crescentes.
- **Candle de referência**: o de maior fechamento da pernada; atualiza a cada novo fechamento maior.
- **Armado**: um candle **fecha abaixo da mínima** do candle de referência, com a MME9 ainda para cima.
- **Gatilho**: máxima do candle que armou mais 1 tick. Se não for rompida, o gatilho passa para a máxima do próximo candle da correção, repetidamente, enquanto a MME9 seguir para cima.
- **Stop**: 1 tick abaixo da menor mínima da correção. **Alvo**: 2R ou 3R.
- **Desarme**: a MME9 aponta para baixo durante a correção.
- Recomendação do youtuber: usar no semanal e no mensal (ele diz que no diário e no 60m funciona mal). Teste isso no Experimento E3.

### 8.4 Setup 9.3 de compra

- Mesmo filtro e mesmo candle de referência do 9.2.
- **Armado**: **dois fechamentos abaixo do fechamento** do candle de referência. Não precisa fechar abaixo da mínima.
- *Lacuna*: o vídeo não diz se os dois fechamentos precisam ser consecutivos. Padrão: consecutivos, com parâmetro para aceitar não consecutivos.
- Gatilho, deslocamento do gatilho, stop, alvo e desarme: como no 9.2.

### 8.5 Recuo à média (pullback) — setup 1 do youtuber

- **Pré-requisito**: tendência de alta estabelecida (estrutura ascendente, médias para cima e escala maior a favor). Sem isso, não existe setup.
- **Região do recuo**: MME9 em tendências muito fortes, MME21 no caso mais comum, MMA50 em correções mais profundas. Use a média que o ativo "respeita" (seção 9).
- **Sinais de recuo saudável** (pontuam a favor):
  - volume secando durante o recuo;
  - candles do recuo menores que os da alta anterior (amplitude média abaixo de 0,7\* vez a do impulso);
  - fundo anterior preservado.
- **Sinais de alerta** (impedem ou rebaixam o setup):
  - queda com volume ≥ 1,5\* vez a média;
  - barra de força de baixa;
  - perda do fundo anterior.
- **Tocar a média NÃO é sinal.** O gatilho vem depois do fechamento do candle, por um destes: candle de força de alta na região da média, martelo, inside bar perto das médias ou rompimento da máxima do candle anterior. Volume crescente no gatilho pontua mais.
- **Stop**: abaixo da mínima do candle-gatilho ou da mínima do recuo, o que fizer mais sentido estrutural (parâmetro).
- **Alvos**:
  - rompimento do topo anterior;
  - parcial em 2R e final em 3R;
  - condução com stop móvel (Stop ATR ou perda da MME9).
- **Invalidação**: perda do fundo do recuo; a média usada vira para baixo e é perdida; a escala maior muda de direção.
- Uso: semanal (position) ou diário (swing), com refinamento da entrada na escala menor.

### 8.6 Rompimento de consolidação apertada — setup 2 do youtuber (o favorito dele)

- **Pré-requisito**: tendência de alta antes da consolidação.
- **Consolidação apertada**:
  - mínimo de 8\* e máximo de 40\* candles;
  - amplitude da caixa ≤ 3\* vezes o ATR14 medido antes da caixa (alternativa: até X% do preço);
  - contração de volatilidade: largura das Bandas de Bollinger 20/2 no menor quintil\* dos últimos 120 candles, ou ATR5/ATR20 caindo;
  - volume da caixa abaixo da média anterior.
- **Gatilho**: **fechamento** acima do topo da caixa, com volume ≥ 1,5\* vez a média (no exemplo do vídeo era "estrondoso") e candle de rompimento com corpo grande em relação aos anteriores.
- **Stop**: abaixo da base da caixa ou da mínima do candle de rompimento (parâmetro).
- **Segunda entrada (reteste)**: o preço volta ao topo rompido, não fecha de volta dentro da caixa e retoma a alta. O stop fica mais curto.
- **Falso rompimento**: voltar a fechar dentro da caixa gera alerta; perder a base gera saída.
- **Alvos**: 2R ou 3R, ou condução (saída quando a MME9 vira para baixo e a mínima é perdida, como no exemplo do vídeo).

### 8.7 "Elástico": reversão à média com Bollinger de 3 desvios

Adaptação do youtuber para a lógica atribuída a Takashi Kotegawa (que, segundo o vídeo, media a distância do preço até a média de 25 períodos).

- Bandas de Bollinger de 20 períodos e 3 desvios.
- **Radar (compra)**: um candle **fecha abaixo** da banda inferior. Encostar ou furar com pavio não conta. **Ainda não é compra.**
- **Gatilho**: rompimento da máxima do candle que fechou fora. Se não romper, o gatilho passa para a máxima do candle seguinte, como no vídeo, até uma destas situações: acionar; o preço voltar à média central sem acionar (cancela); expirar em N = 5\* candles.
- Confirmação adicional opcional: martelo ou candle de força.
- **Stop**: além do extremo do candle que fechou fora (na compra, abaixo da mínima).
- **Alvo**: média central (MMA20), com parcial opcional em 1R.
- **Venda**: espelhada, com fechamento acima da banda superior.
- **Uso**: diário preferido. Intradiário (5 a 30 min, ex.: mini-índice) permitido, com aviso de taxa de acerto menor e custos maiores.
- **Atenção**: esta estratégia opera **contra o movimento** e conflita com a regra "nunca opere contra a tendência" dos outros vídeos. Mantenha-a separada, com estatísticas próprias.

### 8.8 Reflexividade: distorção entre preço e valor (inspirada em George Soros)

- **Radar (distorção)**:
  - queda ≥ 50%\* desde o topo de 52 semanas (ou o topo histórico, como parâmetro);
  - MME21 e MMA50 semanais descendo;
  - fundamentos fortes: crescimento do lucro por ação nos últimos 2 anos ≥ 20%\* ao ano e receita sem queda (fonte: SEC EDGAR ou CVM).
- **Proibido comprar durante a queda** ("faca caindo").
- **Confirmação no semanal**: pivô de alta, com MME9 e MME21 voltando a apontar para cima e o preço apoiado nelas ou rompendo resistência.
- **Entrada em etapas**: primeira parte no primeiro pivô, aumento no segundo rompimento, **sempre dentro do limite de risco por trade**. O "vai na jugular" do vídeo é incompatível com a regra de 1 a 2% de risco, e o Radar avisa se o plano ultrapassar o limite.
- **Aviso permanente**: os exemplos do vídeo (Netflix, Meta, AppLovin, Palantir) foram escolhidos depois do fato. Empresas que caíram e nunca se recuperaram, ou saíram da bolsa, não aparecem: viés de sobrevivência.

---

## 9. Contexto, qualificação de tendência e visão fractal

Painel "Contexto" para o ativo, em cada escala:

- **Tendência**: alta, baixa ou lateral (estrutura + MMA50 + ADX).
- **Força pelo ADX**:
  - abaixo de 20: lateral, não operar setups de tendência;
  - de 20 a 25: zona cinzenta;
  - acima de 25: tendência;
  - acima de 40: tendência muito forte.
- **Alinhamento**: preço > MME9 > MME21 > MMA50 (e o inverso na baixa).
- **Média respeitada**: nos últimos 3 a 5 recuos, qual média (9, 21, 50, 100 ou 200) segurou o preço — mínima a até 0,5\* ATR da média e fechamento acima dela. Exemplo de exibição: "respeita a MME21 (4 de 5 recuos)".
- **Inclinação** das médias principais.
- **Maturidade**, heurística rotulada como "experimental":
  - jovem: MMA50 virou para cima há poucos candles e rompeu resistência relevante;
  - madura: médias alinhadas há bastante tempo;
  - cansada: médias achatando, volume menor nas altas e maior nas correções, distância grande da MMA200 em múltiplos de ATR.
- **Vento a favor ou contra**: comparação com a escala maior. A regra mestra do youtuber é que a escala maior manda. Um setup de compra na escala menor contra tendência de baixa na maior gera **aviso vermelho** no painel e no plano de trade.
- Cada item mostra o "porquê" ao ser tocado: quais candles e médias levaram à conclusão.

---

## 10. Alertas e notificações

- **Tipos de alerta**:
  - preço cruzando para cima ou para baixo;
  - entrada ou saída de uma zona desenhada;
  - cruzamento de linha de tendência desenhada;
  - condição de indicador (ex.: MME9 virou, fechamento fora da banda de 3 desvios, ADX acima de 25);
  - eventos de setup (radar, armado, acionado, desarmado);
  - stop e alvo de planos ativos;
  - avisos do sistema (fonte de dados caiu, agente MT5 desconectado).
- **Avaliação no servidor**, 24 horas, de acordo com o horário de cada mercado. Cada alerta escolhe entre "no toque (intrabar)" e "no fechamento do candle". Para setups, o padrão é o fechamento.
- **Canais**:
  - Web Push (PWA no iPhone e no desktop, com chaves VAPID);
  - Telegram (bot do próprio usuário);
  - e-mail (SMTP configurável).
- Cada alerta escolhe os canais. Há botão "enviar teste" por canal, anti-duplicação, horário de silêncio e histórico de disparos.
- A mensagem é curta e útil: ativo, escala, o que aconteceu, preço e link direto para o gráfico no estado certo.
- **iPhone**: o push só funciona com o app instalado na tela de início (iOS 16.4 ou superior) e com a permissão pedida a partir de um toque do usuário dentro do app instalado. Crie uma tela guiada para isso.

---

## 11. Gestão de risco, plano de trade e checklist

- **Calculadora de posição**:
  - entradas: capital, risco % por trade, preço de entrada e stop técnico;
  - risco padrão de **1%**, com aviso acima de 2% e limite máximo configurável (os vídeos divergem: 1 a 2% num, até 3% em outro);
  - saídas: quantidade, valor alocado, perda máxima em R$, ganho no alvo em R$ e relação R:R;
  - regras por mercado: lote padrão de 100 e mercado fracionário na B3; contratos de mini-índice e mini-dólar (verificar valor do ponto, tick e custos atuais); lotes e pips no forex; casas decimais e lote mínimo em cripto.
- **Plano de trade**, preenchido antes de entrar. Só fica "Liberado" quando todos os itens estiverem completos:
  - ativo e setup;
  - escalas de contexto, setup e gatilho, e se estão alinhadas;
  - entrada;
  - stop técnico ("onde a tese morre");
  - alvos e parciais;
  - critério de saída;
  - tamanho da posição;
  - perda e ganho em R$;
  - motivo técnico em texto;
  - print do gráfico, anexado automaticamente.
- **Avisos automáticos**: R:R abaixo de 2; trade contra a escala maior; ADX abaixo de 20; risco acima do limite; volume que não confirma o rompimento.
- **Stop só anda a favor**: afastar o stop exige confirmação e fica registrado no diário como "stop movido para trás", que aparece nas estatísticas de disciplina.
- Breakeven e parciais são registrados.
- **Anti-revanche**: depois de X\* stops no dia ou Y\* na semana, o app recomenda uma pausa e sugere reduzir o tamanho. É configurável e nunca bloqueia de forma irreversível.
- **Checklist psicológico**, com base nos cinco erros dos vídeos: ego ("querer estar certo"), revanche, deixar lucro virar prejuízo, operar demais, entrar sem plano. Funciona como marcações rápidas no plano e no diário.

---

## 12. Backtest, laboratório e verificações

### 12.1 Motor

- Barra a barra, orientado a eventos, usando os mesmos detectores do app.
- Entradas por ordem stop: preenchimento no gatilho ou, se houver gap, na abertura (sempre o pior preço).
- Stop com gap contra: preenche na abertura. Alvo com gap a favor: preenche no alvo (conservador; abertura como opção).
- Candle que toca stop e alvo ao mesmo tempo: assumir **stop primeiro**, salvo quando houver dado de escala menor para resolver (opção).
- Custos por mercado, todos configuráveis e a verificar: corretagem, emolumentos e taxas, spread, slippage em ticks.
- Tamanho da posição pelo risco, usando a mesma calculadora da seção 11.
- **Impostos na B3**:
  - apuração mensal, com day trade e operações comuns separados;
  - prejuízos compensados só dentro da mesma modalidade;
  - isenção de vendas de ações até R$ 20 mil por mês apenas no swing;
  - IRRF e DARF mínimo.
- Cripto e forex: ver seção 15.
- **Benchmarks sempre**: CDI (série do BCB) e buy & hold do ativo ou índice no mesmo período.

### 12.2 Métricas

- número de trades, taxa de acerto, payoff, expectativa em R, fator de lucro;
- retorno total e anualizado;
- drawdown máximo e sua duração, maior sequência de perdas;
- exposição, tempo médio em trade, % de meses positivos;
- resultado **depois de custos e IR**, comparado com o CDI.

Gráficos: curva de capital, distribuição de R e resultados por mês, ano, ativo e escala.

### 12.3 Antiautoengano (obrigatório)

- **Amostra**: menos de 30 trades → "inconclusivo"; menos de 100 → "evidência fraca".
- **Fora da amostra**: separação cronológica entre treino e teste (70/30\*) e walk-forward. Um resultado só fica "aprovado" se for positivo no teste, depois de custos e IR, com pelo menos 30 trades fora da amostra e estabilidade na vizinhança dos parâmetros.
- **Mapa de sensibilidade**: varia parâmetros (ex.: período da média, alvo em R) e mostra se o bom resultado é um platô (robusto) ou um pico isolado (provável sorte).
- **Monte Carlo**: reamostragem da sequência de trades (10 mil\* vezes), gerando a distribuição de drawdown e a probabilidade de perder X% do capital com o risco escolhido.
- **Registro de tentativas**: todo backtest rodado fica salvo, e o app mostra "você testou N variações desta estratégia". Quanto mais variações, mais desconfiança do melhor resultado.
- **Viés de sobrevivência**: aviso quando o universo testado for a composição atual de um índice.
- Teste obrigatório: alterar candles futuros não pode mudar sinais passados.

### 12.4 Experimentos prontos: "Verificar o youtuber"

Painel com experimentos pré-configurados. Cada um mostra hipótese, método, resultado e limitações.

- **E1**: 9.1 sem filtro contra 9.1 com filtro "MMA50 subindo", em cerca de 20 ações líquidas do Ibovespa, no diário, em 10 anos. O youtuber afirma que sem filtro "não deu dinheiro" e com filtro "mudou completamente", sem mostrar números.
- **E2**: frequência com que o preço **fecha** fora da Bollinger 20/3 em cada ativo, comparada com a curva normal (cerca de 0,13% por lado), e em quantos casos o preço voltou à média em até N candles. Hipótese: caudas gordas — o "1 em 1000" do vídeo não vale no mercado.
- **E3**: 9.2 e 9.3 no semanal e mensal contra diário e 60m.
- **E4**: recuo à média com e sem os filtros de "recuo saudável" (volume secando, candles menores).
- **E5**: rompimento de consolidação com e sem exigência de volume ≥ 1,5 vez a média; e entrada no rompimento contra entrada no reteste.
- **E6**: a conta "40% de acerto com 1:2 dá lucro" depois de custos reais e IR, por mercado e por timeframe (day trade contra swing).
- **E7**: reflexividade — comprar a −50% contra esperar o pivô de alta no semanal. Limitação explícita: sem dados de empresas que saíram da bolsa, o resultado é otimista.

---

## 13. Modo Treino: aprender sem dinheiro real

Pedido explícito do usuário: ele quer aprender o processo **sem gastar dinheiro real**. O Modo Treino é uma parte central do produto, não um extra.

**Funcionamento geral**
- Chave global **Treino / Real**, sempre visível no topo. No Treino, uma faixa de cor própria indica "MODO TREINO — dinheiro fictício".
- **Ligado por padrão no primeiro uso.** Mudar para Real exige confirmação e mostra o Painel de prontidão (abaixo).
- No modo Real, o Radar continua sem enviar ordens: os trades reais são registrados no diário a partir do que o usuário executou na corretora.

**Conta fictícia**
- Saldo inicial configurável (padrão: R$ 10.000), com reinício a qualquer momento sem apagar o histórico.
- Conversão de moeda para ativos em dólar, com a cotação usada exibida.
- Várias contas de treino possíveis (ex.: uma por estratégia).

**Ordens simuladas realistas**
- Tipos: a mercado, limitada, stop de entrada, stop loss, alvo, parciais e stop móvel.
- Preenchimento pelo mesmo modelo do backtest (seção 12.1): slippage, spread, gaps e custos.
- Stop e alvo executados automaticamente pelo servidor, mesmo com o app fechado.
- Posições abertas, resultado em R$ e em R, e IR simulado conforme a seção 15.
- **O resultado do treino não pode parecer melhor do que seria no real**: sem preenchimento perfeito, sem custo zero.

**Três formas de treinar**
1. **Ao vivo (paper trading)**: dados reais em tempo real, ordens fictícias. Os alertas funcionam igual, marcados como "treino".
2. **Replay**: o usuário escolhe uma data, o futuro fica escondido e ele avança candle a candle (botão, teclado ou toque), com desenhos, indicadores e detectores funcionando como ao vivo. Opção de ativo e data sorteados, para ele não "lembrar" o que aconteceu.
3. **Exercícios de leitura**: o app mostra uma situação real do passado e pergunta, por exemplo: "Tem setup aqui? Qual? Onde fica o gatilho? Onde fica o stop? A escala maior está a favor?". Depois revela a resposta do detector e o que o preço fez em seguida. Os exercícios são gerados a partir dos detectores da seção 8, com dificuldade crescente.

**Trilha de aprendizado**
- Sequência de módulos ligados à Biblioteca. Exemplo: ler candles → suporte e resistência como zonas → médias e tendência → visão em 3 escalas → recuo à média → consolidação → 9.1/9.2/9.3 → elástico → gestão de risco → psicologia.
- Cada módulo tem uma explicação curta, exercícios de leitura e uma missão de replay. Exemplo: "Faça 10 trades de recuo à média no replay, sempre com plano completo".
- Progresso salvo e visível.

**Feedback depois de cada trade de treino**
- Seguiu o plano? Entrou com gatilho ou só porque "tocou a média"? Estava a favor da escala maior? O risco ficou dentro do limite? Moveu o stop para trás? Realizou o lucro cedo demais?
- Resultado em R e comparação com o que o setup "puro" teria feito.
- O assistente com IA (seção 16), se ativado, pode comentar o trade de forma crítica.

**Painel de prontidão**
Mostra, com honestidade, se os números do treino justificam arriscar dinheiro real. Critérios heurísticos e configuráveis — deixe claro na tela que são uma régua nossa, não uma garantia:
- pelo menos 100 trades de treino (replay + ao vivo), com pelo menos 30 ao vivo;
- expectativa positiva depois de custos e IR, comparada ao CDI do período;
- disciplina de pelo menos 90%: trades com plano completo, sem stop movido para trás, risco dentro do limite;
- drawdown máximo dentro do limite que o usuário definiu.

O painel nunca bloqueia o modo Real. Ele apenas mostra o que falta e por quê.

**Estatísticas**
Treino ao vivo, replay e real ficam separados e comparáveis lado a lado. Uma diferença grande entre treino e real costuma indicar um problema emocional ou de execução, e o app aponta isso.

---

## 14. Scanner multi-mercado

- Roda no servidor: depois do fechamento diário de cada mercado e, para a watchlist, a cada fechamento de candle intradiário.
- Universo configurável (watchlists, componentes de índices). Varrer o "mercado inteiro" depende dos limites das APIs gratuitas: verifique e documente o que é viável.
- **Filtros combináveis**: setup em determinado estado, tendência, ADX, média respeitada, inclinação das médias por escala, queda desde o topo, volume relativo e fundamentos (crescimento de lucro por ação e receita).
- **Filtro pronto "Distorção (reflexividade)"**: MME21 semanal descendo, MMA50 semanal descendo, lucro por ação crescendo pelo menos 20% ao ano nos últimos 2 anos e queda de pelo menos 50%.
- Resultado em tabela ordenável e em cartões com mini-gráfico. Tocar no ativo abre o modo 3 escalas.

---

## 15. Contexto Brasil

Estado verificado em 11/10/2026. Reverifique periodicamente e registre em `DATA_SOURCES.md`.

- **Selic e CDI atuais** (API do BCB), exibidos no painel e usados como benchmark.
- **IR em ações e futuros na B3** (vigente em 2026, após a rejeição da MP 1.303):
  - swing trade: 15% sobre o lucro líquido mensal;
  - day trade: 20%;
  - isenção para vendas de ações até R$ 20 mil por mês, só no swing (não vale para day trade, ETFs e FIIs);
  - IRRF de 0,005% sobre as vendas no swing e de 1% sobre o lucro no day trade;
  - DARF código 6015;
  - prejuízos compensam só dentro da mesma modalidade.
  - Tudo parametrizado, com link para a fonte oficial.
- **Cripto**: as regras estão **em disputa em outubro de 2026**. As fontes divergem sobre a isenção de vendas até R$ 35 mil por mês em exchanges brasileiras e sobre o regime da Lei 14.754/2023 para ativos em exchanges estrangeiras. Implemente como regimes configuráveis, **desligados por padrão**, com o aviso "consulte um contador".
- **Forex**: pessoa física no Brasil costuma operar por corretoras estrangeiras não autorizadas pela CVM, o que traz risco de contraparte e tributação de ativos no exterior. O app mostra esse aviso na primeira vez que o usuário abre um par de moedas, e também na Biblioteca. Verifique a situação regulatória atual.
- **Apuração mensal da B3**: a partir do diário, calcula base, isenção, IRRF, imposto devido e DARF de cada mês, com o aviso de que não substitui um contador.

---

## 16. Biblioteca, ajuda e assistente

### Biblioteca (obrigatória, em PT-BR, escrita por você a partir deste documento)

- Uma página por setup (seção 8), por indicador e por conceito: teoria de Dow, leitura de candles, suporte e resistência como zonas e inversão de polaridade, volume, padrões gráficos, visão fractal, gestão de risco, psicologia, payoff, expectativa, R, drawdown e slippage.
- Cada página contém:
  - o que é;
  - **as regras exatas como implementadas no Radar**;
  - de onde veio (vídeo e autor);
  - quando falha;
  - lacunas e decisões nossas;
  - os resultados medidos no laboratório para os ativos do usuário, atualizados automaticamente;
  - críticas.
- Página **"Contradições entre as fontes"** (seção 22).
- Página **"Antes de arriscar dinheiro"**: estudo da FGV (Chague, De-Losso e Giovannetti, 2019) com day traders de mini-índice — cerca de 97% dos que persistiram por mais de 300 pregões perderam dinheiro. Inclui o custo de oportunidade do CDI e a recomendação de usar replay e paper trading primeiro.
- Botões "?" em todo o app levam à página certa. Tooltips nos indicadores e painéis.

### Assistente com IA (opcional, desligado por padrão)

- Usa a API da Anthropic com a chave do próprio usuário, guardada só no servidor. O uso é pago por consumo: mostre estimativa de custo e limite mensal configurável. Verifique na documentação atual da Anthropic os nomes de modelo vigentes; não fixe o nome no código.
- Recebe o contexto da tela (ativo, escalas, indicadores, setups detectados, plano em edição, estatísticas do laboratório) e responde em PT-BR.
- **Personalidade**: analista crítico e baseado em dados.
  - questiona as ideias do usuário e aponta pontos cegos, riscos, custos e custo de oportunidade;
  - compara com alternativas (ex.: CDI) e considera inflação, juros e impostos no Brasil;
  - diz claramente quando não há dados suficientes;
  - nunca afirma certeza sobre o futuro e não dá ordem de compra ou venda.

---

## 17. Contas, segurança e privacidade

- Login com e-mail e senha (hash argon2id), sessão por cookie seguro (HttpOnly, Secure, SameSite) e 2FA por TOTP opcional.
- Cadastro fechado após a primeira conta (modo de usuário único, com opção de convidar).
- Proteção contra força bruta, cabeçalhos de segurança e CSP, CORS restrito, validação de entrada com zod.
- Segredos em `.env`, com `.env.example` documentado. Chaves de terceiros criptografadas no banco.
- Backup automático diário do SQLite, com retenção, e exportação/importação completa (JSON) pela interface.
- Nenhum dado importante fica só no localStorage.

---

## 18. PWA, hospedagem e documentação para leigo

- **PWA**: manifest, ícones, service worker e tela de instalação guiada para iPhone (Safari → Compartilhar → Adicionar à Tela de Início) e desktop (Chrome ou Edge).
- **Hospedagem**: verifique as condições atuais de cada plano e registre.
  - **A**: VM gratuita sempre ligada (ex.: Oracle Cloud "Always Free"), de preferência em região no Brasil, por latência e por bloqueios regionais de exchanges. Atenção à falta de capacidade nas instâncias gratuitas.
  - **B**: VPS barata paga (pesquisar opções e preço atual).
  - **C**: servidor no próprio PC Windows do usuário, junto com o MT5, com túnel HTTPS (ex.: Cloudflare Tunnel; endereço fixo exige domínio próprio — verificar). Custo zero, mas só funciona com o PC ligado.
  - **D (degradado)**: front estático (ex.: GitHub Pages) com verificações agendadas (ex.: GitHub Actions), e alertas atrasados em minutos.
- **HTTPS é obrigatório**, porque o push exige. Avalie domínio gratuito (DNS dinâmico) contra domínio próprio barato.
- **Guias em `docs/`**, em PT-BR, para leigo e passo a passo:
  - `GUIA_INSTALACAO_LOCAL.md`
  - `GUIA_DEPLOY.md`
  - `GUIA_IPHONE.md`
  - `GUIA_TELEGRAM.md`
  - `GUIA_MT5.md`
  - `GUIA_BACKUP.md`
  - `FAQ.md`
- **CI no GitHub Actions**: lint, typecheck, testes e build.

---

## 19. Testes e critérios de qualidade

- **Indicadores**: compare com valores de referência calculados de forma independente (ex.: script de referência em Python/pandas, documentado), com tolerância definida. Cobrir MME, MMA, Bollinger, ATR, ADX/DI e Stop ATR.
- **Primitivas e setups**: para cada um, fixtures de candles feitas à mão com casos positivos, negativos e de borda. Exemplos:
  - "MME9 virou para baixo durante a correção desarma o 9.2";
  - "pavio fora da banda não arma o elástico";
  - "dois fechamentos não consecutivos no 9.3 não armam com o parâmetro padrão".
- **Sem look-ahead**: teste que altera candles futuros e confirma que os sinais passados não mudam.
- **Backtest**: casos com resultado calculado à mão — gaps, stop e alvo no mesmo candle, custos, isenção de R$ 20 mil e compensação de prejuízo.
- **Calculadora de posição** com os exemplos dos vídeos:
  - capital R$ 100.000, risco 2%, entrada R$ 50, stop R$ 47 → risco de R$ 2.000 e 666 ações (arredondar para baixo; com lote de 100: 600 no lote padrão + 66 no fracionário);
  - capital R$ 10.000, risco 3%, stop de 8% → R$ 300 de risco e R$ 3.750 alocados.
- **E2E (Playwright)**: login, abrir gráfico, trocar escala, desenhar uma linha e transformá-la em alerta, criar plano de trade, abrir um trade no Modo Treino e ver o stop ser executado, avançar um replay candle a candle, rodar um backtest, receber notificação de teste (canal simulado).
- **Modo Treino**: testes que garantem que o preenchimento simulado nunca é melhor que o modelo conservador do backtest (gaps, slippage, custos).
- **Desempenho**: 10 mil candles com rolagem fluida, tempo real sem travar e recálculo incremental de indicadores.
- **Celular**: tudo usável em 375 px de largura.

---

## 20. Fases e critérios de aceite

Cada fase termina com o app rodando, testes passando, roadmap atualizado e relatório ao usuário.

- **Fase 0 — Fundação**: monorepo, tooling, CI, docs iniciais, protótipo e decisão da biblioteca de gráficos, verificação das fontes de dados (`DATA_SOURCES.md` preenchido).
  *Pronto quando*: `pnpm dev` sobe web e servidor; CI verde; decisões registradas.
- **Fase 1 — Gráfico vivo**: cripto em tempo real, ações dos EUA e B3 atrasada; timeframes; indicadores padrão; modo 3 escalas; selo de fonte e atraso; PWA instalável.
  *Pronto quando*: BTC no 1m atualiza sozinho; um ativo dos EUA e um da B3 abrem no diário e no semanal; indicadores batem com a referência.
- **Fase 2 — Desenhos, contas e listas**: login, desenhos persistentes e sincronizados, watchlists e presets.
  *Pronto quando*: algo desenhado no PC aparece no celular.
- **Fase 3 — Setups e contexto**: primitivas, todos os detectores da seção 8, painel de contexto da seção 9, marcações no gráfico e Biblioteca inicial.
  *Pronto quando*: cada setup tem testes de fixture passando e aparece no gráfico com o "porquê".
- **Fase 4 — Alertas**: servidor de alertas, Web Push, Telegram, e-mail, alertas por desenho e por setup, histórico.
  *Pronto quando*: um alerta de preço chega no iPhone com o app instalado.
- **Fase 5 — Risco, plano, diário e Modo Treino ao vivo**: calculadora, plano e checklist, diário com estatísticas, painel Brasil (CDI e IR da B3), chave Treino/Real, conta fictícia e ordens simuladas com dados reais.
  *Pronto quando*: um trade planejado no Modo Treino é executado de forma simulada, com stop e alvo automáticos, e vira registro no diário com R, custos e efeito no IR do mês.
- **Fase 6 — Laboratório e treino completo**: backtest, métricas, antiautoengano, experimentos E1 a E7, replay, exercícios de leitura, trilha de aprendizado, feedback por trade e Painel de prontidão.
  *Pronto quando*: o E1 roda e mostra o resultado com CDI, custos, IR, tamanho da amostra e teste fora da amostra; e o usuário consegue fazer uma sessão de replay com ativo e data sorteados e receber feedback de cada trade.
- **Fase 7 — B3 e forex em tempo real, scanner e fundamentos**: agente MT5, forex, scanner e filtro de reflexividade.
  *Pronto quando*: o simulador do agente alimenta o app e o scanner retorna resultados reais da watchlist.
- **Fase 8 — Produção**: Docker, deploy guiado (plano A e alternativas), HTTPS, backups, revisão de segurança e guias completos.
  *Pronto quando*: o usuário consegue publicar seguindo apenas o guia.
- **Fase 9 — Assistente com IA** (opcional).

---

## 21. Relatório ao fim de cada sessão (em PT-BR, para leigo)

1. O que ficou pronto e como ver funcionando.
2. O que não funciona ou não foi testado, e por quê.
3. Fatos não verificados e riscos novos descobertos.
4. Perguntas para o usuário (só as necessárias).
5. Próximo passo.

---

## 22. Conhecimento de referência: resumo dos vídeos do canal "Trade de Valor", com críticas

Use esta seção para escrever a Biblioteca e calibrar o checklist. São afirmações do youtuber, **não fatos comprovados**.

**Teoria de Dow, segundo o vídeo.** Os preços se movem em tendências (alta, baixa, lateral). Há três níveis de tendência — primária, secundária e terciária —, que correspondem ao mensal, ao semanal e ao diário ou intradiário. O volume confirma a tendência. O preço desconta tudo. Uma tendência continua até que sinais técnicos mostrem o contrário.

**Escalas.** Quanto menor o tempo gráfico, mais ruído. A escala maior manda na menor. Sempre olhar três escalas: contexto, setup e gatilho.

**Candles.** Ler o corpo (força), as sombras (rejeição) e a posição do fechamento. Padrão de candle só vale em região relevante (suporte, resistência, média). Três perguntas: quem dominou, com que força e onde aconteceu.

**Suporte e resistência.** São zonas, não linhas. Quanto mais testes, mais forte. Resistência rompida tende a virar suporte, e vice-versa. Níveis de escalas maiores pesam mais. Confluência com médias reforça.

**Médias.** Exponenciais para períodos curtos (9, 21), aritméticas para longos (50, 200). Servem como filtro de tendência e como suporte ou resistência dinâmicos. O pullback à média é o setup clássico.

**Volume.** Sempre relativo à média. Confirma tendência (cresce nas altas, seca nas correções). Confirma rompimento (rompimento sem volume é suspeito). Volume extremo no fim de tendência longa indica possível exaustão. No forex, o volume é só o da corretora.

**Padrões gráficos.** São subjetivos e servem como confirmação, nunca sozinhos.
- Merecem atenção: bandeira e flâmula, retângulo, "xícara com alça", triângulos ascendente e descendente, topos e fundos duplos em regiões importantes.
- Evitar no início: ombro-cabeça-ombro, triângulo simétrico, cunhas e padrões raros.

**Indicadores que ele usa.** Médias e price action como base; ADX para medir força; ATR para stop e condução (Stop ATR). Diz não usar MACD, IFR, estocástico nem Fibonacci como base.

**Cinco regras operacionais.**
1. Nunca operar contra a tendência maior.
2. Apostar na continuidade, não na reversão.
3. Esperar o contexto ideal: escala maior a favor, tendência qualificada, ADX acima de 25, ponto técnico relevante e volume confirmando.
4. Refinar a entrada na escala menor.
5. Sair rápido quando errar e deixar o lucro correr.

**Risco.** Stop técnico definido antes da entrada e nunca movido contra o trade. Risco de 1 a 2% por trade (1% para iniciante). Alvo mínimo de 2R. Exemplo de expectativa: em 10 trades com 40% de acerto e relação 1:2, o resultado é positivo (sem considerar custos).

**Psicologia (cinco erros).** Querer estar certo, buscar revanche após uma perda, deixar lucro virar prejuízo, operar demais e entrar sem plano.

**Contradições e problemas** (mostrar na Biblioteca):
1. Risco máximo por trade: 1 a 2% num vídeo, até 3% em outro.
2. "Quem vai contra a tendência perde sempre", mas outro vídeo ensina o "elástico", que é reversão à média contra o movimento.
3. "Day trade é massacre estatístico", mas o elástico é demonstrado no mini-índice em 5 minutos.
4. O 9.1 puro não deu dinheiro no backtest do próprio youtuber; o filtro que "muda tudo" foi apresentado sem números.
5. "3 desvios = 1 em 1000" vale para a curva normal; retornos de mercado têm caudas gordas.
6. Exemplos escolhidos depois do fato; resultados de assinantes citados sem amostra completa.
7. "Vai na jugular" (posição gigante) contradiz a regra de 1 a 2% de risco.
8. Todos os vídeos vendem um serviço de assinatura: há conflito de interesse.
9. As histórias de "lendas" (Larry Williams, Kotegawa, Soros) são casos extremos, com viés de sobrevivência. Não são evidência de que o método funcione para a maioria das pessoas.
