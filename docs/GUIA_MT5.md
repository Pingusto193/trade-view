# Guia: B3 em tempo real e forex pelo MetaTrader 5

O Radar recebe a B3 em tempo real (mini-índice, mini-dólar, ações) e o forex (EURUSD etc.) pelo
**MetaTrader 5 (MT5) da sua corretora**, aberto num **PC com Windows**. Um programa pequeno, o
**agente**, roda nesse PC, lê os candles do MT5 e manda para o seu Radar pela internet.

> **O que o agente NÃO faz:** não envia ordens, não lê o saldo nem as posições da sua conta e **nunca
> pede a senha da corretora**. Ele só lê os preços do MT5 que você já deixou aberto e logado. Nada do
> Radar opera por você.

**Precisa estar tudo ligado:** sem o PC ligado, o MT5 aberto e o agente rodando, não chegam dados novos.
O gráfico continua mostrando o último dado guardado, com o aviso em vermelho e a data e hora do último
contato — o Radar nunca inventa preço.

## Antes de começar

Você vai precisar de:

- um **PC com Windows 64 bits** que possa ficar ligado durante o pregão (o pacote oficial do MT5 para
  Python só existe para Windows);
- uma conta numa corretora que ofereça o **MetaTrader 5** (pode ser conta demonstração para testar);
- o **Radar publicado** com endereço `https://` (veja `docs/GUIA_PUBLICACAO.md`) — ou rodando no
  próprio PC;
- uns 20 minutos.

Pergunte à sua corretora, antes, **se os dados da B3 no MT5 são em tempo real e se há cobrança**. Isso
varia de corretora para corretora e o Radar não consegue conferir sozinho.

## Passo 1 — Instale e abra o MetaTrader 5 da corretora

1. Baixe o MT5 **no site da sua corretora** (cada corretora tem o seu instalador, já com o servidor dela).
2. Instale, abra e entre com o login da corretora **dentro do MT5** (é o MT5 que guarda a senha, não o
   Radar).
3. Abra a **Observação de Mercado** (menu Exibir → Observação de Mercado, ou `Ctrl+M`). Anote o **nome
   exato** dos ativos que você quer. Exemplos: `WIN$N` e `WDO$N` (séries contínuas do mini-índice e do
   mini-dólar em muitas corretoras), `PETR4`, `EURUSD`. Algumas corretoras usam sufixos, como `EURUSD.a`.
   Copie como aparece lá.
4. Recomendado: em **Ferramentas → Opções → Gráficos**, aumente **"Máx. barras no gráfico"** (ou escolha
   "Ilimitado"). Esse número limita quanto histórico o MT5 entrega ao agente.

## Passo 2 — Instale o Python

1. Entre em **python.org → Downloads → Windows** e baixe o instalador do Python 3 mais recente (64 bits).
2. Na primeira tela do instalador, **marque "Add python.exe to PATH"** (vem desmarcado) e clique em
   **Install Now**.
3. Abra o **Prompt de Comando** (tecla Windows, digite `cmd`, Enter) e digite:

   ```
   py --version
   ```

   Deve aparecer algo como `Python 3.13.x`. Se der "não reconhecido", tente `python --version`; se também
   não funcionar, rode o instalador de novo e marque a opção do passo 2.

## Passo 3 — Instale o pacote oficial do MetaTrader 5

No mesmo Prompt de Comando:

```
py -m pip install MetaTrader5
```

É o pacote oficial da MetaQuotes (a empresa do MT5), gratuito. Ele traz junto o `numpy`.

## Passo 4 — Copie o agente para o PC

O agente é a pasta `agents/mt5-bridge` do projeto do Radar. Copie a pasta inteira para um lugar fácil,
por exemplo `C:\RadarMT5`. (No GitHub: botão **Code → Download ZIP**, descompacte e copie só essa pasta.)

Dentro dela ficam, entre outros: `radar_mt5.py`, `config.example.ini` e `iniciar-radar-mt5.bat`.

## Passo 5 — Gere o token no Radar

1. No Radar, vá em **Mais → Fontes de dados**, na seção **MetaTrader 5**.
2. Dê um nome para este PC (ex.: "PC de casa — B3") e toque em **Gerar token para um agente**.
3. Aparece um quadro com duas linhas (`url = ...` e `token = ...`). **Copie agora**: o token aparece só
   essa vez. Se perder, é só gerar outro e revogar o antigo.

O token **não é a senha da corretora**. Ele só permite mandar dados de preço para o seu Radar (quem tiver
o token não vê nada nem opera). Mesmo assim, não mande para ninguém.

## Passo 6 — Configure o agente

1. Na pasta do agente, copie `config.example.ini` e renomeie a cópia para **`config.ini`**.
2. Abra o `config.ini` no **Bloco de Notas** e preencha:

   ```ini
   [radar]
   url = https://radar.seudominio.com.br
   token = rmt5_...o token que você copiou...

   [mt5]
   symbols = WIN$N, WDO$N, PETR4
   market = auto
   server_timezone = auto
   ```

   - `symbols`: os nomes exatos da Observação de Mercado, separados por vírgula.
   - `market`: deixe `auto`; o Radar descobre se é B3 ou forex.
   - `server_timezone`: deixe `auto` (veja "O horário do servidor da corretora", abaixo).
3. Salve. **Nunca** escreva a senha da corretora nesse arquivo — ele nem tem lugar para isso.

## Passo 7 — Teste a conexão

Com o Prompt de Comando **dentro da pasta do agente** (`cd C:\RadarMT5`):

```
py radar_mt5.py --check
```

Deve aparecer **"Conexão com o Radar OK"** e **"Tudo certo"**. Esse teste não precisa do MT5 e não manda
preços. No Radar, em Fontes de dados, o agente aparece com "Teste de conexão OK".

## Passo 8 — Rode o agente

Dê **dois cliques em `iniciar-radar-mt5.bat`**. Abre uma janela preta: **deixe aberta** (pode minimizar).
Para parar, feche a janela.

## Como saber se está funcionando

- **Na janela do agente**: logo no começo aparece "Conectado ao MetaTrader 5." e, a cada minuto, uma
  linha "Funcionando: N ativo(s) anunciados; acompanhando: ...; fuso do servidor: ...".
- **No Radar, em Fontes de dados**: o agente aparece com a bolinha **verde** e "Conectado — MetaTrader 5",
  o nome da corretora e a lista de ativos. Problemas (ex.: ativo que não existe na corretora) aparecem
  em vermelho ali mesmo.
- **Na busca do gráfico**: digite `WIN`, `PETR4` ou `EURUSD`; aparecem os ativos com a fonte
  "MetaTrader 5". No gráfico, o selo diz **"MetaTrader 5 · Tempo real"**.
- Quando você abre um gráfico, o Radar pede o histórico ao agente; a primeira abertura pode levar alguns
  segundos.

## Deixar iniciando com o Windows

1. Aperte **Windows + R**, digite `shell:startup` e Enter. Abre a pasta de inicialização.
2. Clique com o botão direito em `iniciar-radar-mt5.bat` (na pasta do agente) → **Mostrar mais opções →
   Criar atalho**, e mova o atalho para a pasta de inicialização.
3. Faça o mesmo com o atalho do **MetaTrader 5**, para ele também abrir sozinho (marque no MT5 a opção de
   salvar a senha da conta, que fica no próprio MT5).
4. Em **Configurações → Sistema → Energia**, evite que o PC entre em suspensão durante o pregão.

Se o agente abrir antes do MT5, não tem problema: ele tenta de novo a cada 10 segundos.

## Duas corretoras (uma da B3 e outra de forex)

Rode **dois agentes**: copie a pasta do agente duas vezes (ex.: `C:\RadarMT5-B3` e `C:\RadarMT5-Forex`),
gere **um token para cada um** e, em cada `config.ini`, coloque os ativos daquela corretora. Se os dois
MT5 estiverem instalados no mesmo PC, preencha `terminal_path` com o caminho do `terminal64.exe` de cada
um (clique com o botão direito no atalho do MT5 → Propriedades → Destino).

Se dois agentes mandarem o mesmo ativo, vale o que conectou primeiro; o outro recebe um aviso.

## O horário do servidor da corretora

O MT5 entrega os horários dos candles no **relógio do servidor da corretora**, que nem sempre é o horário
de Brasília (muitas corretoras de forex usam UTC+2 no inverno dos EUA e UTC+3 no verão). Com
`server_timezone = auto`, o agente compara o horário dos ticks com o relógio do seu PC enquanto o mercado
está aberto e o Radar converte tudo para o horário certo. Em Fontes de dados aparece o fuso usado.

- Se o PC estiver com o relógio errado, a medida erra: deixe o relógio do Windows em "definir
  automaticamente".
- Se você ligar o agente com o mercado fechado (fim de semana), ainda não há ticks para medir: no forex,
  os horários intradiários podem ficar deslocados até o mercado abrir. Para evitar, informe o fuso:
  `server_timezone = NY+7` (padrão comum no forex, que segue o horário de verão dos EUA),
  `America/Sao_Paulo` (horário de Brasília) ou um valor fixo como `UTC+02:00`.
- O candle diário segue a virada de dia do servidor da corretora (no forex, normalmente 17h de Nova York).

## Testar sem MetaTrader 5 (simulador)

```
py radar_mt5.py --simulate --url http://localhost:5173 --token rmt5_...
```

O simulador gera **DADOS SIMULADOS** (preços inventados de propósito, só para testar a ponte). Por isso o
Radar **publicado recusa** esses dados — o agente mostra "O Radar recusou o envio" e para. O simulador só
funciona num Radar de desenvolvimento (`RADAR_SIMULATED=1`, veja `docs/GUIA_INSTALACAO_LOCAL.md`), e os
gráficos aparecem com a faixa amarela **"DADOS SIMULADOS"** e a fonte "MT5 simulado (DEV)". Para testar a
conexão com o Radar publicado sem MT5, use `--check`.

## Problemas comuns

| Mensagem | O que fazer |
| --- | --- |
| `py` não é reconhecido | Reinstale o Python marcando "Add python.exe to PATH", ou use `python` no lugar de `py`. |
| o pacote MetaTrader5 não está instalado | Rode `py -m pip install MetaTrader5`. |
| não consegui conectar ao MetaTrader 5 | Abra o MT5 e faça login na corretora. Com dois MT5 no PC, preencha `terminal_path`. |
| O Radar recusou o token | Gere outro token em Fontes de dados e cole no `config.ini` (o antigo pode ter sido revogado ou copiado pela metade). |
| O endereço do Radar precisa começar com https:// | Use o endereço com `https://`. Só o próprio PC ou a rede de casa aceitam `http://`. |
| sem conexão com o Radar | Confira a internet e o endereço. O agente tenta de novo sozinho (espera até 1 minuto entre tentativas). |
| "não existe nesta corretora" (em Fontes de dados) | O nome do ativo está diferente: copie da Observação de Mercado do MT5. |
| "MT5 aberto, mas sem conexão com a corretora" | O MT5 perdeu a conexão (canto inferior direito do MT5). Confira a internet e o login. |
| gráfico com "Agente MT5 ... sem contato desde ..." | O PC, o MT5 ou o agente estão desligados. O gráfico mostra os últimos dados guardados. |
| histórico curto | Aumente "Máx. barras no gráfico" no MT5 (passo 1) e reabra o gráfico. |

## Riscos e limitações (leia)

- **Só funciona com o PC ligado.** Se o PC desligar, travar ou perder a internet, os alertas e o Modo
  Treino desses ativos param de receber preço. O Radar mostra o erro e a hora do último dado; ele não
  "adivinha" o que aconteceu no meio.
- **Tick volume no forex não é volume negociado.** No forex não existe um volume central: o número que o
  MT5 mostra é quantas vezes o preço mudou na sua corretora. O Radar marca isso no selo ("Tick volume") e
  na legenda ("Tick vol"). As regras de volume dos setups ainda usam esse número — no forex, desconfie
  delas.
- **O preço do forex é o da sua corretora**, não de uma bolsa. Outra corretora pode mostrar preços e
  candles um pouco diferentes.
- **Dados da B3 pelo MT5** dependem da corretora (tempo real ou não, custo, volume real ou não). O selo
  mostra o que o Radar conseguiu saber.
- **Forex no Brasil:** a CVM publica com frequência alertas contra corretoras estrangeiras de forex que
  captam clientes no Brasil sem autorização, e considera esse mercado de alto risco. Antes de abrir conta,
  procure a corretora na lista de alertas da CVM. O Radar não recomenda corretora nenhuma.
- **Segurança:** o token fica no `config.ini` do seu PC. Se alguém pegar o token, consegue mandar preços
  falsos para o seu Radar (não consegue ver seus dados nem operar). Se desconfiar, revogue em Fontes de
  dados e gere outro.
- Nada aqui é recomendação de investimento. O Radar nunca envia ordens.

## Atualizar, trocar ou remover

- **Atualizar o agente:** substitua a pasta pela versão nova, mantendo o seu `config.ini`.
- **Trocar o token:** gere um novo em Fontes de dados, cole no `config.ini` e revogue o antigo.
- **Remover:** feche a janela do agente, apague o atalho da pasta de inicialização e revogue o token no
  Radar.
