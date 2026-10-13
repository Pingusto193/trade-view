---
titulo: Contradições entre as fontes
categoria: aviso
resumo: Nove pontos em que os vídeos do canal se contradizem ou exageram, por que isso importa e o que o Radar faz em cada caso.
relacionados: antes-de-arriscar-dinheiro, gestao-de-risco, expectativa, elastico, setup-9-1, reflexividade, bandas-de-bollinger, psicologia
---

## Por que esta página existe

Os setups do Radar vieram dos vídeos do canal "Trade de Valor", que vende um serviço de assinatura. O Radar trata cada regra como uma **hipótese a ser testada**, e não como verdade.

Abaixo estão os nove problemas que a especificação do Radar aponta nesses vídeos. Para cada um: o que dizem as fontes, por que isso importa e o que o Radar faz a respeito.

> Apontar uma contradição não prova que uma regra não funciona. Também não prova que funciona. Só um teste com custos, IR, amostra grande e comparação com o CDI dá alguma resposta — e, mesmo assim, sobre o passado.

## 1. Risco por trade: 1 a 2% ou até 3%?

- **O que dizem**: um vídeo fala em 1 a 2% de risco por trade, com 1% para iniciante. Outro aceita até 3%.
- **Por que importa**: o risco por trade decide o tamanho das quedas. Num exemplo hipotético sem custos, 10 stops seguidos custam 9,6% da conta com 1% de risco e 26,3% com 3%.
- **O que o Radar faz**: usa 1% como padrão e um limite máximo de 2% por padrão, com aviso quando o risco passa do limite. Veja [Gestão de risco](/biblioteca/gestao-de-risco).

## 2. "Quem vai contra a tendência perde sempre", mas existe o elástico

- **O que dizem**: vários vídeos mandam nunca operar contra a tendência maior e apostar na continuidade, não na reversão. Outro vídeo ensina o [elástico](/biblioteca/elastico), que compra depois de uma queda forte esperando a volta à média — ou seja, contra o movimento.
- **Por que importa**: as duas regras não podem valer ao mesmo tempo, no mesmo contexto. Se uma é "a regra", a outra vira exceção sem critério.
- **O que o Radar faz**: o elástico tem um detector separado, e cada sinal dele traz o aviso "Estratégia contra o movimento: conflita com 'nunca opere contra a tendência'". A especificação manda manter as estatísticas do elástico separadas das dos setups de tendência.

## 3. "Day trade é massacre estatístico", mas o elástico é mostrado no mini-índice de 5 minutos

- **O que dizem**: um vídeo chama o day trade de "massacre estatístico". Outro demonstra o elástico no mini-índice, em gráfico de 5 minutos.
- **Por que importa**: no intradiário, o stop é curto, a posição fica grande e os custos pesam muito mais em R (veja a conta em [Expectativa](/biblioteca/expectativa)). O estudo da FGV sobre day traders no mercado futuro brasileiro (✅) aponta no mesmo sentido do "massacre"; veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **O que o Radar faz**: não proíbe o elástico no intradiário, mas cobra custos e derrapagem em todo trade do treino e do backtest. O **Experimento E6** (Laboratório → Experimentos) refaz a conta "40% de acerto com 1:2" para cada ativo e tempo gráfico (5, 15 e 60 minutos contam como day trade; o diário, como swing): transforma o custo de ida e volta em R, usando como stop típico 1 ATR14 (decisão nossa), e aplica o IR simulado só na B3. Ele supõe os 40% de acerto do vídeo em qualquer escala; essa é a premissa do vídeo, não um fato.

## 4. O 9.1 "puro" não deu dinheiro, e o filtro que "muda tudo" veio sem números

- **O que dizem**: segundo o vídeo, o backtest do próprio youtuber com o 9.1 sem filtro "não deu dinheiro". Com o filtro "MMA50 apontando para cima" (MMA50 é a [média móvel](/biblioteca/medias-moveis) aritmética de 50 períodos), o resultado teria "mudado completamente". Os números não foram mostrados.
- **Por que importa**: sem números (quantos trades, que período, que custos), não dá para saber se o filtro melhorou a regra ou só coincidiu com um período bom.
- **O que o Radar faz**: o detector do [9.1](/biblioteca/setup-9-1) tem o filtro como opção, ligado por padrão. O **Experimento E1** roda o 9.1 com e sem o filtro, no diário, em cerca de 10 anos de cada ativo de uma lista sugerida de 20 ações da B3 (editável; composição e liquidez não verificadas 🟡), e diz se a diferença de expectativa entre as duas versões passa do que o acaso explicaria.

## 5. "3 desvios = 1 em 1000"

- **O que dizem**: no vídeo do elástico, a banda de Bollinger de 3 desvios é associada a um evento de "1 em 1000".
- **Por que importa**: essa conta vale para a **curva normal** (a distribuição em forma de sino), em que cerca de 0,13% dos casos ficam além de 3 desvios de cada lado. Segundo a especificação do Radar, retornos de mercado têm **caudas gordas**: movimentos extremos aparecem mais do que a curva normal prevê. Além disso, as bandas são recalculadas a cada candle, sobre os últimos 20 fechamentos.
- **O que o Radar faz**: o **Experimento E2** conta, ativo por ativo, quantas vezes o preço **fecha** fora da banda 20/3 no diário e compara com a curva normal. Como a banda olha só 20 candles, ele compara também com um passeio aleatório de mesma volatilidade medido com a mesma régua (decisão nossa). Veja [Bandas de Bollinger](/biblioteca/bandas-de-bollinger).

## 6. Exemplos escolhidos depois do fato

- **O que dizem**: os vídeos mostram gráficos em que o setup deu certo e citam resultados de assinantes, sem a lista completa de trades.
- **Por que importa**: escolher exemplos depois de saber o final sempre funciona no vídeo. Sem todos os casos — os que deram certo e os que deram errado —, não existe taxa de acerto, [payoff](/biblioteca/payoff) nem [expectativa](/biblioteca/expectativa). Com resultados de assinantes, é igual: quem perdeu pode simplesmente não aparecer.
- **O que o Radar faz**: marca no gráfico **todas** as ocorrências dos setups, não só as bonitas. Toda estatística vem com o tamanho da amostra (menos de 30 trades é inconclusivo; menos de 100, evidência fraca). O laboratório registra todos os testes que você roda, para mostrar quantas variações já foram tentadas.

## 7. "Vai na jugular", contra a regra de 1 a 2%

- **O que dizem**: segundo a especificação, no vídeo de reflexividade a orientação é "ir na jugular" (posição gigante) quando a oportunidade aparece. Os outros vídeos limitam o risco a 1 a 2% por trade.
- **Por que importa**: posição gigante é exatamente o que a regra de 1 a 2% existe para impedir. Um único erro com posição gigante pode custar o equivalente a muitos stops normais.
- **O que o Radar faz**: a especificação pede, na [reflexividade](/biblioteca/reflexividade), entrada em etapas e sempre dentro do limite de risco por trade. Hoje o detector marca só a primeira parte da entrada. No treino e no laboratório, o tamanho da posição sai do risco por trade escolhido (padrão 1%), e a boleta do treino avisa quando o risco passa do seu limite (padrão 2%).

## 8. Conflito de interesse

- **O que dizem**: todos os vídeos vendem um serviço de assinatura.
- **Por que importa**: quem vende um método tem motivo para mostrar o que funcionou e esquecer o que não funcionou. Isso não prova que o método é ruim; mostra que o vídeo não basta como evidência.
- **O que o Radar faz**: escreve cada regra de forma objetiva, marca as lacunas como "decisão nossa, não do vídeo" e tem, no laboratório, a tela "Verificar o youtuber" (experimentos E1 a E7), com a afirmação do vídeo, a hipótese, o método, o resultado e as limitações de cada experimento.

## 9. Histórias de lendas

- **O que dizem**: os vídeos citam Larry Williams, Takashi Kotegawa e George Soros como origem ou inspiração dos setups.
- **Por que importa**: são casos extremos, lembrados justamente porque deram certo. Isso é **viés de sobrevivência**: de quem tentou o mesmo e perdeu, ninguém conta a história. Essas histórias não mostram que o método funciona para a maioria das pessoas.
- **O que o Radar faz**: não usa histórias como prova. A Biblioteca escreve as atribuições como "segundo o vídeo" e mostra, em [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro), um estudo com dados de day traders brasileiros (✅).

## Limites

- Esta lista vem da especificação do Radar, que resume os vídeos. Não é uma análise de todos os vídeos do canal.
- Os experimentos citados aqui (E1, E2 e E6) já rodam no laboratório, mas têm limites que a própria tela mostra: a lista de ativos é escolhida hoje (viés de sobrevivência), o histórico longo da B3 não é ajustado por proventos e desdobramentos (🟡) e os custos são aproximados. Eles falam do passado daqueles ativos, não do futuro.
- As regras do Radar também têm escolhas arbitrárias (os números padrão dos setups). Elas valem a mesma desconfiança e passam pelos mesmos testes.
