const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { SCHEMA_VERSION } = require('./schema');
const { normalizeEmail } = require('../lib/email');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS product_images;
  DROP TABLE IF EXISTS products;
  DROP TABLE IF EXISTS categories;
  DROP TABLE IF EXISTS games;
  DROP TABLE IF EXISTS sales_feed;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS banned_emails;
  DROP TABLE IF EXISTS moderation_log;
  -- Сессии тоже сбрасываем: после пересоздания пользователей старая сессия
  -- могла бы указывать на чужой id
  DROP TABLE IF EXISTS sessions;

  -- Вход по почте. email — как ввёл пользователь (для показа),
  -- email_normalized — канонический вид (lib/email.js), по нему проверяется
  -- уникальность и бан: Ivan.Petrov+1@Gmail.com и ivanpetrov@gmail.com — один ящик.
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    email_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    rating REAL NOT NULL DEFAULT 5.0,
    deals_count INTEGER NOT NULL DEFAULT 0,
    is_banned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Чёрный список почт: с такой почтой нельзя ни войти, ни зарегистрироваться заново.
  -- Можно забанить и почту, на которую ещё никто не регистрировался.
  CREATE TABLE banned_emails (
    email_normalized TEXT PRIMARY KEY,
    reason TEXT,
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
    -- Характеристики, свои для игры и раздела (см. lib/listingFields.js), JSON
    attributes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- До 10 фото на объявление, отображаются в порядке position (0 = обложка).
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

  -- Заблокированные фильтром сообщения/объявления — видны админу
  CREATE TABLE moderation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    product_id INTEGER REFERENCES products(id),
    source TEXT NOT NULL,
    body TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

const insertUserStmt = db.prepare(`
  INSERT INTO users (email, email_normalized, password_hash, display_name, rating, deals_count)
  VALUES (@email, @email_normalized, @password_hash, @display_name, @rating, @deals_count)
`);
const insertUser = (u) => insertUserStmt.run({
  email: u.email,
  email_normalized: normalizeEmail(u.email),
  password_hash: u.password_hash,
  display_name: u.display_name,
  rating: u.rating,
  deals_count: u.deals_count,
});

const sellerAccounts = [
  { username: 'shadowtrade', display_name: 'ShadowTrade' },
  { username: 'vega_market', display_name: 'Vega_Market' },
  { username: 'progoods', display_name: 'ProGoods' },
  { username: 'nightseller', display_name: 'NightSeller' },
  { username: 'arenadeals', display_name: 'ArenaDeals' },
];

const userIds = {};
for (const s of sellerAccounts) {
  // Домен example.com зарезервирован под примеры — настоящих ящиков там нет
  const info = insertUser({
    email: `${s.username}@example.com`,
    password_hash: demoHash,
    display_name: s.display_name,
    rating: +(4 + Math.random()).toFixed(1),
    deals_count: Math.floor(50 + Math.random() * 900),
  });
  userIds[s.username] = info.lastInsertRowid;
}

// Демо-аккаунт покупателя, чтобы сразу было что показать в профиле.
// Почта: demo@example.com / Пароль: password123
const demoBuyerInfo = insertUser({
  email: 'demo@example.com',
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
    description: 'Аккаунт с 2018 года (Глава 1, сезон 2), 312 уровень, без банов. В шкафчике 47 экипировок, среди них: Сирена, Джон Уик, Спираль, Джунгли, Ночной рыцарь, Космонавт, Мурка, Тень, Панк-рок. 16 кирок (Звёздная кирка, Леденец, Коса жнеца, Лапа дракона), машина Ferrari 296 GTB и 22 обёртки. 12 боевых пропусков, 1850 V-баксов на счету. Смена почты и полный доступ после подтверждения оплаты.',
    price: 6800, stock: 1,
    items_count: 47,
    notable_items: 'Сирена, Ferrari, Джон Уик',
    images: ['fortnite-account-1.jpg', 'fortnite-account-2.jpg', 'fortnite-account-3.jpg', 'fortnite-account-4.jpg'],
    attributes: { platform: 'Все платформы', level: 312, vbucks: 1850, pickaxes: 16, access: 'Полный доступ + почта', native_mail: true },
  },
  {
    game: 'cs2', category: 'accounts', seller: 'vega_market', rarity: 'epic',
    title: 'Аккаунт CS2, Prime, высокий Trust Factor',
    description: 'Prime-статус, высокий Trust Factor, 2146 часов в CS2, рейтинг Premier 18 450, ни одной блокировки VAC. В инвентаре 12 предметов: AK-47 Аваллон, Керамбит Тигр, Перчатки Кровавая паутина, AWP, M4A1-S Кибер-неон, Desert Eagle Пламя и другие. Смена почты, отвязка телефона и перенос Steam Guard после покупки.',
    price: 3200, stock: 1,
    items_count: 12,
    notable_items: 'AK-47 Аваллон, Керамбит Тигр, Перчатки Кровавая паутина',
    images: ['cs2-account-1.jpg', 'cs2-account-2.jpg'],
    attributes: { prime: true, premier: 18450, rank: 'Беркут', hours: 2146, faceit: 7, vac: 'Без банов', medal_years: 5, inventory_value: 41000, access: 'Полный доступ + почта' },
  },
  {
    game: 'cs2', category: 'items', seller: 'nightseller', rarity: 'epic',
    title: 'Скин AK-47 «Огненный лотос»',
    description: 'Засекреченное, немного поношенное (float 0.1247, шаблон #412), без наклеек. Нет блокировки обмена — предмет передаётся через обмен Steam сразу после подтверждения сделки на площадке.',
    price: 2450, stock: 1,
    images: ['cs2-ak-lotus-1.jpg', 'cs2-ak-lotus-2.jpg'],
    attributes: { wear: 'Немного поношенное (MW)', float: '0.1247', pattern: '412', transfer: 'Обмен в игре', delivery: 'До 1 часа' },
  },
  {
    game: 'roblox', category: 'currency', seller: 'progoods', rarity: 'common',
    title: '800 робуксов',
    description: 'Зачисление на аккаунт Roblox в течение 15 минут после оплаты, официальным способом, без передачи пароля.',
    price: 590, stock: 8,
    images: ['roblox-robux-1.jpg'],
    attributes: { amount: 800, method: 'По ID игрока', delivery: 'До 1 часа' },
  },
  {
    game: 'brawl-stars', category: 'boosting', seller: 'arenadeals', rarity: 'rare',
    title: 'Прокачка ранга до Легенды за сезон',
    description: 'Поднимем ранг в рейтинговых боях до лиги «Легенда» (с любой лиги: Бронза, Серебро, Золото, Алмаз, Мифик). Играют опытные игроки, без читов и сторонних программ, отчёт после каждой сессии.',
    price: 1400, stock: 3,
    images: ['brawl-boost-1.jpg'],
    attributes: { from_rank: 'Золото', to_rank: 'Легенда', mode: 'Со входом на аккаунт', delivery: '1–3 дня' },
  },
  {
    game: 'standoff-2', category: 'keys', seller: 'shadowtrade', rarity: 'common',
    title: 'Промокод на редкий скин оружия',
    description: 'Промокод на нож «Неоновая волна». Код придёт в чат сделки сразу после оплаты, активация в игре в один клик, инструкция прилагается.',
    price: 250, stock: 15,
    images: ['standoff-promo-1.jpg'],
    attributes: { region: 'Весь мир', key_type: 'Промокод' },
  },
  {
    game: 'gta-v', category: 'gifts', seller: 'vega_market', rarity: 'rare',
    title: 'Подарочная карта Rockstar на 1000 ₽',
    description: 'Электронный код на 1000 ₽, подходит для покупок в Rockstar Games Launcher и GTA Online. Код приходит в чат сделки сразу после оплаты.',
    price: 980, stock: 5,
    images: ['gta-giftcard-1.jpg'],
    attributes: { nominal: 1000, region: 'Россия и СНГ' },
  },
  {
    game: 'genshin-impact', category: 'other', seller: 'progoods', rarity: 'common',
    title: 'Сопровождение: Витая бездна, 12 этаж',
    description: 'Проходим с вами Витую бездну и другие сложные испытания на все 36 звёзд в удобное время (ежедневно 12:00–23:00 МСК). Подскажем по отрядам и артефактам, голосовая связь по желанию.',
    price: 350, stock: 4,
    images: ['genshin-escort-1.jpg'],
    attributes: { delivery: 'До 24 часов' },
  },
];

const insertProduct = db.prepare(`
  INSERT INTO products (category_id, game_id, seller_id, title, description, price, rarity, image_seed, stock, items_count, notable_items, attributes)
  VALUES (@category_id, @game_id, @seller_id, @title, @description, @price, @rarity, @image_seed, @stock, @items_count, @notable_items, @attributes)
`);

// Демо-картинки лежат в db/seed-images (нарисованы специально для демо, не
// взяты из интернета) и при заполнении базы копируются туда же, куда
// попадают фото из формы «Выставить товар».
const SEED_IMAGES_DIR = path.join(__dirname, 'seed-images');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const insertImage = db.prepare('INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, ?)');

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
    attributes: def.attributes ? JSON.stringify(def.attributes) : null,
  };
  const info = insertProduct.run(row);
  allProducts.push({ id: info.lastInsertRowid, ...row });

  (def.images || []).forEach((file, i) => {
    const filename = `seed-${file}`;
    fs.copyFileSync(path.join(SEED_IMAGES_DIR, file), path.join(UPLOADS_DIR, filename));
    insertImage.run(info.lastInsertRowid, filename, i);
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
console.log('[GearVault] Демо-аккаунт для входа: demo@example.com / password123');
db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
db.close();
