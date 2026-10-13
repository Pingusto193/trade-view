---
titulo: Expectativa
categoria: conceito
resumo: Quanto uma estratégia ganha ou perde, em média, por trade. A conta "40% de acerto com 1:2" do vídeo, refeita com custos, e por que amostra pequena engana.
relacionados: payoff, r-multiplo, slippage-e-custos, drawdown, gestao-de-risco, antes-de-arriscar-dinheiro, contradicoes-entre-as-fontes
---

## O que é

**Expectativa** é o resultado médio por trade, somando acertos e erros. Se ela foi positiva depois de custos e impostos, a estratégia ganhou dinheiro **no período medido**. Isso não garante que vá continuar ganhando.

`expectativa = (acerto × ganho médio) − (erro × perda média)`

"Acerto" é a fração de trades vencedores, e "erro" é 1 − acerto. Medindo em [R](/biblioteca/r-multiplo), e supondo que cada perda seja exatamente 1R:

`expectativa em R = acerto × payoff − (1 − acerto)`

O [payoff](/biblioteca/payoff) é o ganho médio dividido pela perda média.

## A conta do vídeo

O vídeo afirma que, em 10 trades com 40% de acerto e relação 1:2, o resultado é positivo, **sem considerar custos**:

- 4 acertos × (+2R) = +8R;
- 6 erros × (−1R) = −6R;
- total: **+2R** em 10 trades, ou **+0,2R por trade**.

A conta está certa. O problema é o que ela deixa de fora.

## A mesma conta com custos (exemplo hipotético)

Suponha que cada trade custe, em média, **0,15R** em taxas e derrapagem. Depois, suponha também que os stops saiam, em média, 0,10R piores que o nível (por gap ou derrapagem extra).

| Cenário | Cada acerto | Cada erro | 10 trades | Por trade |
|---|---|---|---|---|
| Sem custos (conta do vídeo) | +2,00R | −1,00R | 8,00 − 6,00 = +2,00R | +0,20R |
| Custos de 0,15R por trade | +1,85R | −1,15R | 7,40 − 6,90 = +0,50R | +0,05R |
| Custos e stop saindo 0,10R pior | +1,85R | −1,25R | 7,40 − 7,50 = −0,10R | −0,01R |

A mesma regra, com o mesmo acerto, passou de lucro para prejuízo só por causa de custos que a conta original ignorava.

E ainda falta o imposto. Na B3, o IR é de 15% sobre o lucro líquido mensal no swing trade (compra e venda em dias diferentes) e de 20% no day trade (compra e venda no mesmo dia) (🟡, fontes secundárias). Ele leva uma parte dos meses positivos e não devolve nada nos negativos: o prejuízo só abate lucros futuros da mesma modalidade. Simplificando, se todo o resultado fosse lucro de day trade no mesmo mês, +0,05R por trade viraria +0,04R depois do IR.

### De onde poderiam vir 0,15R

Exemplo hipotético com os custos padrão do Radar para a B3 (taxa de 0,03% por execução, 🟡, e 1 tick de derrapagem nas ordens a mercado e stop, decisão nossa) e supondo, só para o exemplo, um tick (o menor degrau de preço) de R$ 0,01:

- Ação a R$ 25,00 com um stop curto, R$ 0,20 abaixo da entrada. Com 1R = R$ 100,00, são 500 ações, cerca de R$ 12.500,00 de posição.
- Taxas: cerca de 0,03% × R$ 12.500,00 = R$ 3,75 na entrada e quase o mesmo na saída. Total perto de R$ 7,50 (0,075R).
- Derrapagem: 500 × R$ 0,01 = R$ 5,00 na entrada (0,05R), e mais R$ 5,00 se a saída for no stop. O alvo é ordem limitada e não derrapa.
- Custo de um acerto: cerca de 0,125R. Custo de um erro: cerca de 0,175R. Com 40% de acerto, a média fica perto de **0,15R**.

Com o mesmo risco de R$ 100,00 e um stop de R$ 2,00 (dez vezes mais longe), seriam só 50 ações (R$ 1.250,00), e os custos cairiam para menos de 0,02R por trade. **Quanto mais curto o stop, maior a posição e mais os custos pesam em R.** Por isso operações rápidas, com stops curtos, sofrem mais com custos.

No laboratório, o **Experimento E6** (tela "Verificar o youtuber", aberta por um botão no topo do Laboratório) refaz a conta "40% de acerto com 1:2 dá lucro" para cada ativo e tempo gráfico (5, 15 e 60 minutos contam como day trade; o diário, como swing). Ele usa como stop típico 1 ATR14 (decisão nossa), transforma o custo de ida e volta em R e calcula o acerto mínimo para empatar. O IR simulado só vale para a B3. O E6 supõe os 40% de acerto do vídeo em qualquer escala: é a premissa do vídeo, não um fato.

## Amostra pequena engana

Mesmo sem custos, 10 trades dizem muito pouco. Um exemplo feito só com conta de probabilidade, sem dado de mercado:

- Imagine uma estratégia com payoff 2 cuja taxa de acerto **verdadeira** é de 30%. A expectativa dela é 0,30 × 2 − 0,70 = **−0,10R por trade**: ela perde dinheiro.
- Mesmo assim, em 10 trades, ela mostra 40% de acerto ou mais em cerca de **35%** das vezes — mais de uma vez em cada três.
- Em 100 trades, a chance de ela mostrar 40% ou mais cai para cerca de **2%**.
- O contrário também acontece: uma estratégia com acerto verdadeiro de 40% mostra 3 acertos ou menos em 10 trades em cerca de 38% das vezes.

Por isso o Radar rotula toda estatística pelo tamanho da amostra:

- menos de 30 trades: **inconclusivo**;
- de 30 a 99 trades: **evidência fraca**;
- 100 trades ou mais: **amostra razoável** — que ainda não é garantia.

Outras armadilhas que o laboratório trata:

- **Muitas tentativas**: testar dezenas de variações e ficar com a melhor aumenta a chance de achar uma expectativa bonita só por sorte. O laboratório registra cada teste e mostra quantas vezes você já testou o mesmo ativo com os mesmos setups.
- **Fora da amostra**: o período é dividido em ordem cronológica, em treino (70% iniciais) e teste (30% finais). O laboratório também faz o **walk-forward**: escolhe o melhor valor do número principal do setup olhando só para o passado e mede no trecho seguinte.
- **Pico isolado**: o mapa de sensibilidade repete o teste mudando o número principal do setup (nos setups 9.x, o alvo: 1,5R, 2R, 2,5R e 3R). Se um passo para o lado deixa a expectativa negativa, o bom resultado provavelmente foi sorte.

O laboratório só dá **"aprovado"** quando tudo isto acontece junto: pelo menos 100 trades; expectativa positiva depois dos custos e resultado positivo depois de custos e IR; pelo menos 30 trades no teste, também positivos em R e em dinheiro depois do IR; os valores vizinhos no mapa de sensibilidade (um passo para cada lado) também com expectativa positiva; walk-forward com expectativa acima de zero fora da amostra (quando há trades para medir); e resultado igual ou acima do CDI do período (quando o Banco Central responde; sem esse dado, a tela avisa que a comparação ficou indisponível). Mesmo assim, a tela lembra que o passado não garante o futuro.

## Regras exatas no Radar

- **Laboratório**: expectativa em R = média do R de todos os trades, já descontados os custos (sem IR). Também mostra a expectativa em dinheiro por trade e o resultado final depois do IR (simulado só na B3), ao lado do CDI e do comprar e segurar (buy & hold) no mesmo período.
- **Como medir a expectativa real de um setup**: use o botão "Testar no laboratório" na página dele. O teste usa os candles reais da fonte, os custos padrão do mercado, o IR simulado (só na B3), só compras e os valores padrão do setup, e mostra o resultado ao lado do CDI. É a conta desta página feita com dados de verdade, e não com a premissa do vídeo.
- **Modo Treino**: o diário mostra a média em R dos trades com stop, o resultado em R$ já com custos e o aviso de amostra pequena quando há menos de 30 trades. O Painel de prontidão (na página Treino) só marca a expectativa como cumprida quando a média em R fica acima de zero **e** o resultado da conta continua positivo depois do IR simulado.
- **Painel de Setups no gráfico**: a média em R das ocorrências é sem custos e sem IR. Não é backtest.

## Limites

- **O passado não garante o futuro.** O mercado muda, e uma expectativa medida em um período pode sumir no seguinte.
- **Expectativa positiva pode render menos que o CDI.** Exemplo hipotético: +0,05R por trade, 20 trades por ano e 1% de risco por trade dão cerca de +1R no ano, ou perto de +1% do capital. Compare com o CDI em [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **A média não mostra o caminho.** Uma expectativa positiva pode vir com quedas grandes no meio. Veja [Drawdown](/biblioteca/drawdown).
- **Os custos usados são estimativas.** Os do Radar são aproximados (🟡) ou decisão nossa. Veja [Slippage e custos](/biblioteca/slippage-e-custos).
