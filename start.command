#!/bin/bash
# Запуск GearVault на Mac двойным щелчком (если macOS не даёт открыть:
# правой кнопкой по файлу - «Открыть» - «Открыть»).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Не найден Node.js. Скачайте LTS с https://nodejs.org, установите и запустите этот файл снова."
  open "https://nodejs.org/"
  read -r -p "Нажмите Enter, чтобы закрыть окно..."
  exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "Установлен слишком старый Node.js ($(node -v)). Нужна версия 22.13 или новее — скачайте LTS с https://nodejs.org."
  open "https://nodejs.org/"
  read -r -p "Нажмите Enter, чтобы закрыть окно..."
  exit 1
fi

if [ ! -d node_modules/express ]; then
  echo "Первый запуск: устанавливаю нужные библиотеки, это займёт 1-2 минуты..."
  if ! npm install --no-fund --no-audit; then
    echo "Не удалось установить библиотеки. Проверьте интернет и запустите снова."
    read -r -p "Нажмите Enter, чтобы закрыть окно..."
    exit 1
  fi
fi

[ -f .env ] || cp .env.example .env

echo
echo "Сайт запускается: http://localhost:3000"
echo "Демо-вход: demo@example.com / password123"
echo "Чтобы остановить сайт — закройте это окно."
echo
(sleep 3 && open "http://localhost:3000") &
npm start
read -r -p "Сайт остановился. Нажмите Enter, чтобы закрыть окно..."
