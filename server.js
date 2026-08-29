require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
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

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // корректно определять https за прокси хостинга (для secure-cookie)
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

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
         u.display_name AS seller_name, u.username AS seller_username,
         u.rating AS seller_rating, u.deals_count AS seller_deals
  FROM products p
  JOIN categories c ON p.category_id = c.id
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
    query += ' AND (p.title LIKE ? OR p.game_name LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
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
    salesFeed: getSalesFeed(),
    activeCategory: category || '',
    activeSort: sort || '',
    q: q || '',
    min: min || '',
    max: max || '',
    productCount: products.length,
  });
});

// ---------- Выставление товара на продажу ----------
app.get('/sell', requireAuth, (req, res) => {
  res.render('sell', {
    categories: getCategories(),
    rarities: RARITIES,
    rarityLabels: RARITY_LABELS,
    error: null,
    formValues: {},
  });
});

app.post('/sell', requireAuth, (req, res) => {
  const categories = getCategories();
  const fail = (message) => res.status(400).render('sell', {
    categories,
    rarities: RARITIES,
    rarityLabels: RARITY_LABELS,
    error: message,
    formValues: req.body,
  });

  const gameName = (req.body.game_name || '').trim();
  const title = (req.body.title || '').trim();
  const description = (req.body.description || '').trim();
  const categorySlug = (req.body.category || '').trim();
  const rarity = RARITIES.includes(req.body.rarity) ? req.body.rarity : 'common';
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);

  if (!gameName || gameName.length > 80) return fail('Укажите название игры (до 80 символов)');
  if (!title || title.length > 120) return fail('Укажите название товара (до 120 символов)');
  if (!description || description.length > 2000) return fail('Добавьте описание товара (до 2000 символов)');

  const category = categories.find((c) => c.slug === categorySlug);
  if (!category) return fail('Выберите категорию из списка');

  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) return fail('Укажите корректную цену');
  if (!Number.isInteger(stock) || stock < 1 || stock > 9999) return fail('Укажите корректное количество (целое число от 1)');

  const imageSeed = crypto.randomBytes(6).toString('hex');

  const info = db.prepare(`
    INSERT INTO products (category_id, seller_id, game_name, title, description, price, rarity, image_seed, stock)
    VALUES (@category_id, @seller_id, @game_name, @title, @description, @price, @rarity, @image_seed, @stock)
  `).run({
    category_id: category.id,
    seller_id: req.session.userId,
    game_name: gameName,
    title,
    description,
    price,
    rarity,
    image_seed: imageSeed,
    stock,
  });

  res.redirect(`/product/${info.lastInsertRowid}`);
});

// ---------- Карточка товара ----------
app.get('/product/:id', (req, res) => {
  const product = db.prepare(SELLER_JOIN + ' WHERE p.id = ?').get(req.params.id);

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
    similar,
    messages,
    rarityLabels: RARITY_LABELS,
    categories: getCategories(),
    error: req.query.error || null,
    chatError: req.query.chatError || null,
  });
});

// ---------- Сообщение в чате товара ----------
app.post('/product/:id/message', requireAuth, async (req, res) => {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
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
});

// ---------- Покупка ----------
app.post('/product/:id/buy', requireAuth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
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

app.post('/register', async (req, res) => {
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
});

// ---------- Вход ----------
app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('login', { categories: getCategories(), error: null, next: req.query.next || '/profile' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const remember = req.body.remember === 'on';
  const next = (req.body.next && req.body.next.startsWith('/')) ? req.body.next : '/profile';
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').toLowerCase());

  const valid = user ? await bcrypt.compare(password || '', user.password_hash) : false;
  if (!valid) {
    return res.status(401).render('login', { categories: getCategories(), error: 'Неверный логин или пароль', next });
  }

  await establishSession(req, user.id, remember);
  res.redirect(next);
});

// ---------- Выход ----------
app.post('/logout', (req, res) => {
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

app.listen(PORT, () => {
  console.log(`GearVault запущен: http://localhost:${PORT}`);
});
