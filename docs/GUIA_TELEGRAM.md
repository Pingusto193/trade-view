# Guia: alertas no Telegram

O passo a passo (criar o bot com o @BotFather, mandar /start e colar o token no Radar) está no
`GUIA_NOTIFICACOES.md`, **seção 2**. Este arquivo existe para quem procurar pelo nome.

Lembretes:

- O token do bot fica **criptografado** no servidor, com a chave do cofre (`app-secret.key`). Ele não vai
  na exportação JSON: depois de mudar de servidor, cadastre de novo.
- O Radar manda no máximo 1 mensagem por segundo para o mesmo chat (limite do Telegram).
