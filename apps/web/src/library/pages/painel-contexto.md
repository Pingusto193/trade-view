---
titulo: Painel de contexto
categoria: conceito
resumo: Tendência, ADX, alinhamento, média respeitada, inclinações, maturidade e escala maior: a regra exata de cada item do painel e do aviso vermelho.
relacionados: adx, medias-moveis, primitivas-price-action, teoria-de-dow, visao-fractal, recuo-a-media, atr-e-stop-atr, contradicoes-entre-as-fontes
---

## O que é

O painel **Contexto** resume o "pano de fundo" do ativo na escala do gráfico: se há tendência, com que força, quais médias o preço tem respeitado e se a escala maior está a favor ou contra. Cada item mostra um rótulo curto. Ao tocar em **"por quê?"**, aparecem os números que levaram à conclusão: preços, médias e candles.

É uma leitura automática, objetiva e sempre igual para os mesmos candles. **Não é recomendação.** O painel não diz se o preço vai subir; ele organiza o que já aconteceu.

O vídeo afirma que o contexto ideal para operar tem escala maior a favor, tendência qualificada, ADX acima de 25, ponto técnico relevante e volume confirmando (regra 3 das cinco regras operacionais do canal). O painel transforma parte disso em regras com números. "Ponto técnico relevante" e "volume confirmando" não são itens do painel.

## Regras gerais

- O painel é calculado no último candle **fechado**. O candle em formação não entra.
- Ele aparece a partir de **31 candles fechados**. Com menos, mostra "Poucos candles para avaliar o contexto (mínimo de 31 fechados)". Alguns itens precisam de mais histórico e ficam "indefinidos" ou "sem dados" até lá.
- Usa os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).
- Vários números vêm das [Primitivas de price action](/biblioteca/primitivas-price-action) e são parâmetros com valor padrão: 2 candles de cada lado para topos e fundos, passo de 5 candles na inclinação, limite de 0,15 para "plana", 1,0 para "forte" e 0,5 ATR na média respeitada. Eles podem ser mudados, mas a tela para isso ainda não existe. As faixas do ADX e os números da maturidade são fixos no código.
- **ATR14** é a amplitude média dos últimos 14 candles (veja [ATR](/biblioteca/atr-e-stop-atr)). O painel usa o ATR como régua para medir distâncias e inclinações, assim a mesma regra serve para uma ação de R$ 10 e para o bitcoin.

## Regras exatas no Radar

Os itens aparecem nesta ordem no painel.

### Tendência

| Rótulo | Regra (no último candle fechado) |
|---|---|
| Alta | ADX de 20 ou mais **e** estrutura de alta **e** MMA50 maior que no candle anterior **e** inclinação da MMA50 de 0,15 ou mais |
| Baixa | o espelho: ADX de 20 ou mais, estrutura de baixa, MMA50 menor que no candle anterior e inclinação de −0,15 ou menos |
| Lateral | qualquer outro caso |
| Indefinida (dados insuficientes) | ainda falta a MMA50, a inclinação dela ou o ADX |

- **Estrutura**: a comparação dos dois últimos topos e dos dois últimos fundos confirmados (item Estrutura, abaixo).
- **MMA50**: a média aritmética dos últimos 50 fechamentos. **Inclinação** = (MMA50 agora − MMA50 de 5 candles atrás) ÷ ATR14 agora (veja [Médias móveis](/biblioteca/medias-moveis)).
- A MMA50 com a inclinação precisa de 55 candles, e o ADX, de 28. Antes disso, a tendência é "indefinida".
- "Lateral" é a **sobra**: tudo o que não é alta nem baixa qualificadas. Inclui, por exemplo, estrutura de alta com ADX de 18, ou ADX alto com topos e fundos desencontrados.
- A mesma regra, com o mesmo código, calcula a tendência da escala maior (item Escala maior).

Exemplo hipotético: estrutura de alta, ADX 23, ATR14 de R$ 1,00. A MMA50 está em R$ 50,60; no candle anterior, R$ 50,55; 5 candles atrás, R$ 50,40. Inclinação = 0,20 ÷ 1,00 = 0,20, acima de 0,15: **Alta**. Se a MMA50 de 5 candles atrás fosse R$ 50,50, a inclinação seria 0,10 (plana) e o painel diria **Lateral**, mesmo com a MMA50 subindo no último candle.

### Força (ADX)

| ADX | Rótulo |
|---|---|
| abaixo de 20 | lateral: não operar setups de tendência |
| de 20 a 25 (inclusive) | zona cinzenta |
| acima de 25 até 40 (inclusive) | tendência |
| acima de 40 | tendência muito forte |

- O "por quê?" mostra o +DI e o −DI, que indicam a direção. O ADX mede só a força. A conta completa está em [ADX](/biblioteca/adx).
- Enquanto o ADX ainda não existe (menos de 28 candles), o item diz "ADX indisponível".
- Repare: a Tendência exige ADX de 20 ou mais, então a zona cinzenta já pode ser "alta". O "ADX acima de 25" do vídeo não é exigido pela Tendência.

### Estrutura

- Mostra "Topos e fundos: alta", "baixa" ou "indefinida".
- **Alta**: o último topo confirmado é mais alto que o penúltimo **e** o último fundo confirmado é mais alto que o penúltimo. **Baixa**: os dois mais baixos. **Indefinida**: qualquer outro caso, inclusive preços iguais ou menos de dois topos e dois fundos.
- Um topo ou fundo só existe 2 candles depois, quando se confirma. O "por quê?" mostra os preços dos dois topos e dos dois fundos. Regras completas em [Primitivas de price action](/biblioteca/primitivas-price-action).

### Alinhamento

| Rótulo | Regra |
|---|---|
| Preço > MME9 > MME21 > MMA50 | fechamento acima da MME9, MME9 acima da MME21 e MME21 acima da MMA50 |
| Preço < MME9 < MME21 < MMA50 | o espelho, na baixa |
| Médias desalinhadas | qualquer outra ordem |
| Sem dados suficientes | a MMA50 ainda não existe (menos de 50 candles) |

- MME9 e MME21 são as médias exponenciais de 9 e 21 fechamentos. As comparações são estritas: valores iguais contam como "desalinhadas".
- A MMA200 não entra no alinhamento.

### Média respeitada

O item procura a média que tem "segurado" o preço nos recuos recentes.

1. O Radar pega os **últimos 5 fundos confirmados** até o candle atual. Cada fundo é tratado como um "recuo". São precisos pelo menos 3.
2. Para cada média (MME9, MME21, MMA50, MMA100 e MMA200), conta em quantos desses fundos ela "segurou": no **candle do fundo**, a mínima ficou a até **0,5 × ATR14** da média (acima ou abaixo dela) **e** o fechamento ficou **na média ou acima**. A média e o ATR são os daquele candle.
3. Vence a média com mais acertos, com **pelo menos 2**. No empate, vence a mais curta (9, depois 21, 50, 100 e 200).

- O rótulo fica assim: "Respeita a MME21 (4 de 5 recuos)". Sem vencedora: "Nenhuma média respeitada com clareza". Com menos de 3 fundos: o "por quê?" avisa que não há recuos suficientes.
- A MMA100 é calculada por dentro e não aparece no gráfico pelo preset padrão.
- Só olha fundos, ou seja, o lado de quem compra.
- O [recuo à média](/biblioteca/recuo-a-media), no modo automático, usa a média escolhida por esta mesma regra, recalculada a cada fundo confirmado.

Exemplo hipotético, com ATR14 de R$ 2,00 no candle do fundo (tolerância de R$ 1,00):

- Mínima R$ 49,40, MME21 R$ 50,00, fechamento R$ 50,30: distância de R$ 0,60 e fechamento acima. **Conta.**
- Mínima R$ 48,70, MME21 R$ 50,00: distância de R$ 1,30. **Não conta.**
- Mínima R$ 49,80, MME21 R$ 50,00, fechamento R$ 49,90: fechou abaixo da média. **Não conta.**

### Inclinações

Mostra a inclinação da MME9, da MME21, da MMA50 e da MMA200. Cada média recebe um rótulo, conferido de cima para baixo nesta tabela (vale o primeiro que servir):

| Rótulo | Regra |
|---|---|
| virando | a média virou neste candle, para cima ou para baixo |
| plana | inclinação entre −0,15 e +0,15, sem incluir as pontas |
| subindo / caindo | inclinação de 0,15 até menos de 1,0, para cima ou para baixo |
| subindo forte / caindo forte | inclinação de 1,0 ou mais, para cima ou para baixo |

- Inclinação = (média agora − média 5 candles atrás) ÷ ATR14 agora.
- **Virou para cima**: a média deste candle é maior que a do anterior, e a do anterior era menor ou igual à do candle antes dele. Para baixo, o espelho. O rótulo "virando" **não diz para que lado**; olhe o gráfico.
- Uma média que ainda não tem dados (a MMA200 precisa de 200 candles) fica fora do item.

### Maturidade (experimental)

Uma heurística para dizer em que fase está uma alta. O próprio painel avisa: "heurística experimental, não validada". Ela só é calculada quando a Tendência é **alta**; em qualquer outro caso, fica "indefinida".

O Radar confere nesta ordem e fica com o primeiro rótulo que servir:

1. **Jovem**: a última virada da MMA50 para cima foi há **20 candles ou menos** **e** o preço rompeu por fechamento o último topo confirmado até essa virada (qualquer fechamento acima dele, contado desde a confirmação do topo). Se a MMA50 virou há pouco, mas o topo ainda não foi rompido, o "por quê?" diz isso.
2. **Cansada**: as três coisas ao mesmo tempo. O fechamento está **mais de 8 × ATR14 acima da MMA200**; a MMA50 está **achatando** (quanto ela subiu nos últimos 10 candles é menos do que subiu nos 10 anteriores, as duas medidas com o ATR14 atual); e, nos últimos 20 candles, o **volume médio dos candles de alta é menor que o dos candles de baixa**.
3. **Madura**: preço > MME9 > MME21 > MMA50 há **30 candles seguidos ou mais**, contando o atual.
4. **Indefinida**: nenhum dos casos acima.

- Sem dado de volume, ou sem a MMA200 (menos de 200 candles), a alta nunca aparece como "cansada".
- Os números 20, 8, 10, 20 e 30 são escolhas nossas, fixas no código.

### Escala maior (vento a favor ou contra)

O item compara a Tendência desta escala com a Tendência da escala imediatamente maior:

| Escala do gráfico | Escala maior |
|---|---|
| 1 min | 5 min |
| 5 min | 15 min |
| 15 min e 30 min | 60 min |
| 60 min | Diário |
| Diário | Semanal |
| Semanal | Mensal |
| Mensal | nenhuma |

Como a escala maior é calculada:

- O Radar junta os candles já carregados desta escala para montar os candles da escala maior (por exemplo, os diários de uma semana viram um candle semanal), no fuso horário da bolsa.
- A Tendência da escala maior usa a **mesma regra** do item Tendência.
- Só vale o **último candle da escala maior já fechado**. E o Radar só considera um período maior fechado quando o primeiro candle do período seguinte fecha. Exemplo: no diário, a semana passada só entra na conta depois que fecha o primeiro candle diário da semana seguinte.
- A escala maior precisa de 55 candles próprios para ter tendência. No diário, isso quer dizer mais de um ano de candles diários carregados. Enquanto ela for "indefinida", o item diz "Escala maior sem dados". No mensal, que não tem escala maior, o item diz o mesmo.

| Escala maior | Esta escala | O que o item mostra |
|---|---|---|
| baixa | qualquer | Vento CONTRA para compras, com aviso vermelho |
| alta | alta | Vento a favor |
| alta | baixa | Vento CONTRA para vendas, com aviso vermelho |
| alta | lateral ou indefinida | Neutro |
| lateral | qualquer | Neutro |
| sem dados | qualquer | Escala maior sem dados |

- Com a escala maior em baixa, o item é "contra para compras" **qualquer que seja** a tendência desta escala. Se esta também estiver em baixa, o "por quê?" acrescenta que vendas estariam a favor da escala maior.

### O aviso vermelho

- **No painel**: sempre que o item Escala maior está "contra" (para compras ou para vendas), aparece no topo uma faixa vermelha: "⚠ Aviso vermelho: a escala maior (nome da escala) está contra. A regra mestra do canal é que a escala maior manda."
- **Nos setups**: o motor de setups acompanha a escala maior candle a candle, com a mesma regra e os mesmos candles do painel. Todo evento de **compra** em radar, armado ou acionado, com a escala maior em baixa, ganha a nota "⚠ Aviso vermelho: contra a escala maior", seguida da escala e da tendência dela (por exemplo, "Semanal em baixa"). Na **venda**, o aviso aparece com a escala maior em alta. Eventos de encerramento não recebem o aviso.
- O aviso **não bloqueia** os setups. A exceção é o [recuo à média](/biblioteca/recuo-a-media), que tem a escala maior como parte da própria regra.
- **No laboratório**, as operações contra a escala maior aparecem marcadas com ⚠ na lista de trades.
- **Na boleta do Modo Treino**, que só compra, aparece o aviso "⚠ Compra contra a escala maior (aviso vermelho)" quando a escala maior está em baixa. Com a escala maior em alta e esta escala em baixa, o painel mostra o vento contra **para vendas**, e a boleta não avisa, porque a compra vai a favor da escala maior. O aviso "ADX abaixo de 20: mercado lateral" também aparece na boleta.

## Como ler

- Comece pela **Escala maior** e pela **Tendência**. Segundo o vídeo, a escala maior manda; o painel só põe isso em números.
- Use o **"por quê?"**. Um rótulo "Lateral" pode esconder uma estrutura de alta com ADX baixo, ou ADX alto com estrutura confusa. São situações diferentes.
- **Média respeitada** com "2 de 5" é bem mais fraco que "5 de 5". O número importa mais que o nome da média.
- Os itens são parecidos entre si: MMA50, médias e ADX aparecem em vários deles. Cinco itens "a favor" não são cinco provas independentes.
- O painel descreve o passado recente. Nenhum item diz o que vem depois.

## Quando engana

- **Atraso**: topos e fundos só se confirmam 2 candles depois; MMA50 e ADX são médias lentas; a escala maior só muda quando o período maior fecha. Nas viradas de mercado, o painel continua mostrando a fase antiga por um tempo.
- **Rótulo que pisca**: perto dos limites (ADX 19,9 ou 20,1; inclinação 0,14 ou 0,16), o rótulo pode trocar a cada candle sem que nada importante tenha mudado.
- **Pouco histórico**: com menos de 55 candles, a Tendência é "indefinida"; com pouco histórico na escala maior, ela fica "sem dados". Isso **não** quer dizer "a favor".
- **"Virando" sem direção**: o rótulo não diz se a média virou para cima ou para baixo.
- **Média respeitada com amostra pequena**: 2 acertos em 3 fundos já elegem uma média. Com várias médias próximas umas das outras, mais de uma pode "segurar" o mesmo fundo.
- **Maturidade sem validação**: é uma heurística. E a parte de volume do "cansada" depende da qualidade do volume da fonte: na cripto, é só o da Binance ✅; nas ações dos EUA, o volume ao vivo é parcial ✅ (veja [Volume](/biblioteca/volume)).
- **Escala diferente, painel diferente**: o diário pode estar em alta e o 60 minutos em baixa ao mesmo tempo. O painel é sempre da escala do gráfico.
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento parece um tombo e bagunça estrutura, médias e ADX por muitos candles.

## Lacunas e decisões nossas

A especificação lista os itens, mas deixa a regra exata de vários em aberto. Estas escolhas são nossas:

- **Tendência**: "MMA50" virou "MMA50 subindo no candle **e** inclinação de pelo menos 0,15", porque uma MMA50 plana é mercado lateral. O ADX mínimo é 20, não 25. "Indefinida" enquanto faltam dados, para nunca classificar a partir de um número que não existe.
- **Faixas do ADX**: 20 e 25 entram na zona cinzenta; exatamente 40 ainda é "tendência".
- **"Recuo"** = cada um dos últimos fundos confirmados (até 5, no mínimo 3), avaliado só no candle do fundo. A média precisa de pelo menos 2 acertos; o empate vai para a mais curta; só o lado comprador é avaliado.
- **Maturidade**: os números 20 candles (jovem), 8 ATR, 10 candles de achatamento, 20 candles de volume (cansada) e 30 candles de alinhamento (madura) são nossos. "Resistência relevante" virou "o último topo confirmado até a virada da MMA50". A maturidade só existe na alta.
- **Vento**: escala maior em baixa = contra para compras, qualquer que seja esta escala; escala maior lateral, ou esta lateral ou indefinida = neutro.
- **Escala maior**: montada com os candles desta escala, e só atualizada quando o primeiro candle do período seguinte fecha (conservador). Escala maior indefinida vale como "sem dados": sem aviso.
- **O painel começa com 31 candles fechados**, mesmo que alguns itens ainda não tenham dados.
- **Aviso vermelho não bloqueia** setups, só avisa. O recuo à média é a exceção.

## De onde veio

A lista de itens vem da especificação do Radar, a partir dos vídeos do canal: tendência por estrutura, MMA50 e ADX; faixas do ADX em 20, 25 e 40; alinhamento das médias; média respeitada nos últimos 3 a 5 recuos, com a tolerância de 0,5 ATR marcada como arbitrária; inclinação das médias; maturidade como heurística "experimental"; e o vento da escala maior com aviso vermelho.

O vídeo afirma que a escala maior manda na menor, que é preciso olhar sempre três escalas (veja [Visão fractal](/biblioteca/visao-fractal)) e que médias servem como filtro de tendência e como suporte ou resistência dinâmicos. São afirmações do vídeo, não fatos comprovados. A regra de estrutura (topos e fundos) é a das [Primitivas de price action](/biblioteca/primitivas-price-action), escrita na especificação; o que o vídeo diz sobre tendências está em [Teoria de Dow](/biblioteca/teoria-de-dow).

## Críticas

- **Regras do vídeo sem números.** "A escala maior manda" e "ADX acima de 25" são apresentados sem estatística. O painel mede o contexto, mas não prova que operar só com contexto "bom" dê resultado melhor.
- **Fácil de usar como desculpa.** Com oito itens, quase sempre algum parece a favor. Decida antes, no plano de trade, quais itens precisam estar a favor, e não depois de olhar o gráfico.
- **Maturidade é palpite organizado.** Os rótulos jovem, madura e cansada não foram testados. Trate como curiosidade até haver medição.
- **Contradição do próprio canal.** O vídeo diz para nunca operar contra a tendência maior, mas o canal ensina o [elástico](/biblioteca/elastico), que opera contra o movimento. Veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes).
- **Dá para medir, em parte.** O laboratório marca com ⚠ as operações contra a escala maior na lista de trades (as 200 mais recentes), com o resultado em R já com custos. Ainda não existe uma comparação automática entre as marcadas e as outras; olhar a lista e comparar é mais útil do que confiar na regra, mas poucas operações não provam nada.
