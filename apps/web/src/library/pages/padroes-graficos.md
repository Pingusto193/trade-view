---
titulo: Padrões gráficos
categoria: conceito
resumo: Bandeiras, triângulos, topos duplos e outras formas do preço. São subjetivos, servem só como confirmação e o Radar ainda não os detecta sozinho.
relacionados: suporte-e-resistencia, rompimento-consolidacao, candles, volume, visao-fractal
---

## O que é

Padrões gráficos são formas que o preço desenha ao longo de vários candles: um triângulo, um retângulo, dois topos parecidos. Quem usa acredita que certas formas costumam anteceder certos movimentos.

Segundo o vídeo, padrões gráficos são **subjetivos** e servem **como confirmação, nunca sozinhos**. O vídeo separa os padrões assim:

| Merecem atenção, segundo o vídeo | Evitar no início, segundo o vídeo |
|---|---|
| bandeira e flâmula | ombro-cabeça-ombro |
| retângulo | triângulo simétrico |
| "xícara com alça" | cunhas |
| triângulos ascendente e descendente | padrões raros |
| topos e fundos duplos em regiões importantes | |

### Em palavras simples

- **Bandeira**: depois de uma subida forte, o preço faz uma pausa curta, num canal estreito, levemente contra o movimento.
- **Flâmula**: a mesma pausa, mas com a forma de um triângulo pequeno.
- **Retângulo**: o preço anda de lado entre um teto e um piso horizontais.
- **Xícara com alça**: um fundo arredondado (a xícara) seguido de uma pequena correção (a alça) perto do topo.
- **Triângulo ascendente**: teto horizontal e fundos cada vez mais altos. **Triângulo descendente**: piso horizontal e topos cada vez mais baixos.
- **Topo duplo e fundo duplo**: dois topos (ou dois fundos) em níveis parecidos.
- **Ombro-cabeça-ombro**: três topos, sendo o do meio o mais alto.
- **Triângulo simétrico**: topos cada vez mais baixos e fundos cada vez mais altos, convergindo.
- **Cunha**: duas linhas que se aproximam, as duas inclinadas para o mesmo lado.

## Como o Radar trata

- **O Radar não detecta padrões gráficos automaticamente nesta versão.** Nenhum alerta, setup ou estatística do app se baseia neles.
- Você pode desenhá-los com as ferramentas do gráfico: linha de tendência, canal paralelo, zona de preço e texto. Os desenhos ficam salvos no servidor e aparecem em todos os seus aparelhos.
- O que existe de objetivo e parecido é a **consolidação apertada** do [rompimento de consolidação](/biblioteca/rompimento-consolidacao): uma caixa de 8 a 40 candles depois de uma alta, com amplitude e volume limitados por regras numéricas. Ela lembra um retângulo ou uma bandeira, mas o Radar não usa esses nomes e as regras dela são próprias.
- O Radar não julga o rompimento de um padrão desenhado por você. Se quiser seguir o mesmo critério dos setups, conte só o rompimento por **fechamento** (pavio não conta) e compare o volume com a média de 21 ([Volume](/biblioteca/volume)). Um alerta numa linha ou zona desenhada pode ser "no fechamento do candle" (o mais parecido com esse critério) ou "no toque", que dispara no meio do candle.
- Pela regra do vídeo, um padrão só "vale" em região relevante, como [suporte e resistência](/biblioteca/suporte-e-resistencia), e a favor da escala maior ([visão fractal](/biblioteca/visao-fractal)).

## Quando engana

- **Depois do fato**: no gráfico passado, padrões "perfeitos" saltam aos olhos. No candle da direita, a mesma forma ainda pode virar outra coisa.
- **Cada pessoa desenha diferente**: onde começa a bandeira? Qual topo conta? Duas pessoas olhando o mesmo gráfico podem ver padrões diferentes.
- **Padrão incompleto**: agir antes do rompimento por fechamento é apostar que a forma vai se completar.
- **Escala**: um triângulo no 15 minutos pode ser só um candle no diário.

## De onde veio

A lista do que "merece atenção" e do que evitar, e a regra de usar padrões só como confirmação, vêm do vídeo. A história desses padrões e de quem os descreveu primeiro não está aqui porque ainda não foi conferida em fonte registrada no projeto.

## Críticas

- O vídeo não apresenta estatísticas para nenhum padrão. A lista do que "merece atenção" é preferência do canal, não evidência.
- Enquanto não houver uma regra objetiva, o Radar não consegue testar padrões no laboratório. Qualquer taxa de acerto que você ouvir sobre eles deve vir com amostra, período e custos; sem isso, desconfie.
- É fácil enxergar formas no ruído. Regras definidas antes e o registro no diário do Modo Treino ajudam a separar o que você viu do que realmente aconteceu. Um modo de replay (rever o gráfico sem ver o futuro) está previsto, mas ainda não existe.
