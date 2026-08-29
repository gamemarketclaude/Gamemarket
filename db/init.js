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
  { slug: 'fortnite', name_ru: 'Фортнайт', name_en: 'Fortnite', icon: '🪂', currency: 'В-баксов', aliases: 'фортнайт, форт, фн, fortnite, fort' },
  { slug: 'cs2', name_ru: 'Counter-Strike 2', name_en: 'Counter-Strike 2', icon: '🔫', currency: '', aliases: 'кс2, кс 2, кс, контра, cs2, cs 2, counter strike, counter-strike' },
  { slug: 'brawl-stars', name_ru: 'Бравл Старс', name_en: 'Brawl Stars', icon: '⭐', currency: 'гемов', aliases: 'бравл старс, бравл, бс, br, brawl stars, brawl' },
  { slug: 'roblox', name_ru: 'Роблокс', name_en: 'Roblox', icon: '🧱', currency: 'робуксов', aliases: 'роблокс, рблх, roblox' },
  { slug: 'steam', name_ru: 'Стим', name_en: 'Steam', icon: '🎮', currency: 'баланса Steam', aliases: 'стим, steam' },
  { slug: 'minecraft', name_ru: 'Майнкрафт', name_en: 'Minecraft', icon: '⛏️', currency: 'минкоинов', aliases: 'майнкрафт, мк, mc, minecraft' },
  { slug: 'gta-v', name_ru: 'ГТА 5', name_en: 'GTA V', icon: '🚗', currency: 'игровых денег', aliases: 'гта, гта5, гта 5, gta, gta5, gta v, gta online' },
  { slug: 'valorant', name_ru: 'Валорант', name_en: 'Valorant', icon: '🎯', currency: 'VP', aliases: 'валорант, вал, valorant' },
  { slug: 'pubg-mobile', name_ru: 'ПАБГ Мобайл', name_en: 'PUBG Mobile', icon: '🪖', currency: 'UC', aliases: 'пабг, пубг, pubg, pubg mobile' },
  { slug: 'standoff-2', name_ru: 'Стендофф 2', name_en: 'Standoff 2', icon: '💥', currency: 'золота', aliases: 'стендофф, стендофф 2, со2, so2, standoff, standoff 2' },
  { slug: 'genshin-impact', name_ru: 'Геншин Импакт', name_en: 'Genshin Impact', icon: '⚔️', currency: 'кристаллов истока', aliases: 'геншин, genshin, genshin impact' },
  { slug: 'free-fire', name_ru: 'Фри Фаер', name_en: 'Free Fire', icon: '🔥', currency: 'алмазов', aliases: 'фри фаер, фф, ff, free fire' },
  { slug: 'mobile-legends', name_ru: 'Мобайл Легендс', name_en: 'Mobile Legends', icon: '🛡️', currency: 'алмазов', aliases: 'мобайл легендс, мл, ml, mlbb, mobile legends' },
  { slug: 'dota-2', name_ru: 'Дота 2', name_en: 'Dota 2', icon: '🪓', currency: 'игровой валюты', aliases: 'дота, дота 2, dota, dota2' },
  { slug: 'apex-legends', name_ru: 'Апекс Легендс', name_en: 'Apex Legends', icon: '🚁', currency: 'монет Apex', aliases: 'апекс, apex, apex legends' },
  { slug: 'ea-fc', name_ru: 'EA Sports FC', name_en: 'EA Sports FC', icon: '⚽', currency: 'FC Points', aliases: 'фифа, fifa, еа фс, ea fc, фс' },
  { slug: 'rust', name_ru: 'Раст', name_en: 'Rust', icon: '🛠️', currency: '', aliases: 'раст, rust' },
  { slug: 'world-of-tanks', name_ru: 'Мир Танков', name_en: 'World of Tanks', icon: '🎖️', currency: 'золота', aliases: 'вот, wot, танки, world of tanks' },
  { slug: 'league-of-legends', name_ru: 'Лига Легенд', name_en: 'League of Legends', icon: '🏆', currency: 'RP', aliases: 'лига легенд, лол, lol, league of legends' },
  { slug: 'clash-royale', name_ru: 'Клэш Рояль', name_en: 'Clash Royale', icon: '👑', currency: 'гемов', aliases: 'клэш рояль, кр, cr, clash royale' },
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

// Не у каждой игры сразу будет куча объявлений — как и в жизни, часть игр
// только появилась в каталоге и ищется, но товаров под неё пока мало/нет.
const featuredSlugs = ['fortnite', 'cs2', 'brawl-stars', 'roblox', 'steam', 'valorant', 'standoff-2', 'gta-v', 'genshin-impact', 'dota-2', 'minecraft', 'mobile-legends'];

const rarities = ['common', 'rare', 'epic', 'legendary'];
const sellerUsernames = sellerAccounts.map(s => s.username);

// Шаблоны названий по категориям. {game} подставляется на этапе генерации.
const titleTemplatesByCategory = {
  accounts: [
    'Аккаунт «{game}» — топ рейтинг, все скины',
    'Стартовый аккаунт «{game}» с бонусами',
    'Прокачанный аккаунт «{game}», без привязки',
    'Аккаунт «{game}» с редкими предметами',
  ],
  items: [
    'Скин «Полуночный клинок»',
    'Комплект «Ледяной страж»',
    'Редкий предмет «Закат пустыни»',
    'Питомец «Тень бури»',
  ],
  boosting: [
    'Прокачка до топ-ранга',
    'Поднятие рейтинга за сезон',
    'Прохождение сложного режима',
    'Буст до нужного уровня',
  ],
  keys: [
    'Ключ активации игры',
    'Подписка Pass на 30 дней',
    'Delux-издание, ключ Steam',
    'Сезонный пропуск',
  ],
  gifts: [
    'Подарочная карта на 500 ₽',
    'Подарочная карта на 1000 ₽',
    'Подарочный набор новичка',
    'Промо-код на бонус',
  ],
  other: [
    'Сопровождение сделки под ключ',
    'Настройка аккаунта под ключ',
    'Консультация по игре',
    'Разное — уточняйте у продавца',
  ],
};

function currencyTitles(game) {
  const label = game.currency || 'игровой валюты';
  return [500, 1200, 3000, 6000].map((amount) => `${amount} ${label}`);
}

const insertProduct = db.prepare(`
  INSERT INTO products (category_id, game_id, seller_id, title, description, price, rarity, image_seed, stock)
  VALUES (@category_id, @game_id, @seller_id, @title, @description, @price, @rarity, @image_seed, @stock)
`);

const allProducts = [];
let seedCounter = 1;

for (const catSlug of Object.keys(categoryIds)) {
  const titles = catSlug === 'currency'
    ? null // считаем отдельно ниже, т.к. зависит от валюты конкретной игры
    : titleTemplatesByCategory[catSlug];

  for (let i = 0; i < 10; i++) {
    const gameSlug = featuredSlugs[Math.floor(Math.random() * featuredSlugs.length)];
    const game = gameDefs.find((g) => g.slug === gameSlug);
    const title = catSlug === 'currency'
      ? currencyTitles(game)[Math.floor(Math.random() * 4)]
      : titles[Math.floor(Math.random() * titles.length)].replace('{game}', game.name_ru);

    const rarity = rarities[Math.floor(Math.random() * rarities.length)];
    const basePrice = { common: 150, rare: 450, epic: 1200, legendary: 3500 }[rarity];
    const sellerUsername = sellerUsernames[Math.floor(Math.random() * sellerUsernames.length)];
    const row = {
      category_id: categoryIds[catSlug],
      game_id: gameIds[gameSlug],
      seller_id: userIds[sellerUsername],
      title,
      description: `${title} для «${game.name_ru}». Передача через безопасную сделку, сопровождение до подтверждения.`,
      price: Math.round(basePrice * (0.8 + Math.random() * 0.6)),
      rarity,
      image_seed: `gearvault-${seedCounter++}`,
      stock: Math.floor(1 + Math.random() * 5),
    };
    const info = insertProduct.run(row);
    allProducts.push({ id: info.lastInsertRowid, ...row });
  }
}

// --- Лента продаж (демо, не привязана к реальным заказам) ---
const insertSale = db.prepare('INSERT INTO sales_feed (product_title, buyer_name, price, minutes_ago) VALUES (?, ?, ?, ?)');
const feedBuyers = ['Игрок_92', 'Kirasky', 'DemonHunter', 'lite_user', 'Marina_K', 'Артём', 'NoScope'];
for (let i = 0; i < 12; i++) {
  const p = allProducts[Math.floor(Math.random() * allProducts.length)];
  insertSale.run(
    p.title,
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
