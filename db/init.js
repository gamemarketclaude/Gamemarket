const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  DROP TABLE IF EXISTS messages;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS products;
  DROP TABLE IF EXISTS categories;
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

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    game_name TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    rarity TEXT NOT NULL, -- common, rare, epic, legendary
    image_seed TEXT NOT NULL,
    stock INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  { username: 'kioskzero', display_name: 'KioskZero' },
  { username: 'frostbazaar', display_name: 'FrostBazaar' },
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
const categories = [
  { name: 'Аккаунты', slug: 'accounts', icon: '🗝️' },
  { name: 'Внутриигровая валюта', slug: 'currency', icon: '💰' },
  { name: 'Скины и предметы', slug: 'items', icon: '🎨' },
  { name: 'Прокачка и бустинг', slug: 'boosting', icon: '⚡' },
  { name: 'Ключи и подписки', slug: 'keys', icon: '🎟️' },
];

const insertCategory = db.prepare('INSERT INTO categories (name, slug, icon) VALUES (?, ?, ?)');
const categoryIds = {};
for (const c of categories) {
  const info = insertCategory.run(c.name, c.slug, c.icon);
  categoryIds[c.slug] = info.lastInsertRowid;
}

const games = ['Standoff Legacy', 'Wild Frontier Online', 'NeonDrift', 'Ashen Realms', 'Star Convoy', 'Old Kingdom RP'];
const rarities = ['common', 'rare', 'epic', 'legendary'];
const sellerUsernames = sellerAccounts.map(s => s.username);

const productSeeds = [
  { cat: 'accounts', titles: ['Аккаунт 4 сезона, топ-500 рейтинга', 'Стартовый аккаунт со всеми героями', 'Аккаунт с редким скином на старте', 'Смешанный аккаунт, 300+ часов'] },
  { cat: 'currency', titles: ['5000 кристаллов', '15000 монет королевства', '1200 игровых токенов', '50000 очков арены'] },
  { cat: 'items', titles: ['Скин "Полуночный клинок"', 'Комплект брони "Ледяной страж"', 'Оружие "Закат пустыни"', 'Питомец "Тень бури"'] },
  { cat: 'boosting', titles: ['Прокачка до 50 уровня', 'Прохождение рейда на выбор', 'Поднятие ранга до "Платины"', 'Фарм ресурсов на 10 часов'] },
  { cat: 'keys', titles: ['Ключ активации базовой версии', 'Подписка премиум на 30 дней', 'Ключ delux-издания', 'Сезонный пропуск'] },
];

const insertProduct = db.prepare(`
  INSERT INTO products (category_id, seller_id, game_name, title, description, price, rarity, image_seed, stock)
  VALUES (@category_id, @seller_id, @game_name, @title, @description, @price, @rarity, @image_seed, @stock)
`);

const allProducts = [];
let seedCounter = 1;
for (const group of productSeeds) {
  for (const title of group.titles) {
    for (let i = 0; i < 3; i++) {
      const rarity = rarities[Math.floor(Math.random() * rarities.length)];
      const basePrice = { common: 150, rare: 450, epic: 1200, legendary: 3500 }[rarity];
      const sellerUsername = sellerUsernames[Math.floor(Math.random() * sellerUsernames.length)];
      const row = {
        category_id: categoryIds[group.cat],
        seller_id: userIds[sellerUsername],
        game_name: games[Math.floor(Math.random() * games.length)],
        title,
        description: `${title}. Передача через безопасную сделку, сопровождение до подтверждения.`,
        price: Math.round(basePrice * (0.8 + Math.random() * 0.6)),
        rarity,
        image_seed: `gearvault-${seedCounter++}`,
        stock: Math.floor(1 + Math.random() * 5),
      };
      const info = insertProduct.run(row);
      allProducts.push({ id: info.lastInsertRowid, ...row });
    }
  }
}

// --- Лента продаж (демо, не привязана к реальным заказам) ---
const insertSale = db.prepare('INSERT INTO sales_feed (product_title, buyer_name, price, minutes_ago) VALUES (?, ?, ?, ?)');
const feedBuyers = ['Игрок_92', 'Kirasky', 'DemonHunter', 'lite_user', 'Marina_K', 'Артём', 'NoScope'];
const allTitles = productSeeds.flatMap(g => g.titles);
for (let i = 0; i < 12; i++) {
  insertSale.run(
    allTitles[Math.floor(Math.random() * allTitles.length)],
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

const samplePurchases = allProducts.slice(0, 2);
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
