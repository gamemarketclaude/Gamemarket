// ---------------------------------------------------------------------------
// Фильтр сообщений чата.
// Задача: не дать продавцу/покупателю увести сделку с площадки —
// через ссылку, прямой контакт или упоминание сторонней площадки,
// даже если это написано с ухищрениями (другими буквами, вразрядку,
// по частям в нескольких сообщениях).
//
// Ключевая идея: сравнение идёт СЛОВО В СЛОВО (полное совпадение "скелета"
// слова), а не поиск подстроки по всему сообщению целиком — это защищает
// от ложных срабатываний вроде "оплатить" из-за "plati".
// ---------------------------------------------------------------------------

const BANNED_SITES = [
  'funpay', 'фанпей',
  'playerok', 'плеерок', 'плейрок',
  'lolzteam', 'lolz', 'zelenka',
  'plati', 'digiseller',
  'eldorado',
  // g2g сюда намеренно не включаем как "скелет" — слишком похоже на игровое "гг" (good game)
];
const BANNED_SITES_EXACT_ONLY = ['g2g']; // проверяем только точным вхождением строки, не скелетом

const CONTACT_APP_NAMES = [
  'telegram', 'телеграмм', 'телеграм',
  'whatsapp', 'ватсап', 'вотсап', 'вацап',
  'viber', 'вайбер',
  'discord', 'дискорд',
];

// Транслитерация кириллицы в латиницу (упрощённая, фонетическая)
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'a',
};
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

function transliterate(text) {
  return text.toLowerCase().split('').map(ch => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join('');
}

// "Скелет" слова: транслит + только латинские буквы + без гласных.
// "funpay", "фанпей", "fanpey" — всё даёт один и тот же скелет "fnp".
function skeleton(word) {
  const translit = transliterate(word);
  const lettersOnly = translit.replace(/[^a-z]/g, '');
  let result = '';
  for (const ch of lettersOnly) {
    if (!VOWELS.has(ch)) result += ch;
  }
  return result;
}

const BANNED_SITE_SKELETONS = new Set(BANNED_SITES.map(skeleton).filter(sk => sk.length >= 3));
const CONTACT_APP_SKELETONS = new Set(CONTACT_APP_NAMES.map(skeleton).filter(sk => sk.length >= 3));

// Схлопывает разрядку по буквам: "ф а н п е й" -> "фанпей", "f-u-n-p-a-y" -> "funpay",
// работает и когда буквы разделены пробелами, и когда через дефис/точку внутри одного "слова".
function collapseSpacedLetters(text) {
  const rawTokens = text.split(/\s+/);
  const merged = [];
  let buffer = '';

  const flushBuffer = () => {
    if (buffer) { merged.push(buffer); buffer = ''; }
  };

  for (const tok of rawTokens) {
    // Внутри токена: если это несколько одиночных букв через дефис/точку/подчёркивание — склеиваем
    const subparts = tok.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
    let collapsedTok = tok;
    if (subparts.length >= 3 && subparts.every(p => p.length === 1)) {
      collapsedTok = subparts.join('');
    }

    const core = collapsedTok.replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi, '');
    if (/^[a-zа-яё]$/i.test(core)) {
      buffer += core;
    } else {
      flushBuffer();
      merged.push(collapsedTok);
    }
  }
  flushBuffer();
  return merged.join(' ');
}

// Находит подряд идущие "разрядки по буквам" (последовательности из 3+ токенов
// длиной ровно 1 буква). Нужно отдельно от collapseSpacedLetters, потому что
// короткий предлог перед разрядкой ("в т е л е г р а м") иначе портит "скелет" —
// нужно уметь проверить вариант и без такого предлога на границе.
function findSingleLetterRuns(text) {
  const tokens = text.split(/\s+/);
  const runs = [];
  let current = [];
  for (const tok of tokens) {
    const core = tok.replace(/^[^a-zа-яё]+|[^a-zа-яё]+$/gi, '');
    if (/^[a-zа-яё]$/i.test(core)) {
      current.push(core.toLowerCase());
    } else {
      if (current.length >= 3) runs.push(current);
      current = [];
    }
  }
  if (current.length >= 3) runs.push(current);
  return runs;
}

// Слова-числительные -> цифры, чтобы ловить номер, продиктованный словами
const NUMBER_WORDS = {
  ноль: '0', один: '1', одна: '1', два: '2', две: '2', три: '3', четыре: '4',
  пять: '5', шесть: '6', семь: '7', восемь: '8', девять: '9',
};

function wordsToDigits(text) {
  let result = text.toLowerCase();
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    result = result.replace(new RegExp('\\b' + word + '\\b', 'g'), digit);
  }
  return result;
}

function extractDigits(text) {
  return (wordsToDigits(text).match(/\d/g) || []).join('');
}

const LINK_REGEX = /(https?:\/\/|www\.)\S+/i;
const DOMAIN_REGEX = /\b[a-zа-я0-9-]{2,}\.(ru|com|net|org|io|shop|site|store|market|me|ws|gg|su)\b/i;
const CONTACT_REGEX = /(@[a-zA-Z0-9_]{4,32})|(\bt\.me\/)|(\bтг\b)/i;

/**
 * Проверяет одно сообщение само по себе (без учёта истории).
 */
function checkMessage(rawText) {
  const text = (rawText || '').trim();
  if (!text) {
    return { blocked: true, reason: 'Сообщение не может быть пустым' };
  }

  const lower = text.toLowerCase();

  for (const site of BANNED_SITES_EXACT_ONLY) {
    if (lower.includes(site)) {
      return { blocked: true, reason: 'Упоминание сторонних площадок в чате запрещено' };
    }
  }

  if (LINK_REGEX.test(text) || DOMAIN_REGEX.test(text)) {
    return { blocked: true, reason: 'Ссылки в чате запрещены' };
  }
  if (CONTACT_REGEX.test(text)) {
    return { blocked: true, reason: 'Обмен контактами (телефон, Telegram, WhatsApp, Discord и т.п.) запрещён — все сделки должны проходить через площадку' };
  }

  // Сравнение по словам (после схлопывания разрядки) — ловит разные написания
  // и транслит, но не путает с обычными словами вроде "оплатить".
  // Дополнительно проверяем окна из 1–3 соседних слов — это ловит разбивку
  // названия по слогам через пробел/дефис ("фан пей", "плеер ок").
  const collapsed = collapseSpacedLetters(text);
  const words = collapsed.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
  const wordSkeletons = words.map(skeleton);

  for (let windowSize = 1; windowSize <= 3; windowSize++) {
    for (let i = 0; i + windowSize <= wordSkeletons.length; i++) {
      const combined = wordSkeletons.slice(i, i + windowSize).join('');
      if (!combined) continue;
      if (BANNED_SITE_SKELETONS.has(combined)) {
        return { blocked: true, reason: 'Похоже на название сторонней площадки (в том числе написанное другими буквами) — это запрещено' };
      }
      if (CONTACT_APP_SKELETONS.has(combined)) {
        return { blocked: true, reason: 'Упоминание мессенджеров для связи в обход площадки запрещено' };
      }
    }
  }

  // Дополнительно: разрядки по буквам, к которым вплотную примыкает короткое
  // слово (предлог, союз) на границе — пробуем варианты с обрезкой 1-2 токенов
  // с любого края, чтобы не терять реальную разрядку из-за соседнего "в"/"на".
  for (const run of findSingleLetterRuns(text)) {
    for (let start = 0; start <= 2 && run.length - start >= 3; start++) {
      for (let end = run.length; end - start >= 3 && run.length - end <= 2; end--) {
        const sk = skeleton(run.slice(start, end).join(''));
        if (!sk) continue;
        if (BANNED_SITE_SKELETONS.has(sk)) {
          return { blocked: true, reason: 'Похоже на название сторонней площадки (в том числе написанное другими буквами) — это запрещено' };
        }
        if (CONTACT_APP_SKELETONS.has(sk)) {
          return { blocked: true, reason: 'Упоминание мессенджеров для связи в обход площадки запрещено' };
        }
      }
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Лёгкая эвристика-триггер: стоит ли вообще беспокоить ИИ-модерацию проверкой
 * на "номер по частям"? Считает цифры в последних сообщениях + новом.
 * Сама по себе НЕ блокирует — просто сигнализирует "тут может быть телефон,
 * пусть ИИ посмотрит на контекст".
 */
function hasSuspiciousDigitRun(newText, recentBodies) {
  const combinedDigits = [...recentBodies, newText].map(extractDigits).join('');
  return /\d{9,}/.test(combinedDigits);
}

/**
 * Проверяет, не пытается ли человек передать номер телефона по частям —
 * используется как РЕЗЕРВНАЯ проверка, если ИИ-модерация недоступна
 * (нет API-ключа или ошибка запроса).
 */
function checkPhoneSplitting(newText, recentBodies) {
  const combinedDigits = [...recentBodies, newText].map(extractDigits).join('');
  if (/\d{9,}/.test(combinedDigits)) {
    return { blocked: true, reason: 'Похоже, вы передаёте номер телефона по частям в нескольких сообщениях — это тоже запрещено' };
  }
  return { blocked: false, reason: null };
}

module.exports = { checkMessage, checkPhoneSplitting, hasSuspiciousDigitRun };
