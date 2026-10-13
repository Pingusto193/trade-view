---
titulo: Primitivas de price action
categoria: conceito
resumo: As regras fixas com que o Radar reconhece topos, fundos, candles de força, martelos, volume e rompimentos, sem olhar o futuro.
relacionados: candles, suporte-e-resistencia, teoria-de-dow, volume, medias-moveis, painel-contexto, setup-9-1, recuo-a-media, rompimento-consolidacao, elastico, reflexividade
---

## O que é

**Price action** é ler o gráfico pelo próprio preço: topos, fundos, tamanho e forma dos candles, volume e rompimentos. Nos vídeos, isso é feito "no olho". O problema do olho é que duas pessoas veem coisas diferentes no mesmo gráfico, e é fácil enxergar o padrão depois que o preço já andou.

Por isso o Radar transforma cada ideia numa **primitiva**: uma regra com números, que dá sempre a mesma resposta para os mesmos candles. Os setups são montados com essas peças. Assim dá para contar quantas vezes cada coisa aconteceu e o que veio depois, em vez de lembrar só dos casos bonitos.

Três regras valem para todas:

- **Só candle fechado.** Uma primitiva só é avaliada depois que o candle fecha. O candle em formação nunca gera sinal.
- **Nada do futuro.** Cada regra olha apenas para o candle atual e os anteriores. Testes automáticos conferem que nenhum setup lê candles futuros e que mudar candles futuros não muda sinais passados.
- **Candles reais.** Mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi), as primitivas usam os preços reais.

## Regras exatas no Radar

As regras abaixo são as do código hoje. Os números são os **valores padrão**; quase todos são parâmetros guardados nas suas preferências (a tela para editá-los ainda não existe, e o laboratório usa sempre os padrões). A tabela no fim desta seção diz de onde vem cada número.

Termos usados: **amplitude** = máxima − mínima do candle. **Corpo** = distância entre abertura e fechamento, sem sinal. **Sombra** (ou pavio) = a parte do candle fora do corpo, acima ou abaixo.

### Topos e fundos (pivôs)

- **Topo**: um candle cuja máxima é maior que a máxima dos **2 candles de cada lado**. **Fundo**: o espelho, com a mínima menor que as dos 2 candles de cada lado. Esse jeito de achar topos e fundos se chama **fractal**.
- **Confirmação**: o topo de um candle só passa a existir para o Radar quando o **2º candle depois dele fecha**. Antes disso, ninguém sabe se ele seria superado. O Radar registra os dois momentos: o candle do topo e o candle em que ele se confirmou. Os setups só podem usar o topo a partir da confirmação.
- **Empate**: à **esquerda**, um vizinho com máxima igual já desqualifica o candle; à **direita**, um vizinho igual não desqualifica. Resultado: num topo duplo de preço idêntico, dentro da vizinhança, vale o **primeiro** candle (o nível foi formado ali), e os seguintes não viram topo. Para fundos, o mesmo com as mínimas. É uma decisão nossa, não do vídeo.
- Um mesmo candle muito amplo pode ser topo e fundo ao mesmo tempo.
- Os 2 primeiros candles do histórico carregado nunca são topo nem fundo, porque não têm vizinhos suficientes à esquerda.

Exemplo hipotético: as máximas de cinco candles seguidos são R$ 10,00, R$ 11,00, R$ 13,00, R$ 12,00 e R$ 12,50. O 3º candle é um topo, confirmado só quando o 5º fecha. Se o 5º tivesse máxima de R$ 13,50, o 3º não seria topo.

Exemplo de empate: máximas R$ 10,00, R$ 11,00, R$ 13,00, R$ 13,00, R$ 12,00, R$ 11,00. O topo é o 3º candle (o primeiro R$ 13,00), confirmado quando o 5º fecha. O 4º não é topo, porque tem um vizinho igual à esquerda.

### Pivô de alta (e de baixa)

- O Radar pega os **dois últimos fundos confirmados**: F1 (o anterior) e F2 (o mais recente). F2 precisa ser **mais alto** que F1.
- O **topo intermediário** é a maior máxima dos candles entre F1 e F2 (sem contar os dois). Ele não precisa ser um topo confirmado.
- O pivô de alta acontece no primeiro candle que **fecha acima** desse topo intermediário, a partir da confirmação de F2 e enquanto F1 e F2 forem os dois últimos fundos. Fechar exatamente no topo não conta.
- Cada F2 gera no máximo um pivô de alta.
- Hoje só a [reflexividade](/biblioteca/reflexividade) procura o pivô de alta, e só enquanto ela está no estado "radar" (por padrão, só no gráfico semanal). Fora disso, o Radar não marca pivôs de alta.
- O **pivô de baixa** é o espelho, com os dois últimos topos. Ele existe no código, mas nenhum setup o usa hoje.

Exemplo hipotético: F1 em R$ 18,00, topo intermediário em R$ 21,00 e F2 em R$ 19,00. Um fechamento em R$ 21,01 é pivô de alta; um fechamento em R$ 21,00, não.

### Tendência por estrutura

- **Alta**: o último topo confirmado é mais alto que o penúltimo **e** o último fundo confirmado é mais alto que o penúltimo.
- **Baixa**: os dois mais baixos.
- **Indefinida**: qualquer outro caso, inclusive preços iguais ou menos de dois topos e dois fundos confirmados.
- O Radar compara os dois últimos topos e os dois últimos fundos, sem exigir que eles se alternem no gráfico.

A tendência que aparece no [painel de contexto](/biblioteca/painel-contexto) usa esta estrutura **mais** a MMA50 e o ADX. Veja também [Teoria de Dow](/biblioteca/teoria-de-dow).

### Inclinação da média e "virar"

- **Inclinação** = (média agora − média 5 candles atrás) ÷ ATR14 agora. ATR14 é a amplitude média dos últimos 14 candles (veja [ATR](/biblioteca/atr-e-stop-atr)).
- **Plana**: inclinação entre −0,15 e +0,15, sem incluir as pontas. **Acentuada**: de 1,0 para cima (ou de −1,0 para baixo). Entre uma coisa e outra, **suave**.
- **Virou para cima** neste candle: média deste candle maior que a do anterior, e a do anterior menor ou igual à do candle antes dele. **Para baixo**: o espelho. "Virando" tem prioridade sobre os outros rótulos.

Detalhes e exemplos em [Médias móveis](/biblioteca/medias-moveis).

### Inside bar

- A máxima é **menor** que a máxima do candle anterior **e** a mínima é **maior** que a mínima do anterior. Igual não conta: as duas comparações são estritas.

### Candle de força

- **De alta**: candle de alta (fechamento acima da abertura), corpo **maior ou igual a 1,5 vez** a média dos corpos dos **20 candles anteriores** (o próprio candle não entra na média) e fechamento no **quarto superior** da amplitude (fechamento maior ou igual a máxima − amplitude ÷ 4).
- **De baixa**: o espelho, com candle de baixa e fechamento no quarto inferior.
- Candle com amplitude zero nunca é candle de força. Sem 20 candles anteriores, não há média e não há candle de força.

Exemplo hipotético: média dos 20 corpos anteriores = R$ 0,40. Um candle abre em R$ 20,00, vai a R$ 20,80, cai a R$ 19,95 e fecha em R$ 20,70. Corpo R$ 0,70, maior que 1,5 × 0,40 = R$ 0,60. Amplitude R$ 0,85; o quarto superior começa em 20,80 − 0,2125 = R$ 20,5875, e o fechamento está acima. É candle de força.

### Barra de ignição

- Candle de alta com corpo **maior ou igual a 2 vezes** a média dos corpos dos 20 anteriores e sombra superior (máxima − fechamento) de **no máximo 10%** da amplitude.
- No exemplo do candle de força acima, o corpo de R$ 0,70 não chega a 2 × 0,40 = R$ 0,80: não é barra de ignição.
- Hoje só existe a versão de alta.

### Martelo (e estrela cadente)

- **Martelo**: sombra inferior **maior ou igual a 2 vezes o corpo**, sombra superior de **no máximo 25%** da amplitude e o corpo inteiro no **terço superior** do candle (a parte de baixo do corpo fica na mínima + 2/3 da amplitude ou acima).
- Vale para corpo de qualquer cor. Se o corpo for zero, ele é tratado como um corpo ínfimo, então a regra da sombra inferior passa facilmente. Amplitude zero nunca é martelo.
- **Estrela cadente** (martelo invertido): o espelho, com a sombra longa em cima e o corpo no terço inferior. É usada nas vendas.

Exemplo hipotético: abre em R$ 10,40, máxima R$ 10,50, mínima R$ 9,80, fecha em R$ 10,45. Amplitude R$ 0,70; corpo R$ 0,05; sombra inferior R$ 0,60 (maior que 2 × 0,05); sombra superior R$ 0,05 (menor que 25% de 0,70 = R$ 0,175); a base do corpo, R$ 10,40, está acima de 9,80 + 2/3 × 0,70 (cerca de R$ 10,27). É martelo.

### Doji

- Corpo de **no máximo 10%** da amplitude, com amplitude maior que zero. Um candle com os quatro preços iguais não é doji.

### Volume relativo

O volume é sempre comparado com a **média do volume dos 21 candles anteriores** (o candle atual não entra).

| Rótulo | Regra |
|---|---|
| abaixo | volume menor ou igual à média |
| acima | volume maior que a média |
| muito acima | volume de 1,5 vez a média ou mais |
| estrondoso | volume de 2 vezes a média ou mais |

- Sem volume (média zero ou ausente), não há rótulo nenhum.
- **Volume secando** num trecho de pelo menos 2 candles: a média do volume no trecho é **menor** que a média de 21 candles que termina logo antes do trecho, **e** a linha reta que melhor acompanha os volumes do trecho (regressão linear simples) aponta **para baixo**.

Exemplo hipotético: média dos 21 anteriores = 1.000.000 ações. Volume de 1.000.000 é "abaixo" (igual não é acima); 1.400.000 é "acima"; 1.500.000 é "muito acima"; 2.000.000 é "estrondoso".

Veja [Volume](/biblioteca/volume) para os cuidados com a qualidade do volume de cada fonte.

### Rompimento válido e falso rompimento

- **Rompimento para cima**: o candle **fecha acima** do nível. Fechar exatamente no nível não é rompimento: conta como dentro. Pavio não conta, a menos que você troque a configuração para "rompimento por pavio" (aí basta a máxima passar do nível).
- **Rompimento para baixo**: o espelho, com fechamento abaixo do nível.
- **Falso rompimento** (para cima): depois do candle que rompeu, se **um dos 2 candles seguintes** fechar no nível ou abaixo dele, o rompimento foi falso. Hoje só a versão para cima é usada.

Exemplo hipotético: resistência em R$ 50,00. Um fechamento em R$ 50,01 rompe; um fechamento em R$ 50,00, não. Se o candle do rompimento fechou em R$ 50,40 e o seguinte fechou em R$ 49,90, foi falso rompimento.

### De onde vem cada número

| Número | Padrão | Origem |
|---|---|---|
| Candles de cada lado do topo ou fundo | 2 | arbitrário da especificação |
| Passo da inclinação | 5 candles | arbitrário da especificação |
| Limite de "plana" | 0,15 | arbitrário da especificação |
| Limite de "acentuada" | 1,0 | decisão nossa |
| Corpo do candle de força | 1,5 × média | arbitrário da especificação |
| Corpo da barra de ignição | 2 × média | arbitrário da especificação |
| Sombra máxima da ignição | 10% da amplitude | arbitrário da especificação |
| Sombra inferior do martelo | 2 × corpo | arbitrário da especificação |
| Sombra superior máxima do martelo | 25% da amplitude | arbitrário da especificação |
| Corpo máximo do doji | 10% da amplitude | arbitrário da especificação |
| Volume "muito acima" | 1,5 × média | arbitrário da especificação |
| Volume "estrondoso" | 2 × média | arbitrário da especificação |
| Candles para falso rompimento | 2 | arbitrário da especificação |
| Rompimento por fechamento | ligado | especificação (configurável) |

"Arbitrário" quer dizer que a especificação escolheu um ponto de partida que precisa ser calibrado no laboratório, sem sobreajuste. Não são parâmetros hoje: os 20 candles da média dos corpos, os 21 da média do volume, os 14 do ATR, o quarto superior do candle de força e o terço superior do martelo.

## Onde o Radar usa cada uma

| Primitiva | Uso hoje |
|---|---|
| Topos e fundos | estrutura, média respeitada, stop "fundo anterior" do 9.1, topo e fundo do recuo, fundos da reflexividade |
| Pivô de alta | confirmação da [reflexividade](/biblioteca/reflexividade) |
| Tendência por estrutura | painel de contexto, escala maior, condição do [recuo à média](/biblioteca/recuo-a-media) |
| Inclinação e virar | sinal e filtros do [9.1](/biblioteca/setup-9-1), saída dinâmica dos 9.x, painel de contexto |
| Inside bar | pontua no recuo à média |
| Candle de força | pontua no recuo (de baixa no recuo vira alerta); confirmação opcional do [elástico](/biblioteca/elastico) |
| Martelo e estrela cadente | pontua no recuo; confirmação opcional do elástico |
| Volume secando | pontua no recuo à média |
| Volume relativo à média de 21 | alerta de queda com volume no recuo (1,5 vez a média); filtro de volume do rompimento de consolidação |
| Rompimento e falso rompimento | [rompimento de consolidação](/biblioteca/rompimento-consolidacao); rompimento de resistência na maturidade do painel |
| Barra de ignição, doji, rótulos de volume | prontos e testados, mas nenhum setup usa ainda |

## Quando engana

- **Atraso dos topos e fundos**: o fundo só aparece 2 candles depois. Tudo que depende dele (estrutura, stop no fundo anterior) chega atrasado. É o preço de não olhar o futuro.
- **Fronteiras duras**: um corpo de 1,49 vez a média não é candle de força; um de 1,5 vez é. Diferenças pequenas mudam a resposta.
- **A régua muda com o mercado**: depois de dias muito agitados, a média dos corpos e do volume fica alta, e quase nada parece "força" ou "muito acima". Depois de dias parados, acontece o contrário.
- **Volume de má qualidade**: no forex, o volume é só o da corretora ✅. Nas ações dos EUA pelo plano gratuito, o volume ao vivo é só de uma parte do mercado (IEX) e fica subestimado ✅. As regras de volume ficam menos confiáveis nesses casos.
- **Dados sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Um desdobramento parece um tombo e cria topos, fundos e "rompimentos" que não aconteceram de verdade.
- **Contexto ignorado**: as primitivas olham a forma, não o lugar. Um martelo no meio do nada conta igual a um martelo num suporte. Os setups e o painel de contexto é que juntam forma e lugar.

## De onde veio

As ideias vêm dos vídeos do canal resumidos na especificação do Radar: topos e fundos, candles de força, martelo, volume confirmando a tendência e o rompimento, e "rompimento sem volume é suspeito". O vídeo diz que padrão de candle só vale em região relevante (suporte, resistência, média).

Os números e as regras exatas foram escritos na especificação do Radar para que o computador consiga conferir tudo sempre do mesmo jeito. Onde a especificação não definia algo (empates, o que conta como "dentro", a média que exclui o candle atual), a escolha é nossa e está listada abaixo.

## Decisões nossas

- **Empate nos topos e fundos**: estrito à esquerda, não estrito à direita; vale o primeiro dos empatados.
- **Médias que excluem o candle atual**: o corpo médio (20 anteriores) e o volume médio (21 anteriores) não incluem o candle que está sendo avaliado. Assim, um candle enorme não "puxa" a própria régua.
- **Fechar no nível = dentro**: no rompimento e no falso rompimento, o empate fica sempre do lado de dentro.
- **Topo intermediário do pivô de alta**: a maior máxima entre F1 e F2, mesmo que não seja um topo confirmado.
- **Estrutura sem alternância**: compara os dois últimos topos e os dois últimos fundos, mesmo que não se alternem.
- **Martelo de corpo zero** conta como martelo se as sombras baterem; **doji** exige amplitude maior que zero.
- **"Acentuada" a partir de 1,0** na inclinação.

## Críticas

- **Regra fixa não é leitura de mercado.** As primitivas tornam o gráfico contável, mas números como 1,5 vez ou 25% são convenções. Ninguém mostrou que esses valores são os melhores. Hoje o laboratório não varia esses números: o mapa de sensibilidade mexe só no número principal de cada setup (por exemplo, o alvo em R).
- **"No olho" sempre parece funcionar.** Num gráfico pronto, é fácil achar o martelo que antecedeu a alta e esquecer os que não antecederam nada. Contar todos é o motivo de as primitivas existirem.
- **Padrão sozinho não é sinal.** Nenhuma primitiva, isolada, promete o próximo movimento. Elas são peças: o que importa é o resultado do setup inteiro, depois de custos, imposto e comparação com o CDI.
