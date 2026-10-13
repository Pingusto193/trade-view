---
titulo: Teoria de Dow
categoria: conceito
resumo: Tendências de alta, baixa e lateral em três níveis, segundo o vídeo, e como o Radar transforma "topos e fundos ascendentes" em regra objetiva.
relacionados: primitivas-price-action, painel-contexto, visao-fractal, adx, volume, suporte-e-resistencia
---

## O que é

Segundo o vídeo, a teoria de Dow diz que:

- os preços se movem em tendências: alta, baixa ou lateral;
- há três níveis de tendência — primária, secundária e terciária —, que o vídeo associa ao mensal, ao semanal e ao diário ou intradiário;
- o volume confirma a tendência;
- o preço "desconta tudo" (toda informação disponível já estaria no preço);
- uma tendência continua até que sinais técnicos mostrem o contrário.

São afirmações do vídeo, não fatos comprovados. Em palavras simples: **tendência de alta** é uma sequência de topos e fundos cada vez mais altos; **de baixa**, cada vez mais baixos; **lateral**, nem uma coisa nem outra.

## Como o Radar usa

### Topos e fundos

Um **topo** é um candle cuja máxima é maior que a máxima dos 2 candles de cada lado. Um **fundo** é o espelho, com a mínima. Em caso de empate de preço, vale o primeiro candle (decisão nossa). O topo só passa a "existir" para o Radar **2 candles depois**, quando os candles da direita já fecharam — antes disso não dá para saber se ele seria superado. Isso evita usar informação do futuro. O número 2 é um padrão arbitrário da especificação; no código é um parâmetro, mas ainda não há tela para mudá-lo. Detalhes em [Primitivas de price action](/biblioteca/primitivas-price-action).

### Estrutura

- **Alta**: os dois últimos topos e os dois últimos fundos confirmados são ascendentes (o mais recente acima do anterior).
- **Baixa**: os dois últimos topos e os dois últimos fundos são descendentes.
- **Indefinida**: qualquer outra combinação, ou menos de dois topos e dois fundos confirmados.

### Tendência no painel de contexto

O [painel de contexto](/biblioteca/painel-contexto) só chama de **alta** quando três coisas acontecem juntas no último candle fechado:

1. estrutura de alta;
2. MMA50 subindo (maior que no candle anterior) e sem estar plana: ela precisa ter andado pelo menos 0,15 ATR nos últimos 5 candles (veja [Médias móveis](/biblioteca/medias-moveis));
3. [ADX](/biblioteca/adx) de 20 ou mais.

**Baixa** é o espelho. Qualquer outro caso é **lateral**. Ao tocar no item, o painel mostra a estrutura, a MMA50, a inclinação e o ADX que levaram à conclusão. O painel só aparece com pelo menos 31 candles fechados, e a tendência fica "indefinida" até haver 55 candles (a MMA50 e a inclinação dela precisam desse histórico).

Exemplo hipotético: fundos em R$ 18,00 e R$ 19,20; topos em R$ 21,00 e R$ 22,50. A estrutura é de alta. Se a MMA50 estiver subindo sem estar plana e o ADX for 23, o painel diz "Alta". Se o ADX for 17, o painel diz "Lateral" — mesmo com a estrutura de alta.

### Os três níveis

O modo "3 escalas" mostra o mesmo ativo em três tempos gráficos lado a lado. O mapeamento "Operação no semanal" (mensal + semanal + diário) é o mais próximo dos três níveis descritos no vídeo. Veja [Visão fractal](/biblioteca/visao-fractal).

### Volume confirma

As regras objetivas de volume (acima da média, secando etc.) estão em [Volume](/biblioteca/volume). Alguns setups usam volume, mas a tendência do painel de contexto **não** usa volume.

## Quando engana

- **Atraso da estrutura**: cada topo ou fundo só é confirmado 2 candles depois. Um fundo mais baixo já tira a estrutura de "alta" (vira "indefinida"), mas para virar "baixa" é preciso que os dois últimos topos e os dois últimos fundos confirmados sejam descendentes. A virada sempre chega atrasada.
- **Tamanho da lente**: com 2 candles de cada lado, pequenos repiques já viram topos e fundos. Outro valor mudaria a estrutura.
- **Rótulo que pisca**: basta a MMA50 recuar um candle para o painel trocar "alta" por "lateral". Olhe a sequência, não um candle só.
- **Escalas diferentes, respostas diferentes**: o diário pode estar em alta e o semanal em baixa ao mesmo tempo. Isso é normal; a [visão fractal](/biblioteca/visao-fractal) trata desse conflito.
- **Lateral longo**: num mercado de lado, topos e fundos se alternam e a estrutura fica indefinida. Segundo a lógica do canal, é onde setups de tendência mais sofrem.

## Críticas

- "O preço desconta tudo" não pode ser verificado. Serve como atitude (olhar o gráfico em vez de opiniões), não como prova de que o gráfico prevê algo.
- "A tendência continua até mostrar o contrário" é quase uma definição: toda tendência acaba, e só sabemos quando acabou depois. A pergunta útil é quanto custa esperar a confirmação.
- O vídeo associa os três níveis a escalas fixas (mensal, semanal, diário). É uma simplificação prática do canal.
- A origem e a autoria da teoria não estão descritas aqui porque ainda não foram conferidas em fonte registrada no projeto.
