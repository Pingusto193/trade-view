---
titulo: Estocástico
categoria: indicador
resumo: De 0 a 100, mostra onde o fechamento ficou dentro da faixa dos últimos 14 candles (lento 14/3/3). Opcional e desligado; o youtuber diz não usá-lo como base.
relacionados: ifr, macd, adx, suporte-e-resistencia, elastico, contradicoes-entre-as-fontes
---

## O que é

O estocástico aparece num painel abaixo do gráfico, com duas linhas que vão de 0 a 100:

- **%K** (azul-claro): onde o fechamento ficou dentro da faixa de preço dos últimos 14 candles, já suavizado;
- **%D** (laranja): uma média do %K, mais lenta.

Perto de 100, o candle fechou perto da **maior máxima** dos últimos 14 candles. Perto de 0, perto da **menor mínima**. O painel tem linhas de referência em 20 e 80.

O estocástico é **opcional** e vem **desligado** no preset "Padrão do canal". O vídeo do canal diz que o youtuber **não usa** estocástico como base das análises.

## Regras exatas no Radar

O Radar usa o **estocástico lento 14/3/3**:

1. **%K bruto** = 100 × (fechamento − menor mínima dos 14 candles) ÷ (maior máxima dos 14 candles − menor mínima dos 14 candles). Os 14 candles **incluem o candle atual**.
2. Se a maior máxima for igual à menor mínima (faixa de tamanho zero), o %K bruto vale **50**.
3. **%K** (o que aparece no gráfico) = média aritmética dos últimos **3** valores do %K bruto.
4. **%D** = média aritmética dos últimos **3** valores do %K.

- **Primeiros valores**: o %K bruto existe a partir do 14º candle do histórico carregado; o %K aparece no **16º**; o %D, no **18º**.
- **Parâmetros**: período 14, suavização do %K 3 e período do %D 3. Os três podem ser mudados no editor de indicadores (um preset pronto não muda; você salva uma cópia).
- **Candle em formação**: o último valor é recalculado a cada atualização do preço e só fica definitivo quando o candle fecha.
- Tudo usa os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).
- As contas são conferidas contra uma implementação independente (em Python), com tolerância de 1 parte em 1 bilhão.

### Onde o estocástico entra

- **Em nada além do gráfico.** Nenhum setup, alerta, item do [painel de contexto](/biblioteca/painel-contexto) ou teste do laboratório usa o estocástico hoje.

### Exemplo hipotético

Nos últimos 14 candles, a maior máxima foi R$ 22,00 e a menor mínima, R$ 18,00. O candle atual fechou em R$ 21,00. %K bruto = 100 × (21,00 − 18,00) ÷ (22,00 − 18,00) = 100 × 3 ÷ 4 = **75**. Se os dois %K brutos anteriores foram 65 e 70, o %K do gráfico é (65 + 70 + 75) ÷ 3 = 70.

## Como ler

- **Perto de 100**: os fechamentos recentes ficaram no alto da faixa dos últimos 14 candles. **Perto de 0**: no baixo.
- **Linhas 20 e 80**: são só referências desenhadas no painel. Os nomes populares "sobrevendido" (abaixo de 20) e "sobrecomprado" (acima de 80) são rótulos, não previsões.
- **%K cruzando o %D**: o %K, mais rápido, passa para o outro lado da média dele. O Radar não usa isso como sinal de nada.

## Quando engana

- **Tendência forte**: numa alta forte, cada candle fecha perto da máxima da faixa, e o estocástico fica colado perto de 100 por muito tempo. Vender "porque está sobrecomprado" é ficar contra o movimento.
- **Comprar o "sobrevendido" é ir contra a tendência.** Isso conflita com a regra do próprio canal de nunca operar contra a tendência maior.
- **Faixa estreita**: quando o preço anda de lado numa faixa pequena, movimentos de poucos centavos podem levar o estocástico de um extremo ao outro. Ele parece muito agitado justamente quando o preço quase não se mexe.
- **Muda rápido**: com só 14 candles de janela, a saída de um candle muito alto ou muito baixo da janela pode mudar o valor de repente, sem nada de novo no preço.
- **Gaps e dados sem ajuste**: um salto grande ou um desdobramento não ajustado no histórico da B3 (COTAHIST 🟡) muda a maior máxima ou a menor mínima da janela por 14 candles seguidos.

## De onde veio

O estocástico entra no Radar porque a especificação o lista entre os indicadores **opcionais, desligados por padrão**. A versão exata (lento 14/3/3; faixa zero vale 50) está no registro de decisões do projeto.

Segundo o vídeo, o youtuber usa médias e price action como base, o ADX para medir força e o ATR para stop e condução, e diz **não usar MACD, IFR, estocástico nem Fibonacci como base**. Nenhum setup do canal descrito na especificação depende do estocástico.

A história do indicador e de quem o criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- **Rótulo não é sinal.** "Sobrecomprado" e "sobrevendido" só descrevem onde o fechamento ficou na faixa recente. Nem o vídeo nem a especificação trazem números que mostrem lucro com as linhas 20 e 80 ou com cruzamentos, e o Radar não testa isso no laboratório.
- **Parecido com o IFR.** Os dois medem, de jeitos diferentes, se o preço andou muito para um lado. Ver os dois "concordando" não são duas provas independentes. Veja [IFR](/biblioteca/ifr).
- **Escolha de parâmetros.** 14/3/3 e as linhas 20 e 80 são convenções. Ajustar até "funcionar" no gráfico de hoje é sobreajuste.
- **Fora da linha do canal.** O próprio youtuber diz não usar o estocástico como base. Ele está no Radar como opção de estudo, não como recomendação.
