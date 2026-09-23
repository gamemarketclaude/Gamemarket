#!/usr/bin/env bash
# Обновление GearVault на сервере: подтягивает новый код и перезапускает сервис.
# Запускать из /opt/gearvault от пользователя, у которого есть sudo:
#   cd /opt/gearvault && ./deploy/update.sh
set -euo pipefail

BRANCH="${1:-claude/gearvault-marketplace-04k379}"

echo "==> Обновляю код из ветки $BRANCH..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Ставлю зависимости..."
npm install --omit=dev

echo "==> Перезапускаю сервис..."
sudo systemctl restart gearvault

echo "==> Готово. Статус:"
sudo systemctl status gearvault --no-pager -l | head -15
