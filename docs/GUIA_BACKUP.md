# Guia: backup — não perder o que você construiu

O Radar guarda tudo num arquivo de banco de dados no servidor (pasta `data/`). Se esse disco quebrar ou o
servidor for apagado, sem backup você perde listas, desenhos, treino, diário real e replays.

Há **duas proteções**, e vale usar as duas.

## 1. Backup automático (o servidor faz sozinho)

- Uma vez por dia o servidor copia o banco para `data/backups/<data e hora>/`, junto com a chave do cofre
  (`app-secret.key`) e as chaves de notificação (`vapid.json`).
- Guarda os **14 mais novos** e apaga os mais antigos.
- Dá para mudar no `.env`: `BACKUP_EVERY_HOURS` (0 desliga) e `BACKUP_KEEP` (quantos guardar).

**Atenção:** esse backup fica **no mesmo servidor**. Ele salva você de um erro ou de uma atualização que
deu errado, mas **não** de perder o servidor inteiro. Por isso, faça também o passo 2 de vez em quando.

## 2. Copiar os backups para fora do servidor

Com Docker (veja o `GUIA_PUBLICACAO.md`):

```
docker compose cp radar:/data/backups ./backups
```

Guarde a pasta `backups` no seu computador, num pendrive ou num serviço de arquivos. A chave do cofre vai
junto: quem tiver esse arquivo consegue ler os tokens guardados (ex.: Telegram). Guarde em lugar seguro.

Backup manual na hora (antes de uma atualização, por exemplo):

```
docker compose exec radar ./node_modules/.bin/tsx src/cli/backup.ts
```

## 3. Exportar tudo pela tela (JSON)

Em **Mais › Conta › Seus dados › Baixar todos os meus dados** o Radar baixa um arquivo `.json` com tudo
o que é seu: preferências, listas, desenhos, alertas, treino, diário real, replays, laboratório e
exercícios. Não precisa de acesso ao servidor: funciona pelo iPhone ou pelo PC.

Fica de fora (de propósito): senha, sessões, aparelhos com notificação e tokens do Telegram — eles são
presos ao servidor. Depois de importar num servidor novo, ative de novo as notificações e o Telegram.

Para voltar: **Importar arquivo…** na mesma tela. **Importar substitui todos os seus dados atuais** pelos
do arquivo (o app pede confirmação). Se algo der errado no meio, nada muda.

## 4. Restaurar um backup do servidor

1. Pare o Radar: `docker compose down`.
2. Copie `radar.sqlite`, `app-secret.key` e `vapid.json` da pasta do backup para a pasta de dados
   (no Docker, o volume `/data`).
3. Ligue de novo: `docker compose up -d`.

Sem a `app-secret.key` do mesmo backup, os tokens guardados não abrem: refaça o Telegram em
**Alertas › Canais**.

## Resumo

| Proteção | Faz sozinho? | Protege de perder o servidor? |
| --- | --- | --- |
| Backup automático diário | Sim | Não (fica no mesmo disco) |
| Copiar `backups` para fora | Não (você copia) | Sim |
| Exportar JSON pela tela | Não (um toque) | Sim |
