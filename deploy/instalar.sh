#!/usr/bin/env bash
# Instalador do Radar num servidor Linux (Ubuntu) novo — feito para a Oracle Cloud grátis, serve em
# qualquer Ubuntu com Docker. Guia passo a passo: docs/GUIA_ORACLE.md
#
# Uso (no servidor, uma linha):
#   curl -fsSL https://raw.githubusercontent.com/Pingusto193/trade-view/<ramo>/deploy/instalar.sh \
#     | bash -s -- --dominio SEU-NOME.duckdns.org --ramo <ramo>
#
# Pode rodar de novo quando quiser: não apaga dados nem troca o .env (só completa o que falta).
set -euo pipefail

REPO="https://github.com/Pingusto193/trade-view.git"
DOMINIO=""
RAMO="main"
PASTA="/opt/radar"
DUCKDNS_TOKEN=""
FIREWALL=1
BAIXAR_CODIGO=1
ESPERAR_HTTPS=1

ajuda() {
  cat <<'TXT'
Opções:
  --dominio NOME        endereço do Radar (ex.: meuradar.duckdns.org)   [obrigatório]
  --ramo NOME           ramo do GitHub a instalar (padrão: main)
  --pasta DIR           onde instalar (padrão: /opt/radar)
  --duckdns-token TOKEN atualiza o IP no DuckDNS a cada 5 min (opcional)
  --sem-firewall        não mexe no firewall do sistema
  --sem-baixar          usa o código que já está em --pasta (não usa o git)
  --sem-esperar-https   não espera o certificado HTTPS no fim
TXT
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dominio) DOMINIO="${2:-}"; shift 2 ;;
    --ramo) RAMO="${2:-}"; shift 2 ;;
    --pasta) PASTA="${2:-}"; shift 2 ;;
    --duckdns-token) DUCKDNS_TOKEN="${2:-}"; shift 2 ;;
    --sem-firewall) FIREWALL=0; shift ;;
    --sem-baixar) BAIXAR_CODIGO=0; shift ;;
    --sem-esperar-https) ESPERAR_HTTPS=0; shift ;;
    -h|--help) ajuda; exit 0 ;;
    *) echo "Opção desconhecida: $1"; ajuda; exit 2 ;;
  esac
done

passo() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
aviso() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*"; }
erro() { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -n "$DOMINIO" ]] || { ajuda; erro "faltou --dominio (ex.: --dominio meuradar.duckdns.org)"; }
[[ "$DOMINIO" =~ ^[A-Za-z0-9.-]+$ ]] || erro "domínio inválido: $DOMINIO"
[[ "$(uname -s)" == "Linux" ]] || erro "este instalador é para Linux"

SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
  command -v sudo >/dev/null || erro "rode como root ou instale o sudo"
  SUDO="sudo"
fi

# ------------------------------------------------------------------ memória (o build precisa de folga)
passo "Conferindo memória"
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
swap_kb=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
if (( mem_kb < 1900000 && swap_kb < 1000000 )); then
  echo "Memória pequena ($((mem_kb / 1024)) MB): criando 2 GB de swap para montar o app."
  if [[ ! -f /swapfile ]]; then
    $SUDO fallocate -l 2G /swapfile || $SUDO dd if=/dev/zero of=/swapfile bs=1M count=2048
    $SUDO chmod 600 /swapfile
    $SUDO mkswap /swapfile >/dev/null
  fi
  $SUDO swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
else
  echo "ok ($((mem_kb / 1024)) MB de memória, $((swap_kb / 1024)) MB de swap)"
fi

# ------------------------------------------------------------------ firewall do sistema (portas 80 e 443)
if (( FIREWALL )); then
  passo "Liberando as portas 80 e 443 no firewall do sistema"
  # As imagens Ubuntu da Oracle trazem regras do iptables que recusam tudo menos o SSH (porta 22).
  if command -v iptables >/dev/null && $SUDO iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
    for regra in "-p tcp --dport 80" "-p tcp --dport 443" "-p udp --dport 443"; do
      # shellcheck disable=SC2086
      if ! $SUDO iptables -C INPUT $regra -m state --state NEW -j ACCEPT 2>/dev/null; then
        # shellcheck disable=SC2086
        $SUDO iptables -I INPUT 1 $regra -m state --state NEW -j ACCEPT
      fi
    done
    if command -v netfilter-persistent >/dev/null; then
      $SUDO netfilter-persistent save >/dev/null 2>&1 || aviso "não consegui salvar as regras (netfilter-persistent)"
    else
      aviso "regras liberadas agora, mas sem netfilter-persistent elas somem ao reiniciar o servidor"
    fi
    echo "ok (iptables)"
  fi
  if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q 'Status: active'; then
    $SUDO ufw allow 80/tcp >/dev/null && $SUDO ufw allow 443 >/dev/null && echo "ok (ufw)"
  fi
  echo "Lembre: as portas 80 e 443 também precisam estar liberadas no painel da Oracle (guia, passo 4)."
fi

# ------------------------------------------------------------------ Docker
passo "Docker"
if ! command -v docker >/dev/null; then
  echo "Instalando o Docker (script oficial get.docker.com)…"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! $SUDO docker compose version >/dev/null 2>&1; then
  erro "o Docker está instalado, mas falta o 'docker compose' (plugin). Veja o guia."
fi
if [[ -n "$SUDO" ]] && ! id -nG "$USER" | grep -qw docker; then
  $SUDO usermod -aG docker "$USER" || true
fi
$SUDO docker --version

# ------------------------------------------------------------------ código
passo "Código do Radar em $PASTA"
if (( BAIXAR_CODIGO )); then
  command -v git >/dev/null || { $SUDO apt-get update -y >/dev/null && $SUDO apt-get install -y git >/dev/null; }
  if [[ -d "$PASTA/.git" ]]; then
    $SUDO git -C "$PASTA" fetch --depth 1 origin "$RAMO"
    $SUDO git -C "$PASTA" checkout -B "$RAMO" FETCH_HEAD
  else
    $SUDO git clone --depth 1 --branch "$RAMO" "$REPO" "$PASTA"
  fi
fi
[[ -f "$PASTA/docker-compose.yml" ]] || erro "não achei docker-compose.yml em $PASTA"
cd "$PASTA"

# ------------------------------------------------------------------ .env de produção
passo "Configuração (.env)"
ENV_FILE="$PASTA/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  $SUDO cp "$PASTA/.env.example" "$ENV_FILE"
  NOVO_ENV=1
else
  NOVO_ENV=0
fi
$SUDO chmod 600 "$ENV_FILE"

# troca (ou acrescenta) CHAVE=valor no .env
definir() {
  local chave="$1" valor="$2"
  if $SUDO grep -q "^${chave}=" "$ENV_FILE"; then
    $SUDO sed -i "s|^${chave}=.*|${chave}=${valor}|" "$ENV_FILE"
  else
    echo "${chave}=${valor}" | $SUDO tee -a "$ENV_FILE" >/dev/null
  fi
}
valor() { $SUDO grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

definir NODE_ENV production
definir HOST 0.0.0.0
definir RADAR_SIMULATED 0
definir TRUST_PROXY 1
definir RADAR_DOMAIN "$DOMINIO"
definir PUBLIC_URL "https://$DOMINIO"
if [[ "$(valor VAPID_SUBJECT)" == *exemplo.com* || -z "$(valor VAPID_SUBJECT)" ]]; then
  definir VAPID_SUBJECT "https://$DOMINIO"
fi
CODIGO="$(valor SETUP_CODE)"
if [[ -z "$CODIGO" ]]; then
  # 10 letras e números sem os que se confundem (0/O, 1/l/I)
  CODIGO="$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 10 || true)"
  definir SETUP_CODE "$CODIGO"
fi
(( NOVO_ENV )) && echo "criado a partir do .env.example" || echo "mantido (só completei o que faltava)"

# ------------------------------------------------------------------ DuckDNS (opcional)
if [[ -n "$DUCKDNS_TOKEN" ]]; then
  passo "DuckDNS: atualização automática do IP"
  if [[ "$DOMINIO" != *.duckdns.org ]]; then
    aviso "--duckdns-token só vale para domínios .duckdns.org; ignorado"
  else
    SUB="${DOMINIO%.duckdns.org}"
    SCRIPT=/usr/local/bin/radar-duckdns
    printf '#!/bin/sh\ncurl -fsS "https://www.duckdns.org/update?domains=%s&token=%s&ip=" >/dev/null\n' \
      "$SUB" "$DUCKDNS_TOKEN" | $SUDO tee "$SCRIPT" >/dev/null
    $SUDO chmod 700 "$SCRIPT"
    echo "*/5 * * * * root $SCRIPT" | $SUDO tee /etc/cron.d/radar-duckdns >/dev/null
    $SUDO "$SCRIPT" && echo "ok (IP enviado ao DuckDNS)"
  fi
fi

# ------------------------------------------------------------------ ligar
passo "Montando e ligando o Radar (a primeira vez demora alguns minutos)"
$SUDO docker compose up -d --build

passo "Esperando o Radar responder"
ok=0
for _ in $(seq 1 60); do
  if $SUDO docker compose exec -T radar node -e \
    "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 5
done
(( ok )) || erro "o Radar não respondeu em 5 min. Veja: sudo docker compose -f $PASTA/docker-compose.yml logs radar"
echo "ok (o servidor do Radar está de pé)"

HTTPS_OK=0
if (( ESPERAR_HTTPS )); then
  passo "Conferindo https://$DOMINIO (certificado automático)"
  for _ in $(seq 1 24); do
    if curl -fsS --max-time 10 "https://$DOMINIO/api/health" >/dev/null 2>&1; then
      HTTPS_OK=1
      break
    fi
    sleep 5
  done
fi

echo
echo "================================================================================"
if (( HTTPS_OK )); then
  echo " Pronto! Abra no navegador:  https://$DOMINIO"
else
  echo " O Radar está ligado, mas https://$DOMINIO ainda não respondeu daqui."
  echo " Confira: (1) o domínio aponta para o IP deste servidor; (2) as portas 80 e 443"
  echo " estão liberadas no painel da Oracle (guia, passo 4). O certificado sai sozinho"
  echo " assim que isso estiver certo. Logs: sudo docker compose -f $PASTA/docker-compose.yml logs caddy"
fi
echo
echo " CÓDIGO DE INSTALAÇÃO (pedido só na criação da PRIMEIRA conta):  $CODIGO"
echo " Guarde em lugar seguro até criar a sua conta. Ele também fica em $ENV_FILE."
echo
echo " Atualizar no futuro:  sudo bash $PASTA/deploy/atualizar.sh"
echo "================================================================================"
