---
titulo: Psicologia do trader
categoria: conceito
resumo: Os cinco erros que o vídeo aponta — ego, revanche, devolver lucro, operar demais e entrar sem plano — e o que o Radar faz para você perceber cada um.
relacionados: gestao-de-risco, antes-de-arriscar-dinheiro, r-multiplo, drawdown, expectativa, slippage-e-custos
---

## O que é

Uma regra pode dar prejuízo se for seguida só às vezes. Esta página trata do comportamento: o que você faz entre ver um sinal e sair do trade.

O vídeo lista cinco erros. São observações do canal, não resultado de pesquisa. O Radar não lê pensamentos. O que ele faz é pedir **marcações rápidas** antes de cada compra no treino e **medir comportamentos que deixam rastro**: stop afastado, trade sem plano, stops seguidos.

## Os cinco erros, segundo o vídeo

### 1. Querer estar certo (ego)

**Como aparece**: segurar uma perda porque "o mercado vai voltar"; afastar o stop para não admitir o erro.

**O que o Radar faz**:

- Item do checklist: "Não estou querendo provar que estou certo".
- O stop só anda a favor. Afastá-lo exige confirmação e grava "stop movido para trás", que entra na estatística de disciplina.
- No treino, o resultado em [R](/biblioteca/r-multiplo) é medido a partir do **stop inicial**. Mexer no stop depois não muda a régua.

### 2. Revanche depois de uma perda

**Como aparece**: entrar logo depois de um stop para "recuperar", às vezes com uma posição maior.

**O que o Radar faz**:

- Item do checklist: "Não é para recuperar uma perda (revanche)".
- **Anti-revanche**: a partir de 2 stops no mesmo dia, ou de 4 stops nos últimos 7 dias, a boleta do treino (o quadro onde você monta a ordem de compra) mostra "Pausa recomendada" e sugere reduzir o tamanho. Os números 2 e 4 são padrões arbitrários (decisão nossa), não números testados.
- A pausa **nunca bloqueia**. A decisão continua sendo sua.

### 3. Deixar o lucro virar prejuízo

**Como aparece**: o trade anda a favor, você não sabe quando sair e ele volta até o stop.

**O que o Radar faz**:

- Item do checklist: "Sei o que faço se o lucro começar a voltar".
- O plano de trade pede um **critério de saída**: alvo fixo, conduzir com o [Stop ATR](/biblioteca/atr-e-stop-atr), ou sair quando a MME9 ([média móvel](/biblioteca/medias-moveis) exponencial de 9 períodos) virar para baixo e a mínima for perdida. Com alvo fixo, o alvo é obrigatório.
- No treino, o servidor executa sozinho só o **stop** e o **alvo**. Conduzir pela MME9 ou pelo Stop ATR depende de você subir o stop, o que pode ser feito a qualquer momento na página Treino.

### 4. Operar demais

**Como aparece**: entrar sem setup, por tédio ou ansiedade; muitas operações seguidas.

**O que o Radar faz**:

- Item do checklist: "Não estou operando demais hoje".
- Cada trade de treino mostra os **custos pagos**, e o diário soma todos. Mais operações, mais custos (veja [Slippage e custos](/biblioteca/slippage-e-custos)).
- O plano pede o setup (ou "leitura própria") e um **motivo técnico escrito**, com pelo menos 15 letras.

### 5. Entrar sem plano

**Como aparece**: comprar porque "parece que vai subir", sem stop, alvo nem tamanho definidos.

**O que o Radar faz**:

- O plano de trade só fica **Liberado** com: setup, três escalas, stop técnico, alvo (se a saída for por alvo fixo), tamanho da posição, motivo técnico, print do gráfico (tirado automaticamente) e os cinco itens do checklist.
- No treino, o plano **não bloqueia** a compra, mas o botão avisa: "Comprar sem plano completo (conta como indisciplina)".
- O diário mostra a **disciplina**: a porcentagem de trades com plano liberado, com stop e sem stop movido para trás. A régua da especificação para pensar em dinheiro real é de pelo menos 90%.

## O checklist psicológico

Os cinco itens que aparecem no plano de trade:

1. Não estou querendo provar que estou certo
2. Não é para recuperar uma perda (revanche)
3. Sei o que faço se o lucro começar a voltar
4. Não estou operando demais hoje
5. Vou seguir este plano até o fim

Marcar tudo sem ler não ajuda. O valor está em parar alguns segundos e responder com sinceridade. Se algum item não for verdade, a melhor resposta pode ser não entrar.

## Treino não é igual ao real

O Modo Treino usa preço real e custos, mas o dinheiro é fictício. Perder R$ 500,00 de mentira não pesa como perder R$ 500,00 de verdade. Por isso, a disciplina no treino pode ser melhor do que a que você vai ter no real.

A especificação do Radar prevê comparar, lado a lado, as estatísticas do treino e as do real. Segundo ela, uma diferença grande entre os dois costuma indicar um problema emocional ou de execução, e não da regra.

## Limites

- Os cinco erros são a lista do vídeo, não uma lista completa nem um resultado científico.
- O checklist é autodeclarado: o Radar não tem como saber se você foi sincero.
- A anti-revanche conta stops, não o seu estado de espírito. Um dia ruim com um stop só não aparece.
- Disciplina alta não garante lucro. Seguir à risca uma regra que não funciona continua não funcionando. Veja [Expectativa](/biblioteca/expectativa).
