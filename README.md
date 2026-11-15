# VPN Hub

Сервис продажи VPN-подписок. Пользователь регистрируется, оплачивает тариф и получает **ссылку подписки**, которую вставляет в **Happ** или **v2RayTun** (подходят также Hiddify, v2rayNG, Streisand). Протокол: VLESS + Reality + Vision (Xray).

```
 Пользователь ──► Сайт (Node.js + Postgres) ◄── ЮKassa (вебхук)
      │               │  /sub/<токен>  → список vless:// для приложения
      │               │  /api/node/clients → список активных клиентов
      ▼               ▼
 Happ / v2RayTun ──► VPN-серверы (Xray) ◄── агент sync.sh раз в минуту
```

## Возможности
- Регистрация и вход (argon2id, сессии в Postgres, CSRF, rate limit).
- Личный кабинет: статус и срок подписки, ссылка, кнопки «Добавить в Happ / v2RayTun» (deep link), QR-код, перевыпуск ссылки при утечке, история платежей.
- Оплата через ЮKassa. Цена берётся из БД. Вебхук перепроверяется запросом к API ЮKassa, обработка идемпотентна, продление выполняется в транзакции с блокировкой строки.
- Ссылка подписки отдаёт заголовки, которые понимают Happ и v2RayTun: название профиля, дата окончания, интервал обновления, поддержка.
- Админка: статистика, серверы (добавить, вкл/выкл, время последней синхронизации), тарифы, пользователи (поиск, продление вручную, отключение).
- Несколько VPN-серверов. Приватный ключ Reality хранится только на сервере, сайт его не знает.

## Локальный запуск
```bash
cp .env.example .env      # заполнить DATABASE_URL, SESSION_SECRET
npm install
npm run migrate           # таблицы + 3 тарифа по умолчанию
npm start                 # http://localhost:3000
# зарегистрироваться на сайте, затем:
npm run make-admin -- you@example.com
```

## Продакшен (сайт)
Подойдёт любой хостинг с Node 20+ и Postgres (Render, Railway, VPS + Nginx).
1. Переменные окружения из `.env.example`: `NODE_ENV=production`, `PUBLIC_URL=https://…`, `SESSION_SECRET` (случайная строка).
2. `npm run migrate`, затем `npm start`. Сайт должен работать только по HTTPS за reverse-proxy.
3. ЮKassa: в разделе «Интеграция → HTTP-уведомления» указать `https://ВАШ_САЙТ/webhooks/yookassa` и включить события `payment.succeeded` и `payment.canceled`.

## Подключение VPN-сервера
На чистом VPS (Ubuntu/Debian, root):
```bash
# 1. Xray
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
apt-get install -y jq curl

# 2. Ключи Reality и short id
xray x25519            # Private key → в шаблон, Public key → в админку
openssl rand -hex 4    # short id → и в шаблон, и в админку
```
3. Скопировать `node-agent/template.json` в `/usr/local/etc/xray/template.json`. Вписать `privateKey`, `shortIds`, а в `dest` и `serverNames` — сайт для маскировки (тот же SNI, что в админке). Сделать `chmod 600`.
4. В админке нажать «Добавить сервер»: указать IP, порт 443, SNI, Public key и short id. Сайт покажет **токен один раз**.
5. На сервере:
```bash
printf 'PANEL_URL=https://ВАШ_САЙТ\nNODE_TOKEN=ТОКЕН\n' > /etc/vpnhub-agent.env && chmod 600 /etc/vpnhub-agent.env
install -m 700 node-agent/sync.sh /usr/local/bin/vpnhub-sync.sh
cp node-agent/vpnhub-agent.service node-agent/vpnhub-agent.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vpnhub-agent.timer
/usr/local/bin/vpnhub-sync.sh   # первый запуск вручную, проверить вывод
```
После этого в админке у сервера появится время синхронизации, а у пользователей с активной подпиской — новая ссылка `vless://` в приложении.

## Структура
```
src/
  server.js, app.js, config.js, db.js
  middleware/security.js   CSRF, авторизация, rate limit, flash
  routes/auth.js           регистрация / вход / выход
  routes/dashboard.js      кабинет, перевыпуск ссылки
  routes/payments.js       создание платежа ЮKassa + вебхук
  routes/sub.js            /sub/:token — подписка для Happ / v2RayTun
  routes/node.js           /api/node/clients — для агента на сервере
  routes/admin.js          админка
  services/                yookassa, xray-ссылки, продление подписки, токены
db/schema.sql
views/, public/
node-agent/                sync.sh, шаблон Xray, systemd unit + timer
```

## Ограничения MVP
- Трафик не считается (`upload/download` в подписке равны 0), лимитов по трафику нет.
- При изменении списка клиентов агент перезапускает Xray, и активные соединения на секунду рвутся. Следующий шаг — добавлять клиентов через gRPC API Xray без перезапуска.
- Нет восстановления пароля и подтверждения email.
- Нет Telegram-бота.
