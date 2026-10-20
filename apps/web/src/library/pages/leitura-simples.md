---
titulo: Leitura simples (para onde o preço tende a ir)
categoria: conceito
resumo: O cartão do modo simples: a tendência de agora e o que aconteceu antes neste ativo, sempre comparado com um dia qualquer. Não é previsão.
relacionados: painel-contexto, teoria-de-dow, medias-moveis, adx, visao-fractal, antes-de-arriscar-dinheiro, expectativa
---

## O que é

No modo simples, o gráfico mostra um cartão no topo com duas respostas:

1. **Como o preço está agora**: tendência de alta, de baixa ou sem tendência (lateral).
2. **O que aconteceu antes**: nas outras vezes em que este mesmo ativo, nesta mesma escala, estava com a mesma tendência, em quantas o preço estava mais alto 10 candles depois. E a comparação com **um candle qualquer** do mesmo ativo.

**Ninguém sabe se o preço vai subir ou descer.** O cartão não adivinha o futuro. Ele mostra o que aconteceu antes, em situações parecidas, e se isso foi diferente do normal.

## Como ler

- **"Histórico: subiu mais que o normal"**: com a tendência de agora, o preço subiu mais vezes do que num candle qualquer. A diferença foi grande o bastante e os casos foram suficientes.
- **"Histórico: caiu mais que o normal"**: o contrário. Isso pode aparecer até numa tendência de alta: quer dizer que, neste ativo, as altas costumavam corrigir logo depois.
- **"Histórico: sem vantagem clara"**: a tendência de agora **não ajudou** a prever neste ativo. É o resultado mais comum, e é honesto.
- **"Poucos casos para concluir"**: menos de 30 casos. Qualquer porcentagem com tão poucos casos é sorte ou azar.

Exemplo: "em 58% das 45 vezes o preço estava mais alto; num candle qualquer, 52%". A diferença é de 6 pontos com 45 casos. Pela regra abaixo, isso ainda é **sem vantagem clara**.

## Regras exatas no Radar

- **Tendência**: a mesma regra do [Painel de contexto](/biblioteca/painel-contexto) (estrutura de topos e fundos, MMA50 e ADX). Só candles **fechados**.
- **Janela**: 10 candles à frente (no diário, cerca de duas semanas; no 1 minuto, 10 minutos).
- **Casos sem repetição**: depois de contar um caso, o próximo do mesmo tipo só conta a partir do fim da janela dele. Senão, a mesma subida seria contada 10 vezes.
- **Só o passado conhecido**: a tendência de cada caso usa apenas os candles até ele. Os últimos 10 candles ainda não entram, porque o futuro deles não aconteceu.
- **Vantagem** só aparece com tudo isto ao mesmo tempo: 30 casos ou mais, diferença de 5 pontos percentuais ou mais contra um candle qualquer e um teste estatístico simples (z de 2 ou mais, cerca de 95% de confiança).
- **Escala maior**: o cartão também mostra a tendência da escala maior (por exemplo, a semanal quando você olha o diário). Se ela estiver contra, aparece um aviso: a escala maior costuma mandar ([Visão fractal](/biblioteca/visao-fractal)).
- Esses números (10 candles, 30 casos, 5 pontos, z de 2) são escolhas nossas, não do canal (ADR-0029).

## O que o cartão NÃO considera

- **Custos e imposto**: corretagem, spread, derrapagem e imposto de renda ficam de fora. Um "subiu mais vezes" pode virar prejuízo depois dos custos.
- **Tamanho do movimento**: subir mais vezes não quer dizer ganhar mais. A variação mediana aparece no detalhe, mas a conta de risco e retorno é a do [Laboratório](/biblioteca/expectativa).
- **O futuro**: o mercado muda. O que funcionou em 2020 pode não funcionar em 2027.
- **Alternativa sem risco**: compare sempre com o CDI. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
