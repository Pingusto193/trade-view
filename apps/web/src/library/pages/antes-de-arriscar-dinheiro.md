---
titulo: Antes de arriscar dinheiro
categoria: aviso
resumo: O que um estudo da FGV achou sobre day traders no Brasil, quanto o CDI rende hoje e por que treinar com dinheiro fictício antes. O Radar não envia ordens.
relacionados: contradicoes-entre-as-fontes, gestao-de-risco, expectativa, drawdown, slippage-e-custos, psicologia
---

> O Radar **não envia ordens**, **não recomenda** comprar nem vender nada e **não promete lucro**. Ele ajuda você a ver, planejar, verificar e treinar. A decisão e o risco são seus.

## O que diz o estudo da FGV

O estudo "Day trading for a living?", de Chague, De-Losso e Giovannetti (2019), está no [repositório da FGV](https://repositorio.fgv.br/items/e87d04fc-4b4c-4a56-ab5a-1c84c1afde1b/full) e no [IDEAS/RePEc](https://ideas.repec.org/p/spa/wpaper/2019wpecon47.html) (✅ verificado na fonte oficial). Segundo o resumo:

- os autores olharam pessoas que começaram a fazer day trade no mercado futuro de ações brasileiro entre 2013 e 2015;
- entre as que **persistiram por pelo menos 300 dias**, **97% perderam dinheiro**;
- só **0,4%** ganharam mais do que um caixa de banco (cerca de US$ 54 por dia);
- o estudo não encontrou evidência de aprendizado com a prática.

O resumo fala em mercado futuro de ações e não separa o mini-índice.

### O que isso quer dizer — e o que não quer

- **Quer dizer**: naquele mercado e naquele período, quase todos os que insistiram no day trade perderam dinheiro. Sorteando uma pessoa desse grupo, a chance de ela **não** ter perdido era de cerca de 3%.
- **Não quer dizer** que todo método perde sempre. O estudo também não trata de swing trade nem de outros mercados.
- **Mas o ônus da prova é da estratégia**: ela precisa mostrar, com números honestos, por que seria diferente.

## Quanto o CDI rende agora

[[cdi]]

O **CDI** é uma taxa de juros de referência da renda fixa no Brasil. O quadro acima traz os números do Banco Central: o CDI diário da série 12 (🟡) e a Meta Selic da série 432 (✅). Se a consulta falhar, o quadro mostra o erro e a data do último dado válido: o Radar nunca inventa a taxa. O rendimento do CDI mostrado é **antes** do imposto de renda da renda fixa.

## Custo de oportunidade

**Custo de oportunidade** é o que você deixa de ganhar ao escolher uma coisa em vez de outra. O dinheiro usado para operar poderia estar numa aplicação que acompanha o CDI, sem depender de acertar para onde o preço vai.

Exemplo hipotético: se o CDI acumulado em 12 meses fosse de 10% (número inventado só para a conta; o real está no quadro acima), R$ 10.000,00 renderiam cerca de R$ 1.000,00 em um ano, antes do imposto. Para valer a pena, operar precisaria render **mais do que isso**, depois de custos e IR, e com quedas no caminho que você aguente. Ganhar R$ 400,00 no ano operando seria ficar R$ 600,00 atrás da alternativa mais simples.

Onde o Radar mostra essa comparação:

- **Página Brasil**: o quadro "Seu treino × CDI" compara o resultado da conta de treino (já com custos, sem IR) com o CDI do mesmo período.
- **Laboratório**: todo resultado aparece ao lado do CDI e do comprar e segurar (buy & hold) no mesmo período. Se a estratégia perder para o CDI, o laboratório não dá "aprovado".

## Meça antes, no laboratório

Antes de treinar um setup, veja como ele teria se saído no passado. O **Laboratório** (botão "Testar no laboratório" nas páginas dos setups) roda o setup com os candles reais da fonte e mostra:

- a [expectativa](/biblioteca/expectativa) por trade **depois dos custos** padrão do mercado, e o resultado final depois do IR simulado (só na B3);
- a comparação com o CDI e com o comprar e segurar no mesmo período;
- o resultado separado em treino (70% iniciais do período) e teste (30% finais), para ver se o resultado se repete no trecho final;
- a pior queda e o Monte Carlo, que embaralha os trades para mostrar quedas possíveis com o seu risco por trade (veja [Drawdown](/biblioteca/drawdown));
- quantas vezes você já testou o mesmo ativo com os mesmos setups.

O veredito é cético de propósito: com menos de 30 trades, é "inconclusivo"; com menos de 100, nunca chega a "aprovado". Mesmo um "aprovado" fala só do passado. Na tela Experimentos, o laboratório também testa algumas afirmações do vídeo (veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes)).

## Treine primeiro, com dinheiro fictício

O **Modo Treino** vem ligado no primeiro uso. Nele você usa:

- **dinheiro fictício**, com saldo inicial que você escolhe (padrão: R$ 10.000,00);
- **preço real** da fonte, nunca simulado (ativos com atraso executam no preço atrasado, e a posição avisa);
- **custos e derrapagem** em toda execução, com o mesmo modelo conservador do backtest (veja [Slippage e custos](/biblioteca/slippage-e-custos));
- **plano de trade** com checklist psicológico e **anti-revanche** (veja [Psicologia](/biblioteca/psicologia));
- **IR simulado** para a B3.

Nesta versão, o treino é **ao vivo**, **só de compras** e **sem alavancagem**. A especificação prevê também o **replay** (escolher uma data do passado, esconder o que veio depois e avançar candle a candle) e os **exercícios de leitura**; eles ainda não estão disponíveis. A recomendação é a mesma: treine primeiro — no treino ao vivo agora, e também no replay quando ele chegar —, sempre com plano completo, antes de qualquer dinheiro real.

### Uma régua para decidir (heurística, não garantia)

A especificação define um **Painel de prontidão** com critérios ajustáveis. É uma régua nossa, não uma garantia:

1. pelo menos **100 trades** de treino (replay e ao vivo), sendo pelo menos 30 ao vivo;
2. **expectativa positiva** depois de custos e IR, comparada ao CDI do período (veja [Expectativa](/biblioteca/expectativa));
3. **disciplina** de pelo menos 90%: plano completo, sem stop movido para trás e risco dentro do limite;
4. **drawdown máximo** dentro do limite que você mesmo definiu (veja [Drawdown](/biblioteca/drawdown)).

O Painel de prontidão **ainda não existe** no app. Enquanto isso, o diário da página Treino já mostra o número de trades, o acerto, a média em R, o resultado, os custos pagos, a pior queda e a disciplina. Pela especificação, quando existir, o painel **nunca vai bloquear** o modo Real: só vai mostrar o que falta e por quê.

## O que o Radar não faz

- **Não envia ordens.** Nem no modo Real: lá, você opera na sua corretora e registra no Radar o que fez.
- **Não recomenda** comprar, vender ou manter nenhum ativo. Os setups são regras de observação, tratadas como hipóteses.
- **Não promete lucro.** Nenhum resultado passado, do treino ou do laboratório, garante o futuro.
- **Não substitui um contador.** O IR simulado segue regras registradas com selo 🟡 e pode ter erro.
- **Não esconde a fonte.** Todo gráfico mostra de onde vem o dado, o atraso e se o volume é completo.

## Avisos por mercado

- **Futuros (mini-índice e mini-dólar)**: um contrato de mini-dólar corresponde a US$ 10.000 (🟡), e a corretora exige só uma margem, que varia. Por isso, uma variação pequena no preço pode ser grande diante do seu capital. Veja o exemplo do mini-índice em [Gestão de risco](/biblioteca/gestao-de-risco).
- **Cripto**: as regras de imposto estão em disputa e as fontes divergem (🟡 contraditório). Consulte um contador. O volume mostrado é só o da Binance, não do mercado inteiro (✅).
- **Forex**: a especificação do Radar pede este aviso — pessoa física no Brasil costuma operar por corretoras estrangeiras não autorizadas pela CVM, o que traz risco de contraparte (a corretora quebrar ou não pagar) e tributação de ativos no exterior. A situação regulatória atual ainda não foi verificada pelo projeto (❌).

## Limites

- O estudo cobre um mercado (futuros de ações no Brasil), um grupo (quem começou entre 2013 e 2015 e persistiu por pelo menos 300 dias) e um período. Não mede swing trade nem outros países.
- O treino não reproduz o peso de perder dinheiro de verdade.
- Os critérios de prontidão são heurísticos. Cumprir todos não garante nada; só mostra que você seguiu um processo com números honestos.
