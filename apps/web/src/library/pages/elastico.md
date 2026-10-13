---
titulo: Elástico
categoria: setup
resumo: Compra depois que um candle fecha abaixo da Bollinger de 3 desvios, mirando a volta à média. Opera contra o movimento. Regras exatas, lacunas e críticas.
relacionados: bandas-de-bollinger, contradicoes-entre-as-fontes, candles, r-multiplo, payoff, expectativa, slippage-e-custos, visao-fractal
---

## O que é

O elástico é um setup de **reversão à média**. **Setup** é uma receita com regras fixas de quando entrar e quando sair de uma operação.

A ideia: depois de uma queda muito forte, o preço ficaria "esticado" longe da média, como um elástico, e tenderia a voltar para perto dela. O Radar mede esse "esticado" com as **Bandas de Bollinger de 20 períodos e 3 desvios** (veja [Bandas de Bollinger](/biblioteca/bandas-de-bollinger)). Quando um candle **fecha** abaixo da banda inferior, o setup entra em observação. A compra só acontece se, depois, o preço passar da máxima desse candle. O alvo é a média central das bandas.

A venda é o espelho: um candle fecha acima da banda superior, e a venda acontece se o preço depois cair abaixo da mínima desse candle.

> Atenção: o elástico opera **contra o movimento**. Ele compra depois de quedas fortes e vende depois de altas fortes. Isso conflita com a regra dos outros vídeos do mesmo canal, "nunca opere contra a tendência". O Radar mantém o elástico separado, com estatísticas próprias. Veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes).

O Radar **não envia ordens**. "Comprar" e "entrar" aqui querem dizer que o Radar marca no gráfico, avisa (se você criou um alerta) e simula a operação no laboratório.

## Regras exatas no Radar

Estas são as regras como estão no código hoje. Tudo é conferido com o candle **fechado**; o candle em formação nunca gera sinal.

Os números são os **valores padrão**. Cada um é um parâmetro do setup, guardado nas suas preferências, mas a tela para editar os parâmetros dos setups ainda não existe. Cada evento do painel de Setups mostra, em "Parâmetros usados", com quais valores foi calculado. O teste do laboratório usa sempre os valores padrão; hoje o mapa de sensibilidade dele varia só o número de desvios.

**Tick** é o menor passo de preço do ativo. "1 tick acima" é o preço mais esse passo, arredondado para a grade de ticks.

As regras abaixo são as da **compra**. A venda é igual, trocando máxima por mínima, banda inferior por banda superior e "abaixo" por "acima".

### 1. As bandas

- **Média central**: a média aritmética (MMA) dos últimos 20 fechamentos, incluindo o candle atual.
- **Banda inferior**: média central − 3 desvios-padrão desses 20 fechamentos. **Banda superior**: média central + 3 desvios.
- O 20 e o 3 são os parâmetros `bbPeriod` e `bbStdDev`. A especificação fixa esses valores para o setup; no Radar eles podem ser mudados para estudo.

### 2. Radar

- Um candle **fecha** abaixo da banda inferior. Encostar ou furar só com o pavio não conta.
- **Ainda não é compra.** O evento traz a nota "Estratégia contra o movimento: conflita com 'nunca opere contra a tendência'".

### 3. Armado: gatilho e stop

- Sem confirmação exigida (o padrão), o **próprio candle que fechou fora já arma**.
- **Gatilho** (o preço que dispara a compra): máxima do candle que fechou fora + 1 tick.
- **Stop** (o preço de saída se der errado), escolhido em `stopMode`:
- "Candle que fechou fora" (padrão, como na especificação): 1 tick abaixo da mínima do candle que fechou fora. Esse stop não muda depois.
- "Extremo desde o radar" (variante): 1 tick abaixo da menor mínima desde o candle que fechou fora até o candle que deu o gatilho atual.
- **Sem espaço até a média**: se o gatilho ficar na média central ou acima dela, não sobra lucro possível até o alvo. No candle que fechou fora, o setup então **não arma**: fica só o radar, com uma nota explicando, e o gatilho passa para o candle seguinte. Depois disso, um gatilho sem espaço cancela o setup.
- **Confirmação opcional** (`requireConfirmation`, desligada por padrão): ligada, o gatilho só é definido ou deslocado em candles que sejam martelo ou candle de força de alta (veja [Candles](/biblioteca/candles)).

### 4. Enquanto espera o rompimento

A partir do candle seguinte ao que fechou fora, em cada candle fechado, nesta ordem:

1. Se o setup está armado e a máxima do candle alcançou o gatilho, a compra acontece (item 5).
2. Se não houve compra e a máxima chegou à média central deste candle, o setup é **cancelado** ("o preço voltou à média sem acionar").
3. Se já se passaram 5 candles desde o que fechou fora (`expiryBars`), o setup **expira**. Na prática, a compra pode acontecer em qualquer um dos 5 candles seguintes ao que fechou fora.
4. Senão, o gatilho passa para a **máxima deste candle + 1 tick**. Se o setup já estava armado, o candle não chegou ao gatilho antigo, então o novo nunca fica acima dele. Exceção: se esse novo gatilho ficasse no stop ou abaixo dele (um candle inteiro abaixo da mínima do candle que fechou fora), o gatilho fica onde estava.
5. Se o gatilho, novo ou mantido, ficar na média central deste candle ou acima dela, o setup é **cancelado** (sem espaço até a média).

### 5. A entrada

- É uma **ordem stop**: basta a máxima tocar o gatilho durante o candle; não precisa fechar acima.
- Se o candle já abrir acima do gatilho (um **gap**, salto de preço entre um candle e outro), a compra é registrada na abertura, que é o pior preço.
- O alvo da entrada é a média central conhecida no fechamento do candle anterior.
- **Gap além da média**: se a abertura já estiver na média central do candle anterior (o alvo) ou acima dela, a compra acontece e a ordem de saída no alvo também, na mesma abertura. A ocorrência termina como "cancelado", com resultado de 0R antes dos custos. Depois dos custos, é uma pequena perda.
- No candle da entrada, só o stop é conferido. Se a mínima desse candle tocar o stop, conta stop, mesmo que a mínima possa ter acontecido antes da compra.

### 6. A saída

- **Alvo móvel**: a cada candle, o alvo é a média central (MMA20) do candle anterior. Depois de uma queda forte, a média pode continuar descendo por um tempo, e o alvo desce junto.
- Se a média chegar ao preço de entrada ou abaixo dele com a posição aberta, a saída na média é registrada como **saída dinâmica** (sem lucro ou com prejuízo), nunca como "alvo".
- **O stop não se move.** O elástico não tem condução por médias; a única saída "a favor" é a média central.
- **Como o Radar decide o preço de saída** (o mesmo modelo no painel, nos alertas e no laboratório): stop com gap contra sai na abertura, com perda maior que 1R; alvo com gap a favor sai no alvo, e não na abertura melhor (conservador); stop e alvo tocados no mesmo candle contam **stop**.
- O resultado em R é (preço de saída − entrada) ÷ (entrada − stop). R é o risco por ação (veja [R-múltiplo](/biblioteca/r-multiplo)). O painel de Setups mostra esse R **sem custos**; custos e imposto entram só no laboratório.

### 7. Parcial em 1R (opcional)

- Parâmetro `partialAt1R`, **desligado por padrão**.
- Ligado: quando o preço alcança a entrada + 1R, **metade** da posição é vendida nesse preço. A metade (50%) é um número fixo, decisão nossa.
- A parcial só existe se o nível de 1R estiver abaixo do alvo naquele candle.
- O stop **continua o mesmo** depois da parcial; ele não vai para o preço de entrada.
- O resultado final soma as duas metades: 0,5 × 1R + 0,5 × o resultado da outra metade. Exemplo: parcial e depois stop dá 0,5 × 1 + 0,5 × (−1) = **0R**.
- 1R e stop tocados no mesmo candle: conta só o stop, sem parcial (−1R), porque o gráfico não mostra qual veio primeiro.
- 1R e alvo tocados no mesmo candle (com o alvo acima de 1R): a parcial vem primeiro e o resto sai no alvo.
- No laboratório, a parcial é vendida como ordem limitada (sem derrapagem), pagando taxas. Com uma posição muito pequena (1 unidade, por exemplo), a metade arredondada para baixo dá zero e a parcial não acontece no laboratório.

### 8. Outras regras

- **Venda**: ligada por padrão (`allowSell`). Diferente dos setups 9.x, a venda do elástico está descrita na especificação.
- **Uma ocorrência por lado**: pode haver uma compra e uma venda abertas ao mesmo tempo. Um novo fechamento fora da banda do mesmo lado é ignorado enquanto houver uma ocorrência desse lado.
- **Qualquer tempo gráfico**: o Radar procura o elástico em todas as escalas.
- **Escala maior**: se ela estiver em baixa, os eventos de compra (radar, armado e acionado; o de encerramento, não) ganham o **aviso vermelho** "contra a escala maior" (veja [Visão fractal](/biblioteca/visao-fractal)). Na venda, o aviso aparece com a escala maior em alta. O aviso não bloqueia o setup.

### Exemplo hipotético

Tick de R$ 0,01, valores padrão. Média central em R$ 30,00 e banda inferior em R$ 27,00.

1. **Candle X**: máxima R$ 28,40, mínima R$ 26,50, fecha em R$ 26,80, abaixo da banda. **Radar.** O gatilho R$ 28,41 está abaixo da média, então o setup **arma** no mesmo candle. Stop R$ 26,49.
2. **Candle Y**: máxima R$ 28,00 (não chegou ao gatilho nem à média), mínima R$ 26,00, fecha em R$ 27,50. O gatilho passa para R$ 28,01, que está acima do stop. O stop continua R$ 26,49. No modo "extremo desde o radar", ele iria para R$ 25,99.
3. **Candle Z**: abre abaixo do gatilho e sobe até R$ 28,60, sem chegar perto do stop. Compra em R$ 28,01. Risco = 28,01 − 26,49 = R$ 1,52. Suponha que a média central de Y esteja em R$ 29,80: esse é o alvo. A distância até ele é R$ 1,79, cerca de **1,18R**.

Sem a parcial: se o preço chegar à média ainda em R$ 29,80, o resultado é cerca de +1,18R; se cair até o stop, −1R.

Com a parcial ligada: 1R = 28,01 + 1,52 = R$ 29,53, abaixo do alvo. Se o preço chegar a R$ 29,53, metade é vendida ali. Se depois chegar à média em R$ 29,80, o resultado é 0,5 × 1 + 0,5 × 1,18 ≈ **1,09R**. Se em vez disso cair até o stop, o resultado é 0R.

Repare que o alvo ficou abaixo de 2R. A calculadora de posição do Radar avisa quando a relação retorno/risco fica abaixo de 2. Veja [Payoff](/biblioteca/payoff).

## De onde veio

Segundo a especificação do Radar, o elástico é uma adaptação do youtuber para a lógica atribuída a Takashi Kotegawa, que, segundo o vídeo, media a distância do preço até a média de 25 períodos. O canal troca essa medida pelas Bandas de Bollinger de 20 períodos e 3 desvios.

O vídeo afirma que fechar fora de 3 desvios é um evento de "1 em 1000". Pela especificação, o uso preferido é o gráfico diário; o intradiário (de 5 a 30 minutos, como no mini-índice) é permitido, com aviso de taxa de acerto menor e custos maiores. O vídeo demonstra o elástico no mini-índice em 5 minutos.

A história de Kotegawa não foi conferida em fonte registrada no projeto. Esta página descreve o elástico **do Radar**.

## Quando falha

- **A queda continua**: fechar fora de 3 desvios pode ser o começo de um movimento forte, e não o fim dele. O stop é atingido, e um gap abaixo do stop faz a perda passar de 1R.
- **Tendência de baixa forte**: o preço pode fechar abaixo da banda várias vezes seguidas. Cada tentativa de comprar é uma aposta contra o movimento. Enquanto uma ocorrência está aberta, os novos fechamentos fora são ignorados.
- **Alvo que encolhe**: a média central desce depois da queda. O alvo fica mais perto, e pode chegar ao preço de entrada.
- **Alvo perto, acerto alto exigido**: com o alvo na média, o ganho possível por operação pode ficar perto de 1R ou abaixo, como no exemplo. Exemplo hipotético: com ganho de 1R e perda de 1R, é preciso acertar metade das operações só para empatar, antes dos custos; com custos, é preciso acertar mais que isso. Veja [Expectativa](/biblioteca/expectativa).
- **Custos no intradiário**: em gráficos curtos, os movimentos em preço são menores, e taxas e derrapagem levam uma parte maior de cada operação (veja [Slippage e custos](/biblioteca/slippage-e-custos)). A especificação manda avisar que, no intradiário, o acerto tende a ser menor e os custos maiores.
- **Candle amplo na entrada**: um candle que passa do gatilho e também toca o stop conta como perda no Radar, pela regra conservadora.
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento parece um tombo e gera um "fechamento fora" que nunca aconteceu.
- **Poucos casos**: num ativo só, pode haver poucos fechamentos fora de 3 desvios e poucas operações para concluir qualquer coisa. O laboratório mostra quantas houve e chama de "inconclusivo" um teste com menos de 30.

## Lacunas e decisões nossas

A especificação deixa pontos em aberto. Onde não havia regra, o Radar escolheu uma, e ela vale para todos os números que o Radar mostrar.

- **Arma no próprio candle que fechou fora** quando a confirmação não é exigida (radar e armado no mesmo candle).
- **Sem espaço até a média**: gatilho na média ou acima dela não arma no candle que fechou fora; depois disso, cancela. Também cancela se a média descer até um gatilho já armado.
- **"Voltou à média"** = a máxima tocou a média central do próprio candle, sem acionar.
- **Validade de 5 candles** contada a partir do candle que fechou fora: a compra pode acontecer em qualquer um dos 5 seguintes.
- **Alvo móvel** = média central do candle anterior, recalculada a cada candle.
- **Stop**: o padrão segue a especificação (extremo do candle que fechou fora). A variante "extremo desde o radar" é nossa. O gatilho não passa para um candle que ficou inteiro abaixo do stop.
- **Gap além da média na entrada**: executa e sai na mesma abertura, registrado como "cancelado" a 0R antes dos custos.
- **Média que chega à entrada** com a posição aberta: "saída dinâmica", nunca "alvo" com prejuízo.
- **Parcial**: 50% em 1R (número nosso); o stop não vai para a entrada; stop e 1R no mesmo candle contam só o stop; a parcial entra no resultado final em R.
- **Confirmação**: com ela ligada, um candle sem martelo ou candle de força não desloca o gatilho.
- **Venda ligada por padrão**, com uma ocorrência por lado.
- **Aviso do intradiário**: a especificação pede um aviso de acerto menor e custos maiores no intradiário. Nesta versão, o Radar não mostra esse aviso específico; só a nota de "contra o movimento".
- **Candle da entrada**: só o stop é conferido, e conta mesmo que a mínima tenha vindo antes da compra. Escolha conservadora nossa.

## Resultados no laboratório
[[laboratorio]]

O botão acima abre o laboratório com o elástico já escolhido. Lá, o teste usa os candles reais da fonte, os custos padrão do mercado (taxas, spread e derrapagem) e o IR simulado (só para a B3), e compara o resultado com o CDI e com o comprar-e-segurar do mesmo período. Os primeiros 70% do período são o "treino" e os 30% finais são o teste fora da amostra. O mapa de sensibilidade repete o teste com 2,5, 3 e 3,5 desvios, e o walk-forward escolhe o número de desvios olhando só para o passado e mede no trecho seguinte. Há também a simulação de Monte Carlo, e cada tentativa fica registrada.

- **Só compras por padrão.** As vendas do elástico ficam de fora e aparecem na lista de sinais que não viraram trade. Se você marcar "Incluir vendas", o laboratório avisa que o resultado fica otimista, porque o custo de alugar ações (ou de margem) não é simulado.
- O teste do laboratório roda com os valores padrão: a parcial em 1R fica desligada.
- **Experimento E2** (Laboratório → Experimentos): conta, ativo por ativo, quantas vezes o preço **fecha** fora da banda 20/3 no diário e compara com a curva normal. Como a banda olha só 20 candles, compara também com um passeio aleatório de mesma volatilidade (decisão nossa). Mede ainda em quantos casos o preço tocou a média central em até 10 candles. Voltar à média não diz se dava para lucrar: o E2 não usa stop nem custos.
- **Experimento E6** (Laboratório → Experimentos): refaz a conta "40% de acerto com 1:2" depois dos custos e do IR simulado (só na B3), no day trade (5, 15 e 60 minutos) e no swing (diário). Ele supõe os 40% de acerto do vídeo em qualquer escala: é a premissa do vídeo, não um fato.

Os números dependem dos dados reais de cada ativo. Nada nesta página é resultado medido.

## Críticas

- **Contra o movimento.** O mesmo canal diz que "quem vai contra a tendência perde sempre" e, em outro vídeo, ensina o elástico. As duas orientações se contradizem. Veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes).
- **"3 desvios = 1 em 1000" vale para a curva normal.** Na curva normal, ficar além de 3 desvios aconteceria em cerca de 0,13% dos casos de cada lado. A especificação do Radar parte da hipótese de que retornos de mercado têm **caudas gordas**: movimentos extremos aconteceriam mais vezes do que a curva normal prevê. É hipótese a medir, não número conferido aqui. E ser raro não quer dizer que o preço vai voltar: o fechamento fora pode ser o começo de um tombo maior. O Experimento E2 conta isso ativo por ativo.
- **Day trade.** O vídeo demonstra o elástico no mini-índice em 5 minutos, mas outro vídeo do canal chama o day trade de "massacre estatístico". No intradiário, os custos pesam mais em cada operação; o Experimento E6 mede quanto, ativo por ativo.
- **Lendas e viés de sobrevivência.** A história de Kotegawa é um caso extremo. Ela não mostra que o método funciona para a maioria das pessoas.
- **Parâmetros sem números.** 20 períodos, 3 desvios, 5 candles de validade: nenhum veio com estatística. O mapa de sensibilidade mostra se o resultado se sustenta quando o número de desvios muda.
- **Exemplos escolhidos a dedo.** Num gráfico pronto, é fácil mostrar as quedas que voltaram à média e esquecer as que continuaram. O Radar marca todas.
- **Conflito de interesse.** Os vídeos vendem um serviço de assinatura.
- **Custos, imposto e CDI.** Qualquer resultado precisa vir depois de custos e IR e ser comparado com o CDI do mesmo período. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **É o elástico do Radar.** "Sem espaço até a média", alvo móvel, validade e modelo conservador de execução são escolhas nossas. Um número medido aqui vale para esta versão, não necessariamente para a do vídeo.
