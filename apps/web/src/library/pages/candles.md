---
titulo: Leitura de candles
categoria: conceito
resumo: Corpo, sombras e fechamento: o que cada parte do candle mostra, as três perguntas do vídeo e quais padrões o Radar reconhece sozinho.
relacionados: primitivas-price-action, suporte-e-resistencia, volume, heikin-ashi, recuo-a-media, elastico
---

## O que é

Cada candle (vela) resume a negociação de um período — 5 minutos, um dia, uma semana — em quatro preços:

- **abertura**: o primeiro preço do período;
- **máxima**: o mais alto;
- **mínima**: o mais baixo;
- **fechamento**: o último.

As partes do candle:

- **Corpo**: a parte grossa, entre a abertura e o fechamento. Por padrão, verde quando o fechamento ficou acima da abertura e vermelho quando ficou abaixo.
- **Sombras (pavios)**: as linhas finas acima e abaixo do corpo, que vão até a máxima e a mínima. Mostram até onde o preço chegou e de onde foi "rejeitado".
- **Amplitude**: máxima − mínima, o tamanho total do candle.

## Como o Radar usa

### As três perguntas

O vídeo propõe ler cada candle olhando o corpo (força), as sombras (rejeição) e a posição do fechamento, com três perguntas:

1. **Quem dominou?** Compradores, se o fechamento ficou perto da máxima; vendedores, se ficou perto da mínima.
2. **Com que força?** Corpo grande em relação aos candles anteriores indica movimento forte; corpo pequeno, equilíbrio.
3. **Onde aconteceu?** Segundo o vídeo, padrão de candle só vale em região relevante: [suporte ou resistência](/biblioteca/suporte-e-resistencia) ou perto de uma [média móvel](/biblioteca/medias-moveis).

Exemplo hipotético: candle diário com abertura R$ 20,00, máxima R$ 21,00, mínima R$ 19,90 e fechamento R$ 20,90. Amplitude = R$ 1,10; corpo = R$ 0,90 (cerca de 82% da amplitude); fechamento a R$ 0,10 da máxima. Quem dominou: compradores. Com que força: depende dos candles anteriores — se os corpos recentes eram de R$ 0,30, este é bem maior. Onde: se aconteceu longe de qualquer região relevante, o vídeo diz que vale pouco.

### Na tela

A legenda no topo do gráfico mostra, para o candle sob o cursor: **A** (abertura), **M** (máxima), **m** (mínima), **F** (fechamento), a variação em % e o volume. Atenção: essa variação compara o fechamento com a **abertura do próprio candle**, e não com o fechamento do candle anterior.

### Padrões que o Radar reconhece

O Radar reconhece alguns candles com regras numéricas fixas, sempre **depois que o candle fecha**. A definição exata de cada um, com os números, está em [Primitivas de price action](/biblioteca/primitivas-price-action). Em resumo:

- **Candle de força**: corpo bem maior que a média dos corpos recentes, fechando perto do extremo.
- **Barra de ignição**: corpo ainda maior, quase sem sombra no lado do movimento.
- **Martelo**: sombra inferior longa e corpo pequeno no alto do candle.
- **Doji**: corpo minúsculo em relação à amplitude (abertura quase igual ao fechamento).
- **Inside bar**: candle inteiro "dentro" do anterior (máxima menor e mínima maior).

Onde eles entram nesta versão:

- [Recuo à média](/biblioteca/recuo-a-media): candle de força de alta, martelo ou inside bar no candle que arma o setup somam 1 ponto a favor (no máximo 1, mesmo que apareça mais de um); candle de força de baixa durante o recuo é sinal de alerta.
- [Elástico](/biblioteca/elastico): martelo ou candle de força como confirmação opcional.
- [Rompimento de consolidação](/biblioteca/rompimento-consolidacao): o candle de rompimento precisa ter corpo grande em relação aos anteriores.
- Doji e barra de ignição já têm regra, mas nenhum setup os usa nesta versão.

## Quando engana

- **A escala muda o candle**: o mesmo movimento pode ser um martelo no diário e três candles comuns no 60 minutos.
- **Candle em formação**: até fechar, um "martelo" pode virar outra coisa. O Radar só reconhece padrões em candles fechados.
- **Horário do candle diário**: na cripto, o candle diário começa à meia-noite UTC (convenção do projeto, a mesma da Binance), que não é meia-noite no horário de Brasília. Na B3, o candle diário é o pregão do dia.
- **Gaps**: o salto entre o fechamento de ontem e a abertura de hoje não aparece no corpo de nenhum dos dois candles.
- **Dados sem ajuste**: no histórico longo da B3 (COTAHIST), que não é ajustado por proventos e desdobramentos 🟡, um desdobramento cria um salto falso entre dois candles.
- **Heikin-Ashi**: no modo [Heikin-Ashi](/biblioteca/heikin-ashi), a forma dos candles é outra e as leituras desta página não valem.

## De onde veio

As três perguntas e a ideia de que um padrão de candle só vale em região relevante vêm do vídeo: são afirmações dele, sem números. As regras numéricas (força, ignição, martelo, doji, inside bar) vêm da especificação do Radar. A história dos candles e de quem os criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- Um candle sozinho carrega pouca informação. Nomes como "martelo" parecem precisos, mas cada autor e cada plataforma usa números diferentes. Os números do Radar são padrões arbitrários da especificação. No código eles são parâmetros, mas ainda não há tela para mudá-los nem teste no laboratório que os calibre.
- Ler candles depois do fato é fácil; o difícil é decidir com o futuro escondido. Um modo de replay (rever o gráfico candle a candle, sem ver o futuro) está previsto, mas ainda não existe. Por enquanto, o Modo Treino com preço ao vivo é o jeito de praticar sem dinheiro real.
- O vídeo não mostra estatística de acerto para nenhum padrão de candle.
