# Perguntas frequentes

## O Radar compra e vende por mim?

Não. O Radar **nunca envia ordens** para corretora nenhuma. Ele mostra gráficos, avisa quando algo que
você pediu acontece, ajuda a planejar e a medir. No modo Real, você registra no **Diário** o que fez na
corretora.

## O Radar diz o que vai subir?

Não. Nenhum setup, indicador ou alerta é recomendação. O laboratório mede como uma regra teria se saído
no passado, com custos, imposto e comparação com o CDI — e mesmo um bom resultado passado não garante o
futuro.

## Por que aparece "DADOS SIMULADOS"?

É o modo de desenvolvimento, sem internet para as fontes reais. Os preços são inventados de propósito e
nunca aparecem no servidor publicado (lá esse modo é proibido). Se você vir a faixa no seu servidor, a
configuração está errada: veja `RADAR_SIMULATED` no `.env`.

## Por que a B3 tem atraso?

A fonte gratuita da B3 (brapi) entrega preços com atraso e só cerca de 3 meses de histórico. Para tempo
real na B3 é preciso o agente do MetaTrader 5 (`GUIA_MT5.md`); para histórico longo, importar o COTAHIST
da própria B3. Cada gráfico mostra a fonte e o atraso no canto.

## O treino é igual ao dinheiro de verdade?

Não, e o Radar faz o possível para o treino **não parecer melhor** do que seria: preço real, custos,
derrapagem, stop antes do alvo quando não dá para saber a ordem. Mas perder dinheiro de mentira não pesa
igual. Compare treino, replay e real no **Diário real**: uma diferença grande costuma ser emoção ou
execução.

## Quando posso operar com dinheiro real?

O **Painel de prontidão** (no Treino) mostra, com números, o que falta: quantidade de trades, resultado
depois de custos e IR comparado ao CDI, disciplina e queda máxima. É uma régua nossa, não uma garantia, e
nunca bloqueia o modo Real.

## O imposto que o Radar calcula vale para a Receita?

É uma **estimativa** pela regra de 2026 para ações e minicontratos da B3. Não substitui a corretora nem um
contador. Cripto, ações dos EUA e forex ficam de fora (regras próprias ou em disputa).

## Esqueci a senha

Ainda não há recuperação por e-mail. Com acesso ao servidor, restaure um backup ou peça ajuda a quem
administra. Ative a verificação em duas etapas em **Conta** e guarde a senha num gerenciador.

## Como não perder meus dados?

O servidor faz backup diário sozinho; copie de vez em quando para fora e use **Conta › Seus dados ›
Baixar todos os meus dados**. Veja `GUIA_BACKUP.md`.

## Quanto custa?

O Radar é seu e não cobra nada. Os custos possíveis são o servidor (há opção gratuita, veja
`GUIA_PUBLICACAO.md`), um domínio (opcional) e, se quiser, planos pagos das fontes de dados.

## Outros guias

`GUIA_INSTALACAO_LOCAL.md` (no seu computador) · `GUIA_PUBLICACAO.md` / `GUIA_DEPLOY.md` (servidor) ·
`GUIA_IPHONE.md` · `GUIA_NOTIFICACOES.md` / `GUIA_TELEGRAM.md` · `GUIA_BACKUP.md` · `GUIA_MT5.md`.
