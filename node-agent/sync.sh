#!/usr/bin/env bash
# Синхронизация клиентов Xray с сайтом. Запускается по таймеру systemd раз в минуту.
# Требует: curl, jq, xray. Настройки — в /etc/vpnhub-agent.env (chmod 600):
#   PANEL_URL=https://your-site.example
#   NODE_TOKEN=...            (выдаётся в админке один раз)
set -euo pipefail

ENV_FILE=/etc/vpnhub-agent.env
TEMPLATE=/usr/local/etc/xray/template.json
CONFIG=/usr/local/etc/xray/config.json

# shellcheck disable=SC1090
source "$ENV_FILE"
: "${PANEL_URL:?}" "${NODE_TOKEN:?}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Токен передаётся через файл заголовков, чтобы не светиться в списке процессов.
printf 'Authorization: Bearer %s\n' "$NODE_TOKEN" > "$tmp/h"
curl -fsS --max-time 20 --proto '=https' -H @"$tmp/h" "$PANEL_URL/api/node/clients" -o "$tmp/clients.json"

jq -e '.clients | type == "array"' "$tmp/clients.json" > /dev/null
jq --slurpfile c "$tmp/clients.json" \
  '(.inbounds[] | select(.tag == "vless-reality") | .settings.clients) = $c[0].clients' \
  "$TEMPLATE" > "$tmp/config.json"

if [ -f "$CONFIG" ] && cmp -s "$tmp/config.json" "$CONFIG"; then
  exit 0 # ничего не поменялось
fi

xray run -test -config "$tmp/config.json" > /dev/null
install -m 600 "$tmp/config.json" "$CONFIG"
systemctl restart xray
echo "xray: конфиг обновлён, клиентов: $(jq '.clients | length' "$tmp/clients.json")"
