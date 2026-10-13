---
titulo: R-múltiplo (R)
categoria: conceito
resumo: R é quanto você arrisca num trade, da entrada até o stop. Medir resultados em R permite comparar trades de tamanhos, contas e ativos diferentes.
relacionados: gestao-de-risco, payoff, expectativa, drawdown, slippage-e-custos, atr-e-stop-atr
---

## O que é

**R** é o valor que você aceita perder num trade se o stop for atingido:

`R = distância entre entrada e stop × quantidade × valor do ponto`

O **resultado em R** é o resultado do trade dividido por esse valor. Ganhar o dobro do que arriscou é **+2R**. Perder exatamente o que arriscou é **−1R**. Em ações, o valor do ponto é 1; em contratos futuros, é o valor em reais de cada ponto (veja [Gestão de risco](/biblioteca/gestao-de-risco)).

## Exemplo hipotético

Compra de 100 ações a R$ 20,00, com stop em R$ 19,00. O risco por ação é R$ 1,00, então **1R = R$ 100,00**.

| Como saiu | Resultado | Em R |
|---|---|---|
| No alvo, em R$ 22,00 | +R$ 200,00 | +2R |
| No stop, em R$ 19,00 | −R$ 100,00 | −1R |
| Saída antes do alvo, em R$ 20,50 | +R$ 50,00 | +0,5R |
| Gap: abriu em R$ 18,40 e o stop saiu na abertura | −R$ 160,00 | −1,6R |

Tudo sem custos, para simplificar. Com R$ 4,00 de custos no trade, por exemplo, o stop vira −R$ 104,00, ou seja, −1,04R.

## Por que o Radar mede em R

- **Compara coisas diferentes**: um trade de R$ 50,00 numa conta pequena e um de R$ 500,00 numa conta grande podem ser o mesmo +1R. Ações, cripto e mini-índice ficam na mesma régua.
- **Liga o resultado ao plano**: o R nasce do stop técnico, que você define antes de entrar.
- **Separa a regra do tamanho da aposta**: a [expectativa](/biblioteca/expectativa) e o [payoff](/biblioteca/payoff) em R dizem se a regra funcionou. O risco por trade diz quanto isso mexe no seu capital. Com 1% de risco por trade, +2R é cerca de +2% do patrimônio daquele momento.
- **Denuncia gaps e custos**: se as suas perdas costumam passar de −1R, o stop está saindo pior do que o planejado.

## Regras exatas no Radar

- **Backtest do laboratório** (o teste das regras em dados do passado): R = resultado do trade, já descontados os custos (sem IR), ÷ risco planejado. O risco planejado usa o preço de entrada **já executado** (com spread e derrapagem) e o stop: distância × quantidade × valor do ponto.
- **Modo Treino**: R = resultado realizado em R$ (já com custos) ÷ risco inicial em R$. O risco inicial usa o preço médio de entrada, o **stop inicial**, a maior quantidade que a posição teve e, em ativos em dólar, a cotação do dólar na entrada. Mover o stop depois não muda o R.
- **Trade sem stop não tem R**: o diário mostra "R —" e o trade conta como indisciplina no diário e no Painel de prontidão (na página Treino).
- **Painel de Setups no gráfico**: mostra a média em R das ocorrências do período carregado, **sem custos e sem IR**. Isso não é backtest.
- Os alvos dos setups são definidos em R (por exemplo, 2R ou 3R), e o plano de trade avisa quando a relação retorno/risco fica abaixo de 2.

## Limites

- **R depende de onde está o stop.** Um stop muito curto deixa o R pequeno e faz os ganhos parecerem enormes em R. Mas o preço atinge esse stop com mais facilidade, e os custos pesam mais (veja [Slippage e custos](/biblioteca/slippage-e-custos)).
- **R não mostra o tempo.** +1R em uma semana e +1R em um ano são iguais em R, mas não diante do CDI.
- **A média em R esconde a ordem dos resultados.** Duas sequências com a mesma média podem ter quedas muito diferentes. Veja [Drawdown](/biblioteca/drawdown).
- **R não inclui IR.** No laboratório, o imposto (simulado só na B3) entra no resultado final, que é comparado com o CDI e com o comprar e segurar. Para saber quanto um setup rende em R depois dos custos, use o botão "Testar no laboratório" na página do setup.
