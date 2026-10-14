---
titulo: Reflexividade
categoria: setup
resumo: Ações que caíram 50% ou mais, no gráfico semanal. Proibido comprar durante a queda: o Radar só arma depois do pivô de alta. Regras exatas, lacunas e críticas.
relacionados: primitivas-price-action, medias-moveis, gestao-de-risco, visao-fractal, drawdown, r-multiplo, contradicoes-entre-as-fontes, antes-de-arriscar-dinheiro
---

## O que é

A ideia, segundo o vídeo: às vezes o preço de uma empresa cai muito mais do que o valor do negócio justificaria. Seria uma **distorção entre preço e valor**. A aposta é que, se a distorção existir, o preço volte a subir depois que a queda terminar. Nada garante isso. A especificação do Radar diz que o setup é inspirado em George Soros. A teoria original não está descrita aqui, porque não foi conferida em fonte registrada no projeto.

**Setup** é uma receita com regras fixas de quando entrar e quando sair de uma operação. Na reflexividade do Radar:

- o **radar** aparece quando a ação caiu 50% ou mais desde o topo, com as médias semanais descendo e, quando os dados existem, com fundamentos fortes;
- **é proibido comprar durante a queda**. É a "faca caindo": tentar pegar no ar algo que ainda está despencando;
- a compra só pode acontecer depois que o gráfico **semanal** mostra um pivô de alta e as médias voltam a subir.

> **Aviso permanente**: os exemplos do vídeo (Netflix, Meta, AppLovin, Palantir) foram escolhidos depois do fato. Empresas que caíram e nunca se recuperaram, ou saíram da bolsa, não aparecem: é o **viés de sobrevivência**. O Radar mostra esse aviso em todas as fases do setup.

O Radar **não envia ordens**. "Comprar" e "entrar" aqui querem dizer que o Radar marca no gráfico, avisa (se você criou um alerta) e simula a operação no laboratório.

## Regras exatas no Radar

Estas são as regras como estão no código hoje. Tudo é conferido com o candle **fechado**; o candle em formação nunca gera sinal.

Os números são os **valores padrão**. Cada um é um parâmetro do setup, guardado nas suas preferências, mas a tela para editar os parâmetros dos setups ainda não existe. Cada evento do painel de Setups mostra, em "Parâmetros usados", com quais valores foi calculado. O teste do laboratório usa sempre os valores padrão. Os números que a especificação marca como arbitrários precisam ser calibrados sem sobreajuste; hoje o mapa de sensibilidade do laboratório varia só a queda mínima.

**Tick** é o menor passo de preço do ativo. "1 tick acima" é o preço mais esse passo, arredondado para a grade de ticks.

### 1. Só no gráfico semanal

- Com `weeklyOnly` ligado (o padrão), o setup só roda no gráfico **semanal**. No diário, no 60 minutos ou no mensal, ele não aparece.
- Desligado, roda em qualquer escala, só para estudo. Aí as "52 semanas" viram 52 candles da escala escolhida, e as médias também passam a ser dessa escala.

### 2. Radar: a distorção

Num candle semanal fechado, sem outra ocorrência aberta no ativo, todas estas condições:

- **Queda**: o fechamento está pelo menos **50%** abaixo do topo (`minDrawdown`). O topo é a maior máxima das últimas 52 semanas, incluindo a atual (`peak` = "52 semanas", o padrão), ou a maior máxima de todo o histórico carregado (`peak` = "histórico").
- **Médias descendo**: a MME21 e a MMA50 semanais estão menores que na semana anterior (veja [Médias móveis](/biblioteca/medias-moveis)).
- **Fundamentos fortes**, quando conhecidos. LPA é o lucro por ação. O LPA precisa ter crescido pelo menos **20% ao ano** nos últimos 2 anos (`minEpsGrowth`), e a receita não pode ter caído.

Como os fundamentos entram:

- **Conhecidos e fracos** (LPA abaixo do mínimo, ou receita em queda): não há radar. Não é distorção; o preço pode ter caído porque o negócio piorou.
- **Ausentes**: o radar aparece mesmo assim, com "fundamentos NÃO verificados" no motivo e nas notas. Dado ausente **nunca** conta como forte.
- **Só parte conhecida**: o motivo diz "fundamentos verificados só em parte", e a nota diz qual item não foi verificado.
- Só com LPA e receita conhecidos e fortes o motivo diz "possível distorção entre preço e valor".
- **Prejuízo** (LPA zero ou negativo no último ano) conta como fraco: não há radar.

De onde vêm os fundamentos:

- **Ações dos EUA**: balanços anuais entregues à **SEC** (o órgão que regula a bolsa americana), pela base pública EDGAR. O Radar lê o lucro por ação básico e a receita do relatório anual. Para isso, quem instala o Radar precisa preencher `SEC_USER_AGENT` (um nome e um e-mail): a SEC exige essa identificação. Sem ela, os fundamentos dos EUA saem "NÃO verificados".
- **Ações da B3**: demonstrações anuais (DFP) entregues à **CVM**, nos dados abertos dela. A receita é a conta 3.01 da demonstração de resultado; o LPA é o lucro básico por ação da classe do seu código (ON, PN, PNA…). Quem diz que, por exemplo, PETR4 é da Petrobras e é preferencial é o cadastro oficial da CVM (formulário cadastral).
- Os números são de **exercícios anuais**. Balanços trimestrais não entram.
- **Como o crescimento é calculado**: crescimento anual composto em 2 anos. Exemplo: LPA de R$ 1,00 há dois exercícios e R$ 1,44 no último dá 20% ao ano, porque 1,00 × 1,20 × 1,20 = 1,44. Quando houve desdobramento, o Radar compara os anos dentro do mesmo balanço, que já vem com os números por ação refeitos.
- **Receita sem queda**: a receita de cada um dos 2 últimos exercícios é maior ou igual à do exercício anterior. Uma queda pequena já conta como queda.
- **Fica "NÃO verificado"**, com o motivo na nota: menos de 3 exercícios anuais seguidos (empresa nova ou que mudou a data de fechamento do ano), LPA zero ou negativo dois exercícios antes, último exercício terminado há mais de cerca de 18 meses, ou a fonte fora do ar sem nenhum dado guardado.
- **Sem fundamentos**: cripto, forex, ETFs, fundos imobiliários, BDRs e units (a CVM não publica LPA por unit). Em bancos e seguradoras, a "receita" é a conta 3.01 deles (receitas da intermediação financeira, por exemplo), e a nota avisa.
- **Onde vale**: no scanner (filtro "Distorção"), nos alertas de reflexividade e no laboratório. O **gráfico ainda não consulta os balanços**: no painel de Setups do gráfico, o radar sai com "fundamentos NÃO verificados".
- **Atualização**: o Radar guarda os balanços e consulta as fontes de novo a cada 7 dias. Se a fonte estiver fora do ar, usa o último dado guardado e mostra o erro e a data dele.
- **Ainda não testado com as fontes reais**: o ambiente onde o Radar foi escrito não acessa a SEC nem a CVM. O formato dos arquivos foi conferido por busca na web e em fontes secundárias (selo 🟡, veja [Fontes de dados](/fontes)).

O evento de radar também traz a nota: "Proibido comprar durante a queda ('faca caindo'): espere o pivô de alta no semanal."

### 3. Armado: a confirmação

Enquanto está em radar, o setup espera um **pivô de alta** (veja [Primitivas de price action](/biblioteca/primitivas-price-action)):

- um fundo F2 mais alto que o fundo anterior F1. Cada fundo só é confirmado 2 semanas depois de acontecer;
- depois, um fechamento acima da maior máxima entre F1 e F2.

Na semana do pivô ou em até 8 semanas depois dela (`confirmBars`):

- se a **MME9 e a MME21 estiverem as duas subindo** (maiores que na semana anterior), o setup **arma**;
- se, antes disso, uma semana fechar abaixo de F2, o pivô é descartado e o Radar volta a esperar outro;
- se as 8 semanas passarem sem as duas médias subindo juntas, o Radar também espera outro pivô.

Ao armar:

- **Gatilho** (o preço que dispara a compra): máxima da semana que armou + 1 tick.
- **Stop** (o preço de saída se der errado): F2 − 1 tick, ou seja, abaixo do fundo do pivô.

Se o radar passar de 104 semanas (cerca de 2 anos) sem armar, ele **expira** (`radarExpiryBars`).

### 4. Enquanto espera o rompimento

A partir da semana seguinte ao armado, em cada semana fechada, nesta ordem:

1. Se a máxima da semana alcançou o gatilho, a compra acontece. É uma **ordem stop**: basta tocar; se a semana abrir acima do gatilho (um **gap**, salto de preço), a compra é registrada na abertura, que é o pior preço. O motivo diz "1ª parte da entrada em etapas".
2. Se não houve compra e a semana fechou abaixo do stop, o setup é **invalidado** ("perdeu o fundo do pivô antes de acionar").
3. Senão, o gatilho passa para a máxima desta semana + 1 tick. Como a semana não chegou ao gatilho antigo, o novo nunca fica acima dele.

Não há prazo nessa fase: o setup fica armado até a compra ou a invalidação.

### 5. A saída

- **Saída fixa (padrão)**: alvo = entrada + 3 × (entrada − stop), o "alvo de 3R". R é o risco por ação, a distância entre a entrada e o stop (veja [R-múltiplo](/biblioteca/r-multiplo)). O 3 é o parâmetro `exit.targetR`. O alvo parte do preço real de entrada e é arredondado ao tick.
- **Condução (opcional)**: sem alvo. A partir da semana seguinte à compra, toda semana que **fecha abaixo da MME21** sobe o stop para 1 tick abaixo da mínima dessa semana. O stop só sobe; nunca desce.
- **Preço de saída** (o mesmo modelo no painel, nos alertas e no laboratório): stop com gap contra sai na abertura, com perda maior que 1R; alvo com gap a favor sai no alvo (conservador); stop e alvo na mesma semana contam **stop**; na semana da entrada só o stop é conferido, e conta mesmo que a mínima possa ter vindo antes da compra.
- O resultado em R aparece no painel de Setups **sem custos**. Custos e imposto entram só no laboratório.

### 6. Entrada em etapas e limite de risco

- A especificação manda entrar em etapas: a primeira parte no primeiro pivô e um aumento no segundo rompimento, **sempre dentro do limite de risco por trade**.
- **O Radar só tem a primeira parte.** O aumento no segundo rompimento não foi implementado.
- O vídeo fala em "vai na jugular" (posição gigante). Isso é incompatível com a regra de arriscar 1 a 2% do capital por operação. A boleta do Modo Treino avisa quando o risco por trade escolhido passa do seu limite. Veja [Gestão de risco](/biblioteca/gestao-de-risco).

### 7. Outras regras

- **Só compra** e **uma ocorrência por vez** no ativo.
- **Avisos em todas as fases**: radar, armado, acionado e encerrado levam a nota do viés de sobrevivência e a situação dos fundamentos.
- **Escala maior**: a escala maior do semanal é o mensal. Se o mensal estiver em baixa, os eventos de radar, armado e acionado ganham o **aviso vermelho** "contra a escala maior" (veja [Visão fractal](/biblioteca/visao-fractal)). Depois de uma queda grande, o mensal pode estar em baixa. O aviso não bloqueia o setup.

### Exemplo hipotético

Gráfico semanal, tick de R$ 0,01, valores padrão.

1. A maior máxima das últimas 52 semanas foi R$ 100,00. Uma semana fecha em R$ 48,00, uma queda de 52%, com a MME21 e a MMA50 descendo. **Radar**: com LPA e receita conhecidos e fortes, o motivo diz "possível distorção entre preço e valor"; sem dados, "fundamentos NÃO verificados". Comprar aqui é proibido.
2. Semanas depois: um fundo F1 em R$ 40,00 e, mais tarde, um fundo F2 em R$ 44,00, mais alto. A maior máxima entre os dois foi R$ 52,00. Depois que F2 se confirma, uma semana fecha em R$ 53,00: **pivô de alta**.
3. Nessa mesma semana, a MME9 e a MME21 sobem. **Armado.** A máxima da semana foi R$ 54,00: gatilho R$ 54,01. Stop = 44,00 − 0,01 = R$ 43,99.
4. Na semana seguinte, o preço abre abaixo do gatilho e passa de R$ 54,01, sem chegar perto do stop: compra. Risco = 54,01 − 43,99 = R$ 10,02 por ação. Alvo = 54,01 + 3 × 10,02 = **R$ 84,07**.

Agora o tamanho. Com capital de R$ 10.000 e risco de 1% (R$ 100), cabem 9 ações (100 ÷ 10,02 ≈ 9,98, arredondado para baixo), cerca de R$ 486 comprados. Stop longe quer dizer posição pequena. É o oposto do "vai na jugular".

## De onde veio

O setup vem de um vídeo do canal resumido na especificação do Radar, que o descreve como inspirado em George Soros. A especificação registrou: queda de 50% desde o topo de 52 semanas (ou o histórico), médias semanais descendo, fundamentos fortes (LPA crescendo 20% ao ano em 2 anos e receita sem queda, com dados da SEC EDGAR ou da CVM), proibição de comprar durante a queda, confirmação no semanal por pivô de alta com as médias voltando a subir, entrada em etapas dentro do limite de risco e o aviso permanente sobre os exemplos escolhidos depois do fato.

O vídeo usa como exemplos Netflix, Meta, AppLovin e Palantir. A especificação não define como sair da operação; a saída descrita acima é decisão nossa. Esta página descreve a reflexividade **do Radar**.

## Quando falha

- **A queda continua**: −50% pode virar −80%, e a empresa pode nunca se recuperar ou sair da bolsa. O radar não volta a conferir a queda nem as médias depois que aparece; ele só espera o pivô.
- **O preço caiu porque o valor caiu**: sem fundamentos verificados, o Radar não distingue uma distorção de uma empresa que piorou de verdade. Mesmo com eles, "fundamentos fortes nos últimos 2 anos" olham para trás: o mercado pode estar prevendo justamente a piora que o balanço ainda não mostra.
- **Pivô falso**: um pivô de alta no semanal pode ser só uma pausa na queda. O stop fica longe, então cada ação pode perder muito em reais. Um gap abaixo do stop na abertura da semana faz a perda passar de 1R.
- **Desdobramento sem ajuste**: o histórico longo da B3 vem do COTAHIST, que não é ajustado por proventos e desdobramentos 🟡. Num desdobramento em que cada ação vira duas, o preço cai pela metade de um pregão para o outro: no gráfico, isso parece uma queda de 50%, exatamente o mínimo do radar.
- **Pouco histórico**: a MMA50 semanal precisa de 50 semanas de dados. "Topo histórico" quer dizer o topo dos candles carregados, que podem não chegar ao começo da vida da ação.
- **Muito tempo parado**: no semanal, uma operação pode durar meses ou anos. Nesse tempo, o dinheiro poderia estar rendendo o CDI.
- **Poucos casos**: num ativo só, pode haver poucas quedas de 50% seguidas de pivô de alta. Pode não haver operações suficientes para concluir nada.

## Lacunas e decisões nossas

A especificação deixa pontos em aberto. Onde não havia regra, o Radar escolheu uma, e ela vale para todos os números que o Radar mostrar.

- **Só no semanal** (`weeklyOnly`): leitura nossa de "52 semanas", "médias semanais" e "confirmação no semanal".
- **52 semanas** = 52 candles semanais, incluindo o atual.
- **Queda** = do maior pavio (máxima) até o fechamento atual.
- **"Topo histórico"** = maior máxima dos candles carregados.
- **"MME21 e MMA50 descendo"** = menores que na semana anterior. Só são conferidas quando o radar aparece, junto com a queda.
- **Fundamentos**: dado ausente = não verificado, nunca forte; fundamentos conhecidos e fracos suprimem o radar; prejuízo no último exercício = fraco.
- **Crescimento do LPA**: só exercícios anuais; composto em 2 anos, ponta a ponta, com as comparações ano a ano feitas dentro do mesmo balanço. LPA zero ou negativo dois anos antes = não verificado (a conta não se aplica).
- **Receita sem queda**: sem tolerância; vale o número publicado por último (reapresentações contam).
- **Dado velho**: último exercício terminado há mais de 550 dias (cerca de 18 meses) = não verificado.
- **Classe da ação na B3**: o LPA é o da classe do código. Se a empresa tem só uma classe de preferenciais e o rótulo não bate (PN × PNA), o Radar usa essa única linha.
- **Confirmação**: pivô de alta e, na mesma semana ou em até 8 semanas depois, MME9 e MME21 subindo. "Preço apoiado nas médias ou rompendo resistência" não é conferido além do próprio pivô. Fechar abaixo de F2 nesse meio-tempo descarta o pivô.
- **Gatilho**: máxima + 1 tick, deslocado a cada semana, sem prazo enquanto armado. **Stop**: F2 − 1 tick; fechar abaixo dele antes da compra invalida.
- **Validade do radar**: 104 semanas. Decisão nossa.
- **Saída**: a especificação não define. Alvo de 3R e condução pela MME21 são decisões nossas.
- **Entrada em etapas**: só a primeira parte existe.
- **Uma ocorrência por vez** e **só compra**.
- **Semana da entrada**: só o stop é conferido, e conta mesmo que a mínima tenha vindo antes da compra. Escolha conservadora nossa.

## Resultados no laboratório
[[laboratorio]]

- **Tempo gráfico Semanal.** O botão acima já abre o laboratório no Semanal. Se você trocar para o Diário, a reflexividade não gera nenhum sinal (ela só roda no semanal).
- O laboratório usa os candles reais da fonte, os custos padrão do mercado (taxas, spread e derrapagem) e o IR simulado (só para a B3), e compara o resultado com o CDI e com o comprar-e-segurar do mesmo período. Os primeiros 70% do período são o "treino" e os 30% finais são o teste fora da amostra. O mapa de sensibilidade repete o teste com quedas mínimas de 40%, 50% e 60%, e o walk-forward escolhe esse número olhando só para o passado e mede no trecho seguinte. Ele só escolhe um valor quando há pelo menos 10 operações encerradas no trecho de treino; com poucas operações, fica sem escolha. Há também a simulação de Monte Carlo, e cada tentativa fica registrada.
- **Fundamentos sem olhar o futuro**: em cada candle, o laboratório só usa os balanços **já publicados antes dele** (pela data de entrega à SEC ou de recebimento pela CVM). Um balanço publicado num dia só vale a partir do candle seguinte. Antes do primeiro balanço com data, os sinais saem "NÃO verificados". Ativos sem fonte de fundamentos testam só a parte gráfica, e o resultado avisa.
- **Primeira vez com um ativo da B3**: o Radar baixa os arquivos anuais da CVM (cerca de 13 MB por ano). Se demorar, o teste roda sem o filtro de fundamentos e avisa; rode de novo alguns minutos depois.
- **Ações dos EUA**: o resultado fica em dólar, sem IR simulado, e a comparação com o CDI ignora a variação do câmbio.
- **Amostra**: com menos de 30 operações, o veredito sai "inconclusivo". No semanal, 10 anos são cerca de 520 candles, e cada ocorrência leva semanas ou meses: num ativo só, o número de operações tende a ser pequeno.

Para a regra "proibido comprar durante a queda", existe o **Experimento E7** (Laboratório → Experimentos). No semanal, em cerca de 20 anos de cada ativo de uma lista sugerida de ações da B3 (editável), ele compara duas formas de comprar:

- **compra ingênua**: no primeiro fechamento a −50% do topo de 52 semanas, segurando 52 semanas, sem stop e sem custos (otimista de propósito);
- **reflexividade do Radar**: espera o pivô de alta, com stop no fundo do pivô e alvo de 3R, sem o filtro de fundamentos (o E7 mede só a regra do pivô; os balanços da CVM nos dados abertos começam em 2010 e não cobririam os 20 anos).

A reflexividade do E7 roda com os custos padrão do mercado. O E7 mostra, para cada forma, o retorno médio por compra, a taxa de acerto e a pior queda média no caminho até a saída. A especificação registra a limitação dele: sem dados de empresas que saíram da bolsa, o resultado é **otimista** para as duas formas. O mesmo vale para qualquer teste que você rodar hoje: só dá para escolher ativos que ainda existem. Os números dependem dos dados reais; nada nesta página é resultado medido.

## Críticas

- **Viés de sobrevivência no centro.** Os exemplos do vídeo foram escolhidos depois do fato. As empresas que caíram 50% e nunca voltaram, ou sumiram da bolsa, não entram nos exemplos nem nos dados de teste. Por isso, qualquer resultado da reflexividade tende a parecer melhor do que seria.
- **Exemplos escolhidos depois do fato.** É fácil achar, olhando para trás, ações que caíram e subiram de novo. Na hora da queda, ninguém sabe quais serão.
- **"Vai na jugular".** A posição gigante do vídeo contradiz a regra de 1 a 2% de risco dos outros vídeos. Veja [Contradições entre as fontes](/biblioteca/contradicoes-entre-as-fontes).
- **Lendas.** Histórias de grandes investidores, como Soros, são casos extremos. Elas não mostram que o método funciona para a maioria das pessoas.
- **Contra a escala maior.** Mesmo com o pivô no semanal, o mensal pode continuar em baixa. Pela própria regra do canal, isso seria operar contra a escala maior.
- **Fundamentos que olham para trás.** Lucro e receita dos últimos 2 anos não dizem o que vai acontecer. E o Radar só confere esses dois números: dívida, caixa e qualidade do lucro ficam de fora.
- **Amostra pequena.** Poucas operações por ativo, cada uma de meses ou anos. Poucos acertos grandes podem parecer um método.
- **Conflito de interesse.** Os vídeos vendem um serviço de assinatura.
- **Custos, imposto e CDI.** Qualquer resultado precisa vir depois de custos e IR e ser comparado com o CDI do mesmo período. Veja [Antes de arriscar dinheiro](/biblioteca/antes-de-arriscar-dinheiro).
- **É a reflexividade do Radar.** Só semanal, janela de 8 semanas, validade de 104 semanas, alvo de 3R e a falta da segunda etapa são escolhas ou limites nossos. Um número medido aqui vale para esta versão, não necessariamente para a do vídeo.
