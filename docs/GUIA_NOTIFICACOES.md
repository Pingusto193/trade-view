# Guia: receber alertas no iPhone, no Telegram e por e-mail

Os alertas são conferidos **no servidor, 24 horas por dia**, mesmo com o app fechado. Você escolhe, em cada
alerta, por onde quer ser avisado. Tudo fica em **Alertas › Canais**.

> Nenhum alerta é recomendação de compra ou venda. É só um aviso de que algo que você pediu aconteceu.

## 1. iPhone (notificação na tela)

O iPhone só entrega notificações de sites que foram **instalados na Tela de Início** — e só a partir do
**iOS 16.4**. Numa aba comum do Safari não funciona (regra da Apple, não do Radar).

1. Confira a versão: **Ajustes › Geral › Sobre › Versão do iOS**. Precisa ser 16.4 ou mais nova.
2. Abra o Radar no **Safari**, toque em **Compartilhar** (quadrado com seta para cima) e em
   **Adicionar à Tela de Início**.
3. Feche o Safari e abra o Radar **pelo ícone** que apareceu na Tela de Início.
4. Vá em **Alertas › Canais** e toque em **Ativar notificações neste aparelho**. Aceite o pedido do iPhone.
5. Toque em **Enviar teste**. Deve chegar uma notificação "Radar — teste".

Se não chegar: veja em **Ajustes › Notificações › Radar** se está permitido e se o modo Foco não está
bloqueando. Se você reinstalar o app, repita o passo 4.

No computador (Chrome, Edge, Firefox) basta o passo 4.

## 2. Telegram (um bot só seu)

1. No Telegram, procure **@BotFather**, mande `/newbot` e responda o nome do bot.
2. Ele devolve um **token** (parece `123456:ABC...`). Copie e cole em **Alertas › Canais › Telegram ›
   Salvar token**. O token fica guardado cifrado no servidor e não volta para a tela.
3. Abra o seu bot novo no Telegram e mande `/start`.
4. No Radar, toque em **Detectar meu chat** e depois em **Enviar teste**.

Nunca compartilhe o token: quem tiver o token controla o bot.

## 3. E-mail

O e-mail depende de quem instalou o servidor configurar o envio (variáveis `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` no arquivo `.env`, com os dados do seu provedor de e-mail). Depois
disso, informe seu endereço em **Alertas › Canais › E-mail** e toque em **Enviar teste**.

## 4. Horário de silêncio

Em **Alertas › Canais › Horário de silêncio** você escolhe um período (horário de Brasília) em que nada é
enviado. O disparo continua aparecendo no **Histórico**, marcado como "silenciado".

## 5. Como cada alerta funciona

- **No fechamento do candle** (padrão): só avisa quando o candle fecha do outro lado. Menos alarmes falsos.
- **No toque**: avisa assim que o preço encosta, mesmo que volte depois.
- **Uma vez**: depois de avisar, o alerta se desliga. **Sempre**: avisa de novo cada vez que acontecer, com
  um intervalo mínimo.
- Alertas de **setup** e de **indicador** são sempre no fechamento.
- Alertas de **desenho**: linhas de tendência e raios são prolongados para a direita; zonas valem para a
  direita, sem fim. Se você apagar o desenho, o alerta mostra o aviso "o desenho foi apagado".
- O aviso traz o ativo, a escala, o que aconteceu, o preço e um link que abre o gráfico certo.
