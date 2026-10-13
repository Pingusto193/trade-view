---
titulo: Gestão de risco
categoria: conceito
resumo: Quanto arriscar por trade, onde pôr o stop e como o Radar calcula a quantidade pelo risco. Serve para perder pouco quando errar, não para garantir lucro.
relacionados: r-multiplo, drawdown, expectativa, slippage-e-custos, psicologia, atr-e-stop-atr, contradicoes-entre-as-fontes
---

## O que é

Gestão de risco é decidir, **antes de entrar**, quanto você aceita perder se estiver errado. Só depois disso você calcula quantas ações (ou contratos) comprar. Ela não aumenta a chance de acerto. O que ela faz é impedir que alguns erros seguidos destruam a conta.

São três peças:

- **Stop técnico**: o preço em que a sua ideia deixa de fazer sentido ("onde a tese morre"). Se o preço chegar lá, você sai.
- **Risco por trade**: quanto do capital você aceita perder se o stop for atingido, em porcentagem.
- **Tamanho da posição**: a quantidade que faz a perda no stop ficar igual ao risco escolhido.

## O que o vídeo afirma

Segundo o vídeo:

- o stop técnico é definido antes da entrada e nunca é movido contra o trade;
- o risco por trade fica entre 1% e 2% do capital, e em 1% para quem está começando;
- o alvo mínimo é de 2R, ou seja, duas vezes o valor arriscado (veja [R-múltiplo](/biblioteca/r-multiplo)).

São regras do canal, não fatos comprovados. Em outro vídeo, o limite aparece como "até 3%" — veja a contradição mais abaixo.

## Regras exatas no Radar

### Risco por trade

- Padrão: **1%** do capital por trade.
- Existe um **limite máximo** por trade, que por padrão é de **2%**. Se o risco escolhido passar dele, aparece o aviso "Risco de X% passa do seu limite de Y% por trade".
- Se o limite for maior que 2% e o risco ficar entre 2% e o limite, o aviso é "Risco de X% por trade está acima de 2%".
- No Modo Treino, a conta usa o patrimônio atual da conta de treino. Na ferramenta de posição do gráfico, usa o capital das preferências (padrão: R$ 10.000,00).
- No laboratório, você escolhe o capital inicial e o risco por trade (padrões: 10.000 na moeda do ativo e 1%). Cada trade do teste é dimensionado pelo patrimônio daquele momento, sem alavancagem: se a compra não couber no patrimônio, a quantidade é reduzida.
- Os avisos não bloqueiam nada. No treino, eles ficam gravados no plano de trade, como registro do que você sabia na hora de entrar.
- No Painel de prontidão (página Treino), um trade com risco na entrada acima do seu limite conta contra a disciplina.

### Stop técnico

- O plano de trade só fica **Liberado** com o stop técnico preenchido.
- Sem stop, a boleta do treino (o quadro onde você monta a ordem de compra) avisa: "Sem stop: o trade não tem risco definido e não entra nas estatísticas em R". O trade conta como indisciplina.
- **O stop só anda a favor.** Numa compra, subir o stop é livre. Baixar o stop (afastá-lo) exige confirmação e fica gravado como "stop movido para trás", que derruba a estatística de disciplina.

### Cálculo da posição

É a mesma conta na ferramenta de posição do gráfico, na boleta do Modo Treino e no backtest do laboratório (o teste das regras em dados do passado):

1. **Orçamento de risco** = capital × risco % ÷ 100.
2. **Risco por unidade** = distância entre a entrada e o stop × valor do ponto. Em ações, o valor do ponto é 1. No mini-índice é R$ 0,20 por ponto e no mini-dólar, R$ 10,00 por ponto (🟡, fontes secundárias; confira na sua corretora).
3. **Quantidade** = orçamento ÷ risco por unidade, **sempre arredondada para baixo** até o passo de negociação do ativo.
4. Se nem a quantidade mínima couber no orçamento, a quantidade vira zero e o aviso diz: "Aumente o capital, aproxime o stop ou não opere".
5. Na B3, a quantidade é dividida em **lotes padrão de 100** mais o resto no mercado fracionário (onde se negociam quantidades menores que um lote).

Stop abaixo da entrada quer dizer compra; stop acima, venda. A calculadora fica em [Calculadora de posição](/calculadora) (menu Mais), com as regras de ações da B3, minicontratos, ações dos EUA, cripto e forex. No forex, 1 lote = 100.000 da moeda base e o resultado sai na moeda de cotação do par (🟡; o lote mínimo varia por corretora). A calculadora também calcula:

- **valor alocado** = quantidade × entrada × valor do ponto (nos futuros, é o valor total dos contratos, não a margem);
- **perda máxima** = quantidade × risco por unidade;
- **ganho no alvo** e **relação R:R** = (alvo − entrada) ÷ (entrada − stop), numa compra.

Na boleta do treino, ela avisa quando:

- o alvo está do lado errado da entrada;
- a relação retorno/risco fica abaixo de 2R;
- o valor alocado passa do capital ("exige alavancagem ou margem").

### Exemplo hipotético: ações da B3

Capital de R$ 20.000,00 e risco de 1%: orçamento de **R$ 200,00**. Entrada em R$ 25,40, stop em R$ 24,10 e alvo em R$ 28,00.

| Passo | Conta | Resultado |
|---|---|---|
| Risco por ação | 25,40 − 24,10 | R$ 1,30 |
| Quantidade | 200,00 ÷ 1,30 = 153,8 (para baixo) | 153 ações |
| Divisão na B3 | 1 lote de 100 + 53 no fracionário | 153 ações |
| Valor alocado | 153 × 25,40 | R$ 3.886,20 |
| Perda máxima no stop | 153 × 1,30 | R$ 198,90 |
| Ganho no alvo | 153 × (28,00 − 25,40) | R$ 397,80 |
| Relação R:R | 2,60 ÷ 1,30 | 2,0 |

A perda máxima ficou um pouco abaixo de R$ 200,00 por causa do arredondamento para baixo. Essa conta **não inclui custos, derrapagem nem gaps**. No Modo Treino, cada execução paga taxas e derrapagem, e um gap (salto de preço de um candle para o outro) pode fazer o stop sair pior que o nível. Por isso a perda real num stop pode passar um pouco de 1R. Veja [Slippage e custos](/biblioteca/slippage-e-custos).

### Exemplo hipotético: mini-índice

Capital de R$ 10.000,00 e risco de 1%: orçamento de R$ 100,00. Entrada em 130.000 pontos e stop em 129.800: são 200 pontos × R$ 0,20 = R$ 40,00 de risco por contrato. Quantidade: 100,00 ÷ 40,00 = 2,5, para baixo: **2 contratos**, com perda máxima de R$ 80,00 no stop.

Mas o valor alocado é 2 × 130.000 × 0,20 = **R$ 52.000,00**, mais de cinco vezes o capital. A calculadora avisa que isso exige alavancagem ou margem: operar um valor maior que o seu dinheiro, deixando na corretora só uma garantia (a margem). O risco até o stop é pequeno; o risco de um gap grande contra você, não. No Modo Treino não há alavancagem: a compra precisa caber no saldo.

## Por que um percentual pequeno

Exemplo hipotético: 10 stops seguidos, cada um custando exatamente o risco escolhido, sempre calculado sobre o patrimônio do momento e sem custos.

| Risco por trade | Patrimônio depois de 10 stops | Queda | Alta necessária para voltar |
|---|---|---|---|
| 1% | 90,4% do inicial | 9,6% | +10,6% |
| 2% | 81,7% do inicial | 18,3% | +22,4% |
| 3% | 73,7% do inicial | 26,3% | +35,6% |

Qualquer estratégia que não acerta sempre pode ter sequências de perdas. Quanto maior o risco por trade, mais funda a queda e mais difícil a volta. Veja [Drawdown](/biblioteca/drawdown).

Para ver isso com um setup de verdade, teste-o no laboratório (botão "Testar no laboratório" na página do setup). O Monte Carlo do laboratório sorteia 5.000 novas sequências com os mesmos resultados em R do backtest e mostra, com o risco por trade que você escolheu, a chance de, em algum momento, estar perdendo 10%, 20%, 30% ou 50% do capital inicial. Rodar o mesmo teste com 1% e com 2% mostra quanto o risco por trade muda essas chances.

## A contradição: 1 a 2% ou até 3%?

- **Um vídeo** fala em 1 a 2% por trade, com 1% para iniciante.
- **Outro vídeo** aceita até 3%.
- **No setup de reflexividade**, segundo a especificação, o vídeo fala em "vai na jugular" (posição gigante), o que não cabe em nenhum dos dois limites.

O que o Radar faz: usa 1% como padrão, avisa quando o risco passa do limite (padrão de 2%) e nunca esconde o aviso. Na [reflexividade](/biblioteca/reflexividade), a especificação pede entrada em etapas, sempre dentro do limite de risco; hoje o Radar marca só a primeira parte dessa entrada. Mais em [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes).

## Limites

- O stop não garante o preço. Com gap, a execução acontece na abertura, pior que o nível.
- 1% é uma regra de bolso do canal, não um número calculado para você. E ela não diz se a estratégia ganha dinheiro: isso é a [expectativa](/biblioteca/expectativa).
- Stop muito curto deixa a posição grande. Como os custos crescem com o tamanho da posição, eles pesam mais em R.
- A calculadora usa o preço que você digitou. O preço executado pode ser diferente.
- Nos futuros, a margem exigida varia por corretora e não entra na conta.
