// Бан/разбан по почте из командной строки — на случай, если админка
// (ADMIN_EMAILS в .env) ещё не настроена.
//
//   npm run ban -- ivan@mail.ru "мошенничество"
//   npm run unban -- ivan@mail.ru
//   npm run ban -- --list
const db = require('../db');
const { isValidEmail, normalizeEmail } = require('../lib/email');

const [action, email, ...reasonParts] = process.argv.slice(2);

if (action === 'list' || email === '--list') {
  const rows = db.prepare('SELECT * FROM banned_emails ORDER BY created_at DESC').all();
  if (!rows.length) console.log('Забаненных почт нет.');
  rows.forEach((r) => console.log(`${r.email_normalized}\t${r.created_at}\t${r.reason || ''}`));
  process.exit(0);
}

if (!['ban', 'unban'].includes(action) || !email || !isValidEmail(email)) {
  console.log('Использование:\n  npm run ban -- почта@пример.ru "причина"\n  npm run unban -- почта@пример.ru\n  npm run ban -- --list');
  process.exit(1);
}

const emailNormalized = normalizeEmail(email);

if (action === 'ban') {
  const reason = reasonParts.join(' ').trim().slice(0, 200) || null;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO banned_emails (email_normalized, reason) VALUES (?, ?)
      ON CONFLICT(email_normalized) DO UPDATE SET reason = excluded.reason
    `).run(emailNormalized, reason);
    const { changes } = db.prepare('UPDATE users SET is_banned = 1 WHERE email_normalized = ?').run(emailNormalized);
    console.log(`Почта ${emailNormalized} забанена.` + (changes ? ' Аккаунт с ней заблокирован.' : ' Аккаунта с ней пока нет — зарегистрировать его не получится.'));
  })();
} else {
  db.transaction(() => {
    db.prepare('DELETE FROM banned_emails WHERE email_normalized = ?').run(emailNormalized);
    db.prepare('UPDATE users SET is_banned = 0 WHERE email_normalized = ?').run(emailNormalized);
  })();
  console.log(`Почта ${emailNormalized} разбанена.`);
}
