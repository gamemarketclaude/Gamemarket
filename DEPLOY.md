# Деплой GearVault на свой сервер (VPS, Ubuntu 22.04)

Инструкция рассчитана на чистый сервер (Timeweb Cloud, REG.RU, Selectel и т.п.,
Ubuntu 22.04). Выполняется один раз при первом развёртывании; дальнейшие
обновления — через `deploy/update.sh` (последний шаг).

## 0. Подключение к серверу

С панели хостинга возьмите IP-адрес сервера и root-пароль, подключитесь:

```bash
ssh root@ВАШ_IP
```

## 1. Базовая настройка сервера

```bash
apt update && apt upgrade -y

# Отдельный пользователь для приложения — не работаем от root
adduser --disabled-password --gecos "" gearvault
usermod -aG sudo gearvault

# Базовый firewall: пускаем только SSH и веб-порты
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Порт 3000 (на нём слушает само Node-приложение) в firewall **не открываем** —
снаружи к сайту будут обращаться только через Nginx на 80/443, это правильнее
с точки зрения безопасности.

## 2. Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v   # должно показать v24.x (нужен 22.13+ — в нём есть встроенный SQLite)
```

## 3. Код приложения

Дальше — от пользователя `gearvault` (`su - gearvault`):

```bash
su - gearvault
sudo mkdir -p /opt/gearvault
sudo chown gearvault:gearvault /opt/gearvault
git clone -b claude/gearvault-marketplace-04k379 \
  https://github.com/gamemarketclaude/Gamemarket.git /opt/gearvault
cd /opt/gearvault
npm install --omit=dev
```

## 4. Настройка `.env`

```bash
cp .env.example .env
```

Обязательно впишите в `.env`:

- `SESSION_SECRET` — случайная строка, сгенерировать:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- `NODE_ENV=production`
- `PORT=3000` (можно оставить как есть)
- `ANTHROPIC_API_KEY` — по желанию, для ИИ-модерации чата (без него работает резервная эвристика)
- `ALLOWED_ORIGIN` — оставить пустым, если фронтенд не будет обращаться с другого домена

**Без `SESSION_SECRET` сервер в режиме production откажется запускаться** — это осознанная защита, не баг.

## 5. Первый запуск и наполнение базы

```bash
npm run seed   # создаёт database.sqlite и заполняет демо-данными
```

## 6. Автозапуск через systemd

```bash
exit   # обратно на root/sudo-пользователя
sudo cp /opt/gearvault/deploy/gearvault.service /etc/systemd/system/gearvault.service
sudo systemctl daemon-reload
sudo systemctl enable --now gearvault
sudo systemctl status gearvault
```

Если статус не `active (running)` — смотрите логи: `sudo journalctl -u gearvault -n 50`.

## 7. Nginx (публичный адрес + HTTPS)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo cp /opt/gearvault/deploy/nginx.conf /etc/nginx/sites-available/gearvault
sudo nano /etc/nginx/sites-available/gearvault   # заменить YOUR_DOMAIN_OR_IP на домен или IP

sudo ln -s /etc/nginx/sites-available/gearvault /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

Если есть домен, привязанный к этому IP — получите бесплатный SSL-сертификат:

```bash
sudo certbot --nginx -d ваш-домен.ru
```

Certbot сам допишет в конфиг Nginx блок для 443/HTTPS и настроит автопродление.
Без домена (по голому IP) сертификат Let's Encrypt не выдать — сайт будет
доступен по `http://`.

## 8. Готово

Открывайте `http://ВАШ_IP` (или `https://ваш-домен.ru`, если настроили SSL).

## Обновление в будущем

```bash
su - gearvault
cd /opt/gearvault
./deploy/update.sh
```

Скрипт сам подтянет новый код из GitHub, поставит зависимости и перезапустит
сервис. База данных (`db/database.sqlite`) при этом не трогается — все
объявления, пользователи и заказы сохраняются.

## Если что-то пошло не так

- Логи приложения: `sudo journalctl -u gearvault -n 100 -f`
- Логи Nginx: `sudo tail -f /var/log/nginx/error.log`
- Проверить, что процесс вообще слушает порт: `sudo ss -tlnp | grep 3000`
