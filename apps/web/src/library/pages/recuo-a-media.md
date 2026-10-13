---
titulo: Recuo à média
categoria: setup
resumo: Compra no fim de um recuo até a média, numa alta já estabelecida. Tocar a média não é sinal: o gatilho vem depois. Regras exatas, lacunas e críticas.
relacionados: medias-moveis, painel-contexto, primitivas-price-action, visao-fractal, volume, candles, r-multiplo, slippage-e-custos
---

## O que é

O recuo à média (em inglês, *pullback*) é o "setup 1" do youtuber. **Setup** é uma receita com regras fixas de quando entrar e quando sair de uma operação.

A ideia: numa alta que já está em andamento, o preço às vezes "respira" e volta até uma média móvel (veja [Médias móveis](/biblioteca/medias-moveis)). Se a alta continuar depois disso, o fim do recuo seria um bom lugar para comprar, com o stop perto. O vídeo afirma que o recuo à média é "o setup clássico" das médias.

Duas regras mandam em tudo:

- **Sem tendência de alta, não existe setup.** O Radar nem começa a olhar se a alta não estiver estabelecida.
- **Tocar a média não é sinal.** O Radar espera um candle **fechar** perto da média e só "compra" se, depois, o preço passar da máxima desse candle.

O Radar **não envia ordens**. "Comprar" e "entrar" aqui querem dizer que o Radar marca no gráfico, avisa (se você criou um alerta) e simula a operação no laboratório.

> Nenhum setup garante lucro. Um recuo pode ser o começo de uma queda, e o gráfico não avisa antes. Leia as críticas no fim da página.

## Regras exatas no Radar

Estas são as regras como estão no código hoje. Tudo é conferido com o candle **fechado**; o candle em formação nunca gera sinal.

Os números são os **valores padrão**. Cada um é um parâmetro do setup, guardado nas suas preferências, mas a tela para editar os parâmetros dos setups ainda não existe. Cada evento do painel de Setups mostra, em "Parâmetros usados", com quais valores foi calculado. O teste do laboratório usa sempre os valores padrão. Os números que a especificação marca como arbitrários precisam ser calibrados sem sobreajuste; hoje o mapa de sensibilidade do laboratório varia só o alvo em R.

**Tick** é o menor passo de preço do ativo. "1 tick acima" é o preço mais esse passo, arredondado para a grade de ticks. **ATR14** é a amplitude média dos últimos 14 candles; aqui ele serve de régua para dizer o que é "perto" (veja [ATR](/biblioteca/atr-e-stop-atr)).

### 1. Pré-requisito: tendência de alta

Todas estas condições precisam valer no candle em que o recuo aparece:

- **Estrutura de alta**: os dois últimos topos e os dois últimos fundos confirmados são ascendentes. Um topo ou fundo só é confirmado 2 candles depois de acontecer (veja [Primitivas de price action](/biblioteca/primitivas-price-action)).
- **MMA50 subindo**: a média aritmética de 50 fechamentos está maior que no candle anterior.
- **MME21 subindo**: a média exponencial de 21 está maior que 5 candles antes. O 5 é um parâmetro geral do Radar, o mesmo do painel de contexto.
- **Escala maior não está em baixa**: no gráfico diário, a escala maior é o semanal; no semanal, o mensal; no 60 minutos, o diário (veja [Visão fractal](/biblioteca/visao-fractal)). A tendência dela segue a mesma regra do [painel de contexto](/biblioteca/painel-contexto) (estrutura, MMA50 e ADX) e só conta períodos já fechados: no diário, vale a última semana fechada. Escala maior lateral, ainda sem dados suficientes, ou inexistente (no mensal) deixa passar.

Depois que a ocorrência começa, a estrutura e as médias não são conferidas de novo. Valem as invalidações do item 4.

### 2. Qual média

- **Automática (padrão, `ma`)**: usa a média que o ativo **respeita**, pela mesma regra do [painel de contexto](/biblioteca/painel-contexto): a que segurou pelo menos 2 dos últimos 3 a 5 fundos confirmados. Pode ser MME9, MME21, MMA50, MMA100 ou MMA200. Se nenhuma for respeitada, usa a MME21.
- Também dá para fixar a MME9, a MME21 ou a MMA50.
- A média escolhida quando o radar aparece fica a mesma até o fim daquela ocorrência.

### 3. Radar e armado

**Radar** (o recuo chegou perto da média), num candle fechado:

- a mínima ficou a no máximo 0,5 ATR14 acima da média, ou abaixo dela (o 0,5 é o parâmetro `nearAtr`);
- o fechamento está abaixo do último topo confirmado;
- o último fundo confirmado veio antes desse topo, ou seja, o preço está recuando depois do topo.

**Armado**: um candle **fecha na região da média**. Região quer dizer: mínima no máximo 0,5 ATR14 acima da média **e** fechamento no máximo 0,5 ATR14 abaixo dela. Muitas vezes é o próprio candle do radar.

- **Gatilho** (o preço que dispara a compra): máxima desse candle + 1 tick.
- **Stop** (o preço de saída se der errado), escolhido em `stopMode`:
- "Mínima do recuo" (padrão): 1 tick abaixo da menor mínima desde o candle do topo.
- "Mínima do candle-gatilho": 1 tick abaixo da mínima do candle que armou.
- Candle de força de alta, martelo ou inside bar no candle que armou somam 1 ponto na pontuação (item 5), mas **não são obrigatórios** (veja [Candles](/biblioteca/candles)).
- Se o volume do candle que armou estiver acima da média dos 21 candles anteriores, o motivo ganha a anotação "volume crescente". Isso não soma pontos.

### 4. Enquanto espera o rompimento

A partir do candle seguinte ao armado, em cada candle fechado, nesta ordem:

1. Se a escala maior mudou para baixa, o setup é **invalidado**. Essa informação já existe na abertura do candle, por isso vem antes de qualquer compra.
2. Se a máxima do candle alcançou o gatilho, a compra acontece (item 6).
3. Se não houve compra e o candle fechou abaixo do **fundo anterior** (o último fundo confirmado antes do topo), o setup é invalidado: o recuo virou reversão.
4. Se não houve compra, a média caiu (ficou menor que no candle anterior) **e** o candle fechou abaixo dela, o setup é invalidado.
5. Se já se passaram 5 candles depois do primeiro "armado" sem compra, o setup **expira** (`expiryBars`).
6. Se o candle fechou de novo na região da média, o setup arma outra vez: o gatilho passa para a máxima deste candle + 1 tick e o stop é refeito. Como o candle não chegou ao gatilho antigo, o novo nunca fica acima dele.

**Radar que não arma**: se nenhum candle armar em 15 candles desde o radar (`radarExpiryBars`), ele expira. Isso evita que um radar velho, preso a um topo antigo, bloqueie os recuos seguintes, já que só existe uma ocorrência por vez. As invalidações dos passos 1, 3 e 4 também valem para o radar.

### 5. Pontuação do "recuo saudável"

O "recuo" são os candles depois do topo até o atual. A "alta" (o impulso) vai do fundo anterior até o topo.

| Sinal | Pontos | Regra (padrão) |
|---|---|---|
| Volume secando no recuo | +1 | média do volume no recuo menor que a média de 21 de antes dele, e volume caindo; precisa de pelo menos 2 candles de recuo |
| Candles do recuo menores | +1 | amplitude média do recuo abaixo de 0,7 vez a da alta (`smallerRangeRatio`) |
| Fundo anterior preservado | +1 | todas as mínimas do recuo acima do fundo anterior |
| Queda com volume alto | −1 (alerta) | candle de baixa com volume de 1,5 vez a média dos 21 anteriores ou mais |
| Barra de força de baixa | −1 (alerta) | candle de força de baixa no recuo |
| Padrão no candle que arma | +1 | candle de força de alta, martelo ou inside bar (só no armado) |

- A pontuação aparece no painel de Setups como "Pontuação do recuo", e cada alerta aparece com ⚠. Veja também [Volume](/biblioteca/volume).
- **Filtro `requireHealthy`** (desligado por padrão): ligado, o setup só arma com pelo menos 2 pontos, sem contar o do padrão, e nenhum alerta. Desligado, a pontuação só informa.

### 6. Entrada e saída

- A entrada é uma **ordem stop**: basta a máxima tocar o gatilho; não precisa fechar acima. Se o candle abrir acima do gatilho (um **gap**, salto de preço entre um candle e outro), a compra é registrada na abertura, que é o pior preço.
- **Saída fixa (padrão)**: alvo = entrada + 2 × (entrada − stop), o "alvo de 2R". R é o risco por ação, a distância entre a entrada e o stop (veja [R-múltiplo](/biblioteca/r-multiplo)). O 2 é o parâmetro `exit.targetR`. O alvo parte do preço real de entrada e é arredondado ao tick.
- **Saída dinâmica (opcional)**: sem alvo. A partir do candle seguinte à entrada, todo candle que **fecha abaixo da MME9** sobe o stop para 1 tick abaixo da mínima desse candle. O stop só sobe; nunca desce.
- Depois da compra, só stop, alvo ou stop móvel encerram a operação. As invalidações do item 4 deixam de valer.
- **Preço de saída** (o mesmo modelo no painel, nos alertas e no laboratório): stop com gap contra sai na abertura; alvo com gap a favor sai no alvo (conservador); stop e alvo tocados no mesmo candle contam **stop**; no candle da entrada só o stop é conferido, e conta mesmo que a mínima possa ter vindo antes da compra.
- O resultado em R aparece no painel de Setups **sem custos**. Custos e imposto entram só no laboratório.

### 7. Outras regras

- **Só compra**: o recuo do Radar não tem versão de venda.
- **Uma ocorrência por vez** no ativo.
- **Qualquer tempo gráfico**: o Radar procura o recuo em todas as escalas.
- **Escala maior**: o recuo é o único setup do Radar que **bloqueia** pela escala maior (não aparece e é invalidado com ela em baixa). Os outros só ganham o aviso vermelho.

### Exemplo hipotético

Tick de R$ 0,01, alvo de 2R, stop "mínima do recuo". A alta está estabelecida: fundo anterior em R$ 40,00, último topo confirmado em R$ 50,00. A média respeitada é a MME21. O ATR14 vale R$ 1,00.

1. **Candle A**: a MME21 está em R$ 46,00. A região vai de mínima até R$ 46,50 e fechamento a partir de R$ 45,50. O candle A faz mínima R$ 46,30, máxima R$ 47,20 e fecha em R$ 46,80. Radar e armado no mesmo candle. Gatilho R$ 47,21. A menor mínima desde o topo é R$ 46,30, então o stop fica em R$ 46,29.
2. **Candle B**: máxima R$ 47,00 (não chegou ao gatilho), mínima R$ 45,90, fechamento R$ 46,10. A MME21 subiu um pouco, para R$ 46,01, e o candle fechou de novo na região. Novo gatilho R$ 47,01; novo stop R$ 45,89.
3. **Candle C**: abre em R$ 46,40 e sobe até R$ 47,60, sem chegar perto do stop. Compra em R$ 47,01. Risco = 47,01 − 45,89 = R$ 1,12. Alvo = 47,01 + 2 × 1,12 = **R$ 49,25**.

Se o candle C tivesse aberto em R$ 47,30 (gap acima do gatilho), a compra seria em R$ 47,30, o risco R$ 1,41 e o alvo 47,30 + 2,82 = R$ 50,12.

Repare: o candle A chegou perto da média e isso **não** foi compra. Se o preço não passasse do gatilho até o 5º candle depois de A, o setup expiraria.

## De onde veio

Segundo a especificação do Radar, o recuo à média é o "setup 1" do youtuber. As regras acima partem do que a especificação registrou a partir do vídeo: tendência de alta estabelecida como pré-requisito; a MME9 em tendências muito fortes, a MME21 no caso mais comum e a MMA50 em correções mais fundas; sinais de recuo saudável e de alerta; "tocar a média não é sinal"; stop abaixo da mínima do candle-gatilho ou do recuo; três formas de alvo; invalidações; e uso no semanal ou no diário, com a entrada refinada numa escala menor.

A especificação não cita um autor para o setup, e o Radar não afirma de quem ele é. Esta página descreve o recuo à média **do Radar**.

## Quando falha

- **Recuo que vira queda**: o gráfico não diferencia, na hora, um recuo de uma reversão. Antes da compra, o recuo pode ficar mais fundo sem invalidar o setup: ele só arma de novo mais embaixo. A invalidação por preço só vem quando um candle fecha abaixo do fundo anterior, o ponto de onde a última alta começou.
- **Atraso**: topos e fundos se confirmam 2 candles depois, e a MMA50 é lenta. Quando todas as condições de tendência aparecem, a alta pode já estar madura.
- **Média que deixa de ser respeitada**: a média "respeitada" é escolhida olhando para os recuos passados. Nada garante que o próximo recuo pare nela.
- **Tendência fraca**: o recuo não confere o ADX (veja [ADX](/biblioteca/adx)). Estrutura de alta e médias subindo podem aparecer numa alta sem força.
- **Stop curto, custos grandes**: no modo "mínima do candle-gatilho", o stop fica perto. Custos e derrapagem pesam mais em R (veja [Slippage e custos](/biblioteca/slippage-e-custos)), e um candle amplo na entrada pode tocar o stop e contar como perda pela regra conservadora.
- **Gaps**: um gap abaixo do stop faz a perda passar de 1R.
- **Volume sem sentido**: no forex, o volume é só o da corretora (✅ nas fontes do projeto). "Volume secando" diz pouco nesse mercado.
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento parece um tombo do preço e bagunça topos, fundos e médias.

## Lacunas e decisões nossas

A especificação deixa pontos em aberto. Onde não havia regra, o Radar escolheu uma, e ela vale para todos os números que o Radar mostrar.

- **"Escala maior a favor"** virou "escala maior que não está em baixa". Lateral, indefinida ou sem dados deixam passar.
- **"Médias para cima"** = MMA50 maior que no candle anterior e MME21 maior que 5 candles antes. Só são conferidas quando o radar aparece.
- **"Região da média"**: a especificação não define. O Radar usa mínima até 0,5 ATR14 acima da média para o radar e, para armar, também fechamento até 0,5 ATR14 abaixo dela.
- **Qual média**: a especificação liga a MME9, a MME21 e a MMA50 à força da tendência. O Radar usa a média respeitada do painel de contexto, que também pode ser a MMA100 ou a MMA200, e a fixa durante a ocorrência.
- **Gatilho**: a especificação lista quatro gatilhos (candle de força, martelo, inside bar perto das médias ou rompimento da máxima do candle anterior). O Radar usa sempre o rompimento da máxima do candle que fechou na região. Os outros três só somam 1 ponto.
- **Rearmar**: cada novo candle que fecha na região refaz o gatilho e o stop.
- **Validades**: 5 candles depois do primeiro "armado" e 15 candles para o radar. Decisões nossas.
- **"Volume crescente no gatilho pontua mais"**: só aparece no texto do motivo; não soma pontos.
- **Invalidação por preço**: a especificação fala em "perda do fundo do recuo". O Radar invalida com o fechamento abaixo do fundo anterior ao topo. O fundo do recuo vira o stop depois da compra (no modo padrão).
- **Ordem stop antes das invalidações por fechamento**: se o candle passa do gatilho e depois fecha fraco, conta como compra (e pode dar stop no mesmo candle), não como "invalidado". Assim a perda aparece nas estatísticas.
- **Alvos**: só o alvo em R (2R por padrão) e a condução pela MME9. Não foram implementados: alvo no rompimento do topo anterior, parcial em 2R com final em 3R e condução pelo Stop ATR.
- **"Perda da MME9" na condução** = fechamento abaixo da MME9, valendo a partir do candle seguinte à entrada.
- **Refinamento na escala menor**: não implementado; o Radar não procura a entrada numa escala menor.
- **Sem filtro de ADX**: segundo o vídeo, o contexto ideal inclui ADX acima de 25, mas a regra do recuo na especificação não tem filtro de ADX. O ADX aparece no painel de contexto para você decidir.
- **Candle da entrada**: só o stop é conferido, e conta mesmo que a mínima tenha vindo antes da compra. Escolha conservadora nossa.
- **Uma ocorrência por vez** e **só compra**.

## Resultados no laboratório
[[laboratorio]]

O botão acima abre o laboratório com o recuo à média já escolhido. Lá, o teste usa os candles reais da fonte, os custos padrão do mercado (taxas, spread e derrapagem) e o IR simulado (só para a B3), e compara o resultado com o CDI e com o comprar-e-segurar do mesmo período. Os primeiros 70% do período são o "treino" e os 30% finais são o teste fora da amostra. O mapa de sensibilidade repete o teste com alvos de 1,5R, 2R, 2,5R e 3R, e o walk-forward escolhe o alvo olhando só para o passado e mede no trecho seguinte. Há também a simulação de Monte Carlo (sorteia milhares de novas sequências com os resultados dos trades, para mostrar quedas de patrimônio que poderiam ter acontecido), e cada tentativa fica registrada.

O teste do laboratório roda com os valores padrão: o filtro de recuo saudável fica desligado. Para comparar com e sem ele, existe o **Experimento E4** (Laboratório → Experimentos). Ele roda o recuo à média no gráfico diário com o filtro desligado e ligado (pelo menos 2 pontos e nenhum alerta), em cerca de 10 anos de cada ativo de uma lista sugerida de 20 ações da B3 (editável; composição e liquidez não verificadas 🟡). Depois, diz se a diferença de expectativa em R, depois dos custos, passa do que o acaso explicaria. Os números dependem dos dados reais de cada ativo; nada nesta página é resultado medido.

## Críticas

- **Escolhido olhando para trás.** A média "respeitada" sai dos recuos que já aconteceram. Ajustar a regra ao passado e esperar que valha no futuro é o caminho do sobreajuste.
- **Exemplos escolhidos a dedo.** Num gráfico pronto, é fácil mostrar os recuos que viraram alta e esquecer os que viraram queda. O Radar marca todos.
- **Números sem estatística.** 0,5 ATR, 0,7 vez a amplitude, 1,5 vez o volume, 5 e 15 candles: são padrões arbitrários. O mapa de sensibilidade do laboratório mostra se um bom resultado é um platô (mais robusto) ou um pico isolado (provável sorte).
- **Muitas variações.** Média automática ou fixa, dois stops, alvo fixo ou condução, filtro de recuo saudável ligado ou desligado: testar tudo e ficar com o melhor é se enganar. O laboratório conta quantas variações você testou.
- **"Recuo saudável" sem prova.** Volume secando e candles menores são sinais descritos no vídeo, sem estatística que mostre que funcionam. É o que o Experimento E4 compara.
- **Conflito de interesse.** Os vídeos vendem um serviço de assinatura.
- **Custos, imposto e CDI.** Qualquer resultado precisa vir depois de custos e IR e ser comparado com o CDI do mesmo período. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **É o recuo do Radar.** Região da média, gatilho único, validades e modelo conservador de execução são escolhas nossas. Um número medido aqui vale para esta versão, não necessariamente para a do vídeo.
