---
titulo: IFR (índice de força relativa)
categoria: indicador
resumo: De 0 a 100, compara a média das altas com a das quedas dos últimos 14 candles. Opcional e desligado; o youtuber diz não usá-lo como base.
relacionados: estocastico, macd, adx, medias-moveis, elastico, contradicoes-entre-as-fontes
---

## O que é

O IFR (em inglês, RSI) aparece num painel abaixo do gráfico, como uma linha roxa que vai de 0 a 100. Ele compara o tamanho médio das **altas** com o tamanho médio das **quedas** dos fechamentos recentes:

- perto de 100: as altas recentes foram muito maiores que as quedas;
- perto de 0: as quedas dominaram;
- 50: altas e quedas do mesmo tamanho, em média.

O painel tem linhas de referência em 30, 50 e 70. O IFR é **opcional** e vem **desligado** no preset "Padrão do canal". O vídeo do canal diz que o youtuber **não usa** IFR como base das análises.

## Regras exatas no Radar

Período 14, para cada candle a partir do segundo:

1. **Variação** = fechamento deste candle − fechamento do anterior.
2. **Ganho** = a variação, se for positiva; senão, zero. **Perda** = a variação sem o sinal de menos, se for negativa; senão, zero.
3. Ganho e perda são suavizados pela **média de Wilder** de 14: alfa = 1 ÷ 14, com semente igual à média simples das 14 primeiras variações. É a mesma suavização usada no [ADX](/biblioteca/adx).
4. **IFR** = 100 − 100 ÷ (1 + ganho médio ÷ perda média).
5. **Casos especiais**: se a perda média for zero, o IFR vale 100; se o ganho médio também for zero (preço parado), vale 50.

- **Primeiro valor**: no **15º candle** do histórico carregado (14 variações precisam do candle anterior).
- **Parâmetro**: o período (14) pode ser mudado no editor de indicadores (um preset pronto não muda; você salva uma cópia).
- **Candle em formação**: o último valor é recalculado a cada atualização do preço e só fica definitivo quando o candle fecha.
- Tudo usa os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).
- As contas são conferidas contra uma implementação independente (em Python), com tolerância de 1 parte em 1 bilhão.

### Onde o IFR entra

- **Em nada além do gráfico.** Nenhum setup, alerta, item do [painel de contexto](/biblioteca/painel-contexto) ou teste do laboratório usa o IFR hoje.

### Exemplo hipotético

Ganho médio de R$ 0,60 e perda média de R$ 0,40. A razão é 0,60 ÷ 0,40 = 1,5. IFR = 100 − 100 ÷ (1 + 1,5) = 100 − 40 = **60**.

## Como ler

- **Acima de 50**: as altas recentes, em média, foram maiores que as quedas. **Abaixo de 50**: o contrário.
- **Linhas 30 e 70**: são só referências desenhadas no painel. Os nomes populares "sobrecomprado" (acima de 70) e "sobrevendido" (abaixo de 30) são rótulos, não previsões: dizem que o preço andou muito para um lado, não que vai voltar.
- O IFR mede **fechamento contra fechamento**. Pavios e máximas e mínimas não entram.

## Quando engana

- **Tendência forte**: numa alta forte, o IFR pode ficar acima de 70 por muito tempo, enquanto o preço continua subindo. Vender "porque está sobrecomprado" é ficar contra o movimento.
- **Comprar o "sobrevendido" é ir contra a tendência.** Isso conflita com a regra do próprio canal de nunca operar contra a tendência maior. É a mesma lógica de reversão do [elástico](/biblioteca/elastico), com os mesmos riscos.
- **Período e escala**: o 14 vale 14 candles da escala do gráfico. No 5 minutos, isso é pouco mais de uma hora; no semanal, mais de três meses. O mesmo número conta histórias diferentes.
- **Gaps**: um único salto grande entre fechamentos domina as médias por vários candles.
- **Dados sem ajuste**: no histórico longo da B3 (COTAHIST, não ajustado por proventos e desdobramentos 🟡), um desdobramento aparece como uma queda enorme e derruba o IFR sem que nada tenha acontecido de verdade.
- **Aquecimento**: a semente da média de Wilder pesa nos primeiros valores. Com pouco histórico carregado, o IFR pode diferir do de outras plataformas que carregaram mais candles.

## De onde veio

O IFR entra no Radar porque a especificação o lista entre os indicadores **opcionais, desligados por padrão**. A regra exata (suavização de Wilder; perda média zero vale 100, ou 50 se o ganho também for zero) está no registro de decisões do projeto.

Segundo o vídeo, o youtuber usa médias e price action como base, o ADX para medir força e o ATR para stop e condução, e diz **não usar MACD, IFR, estocástico nem Fibonacci como base**. Nenhum setup do canal descrito na especificação depende do IFR.

A história do indicador e de quem o criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- **Rótulo não é sinal.** "Sobrecomprado" soa como "vai cair", mas o IFR só resume o passado recente. Nem o vídeo nem a especificação trazem números que mostrem lucro com as linhas 30 e 70, e o Radar não testa isso no laboratório.
- **Escolha de parâmetros.** Período 14 e linhas 30 e 70 são convenções. Trocar até achar a combinação que "funcionou" no gráfico de hoje é sobreajuste.
- **Mais um indicador, mais chances de se enganar.** Com muitos indicadores ligados, quase sempre algum "confirma" o que você já queria fazer.
- **Fora da linha do canal.** O próprio youtuber diz não usar o IFR como base. Ele está no Radar como opção de estudo, não como recomendação.
