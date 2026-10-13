---
titulo: Setup 9.2
categoria: setup
resumo: Compra na correção de uma alta: arma quando um candle fecha abaixo da mínima do candle de maior fechamento, com a MME9 ainda subindo.
relacionados: setup-9-3, setup-9-1, medias-moveis, primitivas-price-action, r-multiplo, gestao-de-risco, visao-fractal, contradicoes-entre-as-fontes
---

## O que é

O 9.2 é um **setup de continuação**: ele tenta comprar no fim de uma pequena correção, durante uma alta que já está em andamento. Setup é uma receita com regras fixas de entrada e saída.

Tudo gira em torno da **MME9**, a média móvel exponencial dos últimos 9 fechamentos (veja [Médias móveis](/biblioteca/medias-moveis)). Enquanto a MME9 sobe, o Radar acompanha a **pernada** de alta e guarda o candle de maior fechamento. Quando um candle fecha abaixo da **mínima** desse candle, mas a MME9 ainda está subindo, o setup arma: a correção pode estar acabando.

A diferença para o [Setup 9.1](/biblioteca/setup-9-1): o 9.1 tenta pegar a **virada** da MME9; o 9.2 só existe com a MME9 **já subindo**. O [Setup 9.3](/biblioteca/setup-9-3) é um irmão do 9.2 que arma com uma correção mais leve.

O Radar **não envia ordens**. "Comprar" aqui quer dizer que o Radar marca no gráfico, avisa (se você criou um alerta) e simula no laboratório.

## Regras exatas no Radar

Estas são as regras como estão no código hoje. Tudo é conferido com o candle **fechado**.

Os números são os **valores padrão**. Cada um é um parâmetro do setup, guardado nas suas preferências (a tela para editar os parâmetros dos setups ainda não existe). Cada evento do painel de Setups mostra, em "Parâmetros usados", com quais valores foi calculado. O laboratório usa sempre os valores padrão.

**Tick** é o menor passo de preço do ativo. "1 tick acima" é o preço mais esse passo, arredondado para a grade de ticks.

**MME9 subindo** quer dizer: a MME9 deste candle é maior que a do candle anterior. Pela conta da média exponencial, isso acontece quando o fechamento fica **acima do valor que a MME9 tinha no candle anterior**. "Caindo" é o contrário; "parada" é igual.

### 1. A pernada e o candle de referência

- A pernada começa no primeiro candle em que a MME9 sobe. Esse candle é a primeira **referência**.
- Em cada candle seguinte com a MME9 ainda subindo, se o fechamento for **maior** que o da referência, esse candle vira a nova referência. Fechamento igual não troca a referência.
- A pernada acaba no primeiro candle em que a MME9 não sobe (cai ou fica parada). Aí tudo recomeça do zero na próxima subida.
- Não há número mínimo de candles: um candle com a MME9 subindo já abre uma pernada.

### 2. Armado

- Num candle da pernada, com a MME9 **ainda subindo nele**, o fechamento fica **abaixo da mínima** do candle de referência (abaixo mesmo; igual não arma).
- O primeiro candle da pernada nunca arma, porque ele próprio é a referência.
- **Gatilho** (o preço que dispara a compra): máxima do candle que armou + 1 tick.
- **Stop** (o preço de saída se der errado): 1 tick abaixo da menor mínima da **correção**, isto é, dos candles depois da referência até o que armou. A mínima do próprio candle de referência fica de fora.

### 3. Enquanto espera o rompimento

A partir do candle seguinte, em cada candle fechado, nesta ordem:

1. Se a máxima do candle alcançou o gatilho, a compra acontece (item 4).
2. Se não alcançou e a MME9 **caiu**, o setup é **desarmado** e a pernada é zerada. Em outras palavras: desarma no primeiro candle que fecha abaixo do valor anterior da MME9.
3. Se não alcançou e a MME9 não caiu (subiu ou ficou parada), o gatilho passa para a **máxima deste candle + 1 tick**. Como o candle não chegou ao gatilho antigo, o novo nunca fica acima dele. O stop é refeito como 1 tick abaixo da menor mínima da correção até aqui; ele só desce.

Não há limite de candles: o setup fica armado até a compra ou o desarme.

### 4. Entrada e saída

- A entrada é uma **ordem stop**: basta a máxima tocar o gatilho; não precisa fechar acima. Se o candle abrir acima do gatilho (um **gap**, salto de preço), a compra é registrada na abertura, que é o pior preço.
- **Saída fixa (padrão)**: alvo = entrada + 2 × (entrada − stop), o "alvo de 2R" (veja [R-múltiplo](/biblioteca/r-multiplo)). O 2 é o parâmetro `exit.targetR`; a especificação cita 2R ou 3R. O alvo parte do preço real de entrada e é arredondado ao tick.
- **Saída dinâmica (opcional)**: igual à do 9.1. Sem alvo; quando a MME9 vira para baixo, o stop sobe para 1 tick abaixo da mínima do candle da virada (só sobe, nunca desce), inclusive se a virada for no candle da entrada.
- **Preço de saída**: stop com gap contra sai na abertura; alvo com gap a favor sai no alvo (conservador); stop e alvo no mesmo candle contam **stop**; no candle da entrada só o stop é conferido, e conta mesmo que a mínima possa ter vindo antes da compra.
- O resultado em R aparece no painel de Setups **sem custos**. Custos e imposto entram só no laboratório.

### 5. Outras regras

- **Uma ocorrência por vez**: enquanto houver um 9.2 armado ou em andamento, ele não arma outro.
- **A pernada continua durante a ocorrência**: se aparecer um fechamento maior, a referência sobe. Depois que a operação termina (stop ou alvo), a mesma pernada pode armar de novo, com a referência atual, inclusive no próprio candle em que a operação terminou.
- **Sem filtros**: o 9.2 não confere ADX, MMA50 nem mercado lateral.
- **Todas as escalas**: o Radar procura o 9.2 em qualquer tempo gráfico, não só no semanal e no mensal.
- **Venda**: desligada por padrão (`allowSell`). Ligada, é o espelho e aparece marcada "Venda espelhada — não descrita nos vídeos".
- **Escala maior**: se ela estiver em baixa, os eventos de compra "armado" e "acionado" ganham o **aviso vermelho** "contra a escala maior" (veja [Visão fractal](/biblioteca/visao-fractal)). O aviso não bloqueia o setup.

### Exemplo hipotético

Supondo, só para o exemplo, um tick de R$ 0,01. Saída fixa em 2R. A MME9 sobe em todos os candles abaixo, salvo onde dito.

1. **Referência**: o maior fechamento da pernada é R$ 30,00; a mínima desse candle é R$ 29,40.
2. **Candle A**: fecha em R$ 29,80. Ficou abaixo do fechamento da referência, mas acima da mínima: o 9.2 não arma. Mínima de A: R$ 29,50.
3. **Candle B**: fecha em R$ 29,30, abaixo de R$ 29,40, e a MME9 ainda subiu. **Armou.** Máxima de B: R$ 29,70; mínima: R$ 29,10. Gatilho R$ 29,71. Stop = menor mínima de A e B (R$ 29,10) − 1 tick = R$ 29,09.
4. **Candle C**: máxima R$ 29,60 (não rompeu), mínima R$ 29,00, e a MME9 não caiu. O gatilho passa para R$ 29,61 e o stop para R$ 28,99.
5. **Candle D**: abre abaixo do gatilho, passa de R$ 29,61 e não volta ao stop. Compra em R$ 29,61. Risco = 29,61 − 28,99 = R$ 0,62. Alvo = 29,61 + 2 × 0,62 = **R$ 30,85**.

Repare que, no candle B, também houve dois fechamentos seguidos abaixo de R$ 30,00: o [Setup 9.3](/biblioteca/setup-9-3) teria armado no mesmo candle.

## De onde veio

O 9.2 vem dos vídeos do canal resumidos na especificação do Radar. Segundo o vídeo, o youtuber recomenda usá-lo no **semanal e no mensal** e diz que no diário e no 60 minutos ele funciona mal.

A especificação atribui a Larry Williams apenas o 9.1 e não cita autor para o 9.2. O Radar não afirma de quem ele é. Esta página descreve o 9.2 **do Radar**.

## Quando falha

- **Correção que vira queda**: a MME9 é atrasada. Ela pode seguir subindo enquanto a alta já acabou, e o 9.2 compra no começo de uma queda. O desarme só vem quando a MME9 cai.
- **Mercado lateral**: sem filtro de ADX, o 9.2 arma também em mercados sem direção, onde a MME9 sobe e desce em sequência.
- **Correção funda**: o stop fica longe, o risco por ação cresce e a quantidade comprada, pela regra de risco, diminui (veja [Gestão de risco](/biblioteca/gestao-de-risco)).
- **Correção curta**: o stop fica perto. Aí custos e derrapagem pesam mais em R, e um candle amplo na entrada pode tocar o stop e contar como perda pela regra conservadora.
- **Gaps**: um gap abaixo do stop faz a perda passar de 1R.
- **Poucos sinais no semanal e no mensal**: 10 anos de gráfico semanal são cerca de 520 candles; de mensal, 120. Pode não haver operações suficientes para concluir nada. Pelas regras do laboratório, menos de 30 operações é "inconclusivo".
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento parece uma queda e bagunça a pernada e a referência.

## Lacunas e decisões nossas

- **"Fechamentos crescentes"**: a especificação fala em "MME9 apontando para cima, com fechamentos crescentes". O Radar não exige uma sequência de fechamentos crescentes: qualquer trecho com a MME9 subindo é pernada, mesmo de um candle só. O próprio candle que virou a MME9 pode ser a referência.
- **MME9 parada**: zera a pernada, mas não desarma uma ocorrência armada. Só a MME9 caindo desarma; com ela parada, o gatilho continua sendo deslocado.
- **"Enquanto a MME9 seguir para cima"**: o deslocamento do gatilho continua também com a MME9 parada, sem limite de candles.
- **Stop sem a referência**: a menor mínima da correção começa no candle seguinte à referência.
- **Rearmar na mesma pernada**: depois de um stop ou alvo, a mesma pernada pode armar outra vez.
- **Saída dinâmica**: a especificação só prevê alvo de 2R ou 3R para o 9.2. O Radar também aceita a saída dinâmica do 9.1, com stop de proteção sempre.
- **Sem filtro de ADX**: o painel de contexto diz que ADX abaixo de 20 é lateral e que setups de tendência não deveriam ser operados assim. O 9.2 segue o texto da sua própria regra, que não tem filtro; o ADX aparece no [painel de contexto](/biblioteca/painel-contexto) para você decidir.
- **Gatilho por toque**: ordem stop; a regra "rompimento só vale por fechamento" das primitivas não se aplica.
- **Candle da entrada**: só o stop é conferido, e conta mesmo que a mínima tenha vindo antes da compra. Escolha conservadora nossa.
- **Uma ocorrência por vez**, **sem estado "radar"** (já nasce armado) e o desarme aparece como "desarmado".
- **Venda espelhada**: não descrita nos vídeos; desligada por padrão.

## Resultados no laboratório
[[laboratorio]]

O botão acima abre o laboratório já com o 9.2. Lá você escolhe o ativo e o tempo gráfico, e o teste roda com os candles reais da fonte, os custos padrão do mercado, o imposto de renda simulado (só na B3), só compras e os valores padrão desta página. O resultado aparece ao lado do CDI e do comprar-e-segurar no mesmo período, separado em treino (70% iniciais) e teste (30% finais), com mapa de sensibilidade do alvo em R, walk-forward e Monte Carlo.

Para a recomendação do vídeo sobre as escalas, existe o **Experimento E3**, na tela "Verificar o youtuber" (botão no topo do Laboratório): ele roda o 9.2 e o 9.3 no mensal, no semanal, no diário e no 60 minutos, com os custos padrão e só compras, e compara a expectativa em R (depois dos custos, sem IR e sem CDI) do semanal e do mensal contra o diário, e do diário contra o 60 minutos. O próprio experimento avisa que, no semanal e no mensal, a amostra tende a ser pequena, e que o histórico de 60 minutos depende da fonte. Na B3, anos de histórico diário, semanal e mensal só existem se o arquivo COTAHIST da própria B3 tiver sido importado no servidor; sem ele, o ativo aparece como erro na tabela, sem dados inventados.

Nada nesta página é resultado medido: os números dependem do ativo, do período e da fonte.

## Críticas

- **Recomendação sem números conhecidos.** "Use no semanal e no mensal" é afirmação do vídeo. A especificação não registra números que a sustentem; é o que o Experimento E3 mede.
- **Exemplos escolhidos depois do fato.** Num gráfico pronto, é fácil mostrar correções que viraram alta e esquecer as que viraram queda. O Radar marca todas.
- **Amostra pequena.** No semanal e no mensal, poucas operações podem parecer ótimas por sorte. Pelas regras do laboratório, menos de 100 operações é "evidência fraca".
- **9.2 e 9.3 não são duas provas.** Como no exemplo, os dois costumam armar nos mesmos lugares. Se os dois "funcionarem", isso é quase a mesma evidência contada duas vezes.
- **Viés de sobrevivência.** Testar só as ações que existem hoje deixa de fora as que caíram e saíram da bolsa, e o resultado sai otimista.
- **Custo de oportunidade.** No semanal, uma operação pode durar meses. O resultado precisa vir depois de custos e IR e ser comparado com o CDI do mesmo período. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **Conflito de interesse.** Os vídeos vendem um serviço de assinatura.
