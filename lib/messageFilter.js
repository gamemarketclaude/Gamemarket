// ---------------------------------------------------------------------------
// Фильтр сообщений чата (и текстов объявлений).
// Задача: не дать продавцу/покупателю увести сделку с площадки — через
// ссылку, контакт (телефон, ник в Telegram/TikTok/Discord…, почту, номер
// карты) или упоминание сторонней площадки/сервиса/приложения, даже если
// это написано с ухищрениями: другими буквами, транслитом, вразрядку,
// цифрами вместо букв, числами словами, по частям в нескольких сообщениях.
//
// Как устроено:
//  1. Слова сравниваются по «скелету» (транслит в латиницу, без гласных,
//     цифры-двойники букв заменены) — «телеграм», «tElEgRaM», «т е л е г р а м»,
//     «телеграмме» дают один скелет. Сравнение идёт по целым словам (и по
//     2–3 соседним словам, склеенным вместе), а не подстрокой по всему
//     тексту — иначе ловились бы обычные слова.
//  2. Короткие и двусмысленные названия (тг, вк, дс, сбп…) — только точным
//     совпадением целого слова.
//  3. Ники: @что-угодно, почты, «ник/юз/тг: …», латиница с «_» или цифрами
//     на конце (vasya_pro, ivan2007), призывы «пиши мне в …».
//  4. Числа: словами («семь девятьсот двести…») переводятся в цифры; номер
//     ловится и в одном сообщении, и когда его пишут «в столбик» по кускам
//     в нескольких сообщениях подряд (checkConversation).
// ---------------------------------------------------------------------------

// ---------- Списки ----------

// Торговые площадки, магазины, обменники скинов — «уводят» сделку.
const MARKETPLACES = [
  'funpay', 'фанпей', 'фанпэй', 'фанпай', 'фунпай',
  'playerok', 'плеерок', 'плейрок', 'плеер ок', 'плэйерок', 'playrock', 'плейрак',
  'ggsel', 'ggsell', 'ггсел', 'ggsl',
  'plati market', 'платимаркет', 'digiseller', 'дигиселлер', 'oplata info',
  'lolzteam', 'zelenka', 'зеленка', 'зелёнка',
  'starvell', 'старвелл', 'старвел',
  'eldorado', 'эльдорадо', 'playerauctions', 'kinguin', 'кингуин',
  'gamivo', 'zakazaka', 'заказака', 'gabestore', 'steampay', 'стимпей',
  'steambuy', 'igromagaz', 'игромагаз', 'buyaccs', 'accsmarket', 'hstock',
  'wildberries', 'вайлдберриз', 'валдберис', 'aliexpress', 'алиэкспресс',
  // скины CS2 и прочие обменники
  'csmoney', 'cs money', 'ксмани', 'кс мани', 'tradeit', 'skinport', 'скинпорт', 'dmarket', 'дмаркет',
  'bitskins', 'lisskins', 'lis skins', 'лисскинс', 'skinbaron', 'csfloat', 'waxpeer',
  'swapgg', 'lootfarm', 'market csgo', 'csgomarket', 'skinsmonkey', 'avan market', 'аванмаркет',
];

// Мессенджеры, соцсети, стримы — прямой контакт вне площадки.
const MESSENGERS = [
  'telegram', 'телеграм', 'телеграмм', 'телега', 'телеге', 'телегу', 'телеги', 'teleg',
  'whatsapp', 'ватсап', 'вотсап', 'вацап', 'вотсапп', 'ватсапп', 'уотсап',
  'discord', 'дискорд', 'дискорт', 'дискордик', 'дис корд',
  'vkontakte', 'вконтакте', 'вконтакт',
  'instagram', 'инстаграм', 'инстаграмм', 'инстаграме',
  'tiktok', 'тикток', 'тик ток', 'тиктоке', 'тикитоки',
  'twitch', 'твич', 'твиче', 'kick com',
  'snapchat', 'снэпчат', 'снапчат', 'сигнал мессенджер',
  'facebook', 'фейсбук', 'твиттер', 'twitter', 'threads',
  'одноклассники', 'zangi',
  'messenger max', 'мессенджер макс', 'пиши в макс',
];

// Оплата в обход площадки: банки, кошельки, биржи.
const PAYMENTS = [
  'сбербанк', 'тинькофф', 'тинькоф', 'tinkoff', 'тбанк', 't bank', 'т банк',
  'альфабанк', 'альфа банк', 'alfabank', 'озон банк', 'райффайзен', 'газпромбанк',
  'яндекс деньги', 'киви кошелек', 'webmoney', 'вебмани',
  'perfect money', 'advcash',
  'garantex', 'гарантекс', 'bitcoin', 'биткоин',
];

// Сторонние программы и сервисы, которые пользователи просили не пропускать
// (например, ПО для мышек/периферии — через него тоже «договариваются»).
const APPS = [
  'g hub', 'ghub', 'джи хаб', 'джихаб', 'logitech', 'логитек', 'razer synapse',
  'anydesk', 'энидеск', 'teamviewer', 'тимвьювер', 'parsec', 'парсек',
];

// Короткие/двусмысленные — только точным совпадением целого слова.
// (слова, которые по «скелету» совпали бы с обычными: «инста» ~ «Настя»,
// «вайбер» ~ «выбор», «бинанс» ~ «бонус», «тинек» ~ «танк», «сбер» ~ «сбор»)
const EXACT_WORDS = {
  site: ['g2g', 'g2a', 'lzt', 'лзт', 'lolz', 'лолз', 'лолзе', 'лолза', 'лолзу', 'lolze', 'wb', 'вб', 'fp', 'фп', 'plati', 'платиру', 'ozon', 'озон', 'озоне', 'ozonru',
    'avito', 'авито', 'авите', 'юла', 'юле', 'eneba', 'энеба', 'яндексмаркет', 'мегамаркет', 'buff163'],
  messenger: ['тг', 'tg', 'тгк', 'тгшка', 'дс', 'ds', 'вк', 'vk', 'вкшка', 'тт', 'tt', 'ig', 'fb', 'yt', 'wa', 'ватс', 'вотс',
    'инст', 'inst', 'инста', 'инсту', 'инсте', 'инсты', 'insta', 'снап', 'viber', 'вайбер', 'вибер', 'вайбере', 'вайберу',
    'skype', 'скайп', 'скайпе', 'скайпу', 'youtube', 'ютуб', 'ютубе', 'ютьюб', 'ютубчик', 'reddit', 'реддит',
    'icq', 'аська', 'аське', 'signal', 'wechat', 'вичат', 'вичате'],
  payment: ['сбп', 'sbp', 'сбер', 'сбере', 'сберу', 'sber', 'тинек', 'тиньк', 'тинька', 'тиньку', 'втб', 'vtb',
    'qiwi', 'киви', 'юмани', 'юmoney', 'yoomoney', 'paypal', 'пейпал', 'payeer', 'пайер',
    'binance', 'бинанс', 'бинансе', 'bybit', 'байбит', 'okx', 'huobi', 'htx',
    'usdt', 'юсдт', 'tether', 'btc', 'eth', 'биток', 'крипта', 'крипту', 'криптой', 'крипте'],
  app: ['bloody', 'блади'],
};

// Слова, рядом с которыми латинское «слово» — это почти наверняка ник.
const CONTACT_KEYWORDS = [
  'ник', 'никнейм', 'nick', 'nickname', 'юз', 'юзер', 'юзернейм', 'username', 'юзернэйм', 'юзик',
  'контакт', 'контакты', 'контакта', 'связь', 'связаться', 'свяжись', 'свяжемся', 'лс', 'личку', 'личке', 'личка',
  'добавь', 'добавляйся', 'добавься', 'найди', 'ищи', 'стучи', 'стукни', 'маякни',
  'email', 'емейл', 'имейл', 'мыло',
];
// Границы слова: встроенный \b в JavaScript не понимает кириллицу
// (для него «п» — не буква), поэтому используем свои.
const B = '(?<![a-zа-я0-9_])';
const E = '(?![a-zа-я0-9_])';
const re = (src) => new RegExp(src.split('\\b<').join(B).split('\\b>').join(E), 'i');

// «Призывы уйти из чата»: такие фразы блокируем целиком, без ника.
const CONTACT_PHRASES = [
  re('\\b<(пиши|напиши|пишите|напишите|стучи|стукни|стучите|маякни|скинь|кинь|добавь|добавляйся|переходи|перейд[её]м|найди|ищи|жду)\\s+(мне\\s+|меня\\s+)?(в|во|на)\\s+(лс|личку|личные|личн\\S*|директ|direct|дм|dm)\\b>'),
  re('\\b<(в|во)\\s+(лс|личку|личные сообщения|директ|direct)\\b>'),
  re('\\b<(мой|моя|моё|мое|мои|вот)\\s+(ник|никнейм|юз|юзер|юзернейм|username|контакт\\S*|номер телефона|номерок|телефон|тел)\\b>'),
  re('\\b<(ник|никнейм|юз|юзер|юзернейм|username|nick)\\s*[:=—]'),
  re('\\b<(спишемся|спишимся|созвонимся|созвон|созвонимся|перейдем в|переходи в)\\b>'),
  re('\\b<(вне|мимо)\\s+(площадки|сайта|гаранта)\\b>'),
  re('\\b<в\\s+обход\\b>'),
  re('\\b<без\\s+гаранта\\b>'),
  re('\\b<(номер\\s+карты|номер\\s+карточки|реквизит\\S*)\\b>'),
  re('\\b<(переведу|переведи|перевести|скину|скинь|кину|кинь|отправлю|отправь|оплачу|оплати|плачу|заплачу|перевод)(\\s+\\S+){0,2}\\s+(на\\s+карт\\S*|по\\s+номеру|по\\s+сбп|на\\s+кошел\\S*|напрямую|переводом|по\\s+реквизит\\S*)\\b>'),
  re('\\b<(оплата|оплачу|плачу)\\s+напрямую\\b>'),
  re('\\b<(пиши|напиши|пишите|напишите|стучи|стукни|маякни|добавь|добавляйся)\\s+(мне|меня)\\s+(в|на)?\\s*[a-z][a-z0-9_.]{3,}\\b>'),
];

// Игровые обозначения, похожие на ник (буквы+цифры), — не блокируем.
const GAME_TOKEN_RE = /^(ak|akm|m4a|m4a1s?|mp|ump|mac|cz|scar|sg|xm|mag|glock|deagle|usps?|p|r|t|g|g3sg|ps|gta|gtav?|cs|csgo|fc|fifa|rtx|gtx|rx|i|ryzen|iphone|win|windows|dota|pubg|apex|bo|mw|x|v|s|lvl|level|ур|уровень|tier|t|x|m|k|s|a|b|n|ss|sss|top|топ|mmr|rank|ранг|elo|gen|season|сезон|ch|ep)\d{1,5}[a-z0-9]{0,4}$/i;

// ---------- Нормализация ----------

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'a',
  і: 'i', ї: 'i', є: 'e', ґ: 'g', ў: 'u',
};
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
// Цифры и символы, которыми подменяют буквы: d1sc0rd, te1egram, funp@y
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'b', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l' };
// «1» и «|» чаще подменяют «l» (te1egram), чем «i» — проверяем оба варианта
const LEET_L = { ...LEET, 1: 'l', '!': 'l' };

function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    // Заглавная «I» внутри строчного латинского слова — это замаскированная «l»: teIegram
    .replace(/(?<=[a-z])I(?=[a-z])/g, 'l')
    .replace(/[​-‏⁠﻿­]/g, '') // невидимые символы и мягкий перенос
    .toLowerCase()
    .replace(/ё/g, 'е');
}

function transliterate(text) {
  return text.split('').map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join('');
}

// «Скелет» слова: транслит, только латинские буквы, без гласных, без
// повторов подряд («телеграмм» = «телеграм»).
function skeleton(word) {
  const lettersOnly = transliterate(word).replace(/[^a-z]/g, '');
  let result = '';
  for (const ch of lettersOnly) {
    if (VOWELS.has(ch)) continue;
    if (result[result.length - 1] === ch) continue;
    result += ch;
  }
  return result;
}

// Вариант слова с заменой «цифр-двойников» на буквы — только если в слове
// есть и буквы, и такие символы (иначе «2000» превратилось бы в слово).
function deLeet(word, table = LEET) {
  if (!/[a-zа-я]/i.test(word) || !/[0-9@$!|]/.test(word)) return word;
  return word.split('').map((ch) => table[ch] || ch).join('');
}

// Схлопывает разрядку: «т е л е г р а м», «t.e.l.e.g.r.a.m», «ф-а-н-п-е-й».
function collapseSpacedLetters(text) {
  const merged = [];
  let buffer = '';
  const flush = () => { if (buffer) { merged.push(buffer); buffer = ''; } };
  for (const tok of text.split(/\s+/)) {
    const parts = tok.split(/[^a-zа-я0-9]+/i).filter(Boolean);
    let collapsedTok = tok;
    if (parts.length >= 3 && parts.every((p) => p.length === 1)) collapsedTok = parts.join('');
    const core = collapsedTok.replace(/^[^a-zа-я0-9]+|[^a-zа-я0-9]+$/gi, '');
    if (/^[a-zа-я]$/i.test(core)) {
      buffer += core;
    } else {
      flush();
      merged.push(collapsedTok);
    }
  }
  flush();
  return merged.join(' ');
}

function buildSkeletonIndex(list) {
  const index = new Map(); // скелет -> исходное название
  for (const name of list) {
    const sk = skeleton(name.replace(/\s+/g, ''));
    if (sk.length >= 3 && !index.has(sk)) index.set(sk, name);
  }
  return index;
}

const SKELETON_GROUPS = [
  { type: 'site', index: buildSkeletonIndex(MARKETPLACES) },
  { type: 'messenger', index: buildSkeletonIndex(MESSENGERS) },
  { type: 'payment', index: buildSkeletonIndex(PAYMENTS) },
  { type: 'app', index: buildSkeletonIndex(APPS) },
];
const EXACT_GROUPS = Object.entries(EXACT_WORDS).map(([type, words]) => ({
  type,
  words: new Set(words.map((w) => normalizeText(w).replace(/\s+/g, ''))),
}));

const REASONS = {
  link: 'Ссылки и адреса сайтов в чате запрещены — все сделки проходят только через площадку.',
  site: 'Упоминать сторонние площадки и магазины нельзя (в том числе другими буквами) — сделка должна пройти здесь, иначе вас не защитит гарантия.',
  messenger: 'Нельзя звать в мессенджеры и соцсети (Telegram, WhatsApp, Discord, TikTok, VK и т.п.) — общение и сделка только на площадке.',
  payment: 'Нельзя договариваться об оплате в обход площадки (банки, карты, кошельки, крипта) — деньги защищены, только если оплата идёт через сайт.',
  app: 'Упоминать сторонние программы и сервисы для связи в чате нельзя.',
  handle: 'Похоже на ник/контакт. Передавать контакты нельзя. Если это название предмета — напишите его с пробелами, без «_» и цифр на конце.',
  contact: 'Обмен контактами (ник, телефон, почта, «пиши в лс» и т.п.) запрещён — все сделки должны проходить через площадку.',
  phone: 'Похоже на номер телефона — передавать контакты запрещено (в том числе словами или по частям).',
  card: 'Похоже на номер карты или реквизиты — оплата только через площадку.',
  email: 'Почтовые адреса в чате запрещены — обмен контактами не допускается.',
};

// ---------- Числа словами -> цифры ----------

const UNITS = {
  ноль: 0, нуль: 0, zero: 0, один: 1, одна: 1, одно: 1, one: 1, два: 2, две: 2, two: 2, три: 3, three: 3,
  четыре: 4, four: 4, пять: 5, five: 5, шесть: 6, six: 6, семь: 7, сем: 7, seven: 7, восемь: 8, восем: 8, eight: 8,
  девять: 9, девеять: 9, nine: 9,
};
const TEENS = {
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
  шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
};
const TENS = {
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
};
const HUNDREDS = {
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800,
  девятьсот: 900, девятсот: 900,
};

function numberWord(tok) {
  if (tok in UNITS) return { v: UNITS[tok], rank: 1 };
  if (tok in TEENS) return { v: TEENS[tok], rank: 2 }; // занимает и десятки, и единицы
  if (tok in TENS) return { v: TENS[tok], rank: 10 };
  if (tok in HUNDREDS) return { v: HUNDREDS[tok], rank: 100 };
  return null;
}

// «семь девятьсот двадцать три сорок пять» -> «7 923 45». Цифры и прочий
// текст остаются на месте; «плюс» перед числом превращается в «+».
function wordsToDigits(text) {
  const tokens = normalizeText(text).split(/(\s+|[,.;:!?()\-—])/);
  const out = [];
  let group = null; // { value, hasH, hasT, hasU }
  const flush = () => {
    if (group) { out.push(String(group.value)); group = null; }
  };
  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) { if (!group) out.push(raw); continue; }
    if (tok === 'плюс' || tok === 'plus') { flush(); out.push('+'); continue; }
    const n = numberWord(tok);
    if (!n) {
      if (/^[,.;:!?()\-—]$/.test(tok) && group) continue; // «девятьсот, двести» — продолжаем число
      flush();
      out.push(raw);
      continue;
    }
    if (group) {
      const canAdd = (n.rank === 10 && !group.hasT && !group.hasU)
        || (n.rank === 2 && !group.hasT && !group.hasU)
        || (n.rank === 1 && !group.hasU && (group.hasH || group.hasT) && !(group.hasT && group.teen));
      if (canAdd && !(n.rank === 100)) {
        group.value += n.v;
        if (n.rank === 10) group.hasT = true;
        if (n.rank === 2) { group.hasT = true; group.hasU = true; group.teen = true; }
        if (n.rank === 1) group.hasU = true;
        continue;
      }
      flush();
      out.push(' ');
    }
    group = { value: n.v, hasH: n.rank === 100, hasT: n.rank === 10 || n.rank === 2, hasU: n.rank === 1 || n.rank === 2, teen: n.rank === 2 };
  }
  flush();
  return out.join('');
}

// Внутри «числовых» слов буквы-двойники цифр: 9OO, 8-9З, l2З
function fixDigitLookalikes(text) {
  return text.replace(/\S+/g, (tok) => {
    if (tok.length >= 2 && /\d/.test(tok) && /^[\d+\-().oоlіз|]+$/i.test(tok)) {
      return tok.replace(/[oо]/gi, '0').replace(/[lі|]/gi, '1').replace(/[з]/gi, '3');
    }
    return tok;
  });
}

function toDigitText(text) {
  return fixDigitLookalikes(wordsToDigits(text));
}

function extractDigits(text) {
  return (toDigitText(text).match(/\d/g) || []).join('');
}

// ---------- Регулярки ----------

// Все зоны — когда точка стоит вплотную (vasya.me), и только однозначные —
// когда вокруг точки пробелы (иначе «…аккаунт. In game» считалось бы сайтом).
const TLD_ALL = '(ru|ру|рф|su|com|ком|net|org|io|gg|me|xyz|shop|store|site|online|pro|app|dev|tv|cc|biz|info|market|club|top|fun|ua|kz|by|uz|eu|de|us|co|uk|link|live|space|tech|games|game|best|ws|to|sh|ly|lol|one|world|cloud|money|pw|in)';
const TLD_STRICT = '(ru|ру|рф|su|com|ком|net|org|io|gg|xyz|online|site|store|biz|info|market|ua|kz|by|uz)';
const LINK_RE = /(https?:\/\/|www\.|(^|[^a-z])t\.me(?![a-z])|(^|[^a-z])wa\.me(?![a-z])|(^|[^a-z])vk\.(com|cc|me)|discord\.(gg|com)|tiktok\.com)/i;
const DOMAIN_RE = new RegExp(`[a-zа-я0-9-]{2,}(\\.${TLD_ALL}|\\s*\\.\\s*${TLD_STRICT}|,${TLD_STRICT})${E}`, 'i');
// «точка ру», «dot com», «(.)ru», «[dot] net»
const SPELLED_DOMAIN_RE = new RegExp(`(точка|тчк|dot|\\(\\.\\)|\\[\\.\\]|\\(dot\\)|\\[dot\\])\\s*${TLD_ALL}${E}|${B}(точка|dot)\\s*(ру|ком|нет|орг|рф|гг|ио)${E}`, 'i');
const EMAIL_RE = /[a-z0-9._%+-]+\s*(@|\(at\)|\[at\]|собака|собачка)\s*[a-z0-9-]+\s*(\.|точка|dot)\s*[a-zа-я]{2,}/i;
const AT_HANDLE_RE = /(^|[^a-z0-9._%+-])@\s?[a-zа-я0-9_.]{3,}/i;

// Телефон: +7/8 9xx…, 10 цифр с 9 в начале, либо + и 10–13 цифр — с любыми
// разделителями (пробелы, дефисы, скобки, точки).
const SEP = '[\\s\\-().]*';
const ND = '(?<!\\d)'; // перед числом не цифра
const NA = '(?!\\d)'; // после числа не цифра
const PHONE_RES = [
  new RegExp(`(\\+\\s*7|${ND}7|${ND}8)${SEP}9(${SEP}\\d){9}${NA}`),
  new RegExp(`${ND}(7|8)(${SEP}\\d){10}${NA}`), // 11 цифр на 7/8 (в т.ч. Казахстан)
  new RegExp(`${ND}9\\d{2}${SEP}\\d{3}${SEP}\\d{2}${SEP}\\d{2}${NA}`),
  new RegExp(`\\+${SEP}\\d(${SEP}\\d){9,13}`),
];
// Номер карты: 16–19 цифр, начинается на 2 (МИР), 4 (Visa), 5 (MC), 6
const CARD_RE = new RegExp(`${ND}[2456]\\d{3}(${SEP}\\d){12,15}${NA}`);

function looksLikePhoneDigits(digits) {
  return /^(7|8)9\d{9}$/.test(digits) || /^9\d{9}$/.test(digits) || /^(7|8)9\d{9}\d{0,2}$/.test(digits);
}

const PHONE_WORD_RE = re('\\b<(номер|номерок|телефон|телефона|тел|звони|позвони|набери|смс|sms)\\b>');

// ---------- Проверки ----------

function wordsOf(text) {
  return collapseSpacedLetters(text).split(/[^a-zа-я0-9@$!|]+/i).filter(Boolean);
}

function findBannedName(text) {
  const words = wordsOf(text);
  const plainWords = words.map((w) => w.replace(/[^a-zа-я0-9]/gi, ''));

  // Точные слова (и 2–3 соседних слова вместе: «плати ру», «т банк»)
  for (let size = 1; size <= 3; size++) {
    for (let i = 0; i + size <= plainWords.length; i++) {
      const joined = plainWords.slice(i, i + size).join('');
      for (const g of EXACT_GROUPS) {
        if (g.words.has(joined)) return g.type;
      }
    }
  }

  // Скелеты (с вариантами «цифры → буквы»). Соседние слова склеиваем ДО
  // построения скелета — «lis skins» и «lisskins» дают один скелет.
  const variants = [words, words.map((w) => deLeet(w)), words.map((w) => deLeet(w, LEET_L))];
  for (const ws of variants) {
    for (let size = 1; size <= 3; size++) {
      for (let i = 0; i + size <= ws.length; i++) {
        const combined = skeleton(ws.slice(i, i + size).join(''));
        if (combined.length < 3) continue;
        for (const g of SKELETON_GROUPS) {
          if (g.index.has(combined)) return g.type;
          // Длинные названия ловим и с окончаниями: «дискордовский», «телеграмчик»
          if (size === 1 && combined.length >= 6) {
            for (const sk of g.index.keys()) {
              if (sk.length >= 5 && combined.startsWith(sk) && combined.length - sk.length <= 3) return g.type;
            }
          }
        }
      }
    }
  }
  return null;
}

// Токен, похожий на ник: латиница/кириллица с «_», с точкой внутри или
// с 2+ цифрами на конце (vasya_pro, ivan2007, вася2007, nick.name).
function findHandleToken(text) {
  const tokens = normalizeText(text).split(/\s+/).map((t) => t.replace(/^[^a-zа-я0-9_]+|[^a-zа-я0-9_]+$/gi, ''));
  for (const tok of tokens) {
    if (tok.length < 5 || tok.length > 32) continue;
    if (!/^[a-zа-я]/i.test(tok)) continue;
    const letters = (tok.match(/[a-zа-я]/gi) || []).length;
    if (letters < 3) continue;
    if (GAME_TOKEN_RE.test(tok.replace(/[_.]/g, ''))) continue;
    const latin = /^[a-z0-9_.]+$/i.test(tok);
    const cyr = /^[а-я0-9_]+$/i.test(tok);
    if (!latin && !cyr) continue;
    if (tok.includes('_')) return tok;
    if (latin && /[a-z]\.[a-z]/i.test(tok)) return tok;
    if (/[a-zа-я]{3,}\d{2,}$/i.test(tok)) return tok;
    if (latin && /\d{3,}/.test(tok) && letters >= 4) return tok;
  }
  return null;
}

function hasContactKeyword(text) {
  const words = new Set(normalizeText(text).split(/[^a-zа-я0-9]+/i).filter(Boolean));
  return CONTACT_KEYWORDS.some((k) => !k.includes(' ') && words.has(k));
}

// Латинское «слово-ник» рядом со словом-контактом: «пиши vasyapupkin», «ник: ProGamer»
function latinWordNearContactKeyword(text) {
  const tokens = normalizeText(text).split(/[^a-zа-я0-9_.]+/i).filter(Boolean);
  const keywordIdx = [];
  tokens.forEach((t, i) => { if (CONTACT_KEYWORDS.includes(t)) keywordIdx.push(i); });
  if (!keywordIdx.length) return false;
  const COMMON = new Set(['ok', 'okay', 'pls', 'plz', 'please', 'thanks', 'thx', 'hi', 'hello', 'yes', 'no', 'good', 'gg', 'wp', 'lol', 'prime', 'steam', 'guard', 'mail', 'gmail', 'email', 'nick', 'user', 'username', 'ranked', 'premier']);
  for (const i of keywordIdx) {
    for (let j = Math.max(0, i - 2); j <= Math.min(tokens.length - 1, i + 3); j++) {
      if (j === i) continue;
      const t = tokens[j];
      if (/^[a-z][a-z0-9_.]{3,31}$/i.test(t) && !COMMON.has(t) && !GAME_TOKEN_RE.test(t)) return true;
    }
  }
  return false;
}

/**
 * Проверяет одно сообщение само по себе (без учёта истории).
 * @returns {{blocked: boolean, reason: string|null, code?: string}}
 */
function checkMessage(rawText) {
  const text = normalizeText(rawText).trim();
  if (!text) return { blocked: true, reason: 'Сообщение не может быть пустым', code: 'empty' };

  const block = (code) => ({ blocked: true, reason: REASONS[code], code });

  if (EMAIL_RE.test(text)) return block('email');
  if (LINK_RE.test(text) || DOMAIN_RE.test(text) || SPELLED_DOMAIN_RE.test(text)) return block('link');
  if (AT_HANDLE_RE.test(text)) return block('contact');

  const digitText = toDigitText(text);
  if (CARD_RE.test(digitText)) return block('card');
  if (PHONE_RES.some((re) => re.test(digitText))) return block('phone');
  // Номер, разбавленный словами в одном сообщении: «7 там 900 потом 200 30 40»
  const groups = digitText.match(/\d+/g) || [];
  if (groups.length >= 3) {
    const all = groups.join('');
    if (looksLikePhoneDigits(all) || (all.length >= 10 && all.length <= 12 && /^(7|8)?9/.test(all)) || /^(7|8)\d{10}$/.test(all)) return block('phone');
  }

  const banned = findBannedName(text);
  if (banned) return block(banned);

  for (const re of CONTACT_PHRASES) {
    if (re.test(text)) return block('contact');
  }

  if (findHandleToken(text)) return block('handle');
  if (latinWordNearContactKeyword(text)) return block('contact');

  // Слово «номер/телефон/звони», а сразу после него цифры (5+) — это телефон.
  // Смотрим только на кусок текста после слова, чтобы «отвязка телефона …
  // 2146 часов» в описании аккаунта не считалось номером.
  const phoneWord = PHONE_WORD_RE.exec(text);
  if (phoneWord) {
    const after = text.slice(phoneWord.index + phoneWord[0].length, phoneWord.index + phoneWord[0].length + 40);
    if (extractDigits(after).length >= 5) return block('phone');
  }

  return { blocked: false, reason: null };
}

// ---------- Номер по частям в нескольких сообщениях ----------

// Сообщение «из одних цифр»: после перевода чисел словами в цифры в нём
// почти не остаётся букв (допускаются связки «и», «дальше», «потом»…).
const FILLER_WORDS = new Set(['и', 'а', 'еще', 'ещё', 'дальше', 'далее', 'потом', 'затем', 'там', 'вот', 'ну', 'так', 'это', 'после', 'конец', 'начало', 'плюс', 'тире', 'и', 'остальное', 'продолжение']);
function isNumericMessage(text) {
  const digitText = toDigitText(text);
  if (!/\d/.test(digitText)) return false;
  const words = digitText.toLowerCase().split(/[^a-zа-я]+/i).filter(Boolean).filter((w) => !FILLER_WORDS.has(w));
  return words.join('').length <= 2;
}

/**
 * Проверяет новое сообщение вместе с недавними сообщениями этого же
 * отправителя: ловит номер, который пишут «в столбик» — «7», «900», «200»…
 * Блокирует, как только набранные подряд числа уже похожи на начало номера.
 */
function checkConversation(newText, recentBodies) {
  const all = [...(recentBodies || []), newText];
  // Берём хвост подряд идущих «числовых» сообщений, заканчивая новым
  const run = [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (!isNumericMessage(all[i])) break;
    run.unshift(all[i]);
  }
  if (run.length >= 2) {
    const digits = run.map(extractDigits).join('');
    const plusStart = /^\s*(\+|плюс)/i.test(toDigitText(run[0]));
    if (digits.length >= 7 && (/^(7|8)9/.test(digits) || plusStart || /^9\d{2}/.test(digits))) {
      return { blocked: true, reason: 'Похоже, вы передаёте номер телефона по частям — это запрещено.', code: 'phone_split' };
    }
    if (digits.length >= 10) {
      return { blocked: true, reason: 'Похоже, вы передаёте номер или реквизиты по частям — это запрещено.', code: 'phone_split' };
    }
  }

  // «Вот мой номер:» — и цифры следующим сообщением
  if (recentBodies && recentBodies.length) {
    const last = recentBodies[recentBodies.length - 1];
    if (PHONE_WORD_RE.test(normalizeText(last)) && isNumericMessage(newText) && extractDigits(newText).length >= 3) {
      return { blocked: true, reason: REASONS.phone, code: 'phone_split' };
    }
  }

  // Ник/контакт по частям: «мой тг» в одном сообщении, ник — в следующем
  const prev = recentBodies && recentBodies.length ? recentBodies[recentBodies.length - 1] : '';
  if (prev && hasContactKeyword(prev) && /^[a-z][a-z0-9_.]{3,31}$/i.test(normalizeText(newText).trim()) && !GAME_TOKEN_RE.test(normalizeText(newText).trim())) {
    return { blocked: true, reason: REASONS.contact, code: 'handle_split' };
  }
  const merged = [prev, newText].filter(Boolean).join(' ');
  if (prev) {
    const banned = findBannedName(merged);
    if (banned && !findBannedName(prev)) {
      return { blocked: true, reason: REASONS[banned], code: `${banned}_split` };
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Лёгкий триггер для ИИ-модерации: много цифр в последних сообщениях —
 * пусть ИИ посмотрит на контекст. Сам по себе ничего не блокирует.
 */
function hasSuspiciousDigitRun(newText, recentBodies) {
  const combinedDigits = [...(recentBodies || []), newText].map(extractDigits).join('');
  return /\d{9,}/.test(combinedDigits);
}

/** Резервная проверка, если ИИ-модерация недоступна. */
function checkPhoneSplitting(newText, recentBodies) {
  const combinedDigits = [...(recentBodies || []), newText].map(extractDigits).join('');
  if (/(7|8)?9\d{9}/.test(combinedDigits) || /\d{11,}/.test(combinedDigits)) {
    return { blocked: true, reason: 'Похоже, вы передаёте номер телефона по частям в нескольких сообщениях — это тоже запрещено' };
  }
  return { blocked: false, reason: null };
}

module.exports = {
  checkMessage,
  checkConversation,
  checkPhoneSplitting,
  hasSuspiciousDigitRun,
  // для тестов
  _internal: { skeleton, wordsToDigits, toDigitText, findHandleToken, findBannedName, isNumericMessage },
};
