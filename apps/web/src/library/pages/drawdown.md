---
titulo: Drawdown
categoria: conceito
resumo: Drawdown é a queda do patrimônio desde o último topo. O tamanho e a duração da pior queda dizem mais sobre o risco de uma estratégia do que a média.
relacionados: gestao-de-risco, expectativa, r-multiplo, psicologia, payoff, antes-de-arriscar-dinheiro
---

## O que é

**Drawdown** é a queda do patrimônio desde o maior valor que ele já tinha alcançado (o "topo").

- **Drawdown máximo**: a maior dessas quedas no período, em porcentagem do topo.
- **Duração**: quanto tempo passou desde o topo até o patrimônio voltar a ele — ou até o fim dos dados, se não voltou.
- **Maior sequência de perdas**: quantos trades perdedores aconteceram seguidos.

## Exemplo hipotético

Uma conta começa com R$ 10.000,00, sobe até R$ 11.000,00 (o topo), cai até R$ 9.350,00 e só volta a R$ 11.000,00 sete meses depois do topo.

- Drawdown máximo: (11.000,00 − 9.350,00) ÷ 11.000,00 = **15%**.
- Duração: **7 meses**.
- Para sair de R$ 9.350,00 e voltar a R$ 11.000,00, o patrimônio precisou subir **17,6%**.

A conta nunca ficou mais de R$ 650,00 abaixo do capital inicial. Mesmo assim, a queda conta a partir do topo: o lucro que já estava na conta e foi devolvido também é perda.

## Por que importa mais que a média

### A volta é sempre mais difícil que a queda

| Queda | Alta necessária para voltar |
|---|---|
| 10% | +11,1% |
| 20% | +25% |
| 30% | +42,9% |
| 50% | +100% |

### A média esconde o caminho

Duas estratégias podem terminar o período com o mesmo resultado: uma caiu no máximo 8% no caminho, a outra 35%. Na média, são iguais. Na prática, a segunda exige ver mais de um terço da conta sumir sem mudar as regras. É justamente durante uma queda longa que aparece a tentação de mudar tudo ou de buscar revanche (veja [Psicologia](/biblioteca/psicologia)).

### Tempo parado também custa

Enquanto o patrimônio está abaixo do topo, a estratégia não está ganhando nada, e o CDI continua rendendo para quem ficou na renda fixa. O resultado do laboratório mostra quantos dias durou o maior período abaixo do topo e, na mesma tela, o CDI do período testado. Uma queda que dura um ano e meio é um ano e meio sem ganho, comparado com o que o CDI teria rendido. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).

### O passado mostrou só uma ordem possível

O drawdown de um backtest vem de **uma** sequência de trades. Com os mesmos trades em outra ordem, a queda poderia ter sido maior. O futuro não vai repetir a mesma ordem.

### O risco por trade decide a profundidade

Com a mesma sequência de perdas, um risco maior por trade cava uma queda mais funda. Exemplo em [Gestão de risco](/biblioteca/gestao-de-risco): 10 stops seguidos levam a uma queda de 9,6% com 1% de risco por trade e de 26,3% com 3%.

## Regras exatas no Radar

- **Laboratório (backtest, o teste das regras em dados do passado)**: o patrimônio é calculado no fechamento de cada candle, contando a posição aberta pelo preço daquele momento. O drawdown máximo é a maior queda em porcentagem do topo. A duração é contada em dias, do topo até um novo topo (ou até o fim dos dados). O laboratório também mostra a maior sequência de perdas.
- **Monte Carlo**: o laboratório sorteia 5.000 novas ordens para os mesmos resultados em [R](/biblioteca/r-multiplo) (sorteio com reposição: um trade pode aparecer mais de uma vez), usando o seu risco por trade. A especificação pede 10 mil sorteios; o Radar faz 5.000 para o teste responder rápido (decisão nossa). Ele mostra a queda típica (percentil 50: metade das simulações cai menos que isso), uma queda ruim (percentil 95: só 1 em cada 20 simulações cai mais) e a chance de, em algum momento, perder 10%, 20%, 30% ou 50% do capital inicial.
- **Modo Treino**: o diário mostra a "Pior queda" em R$ e em %. Ela é calculada só com os trades **encerrados**, em ordem, a partir do saldo inicial da conta. Uma posição aberta perdendo ainda não entra.
- **Painel de prontidão** (na página Treino): um dos critérios é a maior queda da conta de treino ficar em até **20% do pico**. É uma régua nossa, que você pode mudar em "Ajustar a régua". Ele usa a mesma "Pior queda" do diário, contada desde o último reinício da conta. O painel nunca bloqueia nada: só mostra o que falta.

## Limites

- No backtest, o patrimônio é medido no fechamento dos candles. Dentro do candle, a queda pode ter sido maior.
- No treino, a "Pior queda" ignora posições abertas.
- O Monte Carlo embaralha os mesmos trades. Ele não inventa situações que nunca apareceram nos dados, como uma crise pior ou um gap maior.
- A pior queda do passado não é um limite para o futuro.
