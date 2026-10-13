---
titulo: Slippage e custos
categoria: conceito
resumo: Corretagem, emolumentos, spread, derrapagem, IR e o custo de oportunidade do CDI. Como o Radar cobra cada um no treino e no backtest, sem aliviar.
relacionados: expectativa, r-multiplo, gestao-de-risco, antes-de-arriscar-dinheiro, payoff, drawdown
---

## O que é

Todo trade tem custos que não aparecem no gráfico. Uma estratégia que ganha "no papel" pode perder depois deles — veja a conta em [Expectativa](/biblioteca/expectativa).

### Os custos, um por um

- **Corretagem**: tarifa que a corretora cobra por ordem. Algumas corretoras cobram zero em ações no Brasil, outras não; nas ações dos EUA, depende da corretora internacional. Isso varia e não foi verificado (❌): confira a tabela da sua.
- **Emolumentos e taxas da B3**: cobrados sobre o valor negociado. Para pessoa física em ações, cerca de 0,030% do volume no swing trade (compra e venda em dias diferentes) e cerca de 0,023% no day trade (compra e venda no mesmo dia, até R$ 1 milhão por dia). As fontes divergem; há quem cite 0,039% (🟡).
- **Taxa da exchange de cripto**: na Binance (global), a taxa base no mercado à vista é de cerca de 0,1% por execução, com desconto por volume e com BNB (🟡).
- **Spread**: a diferença entre o melhor preço de quem vende e o melhor preço de quem compra. Quem compra a mercado paga o preço de cima; quem vende a mercado recebe o de baixo.
- **Slippage (derrapagem)**: a diferença entre o preço que você queria e o que conseguiu. O Radar mede a derrapagem em ticks; um tick é o menor degrau de preço do ativo. Acontece em ordens a mercado e em ordens stop, e tende a ser maior quando o preço anda rápido ou quando há pouca gente negociando.
- **Gap**: o preço abre longe de onde fechou. Um stop "atropelado" por gap é executado na abertura, pior que o nível.
- **Imposto de renda (B3)**: pelas regras de 2026 para ações (🟡, fontes secundárias): 15% sobre o lucro líquido mensal no swing trade e 20% no day trade; isenção para vendas de ações até R$ 20 mil por mês, só no swing (o limite é sobre o **valor vendido**, não sobre o lucro, e é "tudo ou nada"); imposto retido na fonte (IRRF) de 0,005% sobre as vendas no swing e de 1% sobre o lucro no day trade, descontado do imposto devido; DARF (a guia de pagamento do imposto) com código 6015; DARF abaixo de R$ 10 não é pago no mês e vai se somando aos meses seguintes; prejuízo só compensa lucro da mesma modalidade. Nada disso substitui um contador.
- **Imposto em cripto**: as regras estão em disputa e as fontes divergem (🟡 contraditório). O Radar deixa esses regimes desligados e avisa: consulte um contador.
- **Custo de oportunidade**: o dinheiro usado para operar poderia estar rendendo o CDI. Um resultado que, depois de custos e IR, rende menos que o CDI no mesmo período perdeu para a alternativa mais simples. A taxa atual está em [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).

## Regras exatas no Radar

### Custos padrão (Modo Treino e laboratório)

| Mercado | Taxa por execução | Spread | Derrapagem | Corretagem |
|---|---|---|---|---|
| B3 | 0,03% | zero | 1 tick | zero |
| Cripto | 0,1% | 0,02% | zero | zero |
| EUA | zero | zero | 1 tick | zero |
| Forex | zero | 0,02% | 2 ticks | zero |

- As taxas vêm das fontes acima (🟡). O spread de cripto e de forex e todas as derrapagens são **decisão nossa**, não foram medidos.
- O spread da tabela é o total. Metade dele é paga em cada execução a mercado ou stop.
- Na B3, o treino usa 0,03% tanto no swing quanto no day trade, sem separar.
- A página Treino mostra, em "Custos usados no treino", a tabela que a sua conta usa. Custo zero faria o treino parecer melhor do que o real.
- O laboratório e os experimentos usam sempre estes padrões; hoje não há tela para mudá-los lá.

### Modelo de execução conservador

O mesmo modelo vale para os detectores de setups, para o backtest e para o Modo Treino. A regra de ouro: **o treino nunca pode parecer melhor do que o real.**

1. **Entrada por ordem stop** (comprar quando o preço romper um nível): executa no gatilho. Se o candle abrir além do gatilho (gap), executa na abertura — sempre o pior preço.
2. **Stop com gap contra**: executa na abertura, e não no nível do stop.
3. **Alvo com gap a favor**: executa no alvo, e não na abertura, que seria melhor. É a escolha conservadora; a abertura existe como opção.
4. **Stop e alvo tocados no mesmo candle**: o Radar assume que o **stop** veio primeiro.
5. **No candle da entrada**, só o stop é verificado: não dá para saber se o alvo foi tocado antes ou depois da entrada.
6. Ordens a mercado, stops e saídas dinâmicas pagam **meio spread e a derrapagem**. O **alvo** é ordem limitada e não derrapa.
7. Taxas e corretagem são cobradas em **toda** execução.
8. No treino, uma ordem limitada só executa se o preço passar **além** do limite; tocar não basta. E só vale o que foi negociado **depois** que a ordem foi criada.

### Exemplo hipotético: stop atropelado por gap

Compra a R$ 20,00 com stop em R$ 19,00 (1R = R$ 1,00 por ação). No dia seguinte, a ação abre em R$ 18,40. O Radar executa o stop na abertura, menos a derrapagem: cerca de R$ 18,39, supondo um tick de R$ 0,01. A perda passa de 1R para cerca de **1,61R**, antes das taxas.

### Exemplo hipotético: um swing trade na B3

Com os padrões do treino e supondo um tick de R$ 0,01: compra de 300 ações a mercado, com a cotação em R$ 30,00, e venda no alvo, em R$ 32,00.

| Item | Conta | Valor |
|---|---|---|
| Compra executada | R$ 30,00 + 1 tick de derrapagem | R$ 30,01 |
| Taxa na compra | 0,03% × 300 × 30,01 | R$ 2,70 |
| Venda no alvo (limitada, sem derrapagem) | — | R$ 32,00 |
| Taxa na venda | 0,03% × 300 × 32,00 | R$ 2,88 |
| Resultado bruto | (32,00 − 30,01) × 300 | R$ 597,00 |
| Resultado depois das taxas | 597,00 − 2,70 − 2,88 | R$ 591,42 |

- **IR no swing**: se essa foi a única venda de ações do mês, os R$ 9.600,00 vendidos ficam abaixo de R$ 20 mil e o lucro é isento (🟡).
- **Se fosse day trade** (compra e venda no mesmo dia), não há isenção: 20% de R$ 591,42 = R$ 118,28 de IR (🟡), e sobram R$ 473,14.
- **Custo de oportunidade**: se os cerca de R$ 9.000,00 ficaram presos no trade por dois meses, compare os R$ 591,42 com o que o CDI teria rendido sobre esse valor nesses dois meses.

## Onde os custos aparecem

- **Modo Treino**: cada trade mostra os custos pagos, e o diário soma tudo em "Custos pagos". A página Brasil compara o resultado do treino (já com custos, sem IR) com o CDI do mesmo período. O Painel de prontidão, na página Treino, faz a mesma comparação com o resultado do treino já descontado o IR simulado (o CDI aparece antes do IR).
- **IR simulado**: só para a B3, no diário do treino e no laboratório. Para cripto e ações dos EUA, o laboratório avisa "IR não simulado" e o diário do treino só apura a B3.
- **Laboratório**: os resultados vêm depois dos custos e, na B3, do IR, sempre ao lado do CDI e do comprar e segurar (buy & hold) no mesmo período. É o jeito de ver quanto os custos tiram de um setup: use o botão "Testar no laboratório" na página dele.
- **Painel de Setups**: a média em R das ocorrências é **sem custos e sem IR**. Por isso não é backtest.

## Limites

- Os valores padrão são aproximados (🟡) ou decisão nossa. Confira a tabela da sua corretora.
- A derrapagem real muda com o ativo, o horário, o tamanho da ordem e a velocidade do preço. Usar 1 ou 2 ticks fixos é uma simplificação.
- O treino reconstrói o preço a cada atualização do candle de 1 minuto. Toques rápidos entre duas atualizações, que não renovam a máxima nem a mínima do minuto, não são vistos.
- Ativos da B3 que chegam com atraso (pela brapi) são executados no treino pelo preço atrasado, e a posição mostra esse aviso.
- O treino converte ativos em dólar pela cotação USDT/BRL da Binance, como aproximação do dólar, sem cobrar custo de câmbio.
- A corretora pode cobrar outras tarifas que o Radar não simula.
