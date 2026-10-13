---
titulo: Setup 9.3
categoria: setup
resumo: Irmão do 9.2 que arma com dois fechamentos abaixo do fechamento do candle de referência. Regras exatas, a lacuna dos "consecutivos" e críticas.
relacionados: setup-9-2, setup-9-1, medias-moveis, primitivas-price-action, r-multiplo, slippage-e-custos, visao-fractal, contradicoes-entre-as-fontes
---

## O que é

O 9.3 é um **setup de continuação**, irmão do [Setup 9.2](/biblioteca/setup-9-2). Setup é uma receita com regras fixas de entrada e saída. Os dois acompanham a mesma **pernada** de alta, guiada pela **MME9** (média móvel exponencial dos últimos 9 fechamentos; veja [Médias móveis](/biblioteca/medias-moveis)), e usam o mesmo candle de referência, gatilho, stop e alvo.

Muda só o que arma:

- **9.2**: um fechamento abaixo da **mínima** do candle de referência.
- **9.3**: **dois fechamentos** abaixo do **fechamento** do candle de referência. Não precisa fechar abaixo da mínima.

Por isso o 9.3 costuma armar em correções mais leves que o 9.2.

O Radar **não envia ordens**. "Comprar" aqui quer dizer que o Radar marca no gráfico, avisa (se você criou um alerta) e simula no laboratório.

## Regras exatas no Radar

Estas são as regras como estão no código hoje. Tudo é conferido com o candle **fechado**.

Os números são os **valores padrão**. Cada um é um parâmetro do setup, guardado nas suas preferências (a tela para editar os parâmetros dos setups ainda não existe). Cada evento do painel de Setups mostra, em "Parâmetros usados", com quais valores foi calculado. O laboratório usa sempre os valores padrão.

**Tick** é o menor passo de preço do ativo. **MME9 subindo** quer dizer que a MME9 deste candle é maior que a do candle anterior; pela conta da média exponencial, isso acontece quando o fechamento fica acima do valor que a MME9 tinha no candle anterior.

### 1. A pernada e o candle de referência (igual ao 9.2)

- A pernada começa no primeiro candle em que a MME9 sobe. Esse candle é a primeira **referência**.
- Em cada candle seguinte com a MME9 ainda subindo, um fechamento **maior** que o da referência faz desse candle a nova referência. Fechamento igual não troca.
- A pernada acaba no primeiro candle em que a MME9 não sobe (cai ou fica parada). Aí a contagem se perde e tudo recomeça na próxima subida.

### 2. A contagem e o armado

- Cada candle da pernada, com a MME9 subindo nele, que fecha **abaixo do fechamento** da referência soma 1 na contagem.
- Um fechamento acima do da referência cria uma nova referência e zera a contagem.
- **Modo consecutivo** (padrão, parâmetro `consecutive`): qualquer candle que não feche abaixo do fechamento da referência zera a contagem. Isso inclui fechar **exatamente igual** a ele.
- **Modo não consecutivo**: um fechamento igual não soma nem zera. A contagem só volta a zero com uma nova referência ou com o fim da pernada.
- O setup **arma** quando a contagem chega a 2.
- **Gatilho** (o preço que dispara a compra): máxima do candle que armou + 1 tick.
- **Stop** (o preço de saída se der errado): 1 tick abaixo da menor mínima dos candles **depois** da referência até o que armou. A mínima do próprio candle de referência fica de fora, mesmo que seja a mais baixa.
- Os fechamentos que armaram uma ocorrência não contam para a próxima. Fechamentos que acontecem enquanto há uma ocorrência armada ou em andamento também não contam. O candle em que a operação termina (stop ou alvo) já conta.

### 3. Enquanto espera, entrada e saída (igual ao 9.2)

A partir do candle seguinte, em cada candle fechado, nesta ordem:

1. Se a máxima do candle alcançou o gatilho, a compra acontece.
2. Se não alcançou e a MME9 **caiu**, o setup é **desarmado** e a pernada é zerada.
3. Se não alcançou e a MME9 não caiu (subiu ou ficou parada), o gatilho passa para a **máxima deste candle + 1 tick**, que nunca fica acima do gatilho anterior. O stop é refeito como 1 tick abaixo da menor mínima da correção até aqui; ele só desce.

Não há limite de candles no estado armado.

- A entrada é uma **ordem stop**: basta a máxima tocar o gatilho. Se o candle abrir acima dele (**gap**), a compra é registrada na abertura, o pior preço.
- **Saída fixa (padrão)**: alvo = entrada + 2 × (entrada − stop), o "alvo de 2R" (veja [R-múltiplo](/biblioteca/r-multiplo)). O 2 é o parâmetro `exit.targetR`; a especificação cita 2R ou 3R. O alvo parte do preço real de entrada e é arredondado ao tick.
- **Saída dinâmica (opcional)**: igual à do [Setup 9.1](/biblioteca/setup-9-1). Sem alvo; quando a MME9 vira para baixo, o stop sobe para 1 tick abaixo da mínima do candle da virada.
- **Preço de saída**: stop com gap contra sai na abertura; alvo com gap a favor sai no alvo; stop e alvo no mesmo candle contam **stop**; no candle da entrada só o stop é conferido, e conta mesmo que a mínima possa ter vindo antes da compra.
- O painel de Setups mostra o resultado em R **sem custos**. Custos e imposto entram só no laboratório.

### 4. Outras regras

- **Uma ocorrência por vez**. A pernada continua sendo acompanhada durante a ocorrência e, depois de um stop ou alvo, a mesma pernada pode armar de novo.
- **Sem filtros** de ADX, MMA50 ou mercado lateral. O Radar procura o 9.3 em qualquer tempo gráfico.
- **Venda**: desligada por padrão (`allowSell`). Ligada, é o espelho e aparece marcada "Venda espelhada — não descrita nos vídeos".
- **Escala maior** em baixa: os eventos de compra "armado" e "acionado" ganham o **aviso vermelho** "contra a escala maior" (veja [Visão fractal](/biblioteca/visao-fractal)). O aviso não bloqueia o setup.

### Exemplo hipotético

Supondo, só para o exemplo, um tick de R$ 0,01. Modo consecutivo, saída fixa em 2R. A MME9 sobe em todos os candles abaixo.

1. **Referência**: o maior fechamento da pernada é R$ 30,00; a mínima desse candle é R$ 29,40.
2. **Candle A**: fecha em R$ 29,80, abaixo de R$ 30,00. Contagem: 1. Mínima de A: R$ 29,50.
3. **Candle B**: fecha em R$ 29,95, de novo abaixo de R$ 30,00. Contagem: 2. **Armou.** Máxima de B: R$ 30,10; mínima: R$ 29,70.
4. Gatilho: R$ 30,11. Stop = menor mínima de A e B (R$ 29,50) − 1 tick = R$ 29,49. A mínima da referência (R$ 29,40) é mais baixa, mas fica de fora.
5. Se o candle seguinte passar de R$ 30,11 sem gap e sem voltar ao stop: compra em R$ 30,11, risco = 30,11 − 29,49 = R$ 0,62, alvo = 30,11 + 2 × 0,62 = **R$ 31,35**.

Se entre A e B tivesse aparecido um candle fechando **exatamente** em R$ 30,00, no modo consecutivo a contagem voltaria a zero, e B seria só o primeiro fechamento abaixo. No modo não consecutivo, B armaria do mesmo jeito.

Neste exemplo o 9.2 não arma: nenhum fechamento ficou abaixo da mínima da referência.

## De onde veio

O 9.3 vem dos vídeos do canal resumidos na especificação do Radar, que o define como "mesmo filtro e mesmo candle de referência do 9.2", com dois fechamentos abaixo do fechamento de referência. O vídeo recomenda o 9.2 para o semanal e o mensal; o Experimento E3 testa essa recomendação nos dois setups.

A especificação atribui a Larry Williams apenas o 9.1 e não cita autor para o 9.3. O Radar não afirma de quem ele é. Esta página descreve o 9.3 **do Radar**.

## Quando falha

- **Arma cedo demais**: como a pernada pode ter poucos candles, o 9.3 pode armar só 2 candles depois de a MME9 voltar a subir, ainda no meio de uma queda maior.
- **Correção que vira queda**: a MME9 é atrasada e pode continuar subindo enquanto a alta já acabou. O desarme só vem quando ela cai.
- **Mercado lateral**: sem filtro de ADX, ele arma também em mercados sem direção.
- **Stop muito perto**: em correções rasas, a menor mínima fica perto do gatilho. Custos e derrapagem pesam mais em R, e um candle amplo na entrada pode tocar o stop e contar como perda pela regra conservadora. Veja [Slippage e custos](/biblioteca/slippage-e-custos).
- **Gaps**: um gap abaixo do stop faz a perda passar de 1R.
- **Poucos sinais no semanal e no mensal**: 10 anos de semanal são cerca de 520 candles; de mensal, 120. Pelas regras do laboratório, menos de 30 operações é "inconclusivo".
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡.

## Lacunas e decisões nossas

- **Consecutivos ou não?** O vídeo não diz se os dois fechamentos precisam ser seguidos. Padrão nosso: **consecutivos**, com o parâmetro `consecutive` para aceitar não consecutivos.
- **Fechamento igual ao de referência**: no modo consecutivo, quebra a sequência; no não consecutivo, é ignorado. Não troca a referência em nenhum dos dois.
- **Stop sem a referência**: a menor mínima conta a partir do candle seguinte à referência. Como o 9.3 não exige fechar abaixo da mínima, a referência pode ter a mínima mais baixa de todas e mesmo assim ficar de fora.
- **Contagem limpa**: os fechamentos que armaram uma ocorrência, e os que acontecem durante ela, não valem para a próxima.
- **"Fechamentos crescentes"** não são exigidos: qualquer trecho com a MME9 subindo é pernada, mesmo de um candle só.
- **MME9 parada**: zera a pernada (e a contagem), mas não desarma uma ocorrência já armada; com ela parada, o gatilho continua sendo deslocado.
- **Rearmar na mesma pernada** depois de um stop ou alvo é permitido.
- **Saída dinâmica**: a especificação só prevê alvo de 2R ou 3R. O Radar também aceita a saída dinâmica do 9.1, com stop de proteção sempre.
- **Sem filtro de ADX**, mesmo o painel de contexto dizendo que ADX abaixo de 20 é lateral. O ADX aparece no [painel de contexto](/biblioteca/painel-contexto) para você decidir.
- **Gatilho por toque** (ordem stop) e **candle da entrada** com só o stop conferido: escolhas conservadoras nossas.
- **Uma ocorrência por vez**, **sem estado "radar"** e o desarme aparece como "desarmado".
- **Venda espelhada**: não descrita nos vídeos; desligada por padrão.

## Resultados no laboratório
[[laboratorio]]

O botão acima abre o laboratório já com o 9.3. Lá você escolhe o ativo e o tempo gráfico, e o teste roda com os candles reais da fonte, os custos padrão do mercado, o imposto de renda simulado (só na B3), só compras e os valores padrão desta página. O resultado aparece ao lado do CDI e do comprar-e-segurar no mesmo período, separado em treino (70% iniciais) e teste (30% finais), com mapa de sensibilidade do alvo em R, walk-forward e Monte Carlo.

Para a recomendação do vídeo sobre as escalas, existe o **Experimento E3**, na tela "Verificar o youtuber" (botão no topo do Laboratório): ele roda o 9.2 e o 9.3 no mensal, no semanal, no diário e no 60 minutos, com os custos padrão e só compras, e compara a expectativa em R (depois dos custos, sem IR e sem CDI) do semanal e do mensal contra o diário, e do diário contra o 60 minutos. O próprio experimento avisa que, no semanal e no mensal, a amostra tende a ser pequena, e que o histórico de 60 minutos depende da fonte. Na B3, anos de histórico diário, semanal e mensal só existem se o arquivo COTAHIST da própria B3 tiver sido importado no servidor; sem ele, o ativo aparece como erro na tabela, sem dados inventados.

Nada nesta página é resultado medido: os números dependem do ativo, do período e da fonte. O laboratório e o E3 usam o modo consecutivo (o padrão).

## Críticas

- **Uma lacuna que muda o resultado.** Consecutivos ou não é uma escolha que o vídeo não fez. Testar os dois modos e ficar com o melhor é escolher depois do fato. Hoje a tela não permite trocar esse parâmetro, e o laboratório registra cada teste que você roda.
- **Recomendação sem números conhecidos.** "Use no semanal e no mensal" é afirmação do vídeo. A especificação não registra números que a sustentem; é o que o Experimento E3 mede.
- **Exemplos escolhidos depois do fato.** Num gráfico pronto, é fácil mostrar as correções que viraram alta. O Radar marca todas.
- **9.2 e 9.3 não são duas provas.** Muitas vezes os dois armam no mesmo candle. Se os dois "funcionarem", é quase a mesma evidência contada duas vezes.
- **Amostra pequena e viés de sobrevivência.** Poucas operações no semanal e no mensal, e testes só com as ações que existem hoje, deixam o resultado otimista.
- **Custos, imposto e CDI.** O resultado precisa vir depois de custos e IR e ser comparado com o CDI do mesmo período. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **Conflito de interesse.** Os vídeos vendem um serviço de assinatura.
