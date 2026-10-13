---
titulo: Volume
categoria: conceito
resumo: O volume é sempre comparado com a média de 21. As faixas acima, muito acima, estrondoso e secando, e o selo que diz se o volume da fonte é completo.
relacionados: rompimento-consolidacao, recuo-a-media, teoria-de-dow, candles, primitivas-price-action
---

## O que é

Volume é quanto foi negociado durante o candle: ações, contratos ou moedas, conforme o mercado. No Radar, ele aparece como barras num painel abaixo do gráfico, com a cor do candle, e uma linha com a média.

Sozinho, o número diz pouco: 1 milhão de ações pode ser muito para uma empresa e pouco para outra. Por isso o vídeo afirma que o volume deve ser lido **sempre em relação à média**.

## Como o Radar usa (regras exatas)

### A média no gráfico

- O painel de volume mostra a **MMA de 21** do volume (linha laranja). Ele fica ligado no preset "Padrão do canal" e também no preset "Limpo".
- A linha no candle de hoje inclui o volume do próprio candle de hoje.
- Se a fonte não informa volume, o painel fica vazio.
- Mudar a "Média do volume" no editor de presets muda **só o desenho**: as regras abaixo continuam usando sempre a média de 21.

### Classificação de um candle

Para classificar o volume de um candle fechado, o Radar compara com a **média dos 21 candles anteriores**, sem contar o próprio candle. Na prática, é o valor da linha laranja no candle de antes.

Esta tabela é a régua da especificação e existe no código, mas nesta versão a classe do candle **não aparece em nenhuma tela**. Os setups usam só duas partes dela: "acima da média" e "1,5 vez a média ou mais". A faixa "estrondoso" ainda não é usada por nenhum setup.

| Classe | Regra |
|---|---|
| abaixo | volume igual ou menor que a média |
| acima da média | volume maior que a média |
| muito acima | volume de 1,5 vez a média ou mais |
| estrondoso | volume de 2 vezes a média ou mais |

Os números 1,5 e 2 são padrões arbitrários da especificação. Dá para mudá-los em [Parâmetros dos setups](/setups/parametros) (grupo "Avançado").

Exemplo hipotético: a média dos 21 candles anteriores é 1.000.000. Um candle com 1.600.000 tem 1,6 vez a média: **muito acima** (passou de 1,5, não chegou a 2).

### Volume secando

Num trecho de candles (por exemplo, um recuo), o volume está **secando** quando as duas condições valem:

1. a média do volume no trecho é menor que a média de 21 de antes do trecho;
2. o volume dentro do trecho vem caindo: a reta que melhor passa pelos volumes do trecho aponta para baixo.

### Onde os setups usam volume

- [Rompimento de consolidação](/biblioteca/rompimento-consolidacao): o volume médio da caixa precisa estar abaixo da média de antes da caixa, e o candle de rompimento precisa ter volume de pelo menos 1,5 vez a média. O Experimento E5 (no Laboratório, em "Verificar o youtuber") compara o setup com e sem essa exigência. Sem dado de volume na fonte, o rompimento é cancelado com essa explicação.
- [Recuo à média](/biblioteca/recuo-a-media): volume secando no recuo conta ponto a favor; candle de queda com volume de 1,5 vez a média ou mais conta como alerta. Quando o candle que arma o setup tem volume acima da média, o motivo aparece anotado como "volume crescente" — nesta versão, isso não soma pontos.
- **Plano de trade do Modo Treino**: a especificação pede um aviso quando o volume não confirmar um rompimento. Esse aviso ainda não existe.
- A tendência do [painel de contexto](/biblioteca/painel-contexto) **não** usa volume.
- A maturidade "cansada" do painel (heurística experimental) usa volume: um dos requisitos é o volume médio dos candles de alta ser menor que o dos candles de baixa nos últimos 20 candles.

### O selo de qualidade do volume

Todo gráfico tem um selo com a fonte dos dados. No computador, o selo já mostra a qualidade do volume ao vivo; no celular, toque no selo para ver a qualidade do volume do histórico e a do volume ao vivo.

| Selo | O que significa |
|---|---|
| Volume completo | a fonte informa o volume do mercado |
| Volume parcial | só uma parte do mercado; o candle ao vivo parece menor do que é |
| Volume só desta exchange | volume de uma única corretora de cripto, não do mercado inteiro |
| Tick volume (corretora) | volume da própria corretora de forex, não do mercado |
| Sem volume | a fonte não informa volume |

Por fonte:

- **Cripto (Binance)**: o volume é só o da Binance, não o do mercado cripto inteiro ✅.
- **Ações dos EUA (Alpaca, plano grátis)**: o histórico vem com volume consolidado ✅; ao vivo, só a bolsa IEX, que é uma fração do volume total, então o candle em formação tem volume **parcial**, subestimado ✅.
- **Ações da B3 (brapi)**: o selo indica volume completo. Essa qualidade foi assumida pelo projeto e ainda não foi conferida na documentação da brapi.
- **Forex** (ainda não disponível no Radar): o volume é o "tick volume" da corretora ✅. A especificação manda desligar ou rotular as regras de volume no forex; isso será feito quando o forex chegar.
- **Dados simulados** (só em desenvolvimento, com a faixa "DADOS SIMULADOS"): o volume também é simulado.

## Quando engana

- **Candle em formação**: até fechar, o volume do candle atual está incompleto e parece baixo. As regras de volume do Radar só olham candles fechados.
- **Volume parcial ao vivo**: em ações dos EUA pelo plano grátis, o candle ao vivo mostra só a parte da IEX ✅. Compare apenas candles fechados.
- **Uma exchange não é o mercado**: na cripto, o volume da Binance mede só a Binance ✅. O que acontece em outras corretoras não aparece.
- **Dias atípicos**: um único dia fora do comum infla a média de 21 pelos 21 candles seguintes, e os candles normais passam a parecer "abaixo".
- **Escalas diferentes**: "muito acima" no 5 minutos e no diário são coisas diferentes. A média é sempre dos 21 candles da mesma escala.
- **Histórias opostas para o mesmo fato**: o vídeo lê volume alto num rompimento como confirmação e volume extremo no fim de uma tendência longa como possível exaustão. Sem regra combinada antes, dá para encaixar qualquer volume em qualquer história.

## Críticas

- O vídeo afirma que o volume confirma a tendência (cresce nas altas, seca nas correções) e que rompimento sem volume é suspeito, mas não mostra números. O Experimento E5 compara o rompimento com e sem a exigência de 1,5 vez a média; o resultado depende dos dados reais e precisa ser lido com a amostra e os custos.
- As faixas 1,5 e 2 são arbitrárias. Faixas diferentes dariam classificações diferentes. Hoje o laboratório não varia esses números (o mapa de sensibilidade da consolidação varia só o alvo em R); o E5 compara apenas com e sem a exigência de 1,5.
- A média de 21 é simples: um dia extremo pesa o mesmo que os outros 20 enquanto estiver na janela.
- O vídeo diz que volume extremo no fim de uma tendência longa indica possível exaustão. O Radar não detecta exaustão nesta versão.
