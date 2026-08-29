const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS product_images;
  DROP TABLE IF EXISTS products;
  DROP TABLE IF EXISTS categories;
  DROP TABLE IF EXISTS games;
  DROP TABLE IF EXISTS sales_feed;
  DROP TABLE IF EXISTS users;

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    rating REAL NOT NULL DEFAULT 5.0,
    deals_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL
  );

  -- Каталог игр: русское и английское название + синонимы для поиска/автодополнения
  -- (aliases — через запятую, в нижнем регистре: сокращения, транслит, варианты написания).
  CREATE TABLE games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name_ru TEXT NOT NULL,
    name_en TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '🎮',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    game_id INTEGER NOT NULL REFERENCES games(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    rarity TEXT NOT NULL, -- common, rare, epic, legendary
    image_seed TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 1,
    -- Только для категории "Аккаунты": количество предметов/скинов на аккаунте
    -- и через запятую 2-3 приметных названия, по которым покупатель узнаёт аккаунт.
    items_count INTEGER,
    notable_items TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- До 4 фото на объявление, отображаются в порядке position (0 = обложка).
  CREATE TABLE product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    filename TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    product_title TEXT NOT NULL,
    price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sales_feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_title TEXT NOT NULL,
    buyer_name TEXT NOT NULL,
    price REAL NOT NULL,
    minutes_ago INTEGER NOT NULL
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    sender_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    was_filtered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Пользователи ---
// Демо-пароль для всех сид-аккаунтов (продавцов и демо-покупателя): "password123"
const demoHash = bcrypt.hashSync('password123', 10);

const insertUser = db.prepare(`
  INSERT INTO users (username, password_hash, display_name, rating, deals_count)
  VALUES (@username, @password_hash, @display_name, @rating, @deals_count)
`);

const sellerAccounts = [
  { username: 'shadowtrade', display_name: 'ShadowTrade' },
  { username: 'vega_market', display_name: 'Vega_Market' },
  { username: 'progoods', display_name: 'ProGoods' },
  { username: 'nightseller', display_name: 'NightSeller' },
  { username: 'arenadeals', display_name: 'ArenaDeals' },
];

const userIds = {};
for (const s of sellerAccounts) {
  const info = insertUser.run({
    username: s.username,
    password_hash: demoHash,
    display_name: s.display_name,
    rating: +(4 + Math.random()).toFixed(1),
    deals_count: Math.floor(50 + Math.random() * 900),
  });
  userIds[s.username] = info.lastInsertRowid;
}

// Демо-аккаунт покупателя, чтобы сразу было что показать в профиле.
// Логин: demo / Пароль: password123
const demoBuyerInfo = insertUser.run({
  username: 'demo',
  password_hash: demoHash,
  display_name: 'Demo',
  rating: 5.0,
  deals_count: 0,
});
const demoBuyerId = demoBuyerInfo.lastInsertRowid;

// --- Категории ---
// "Донат" = пополнение внутриигровой валюты (привычный термин в СНГ), "Подарки" —
// подарочные карты/наборы, "Прочее" — всё, что не попадает в основные разделы.
const categories = [
  { name: 'Аккаунты', slug: 'accounts', icon: '🗝️' },
  { name: 'Донат', slug: 'currency', icon: '💰' },
  { name: 'Скины и предметы', slug: 'items', icon: '🎨' },
  { name: 'Прокачка и бустинг', slug: 'boosting', icon: '⚡' },
  { name: 'Ключи и подписки', slug: 'keys', icon: '🎟️' },
  { name: 'Подарки', slug: 'gifts', icon: '🎁' },
  { name: 'Прочее', slug: 'other', icon: '✨' },
];

const insertCategory = db.prepare('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)');
const categoryIds = {};
for (const c of categories) {
  const info = insertCategory.run(c.name, c.slug, c.icon);
  categoryIds[c.slug] = info.lastInsertRowid;
}

// --- Игры ---
// Реальные популярные игры. aliases — то, что должно находиться поиском
// (сокращения, транслит, варианты написания на русском и английском).
const gameDefs = [
  { slug: 'fortnite', name_ru: 'Фортнайт', name_en: 'Fortnite', icon: '🪂', aliases: 'фортнайт, форт, фн, fortnite, fort' },
  { slug: 'cs2', name_ru: 'Counter-Strike 2', name_en: 'Counter-Strike 2', icon: '🔫', aliases: 'кс2, кс 2, кс, контра, cs2, cs 2, counter strike, counter-strike' },
  { slug: 'brawl-stars', name_ru: 'Бравл Старс', name_en: 'Brawl Stars', icon: '⭐', aliases: 'бравл старс, бравл, бс, br, brawl stars, brawl' },
  { slug: 'roblox', name_ru: 'Роблокс', name_en: 'Roblox', icon: '🧱', aliases: 'роблокс, рблх, roblox' },
  { slug: 'steam', name_ru: 'Стим', name_en: 'Steam', icon: '🎮', aliases: 'стим, steam' },
  { slug: 'minecraft', name_ru: 'Майнкрафт', name_en: 'Minecraft', icon: '⛏️', aliases: 'майнкрафт, мк, mc, minecraft' },
  { slug: 'gta-v', name_ru: 'ГТА 5', name_en: 'GTA V', icon: '🚗', aliases: 'гта, гта5, гта 5, gta, gta5, gta v, gta online' },
  { slug: 'valorant', name_ru: 'Валорант', name_en: 'Valorant', icon: '🎯', aliases: 'валорант, вал, valorant' },
  { slug: 'pubg-mobile', name_ru: 'ПАБГ Мобайл', name_en: 'PUBG Mobile', icon: '🪖', aliases: 'пабг, пубг, pubg, pubg mobile' },
  { slug: 'standoff-2', name_ru: 'Стендофф 2', name_en: 'Standoff 2', icon: '💥', aliases: 'стендофф, стендофф 2, со2, so2, standoff, standoff 2' },
  { slug: 'genshin-impact', name_ru: 'Геншин Импакт', name_en: 'Genshin Impact', icon: '⚔️', aliases: 'геншин, genshin, genshin impact' },
  { slug: 'free-fire', name_ru: 'Фри Фаер', name_en: 'Free Fire', icon: '🔥', aliases: 'фри фаер, фф, ff, free fire' },
  { slug: 'mobile-legends', name_ru: 'Мобайл Легендс', name_en: 'Mobile Legends', icon: '🛡️', aliases: 'мобайл легендс, мл, ml, mlbb, mobile legends' },
  { slug: 'dota-2', name_ru: 'Дота 2', name_en: 'Dota 2', icon: '🪓', aliases: 'дота, дота 2, dota, dota2' },
  { slug: 'apex-legends', name_ru: 'Апекс Легендс', name_en: 'Apex Legends', icon: '🚁', aliases: 'апекс, apex, apex legends' },
  { slug: 'ea-fc', name_ru: 'EA Sports FC', name_en: 'EA Sports FC', icon: '⚽', aliases: 'фифа, fifa, еа фс, ea fc, фс' },
  { slug: 'rust', name_ru: 'Раст', name_en: 'Rust', icon: '🛠️', aliases: 'раст, rust' },
  { slug: 'world-of-tanks', name_ru: 'Мир Танков', name_en: 'World of Tanks', icon: '🎖️', aliases: 'вот, wot, танки, world of tanks' },
  { slug: 'league-of-legends', name_ru: 'Лига Легенд', name_en: 'League of Legends', icon: '🏆', aliases: 'лига легенд, лол, lol, league of legends' },
  { slug: 'clash-royale', name_ru: 'Клэш Рояль', name_en: 'Clash Royale', icon: '👑', aliases: 'клэш рояль, кр, cr, clash royale' },
];

const insertGame = db.prepare(`
  INSERT INTO games (slug, name_ru, name_en, aliases, icon, sort_order)
  VALUES (@slug, @name_ru, @name_en, @aliases, @icon, @sort_order)
`);
const gameIds = {};
gameDefs.forEach((g, i) => {
  const info = insertGame.run({
    slug: g.slug,
    name_ru: g.name_ru,
    name_en: g.name_en,
    aliases: g.aliases.toLowerCase(),
    icon: g.icon,
    sort_order: i,
  });
  gameIds[g.slug] = info.lastInsertRowid;
});

// --- Товары ---
// Никакой массовой рандомной генерации: только небольшой набор реалистичных,
// вручную составленных объявлений — чтобы каталог не выглядел пустым, но и не
// был завален штампованными "подставными" карточками. Реальные объявления
// появляются через форму "Выставить товар".
const productDefs = [
  {
    game: 'fortnite', category: 'accounts', seller: 'shadowtrade', rarity: 'legendary',
    title: 'Аккаунт Fortnite с редкими скинами',
    description: 'Аккаунт с историей покупок с самого старта игры, без банов. Полный доступ после подтверждения оплаты.',
    price: 6800, stock: 1,
    items_count: 47,
    notable_items: 'Сирена, Ferrari, Джон Уик',
    photos: ['fortnite-1.png', 'fortnite-2.png', 'fortnite-3.png', 'fortnite-4.png'],
  },
  {
    game: 'fortnite', category: 'accounts', seller: 'nightseller', rarity: 'epic',
    title: 'Аккаунт Fortnite, коллекция сезонных скинов',
    description: 'Собран за несколько сезонов, все паки куплены за реальные деньги. Смена почты после покупки.',
    price: 3400, stock: 1,
    items_count: 23,
    notable_items: 'Мандо, Кальмар',
    photos: ['fortnite2-1.png', 'fortnite2-2.png'],
  },
  {
    game: 'cs2', category: 'accounts', seller: 'vega_market', rarity: 'epic',
    title: 'Аккаунт CS2, Prime, высокий Trust Factor',
    description: 'Prime-статус, чистая репутация, много наиграно часов. Смена почты и телефона после покупки.',
    price: 3200, stock: 1,
    items_count: 12,
    notable_items: 'AK-47 Аваллон, Керамбит Тигр, Перчатки Кровавая паутина',
  },
  {
    game: 'cs2', category: 'items', seller: 'nightseller', rarity: 'epic',
    title: 'Скин AK-47 «Огненный лотос»',
    description: 'Предмет передаётся через Steam Trade сразу после подтверждения сделки на площадке.',
    price: 2450, stock: 1,
  },
  {
    game: 'roblox', category: 'currency', seller: 'progoods', rarity: 'common',
    title: '800 робуксов',
    description: 'Зачисление на аккаунт в течение 15 минут после оплаты.',
    price: 590, stock: 8,
  },
  {
    game: 'brawl-stars', category: 'boosting', seller: 'arenadeals', rarity: 'rare',
    title: 'Прокачка до топ-лиги за сезон',
    description: 'Играем на вашем аккаунте до достижения топ-лиги, сохраняем прогресс, отчитываемся по ходу.',
    price: 1400, stock: 3,
  },
  {
    game: 'standoff-2', category: 'keys', seller: 'shadowtrade', rarity: 'common',
    title: 'Промокод на редкий скин оружия',
    description: 'Активация в один клик через официальное приложение, инструкция прилагается.',
    price: 250, stock: 15,
  },
  {
    game: 'gta-v', category: 'gifts', seller: 'vega_market', rarity: 'rare',
    title: 'Подарочная карта Rockstar на 1000 ₽',
    description: 'Электронный код, подходит для покупок в Rockstar Games Launcher.',
    price: 980, stock: 5,
  },
  {
    game: 'genshin-impact', category: 'other', seller: 'progoods', rarity: 'common',
    title: 'Сопровождение сложных подземелий',
    description: 'Проходим с вами сложные испытания в удобное время, голосовая связь по договорённости.',
    price: 350, stock: 4,
  },
];

const insertProduct = db.prepare(`
  INSERT INTO products (category_id, game_id, seller_id, title, description, price, rarity, image_seed, stock, items_count, notable_items)
  VALUES (@category_id, @game_id, @seller_id, @title, @description, @price, @rarity, @image_seed, @stock, @items_count, @notable_items)
`);
const insertImage = db.prepare('INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, ?)');

// Пара примеров с фото — так видно, как выглядит объявление с загруженными
// картинками, если склонировать проект и сразу его открыть. Исходники лежат
// в db/seed-images/ (в git), при сидировании копируются в public/uploads/products
// с обычным для загрузок случайным именем — по факту не отличаются от того,
// что появится, если продавец сам прикрепит фото через форму.
const SEED_IMAGES_DIR = path.join(__dirname, 'seed-images');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const allProducts = [];
let seedCounter = 1;
for (const def of productDefs) {
  const row = {
    category_id: categoryIds[def.category],
    game_id: gameIds[def.game],
    seller_id: userIds[def.seller],
    title: def.title,
    description: def.description,
    price: def.price,
    rarity: def.rarity,
    image_seed: `gearvault-${seedCounter++}`,
    stock: def.stock,
    items_count: def.items_count || null,
    notable_items: def.notable_items || null,
  };
  const info = insertProduct.run(row);
  allProducts.push({ id: info.lastInsertRowid, ...row });

  (def.photos || []).forEach((sourceName, position) => {
    const ext = path.extname(sourceName);
    const destName = crypto.randomBytes(16).toString('hex') + ext;
    fs.copyFileSync(path.join(SEED_IMAGES_DIR, sourceName), path.join(UPLOADS_DIR, destName));
    insertImage.run(info.lastInsertRowid, destName, position);
  });
}

// --- Лента продаж (демо-активность, не привязана к реальным заказам) ---
const insertSale = db.prepare('INSERT INTO sales_feed (product_title, buyer_name, price, minutes_ago) VALUES (?, ?, ?, ?)');
const feedBuyers = ['Игрок_92', 'Kirasky', 'DemonHunter', 'lite_user', 'Marina_K', 'Артём', 'NoScope'];
const feedTitles = [
  'Аккаунт с редкими скинами', '800 робуксов', 'Ключ активации игры', 'Скин AK-47',
  'Подарочная карта на 1000 ₽', 'Прокачка до топ-ранга', '1200 кристаллов', 'Подписка Pass на 30 дней',
];
for (let i = 0; i < 12; i++) {
  insertSale.run(
    feedTitles[Math.floor(Math.random() * feedTitles.length)],
    feedBuyers[Math.floor(Math.random() * feedBuyers.length)],
    Math.round(150 + Math.random() * 3000),
    Math.floor(1 + Math.random() * 58)
  );
}

// --- Пара реальных заказов для демо-аккаунта, чтобы профиль не был пустым ---
const insertOrder = db.prepare(`
  INSERT INTO orders (product_id, buyer_id, seller_id, product_title, price, created_at)
  VALUES (@product_id, @buyer_id, @seller_id, @product_title, @price, datetime('now', @offset))
`);

const samplePurchases = allProducts.slice(2, 4);
for (const p of samplePurchases) {
  insertOrder.run({
    product_id: p.id,
    buyer_id: demoBuyerId,
    seller_id: p.seller_id,
    product_title: p.title,
    price: p.price,
    offset: `-${Math.floor(1 + Math.random() * 5)} days`,
  });
}

console.log('[GearVault] База данных создана и заполнена тестовыми данными:', dbPath);
console.log('[GearVault] Демо-аккаунт для входа: demo / password123');
db.close();
