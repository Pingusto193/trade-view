---
titulo: ADX, +DI e −DI
categoria: indicador
resumo: Mede a força da tendência, não a direção. A conta exata com a suavização de Wilder e as faixas 20, 25 e 40 que o Radar usa.
relacionados: painel-contexto, setup-9-1, teoria-de-dow, medias-moveis, atr-e-stop-atr, visao-fractal
---

## O que é

São três linhas num painel abaixo do gráfico:

- **+DI** (verde): quanto da movimentação recente foi para cima.
- **−DI** (vermelha): quanto foi para baixo.
- **ADX** (branca): o quanto uma das duas domina a outra. É a **força** da tendência, seja de alta ou de baixa.

ADX alto não quer dizer "vai subir". Quer dizer que o preço tem andado com direção definida. Quem mostra a direção é a comparação entre +DI e −DI.

## Regras exatas no Radar

Período 14 (preset "Padrão do canal"). A partir do segundo candle do histórico, para cada candle:

1. **Movimento para cima** = máxima do candle − máxima do candle anterior. **Movimento para baixo** = mínima do candle anterior − mínima do candle.
2. **+DM** = o movimento para cima, se for positivo e maior que o movimento para baixo; senão, zero. **−DM** = o espelho.
3. **TR (true range)** = o maior entre: máxima − mínima; distância da máxima ao fechamento anterior; distância da mínima ao fechamento anterior.
4. +DM, −DM e TR são suavizados pela **média de Wilder** de 14: alfa = 1 ÷ 14, com semente igual à média simples dos 14 primeiros valores.
5. **+DI** = 100 × +DM suavizado ÷ TR suavizado. **−DI** = 100 × −DM suavizado ÷ TR suavizado. Se o TR suavizado for zero, os dois valem 0.
6. **DX** = 100 × (diferença entre +DI e −DI, sem sinal) ÷ (+DI + −DI). Se a soma for zero, DX = 0.
7. **ADX** = média de Wilder de 14 do DX.

- +DI e −DI aparecem a partir do 15º candle. O ADX, a partir do 28º, porque são duas suavizações seguidas.
- Nos primeiros ~100 candles, o valor pode diferir levemente do TradingView, que trata esse aquecimento de outro jeito.
- As contas são conferidas contra uma implementação independente (em Python), com tolerância de 1 parte em 1 bilhão.
- Tudo usa os candles reais, mesmo com o gráfico em [Heikin-Ashi](/biblioteca/heikin-ashi).

### Faixas usadas pelo Radar

| ADX | Leitura no painel de contexto |
|---|---|
| abaixo de 20 | lateral: não operar setups de tendência |
| de 20 a 25 (inclusive) | zona cinzenta |
| acima de 25 até 40 (inclusive) | tendência |
| acima de 40 | tendência muito forte |

As linhas de referência em 20, 25 e 40 aparecem no painel do ADX. As faixas vêm da especificação e são fixas nesta versão.

No editor de presets dá para mudar o período do ADX do gráfico, mas isso muda **só o desenho**: o painel de contexto, a escala maior e o 9.1 continuam usando sempre o ADX de 14.

### Onde o ADX entra

- **Tendência do painel de contexto**: só é "alta" ou "baixa" com ADX de 20 ou mais, junto com a estrutura de topos e fundos e a MMA50 subindo (ou caindo) sem estar plana. Com ADX abaixo de 20, o painel diz "lateral". Veja [Painel de contexto](/biblioteca/painel-contexto).
- **Setup 9.1**: com o filtro "não operar em mercado lateral" ligado (o padrão), não arma se o ADX do candle-sinal estiver abaixo de 20 ou se a MMA50 estiver plana. Esse filtro é separado do filtro "MMA50 subindo". O 20 é um número arbitrário da especificação; no código ele é um parâmetro, mas ainda não há tela para mudá-lo.
- **Escala maior**: a tendência da escala maior, usada na [visão fractal](/biblioteca/visao-fractal), segue a mesma regra.
- **Plano de trade do Modo Treino**: mostra o aviso "ADX abaixo de 20: mercado lateral" quando o painel de contexto está nessa faixa. O aviso não bloqueia a ordem.
- **Alertas**: você pode pedir um aviso quando o ADX, no fechamento do candle, passar para cima (ou cair para baixo) de um nível escolhido por você. Atenção: o campo "Período" do formulário de alerta começa em 9; para usar o mesmo ADX do gráfico, troque para 14.
- O Radar **não** usa o cruzamento de +DI com −DI como sinal de compra ou venda.

## Como ler

- ADX acima de 25 com +DI acima de −DI: o preço andou com direção definida e, pela própria conta, mais para cima do que para baixo. Com −DI acima: mais para baixo.
- ADX abaixo de 20: preço sem direção clara. A especificação do Radar chama essa faixa de "lateral: não operar setups de tendência". A ideia por trás — setups de tendência falham mais sem direção — é hipótese, não fato medido.
- ADX caindo depois de um pico: a força diminuiu. Isso não quer dizer que a tendência virou.

Exemplo hipotético: ADX 32 com +DI 28 e −DI 12 — o ADX está na faixa "tendência" e os DIs mostram força para cima. ADX 32 com +DI 10 e −DI 30 — mesma faixa, força para baixo. O mesmo ADX, direções opostas. Lembre: a tendência "alta" ou "baixa" do painel de contexto não olha os DIs; ela vem da estrutura de topos e fundos, da MMA50 e do ADX.

## Quando engana

- **Atraso**: são médias em cima de médias. O ADX costuma confirmar a tendência depois que ela já andou bastante, e continua alto por um tempo depois que ela acaba.
- **Reversões rápidas**: uma queda forte seguida de alta forte pode manter o ADX alto o tempo todo, porque ele mede força, não direção.
- **Mesmas faixas para tudo**: 20, 25 e 40 valem igual para cripto, ações e índices, em qualquer escala. Um ativo pode viver com ADX alto e outro quase nunca passar de 25.
- **Gaps**: o TR inclui a distância até o fechamento anterior. Um gap grande infla o TR e mexe nos dois DIs.
- **Fronteiras**: ADX de 19,9 e de 20,1 são praticamente iguais, mas caem em faixas diferentes. Um filtro "liga/desliga" muda a decisão por diferenças pequenas.
- **Aquecimento**: com pouco histórico carregado, o ADX não aparece ou ainda está se ajustando.

## De onde veio

O vídeo usa o ADX para medir a força da tendência e coloca "ADX acima de 25" entre as condições do contexto ideal (regra 3 das cinco regras operacionais do canal). As faixas 20, 25 e 40 estão na especificação do Radar. A suavização usada se chama "média de Wilder" no Radar. A história do indicador e de quem o criou não está descrita aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- As faixas são convenções, não leis. O vídeo não mostra estatística de que "ADX acima de 25" melhora os setups. Hoje o laboratório não varia o limite do ADX (o mapa de sensibilidade do 9.1 varia só o alvo em R), então essa afirmação continua sem teste no Radar.
- O ADX não diz para onde o preço vai. Usar "ADX alto" sozinho como motivo de compra é um erro de leitura.
- Por ser lento, o filtro de ADX tende a deixar de fora o começo das tendências. É uma troca: menos sinais em mercado lateral, mas entradas mais tardias. Só o teste com custos mostra se a troca compensa.
