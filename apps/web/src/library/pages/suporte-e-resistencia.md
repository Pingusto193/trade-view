---
titulo: Suporte e resistência
categoria: conceito
resumo: Regiões onde o preço parou antes. Por que são zonas e não linhas, a inversão de polaridade, a confluência e o que o Radar mede de forma objetiva.
relacionados: primitivas-price-action, rompimento-consolidacao, recuo-a-media, medias-moveis, padroes-graficos, visao-fractal
---

## O que é

- **Suporte**: uma região de preço onde quedas pararam antes e o preço voltou a subir.
- **Resistência**: uma região onde altas pararam antes e o preço voltou a cair.

O vídeo afirma que:

- são **zonas, não linhas**;
- quanto mais testes, mais forte a zona;
- resistência rompida tende a virar suporte, e vice-versa (**inversão de polaridade**);
- níveis de escalas maiores pesam mais;
- **confluência** com médias móveis reforça a zona.

São afirmações do vídeo, não fatos comprovados.

### Zona, não linha

Exemplo hipotético: o preço parou de subir três vezes, em R$ 24,85, R$ 25,10 e R$ 24,95. Uma linha em R$ 25,00 teria sido "furada" uma vez e não alcançada nas outras duas. Uma zona de R$ 24,85 a R$ 25,10 descreve melhor o que aconteceu.

### Inversão de polaridade

Exemplo hipotético: uma ação passou meses sem conseguir fechar acima de R$ 25,00. Rompeu, subiu até R$ 27,00 e voltou para perto de R$ 25,00, onde parou de cair. A antiga resistência agiu como suporte.

### Confluência

Quando uma zona horizontal coincide com outra referência — por exemplo, a MME21 passando pela mesma região —, o vídeo diz que a zona fica mais forte.

## Como o Radar usa

- **Desenho**: as ferramentas "Zona de preço" (um retângulo) e "Linha horizontal" ficam salvas no servidor e aparecem em todos os seus aparelhos. Cada desenho pode valer só na escala em que foi feito ou em todas as escalas.
- **Alerta no desenho**: uma zona pode avisar quando o preço entra ou sai dela; uma linha, quando o preço a cruza. Você escolhe "no fechamento do candle" (mais perto da regra de rompimento abaixo) ou "no toque", que dispara no meio do candle.
- **Rompimento válido**: nas regras do Radar, rompimento conta por **fechamento** além do nível. Pavio não conta. Há um parâmetro no código para aceitar pavio, mas ainda não há tela para mudá-lo.
- **Falso rompimento**: rompe por fechamento e, em até 2 candles depois, volta a fechar dentro da região (fechar exatamente no nível conta como dentro). O número 2 é padrão arbitrário da especificação. Hoje essa regra é usada no [rompimento de consolidação](/biblioteca/rompimento-consolidacao), não nos seus desenhos.
- **Topos e fundos objetivos**: o Radar identifica topos e fundos com regra fixa ([Primitivas de price action](/biblioteca/primitivas-price-action)). Eles não são desenhados no gráfico, mas entram nos setups — por exemplo, "fundo anterior preservado" no [recuo à média](/biblioteca/recuo-a-media) — e os dois últimos aparecem no painel de contexto.
- **Caixa da consolidação**: no [rompimento de consolidação](/biblioteca/rompimento-consolidacao), o topo e a base da caixa funcionam como resistência e suporte. Existe uma variante de entrada no **reteste**: esperar o preço voltar ao topo rompido sem fechar de novo dentro da caixa — é a ideia da inversão de polaridade em forma de regra. Nesta versão ela substitui a entrada no rompimento (não é uma segunda compra), não tem tela para ser ligada e é usada no Experimento E5 (no Laboratório, em "Verificar o youtuber").
- **Suporte dinâmico**: o [painel de contexto](/biblioteca/painel-contexto) mostra qual média "segurou" os últimos recuos, com a contagem (por exemplo, "4 de 5 recuos").

O que o Radar **não** faz nesta versão: não encontra zonas horizontais sozinho, não conta quantos testes uma zona teve e não mede a "força" de uma zona. Essas leituras continuam sendo suas, desenhadas à mão.

## Quando engana

- **Desenho depois do fato**: olhando o passado, é fácil achar uma linha que "segurou". Na hora, o preço passa por muitas regiões que não seguram nada.
- **Largura da zona**: não existe regra para a largura. Uma zona larga demais "sempre funciona"; uma estreita demais "sempre fura".
- **Pavio contra fechamento**: um candle pode furar a zona com a sombra e fechar dentro. Pela regra do Radar, isso não é rompimento.
- **Escala**: uma zona importante no 15 minutos pode ser ruído no diário.
- **Dados sem ajuste**: no histórico longo da B3 (COTAHIST), que não é ajustado por proventos e desdobramentos 🟡, zonas antigas ficam em preços que deixam de fazer sentido depois de um desdobramento.

## De onde veio

As ideias de zona, número de testes, inversão de polaridade, peso das escalas maiores e confluência vêm do vídeo e são afirmações dele. As regras de rompimento por fechamento e de falso rompimento vêm da especificação do Radar. A origem histórica desses conceitos não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- "Quanto mais testes, mais forte" é afirmação do vídeo, sem números. O Radar ainda não testa zonas no laboratório, porque elas são desenhadas à mão.
- A inversão de polaridade é fácil de lembrar quando funciona e fácil de esquecer quando falha (viés de confirmação).
- Com várias médias, várias zonas e várias escalas, quase todo preço tem alguma "confluência". Quanto mais referências você usa, menos cada uma significa.
