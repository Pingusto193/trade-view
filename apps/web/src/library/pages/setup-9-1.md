---
titulo: Setup 9.1
categoria: setup
resumo: Compra quando a MME9 vira para cima, com gatilho na máxima do candle da virada. As regras exatas do Radar, as lacunas e por que desconfiar.
relacionados: medias-moveis, adx, setup-9-2, setup-9-3, primitivas-price-action, r-multiplo, slippage-e-custos, contradicoes-entre-as-fontes
---

## O que é

O 9.1 é um **setup**: uma receita com regras fixas de quando entrar e quando sair de uma operação. Ele usa uma única linha, a **MME9** (média móvel exponencial dos últimos 9 fechamentos; veja [Médias móveis](/biblioteca/medias-moveis)).

A ideia é simples: quando a MME9, que vinha caindo, **vira para cima**, o preço pode estar retomando a alta. O candle em que a virada acontece se chama **candle-sinal**. O setup só "compra" se o preço passar da máxima desse candle.

O Radar **não envia ordens**. "Comprar" e "entrar" aqui querem dizer que o Radar marca no gráfico, avisa (se você criou um alerta) e simula a operação no laboratório.

> Nenhum setup garante lucro. O próprio vídeo que apresenta o 9.1 afirma que a versão sem filtro não deu dinheiro no teste do youtuber. Leia as críticas no fim da página.

## Regras exatas no Radar

Estas são as regras como estão no código hoje. Tudo é conferido com o candle **fechado**; o candle em formação nunca gera sinal.

Os números são os **valores padrão**. Cada um é um parâmetro do setup, guardado nas suas preferências (a tela para editar os parâmetros dos setups ainda não existe). Cada evento do painel de Setups mostra, em "Parâmetros usados", com quais valores foi calculado. O laboratório usa sempre os valores padrão. Os números que a especificação marca como arbitrários precisam ser calibrados sem sobreajuste; hoje o mapa de sensibilidade do laboratório varia só o alvo em R.

**Tick** é o menor passo de preço do ativo. "1 tick acima" é o preço mais esse passo, arredondado para a grade de ticks.

### 1. O sinal

- A MME9 **virou para cima** no candle que acabou de fechar: a MME9 deste candle é maior que a do candle anterior, e a do anterior era menor ou igual à do candle antes dele.
- Um detalhe da conta: a MME9 sobe num candle quando o fechamento fica **acima do valor que a MME9 tinha no candle anterior**.
- A média é sempre a exponencial de 9. Ela não é um parâmetro.

### 2. Os filtros (conferidos só no candle-sinal)

| Filtro | Regra | Padrão |
|---|---|---|
| Tendência (`trendFilter`) | MMA50 deste candle maior que a do candle anterior | ligado |
| Mercado lateral (`lateralFilter`) | ADX de 14 maior ou igual a 20 **e** MMA50 não plana | ligado; ADX mínimo 20 (`adxMin`) |

- **MMA50** é a média aritmética (simples) dos últimos 50 fechamentos. **ADX** mede a força da tendência (veja [ADX](/biblioteca/adx)).
- **MMA50 plana**: a inclinação dela em 5 candles, medida em ATR14, fica abaixo de 0,15 em tamanho (ignorando se é para cima ou para baixo). ATR14 é a amplitude média dos últimos 14 candles (veja [ATR](/biblioteca/atr-e-stop-atr)). O 5 e o 0,15 são parâmetros gerais do Radar, os mesmos do painel de contexto.
- Os dois filtros são independentes. Desligar só o de tendência dá o "9.1 puro" do Experimento E1; o filtro de lateral continua valendo.
- Com os dois filtros ligados, o 9.1 só pode aparecer a partir do 55º candle do histórico carregado: a MMA50 precisa de 50 candles e a inclinação, de mais 5.

### 3. Armado: gatilho e stop

O 9.1 não passa pelo estado "radar": se o sinal e os filtros estão ok, ele já nasce **armado** no próprio candle-sinal.

- **Gatilho** (o preço que dispara a compra): máxima do candle-sinal + 1 tick.
- **Stop** (o preço de saída se der errado), escolhido em `stopMode`:
- "Mínima do sinal" (padrão): mínima do candle-sinal − 1 tick.
- "Fundo anterior": o mais baixo entre a mínima do candle-sinal e o último fundo confirmado do gráfico, sempre − 1 tick. O fundo é o da regra de topos e fundos das [Primitivas de price action](/biblioteca/primitivas-price-action).

### 4. Enquanto espera o rompimento

A partir do candle seguinte ao sinal, em cada candle fechado, nesta ordem:

1. Se a máxima do candle alcançou o gatilho, a compra acontece (item 5).
2. Se não alcançou e a MME9 **caiu** (ficou menor que no candle anterior), o setup é **desarmado**.
3. Se não alcançou e a MME9 não caiu (subiu ou ficou igual), o gatilho passa para a **máxima deste candle + 1 tick**. Como o candle não chegou ao gatilho antigo, o novo nunca fica acima dele. O stop pode descer para 1 tick abaixo da menor mínima desde o candle-sinal; ele nunca sobe nessa fase.

Esse deslocamento do gatilho (`trailTrigger`, ligado por padrão) é uma decisão nossa, prevista na especificação. Ele se repete sem limite de candles, até a compra ou o desarme. Desligado, o gatilho fica parado na máxima do candle-sinal.

### 5. A entrada

- É uma **ordem stop**: basta a máxima tocar o gatilho durante o candle; não precisa fechar acima.
- Se o candle já abrir acima do gatilho (um **gap**, salto de preço entre um candle e outro), a compra é registrada na abertura, que é o pior preço.

### 6. A saída

**Saída fixa (padrão):**

- **Alvo** = entrada + 2 × (entrada − stop). Isso é "alvo de 2R": R é o risco por ação, a distância entre a entrada e o stop (veja [R-múltiplo](/biblioteca/r-multiplo)). O 2 é o parâmetro `exit.targetR`; a especificação cita 3R como alternativa.
- O alvo é calculado a partir do preço real de entrada. Se houve gap, o risco e o alvo ficam maiores. O alvo é arredondado ao tick.

**Saída dinâmica (opcional):**

- Não há alvo. Quando a MME9 **vira para baixo**, o stop sobe para 1 tick abaixo da mínima do candle da virada. Ele só sobe; se esse novo preço for mais baixo que o stop atual, nada muda.
- Isso vale também se a virada acontecer no próprio candle da entrada. O stop novo vale a partir do candle seguinte.
- A saída acontece quando o preço **toca** esse stop durante o candle; não espera fechar abaixo. O encerramento aparece como "saída dinâmica" quando o stop já tinha sido movido.
- O stop de proteção inicial existe sempre.

**Como o Radar decide o preço de saída** (o mesmo modelo no painel, nos alertas e no laboratório):

- Stop com gap contra (o candle abre abaixo do stop): sai na abertura, com perda maior que 1R.
- Alvo com gap a favor: sai no alvo, e não na abertura melhor (conservador).
- Stop e alvo tocados no mesmo candle: conta **stop**, porque o gráfico não mostra qual veio primeiro.
- No candle da entrada só o stop é conferido. Se a mínima desse candle tocar o stop, conta stop, mesmo que a mínima possa ter acontecido antes da compra. O alvo só é conferido do candle seguinte em diante.

O resultado em R é (preço de saída − entrada) ÷ (entrada − stop inicial). O painel de Setups mostra esse R **sem custos**; custos e imposto entram só no laboratório.

### 7. Outras regras

- **Uma ocorrência por vez**: enquanto houver um 9.1 armado ou em andamento no ativo, novas viradas da MME9 são ignoradas.
- **Venda**: desligada por padrão (`allowSell`). Ligada, é o espelho da compra e aparece marcada "Venda espelhada — não descrita nos vídeos".
- **Escala maior**: se a escala maior estiver em baixa, os eventos de compra "armado" e "acionado" ganham o **aviso vermelho** "contra a escala maior" (veja [Visão fractal](/biblioteca/visao-fractal)). O aviso não bloqueia o setup.

### Exemplo hipotético

Supondo, só para o exemplo, um tick de R$ 0,01. Filtros ok, saída fixa em 2R.

1. **Candle-sinal**: a MME9 vira para cima. Máxima R$ 20,50; mínima R$ 19,90. Gatilho R$ 20,51; stop R$ 19,89.
2. **Candle seguinte**: máxima R$ 20,40 (não chegou ao gatilho), mínima R$ 19,95, MME9 subiu de novo. O gatilho passa para R$ 20,41. A menor mínima desde o sinal continua R$ 19,90, então o stop fica em R$ 19,89.
3. **Próximo candle**: abre em R$ 20,38 e sobe até R$ 20,70, sem chegar perto do stop. Compra em R$ 20,41. Risco = 20,41 − 19,89 = R$ 0,52. Alvo = 20,41 + 2 × 0,52 = **R$ 21,45**.

Se esse último candle tivesse aberto em R$ 20,60 (gap acima do gatilho), a compra seria em R$ 20,60, o risco R$ 0,71 e o alvo 20,60 + 1,42 = R$ 22,02.

## De onde veio

O vídeo atribui o 9.1 a Larry Williams. As regras acima partem do que a especificação do Radar registrou a partir do vídeo: MME9 obrigatoriamente exponencial, gatilho na máxima do candle-sinal mais 1 tick, stop 1 tick abaixo da mínima, alvo de 2R ou 3R, uma versão dinâmica sem alvo e o filtro "MMA50 apontando para cima".

Segundo o vídeo, a versão dinâmica pode ser operada sem stop. O Radar não aceita isso. A versão original do autor não foi conferida em fonte registrada no projeto; esta página descreve o 9.1 **do Radar**.

## Quando falha

- **Mercado lateral**: a MME9 vira para cima e para baixo o tempo todo, e cada virada parece um setup novo. O filtro de lateral ajuda, mas o ADX é lento e reage tarde.
- **Virada mínima também conta**: não há tamanho mínimo. Se a MME9 subir um centavo, é uma virada.
- **Gatilho deslocado por muitos candles**: o setup pode ficar armado por bastante tempo. Como os filtros só são conferidos no candle-sinal, a compra pode acontecer quando a MMA50 ou o ADX já não passariam.
- **Stop curto, custos grandes**: a mínima do candle-sinal costuma ficar perto do gatilho. Com risco pequeno por ação, custos e derrapagem pesam muito em R. Exemplo hipotético: risco de R$ 0,30 por ação e custos de R$ 0,03 por ação (ida e volta) tiram 0,1R de cada operação. Veja [Slippage e custos](/biblioteca/slippage-e-custos).
- **Candle amplo na entrada**: um candle que passa do gatilho e também toca o stop conta como perda no Radar, pela regra conservadora.
- **Gaps**: um gap abaixo do stop faz a perda passar de 1R.
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento parece um tombo do preço e pode criar viradas da MME9 que não aconteceram de verdade.

## Lacunas e decisões nossas

O vídeo deixa pontos em aberto. Onde não havia regra, o Radar escolheu uma, e ela vale para todos os números que o Radar mostrar.

- **Deslocamento do gatilho**: decisão nossa, prevista na especificação. Repete a cada candle, sem limite. "A MME9 continuar subindo" inclui a MME9 parada (igual à do candle anterior). O stop desce junto com a menor mínima desde o sinal e nunca sobe antes da entrada.
- **Filtros só no candle-sinal**: depois que armou, o 9.1 não confere de novo a MMA50 nem o ADX.
- **"MMA50 apontando para cima"** = maior que no candle anterior (um candle só). Consequência: uma MMA50 que caiu nos últimos 5 candles e subiu só no último passa nos dois filtros, porque o de lateral mede o tamanho da inclinação sem olhar o sinal.
- **"Não operar em lateral"** virou um filtro separado do filtro de tendência, para que o Experimento E1 compare só o efeito da MMA50.
- **"Fundo anterior"** = o último fundo confirmado pelo fractal (2 candles de cada lado), sem limite de idade. Se ele estiver acima da mínima do candle-sinal, vale a mínima do sinal.
- **"Perder a mínima" na saída dinâmica** = tocar 1 tick abaixo dela durante o candle (ordem stop), e não fechar abaixo dela.
- **Sempre com stop**: a especificação admite operar sem stop na versão dinâmica com confirmação explícita sua. O Radar ainda não oferece essa opção.
- **Gatilho por toque**: a regra "rompimento só vale por fechamento" das primitivas não se aplica ao 9.1. O gatilho é uma ordem stop.
- **1 tick**: preço ± 1 tick, arredondado ao tick mais próximo. Em preços fora da grade de ticks (históricos ajustados ou dados simulados), a distância real fica entre meio e um tick e meio.
- **Candle da entrada**: só o stop é conferido, e conta mesmo que a mínima tenha vindo antes da compra. É uma escolha conservadora nossa; o gráfico não mostra a ordem dos preços dentro do candle.
- **Alvo arredondado**: calculado sobre a entrada real e arredondado ao tick; o resultado pode sair 1,99R em vez de 2R exatos.
- **Uma ocorrência por vez**, **sem estado "radar"**, e o cancelamento antes da compra aparece como "desarmado" (a especificação diz "cancelado").
- **Venda espelhada**: não descrita nos vídeos; desligada por padrão.

## Resultados no laboratório
[[laboratorio]]

O botão acima abre o laboratório já com o 9.1. Lá você escolhe o ativo e o tempo gráfico, e o teste roda com os candles reais da fonte, os custos padrão do mercado, o imposto de renda simulado (só na B3), só compras e os valores padrão desta página. O resultado aparece ao lado do CDI e do comprar-e-segurar no mesmo período, separado em treino (70% iniciais) e teste (30% finais), com mapa de sensibilidade do alvo em R, walk-forward e Monte Carlo.

Para a afirmação do vídeo sobre o filtro, existe o **Experimento E1** (Laboratório → Experimentos): ele roda o 9.1 com e sem o filtro "MMA50 subindo", no gráfico diário, em cerca de 10 anos de cada ativo de uma lista sugerida de 20 ações da B3 (editável; composição e liquidez não verificadas 🟡). O filtro de lateral fica ligado nas duas versões. O E1 compara a expectativa em R depois dos custos, sem IR e sem CDI.

Nada nesta página é resultado medido: os números dependem do ativo, do período e da fonte.

## Críticas

- **Nem a fonte defende o 9.1 puro.** O vídeo afirma que o 9.1 sem filtro "não deu dinheiro" no backtest do próprio youtuber, e que o filtro "MMA50 subindo" "muda tudo" — mas não mostrou números. Ou seja: a versão sem filtro falhou pela própria fonte, e a versão com filtro não tem evidência pública.
- **Filtro escolhido depois do fato.** Se o filtro foi escolhido depois de ver a versão pura perder, ele pode só estar ajustado ao passado. Isso se chama sobreajuste. Só um teste em dados que não foram usados para escolher o filtro (fora da amostra) responde.
- **Exemplos escolhidos a dedo.** Num gráfico pronto, é fácil mostrar as viradas que deram certo e esquecer as outras. O Radar marca todas.
- **Muitas variações.** Stop no sinal ou no fundo, alvo 2R ou 3R, saída fixa ou dinâmica, filtros ligados ou desligados: testar tudo e ficar com o melhor é se enganar. O laboratório registra cada teste e mostra quantas vezes você já testou o mesmo ativo com os mesmos setups.
- **Lendas e viés de sobrevivência.** Histórias de traders famosos são casos extremos. Elas não mostram que o método funciona para a maioria das pessoas.
- **Conflito de interesse.** Os vídeos vendem um serviço de assinatura.
- **Custos, imposto e CDI.** Um setup com muitas operações e stop curto sofre muito com custos. Qualquer resultado precisa vir depois de custos e IR e ser comparado com o CDI do mesmo período. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **É o 9.1 do Radar.** O deslocamento do gatilho e o modelo conservador de execução são escolhas nossas. Um número medido aqui vale para esta versão, não necessariamente para a do vídeo.
