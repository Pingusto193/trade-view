---
titulo: Payoff
categoria: conceito
resumo: Payoff é o ganho médio dividido pela perda média. Sozinho não diz nada: precisa ser lido junto com a taxa de acerto e depois dos custos.
relacionados: expectativa, r-multiplo, drawdown, gestao-de-risco, slippage-e-custos
---

## O que é

`payoff = ganho médio dos trades vencedores ÷ perda média dos perdedores`

A perda média entra sem o sinal de menos. Payoff 2 quer dizer: quando ganha, ganha em média o dobro do que perde quando perde.

## Exemplo hipotético

Dez trades, já com custos:

| Trades | Resultados | Média |
|---|---|---|
| 4 vencedores | R$ 180,00; R$ 220,00; R$ 150,00; R$ 250,00 | R$ 200,00 |
| 6 perdedores | −R$ 100,00; −R$ 95,00; −R$ 110,00; −R$ 100,00; −R$ 105,00; −R$ 90,00 | −R$ 100,00 |

Payoff = 200,00 ÷ 100,00 = **2,0**. Resultado total: 800,00 − 600,00 = **+R$ 200,00**.

## Planejado e realizado

- A **relação R:R** do plano (por exemplo, alvo em 2R) é o que você **planeja** para um trade.
- O **payoff** é o que **aconteceu**, na média de muitos trades.

Os dois podem ficar bem diferentes. Saídas antes do alvo, stops com gap, derrapagem e taxas puxam o payoff realizado para baixo do planejado. Por isso o Radar mede o realizado, e não só o que estava no plano.

## Payoff sozinho não diz nada

Um payoff alto com acerto baixo pode perder dinheiro. Um payoff baixo com acerto alto pode ganhar. A taxa de acerto mínima para empatar, antes de custos, é:

`acerto mínimo = 1 ÷ (1 + payoff)`

| Payoff | Acerto mínimo para empatar |
|---|---|
| 0,5 | 66,7% |
| 1 | 50% |
| 2 | 33,3% |
| 3 | 25% |

Abaixo desse acerto, a estratégia perde; acima, ganha — **antes de custos e IR**. A conta completa, com custos, está em [Expectativa](/biblioteca/expectativa).

## Fator de lucro

É parecido, mas usa somas em vez de médias:

`fator de lucro = soma dos ganhos ÷ soma das perdas`

No exemplo: 800,00 ÷ 600,00 = 1,33. Acima de 1, o período fechou positivo.

## Regras exatas no Radar

- O laboratório calcula o payoff em dinheiro (não em R), com os resultados **depois dos custos** (taxas, spread e derrapagem), sem IR.
- Um trade que termina exatamente em zero conta como perdedor.
- Sem nenhum vencedor ou sem nenhum perdedor, o payoff fica vazio: não há o que dividir.
- Junto com o payoff, o laboratório mostra a taxa de acerto, o fator de lucro e a [expectativa](/biblioteca/expectativa) em [R](/biblioteca/r-multiplo), sempre com o número de trades.

## Limites

- **Poucos trades grandes distorcem a média.** Um único ganho excepcional pode inflar o payoff de uma amostra pequena.
- **Alvo mais longe tende a subir o payoff e baixar o acerto**: o preço precisa andar mais para chegar lá, e mais trades param no stop antes. Com acerto baixo, sequências longas de perdas ficam mais prováveis. Veja [Drawdown](/biblioteca/drawdown).
- **Amostra**: com menos de 30 trades, o Radar chama o resultado de inconclusivo; com menos de 100, de evidência fraca.
