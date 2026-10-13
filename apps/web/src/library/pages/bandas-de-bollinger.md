---
titulo: Bandas de Bollinger
categoria: indicador
resumo: Média de 20 com faixas de 2 ou 3 desvios-padrão: a conta exata do Radar, a largura das bandas e por que "3 desvios = 1 em 1000" não vale no mercado.
relacionados: elastico, rompimento-consolidacao, medias-moveis, atr-e-stop-atr, contradicoes-entre-as-fontes
---

## O que é

São três linhas em volta do preço:

- **média central**: a média aritmética (MMA) dos últimos 20 fechamentos;
- **banda superior**: média central + k desvios-padrão;
- **banda inferior**: média central − k desvios-padrão.

O **desvio-padrão** mede o quanto os fechamentos da janela se espalham em volta da média. Mercado calmo, desvio pequeno, bandas apertadas. Mercado agitado, desvio grande, bandas largas. O **k** é quantos desvios de distância: o Radar usa 3 (ligado por padrão) e 2 (opcional).

## Regras exatas no Radar

- **Média central**: MMA de 20 fechamentos.
- **Desvio-padrão populacional**: a soma dos quadrados das distâncias é dividida por n (20), e não por n − 1. Segundo o registro de decisões do projeto, é a mesma conta do TradingView. Se outra plataforma usar a divisão por n − 1 (19), as bandas dela ficam cerca de 2,6% mais afastadas da média (raiz de 20/19 ≈ 1,026).
- **A janela inclui o candle atual**: o fechamento de hoje entra na conta das bandas de hoje.
- **Primeiro valor**: no 20º candle. Antes disso, as bandas não aparecem.
- **Largura** = (banda superior − banda inferior) ÷ média central. A largura não aparece no gráfico; é usada por dentro.
- Tudo é calculado sobre os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).
- As contas são conferidas contra uma implementação independente (em Python), com tolerância de 1 parte em 1 bilhão.

| Bandas | No preset "Padrão do canal" | Aparência padrão | Uso no Radar |
|---|---|---|---|
| 20/3 | ligada | cinza claro; média central tracejada | Elástico: entra em "radar" quando um candle **fecha** fora |
| 20/2 | desligada (opcional) | cinza mais escuro, tracejada | contração de volatilidade no rompimento de consolidação |

A 20/2 da consolidação é calculada por dentro mesmo quando a linha está desligada no gráfico. Mudar o período ou os desvios no editor de presets muda **só o desenho**: o Elástico continua usando 20/3 e a consolidação, 20/2.

**Alertas**: há alertas de "fechou abaixo da banda inferior" e "fechou acima da banda superior", sempre no fechamento do candle. O formulário começa com período 9 e 3 desvios; para a mesma banda do Elástico, troque o período para 20.

### Fechar fora (Elástico)

- Conta só o **fechamento** abaixo da banda inferior (compra) ou acima da superior (venda). Encostar ou furar só com o pavio não conta.
- Isso coloca o setup em "radar". **Ainda não é compra.** As regras completas estão em [Elástico](/biblioteca/elastico).

### Contração (Rompimento de consolidação)

- A largura atual da 20/2 precisa estar entre as 20% menores larguras dos últimos 120 candles (o "menor quintil"), com pelo menos 20 larguras disponíveis para comparar.
- Alternativa aceita: ATR de 5 menor que ATR de 20 (volatilidade recente menor que a de prazo mais longo).
- Os 120 candles e o quintil são padrões arbitrários da especificação. Dá para mudá-los em [Parâmetros dos setups](/setups/parametros), no grupo da consolidação. Regras completas em [Rompimento de consolidação](/biblioteca/rompimento-consolidacao).

### Exemplo hipotético

Média central de R$ 50,00 e desvio-padrão de R$ 1,00 (já calculados com o fechamento do próprio candle):

- **20/2**: bandas em R$ 48,00 e R$ 52,00. Largura = 4,00 ÷ 50,00 = 0,08 (8%).
- **20/3**: bandas em R$ 47,00 e R$ 53,00.
- Um candle que fecha em R$ 46,90 fechou fora da 20/3: radar do Elástico.
- Um candle que desce até R$ 46,50, mas fecha em R$ 47,20, **não** conta.

## Como ler

- **Bandas se abrindo**: a volatilidade está aumentando. **Bandas se fechando**: diminuindo.
- O setup de consolidação parte da hipótese de que um período de bandas apertadas antecede um movimento forte. É hipótese do canal, não fato. Você pode testar o setup de consolidação inteiro na tela Laboratório, com os candles reais e os custos; o laboratório não isola o efeito das bandas sozinhas.
- **A média central** é a mesma MMA20 e serve de alvo no Elástico.
- Fechar fora da 20/3 é bem mais raro do que fechar fora da 20/2 — mas não é "1 em 1000" (veja as críticas).

## Quando engana

- **Tendência forte**: numa alta forte, o preço pode fechar colado ou fora da banda superior várias vezes seguidas. Quem vende "porque esticou" fica contra o movimento.
- **A banda corre atrás do preço**: como o fechamento de hoje entra na conta, um candle enorme alarga as bandas no mesmo candle. Por isso fechar fora de 3 desvios exige um movimento muito grande em relação aos 19 candles anteriores — e, quando acontece, o mercado já está agitado.
- **Contração não diz a direção**: bandas apertadas dizem que a volatilidade está baixa, não para que lado o preço vai sair.
- **Dados sem ajuste**: um desdobramento não ajustado no histórico da B3 (COTAHIST 🟡) gera um "fechamento fora" falso.
- **Pouco histórico**: com menos de 20 candles, não há bandas; com pouco mais que isso, a comparação de largura dos "últimos 120 candles" usa uma amostra pequena.

## De onde veio

- O vídeo apresenta o "elástico" como adaptação da lógica atribuída a Takashi Kotegawa, que, segundo o vídeo, media a distância do preço até a média de 25 períodos. O canal troca essa medida pela Bollinger de 20 períodos e 3 desvios.
- O vídeo afirma que fechar fora de 3 desvios é um evento de "1 em 1000".
- A 20/2 entra pela especificação do Radar, como medida de contração no setup de rompimento de consolidação.
- A história do indicador e de quem o criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- **"3 desvios = 1 em 1000" vale para a curva normal.** Na curva normal, ficar além de 3 desvios aconteceria em cerca de 0,13% dos casos de cada lado — é o número de comparação do Experimento E2. A especificação do Radar parte da hipótese de que retornos de mercado têm "caudas gordas": movimentos extremos aconteceriam mais vezes do que a curva normal prevê. É hipótese a medir, não número conferido aqui. O Experimento E2 (no Laboratório, em "Verificar o youtuber") conta, no diário de cada ativo, quantas vezes o preço fechou fora da 20/3 e em quantas tocou a média central em até 10 candles. Ele compara a contagem com a curva normal e com um "passeio aleatório" (preço sorteado com a mesma volatilidade do ativo e medido com a mesma régua) — essa segunda comparação é a mais justa, porque a banda olha só 20 candles e nem num mundo "normal" bateria com 0,13%. Os números dependem dos dados reais de cada ativo; nada nesta página antecipa o resultado. Voltar à média também não diz se dava para lucrar: faltam stop, custos e o que aconteceu antes.
- **Ir contra o movimento**: o Elástico compra quedas fortes e vende altas fortes. Isso contradiz a regra do próprio canal de "nunca operar contra a tendência" — veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes).
- **Day trade**: o vídeo demonstra o elástico no mini-índice em 5 minutos, mas outro vídeo do canal chama o day trade de "massacre estatístico". A especificação do Radar manda avisar que, no intradiário, a taxa de acerto tende a ser menor e os custos, maiores.
- **Parâmetros sem números**: 20 períodos e 3 desvios não foram justificados com estatística. No mapa de sensibilidade do laboratório (quando o Elástico está entre os dois primeiros setups escolhidos), ele é rodado com 2,5, 3 e 3,5 desvios para ver se o resultado se sustenta nos vizinhos. O período de 20 não é variado.
