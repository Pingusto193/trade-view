# Guia: colocar o Radar no ar de graça (Oracle Cloud + DuckDNS)

Resultado: o Radar ligado 24 h em `https://SEU-NOME.duckdns.org`, com cadeado (HTTPS), instalável no
iPhone e com notificações. Tempo: cerca de 1 hora na primeira vez.

**Custo: R$ 0** — mas leia os riscos no fim (passo 10). Fatos e fontes: `DATA_SOURCES.md` §11.
Os nomes dos botões do painel da Oracle podem mudar um pouco; procure pelo sentido.

## O que você precisa ter em mãos

- **Cartão de crédito no seu nome com compra internacional liberada.** Cartão virtual, de uso único ou
  pré-pago não é aceito. A Oracle faz uma **pré-autorização de US$ 1** que o banco devolve em alguns
  dias. Ela não cobra nada enquanto você não fizer "upgrade".
- Celular (recebe um SMS), CPF e endereço.
- Um computador (Windows, Mac ou Linux) para os passos 1 a 7. Depois disso, o iPhone basta.

## 1. Criar a conta na Oracle

1. Abra **oracle.com/br/cloud/free** e clique em **Comece gratuitamente** (Start for free).
2. Preencha os dados, confirme o e-mail e o SMS, informe o cartão.
3. **Região inicial (home region): escolha "Brazil East (São Paulo)".** Atenção: é **para sempre**,
   não dá para trocar depois.
4. Entre no painel e ligue a **verificação em duas etapas** (MFA) da sua conta Oracle.

## 2. Criar o servidor (a "instância")

1. No menu ☰, vá em **Compute › Instances › Create instance**.
2. **Name:** `radar`.
3. **Image:** clique em *Change image* e escolha **Canonical Ubuntu 24.04** (não use "Oracle Linux":
   o instalador não funciona nele).
4. **Shape:** clique em *Change shape* › **Ampere** › **VM.Standard.A1.Flex** com **1 OCPU** e
   **2 GB de memória**. Confira o selo **"Always Free-eligible"**.
   - Por que 2 GB e não mais: a Oracle pode parar máquinas "ociosas" (passo 10). Com 2 GB, o
     próprio Radar mantém o uso de memória acima do limite de "ociosa".
5. **Networking:** deixe criar a rede padrão, com **"Assign a public IPv4 address"** marcado.
6. **SSH keys:** escolha **"Generate a key pair for me"** e clique em **Save private key**. **Guarde
   este arquivo** (`ssh-key-….key`): sem ele você não entra no servidor.
7. Clique em **Create**. Em 1 a 2 minutos, o estado fica **Running** (verde).
8. Anote o **Public IP address** que aparece na página da instância (ex.: `129.151.10.20`).

**Deu "Out of capacity" (sem vaga)?** É comum em São Paulo e pode durar dias. Tente de novo mais
tarde. Ou use a forma **VM.Standard.E2.1.Micro** (AMD, também "Always Free"): o Radar funciona nela,
só a instalação demora mais (o instalador cria memória extra sozinho).

## 3. Liberar as portas 80 e 443 no painel da Oracle

Sem isso, ninguém de fora chega ao Radar e o certificado HTTPS não sai.

1. Na página da instância, clique no nome da **Subnet** (em *Primary VNIC*).
2. Clique na **Security List** padrão (*Default Security List for …*).
3. **Add Ingress Rules** e preencha:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** TCP
   - **Destination Port Range:** `80`
4. Clique em **Add Ingress Rules** de novo e repita com a porta **`443`**.
5. Não marque "Stateless".

(O firewall de dentro do Ubuntu, o instalador libera sozinho no passo 6.)

## 4. Criar o endereço grátis no DuckDNS

1. Abra **duckdns.org** e entre com sua conta do **Google** ou do **GitHub**.
2. Em *sub domain*, digite um nome (ex.: `meuradar`) e clique em **add domain**.
3. No campo *current ip*, cole o **IP público** do passo 2 e clique em **update ip**.
4. Copie o **token** que aparece no topo da página (uma sequência longa de letras e números).

Seu endereço será `https://meuradar.duckdns.org` (com o nome que você escolheu).

## 5. Entrar no servidor

No computador, abra o **PowerShell** (Windows) ou o **Terminal** (Mac/Linux) e rode, trocando o
caminho da chave e o IP:

```bash
ssh -i CAMINHO/DA/ssh-key.key ubuntu@SEU-IP
```

- Na primeira vez ele pergunta *"Are you sure…?"*: digite `yes`.
- **Windows, se der "permissions too open"**: clique com o botão direito no arquivo da chave ›
  Propriedades › Segurança › Avançado › Desabilitar herança › remova todos menos o seu usuário.
- **Mac/Linux:** antes, rode `chmod 600 CAMINHO/DA/ssh-key.key`.

Você está dentro quando aparecer algo como `ubuntu@radar:~$`.

## 6. Instalar o Radar (um comando)

Ainda no servidor, cole **tudo numa linha só**, trocando o nome e o token do DuckDNS:

```bash
curl -fsSL https://raw.githubusercontent.com/Pingusto193/trade-view/HEAD/deploy/instalar.sh | bash -s -- --dominio meuradar.duckdns.org --duckdns-token SEU-TOKEN
```

Leva de 5 a 15 minutos. Ele:

- libera as portas no firewall do Ubuntu;
- instala o Docker;
- baixa o Radar e cria a configuração;
- liga tudo com HTTPS automático;
- mantém o IP atualizado no DuckDNS.

No fim aparece:

```
 Pronto! Abra no navegador:  https://meuradar.duckdns.org
 CÓDIGO DE INSTALAÇÃO (pedido só na criação da PRIMEIRA conta):  abcd2efgh3
```

**Anote o código de instalação.** Se ele disser que o https ainda não respondeu, confira o passo 3
(portas) e o passo 4 (IP no DuckDNS) e espere alguns minutos: o certificado sai sozinho.

## 7. Primeiro acesso

1. No computador, abra `https://meuradar.duckdns.org`.
2. Na tela **"Primeiro acesso"**, preencha:
   - o **código de instalação**;
   - seu e-mail;
   - uma senha de pelo menos 10 caracteres.

   O código impede que outra pessoa que ache o endereço antes de você vire dona do seu Radar.
3. Em **Conta**, ligue a **verificação em duas etapas**.
4. **iPhone:** abra o endereço no **Safari** › botão **Compartilhar** › **Adicionar à Tela de Início**.
   Para notificações, siga o `GUIA_IPHONE.md`.

## 8. Chaves das fontes de dados (quando quiser)

Para ligar o forex pela internet, a B3 com atraso etc., coloque as chaves no servidor:

```bash
sudo nano /opt/radar/.env        # edite TWELVE_DATA_KEY=, BRAPI_TOKEN=, ALPACA_KEY_ID= …
                                 # salvar: Ctrl+O, Enter; sair: Ctrl+X
cd /opt/radar && sudo docker compose up -d
```

Cripto (Binance) e CDI/Selic (Banco Central) funcionam sem chave. Onde conseguir cada chave:
`GUIA_PUBLICACAO.md` (tabela do passo 4).

## 9. Atualizar e fazer backup

- **Atualizar** para a versão mais nova (faz backup antes, sozinho):
  `sudo bash /opt/radar/deploy/atualizar.sh`
- **Backup:** o Radar faz um por dia, mas no mesmo disco. **Copie para fora da Oracle** de vez em
  quando. Pela tela: Conta › Seus dados › Baixar. Completo, com a chave dos segredos: `GUIA_BACKUP.md`.

## 10. Riscos e custos escondidos (leia)

- **A Oracle pode PARAR a máquina se ela parecer ociosa.** Isso acontece quando, por 7 dias, o
  processador, a rede **e** (na Ampere) a memória ficam abaixo de 20%.
  - Com 2 GB de memória, o Radar deve ficar acima disso. É uma estimativa nossa, **não garantida**:
    confira em Instância › *Metrics* › *Memory utilization*.
  - Se a máquina for parada, os dados ficam. Entre no painel e clique em **Start**, mas só funciona
    se houver vaga na região.
  - Por isso: **backup fora da Oracle**.
- **Entre no painel da Oracle pelo menos 1 vez por mês** e leia os e-mails dela. Conta sem uso por
  30 a 60 dias pode ser suspensa.
- **A Oracle muda as regras do grátis.** Em junho de 2026 ela cortou pela metade a cota da Ampere,
  sem aviso público.
- **"Upgrade" para Pay As You Go** (opcional):
  - segundo relatos, evita a parada por ociosidade;
  - faz uma pré-autorização de US$ 100;
  - a partir dele, qualquer coisa acima do grátis é **cobrada**: os "Budgets" só mandam e-mail, não
    bloqueiam.
  - Só faça se entender isso. Se fizer, crie um Budget de US$ 1 com alerta para o seu e-mail.
- **Não apague os volumes do Docker** nem reinstale do zero várias vezes na mesma semana. O
  certificado HTTPS tem limite de 5 emissões por semana para o mesmo endereço.
- **DuckDNS** é grátis e sem garantia. Se um dia sair do ar, o Radar continua ligado, mas o endereço
  para de funcionar até você trocar de domínio.

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "Out of capacity" ao criar a instância | Tente outro dia ou use a E2.1.Micro (passo 2) |
| `ssh` não conecta | Confira o IP, o usuário `ubuntu` e o caminho da chave; a porta 22 já vem liberada |
| HTTPS não abre | Portas 80/443 no painel (passo 3); IP certo no DuckDNS (passo 4); `cd /opt/radar && sudo docker compose logs caddy` |
| Esqueci o código de instalação | `sudo grep SETUP_CODE /opt/radar/.env` |
| Radar fora do ar | `cd /opt/radar && sudo docker compose ps` e `sudo docker compose logs radar --tail 100` |
