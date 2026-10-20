#!/usr/bin/env bash
# Atualiza o Radar para a versão mais nova do mesmo ramo, com backup ANTES. Guia: docs/GUIA_ORACLE.md
# Uso (no servidor):  sudo bash /opt/radar/deploy/atualizar.sh
set -euo pipefail

PASTA="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PASTA"
RAMO="$(git rev-parse --abbrev-ref HEAD)"

echo "==> Backup antes de atualizar"
docker compose exec -T radar ./node_modules/.bin/tsx src/cli/backup.ts

echo "==> Baixando a versão nova ($RAMO)"
antes="$(git rev-parse --short HEAD)"
git fetch --depth 1 origin "$RAMO"
git checkout -B "$RAMO" FETCH_HEAD
depois="$(git rev-parse --short HEAD)"
if [[ "$antes" == "$depois" ]]; then
  echo "Já está na versão mais nova ($depois). Nada a fazer."
  exit 0
fi

echo "==> Montando e religando ($antes → $depois)"
docker compose up -d --build
docker image prune -f >/dev/null || true

for _ in $(seq 1 60); do
  if docker compose exec -T radar node -e \
    "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; then
    echo "Pronto: Radar atualizado para $depois."
    exit 0
  fi
  sleep 5
done
echo "O Radar não respondeu depois de atualizar. Logs: docker compose logs radar" >&2
echo "Para voltar: git checkout $antes && docker compose up -d --build (o backup está em /data/backups)" >&2
exit 1
