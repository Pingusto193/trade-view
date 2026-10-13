---
titulo: ATR e Stop ATR
categoria: indicador
resumo: O ATR mede quanto o preço costuma andar por candle. O Stop ATR é um stop móvel que só anda a favor. Aqui estão as regras exatas do Radar.
relacionados: gestao-de-risco, r-multiplo, slippage-e-custos, expectativa, medias-moveis, adx
---

## O que é

O **ATR** ("amplitude média verdadeira") mede o tamanho típico de um candle, em preço. Se o ATR14 de uma ação é R$ 0,80, os últimos candles andaram, em média, cerca de R$ 0,80 cada, contando os saltos entre um candle e outro (gaps). Ele não diz a direção; diz o tamanho do "barulho" normal do ativo.

O **Stop ATR** é uma linha de stop móvel que fica a alguns ATRs de distância do preço. Na alta, fica abaixo do preço e só sobe. Na baixa, fica acima e só desce. Quando o preço fecha do outro lado da linha, ela "vira".

## Regras exatas no Radar

### True Range (TR)

O TR de cada candle é o maior entre:

- máxima − mínima;
- distância entre a máxima e o fechamento anterior;
- distância entre a mínima e o fechamento anterior.

No primeiro candle do histórico (que não tem fechamento anterior), TR = máxima − mínima.

### ATR14 (exibição)

- **Média de Wilder** de 14 TRs: alfa = 1 ÷ 14, com semente igual à média simples dos 14 primeiros TRs. Primeiro valor no 14º candle.
- Aparece só na legenda do gráfico, sem painel próprio. No celular, toque em "indicadores" na legenda para ver os valores.
- Por dentro, o Radar usa o ATR14 (e também ATR5 e ATR20, com a mesma suavização de Wilder) como régua: na [inclinação das médias](/biblioteca/medias-moveis), em "perto da média" (até 0,5 ATR), no tamanho máximo da caixa de consolidação (3 ATR) e na contração de volatilidade (ATR5 menor que ATR20).
- Mudar o período do ATR no editor de presets muda **só a legenda**: essas réguas internas continuam usando sempre ATR14, ATR5 e ATR20.

### Stop ATR

Parâmetros do preset "Padrão do canal":

| Item | Valor |
|---|---|
| Período do ATR | 20 |
| Suavização do ATR | exponencial (MME, alfa = 2 ÷ 21), com semente igual à média simples dos 20 primeiros TRs |
| Multiplicador (m) | 3 no diário e nas escalas intradiárias; 2 no semanal e no mensal |

A cada candle **fechado**:

1. **Começo** (no 20º candle): a linha começa "em alta", com stop = fechamento − m × ATR. Esse começo é uma convenção arbitrária e só afeta o aquecimento.
2. **Em alta**: se o fechamento ficar **abaixo** do stop anterior, a linha vira para baixa e o stop passa a ser fechamento + m × ATR. Senão, o stop é o **maior** entre o stop anterior e (fechamento − m × ATR). Ou seja: só sobe.
3. **Em baixa**: o espelho. Se o fechamento ficar **acima** do stop anterior, vira para alta, com stop = fechamento − m × ATR. Senão, o stop é o **menor** entre o stop anterior e (fechamento + m × ATR). Só desce.

- Quem vira a linha é o **fechamento**. Um pavio que atravessa o stop sem fechar do outro lado não vira. Fechar exatamente em cima do stop também não vira.
- No gráfico, a linha aparece como pontos: verdes quando acompanha uma alta, vermelhos quando acompanha uma baixa. A legenda mostra o multiplicador em uso (por exemplo, "Stop ATR × 3").
- No editor de presets, o campo "Mult. (diário/intra)" hoje só muda o multiplicador das escalas intradiárias: o diário continua em 3 e o semanal e o mensal, em 2. O período do ATR do Stop ATR pode ser mudado ali.
- Tudo usa os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).
- As contas são conferidas contra uma implementação independente (em Python), com tolerância de 1 parte em 1 bilhão.

### Decisões nossas

A especificação só diz "ATR de 20 com média exponencial; multiplicador 2 no semanal e 3 no diário". O jeito exato de mover e virar a linha, o multiplicador 3 no intradiário, o 2 no mensal e o começo "em alta" são **decisões nossas, não do vídeo**, registradas no projeto.

Nesta versão, o Stop ATR é **só uma linha no gráfico**. Nenhum setup, alerta ou backtest o usa como saída. A condução dinâmica dos setups usa médias: a MME9 no 9.1, 9.2, 9.3, recuo à média e rompimento de consolidação; a MME21 na [reflexividade](/biblioteca/reflexividade); e a média central da Bollinger, como alvo móvel, no [Elástico](/biblioteca/elastico). A especificação prevê o Stop ATR como uma das formas de conduzir o [recuo à média](/biblioteca/recuo-a-media), mas isso ainda não foi feito.

### Exemplo hipotético (diário, m = 3)

| Candle | Fechamento | ATR | Conta | Stop |
|---|---|---|---|---|
| 1 | R$ 30,00 | R$ 0,80 | 30,00 − 3 × 0,80 = 27,60; começa em alta | R$ 27,60 |
| 2 | R$ 30,50 | R$ 0,80 | 30,50 − 2,40 = 28,10; maior que 27,60, sobe | R$ 28,10 |
| 3 | R$ 29,00 | R$ 0,85 | 29,00 − 2,55 = 26,45; menor que 28,10, mantém | R$ 28,10 |
| 4 | R$ 28,00 | R$ 0,90 | fechou abaixo de 28,10: **vira para baixa**; 28,00 + 2,70 | R$ 30,70 |

### Usando a distância do stop no tamanho da posição (exemplo hipotético)

Capital de R$ 10.000,00 e risco de 1% por trade: R$ 100,00. Entrada em R$ 30,50 com stop em R$ 28,10: risco de R$ 2,40 por ação. Quantidade = 100,00 ÷ 2,40 = 41,67, arredondando sempre para baixo: **41 ações** (perda máxima de R$ 98,40 se o stop for executado exatamente no nível). Na B3, 41 ações ficam no mercado fracionário, porque o lote padrão é de 100. Custos, slippage e gaps não estão nessa conta — veja [Gestão de risco](/biblioteca/gestao-de-risco) e [Slippage e custos](/biblioteca/slippage-e-custos).

## Como ler

- **ATR maior** = candles maiores = o stop técnico precisa de mais espaço = posição menor para o mesmo risco em reais.
- **Pontos verdes abaixo do preço**: a linha está acompanhando uma alta. Quem usa o Stop ATR para conduzir sai quando o preço fecha abaixo dela.
- **Multiplicador maior** (3 em vez de 2) = stop mais longe: aguenta mais oscilação, mas devolve mais lucro quando vira.
- O vídeo afirma que é preciso "sair rápido quando errar e deixar o lucro correr". O Stop ATR é uma forma objetiva de "deixar correr", com custo: sempre devolve um pedaço do movimento.

## Quando engana

- **A linha olha o fechamento; a ordem na corretora, não**: uma ordem de stop real é executada quando o preço **toca** o nível, no meio do candle. A linha do Radar só vira no fechamento. Se você copiar o nível para uma ordem real, ela pode ser executada antes de a linha virar.
- **Gaps**: se o preço abrir além do stop, a execução real acontece na abertura, pior que o nível. É assim que o backtest do Radar conta um stop com gap contra.
- **Mercado lateral**: a linha vira para um lado e para o outro várias vezes, e cada virada seria um stop.
- **Volatilidade que muda**: depois de um choque, o ATR cresce e o stop novo nasce mais longe. Na alta, a regra "só sobe" segura o stop antigo; depois de uma virada, não.
- **Aquecimento**: nos primeiros candles a linha começa "em alta" por convenção, mesmo que o preço esteja caindo. Ignore o começo do histórico.
- **ATR é em preço**: R$ 0,80 de ATR é muito numa ação de R$ 10,00 e pouco numa de R$ 300,00. Para comparar ativos, pense em porcentagem do preço.

## De onde veio

O vídeo usa o ATR para definir o stop e para conduzir o trade (o "Stop ATR"). A especificação do Radar fixa o ATR de 20 com média exponencial para o Stop ATR, os multiplicadores 2 (semanal) e 3 (diário) e o ATR14 para exibição. A suavização do ATR14 é a de Wilder, que o código do Radar descreve como a do ATR clássico. A história do indicador e de quem o criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- Os multiplicadores 2 e 3 não vêm com estatística. Um stop mais largo é atingido menos vezes, mas perde mais quando é atingido. O que importa é a [expectativa](/biblioteca/expectativa) depois de custos e imposto, comparada com o CDI.
- Um stop móvel sempre devolve parte do lucro antes de sair. Hoje o laboratório **não** consegue comparar a condução por Stop ATR com alvos fixos em [R](/biblioteca/r-multiplo), porque nenhum setup usa o Stop ATR como saída. Até isso existir, a vantagem de conduzir pelo Stop ATR é afirmação do vídeo, sem teste no Radar.
- O Stop ATR usa média exponencial no ATR, e não a de Wilder. É escolha do canal; outra plataforma pode mostrar um "ATR 20" diferente do Radar.
