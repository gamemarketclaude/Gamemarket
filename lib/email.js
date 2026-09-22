// ---------------------------------------------------------------------------
// Работа с почтой при регистрации/входе/бане.
//
// normalizeEmail() приводит адрес к «каноническому» виду, по которому мы
// проверяем уникальность и бан. Нужно, чтобы забаненный пользователь не мог
// зарегистрироваться заново тем же ящиком, просто написав его по-другому:
//   Ivan.Petrov+gv@GMAIL.com  ->  ivanpetrov@gmail.com
// Письма на все эти варианты приходят в один и тот же ящик.
// ---------------------------------------------------------------------------

// Домены-синонимы одного и того же почтового сервиса
const DOMAIN_ALIASES = {
  'googlemail.com': 'gmail.com',
  'ya.ru': 'yandex.ru',
  'yandex.com': 'yandex.ru',
  'yandex.by': 'yandex.ru',
  'yandex.kz': 'yandex.ru',
  'yandex.ua': 'yandex.ru',
};

// Простая, но строгая проверка формата: одна @, без пробелов, в домене есть точка.
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function isValidEmail(raw) {
  const email = String(raw || '').trim();
  return email.length <= 254 && EMAIL_RE.test(email);
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;

  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  domain = DOMAIN_ALIASES[domain] || domain;

  // «ivan+что-угодно@…» доставляется в ящик «ivan@…» у большинства сервисов
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);

  // Gmail игнорирует точки в имени ящика, Яндекс считает точку и дефис одним и тем же
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (domain === 'yandex.ru') local = local.replace(/\./g, '-');

  return `${local}@${domain}`;
}

module.exports = { isValidEmail, normalizeEmail };
