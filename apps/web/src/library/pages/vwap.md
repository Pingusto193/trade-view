---
titulo: VWAP
categoria: indicador
resumo: O preço médio do pregão, ponderado pelo volume. Recomeça a cada dia e só faz sentido no intradiário. Opcional e desligada por padrão.
relacionados: volume, medias-moveis, candles, slippage-e-custos, antes-de-arriscar-dinheiro
---

## O que é

A VWAP (sigla em inglês para "preço médio ponderado pelo volume") é uma linha desenhada **sobre os candles** (ciano, por padrão). Ela mostra, de forma aproximada, o preço médio dos negócios do dia até agora, dando mais peso aos candles em que se negociou mais.

É parecida com uma média móvel, com duas diferenças:

- cada candle pesa conforme o **volume** dele, e não igual aos outros;
- ela **recomeça a cada pregão**: no primeiro candle do dia, a VWAP é o preço típico daquele candle (explicado abaixo), e vai acumulando até o fim do dia.

A VWAP é **opcional** e vem **desligada** no preset "Padrão do canal".

## Regras exatas no Radar

1. **Preço típico** de cada candle = (máxima + mínima + fechamento) ÷ 3.
2. **VWAP** = soma de (preço típico × volume) ÷ soma do volume, juntando todos os candles do pregão até o candle atual, inclusive.
3. **Recomeço**: a soma zera quando muda a **data local da bolsa** do ativo.
4. Se o volume somado do pregão ainda for zero, não há VWAP (a linha fica sem valor).

| Mercado | Fuso usado para "mudar de dia" | Quando a VWAP recomeça |
|---|---|---|
| B3 | São Paulo | à meia-noite de Brasília |
| Ações dos EUA | Nova York | à meia-noite de Nova York |
| Cripto (Binance) | UTC | à meia-noite UTC (21h em Brasília, quando Brasília está 3 horas atrás do UTC) |

- **Sem parâmetros**: só a cor pode ser mudada no editor de indicadores.
- **Candles fora do horário regular**: todos os candles com a mesma data local entram na conta. Se a fonte trouxer negócios antes da abertura ou depois do fechamento, eles também pesam.
- **Candle em formação**: o último valor é recalculado a cada atualização do preço e do volume, e só fica definitivo quando o candle fecha.
- Usa os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).
- **Teste limitado**: a conta é conferida contra uma implementação independente (em Python), mas o teste de referência usa candles **diários**, em que a VWAP é só o preço típico de cada candle. A soma ao longo do dia (o caso que importa, no intradiário) e o recomeço pela data local da bolsa ainda não têm teste próprio.

### Só faz sentido no intradiário

No diário, semanal e mensal, **cada candle tem uma data própria**. A VWAP recomeça a cada candle e fica igual ao preço típico dele: (máxima + mínima + fechamento) ÷ 3. Nessas escalas, a linha não tem utilidade.

Hoje, as ações da B3 no Radar só têm candles diários, semanais e mensais. Por isso, a VWAP só é útil, na prática, em escalas de 1 a 60 minutos de cripto e de ações dos EUA.

### Onde a VWAP entra

- **Em nada além do gráfico.** Nenhum setup, alerta, item do [painel de contexto](/biblioteca/painel-contexto) ou teste do laboratório usa a VWAP hoje.

### Exemplo hipotético

Três candles de 5 minutos no início de um pregão:

| Candle | Preço típico | Volume | Preço típico × volume |
|---|---|---|---|
| 1º | R$ 10,00 | 1.000 | R$ 10.000,00 |
| 2º | R$ 10,20 | 3.000 | R$ 30.600,00 |
| 3º | R$ 10,10 | 1.000 | R$ 10.100,00 |

VWAP no 3º candle = 50.700,00 ÷ 5.000 = **R$ 10,14**. Uma média simples dos três preços típicos daria R$ 10,10; a VWAP ficou mais perto de R$ 10,20 porque o 2º candle teve o triplo do volume.

## Como ler

- **Preço acima da VWAP**: o preço atual está acima do preço médio negociado no dia, considerando o volume. **Abaixo**: o contrário.
- **Começo do dia**: com poucos candles, a VWAP fica colada no preço. Ela ganha "peso" ao longo do pregão.
- **Fim do dia**: com o dia quase todo somado, um candle novo de volume comum muda pouco a VWAP.

## Quando engana

- **Volume de qualidade variável**: na cripto, o volume é só o da Binance, não o do mercado inteiro ✅. Nas ações dos EUA pelo plano gratuito, o volume ao vivo vem só da bolsa IEX, uma fração do total ✅. A VWAP calculada com esse volume pesa os candles de outro jeito do que pesaria o mercado inteiro. Veja [Volume](/biblioteca/volume).
- **Sem volume, sem VWAP**: se a fonte não informa volume, a linha não aparece.
- **É uma aproximação**: o Radar usa um preço típico por candle, não o preço de cada negócio. Quem calcula com os negócios um a um, ou com candles de outro tamanho, chega a um número um pouco diferente.
- **Cripto não tem pregão**: o mercado funciona 24 horas, e o recomeço à meia-noite UTC é só uma convenção. A VWAP de quem usa outro horário de corte é diferente.
- **Escala errada**: no diário ou acima, a linha vira só o preço típico de cada candle (veja acima).
- **Candles fora do horário regular**: se entrarem na conta, mudam a VWAP do dia em relação à de quem só considera o pregão regular.

## De onde veio

A VWAP entra no Radar porque a especificação a lista entre os indicadores **opcionais, desligados por padrão**, junto com MACD, IFR, estocástico e Bollinger de 2 desvios. A regra "ancorada no pregão, zera a cada data local" está no registro de decisões do projeto.

Os vídeos do canal resumidos na especificação não falam da VWAP. Segundo o vídeo, o youtuber usa médias e price action como base, o ADX para medir força e o ATR para stop e condução.

A história do indicador e de quem o criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- **Ferramenta de day trade.** A VWAP só faz sentido dentro do dia, e um vídeo do próprio canal afirma que o day trade é um "massacre estatístico" (mesmo canal que demonstra o elástico no mini-índice em 5 minutos; veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes)). Um estudo da FGV com day traders no mercado futuro de ações brasileiro encontrou que 97% dos que persistiram por pelo menos 300 dias perderam dinheiro ✅. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **Custos pesam mais no intradiário.** Operações curtas têm alvos pequenos, e corretagem, taxas e derrapagem comem uma parte maior do resultado. Veja [Slippage e custos](/biblioteca/slippage-e-custos).
- **Nenhum número sustenta o uso.** Nem os vídeos nem a especificação trazem teste de regras com a VWAP, e o Radar não a testa no laboratório.
- **Uma linha a mais para "confirmar".** Como qualquer indicador, ela pode virar justificativa para o que você já queria fazer. Ligue só se souber, antes, o que vai fazer com ela.
