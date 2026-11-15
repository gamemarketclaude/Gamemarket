'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const config = require('./config');
const { pool } = require('./db');
const sec = require('./middleware/security');

const app = express();
app.disable('x-powered-by');
if (config.isProd) app.set('trust proxy', 1); // за reverse-proxy (Render/Nginx) для secure-cookie и IP в rate limit
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      // редирект на страницу оплаты после POST-формы
      formAction: ["'self'", 'https://yoomoney.ru', 'https://*.yoomoney.ru', 'https://yookassa.ru', 'https://*.yookassa.ru'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  strictTransportSecurity: config.isProd ? undefined : false,
}));
// CORS не включаем вообще: сайт не обслуживает кросс-доменные запросы.

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.get('/healthz', (req, res) => res.send('ok'));

// Машинные эндпоинты — без сессии и CSRF.
app.use(require('./routes/sub'));
app.use(require('./routes/node'));
app.use(require('./routes/payments').webhook);

// HTML-часть сайта.
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true, tableName: 'user_sessions' }),
  name: 'sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
}));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use((req, res, next) => {
  Object.assign(res.locals, { brand: config.brandName, supportUrl: config.supportUrl, user: null, flash: null, csrf: '' });
  next();
});
app.use(sec.csrf);
app.use(sec.loadUser);
app.use(sec.flash);

app.use(require('./routes/auth'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/payments').router);
app.use(require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'Не найдено', message: 'Страница не найдена.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Логируем только метод, путь и сообщение — без тела запроса и заголовков.
  console.error(`[${req.method} ${req.path}]`, err.message);
  if (res.headersSent) return;
  if (!req.accepts('html') || res.locals.brand === undefined) return res.sendStatus(500);
  res.status(500).render('error', { title: 'Ошибка', message: 'Что-то пошло не так. Попробуйте позже.' });
});

module.exports = app;
