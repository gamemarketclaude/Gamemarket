// Понятное сообщение вместо непонятной ошибки, если Node.js слишком старый:
// встроенная база node:sqlite появилась только в Node.js 22.13.
{
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    console.error(`\n[GearVault] Нужен Node.js версии 22.13 или новее, а установлен ${process.versions.node}.`);
    console.error('[GearVault] Скачайте LTS-версию с https://nodejs.org, установите и запустите сайт снова.\n');
    process.exit(1);
  }
}

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const db = require('./db');
const SqliteSessionStore = require('./lib/sqliteSessionStore');
const { checkMessage, checkConversation, checkPhoneSplitting, hasSuspiciousDigitRun } = require('./lib/messageFilter');
const { reviewPossiblePhoneSplit } = require('./lib/aiModeration');
const { isValidEmail, normalizeEmail } = require('./lib/email');
const listingFields = require('./lib/listingFields');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const RARITY_LABELS = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' };
const REMEMBER_ME_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней
const CSRF_COOKIE = 'gv.csrf';
const MAX_PRODUCT_IMAGES = 10;

// Администраторы — почты через запятую в ADMIN_EMAILS (.env). Им доступна
// страница /admin/users с баном по почте. Пусто = админки нет ни у кого.
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean).map(normalizeEmail)
);

// ---------- Загрузка фото товара ----------
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads', 'products');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    // Имя файла — случайное (никогда не из пользовательского ввода), расширение
    // берём из проверенного MIME-типа, а не из исходного имени файла.
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + ALLOWED_IMAGE_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_PRODUCT_IMAGES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      return cb(new Error('UNSUPPORTED_IMAGE_TYPE'));
    }
    cb(null, true);
  },
});

app.set('view engine', 'ejs');
// Склонение по числу: plural(5, 'предложение', 'предложения', 'предложений')
app.locals.plural = (n, one, few, many) => {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
};
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // корректно определять https за прокси хостинга (для secure-cookie)

// Скрываем подробности стека/движка от клиента и внешних сканеров
app.disable('x-powered-by');

// Базовые security-заголовки (CSP, X-Frame-Options, X-Content-Type-Options и т.п.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      // helmet по умолчанию добавляет upgrade-insecure-requests: браузер
      // переписывает адреса стилей/скриптов на https://. Когда сайт открыт
      // по http (с телефона по адресу компьютера в Wi-Fi или на сервере без
      // SSL), https там нет — и страница остаётся без оформления и JS.
      // Все ресурсы у нас относительные, поэтому на HTTPS-сайте они и так
      // грузятся по https, эта директива не нужна.
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: по умолчанию НЕ разрешаем ни один сторонний источник. Если фронтенд
// когда-нибудь будет обращаться к этому серверу с другого домена, укажите
// его явно через ALLOWED_ORIGIN — иначе кросс-доменные запросы браузер заблокирует.
const allowedOrigin = process.env.ALLOWED_ORIGIN || false;
app.use(cors({ origin: allowedOrigin, credentials: true }));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    throw new Error('SESSION_SECRET не задан. Укажите его в переменных окружения перед запуском в production.');
  }
  console.warn('[gearvault] SESSION_SECRET не задан — сгенерирован временный секрет только для этого запуска (сессии не переживут перезапуск сервера). Задайте SESSION_SECRET в .env для постоянных сессий.');
  sessionSecret = crypto.randomBytes(32).toString('hex');
}

app.use(session({
  store: new SqliteSessionStore(db),
  name: 'gv.sid',
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    // maxAge не задан по умолчанию: обычная кука сессии (живёт до закрытия браузера).
    // Продлевается до 30 дней при входе с отметкой "Запомнить меня".
  },
}));

// ---------- CSRF (double-submit cookie) ----------
// Не завязано на express-session, поэтому работает и для форм входа/регистрации,
// которые отправляются ещё до появления сессии у пользователя.
app.use((req, res, next) => {
  let token = req.cookies[CSRF_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
  }
  res.locals.csrfToken = token;
  next();
});

function verifyCsrf(req, res, next) {
  const cookieToken = req.cookies[CSRF_COOKIE];
  const sentToken = req.body ? req.body._csrf : null;
  const cookieBuf = Buffer.from(String(cookieToken || ''));
  const sentBuf = Buffer.from(String(sentToken || ''));
  const valid = cookieToken && sentToken
    && cookieBuf.length === sentBuf.length
    && crypto.timingSafeEqual(cookieBuf, sentBuf);
  if (!valid) {
    return res.status(403).send('Запрос отклонён: недействительный или истёкший CSRF-токен. Обновите страницу и попробуйте снова.');
  }
  next();
}

// ---------- Rate limiting ----------
// Отдельные лимитеры для входа и регистрации, чтобы подбор пароля к одному
// аккаунту не расходовал лимит для регистрации новых, и наоборот.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const next = (req.body && typeof req.body.next === 'string' && req.body.next.startsWith('/') && !req.body.next.startsWith('//')) ? req.body.next : '/profile';
    res.status(429).render('login', {
      categories: getCategories(),
      error: 'Слишком много попыток входа. Подождите несколько минут и попробуйте снова.',
      next,
      email: '',
    });
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('register', {
      categories: getCategories(),
      error: 'Слишком много регистраций с вашего адреса. Попробуйте позже.',
      formValues: {},
    });
  },
});

// Отдельный лимитер для чата: этот эндпоинт может вызывать платный запрос
// к Anthropic API, поэтому ограничиваем его строже, чем обычные действия.
const messageLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.redirect(429, `/product/${req.params.id}?chatError=` + encodeURIComponent('Слишком много сообщений подряд. Подождите немного.') + '#chat');
  },
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Строка поиска из query: только строка (не массив), обрезанная по длине
function queryString(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

// Приводим к тому же виду, что и lower_ru() в базе: нижний регистр, ё -> е
function normalizeSearch(text) {
  return text.toLowerCase().replace(/ё/g, 'е');
}

// Слова запроса для поиска «все слова в любом порядке» (не больше 8, чтобы
// не раздувать SQL-запрос). % и _ внутри слова экранировать не нужно — они
// просто расширят совпадение, на безопасность это не влияет (параметры).
function searchWords(text) {
  return normalizeSearch(text).split(/[\s,;]+/).filter(Boolean).slice(0, 8);
}

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Забанен ли пользователь: либо помечен сам, либо его почта в чёрном списке
const USER_BANNED_SQL = `(u.is_banned = 1 OR EXISTS (SELECT 1 FROM banned_emails b WHERE b.email_normalized = u.email_normalized))`;

function isEmailBanned(emailNormalized) {
  return !!db.prepare('SELECT 1 FROM banned_emails WHERE email_normalized = ?').get(emailNormalized);
}

// Подгружаем текущего пользователя во все шаблоны. Если пользователя забанили,
// пока он был на сайте, — сессия сразу перестаёт действовать.
app.use((req, res, next) => {
  res.locals.currentUser = null;
  if (!req.session.userId) return next();

  const user = db.prepare(`
    SELECT u.id, u.email, u.email_normalized, u.display_name, u.rating, u.deals_count, ${USER_BANNED_SQL} AS banned
    FROM users u WHERE u.id = ?
  `).get(req.session.userId);

  if (!user || user.banned) {
    delete req.session.userId;
    return next();
  }
  user.isAdmin = ADMIN_EMAILS.has(user.email_normalized);
  res.locals.currentUser = user;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireAdmin(req, res, next) {
  // Для не-админов страницы админки как будто не существует
  if (!res.locals.currentUser || !res.locals.currentUser.isAdmin) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }
  next();
}

// Журнал заблокированных сообщений — админ видит, кто пытается обойти площадку
function logModeration(userId, productId, source, text, code) {
  try {
    db.prepare('INSERT INTO moderation_log (user_id, product_id, source, body, code) VALUES (?, ?, ?, ?, ?)')
      .run(userId || null, productId || null, source, String(text).slice(0, 500), String(code).slice(0, 40));
  } catch (err) {
    console.error('[gearvault] Не удалось записать в журнал модерации:', err.message);
  }
}

function getCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY id').all();
}

function getSalesFeed() {
  return db.prepare('SELECT * FROM sales_feed ORDER BY minutes_ago ASC LIMIT 10').all();
}

function getGames() {
  return db.prepare('SELECT * FROM games ORDER BY sort_order').all();
}

function getGameBySlug(slug) {
  return db.prepare('SELECT * FROM games WHERE slug = ?').get(slug);
}

function getProductImages(productId) {
  return db.prepare('SELECT filename FROM product_images WHERE product_id = ? ORDER BY position ASC').all(productId).map((r) => r.filename);
}

// Догружает все фото пачкой для списка карточек (каталог/страница игры/похожие
// товары/мои объявления), чтобы можно было листать фото прямо на карточке —
// один запрос на всю страницу вместо запроса на каждую карточку отдельно.
function attachImages(products) {
  if (!products.length) return products;
  const ids = products.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT product_id, filename FROM product_images WHERE product_id IN (${placeholders}) ORDER BY position ASC`).all(...ids);
  const byProduct = {};
  rows.forEach((r) => {
    (byProduct[r.product_id] = byProduct[r.product_id] || []).push(r.filename);
  });
  products.forEach((p) => { p.images = byProduct[p.id] || []; });
  return products;
}

function establishSession(req, userId, remember) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      if (remember) {
        req.session.cookie.maxAge = REMEMBER_ME_MS;
      }
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

const SELLER_JOIN = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.icon AS category_icon,
         g.slug AS game_slug, g.name_ru AS game_name_ru, g.name_en AS game_name_en, g.icon AS game_icon,
         u.display_name AS seller_name,
         u.rating AS seller_rating, u.deals_count AS seller_deals
  FROM products p
  JOIN categories c ON p.category_id = c.id
  JOIN games g ON p.game_id = g.id
  JOIN users u ON p.seller_id = u.id AND NOT ${USER_BANNED_SQL}
`;

// ---------- Каталог ----------
app.get('/', (req, res) => {
  const { category, sort, min, max, items_min, items_max } = req.query;
  const q = queryString(req.query.q);
  const titleQuery = queryString(req.query.title);
  const descQuery = queryString(req.query.desc);

  let query = SELLER_JOIN + ' WHERE 1=1';
  const params = [];

  if (category) {
    query += ' AND c.slug = ?';
    params.push(String(category));
  }
  if (q) {
    // Общий поиск из шапки: название товара, приметные скины, игра (RU/EN/синонимы)
    query += ' AND (lower_ru(p.title) LIKE ? OR lower_ru(p.notable_items) LIKE ? OR lower_ru(g.name_ru) LIKE ? OR lower_ru(g.name_en) LIKE ? OR g.aliases LIKE ?)';
    const like = `%${normalizeSearch(q)}%`;
    params.push(like, like, like, like, like);
  }
  // Поиск по названию и поиск по описанию — отдельные строки. Запрос делится
  // на слова, и каждое слово должно найтись (в любом порядке и месте текста):
  // «сирена fer» найдёт аккаунт, где есть и «Сирена», и «Ferrari».
  for (const word of searchWords(titleQuery)) {
    query += ' AND lower_ru(p.title) LIKE ?';
    params.push(`%${word}%`);
  }
  for (const word of searchWords(descQuery)) {
    // В «описание» входит и список приметных скинов/предметов аккаунта
    query += " AND (lower_ru(p.description) LIKE ? OR lower_ru(COALESCE(p.notable_items, '')) LIKE ?)";
    params.push(`%${word}%`, `%${word}%`);
  }
  if (min && !Number.isNaN(Number(min))) {
    query += ' AND p.price >= ?';
    params.push(Number(min));
  }
  if (max && !Number.isNaN(Number(max))) {
    query += ' AND p.price <= ?';
    params.push(Number(max));
  }
  if (items_min && !Number.isNaN(Number(items_min))) {
    query += ' AND p.items_count >= ?';
    params.push(Number(items_min));
  }
  if (items_max && !Number.isNaN(Number(items_max))) {
    query += ' AND p.items_count <= ?';
    params.push(Number(items_max));
  }

  const sortMap = {
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
    rating: 'u.rating DESC',
    newest: 'p.created_at DESC',
  };
  query += ' ORDER BY ' + (sortMap[sort] || 'p.created_at DESC');

  const products = attachImages(db.prepare(query).all(...params));

  res.render('catalog', {
    products,
    categories: getCategories(),
    games: getGames(),
    salesFeed: getSalesFeed(),
    activeCategory: category || '',
    activeSort: sort || '',
    q: q || '',
    min: min || '',
    max: max || '',
    itemsMin: items_min || '',
    itemsMax: items_max || '',
    titleQuery,
    descQuery,
    productCount: products.length,
  });
});

// ---------- Автодополнение поиска по играм (RU/EN/синонимы) ----------
// Фильтруем и ранжируем на JS-стороне: toLowerCase() в JS корректно
// работает с кириллицей (в отличие от SQLite LIKE/lower() для не-ASCII),
// а игр в каталоге мало — тянуть их все и сравнивать в памяти дёшево.
app.get('/api/games/suggest', (req, res) => {
  const raw = (req.query.q || '').toString().trim().toLowerCase().slice(0, 60);
  if (!raw) return res.json([]);

  const matches = getGames()
    .map((g) => {
      const nameRu = g.name_ru.toLowerCase();
      const nameEn = g.name_en.toLowerCase();
      const aliasList = g.aliases.split(',').map((a) => a.trim()).filter(Boolean);

      let rank;
      if (nameRu.startsWith(raw) || nameEn.startsWith(raw)) rank = 0;
      else if (aliasList.some((a) => a.startsWith(raw))) rank = 1;
      else if (nameRu.includes(raw) || nameEn.includes(raw) || aliasList.some((a) => a.includes(raw))) rank = 2;
      else return null;

      return { id: g.id, slug: g.slug, name_ru: g.name_ru, name_en: g.name_en, icon: g.icon, rank, sort_order: g.sort_order };
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.sort_order - b.sort_order)
    .slice(0, 8)
    .map(({ id, slug, name_ru, name_en, icon }) => ({ id, slug, name_ru, name_en, icon }));

  res.set('Cache-Control', 'no-store');
  res.json(matches);
});

// ---------- Страница отдельной игры ----------
app.get('/game/:slug', (req, res) => {
  const game = getGameBySlug(req.params.slug);
  if (!game) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }

  const categories = getCategories();
  const section = categories.find((c) => c.slug === req.query.section) ? req.query.section : '';
  const sort = req.query.sort || '';

  let query = SELLER_JOIN + ' WHERE p.game_id = ?';
  const params = [game.id];
  if (section) {
    query += ' AND c.slug = ?';
    params.push(section);
  }

  // Фильтры по характеристикам — только поля из описания раздела (allow-list),
  // путь в JSON передаётся параметром, а не склейкой строки.
  const filterFields = section ? listingFields.filterFieldsFor(game.slug, section) : [];
  const activeFilters = {};
  for (const f of filterFields) {
    const raw = req.query[`f_${f.key}`];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = raw.trim();
    const path = `$.${f.key}`;
    if (f.type === 'select' && f.options.includes(value)) {
      query += ' AND json_extract(p.attributes, ?) = ?';
      params.push(path, value);
      activeFilters[f.key] = value;
    } else if (f.type === 'bool' && value === '1') {
      query += ' AND json_extract(p.attributes, ?) = 1';
      params.push(path);
      activeFilters[f.key] = '1';
    } else if (f.type === 'number' && Number.isFinite(Number(value))) {
      query += ' AND json_extract(p.attributes, ?) >= ?';
      params.push(path, Number(value));
      activeFilters[f.key] = value;
    }
  }
  if (section === 'accounts') {
    const itemsMin = Number(req.query.items_min);
    if (req.query.items_min && Number.isFinite(itemsMin)) {
      query += ' AND p.items_count >= ?';
      params.push(itemsMin);
      activeFilters.items_min = String(itemsMin);
    }
  }

  const sortMap = {
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
    rating: 'u.rating DESC',
    newest: 'p.created_at DESC',
  };
  query += ' ORDER BY ' + (sortMap[sort] || 'p.created_at DESC');

  const products = attachImages(db.prepare(query).all(...params));

  res.render('game', {
    game,
    categories,
    products,
    activeSection: section,
    activeSort: sort,
    productCount: products.length,
    filterFields,
    activeFilters,
  });
});

// ---------- Выставление товара на продажу ----------
function cleanupUploadedFiles(files) {
  (files || []).forEach((f) => fs.unlink(f.path, () => {}));
}

// Оборачиваем multer, чтобы его ошибки (не та картинка, слишком большой файл,
// слишком много файлов) превращались в обычную ошибку формы, а не в 500-ю.
function handleProductUpload(req, res, next) {
  upload.array('images', MAX_PRODUCT_IMAGES)(req, res, (err) => {
    if (err) {
      let message = 'Не удалось загрузить фото. Попробуйте другой файл.';
      if (err.code === 'LIMIT_FILE_SIZE') message = 'Каждое фото должно быть не больше 5 МБ.';
      else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') message = `Можно загрузить не больше ${MAX_PRODUCT_IMAGES} фото.`;
      else if (err.message === 'UNSUPPORTED_IMAGE_TYPE') message = 'Поддерживаются только изображения JPG, PNG и WEBP.';
      cleanupUploadedFiles(req.files);
      req.uploadError = message;
    }
    next();
  });
}

app.get('/sell', requireAuth, (req, res) => {
  const preselectedGame = req.query.game ? getGameBySlug(req.query.game) : null;
  const categories = getCategories();
  const preselectedCategory = categories.find((c) => c.slug === req.query.category);

  res.render('sell', {
    categories,
    rarities: RARITIES,
    rarityLabels: RARITY_LABELS,
    maxImages: MAX_PRODUCT_IMAGES,
    error: null,
    formValues: preselectedCategory ? { category: preselectedCategory.slug } : {},
    selectedGame: preselectedGame,
    fieldsConfig: listingFields.clientConfig(),
  });
});

app.post('/sell', requireAuth, handleProductUpload, verifyCsrf, (req, res) => {
  const categories = getCategories();
  const selectedGame = req.body.game_id ? db.prepare('SELECT * FROM games WHERE id = ?').get(Number(req.body.game_id)) : null;

  const fail = (message) => {
    cleanupUploadedFiles(req.files);
    return res.status(400).render('sell', {
      categories,
      rarities: RARITIES,
      rarityLabels: RARITY_LABELS,
      maxImages: MAX_PRODUCT_IMAGES,
      error: message,
      formValues: req.body,
      selectedGame,
      fieldsConfig: listingFields.clientConfig(),
    });
  };

  if (req.uploadError) return fail(req.uploadError);

  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const categorySlug = (req.body.category || '').trim();
  const rarity = RARITIES.includes(req.body.rarity) ? req.body.rarity : 'common';
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);

  if (!selectedGame) return fail('Выберите игру из списка подсказок');
  if (!title || title.length > 120) return fail('Укажите название товара (до 120 символов)');
  if (!description || description.length > 2000) return fail('Добавьте описание товара (до 2000 символов)');

  const category = categories.find((c) => c.slug === categorySlug);
  if (!category) return fail('Выберите категорию из списка');

  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return fail('Укажите корректную цену');
  if (!Number.isInteger(stock) || stock < 1 || stock > 9999) return fail('Укажите корректное количество (целое число от 1)');

  // Скины/предметы на аккаунте: поля есть только в разделе «Аккаунты»;
  // обязательны там, где аккаунт узнают по скинам (Fortnite), в остальных
  // играх — по желанию продавца.
  let itemsCount = null;
  let notableItems = null;
  if (category.slug === 'accounts') {
    const required = listingFields.skinsRequired(selectedGame.slug, category.slug);
    const rawCount = String(req.body.items_count || '').trim();
    if (rawCount || required) {
      itemsCount = Number(rawCount);
      if (!Number.isInteger(itemsCount) || itemsCount < 1 || itemsCount > 9999) {
        return fail('Укажите количество скинов/предметов на аккаунте (целое число от 1 до 9999)');
      }
    }
    const rawItems = String(req.body.notable_items || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (required && rawItems.length < 2) {
      return fail('Для аккаунтов Fortnite укажите минимум 2 приметных скина через запятую — по ним покупатель узнаёт аккаунт');
    }
    if (rawItems.length > 12 || rawItems.some((x) => x.length > 60)) {
      return fail('До 12 названий, каждое не длиннее 60 символов');
    }
    notableItems = rawItems.length ? rawItems.join(', ') : null;
  }

  // Характеристики игры/раздела — только ключи из описания (allow-list)
  const { values: attributes, error: attrError } = listingFields.parseAttributes(req.body, selectedGame.slug, category.slug);
  if (attrError) return fail(attrError);

  // Контакты и сторонние площадки нельзя прятать в текст объявления
  const textsToCheck = [title, description, notableItems || '', ...Object.values(attributes).filter((v) => typeof v === 'string')];
  for (const t of textsToCheck) {
    const verdict = t ? checkMessage(t) : { blocked: false };
    if (verdict.blocked) {
      logModeration(req.session.userId, null, 'listing', t, verdict.code || 'blocked');
      return fail('В объявлении нельзя указывать контакты и сторонние площадки: ' + verdict.reason);
    }
  }

  const imageSeed = crypto.randomBytes(6).toString('hex');

  const info = db.prepare(`
    INSERT INTO products (category_id, game_id, seller_id, title, description, price, rarity, image_seed, stock, items_count, notable_items, attributes)
    VALUES (@category_id, @game_id, @seller_id, @title, @description, @price, @rarity, @image_seed, @stock, @items_count, @notable_items, @attributes)
  `).run({
    category_id: category.id,
    game_id: selectedGame.id,
    seller_id: req.session.userId,
    title,
    description,
    price,
    rarity,
    image_seed: imageSeed,
    stock,
    items_count: itemsCount,
    notable_items: notableItems,
    attributes: Object.keys(attributes).length ? JSON.stringify(attributes) : null,
  });

  if (req.files && req.files.length) {
    const insertImage = db.prepare('INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, ?)');
    req.files.forEach((file, i) => insertImage.run(info.lastInsertRowid, file.filename, i));
  }

  res.redirect(`/product/${info.lastInsertRowid}`);
});

// ---------- Карточка товара ----------
app.get('/product/:id', (req, res) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }
  const product = db.prepare(SELLER_JOIN + ' WHERE p.id = ?').get(productId);

  if (!product) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }

  const similar = attachImages(db.prepare(SELLER_JOIN + ' WHERE p.category_id = ? AND p.id != ? ORDER BY RANDOM() LIMIT 4')
    .all(product.category_id, product.id));

  const messages = db.prepare(`
    SELECT m.*, u.display_name AS sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.product_id = ?
    ORDER BY m.created_at ASC
  `).all(product.id);

  res.render('product', {
    product,
    attributes: listingFields.describeAttributes(product.attributes, product.game_slug, product.category_slug),
    images: getProductImages(product.id),
    similar,
    messages,
    rarityLabels: RARITY_LABELS,
    categories: getCategories(),
    error: req.query.error || null,
    chatError: req.query.chatError || null,
  });
});

// ---------- Сообщение в чате товара ----------
app.post('/product/:id/message', requireAuth, messageLimiter, verifyCsrf, asyncHandler(async (req, res) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }
  const product = db.prepare(SELLER_JOIN + ' WHERE p.id = ?').get(productId);
  if (!product) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }

  const bodyText = (req.body.body || '').trim();
  if (!bodyText || bodyText.length > 500) {
    return res.redirect(`/product/${product.id}?chatError=` + encodeURIComponent('Сообщение не может быть пустым или длиннее 500 символов') + '#chat');
  }

  const rejectMessage = (reason, code) => {
    logModeration(req.session.userId, product.id, 'chat', bodyText, code || 'blocked');
    return res.redirect(`/product/${product.id}?chatError=` + encodeURIComponent(reason) + '#chat');
  };

  // Однозначные случаи (ссылки, ники, телефоны, названия площадок и
  // мессенджеров) — блокируем сразу, без ИИ
  const singleCheck = checkMessage(bodyText);
  if (singleCheck.blocked) return rejectMessage(singleCheck.reason, singleCheck.code);

  // Последние сообщения этого же человека в этом чате (в хронологическом
  // порядке) — чтобы ловить номер или ник, который пишут по частям
  const recentBodies = db.prepare(`
    SELECT body FROM (
      SELECT id, body FROM messages
      WHERE product_id = ? AND sender_id = ? AND created_at >= datetime('now', '-10 minutes')
      ORDER BY id DESC LIMIT 8
    ) ORDER BY id ASC
  `).all(product.id, req.session.userId).map((m) => m.body);

  const conversationCheck = checkConversation(bodyText, recentBodies);
  if (conversationCheck.blocked) return rejectMessage(conversationCheck.reason, conversationCheck.code);

  // Неоднозначный случай — "похоже на номер по частям". Тут не баним сразу,
  // а отдаём на контекстную проверку ИИ, которая смотрит на смысл переписки,
  // а не просто считает цифры.
  if (hasSuspiciousDigitRun(bodyText, recentBodies)) {
    const aiVerdict = await reviewPossiblePhoneSplit({ recentBodies, newMessage: bodyText });

    if (aiVerdict) {
      if (aiVerdict.blocked) return rejectMessage(aiVerdict.reason, 'ai');
      // ИИ явно решил, что это не попытка передать контакт — пропускаем дальше
    } else {
      // ИИ недоступен (нет ключа/сбой) — используем резервную эвристику,
      // чтобы не остаться совсем без защиты
      const fallback = checkPhoneSplitting(bodyText, recentBodies);
      if (fallback.blocked) return rejectMessage(fallback.reason, 'phone_split');
    }
  }

  db.prepare(`
    INSERT INTO messages (product_id, sender_id, body) VALUES (?, ?, ?)
  `).run(product.id, req.session.userId, bodyText);

  res.redirect(`/product/${product.id}#chat`);
}));

// ---------- Покупка ----------
app.post('/product/:id/buy', requireAuth, verifyCsrf, (req, res) => {
  const productId = parsePositiveInt(req.params.id);
  if (!productId) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }
  // Через SELLER_JOIN: объявления забаненных продавцов купить нельзя
  const product = db.prepare(SELLER_JOIN + ' WHERE p.id = ?').get(productId);
  if (!product) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }
  if (product.seller_id === req.session.userId) {
    return res.redirect(`/product/${product.id}?error=` + encodeURIComponent('Нельзя купить собственный товар'));
  }
  if (product.stock < 1) {
    return res.redirect(`/product/${product.id}?error=` + encodeURIComponent('Товар закончился'));
  }

  const buyOrder = db.transaction(() => {
    const updated = db.prepare('UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0').run(product.id);
    if (updated.changes === 0) {
      throw new Error('OUT_OF_STOCK');
    }
    db.prepare(`
      INSERT INTO orders (product_id, buyer_id, seller_id, product_title, price)
      VALUES (?, ?, ?, ?, ?)
    `).run(product.id, req.session.userId, product.seller_id, product.title, product.price);
    db.prepare('UPDATE users SET deals_count = deals_count + 1 WHERE id = ?').run(product.seller_id);
  });

  try {
    buyOrder();
  } catch (err) {
    return res.redirect(`/product/${product.id}?error=` + encodeURIComponent('Товар закончился'));
  }

  res.redirect('/profile?tab=purchases');
});

// ---------- Регистрация ----------
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('register', { categories: getCategories(), error: null, formValues: {} });
});

app.post('/register', registerLimiter, verifyCsrf, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const displayName = String(req.body.display_name || '').trim();
  const password = String(req.body.password || '');
  const passwordConfirm = String(req.body.password_confirm || '');
  const remember = req.body.remember === 'on';

  const fail = (message) => res.status(400).render('register', {
    categories: getCategories(),
    error: message,
    formValues: { email, display_name: displayName },
  });

  if (!email || !password || !displayName) return fail('Заполните все поля');
  if (!isValidEmail(email)) return fail('Укажите настоящий адрес почты, например ivan@mail.ru');
  if (displayName.length > 40) return fail('Отображаемое имя: до 40 символов');
  if (password.length < 6 || password.length > 200) return fail('Пароль должен быть не короче 6 символов');
  if (password !== passwordConfirm) return fail('Пароли не совпадают');

  const emailNormalized = normalizeEmail(email);
  if (isEmailBanned(emailNormalized)) {
    return fail('Регистрация с этой почтой невозможна: адрес заблокирован администрацией площадки.');
  }
  const existing = db.prepare('SELECT id FROM users WHERE email_normalized = ?').get(emailNormalized);
  if (existing) return fail('Аккаунт с этой почтой уже зарегистрирован. Войдите или укажите другую почту.');

  const hash = await bcrypt.hash(password, 10);
  let info;
  try {
    info = db.prepare(`
      INSERT INTO users (email, email_normalized, password_hash, display_name) VALUES (?, ?, ?, ?)
    `).run(email, emailNormalized, hash, displayName);
  } catch (err) {
    // Две одновременные регистрации одной почты: вторую отсекает UNIQUE в базе
    if (String(err.message).includes('UNIQUE')) {
      return fail('Аккаунт с этой почтой уже зарегистрирован. Войдите или укажите другую почту.');
    }
    throw err;
  }

  await establishSession(req, info.lastInsertRowid, remember);
  res.redirect('/profile');
}));

// ---------- Вход ----------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('login', { categories: getCategories(), error: null, next: req.query.next || '/profile', email: '' });
});

app.post('/login', loginLimiter, verifyCsrf, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().slice(0, 254);
  const password = String(req.body.password || '');
  const remember = req.body.remember === 'on';
  // startsWith('//') отсекает protocol-relative open redirect (напр. next=//evil.example)
  const next = (typeof req.body.next === 'string' && req.body.next.startsWith('/') && !req.body.next.startsWith('//')) ? req.body.next : '/profile';
  const user = db.prepare(`SELECT u.*, ${USER_BANNED_SQL} AS banned FROM users u WHERE u.email_normalized = ?`).get(normalizeEmail(email));

  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!valid) {
    return res.status(401).render('login', { categories: getCategories(), error: 'Неверная почта или пароль', next, email });
  }
  // О бане сообщаем только после верного пароля — иначе по этому сообщению
  // посторонний мог бы проверять, какие почты зарегистрированы на площадке.
  if (user.banned) {
    return res.status(403).render('login', { categories: getCategories(), error: 'Этот аккаунт заблокирован администрацией площадки.', next, email });
  }

  await establishSession(req, user.id, remember);
  res.redirect(next);
}));

// ---------- Выход ----------
app.post('/logout', verifyCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('gv.sid');
    res.redirect('/');
  });
});

// ---------- Профиль ----------
app.get('/profile', requireAuth, (req, res) => {
  const tab = ['sales', 'listings'].includes(req.query.tab) ? req.query.tab : 'purchases';
  const userId = req.session.userId;

  const purchases = db.prepare(`
    SELECT o.*, p.image_seed, p.id AS product_id_live,
           (SELECT pi.filename FROM product_images pi WHERE pi.product_id = o.product_id ORDER BY pi.position LIMIT 1) AS cover
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.buyer_id = ?
    ORDER BY o.created_at DESC
  `).all(userId);

  const sales = db.prepare(`
    SELECT o.*, p.image_seed, u.display_name AS buyer_name,
           (SELECT pi.filename FROM product_images pi WHERE pi.product_id = o.product_id ORDER BY pi.position LIMIT 1) AS cover
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    JOIN users u ON u.id = o.buyer_id
    WHERE o.seller_id = ?
    ORDER BY o.created_at DESC
  `).all(userId);

  const myListings = attachImages(db.prepare(SELLER_JOIN + ' WHERE p.seller_id = ? ORDER BY p.created_at DESC').all(userId));

  res.render('profile', {
    categories: getCategories(),
    tab,
    purchases,
    sales,
    myListings,
    totalSpent: purchases.reduce((sum, o) => sum + o.price, 0),
    totalEarned: sales.reduce((sum, o) => sum + o.price, 0),
  });
});

// ---------- Админка: бан по почте ----------
// Доступна только почтам из ADMIN_EMAILS. Бан действует на почту (в
// каноническом виде), а не на конкретную запись: забаненный не сможет ни
// войти, ни зарегистрироваться заново тем же ящиком, его объявления
// скрываются из каталога.
app.get('/admin/users', requireAuth, requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
  let users;
  if (q) {
    const like = `%${q}%`;
    users = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.deals_count, u.created_at, ${USER_BANNED_SQL} AS banned
      FROM users u
      WHERE u.email_normalized LIKE ? OR lower_ru(u.email) LIKE ? OR lower_ru(u.display_name) LIKE ?
      ORDER BY u.created_at DESC LIMIT 200
    `).all(like, like, like);
  } else {
    users = db.prepare(`
      SELECT u.id, u.email, u.display_name, u.deals_count, u.created_at, ${USER_BANNED_SQL} AS banned
      FROM users u ORDER BY u.created_at DESC LIMIT 200
    `).all();
  }
  const bannedEmails = db.prepare('SELECT * FROM banned_emails ORDER BY created_at DESC').all();
  const moderationLog = db.prepare(`
    SELECT m.*, u.email AS user_email, u.display_name AS user_name, ${USER_BANNED_SQL} AS user_banned,
           p.title AS product_title
    FROM moderation_log m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN products p ON p.id = m.product_id
    ORDER BY m.id DESC LIMIT 100
  `).all();

  res.render('admin-users', {
    categories: getCategories(),
    users,
    bannedEmails,
    moderationLog,
    moderationLabels: {
      link: 'ссылка', site: 'сторонняя площадка', messenger: 'мессенджер', payment: 'оплата в обход',
      app: 'приложение', handle: 'ник', contact: 'контакт', phone: 'телефон', card: 'карта/реквизиты',
      email: 'почта', phone_split: 'телефон по частям', handle_split: 'ник по частям', ai: 'ИИ-модерация',
    },
    q,
    notice: typeof req.query.notice === 'string' ? req.query.notice.slice(0, 200) : null,
    error: typeof req.query.error === 'string' ? req.query.error.slice(0, 200) : null,
  });
});

app.post('/admin/ban', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const email = String(req.body.email || '').trim();
  const reason = String(req.body.reason || '').trim().slice(0, 200) || null;
  if (!isValidEmail(email)) {
    return res.redirect('/admin/users?error=' + encodeURIComponent('Некорректный адрес почты'));
  }
  const emailNormalized = normalizeEmail(email);
  if (ADMIN_EMAILS.has(emailNormalized)) {
    return res.redirect('/admin/users?error=' + encodeURIComponent('Нельзя забанить администратора (уберите его из ADMIN_EMAILS)'));
  }

  db.transaction(() => {
    db.prepare(`
      INSERT INTO banned_emails (email_normalized, reason) VALUES (?, ?)
      ON CONFLICT(email_normalized) DO UPDATE SET reason = excluded.reason
    `).run(emailNormalized, reason);
    db.prepare('UPDATE users SET is_banned = 1 WHERE email_normalized = ?').run(emailNormalized);
  })();

  res.redirect('/admin/users?notice=' + encodeURIComponent(`Почта ${emailNormalized} забанена`));
});

app.post('/admin/unban', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const emailNormalized = normalizeEmail(String(req.body.email || ''));
  db.transaction(() => {
    db.prepare('DELETE FROM banned_emails WHERE email_normalized = ?').run(emailNormalized);
    db.prepare('UPDATE users SET is_banned = 0 WHERE email_normalized = ?').run(emailNormalized);
  })();
  res.redirect('/admin/users?notice=' + encodeURIComponent(`Почта ${emailNormalized} разбанена`));
});

app.use((req, res) => {
  res.status(404).render('not-found', { categories: getCategories() });
});

// Единый обработчик ошибок: клиенту — только общее сообщение (никаких стеков
// и деталей исключения в production), полный текст — только в серверный лог.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[gearvault] Необработанная ошибка на', req.method, req.path, ':', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500);
  if (isProduction) {
    res.render('error', { categories: getCategories() });
  } else {
    res.type('text/plain').send(`Ошибка сервера: ${err && err.message ? err.message : String(err)}`);
  }
});

// Адреса этого компьютера в домашней сети — по ним сайт можно открыть
// с телефона, подключённого к тому же Wi-Fi.
function localNetworkAddresses() {
  const os = require('os');
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const server = app.listen(PORT, () => {
  console.log(`GearVault запущен: http://localhost:${PORT}`);
  if (!isProduction) {
    const addresses = localNetworkAddresses();
    if (addresses.length) {
      console.log('С телефона (он должен быть подключён к тому же Wi-Fi) откройте в браузере:');
      addresses.forEach((a) => console.log(`  http://${a}:${PORT}`));
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[GearVault] Порт ${PORT} уже занят — скорее всего, сайт (или его старая версия) уже запущен в другом окне.`);
    console.error('[GearVault] Закройте то окно (или нажмите в нём Ctrl+C) и запустите сайт снова.\n');
    process.exit(1);
  }
  throw err;
});
