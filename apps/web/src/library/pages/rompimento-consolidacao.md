---
titulo: Rompimento de consolidação
categoria: setup
resumo: Compra quando o preço fecha acima de uma caixa apertada, depois de uma alta, com volume e corpo grandes. O setup favorito do vídeo, regra por regra.
relacionados: primitivas-price-action, volume, bandas-de-bollinger, atr-e-stop-atr, suporte-e-resistencia, padroes-graficos, r-multiplo, slippage-e-custos
---

## O que é

Uma **consolidação** é um trecho em que o preço para de subir e anda de lado, numa faixa estreita. O Radar desenha essa faixa como uma **caixa**: o **topo** é a maior máxima dos candles da caixa e a **base** é a menor mínima.

A ideia do setup: depois de uma alta, o preço "respira" com pouca oscilação e pouco volume. Quando ele sai da caixa **por cima**, com um candle forte e volume alto, a alta pode continuar. É o "setup 2" do youtuber, apresentado como o favorito dele.

O Radar procura este setup **só na compra**. "Comprar" aqui quer dizer que o Radar marca no gráfico, avisa (se você criou um alerta) e simula a operação no laboratório. O Radar **não envia ordens**.

> Nenhum setup garante lucro. A preferência do youtuber por este setup é uma afirmação do vídeo, sem números públicos que a sustentem. Leia as críticas no fim da página.

## Regras exatas no Radar

Estas são as regras como estão no código hoje. Tudo é conferido com o candle **fechado**; o candle em formação nunca gera sinal.

Os números são os **valores padrão**. Cada um é um parâmetro do setup e pode ser mudado, mas a tela para editar os parâmetros dos setups ainda não existe. Cada evento do painel de Setups mostra, em "Parâmetros usados", com quais valores foi calculado. Os números que a especificação marca como arbitrários devem ser calibrados no laboratório.

Termos usados:

- **Tick**: o menor passo de preço do ativo. "1 tick abaixo" é o preço menos esse passo, arredondado para a grade de ticks.
- **ATR14**: a amplitude média dos últimos 14 candles (veja [ATR](/biblioteca/atr-e-stop-atr)). ATR5 e ATR20 são a mesma conta com 5 e 20 candles.
- **MMA50**: a média aritmética dos últimos 50 fechamentos (veja [Médias móveis](/biblioteca/medias-moveis)).
- **Bollinger 20/2**: as [Bandas de Bollinger](/biblioteca/bandas-de-bollinger) de 20 períodos e 2 desvios. A **largura** é a distância entre as bandas dividida pela média central.
- **Corpo**: a distância entre abertura e fechamento do candle, sem sinal.

### 1. A caixa e o radar

O setup entra em **radar** (observar, ainda não é compra) no candle que fecha quando tudo isto vale ao mesmo tempo:

- Existe uma caixa de **8 a 39 candles** terminando no candle anterior. Se várias servem, o Radar fica com a **maior**. O mínimo de 8 é o parâmetro `minBars`.
- **Amplitude**: topo − base de no máximo **3 × ATR14** (`maxRangeAtr`). O ATR14 usado é o do candle **anterior à caixa**, e ele fica fixo durante toda a vida da caixa.
- **Alta antes da caixa**: no candle anterior à caixa, o fechamento está acima da MMA50 **e** a MMA50 está acima do valor que tinha 5 candles antes.
- **Volatilidade contraída**, medida no candle anterior ao atual (o último da caixa encontrada): a largura da Bollinger 20/2 está entre as **20% menores** (`squeezeQuantile`) dos últimos **120 candles** (`squeezeLookback`), com pelo menos 20 larguras para comparar; **ou** o ATR5 está menor que o ATR20.
- **Volume da caixa baixo**: o volume médio dos candles da caixa é menor que a média de 21 do volume que termina no candle anterior à caixa. Sem dado de volume, esta condição não é conferida e o radar avisa "volume indisponível: não foi verificado".
- O candle atual **fecha dentro** da caixa (nem acima do topo, nem abaixo da base) e, somando os pavios dele, a amplitude continua dentro do limite.

Consequências dessas regras:

- O candle do radar entra na caixa. Por isso, quando o radar aparece, a caixa tem **pelo menos 9 candles**: os 8 mínimos mais o candle do radar.
- O Radar confere a amplitude, não a "cara" de lateral. A caixa pode incluir os últimos candles da alta que veio antes, desde que caibam no limite de 3 ATR.
- A MMA50 e a comparação com 5 candles antes exigem histórico: o primeiro radar só pode aparecer a partir do 64º candle carregado.

### 2. Enquanto está em radar

Em cada candle fechado, nesta ordem:

1. **Fechou abaixo da base**: o setup é **invalidado**.
2. **Fechou acima do topo**: é o candle de rompimento (item 3).
3. **Fechou dentro**: o candle entra na caixa, e o topo e a base passam a incluir os pavios dele. Se a amplitude passar de 3 × ATR14 (o mesmo ATR de antes da caixa), o setup é **cancelado** ("a caixa deixou de ser apertada"). Se a caixa passar de **40 candles** (`maxBars`), o radar **expira**; uma caixa nova só pode começar depois do candle da expiração.

- Fechar exatamente no topo ou na base conta como **dentro**.
- A contração de volatilidade e o volume da caixa **não** são conferidos de novo depois que o radar aparece. Só a amplitude.
- O rompimento vale por **fechamento**, como nas [Primitivas de price action](/biblioteca/primitivas-price-action). Se você trocar a configuração geral para "rompimento por pavio" (`breakoutByClose` desligado), basta a máxima passar do topo; e a mínima passar da base invalida.

### 3. O candle de rompimento

O candle que fechou acima do topo precisa de **duas confirmações nele mesmo**:

| Confirmação | Regra | Padrão |
|---|---|---|
| Volume (`breakoutVolMult`) | volume do candle ÷ média do volume dos 21 candles anteriores | 1,5 vez ou mais |
| Corpo (`breakoutBodyMult`) | corpo do candle ÷ corpo médio dos 20 candles anteriores | 1,2 vez ou mais |

- O candle atual não entra nas duas médias. O corpo vale para candle de qualquer cor.
- Se faltar qualquer uma, o setup é **cancelado** como "rompimento suspeito". Ele **não** espera um segundo rompimento da mesma caixa.
- **Exigência de volume** (`requireVolume`): vem ligada. Desligada, o Radar ignora o volume do rompimento, com ou sem dado de volume, e só confere o corpo. O Experimento E5 compara com e sem essa exigência.
- **Sem dado de volume**: com a exigência ligada, o setup é cancelado e o motivo explica que o filtro não pôde ser aplicado.
- Com as duas confirmações, o setup fica **armado**. O que acontece depois depende do tipo de entrada (`entry`).

### 4. Entrada no rompimento (padrão)

- A compra acontece na **abertura do candle seguinte** ao rompimento, a qualquer preço. Não é uma ordem stop com gatilho: o sinal só existe quando o candle de rompimento fecha, e a primeira chance de agir é a abertura seguinte.
- **Stop** (o preço de saída se der errado), escolhido em `stopMode`:
- "Base da caixa" (padrão): base − 1 tick.
- "Mínima do rompimento": mínima do candle de rompimento − 1 tick.
- Se o candle seguinte abrir com **gap** (salto de preço) para cima, a compra fica mais cara e o risco por ação aumenta.
- Se ele abrir **abaixo do stop**, a compra e a saída acontecem na mesma abertura: resultado de 0R antes dos custos, mas os custos são pagos.

### 5. Entrada no reteste (opcional)

Com `entry` em "reteste", o Radar não compra logo depois do rompimento. Ele espera o preço voltar perto do topo rompido.

- **Reteste**: um candle, depois do rompimento, com mínima de até **0,25 × ATR14** acima do topo (`retestAtr`), ou abaixo dele, e que **fecha acima do topo**.
- **Gatilho**: máxima do candle do reteste + 1 tick. É uma **ordem stop**: basta a máxima de um candle seguinte tocar o gatilho. Se o candle abrir acima do gatilho, a compra é na abertura (o pior preço).
- **Stop mais curto**: 1 tick abaixo do mais baixo entre a mínima do candle do reteste e o topo da caixa.
- A cada candle sem compra, o gatilho passa para a máxima desse candle + 1 tick (como o candle não chegou ao gatilho antigo, o novo nunca fica acima dele). O stop é refeito com a menor mínima desde o reteste, sempre limitado ao topo da caixa.
- **Fechou no topo ou abaixo antes da compra**: o setup é **invalidado**. Se isso acontecer em até 2 candles depois do rompimento, o motivo é "falso rompimento"; depois disso, "o reteste falhou". Se, nesse mesmo candle, a máxima tocou o gatilho, a compra conta primeiro (a ordem stop executa antes do fechamento).
- Se passarem mais de **10 candles** depois do rompimento sem compra (`retestExpiryBars`), o setup **expira**.

### 6. Depois da compra

- **Alerta de falso rompimento**: se, nos **2 candles** a partir da entrada (`falseBreakBars`), algum candle fechar no topo ou abaixo dele, o Radar mostra "⚠ Falso rompimento", uma vez só. Isso é um **alerta**, não uma saída. Na entrada no rompimento, esses 2 candles são exatamente os 2 seguintes ao candle de rompimento.
- **Saída fixa (padrão)**: alvo = entrada + 2 × (entrada − stop), o "alvo de 2R" (veja [R-múltiplo](/biblioteca/r-multiplo)). O 2 é o parâmetro `exit.targetR`; a especificação cita 2R ou 3R. O alvo parte do preço real de entrada.
- **Saída dinâmica (opcional, "condução")**: não há alvo. Quando um candle **fecha abaixo da MME9** (média exponencial de 9) **e a MME9 está caindo**, o stop sobe para 1 tick abaixo da mínima desse candle. O stop só sobe, nunca desce. O novo stop vale a partir do candle seguinte, e a regra começa a valer no candle depois da entrada.
- **"Perder a base"** é o próprio stop no modo "base da caixa": basta o preço tocar 1 tick abaixo da base durante o candle.

**Como o Radar decide o preço de saída** (o mesmo modelo no painel, nos alertas e no laboratório):

- Stop com gap contra (o candle abre abaixo do stop): sai na abertura, com perda maior que 1R.
- Alvo com gap a favor: sai no alvo, e não na abertura melhor (conservador).
- Stop e alvo tocados no mesmo candle: conta **stop**, porque o gráfico não mostra qual veio primeiro.
- No candle da entrada só o stop é conferido. Se a mínima desse candle tocar o stop, conta stop, mesmo que a mínima possa ter acontecido antes da compra.

O resultado em R aparece no painel de Setups **sem custos**. Custos e imposto entram só no laboratório.

### 7. Outras regras

- **Uma ocorrência por vez**: enquanto houver uma caixa em radar, uma compra armada ou uma operação em andamento, o Radar não procura outra caixa no mesmo ativo e tempo gráfico. Quando a ocorrência termina, ele volta a procurar, mas não repete uma caixa que comece no mesmo candle da anterior.
- **Só compra**: não existe a versão de venda.
- **Sem filtro de ADX**: a "alta antes da caixa" é só a regra da MMA50 do item 1, não a tendência do [painel de contexto](/biblioteca/painel-contexto).
- **Escala maior**: se a escala maior estiver em baixa, o evento ganha o **aviso vermelho** "contra a escala maior" (veja [Visão fractal](/biblioteca/visao-fractal)). O aviso não bloqueia o setup.
- **Todas as escalas**: o Radar procura o setup em qualquer tempo gráfico.

### Exemplo hipotético

Tick de R$ 0,01, saída fixa em 2R, entrada no rompimento, stop na base.

1. **Antes da caixa**: a ação vinha subindo. No candle anterior à caixa, ela fechou em R$ 24,80, com a MMA50 em R$ 23,00 e acima do valor de 5 candles antes. O ATR14 nesse candle era R$ 0,60, então a caixa pode ter no máximo 3 × 0,60 = R$ 1,80 de amplitude.
2. **Caixa**: os 8 candles seguintes ficam entre R$ 24,20 (base) e R$ 25,40 (topo), com volume abaixo da média e a Bollinger 20/2 entre as mais estreitas dos últimos 120 candles. O 9º candle também fecha dentro: **radar**.
3. **Caixa crescendo**: mais 3 candles fecham dentro. Um deles tem pavio até R$ 25,50, e o topo passa para R$ 25,50. Amplitude: 25,50 − 24,20 = R$ 1,30, ainda dentro do limite.
4. **Rompimento**: um candle fecha em R$ 25,80, acima de R$ 25,50, com volume de 1,8 vez a média e corpo de 1,5 vez o corpo médio. **Armado**. Stop = 24,20 − 0,01 = R$ 24,19.
5. **Entrada**: o candle seguinte abre em R$ 25,85 e não chega ao stop. Compra em R$ 25,85. Risco = 25,85 − 24,19 = R$ 1,66. Alvo = 25,85 + 2 × 1,66 = **R$ 29,17**.

Se o volume do rompimento fosse 1,3 vez a média, o setup seria cancelado. Com o stop na "mínima do rompimento" e essa mínima em R$ 25,35, o stop seria R$ 25,34, o risco R$ 0,51 e o alvo 25,85 + 1,02 = R$ 26,87.

## De onde veio

O setup vem dos vídeos do canal resumidos na especificação do Radar, que o chama de "setup 2 do youtuber, o favorito dele". A especificação não cita outro autor para ele.

Segundo o resumo do vídeo na especificação, dele vêm a ideia geral (alta antes, caixa apertada, rompimento por fechamento com volume e corpo grande), o reteste como segunda entrada com stop mais curto, o falso rompimento e as saídas em 2R, 3R ou por condução. No exemplo do vídeo, o volume do rompimento era "estrondoso" e a saída foi pela condução, quando a MME9 virou para baixo e a mínima foi perdida.

Os números (8 e 40 candles, 3 ATR, Bollinger 20/2 no menor quintil de 120 candles, volume de 1,5 vez a média) foram escritos na especificação do Radar, quase todos marcados como pontos de partida arbitrários, para que o computador consiga conferir tudo sempre do mesmo jeito. O vídeo também afirma que "rompimento sem volume é suspeito".

## Quando falha

- **Falso rompimento**: o preço fecha acima do topo e volta para dentro da caixa. Na entrada no rompimento, o Radar só avisa; a saída é o stop na base, que pode estar longe.
- **Gap na entrada**: a compra é na abertura seguinte, a qualquer preço. Um gap para cima piora a entrada e aumenta o risco; um gap para baixo do stop dá 0R antes dos custos, com os custos pagos.
- **Caixa larga, stop longe**: com o stop na base, o risco por ação pode passar de 3 ATR: a caixa pode ter até 3 ATR de altura, e a compra acontece acima do topo (às vezes bem acima, depois de um candle forte ou de um gap). Pela regra de risco, a quantidade comprada fica pequena (veja [Gestão de risco](/biblioteca/gestao-de-risco)).
- **Rompimento tardio**: o setup exige fechamento acima do topo com corpo grande. Quando ele aparece, o preço muitas vezes já andou bastante desde o topo, e a entrada fica longe da caixa.
- **Volume de qualidade variável**: na cripto, o volume é só o da Binance, não o do mercado inteiro ✅. Nas ações dos EUA pelo plano gratuito, o volume ao vivo vem só da bolsa IEX, uma fração do total ✅; um candle que fecha ao vivo pode ter volume subestimado em comparação com a média do histórico, e o filtro de volume pode cancelar um rompimento que passaria com o volume completo. Veja [Volume](/biblioteca/volume).
- **Pré-requisito fraco**: "alta antes da caixa" é só fechamento acima da MMA50 e MMA50 maior que 5 candles antes. Não olha o ADX nem a estrutura de topos e fundos.
- **Contração não diz a direção**: bandas apertadas dizem que a volatilidade está baixa, não para que lado o preço vai sair. Saídas por baixo invalidam o setup e não aparecem como operação.
- **Poucas ocorrências**: são muitas condições ao mesmo tempo. Num só ativo, pode haver poucas operações para concluir algo. Pelas regras do laboratório, menos de 30 operações é "inconclusivo".
- **Candle da entrada**: um candle amplo que toca o stop conta como perda, pela regra conservadora, mesmo que a mínima tenha vindo antes da compra.
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento parece um tombo e pode quebrar a caixa ou criar "rompimentos" que não aconteceram.

## Lacunas e decisões nossas

A especificação deixa pontos em aberto. Onde não havia regra, o Radar escolheu uma, e ela vale para todos os números que o Radar mostrar.

- **A caixa é a maior que serve**: entre 8 e 39 candles terminando no candle anterior, mais o candle do radar. Ela pode incluir o fim da alta anterior.
- **"Tendência de alta antes da consolidação"** = fechamento acima da MMA50 e MMA50 acima da de 5 candles antes, no candle anterior à caixa. Não é a tendência do painel de contexto.
- **"ATR5/ATR20 caindo"** virou "ATR5 menor que ATR20".
- **Conferido uma vez**: contração e volume da caixa só são conferidos quando o radar aparece. Depois, só a amplitude.
- **Topo e base acompanham os pavios** de todo candle que fecha dentro, inclusive o do radar. A amplitude é sempre comparada com o ATR14 de antes da caixa.
- **Validade**: mais de 40 candles sem romper = expirou; a caixa seguinte não reaproveita os candles da que expirou.
- **"Corpo grande"** = 1,2 vez o corpo médio dos 20 candles anteriores (número nosso), em candle de qualquer cor.
- **Sem segunda chance**: rompimento sem volume ou sem corpo cancela o setup, em vez de esperar outro rompimento.
- **Sem dado de volume**: o volume da caixa não é conferido (com aviso); o do rompimento cancela o setup, a menos que a exigência de volume esteja desligada.
- **Entrada na abertura seguinte**, a qualquer preço, no modo rompimento. O alvo é arredondado ao tick mais próximo nos dois modos (rompimento e reteste), como nos outros setups.
- **Reteste**: tolerância de 0,25 ATR acima do topo, validade de 10 candles, gatilho que acompanha a máxima de cada candle e stop limitado ao topo da caixa. Os dois números (0,25 e 10) e as duas regras são nossos.
- **Falso rompimento depois da compra** só gera alerta, uma vez, nos 2 candles a partir da entrada. A saída fica por conta do stop.
- **Condução**: o vídeo fala em "MME9 vira para baixo e a mínima é perdida". O Radar usa "fechou abaixo da MME9 com a MME9 caindo" para subir o stop até a mínima desse candle; "perder a mínima" é tocar 1 tick abaixo dela, sem esperar o fechamento.
- **Candle da entrada**: só o stop é conferido, e conta mesmo que a mínima tenha vindo antes da compra. Escolha conservadora nossa.
- **Uma ocorrência por vez** e **só compra**.

## Resultados no laboratório
[[laboratorio]]

O laboratório roda este setup com os **valores padrão** (entrada no rompimento, volume exigido, stop na base, alvo de 2R), nos candles reais da fonte, só na compra, com custos, imposto de renda simulado (só na B3), CDI e comprar-e-segurar no mesmo período. Ele separa o período em treino (70%) e teste (30%) e registra cada tentativa. Quando este é o primeiro setup escolhido (pelo botão acima, ele vem sozinho), o mapa de sensibilidade varia o alvo (1,5R, 2R, 2,5R e 3R) e o walk-forward escolhe o alvo olhando só o passado e mede no trecho seguinte.

O **Experimento E5** fica no laboratório, em "Verificar o youtuber: experimentos prontos E1–E7". Ele roda o setup no diário em três versões: com a exigência de volume de 1,5 vez a média (padrão), sem a exigência e com entrada no reteste. Depois soma o resultado em R de todos os ativos da lista (já com custos, sem imposto) e diz se a diferença entre as versões é maior que o barulho do acaso. A lista sugerida tem 20 ações da B3 escolhidas hoje, o que já é viés de sobrevivência, e pode ser editada. Para ter 10 anos da B3, o servidor precisa do histórico COTAHIST importado; ativo sem dados aparece como erro, sem número inventado.

Outras variações (stop na mínima do rompimento, saída por condução, tamanho da caixa) ainda não podem ser testadas pela tela, porque a tela para mudar os parâmetros dos setups não existe. Nada nesta página é resultado medido.

## Críticas

- **"Favorito" não é evidência.** O vídeo apresenta este setup como o preferido do youtuber, mas a especificação não registra números que sustentem a preferência.
- **Um exemplo escolhido.** No exemplo do vídeo, o volume foi "estrondoso" e a condução deu certo. Num gráfico pronto, é fácil mostrar o rompimento que funcionou e esquecer os falsos. O Radar marca todos, inclusive os cancelados e invalidados.
- **"Rompimento sem volume é suspeito"** é afirmação do vídeo. O Experimento E5 existe exatamente para medir se a exigência de volume melhora o resultado depois dos custos.
- **Muitos números arbitrários.** São mais de dez parâmetros: tamanho da caixa, amplitude, quintil, volume, corpo, tipo de entrada, stop, alvo. Testar muitas combinações e ficar com a melhor é se enganar (sobreajuste). O laboratório conta quantas variações você testou.
- **Padrão subjetivo, regra objetiva.** "Consolidação apertada" é uma leitura de olho. A regra do Radar é uma tradução possível, não a única; um resultado medido aqui vale para esta versão.
- **Viés de sobrevivência.** Testar só ativos que existem hoje deixa de fora os que caíram e saíram da bolsa, e o resultado sai otimista.
- **Conflito de interesse.** Os vídeos vendem um serviço de assinatura.
- **Custos, imposto e CDI.** Qualquer resultado precisa vir depois de custos e IR e ser comparado com o CDI do mesmo período. Veja [Slippage e custos](/biblioteca/slippage-e-custos) e [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
