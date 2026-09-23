@echo off
rem Запуск GearVault на Windows двойным щелчком.
rem Сам проверяет Node.js, при первом запуске ставит зависимости,
rem создаёт .env и открывает сайт в браузере.
chcp 65001 >nul
title GearVault
cd /d "%~dp0"

if not exist "package.json" (
  echo.
  echo  Похоже, архив не распакован: файлы проекта не найдены рядом с start.bat.
  echo  Нажмите на архив правой кнопкой мыши - "Извлечь все...",
  echo  откройте распакованную папку и запустите start.bat уже оттуда.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Не найден Node.js. Сейчас откроется сайт nodejs.org:
  echo  скачайте версию LTS, установите её и запустите start.bat снова.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo.
  echo  Установлен слишком старый Node.js. Нужна версия 22.13 или новее.
  echo  Скачайте LTS с nodejs.org, установите и запустите start.bat снова.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\express\" (
  echo.
  echo  Первый запуск: устанавливаю нужные библиотеки, это займёт 1-2 минуты...
  echo  Жёлтые строки "npm warn" - это не ошибки, на них можно не обращать внимания.
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Не удалось установить библиотеки. Проверьте интернет и запустите start.bat снова.
    echo  Если не поможет - пришлите скриншот этого окна.
    echo.
    pause
    exit /b 1
  )
)

if not exist ".env" copy ".env.example" ".env" >nul

echo.
echo  ===========================================================
echo   Сайт запускается. Через пару секунд откроется браузер:
echo   http://localhost:3000
echo.
echo   Демо-вход: demo@example.com / password123
echo   Чтобы остановить сайт - просто закройте это окно.
echo.
echo   С iPhone/телефона в том же Wi-Fi: адрес появится ниже,
echo   после строки "С телефона ... откройте в браузере".
echo   Если Windows спросит про брандмауэр - нажмите "Разрешить".
echo  ===========================================================
echo.

start "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
call npm start

echo.
echo  Сайт остановился. Если выше есть красный текст - пришлите скриншот этого окна.
pause
