---
titulo: Médias móveis (MME e MMA)
categoria: indicador
resumo: Como o Radar calcula as médias 9, 21, 50 e 200, o que são inclinação e "virar", e por que toda média chega atrasada.
relacionados: setup-9-1, recuo-a-media, painel-contexto, atr-e-stop-atr, suporte-e-resistencia, visao-fractal
---

## O que é

Uma média móvel é a média dos preços de fechamento dos últimos candles. A cada candle novo, entra o fechamento mais recente e sai o mais antigo (por isso "móvel"). O resultado é uma linha suave por cima do gráfico, que ajuda a enxergar a direção do preço sem o sobe e desce de cada candle.

O Radar usa dois tipos:

- **MMA (média móvel aritmética)**: a média simples. Todos os candles da janela pesam igual.
- **MME (média móvel exponencial)**: dá mais peso aos candles mais recentes. Reage mais rápido quando o preço muda de direção — e também se engana mais rápido.

O número junto do nome é o **período**: quantos candles entram na conta. A MME9 usa 9 candles; a MMA200 usa 200. No gráfico diário, 9 candles são 9 pregões; no de 60 minutos, são 9 candles de 60 minutos.

## Regras exatas no Radar

Todas as médias usam o **fechamento** dos candles reais — nunca os preços do [Heikin-Ashi](/biblioteca/heikin-ashi).

| Média | Conta | Primeiro valor |
|---|---|---|
| MMA de n períodos | soma dos n últimos fechamentos ÷ n | no n-ésimo candle |
| MME de n períodos | MME de hoje = alfa × fechamento de hoje + (1 − alfa) × MME de ontem, com alfa = 2 ÷ (n + 1) | no n-ésimo candle |

- **Semente da MME**: a primeira MME é a MMA dos n primeiros fechamentos; dali em diante vale a fórmula exponencial. Segundo o registro de decisões do projeto, é a mesma convenção do TA-Lib e do TradingView. Outra plataforma que comece a conta de outro jeito pode mostrar valores um pouco diferentes nos primeiros candles.
- Antes de haver candles suficientes, a média não aparece. O Radar não inventa valores para o começo do histórico.
- **Candle em formação**: a linha se mexe a cada negócio, mas o valor só fica fixo quando o candle fecha. Sinais e setups usam apenas candles fechados.
- As contas são conferidas contra uma implementação independente (em Python), com tolerância de 1 parte em 1 bilhão.

Exemplo hipotético (MME9): alfa = 2 ÷ 10 = 0,2. Se a MME9 de ontem era R$ 20,00 e o fechamento de hoje foi R$ 21,00, a MME9 de hoje é 0,2 × 21,00 + 0,8 × 20,00 = 4,20 + 16,00 = **R$ 20,20**. Numa MMA9, a mudança do dia seria (fechamento que entra − fechamento que sai da janela) ÷ 9.

### As médias do preset "Padrão do canal"

| Média | Tipo | Aparência padrão | Onde o Radar usa |
|---|---|---|---|
| MME9 | exponencial | branca, tracejada e mais grossa | setups 9.1, 9.2 e 9.3; condução dinâmica do 9.1, 9.2, 9.3, recuo e consolidação; confirmação da reflexividade (voltar a subir); alinhamento; candidata a "média respeitada" |
| MME21 | exponencial | laranja | média do recuo quando nenhuma é "respeitada"; precisa estar subindo no recuo à média; reflexividade (descendo no radar, voltando a subir na confirmação, condução); alinhamento; candidata a "média respeitada" |
| MMA50 | aritmética | azul | tendência do painel de contexto e da escala maior; filtro do 9.1; pré-requisito do recuo e da consolidação; descendo no radar da reflexividade; maturidade (experimental); candidata a "média respeitada" |
| MMA200 | aritmética | magenta | candidata a "média respeitada"; régua da maturidade (experimental) |

A especificação diz que o recuo usa a MME9 em tendências muito fortes, a MME21 no caso mais comum e a MMA50 em correções mais profundas. No Radar, a escolha é feita pela "média respeitada": entre 9, 21, 50, 100 e 200, a que segurou pelo menos 2 dos últimos 3 a 5 fundos confirmados (detalhes no [painel de contexto](/biblioteca/painel-contexto)). Não há uma medida de força da tendência nessa escolha.

Períodos e cores podem ser mudados no editor de presets, mas isso muda **só o desenho**: o painel de contexto e os setups continuam usando sempre 9, 21, 50, 100 e 200. O preset "Limpo" desliga todas as médias. Por dentro, o Radar também calcula uma MMA100, usada na busca da "média respeitada" do [painel de contexto](/biblioteca/painel-contexto) (e, se ela for a respeitada, no recuo à média).

### Inclinação

O Radar mede quanto a média andou nos últimos 5 candles, em "unidades de volatilidade" ([ATR14](/biblioteca/atr-e-stop-atr)):

**inclinação = (média agora − média 5 candles atrás) ÷ ATR14 agora**

Dividir pelo ATR permite comparar ativos de preços muito diferentes: andar R$ 1,00 numa ação de R$ 10,00 não é o mesmo que numa de R$ 300,00.

| Rótulo no painel | Regra |
|---|---|
| virando | a média virou para cima ou para baixo neste candle (tem prioridade sobre os outros rótulos) |
| plana | inclinação entre −0,15 e +0,15 (sem incluir as pontas) |
| subindo / caindo | inclinação de 0,15 até menos de 1,0, para cima ou para baixo |
| subindo forte / caindo forte | inclinação de 1,0 ou mais, para cima ou para baixo |

O passo de 5 candles e o limite de 0,15 vêm da especificação e são padrões arbitrários. O limite de 1,0 para "forte" é decisão nossa. Os três podem ser mudados em [Parâmetros dos setups](/setups/parametros) (grupo "Avançado"), mas ainda não há teste no laboratório que os calibre.

Exemplo hipotético: MME21 hoje em R$ 50,60, há 5 candles em R$ 50,00, ATR14 de R$ 2,00. Inclinação = 0,60 ÷ 2,00 = 0,30: "subindo".

### Virar

- **Virou para cima** no candle de hoje: a média de hoje ficou **maior** que a de ontem, e a de ontem era **menor ou igual** à de anteontem. Em palavras: vinha caindo (ou parada) e subiu.
- **Virou para baixo**: o espelho.
- **Subindo**: simplesmente a média de hoje maior que a de ontem. É assim que o Radar define "MMA50 subindo". Para chamar a tendência de "alta", o painel exige, além disso, que a MMA50 não esteja plana (inclinação de pelo menos 0,15).

Exemplo hipotético: MME9 em três candles seguidos = R$ 20,30, R$ 20,10 e R$ 20,15. Ela caiu e depois subiu, então virou para cima no terceiro candle. No [Setup 9.1](/biblioteca/setup-9-1), esse seria o candle-sinal, se os filtros do setup também passarem.

### Filtros e alinhamento

- O 9.1 tem dois filtros separados, os dois ligados por padrão: "MMA50 subindo" (maior que no candle anterior) e "não operar em mercado lateral" (ADX de 20 ou mais e MMA50 sem estar plana, inclinação de pelo menos 0,15 para cima ou para baixo). Os dois vêm da especificação. É **decisão nossa** que sejam independentes: o Experimento E1 liga e desliga só o primeiro.
- O alinhamento do painel de contexto é "preço > MME9 > MME21 > MMA50" (e o inverso na baixa), como pede a especificação.

## Como ler

- Média subindo com o preço acima dela: o caminho recente foi de alta. Média caindo com o preço abaixo: de baixa. Isso descreve o passado; não garante o próximo candle.
- Médias curtas (9 e 21) mostram o movimento recente; médias longas (50 e 200) mostram o pano de fundo.
- O vídeo afirma que as médias servem como filtro de tendência e como suporte ou resistência "dinâmicos": o preço recua até a média e volta a subir. O Radar trata isso como hipótese — veja [Recuo à média](/biblioteca/recuo-a-media).
- **Tocar a média não é sinal.** Nos setups do Radar, o gatilho vem depois, com o candle já fechado.

## Quando engana

- **Mercado lateral**: a média ziguezagueia e "vira" o tempo todo. Cada virada da MME9 pode parecer um setup novo. Por isso o 9.1, com o filtro de mercado lateral ligado (o padrão), exige MMA50 inclinada e ADX de 20 ou mais.
- **Virada mínima também conta**: a regra não exige tamanho mínimo. Se a MME9 subir um centavo, é uma virada.
- **Atraso**: toda média olha para trás. Numa reversão rápida, ela vira depois que boa parte do movimento já aconteceu.
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento aparece como um tombo falso do preço, e as médias demoram a "esquecer" esse tombo (a MMA200 leva 200 candles).
- **Começo do histórico**: logo depois que a média aparece, plataformas diferentes podem mostrar valores um pouco diferentes por causa da semente.
- **Candle em formação**: no meio do candle a MME9 pode parecer virada e "desvirar" até o fechamento.

## De onde veio

O vídeo recomenda médias exponenciais para períodos curtos (9 e 21) e aritméticas para longos (50 e 200), usadas como filtro de tendência e como suporte ou resistência dinâmicos; segundo ele, o recuo à média é o setup clássico. O Setup 9.1, que depende da MME9, é atribuído pelo vídeo a Larry Williams.

As regras de inclinação e de "virar" foram escritas na especificação do Radar para transformar frases como "a média está apontando para cima" em algo que o computador consiga conferir sempre do mesmo jeito.

## Críticas

- Os períodos 9, 21, 50 e 200 são convenções do canal. O vídeo não mostra por que esses números e não outros. O mapa de sensibilidade do laboratório hoje varia só o alvo em R desses setups, não os períodos das médias, então essa escolha continua sem teste no Radar.
- "A média segurou o preço" é fácil de ver depois do fato. Com quatro médias na tela, quase sempre alguma parece ter segurado. O painel de contexto conta quantos recuos cada média segurou, para trocar impressão por contagem.
- O vídeo afirma que o filtro "MMA50 subindo" "muda tudo" no 9.1, mas não mostrou números. O Experimento E1 (no Laboratório, em "Verificar o youtuber") compara o 9.1 no diário com e sem esse filtro, com o filtro de mercado lateral ligado nas duas versões; o resultado depende dos dados reais e precisa ser lido com a amostra e os custos.
- Nenhuma média prevê o futuro: ela resume o passado. Qualquer conclusão sobre uma estratégia com médias precisa incluir custos, imposto e comparação com o CDI do mesmo período.
