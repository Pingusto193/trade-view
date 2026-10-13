---
titulo: Heikin-Ashi
categoria: indicador
resumo: Candles desenhados com médias, que deixam o gráfico mais "limpo". No Radar é só visual: os preços não são negociáveis e nenhum cálculo usa esses preços.
relacionados: candles, medias-moveis, teoria-de-dow, slippage-e-custos
---

## O que é

Heikin-Ashi é outro jeito de desenhar os candles. Em vez de mostrar a abertura, a máxima, a mínima e o fechamento reais, cada candle mostra **médias** do candle atual com o anterior. O resultado é um gráfico mais "limpo", que tende a mostrar sequências mais longas da mesma cor.

O preço de um candle Heikin-Ashi é **calculado, não negociado**. O "fechamento" dele, por exemplo, quase nunca é o último preço do período.

## Regras exatas no Radar

Para cada candle real:

| Valor Heikin-Ashi | Conta |
|---|---|
| Fechamento | (abertura + máxima + mínima + fechamento reais) ÷ 4 |
| Abertura | (abertura Heikin-Ashi anterior + fechamento Heikin-Ashi anterior) ÷ 2; no primeiro candle carregado no gráfico, (abertura real + fechamento real) ÷ 2 |
| Máxima | a maior entre a máxima real, a abertura Heikin-Ashi e o fechamento Heikin-Ashi |
| Mínima | a menor entre a mínima real, a abertura Heikin-Ashi e o fechamento Heikin-Ashi |
| Volume | o mesmo do candle real |

- **Só visual.** Para usar, escolha "Heikin-Ashi" no seletor de tipo de gráfico. Enquanto ele estiver ligado, uma faixa de aviso fica no topo: "Heikin-Ashi é só visual: os preços mostrados não são negociáveis. Indicadores e setups usam os candles reais."
- **Nenhum cálculo do Radar usa Heikin-Ashi.** Médias, Bollinger, ADX, ATR, Stop ATR, volume, painel de contexto e detectores de setups usam sempre os candles reais. O Heikin-Ashi existe só no desenho do gráfico.
- **A legenda continua real**: no topo do gráfico, abertura, máxima, mínima e fechamento do candle sob o cursor são os **reais**, mesmo no modo Heikin-Ashi.

### Exemplo hipotético

Candle real: abertura R$ 10,00, máxima R$ 12,00, mínima R$ 9,00, fechamento R$ 11,00. O candle Heikin-Ashi anterior teve abertura R$ 9,80 e fechamento R$ 10,20.

- Fechamento Heikin-Ashi = (10,00 + 12,00 + 9,00 + 11,00) ÷ 4 = **R$ 10,50**
- Abertura Heikin-Ashi = (9,80 + 10,20) ÷ 2 = **R$ 10,00**
- Máxima = R$ 12,00; mínima = R$ 9,00

O candle real fechou em R$ 11,00; o Heikin-Ashi mostra R$ 10,50. Uma ordem pensada como "1 centavo acima do fechamento" a partir do Heikin-Ashi estaria no lugar errado.

## Como ler

- Uma sequência de candles Heikin-Ashi da mesma cor mostra que o preço vem andando numa direção. Como cada candle é média do anterior, a cor demora a mudar.
- Um candle Heikin-Ashi de alta sem sombra inferior quer dizer, pela conta, que a mínima real não ficou abaixo da abertura Heikin-Ashi.
- Corpos pequenos com sombras dos dois lados mostram indecisão recente.
- Nenhuma dessas leituras faz parte de regra do Radar. Para qualquer preço de entrada, stop ou alvo, volte aos candles comuns.

## Quando engana

- **Atraso**: por ser média, o Heikin-Ashi muda de cor depois dos candles reais. Num movimento rápido, você vê a virada tarde.
- **Gaps somem**: a abertura Heikin-Ashi é a média do candle anterior, então os saltos de preço entre um candle e outro ficam escondidos.
- **Cor diferente da real**: um candle real de baixa pode aparecer verde no Heikin-Ashi, e vice-versa.
- **Padrões de candle não valem**: martelo, doji, candle de força e inside bar são definidos com preços reais ([Primitivas de price action](/biblioteca/primitivas-price-action)). No Heikin-Ashi, a forma do candle é outra.

## De onde veio

O Heikin-Ashi entrou no Radar como opção de exibição pedida na especificação, ao lado dos candles comuns e do gráfico de linha. Ele não aparece no resumo dos vídeos do canal. A origem do método não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- Um gráfico mais bonito pode dar confiança demais: a tendência parece mais limpa do que foi na vida real.
- Um teste de estratégia que "compra no preço Heikin-Ashi" usa preços que talvez nunca tenham sido negociados e pode parecer muito melhor do que seria possível. O Radar evita isso calculando tudo nos candles reais.
- Se for usar, use só para ter uma visão geral da direção, e decida entradas e stops no gráfico comum.
