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
const { checkMessage, checkPhoneSplitting, hasSuspiciousDigitRun } = require('./lib/messageFilter');
const { reviewPossiblePhoneSplit } = require('./lib/aiModeration');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const RARITY_LABELS = { common: 'Обычное', rare: 'Редкое', epic: 'Эпическое', legendary: 'Легендарное' };
const REMEMBER_ME_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней
const CSRF_COOKIE = 'gv.csrf';
const MAX_PRODUCT_IMAGES = 4;

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
    const next = (req.body && req.body.next && req.body.next.startsWith('/') && !req.body.next.startsWith('//')) ? req.body.next : '/profile';
    res.status(429).render('login', {
      categories: getCategories(),
      error: 'Слишком много попыток входа. Подождите несколько минут и попробуйте снова.',
      next,
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

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Подгружаем текущего пользователя во все шаблоны
app.use((req, res, next) => {
  if (req.session.userId) {
    res.locals.currentUser = db.prepare('SELECT id, username, display_name, rating, deals_count FROM users WHERE id = ?').get(req.session.userId);
  } else {
    res.locals.currentUser = null;
  }
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
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
         u.display_name AS seller_name, u.username AS seller_username,
         u.rating AS seller_rating, u.deals_count AS seller_deals,
         (SELECT filename FROM product_images WHERE product_id = p.id ORDER BY position ASC LIMIT 1) AS cover_image
  FROM products p
  JOIN categories c ON p.category_id = c.id
  JOIN games g ON p.game_id = g.id
  JOIN users u ON p.seller_id = u.id
`;

// ---------- Каталог ----------
app.get('/', (req, res) => {
  const { category, sort, q, min, max } = req.query;

  let query = SELLER_JOIN + ' WHERE 1=1';
  const params = [];

  if (category) {
    query += ' AND c.slug = ?';
    params.push(category);
  }
  if (q) {
    query += ' AND (lower_ru(p.title) LIKE ? OR lower_ru(p.notable_items) LIKE ? OR lower_ru(g.name_ru) LIKE ? OR lower_ru(g.name_en) LIKE ? OR g.aliases LIKE ?)';
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like, like, like);
  }
  if (min && !Number.isNaN(Number(min))) {
    query += ' AND p.price >= ?';
    params.push(Number(min));
  }
  if (max && !Number.isNaN(Number(max))) {
    query += ' AND p.price <= ?';
    params.push(Number(max));
  }

  const sortMap = {
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
    rating: 'u.rating DESC',
    newest: 'p.created_at DESC',
  };
  query += ' ORDER BY ' + (sortMap[sort] || 'p.created_at DESC');

  const products = db.prepare(query).all(...params);

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

  const sortMap = {
    price_asc: 'p.price ASC',
    price_desc: 'p.price DESC',
    rating: 'u.rating DESC',
    newest: 'p.created_at DESC',
  };
  query += ' ORDER BY ' + (sortMap[sort] || 'p.created_at DESC');

  const products = db.prepare(query).all(...params);

  res.render('game', {
    game,
    categories,
    products,
    activeSection: section,
    activeSort: sort,
    productCount: products.length,
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

  // Для аккаунтов покупателю важно быстро опознать товар: сколько скинов/предметов
  // и 2-3 приметных названия — это же участвует в общем поиске по сайту.
  let itemsCount = null;
  let notableItems = null;
  if (category.slug === 'accounts') {
    itemsCount = Number(req.body.items_count);
    if (!Number.isInteger(itemsCount) || itemsCount < 1 || itemsCount > 999) {
      return fail('Укажите количество предметов/скинов на аккаунте (целое число от 1 до 999)');
    }
    const rawItems = (req.body.notable_items || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (rawItems.length < 2) {
      return fail('Укажите минимум 2 приметных названия предмета/скина через запятую — по ним покупатель узнаёт аккаунт');
    }
    if (rawItems.length > 8 || rawItems.some((s) => s.length > 60)) {
      return fail('До 8 названий, каждое не длиннее 60 символов');
    }
    notableItems = rawItems.join(', ');
  }

  const imageSeed = crypto.randomBytes(6).toString('hex');

  const info = db.prepare(`
    INSERT INTO products (category_id, game_id, seller_id, title, description, price, rarity, image_seed, stock, items_count, notable_items)
    VALUES (@category_id, @game_id, @seller_id, @title, @description, @price, @rarity, @image_seed, @stock, @items_count, @notable_items)
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

  const similar = db.prepare(SELLER_JOIN + ' WHERE p.category_id = ? AND p.id != ? ORDER BY RANDOM() LIMIT 4')
    .all(product.category_id, product.id);

  const messages = db.prepare(`
    SELECT m.*, u.display_name AS sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.product_id = ?
    ORDER BY m.created_at ASC
  `).all(product.id);

  res.render('product', {
    product,
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
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) {
    return res.status(404).render('not-found', { categories: getCategories() });
  }

  const bodyText = (req.body.body || '').trim();
  if (!bodyText || bodyText.length > 500) {
    return res.redirect(`/product/${product.id}?chatError=` + encodeURIComponent('Сообщение не может быть пустым или длиннее 500 символов') + '#chat');
  }

  // Однозначные случаи (ссылки, названия площадок, мессенджеры) — блокируем сразу, без ИИ
  const singleCheck = checkMessage(bodyText);
  if (singleCheck.blocked) {
    return res.redirect(`/product/${product.id}?chatError=` + encodeURIComponent(singleCheck.reason) + '#chat');
  }

  const recentMessages = db.prepare(`
    SELECT body FROM messages
    WHERE product_id = ? AND sender_id = ? AND created_at >= datetime('now', '-10 minutes')
    ORDER BY created_at ASC
    LIMIT 6
  `).all(product.id, req.session.userId);
  const recentBodies = recentMessages.map(m => m.body);

  // Неоднозначный случай — "похоже на номер по частям". Тут не баним сразу,
  // а отдаём на контекстную проверку ИИ, которая смотрит на смысл переписки,
  // а не просто считает цифры.
  if (hasSuspiciousDigitRun(bodyText, recentBodies)) {
    const aiVerdict = await reviewPossiblePhoneSplit({ recentBodies, newMessage: bodyText });

    if (aiVerdict) {
      if (aiVerdict.blocked) {
        return res.redirect(`/product/${product.id}?chatError=` + encodeURIComponent(aiVerdict.reason) + '#chat');
      }
      // ИИ явно решил, что это не попытка передать контакт — пропускаем дальше
    } else {
      // ИИ недоступен (нет ключа/сбой) — используем резервную эвристику,
      // чтобы не остаться совсем без защиты
      const fallback = checkPhoneSplitting(bodyText, recentBodies);
      if (fallback.blocked) {
        return res.redirect(`/product/${product.id}?chatError=` + encodeURIComponent(fallback.reason) + '#chat');
      }
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
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
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
  const { username, display_name, password, password_confirm } = req.body;
  const remember = req.body.remember === 'on';

  const fail = (message) => res.status(400).render('register', {
    categories: getCategories(),
    error: message,
    formValues: { username, display_name },
  });

  if (!username || !password || !display_name) return fail('Заполните все поля');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return fail('Логин: 3–20 символов, латиница/цифры/подчёркивание');
  if (display_name.trim().length < 1 || display_name.length > 40) return fail('Отображаемое имя: до 40 символов');
  if (password.length < 6 || password.length > 200) return fail('Пароль должен быть не короче 6 символов');
  if (password !== password_confirm) return fail('Пароли не совпадают');

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
  if (existing) return fail('Такой логин уже занят');

  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)
  `).run(username.toLowerCase(), hash, display_name.trim());

  await establishSession(req, info.lastInsertRowid, remember);
  res.redirect('/profile');
}));

// ---------- Вход ----------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('login', { categories: getCategories(), error: null, next: req.query.next || '/profile' });
});

app.post('/login', loginLimiter, verifyCsrf, asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const remember = req.body.remember === 'on';
  // startsWith('//') отсекает protocol-relative open redirect (напр. next=//evil.example)
  const next = (req.body.next && req.body.next.startsWith('/') && !req.body.next.startsWith('//')) ? req.body.next : '/profile';
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').toLowerCase());

  const valid = user ? await bcrypt.compare(password || '', user.password_hash) : false;
  if (!valid) {
    return res.status(401).render('login', { categories: getCategories(), error: 'Неверный логин или пароль', next });
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
    SELECT o.*, p.image_seed, p.id AS product_id_live
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    WHERE o.buyer_id = ?
    ORDER BY o.created_at DESC
  `).all(userId);

  const sales = db.prepare(`
    SELECT o.*, p.image_seed, u.display_name AS buyer_name
    FROM orders o
    LEFT JOIN products p ON p.id = o.product_id
    JOIN users u ON u.id = o.buyer_id
    WHERE o.seller_id = ?
    ORDER BY o.created_at DESC
  `).all(userId);

  const myListings = db.prepare(SELLER_JOIN + ' WHERE p.seller_id = ? ORDER BY p.created_at DESC').all(userId);

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

app.listen(PORT, () => {
  console.log(`GearVault запущен: http://localhost:${PORT}`);
});
