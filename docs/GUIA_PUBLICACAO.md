# Guia: colocar o Radar no ar (para usar no iPhone e no PC, com dados reais)

> **Caminho mais fácil e grátis:** `GUIA_ORACLE.md` (servidor grátis da Oracle + endereço grátis do
> DuckDNS + instalador de um comando). Este guia é o caminho manual, para qualquer servidor Linux.

Rodando no seu computador, o Radar só funciona enquanto o PC estiver ligado, e o iPhone não recebe
notificações (a Apple exige um endereço **https://** público). Para usar de verdade, o Radar precisa ficar
num **servidor ligado 24 h** com um **domínio**. Este guia faz isso com Docker, num servidor Linux.

> Custo: você vai pagar o servidor e (talvez) o domínio. Os preços variam por provedor e não foram cotados
> aqui. Ver a pergunta aberta em `docs/OPEN_QUESTIONS.md`.

## 1. O que você precisa

- Um **servidor Linux** (VPS) com Ubuntu ou Debian. Medido nesta versão: o Radar usa cerca de **90 MB de
  memória** parado; um servidor com **1 GB** de memória sobra.
- Um **domínio ou subdomínio** (ex.: `radar.seunome.com`) apontando para o IP do servidor (registro "A"
  no painel de quem vende o domínio).
- As portas **80** e **443** liberadas no firewall do provedor (para o HTTPS automático).
- As chaves das fontes de dados reais (todas gratuitas; veja o guia de instalação local):
  Alpaca (ações dos EUA) e brapi (B3). Cripto (Binance) não precisa de chave.

## 2. Instalar o Docker no servidor

Siga o passo a passo oficial do Docker para o seu sistema (procure "Install Docker Engine on Ubuntu" no
site docs.docker.com). Para conferir, rode:

```bash
docker --version
docker compose version
```

## 3. Baixar o Radar

```bash
git clone <endereço do seu repositório do Radar> radar
cd radar
```

## 4. Configurar

```bash
cp .env.example .env
nano .env
```

Preencha pelo menos:

| Variável | O que colocar |
| --- | --- |
| `RADAR_DOMAIN` | o seu domínio, sem `https://` (ex.: `radar.seunome.com`) |
| `PUBLIC_URL` | o mesmo com `https://` (ex.: `https://radar.seunome.com`) |
| `RADAR_SIMULATED` | `0` (dados reais; o servidor se recusa a ligar o simulador em produção) |
| `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` | chaves da Alpaca (ações dos EUA) |
| `BRAPI_TOKEN` | token da brapi (B3) |
| `TWELVE_DATA_KEY` | chave grátis da Twelve Data para **forex sem o PC Windows**: crie a conta em twelvedata.com, copie a "API key" do painel e cole aqui. O plano grátis dá 800 consultas por dia (cerca de 10 horas de gráfico de forex aberto). Sem ela, forex só pelo MetaTrader 5 |
| `SEC_USER_AGENT` | um nome e o seu e-mail (ex.: `Radar pessoal voce@exemplo.com`): a SEC exige essa identificação para dar os fundamentos dos EUA |
| `VAPID_SUBJECT` | `mailto:` + seu e-mail (exigido pelo push) |
| `SMTP_*` | só se quiser alertas por e-mail |

Deixe `APP_SECRET`, `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` vazios: o Radar cria e guarda essas chaves
sozinho no volume de dados (e elas entram no backup).

## 5. Ligar

```bash
docker compose up -d --build
docker compose logs -f radar     # Ctrl+C para sair dos logs
```

A primeira vez demora alguns minutos (monta o app). O Caddy pede o certificado HTTPS automaticamente; se o
domínio ainda não apontar para o servidor, ele tenta de novo sozinho.

## 6. Primeiro acesso

1. Abra `https://seu-dominio` no computador.
2. A primeira tela cria a **sua conta** (a primeira conta é a dona) e pede o **código de
   instalação**: é o `SETUP_CODE` do `.env` (o instalador gera um). Sem ele no `.env`, o servidor gera
   um ao ligar e escreve no log: `docker compose logs radar | grep "código de instalação"`. Depois
   disso, novas contas só por convite (Conta › Convites).
3. Em **Conta**, ligue a **verificação em duas etapas**.
4. No iPhone: abra o endereço no Safari, **Compartilhar › Adicionar à Tela de Início**, e siga o
   `docs/GUIA_NOTIFICACOES.md`.

O app abre no **Modo Treino** (dinheiro fictício, preços reais). Crie a conta de treino com o valor que
quiser em **Treino**.

## 7. Atualizar para uma versão nova

```bash
git pull
docker compose up -d --build
```

Os dados ficam no volume `radar-data` e não se perdem ao atualizar.

## 8. Backup (faça antes de cada atualização e toda semana)

O servidor já faz **um backup por dia sozinho** (guarda os 14 mais novos em `/data/backups`). Mas ele fica
no mesmo disco: copie para fora de vez em quando. Detalhes, exportação pela tela e como restaurar:
`GUIA_BACKUP.md`.

Backup na hora (ex.: antes de atualizar) e cópia para o seu computador:

```bash
docker compose exec radar ./node_modules/.bin/tsx src/cli/backup.ts
docker compose cp radar:/data/backups ./backups
```

Copie a pasta `backups` para fora do servidor (seu PC, um pendrive, um serviço de arquivos).
**O arquivo `app-secret.key` é indispensável**: sem ele, os segredos guardados (ex.: token do Telegram) não
podem ser lidos. Guarde-o com o mesmo cuidado de uma senha.

## 9. Segurança

- O Radar só fica exposto pelo Caddy (HTTPS). A porta interna 8787 não é publicada.
- Use senha longa e a verificação em duas etapas.
- Libere no firewall só as portas 22 (acesso ao servidor), 80 e 443.
- O Radar **não envia ordens** a corretoras: mesmo invadido, não movimenta dinheiro. Mas guarda seus
  planos, diário e chaves de dados: trate o servidor como algo pessoal.

## 10. Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| O navegador diz que o site não é seguro | O domínio ainda não aponta para o IP do servidor, ou as portas 80/443 estão fechadas. Veja `docker compose logs caddy`. |
| Gráfico com "Não foi possível carregar os dados" | A fonte está fora ou a chave está errada. Veja a tela **Fontes** e `docker compose logs radar`. |
| Notificação não chega no iPhone | O app precisa estar instalado na Tela de Início e com iOS 16.4+. Veja o guia de notificações. |
| Esqueci a senha | Ainda não há recuperação por e-mail: com acesso ao servidor, restaure um backup ou peça ajuda. |

Testado nesta versão: a imagem é montada e o app sobe em modo produção (saúde, PWA, banco persistente
e criação da primeira conta). **Não testado:** HTTPS real com domínio e notificação real no iPhone (o
ambiente de desenvolvimento não tem domínio nem iPhone).
