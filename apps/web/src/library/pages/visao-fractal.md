---
titulo: Visão fractal (3 escalas)
categoria: conceito
resumo: Contexto, setup e gatilho: três escalas do mesmo ativo lado a lado. Os mapeamentos do Radar e como ele avisa quando a escala maior está contra.
relacionados: painel-contexto, teoria-de-dow, adx, recuo-a-media, suporte-e-resistencia, contradicoes-entre-as-fontes
---

## O que é

É olhar o mesmo ativo em três escalas (tempos gráficos) ao mesmo tempo:

- **Contexto** (a escala maior): a direção do "pano de fundo".
- **Setup** (a do meio): onde você procura a situação de entrada.
- **Gatilho** (a menor): onde você refina o ponto exato de entrada.

O vídeo afirma que:

- quanto menor o tempo gráfico, mais ruído;
- **a escala maior manda** na menor;
- é preciso olhar sempre três escalas;
- a entrada deve ser refinada na escala menor (regra 4 das cinco regras operacionais do canal).

São afirmações do vídeo, não fatos comprovados.

## Como o Radar usa

### Modo 3 escalas

No gráfico, toque em **3 escalas**. Aparecem três gráficos do mesmo ativo, com os rótulos Contexto, Setup e Gatilho e o cursor sincronizado: o mesmo momento fica marcado nos três. No celular, os três viram abas: toque no nome da aba ou deslize o dedo para trocar.

Mapeamentos disponíveis (escolha no seletor ao lado do botão):

| Mapeamento | Contexto | Setup | Gatilho |
|---|---|---|---|
| Operação no diário (padrão) | Semanal | Diário | 60 min |
| Operação no semanal | Mensal | Semanal | Diário |
| Day trade no 15m | 60 min | 15 min | 5 min |

No day trade, a especificação sugere manter também o diário à vista. Para isso, saia do modo 3 escalas e abra o diário.

No modo 3 escalas, os painéis de Contexto e de Setups são calculados na escala do **Setup**.

### Escala maior no painel de contexto

O item **Escala maior** do [painel de contexto](/biblioteca/painel-contexto) compara a tendência da escala do gráfico com a da escala imediatamente maior:

| Escala do gráfico | Escala maior comparada |
|---|---|
| 1 min | 5 min |
| 5 min | 15 min |
| 15 min | 60 min |
| 30 min | 60 min |
| 60 min | Diário |
| Diário | Semanal |
| Semanal | Mensal |
| Mensal | nenhuma |

Nos três mapeamentos do modo 3 escalas, a escala maior do Setup é exatamente a escala de Contexto.

Regras:

- A tendência da escala maior usa a mesma regra do painel: estrutura de topos e fundos + MMA50 subindo (ou caindo) sem estar plana + [ADX](/biblioteca/adx) de 20 ou mais (detalhes em [Teoria de Dow](/biblioteca/teoria-de-dow)).
- Ela é calculada juntando os candles já carregados da escala do gráfico (por exemplo, os diários de uma semana viram um candle semanal).
- Só conta o **último candle da escala maior que já fechou**. A semana em andamento não entra; e uma semana só passa a contar quando fecha o primeiro candle da semana seguinte (no diário, o primeiro pregão da semana nova). É um atraso de propósito, para o Radar nunca usar informação do futuro.
- Se o histórico carregado não tiver candles suficientes da escala maior, o painel mostra "Escala maior sem dados". A MMA50 e a inclinação dela precisam de 55 candles **da escala maior** já fechados: no diário, isso quer dizer 55 semanas de histórico carregado.
- **Escala maior em baixa**: o painel mostra "Vento CONTRA para compras" e um **aviso vermelho**, qualquer que seja a tendência da escala do gráfico.
- **Escala maior em alta e a do gráfico em baixa**: "Vento CONTRA para vendas", também com aviso vermelho.
- **A favor**: as duas escalas na mesma direção.
- **Neutro**: a escala maior está lateral, ou a do gráfico está lateral ou indefinida (com a maior fora de baixa).

### Nos setups

- Só o [recuo à média](/biblioteca/recuo-a-media) é **bloqueado** pela escala maior: ele não abre radar com a escala maior em baixa e é invalidado se ela mudar para baixa antes da entrada.
- Nos outros setups, a escala maior não bloqueia nada, mas cada evento (radar, armado ou acionado) de uma compra com a escala maior em baixa, ou de uma venda com ela em alta, vem marcado com o aviso vermelho, inclusive no texto do alerta.
- No Modo Treino (que só compra), o plano de trade mostra "Compra contra a escala maior (aviso vermelho)" quando a escala maior está em baixa — ou seja, quando o painel mostra "Vento CONTRA para compras". O aviso não bloqueia a ordem.

### Exemplo hipotético (operação no diário)

O semanal está em alta: topos e fundos subindo, MMA50 subindo, ADX 27. No diário, o preço recua até a MME21 — situação de recuo à média, com vento a favor. A ideia do vídeo é usar o 60 minutos para achar um ponto de entrada mais preciso. Se o semanal estivesse em baixa, o mesmo recuo no diário viria com aviso vermelho. Os detectores do Radar trabalham em uma escala só; o refinamento no gatilho é decisão sua.

## Quando engana

- **Escala maior atrasada**: a tendência do semanal só muda depois que semanas inteiras fecham. Nas viradas, o "vento" continua apontando para o lado antigo por um tempo.
- **Semana em andamento ignorada**: uma queda forte nesta semana não muda o vento até a semana fechar. É o preço de não olhar o futuro.
- **Escalas em conflito**: o diário pode estar em alta com o semanal em baixa. O aviso vermelho não diz quem vai vencer; diz que você estaria remando contra a escala maior.
- **Pouco histórico**: com poucos candles carregados, a escala maior fica "sem dados" e o aviso não aparece. Isso **não** quer dizer "a favor".
- **Combinações fixas**: quais escalas formam o trio é uma convenção do canal e da especificação, não uma lei do mercado.

## Críticas

- "A escala maior manda" é a regra mestra do vídeo, mas ele não mostra números. Hoje o laboratório não tem como ligar e desligar esse filtro, então a regra continua sem teste no Radar.
- O próprio canal ensina o [elástico](/biblioteca/elastico), que opera contra o movimento — veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes).
- Três gráficos dão três chances de achar a confirmação que você já queria ver. Decida antes qual escala decide o quê, e anote no plano.
- O vídeo diz que escalas menores têm mais ruído e chama o day trade de "massacre estatístico". Um estudo da FGV (Chague, De-Losso e Giovannetti, 2019) com day traders no mercado futuro de ações brasileiro encontrou que, dos que começaram entre 2013 e 2015 e persistiram por pelo menos 300 dias, 97% perderam dinheiro ✅. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
