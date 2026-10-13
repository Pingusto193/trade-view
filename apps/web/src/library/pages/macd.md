---
titulo: MACD
categoria: indicador
resumo: A distância entre duas médias exponenciais (12 e 26) e a média dessa distância. Opcional e desligado; o youtuber diz não usá-lo como base.
relacionados: medias-moveis, ifr, estocastico, adx, contradicoes-entre-as-fontes
---

## O que é

O MACD aparece num painel abaixo do gráfico, com três partes:

- **Linha MACD** (azul): a média exponencial de 12 fechamentos **menos** a média exponencial de 26. Ela mostra a distância entre uma média rápida e uma lenta.
- **Linha de sinal** (laranja): uma média exponencial de 9 da própria linha MACD. É uma versão mais lenta da linha MACD.
- **Histograma** (barras cinza): linha MACD − linha de sinal.

Uma linha horizontal marca o zero. Quando a linha MACD está acima de zero, a média de 12 está acima da de 26: os preços recentes estão, em média, mais altos que os de um prazo um pouco maior.

O MACD é **opcional** e vem **desligado** no preset "Padrão do canal". O vídeo do canal diz que o youtuber **não usa** MACD como base das análises.

## Regras exatas no Radar

- **Média exponencial (MME)**: peso alfa = 2 ÷ (n + 1). O primeiro valor é a média simples dos n primeiros fechamentos (a "semente"); daí em diante, cada valor novo = alfa × fechamento + (1 − alfa) × valor anterior. É a mesma conta das [Médias móveis](/biblioteca/medias-moveis) exponenciais do gráfico.
- **Linha MACD** = MME(12) − MME(26) dos fechamentos.
- **Linha de sinal** = MME(9) da linha MACD, com a mesma semente: a média simples dos 9 primeiros valores da linha MACD.
- **Histograma** = linha MACD − linha de sinal.
- **Primeiros valores**: a linha MACD aparece no **26º candle** do histórico carregado; a linha de sinal e o histograma, no **34º**.
- **Parâmetros**: rápida 12, lenta 26, sinal 9. Os três podem ser mudados no editor de indicadores (um preset pronto não muda; você salva uma cópia). O Radar não impede que a "rápida" seja maior que a "lenta"; nesse caso, a linha MACD fica de cabeça para baixo (o que seria positivo vira negativo).
- **Unidade**: a linha MACD está em dinheiro (R$, US$ ou a moeda do ativo), não em porcentagem.
- **Candle em formação**: o último valor é recalculado a cada atualização do preço e só fica definitivo quando o candle fecha.
- Tudo usa os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).
- As linhas MACD e de sinal são conferidas contra uma implementação independente (em Python), com tolerância de 1 parte em 1 bilhão.

### Onde o MACD entra

- **Em nada além do gráfico.** Nenhum setup, alerta, item do [painel de contexto](/biblioteca/painel-contexto) ou teste do laboratório usa o MACD hoje. Ele serve só para você olhar.

### Exemplo hipotético

MME12 em R$ 51,20 e MME26 em R$ 50,50: linha MACD = 0,70. Se a linha de sinal estiver em 0,50, o histograma é 0,70 − 0,50 = 0,20. Barras do histograma acima de zero querem dizer que a linha MACD está acima da linha de sinal.

## Como ler

- **Acima ou abaixo de zero**: diz se a média de 12 está acima ou abaixo da de 26. É parecido com olhar se uma média curta está acima de uma longa no próprio gráfico.
- **Cruzamento da linha MACD com a de sinal**: é o momento em que o histograma troca de lado do zero. Há quem trate esse cruzamento como sinal; o Radar não o usa como sinal de nada.
- **Histograma encolhendo**: a linha MACD está se aproximando da de sinal. Diz que a distância entre as médias parou de crescer, não que o preço vai virar.

## Quando engana

- **Atraso duplo**: a linha de sinal é uma média de uma diferença de médias. Os cruzamentos costumam aparecer depois que boa parte do movimento já aconteceu.
- **Mercado lateral**: as médias ficam coladas, e a linha MACD cruza o zero e a de sinal várias vezes, sem direção.
- **Não dá para comparar ativos**: como o MACD está em dinheiro, um valor de 0,70 numa ação de R$ 10 é muito maior, em proporção, do que numa ação de R$ 100. Até no mesmo ativo, o tamanho muda quando o preço muda muito.
- **Gaps e saltos**: um salto grande de preço move as duas médias de forma diferente e cria um pico no MACD.
- **Dados sem ajuste**: no histórico longo da B3 (COTAHIST, não ajustado por proventos e desdobramentos 🟡), um desdobramento parece um tombo e produz um MACD fortemente negativo que não aconteceu de verdade.
- **Aquecimento**: com pouco histórico carregado, o MACD ainda carrega o efeito da semente; os primeiros valores são menos confiáveis.

## De onde veio

O MACD entra no Radar porque a especificação o lista entre os indicadores **opcionais, desligados por padrão**, junto com IFR, estocástico, VWAP e Bollinger de 2 desvios.

Segundo o vídeo, o youtuber usa médias e price action como base, o ADX para medir força e o ATR para stop e condução, e diz **não usar MACD, IFR, estocástico nem Fibonacci como base**. Nenhum setup do canal descrito na especificação depende do MACD.

A história do indicador e de quem o criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- **Repete o que já está na tela.** O MACD é feito de médias exponenciais. Quem já olha a MME9 e a MME21 vê informação parecida, só que desenhada de outro jeito.
- **Nenhum número sustenta os sinais.** Nem o vídeo nem a especificação trazem teste de cruzamentos de MACD, e o Radar não os testa no laboratório. Qualquer regra de compra baseada nele seria, aqui, palpite.
- **Mais um indicador, mais chances de se enganar.** Com muitos indicadores ligados, quase sempre algum "confirma" o que você já queria fazer. Ligue o MACD só se souber, antes, o que vai fazer com ele.
- **Contradição aparente.** O próprio canal diz não usá-lo como base. Ele está no Radar como opção de estudo, não como recomendação.
