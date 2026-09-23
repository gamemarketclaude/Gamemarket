// ---------------------------------------------------------------------------
// Характеристики объявления — свои для каждой игры и раздела (по образцу
// крупных игровых бирж: у аккаунтов CS2 — Prime, ранг, часы; у PUBG Mobile —
// уровень, ранг, мифики; у доната — количество и способ получения и т.д.).
//
// Здесь только описание полей. Сервер берёт отсюда список разрешённых
// ключей (всё остальное из формы игнорируется), форма «Выставить товар»
// рисует поля по этому же описанию, страница игры — фильтры, страница
// товара — таблицу характеристик.
//
// type: number | select | bool | text
// filter: показывать ли поле как фильтр на странице игры
// ---------------------------------------------------------------------------

const num = (key, label, extra = {}) => ({ key, label, type: 'number', min: 0, max: 100000000, ...extra });
const sel = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
const bool = (key, label, extra = {}) => ({ key, label, type: 'bool', ...extra });
const txt = (key, label, extra = {}) => ({ key, label, type: 'text', maxLength: 80, ...extra });

// ---------- Общие поля по разделам (для всех игр) ----------

const DELIVERY_TIME = sel('delivery', 'Срок выполнения', ['Моментально', 'До 1 часа', 'До 24 часов', '1–3 дня', 'До недели'], { filter: true });

const COMMON = {
  accounts: [
    sel('access', 'Что получает покупатель', ['Полный доступ + почта', 'Логин и пароль без почты', 'Привязка к почте покупателя'], { filter: true }),
    bool('native_mail', 'Родная (первая) почта', { filter: true }),
  ],
  currency: [
    num('amount', 'Количество валюты', { required: true, min: 1, filter: true, filterMode: 'min' }),
    sel('method', 'Способ получения', ['По ID игрока', 'Со входом в аккаунт', 'Подарком', 'Кодом / картой'], { filter: true }),
    DELIVERY_TIME,
  ],
  items: [
    sel('transfer', 'Способ передачи', ['Обмен в игре', 'Подарком', 'Со входом в аккаунт', 'Код / промокод']),
    DELIVERY_TIME,
  ],
  boosting: [
    sel('mode', 'Как выполняется', ['Со входом на аккаунт', 'Совместная игра (пати)'], { filter: true }),
    DELIVERY_TIME,
  ],
  keys: [
    sel('region', 'Регион активации', ['Россия и СНГ', 'Весь мир', 'Турция', 'Казахстан', 'Европа', 'Другой'], { filter: true }),
    sel('key_type', 'Тип', ['Ключ', 'Гифт', 'Промокод', 'Подписка'], { filter: true }),
  ],
  gifts: [
    num('nominal', 'Номинал, ₽', { min: 1 }),
    sel('region', 'Регион', ['Россия и СНГ', 'Весь мир', 'Турция', 'Казахстан', 'Другой'], { filter: true }),
  ],
  other: [DELIVERY_TIME],
};

// ---------- Поля конкретных игр ----------

const CS_RANKS = ['Без звания', 'Серебро', 'Золотая звезда', 'Калаш', 'Бляха', 'Беркут', 'Суприм', 'Глобал'];
const CS_WEAR = ['Прямо с завода (FN)', 'Немного поношенное (MW)', 'После полевых (FT)', 'Поношенное (WW)', 'Закалённое в боях (BS)'];
const PUBG_RANKS = ['Бронза', 'Серебро', 'Золото', 'Платина', 'Алмаз', 'Корона', 'Ас', 'Ас-мастер', 'Ас-доминатор', 'Завоеватель'];
const BS_RANKS = ['Бронза', 'Серебро', 'Золото', 'Алмаз', 'Мифик', 'Легенда', 'Мастер', 'Профи'];
const VALORANT_RANKS = ['Железо', 'Бронза', 'Серебро', 'Золото', 'Платина', 'Алмаз', 'Восходящий', 'Бессмертный', 'Радиант'];
const DOTA_RANKS = ['Рекрут', 'Страж', 'Рыцарь', 'Герой', 'Легенда', 'Властелин', 'Божество', 'Титан'];
const LOL_RANKS = ['Железо', 'Бронза', 'Серебро', 'Золото', 'Платина', 'Изумруд', 'Алмаз', 'Мастер', 'Грандмастер', 'Претендент'];
const MLBB_RANKS = ['Воин', 'Элита', 'Мастер', 'Грандмастер', 'Эпический', 'Легенда', 'Мифический', 'Мифическая слава', 'Мифический бессмертный'];
const PLATFORMS = ['ПК', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Телефон', 'Все платформы'];

const GAMES = {
  fortnite: {
    accounts: [
      sel('platform', 'Платформа', PLATFORMS, { filter: true }),
      num('level', 'Уровень аккаунта', { filter: true, filterMode: 'min' }),
      num('vbucks', 'В-баксы на счету', { filter: true, filterMode: 'min' }),
      num('pickaxes', 'Кирок'),
      bool('stw', 'Есть «Сражение с Бурей» (PvE)', { filter: true }),
    ],
    currency: [sel('platform', 'Платформа', PLATFORMS, { filter: true })],
  },
  cs2: {
    accounts: [
      bool('prime', 'Prime-статус', { filter: true }),
      num('premier', 'Рейтинг Premier', { filter: true, filterMode: 'min' }),
      sel('rank', 'Звание (соревновательный)', CS_RANKS, { filter: true }),
      num('hours', 'Часов в CS2', { filter: true, filterMode: 'min' }),
      num('faceit', 'Уровень Faceit', { min: 0, max: 10, filter: true, filterMode: 'min' }),
      sel('vac', 'Блокировки', ['Без банов', 'VAC в другой игре', 'Игровой бан (истёк)'], { filter: true }),
      num('medal_years', 'Медаль за выслугу лет', { min: 0, max: 30 }),
      num('inventory_value', 'Стоимость инвентаря, ₽', { filter: true, filterMode: 'min' }),
    ],
    items: [
      sel('wear', 'Износ', CS_WEAR, { filter: true }),
      bool('stattrak', 'StatTrak™', { filter: true }),
      txt('float', 'Float (износ точно)', { maxLength: 20, placeholder: 'Например, 0.1247' }),
      txt('pattern', 'Паттерн (шаблон)', { maxLength: 20 }),
      bool('trade_lock', 'Есть блокировка обмена'),
    ],
    boosting: [
      num('from_rating', 'С рейтинга Premier'),
      num('to_rating', 'До рейтинга Premier'),
    ],
  },
  'brawl-stars': {
    accounts: [
      num('trophies', 'Кубков', { filter: true, filterMode: 'min' }),
      num('brawlers', 'Бойцов', { filter: true, filterMode: 'min' }),
      num('legendary', 'Легендарных бойцов', { filter: true, filterMode: 'min' }),
      sel('rank', 'Лучший ранг', BS_RANKS, { filter: true }),
      num('gems', 'Гемов на счету'),
      bool('supercell_id', 'Передача через Supercell ID', { filter: true }),
    ],
    boosting: [
      sel('from_rank', 'С ранга', BS_RANKS),
      sel('to_rank', 'До ранга', BS_RANKS, { filter: true }),
      num('trophies_target', 'Цель по кубкам'),
    ],
  },
  roblox: {
    accounts: [
      num('robux', 'Робуксов на счету', { filter: true, filterMode: 'min' }),
      num('limiteds', 'Лимитированных предметов', { filter: true, filterMode: 'min' }),
      num('year', 'Год регистрации', { min: 2006, max: 2030 }),
      bool('premium', 'Roblox Premium', { filter: true }),
    ],
  },
  steam: {
    accounts: [
      num('games', 'Игр на аккаунте', { filter: true, filterMode: 'min' }),
      num('steam_level', 'Уровень Steam', { filter: true, filterMode: 'min' }),
      num('games_value', 'Стоимость игр, ₽', { filter: true, filterMode: 'min' }),
      sel('region', 'Регион аккаунта', ['Россия', 'Казахстан', 'Турция', 'Аргентина', 'Украина', 'Другой'], { filter: true }),
    ],
  },
  minecraft: {
    accounts: [
      sel('license', 'Лицензия', ['Java + Bedrock', 'Только Java', 'Только Bedrock'], { filter: true }),
      bool('nick_change', 'Можно сменить ник', { filter: true }),
      sel('hypixel', 'Ранг Hypixel', ['Нет', 'VIP', 'VIP+', 'MVP', 'MVP+', 'MVP++'], { filter: true }),
      num('capes', 'Плащей'),
    ],
  },
  'gta-v': {
    accounts: [
      sel('platform', 'Платформа', ['ПК', 'PlayStation', 'Xbox'], { filter: true }),
      num('money', 'Денег в GTA Online, $', { filter: true, filterMode: 'min' }),
      num('level', 'Уровень', { filter: true, filterMode: 'min' }),
      sel('launcher', 'Лаунчер', ['Rockstar', 'Steam', 'Epic Games']),
    ],
  },
  valorant: {
    accounts: [
      sel('rank', 'Ранг', VALORANT_RANKS, { filter: true }),
      sel('region', 'Регион', ['Европа', 'Северная Америка', 'Азия', 'Корея', 'Латинская Америка', 'Бразилия'], { filter: true }),
      num('agents', 'Открыто агентов', { filter: true, filterMode: 'min' }),
      num('vp', 'Valorant Points на счету'),
    ],
    boosting: [sel('from_rank', 'С ранга', VALORANT_RANKS), sel('to_rank', 'До ранга', VALORANT_RANKS, { filter: true })],
  },
  'pubg-mobile': {
    accounts: [
      num('level', 'Уровень', { filter: true, filterMode: 'min' }),
      sel('rank', 'Лучший ранг', PUBG_RANKS, { filter: true }),
      num('mythics', 'Мифических скинов', { filter: true, filterMode: 'min' }),
      num('upgradable', 'Улучшаемых оружий', { filter: true, filterMode: 'min' }),
      num('cars', 'Спорткаров', { filter: true, filterMode: 'min' }),
      num('uc', 'UC на счету'),
      sel('login', 'Вход через', ['Почта', 'Facebook', 'Twitter (X)', 'Google Play', 'Game Center', 'Несколько'], { filter: true }),
    ],
    boosting: [sel('from_rank', 'С ранга', PUBG_RANKS), sel('to_rank', 'До ранга', PUBG_RANKS, { filter: true })],
  },
  'standoff-2': {
    accounts: [
      num('level', 'Уровень', { filter: true, filterMode: 'min' }),
      num('gold', 'Голды на счету', { filter: true, filterMode: 'min' }),
      num('knives', 'Ножей', { filter: true, filterMode: 'min' }),
      num('inventory_value', 'Стоимость инвентаря, голды', { filter: true, filterMode: 'min' }),
    ],
    items: [sel('item_type', 'Тип', ['Нож', 'Перчатки', 'Оружие', 'Наклейка', 'Брелок', 'Кейс'], { filter: true })],
  },
  'genshin-impact': {
    accounts: [
      num('ar', 'Ранг приключений (AR)', { filter: true, filterMode: 'min' }),
      sel('server', 'Сервер', ['Европа', 'Америка', 'Азия', 'TW/HK/MO'], { filter: true }),
      num('five_chars', 'Персонажей 5★', { filter: true, filterMode: 'min' }),
      num('five_weapons', 'Оружия 5★', { filter: true, filterMode: 'min' }),
      num('primogems', 'Примогемов'),
    ],
  },
  'free-fire': {
    accounts: [
      num('level', 'Уровень', { filter: true, filterMode: 'min' }),
      num('diamonds', 'Алмазов на счету'),
      sel('login', 'Вход через', ['Google', 'Facebook', 'VK', 'Гость', 'Другое'], { filter: true }),
    ],
  },
  'mobile-legends': {
    accounts: [
      num('heroes', 'Героев', { filter: true, filterMode: 'min' }),
      num('skins', 'Скинов', { filter: true, filterMode: 'min' }),
      sel('rank', 'Лучший ранг', MLBB_RANKS, { filter: true }),
      num('diamonds', 'Алмазов на счету'),
    ],
  },
  'dota-2': {
    accounts: [
      num('mmr', 'MMR', { filter: true, filterMode: 'min' }),
      sel('rank', 'Звание', DOTA_RANKS, { filter: true }),
      num('behavior', 'Порядочность', { max: 12000 }),
      num('hours', 'Часов в игре', { filter: true, filterMode: 'min' }),
    ],
    boosting: [num('from_mmr', 'С MMR'), num('to_mmr', 'До MMR')],
  },
  'apex-legends': {
    accounts: [
      sel('platform', 'Платформа', ['ПК', 'PlayStation', 'Xbox', 'Nintendo Switch'], { filter: true }),
      num('level', 'Уровень', { filter: true, filterMode: 'min' }),
      num('heirlooms', 'Реликвий', { filter: true, filterMode: 'min' }),
      num('legends', 'Открыто легенд'),
    ],
  },
  'ea-fc': {
    accounts: [sel('platform', 'Платформа', ['ПК', 'PlayStation', 'Xbox'], { filter: true }), num('coins', 'Монет', { filter: true, filterMode: 'min' })],
    currency: [sel('platform', 'Платформа', ['ПК', 'PlayStation', 'Xbox'], { filter: true })],
  },
  rust: {
    accounts: [num('hours', 'Часов в игре', { filter: true, filterMode: 'min' }), num('inventory_value', 'Стоимость скинов, ₽', { filter: true, filterMode: 'min' })],
  },
  'world-of-tanks': {
    accounts: [
      num('tier10', 'Танков X уровня', { filter: true, filterMode: 'min' }),
      num('premium_tanks', 'Премиум-танков', { filter: true, filterMode: 'min' }),
      num('gold', 'Золота'),
      sel('region', 'Регион', ['Мир танков (РУ)', 'World of Tanks (ЕС)'], { filter: true }),
    ],
  },
  'league-of-legends': {
    accounts: [
      sel('rank', 'Ранг', LOL_RANKS, { filter: true }),
      num('champions', 'Чемпионов', { filter: true, filterMode: 'min' }),
      num('skins', 'Скинов', { filter: true, filterMode: 'min' }),
      sel('region', 'Сервер', ['Европа (EUW)', 'Европа (EUNE)', 'Россия', 'Северная Америка', 'Другой'], { filter: true }),
    ],
  },
  'clash-royale': {
    accounts: [
      num('king_level', 'Уровень короля', { filter: true, filterMode: 'min' }),
      num('trophies', 'Кубков', { filter: true, filterMode: 'min' }),
      num('max_cards', 'Карт максимального уровня'),
      bool('supercell_id', 'Передача через Supercell ID', { filter: true }),
    ],
  },
};

/**
 * Скины/предметы на аккаунте (колонки items_count + notable_items):
 * в разделе «Аккаунты» показываются всегда, но обязательны только для
 * игр, где аккаунт узнают именно по скинам (Fortnite).
 */
const SKINS_REQUIRED_GAMES = new Set(['fortnite']);

function fieldsFor(gameSlug, categorySlug) {
  const game = GAMES[gameSlug] || {};
  return [...(game[categorySlug] || []), ...(COMMON[categorySlug] || [])];
}

function skinsRequired(gameSlug, categorySlug) {
  return categorySlug === 'accounts' && SKINS_REQUIRED_GAMES.has(gameSlug);
}

/**
 * Разбирает поля attr_<ключ> из формы. Берёт ТОЛЬКО ключи из описания
 * (явный allow-list), проверяет тип/диапазон/варианты.
 * @returns {{ values: object, error: string|null }}
 */
function parseAttributes(body, gameSlug, categorySlug) {
  const values = {};
  for (const f of fieldsFor(gameSlug, categorySlug)) {
    const raw = body[`attr_${f.key}`];
    const str = typeof raw === 'string' ? raw.trim() : '';
    if (f.type === 'bool') {
      if (raw === 'on' || raw === '1' || raw === 'true') values[f.key] = true;
      continue;
    }
    if (!str) {
      if (f.required) return { values, error: `Заполните поле «${f.label}»` };
      continue;
    }
    if (f.type === 'number') {
      const n = Number(str.replace(/\s+/g, '').replace(',', '.'));
      const min = f.min ?? 0;
      const max = f.max ?? 100000000;
      if (!Number.isFinite(n) || n < min || n > max) return { values, error: `«${f.label}»: укажите число от ${min} до ${max}` };
      values[f.key] = Math.round(n * 100) / 100;
    } else if (f.type === 'select') {
      if (!f.options.includes(str)) return { values, error: `«${f.label}»: выберите вариант из списка` };
      values[f.key] = str;
    } else {
      if (str.length > (f.maxLength || 80)) return { values, error: `«${f.label}»: не длиннее ${f.maxLength || 80} символов` };
      values[f.key] = str;
    }
  }
  return { values, error: null };
}

/** Пары «название — значение» для страницы товара. */
function describeAttributes(attributesJson, gameSlug, categorySlug) {
  let attrs = {};
  try { attrs = attributesJson ? JSON.parse(attributesJson) : {}; } catch (_) { attrs = {}; }
  return fieldsFor(gameSlug, categorySlug)
    .filter((f) => attrs[f.key] !== undefined && attrs[f.key] !== '')
    .map((f) => ({
      label: f.label,
      value: f.type === 'bool' ? 'Да' : f.type === 'number' ? Number(attrs[f.key]).toLocaleString('ru-RU') : attrs[f.key],
    }));
}

/** Поля, по которым можно фильтровать на странице игры. */
function filterFieldsFor(gameSlug, categorySlug) {
  return fieldsFor(gameSlug, categorySlug).filter((f) => f.filter);
}

/** Описание всех полей для формы (уходит в браузер как JSON). */
function clientConfig() {
  return { common: COMMON, games: GAMES, skinsRequired: [...SKINS_REQUIRED_GAMES] };
}

module.exports = { fieldsFor, skinsRequired, parseAttributes, describeAttributes, filterFieldsFor, clientConfig };
