const path = require('path');
const fs = require('fs');
// Встроенный в Node.js SQLite: ничего не нужно компилировать при установке,
// поэтому `npm install` работает на Windows без Visual Studio.
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_VERSION } = require('./schema');

const dbPath = path.join(__dirname, 'database.sqlite');

// База от старой версии сайта (например, со входом по логину вместо почты)
// несовместима с текущим кодом. Не удаляем её, а откладываем в сторону как
// резервную копию и создаём новую — так обновление не падает с ошибкой.
// Обновления, которые можно применить к существующей базе без потери данных:
// ключ — версия, С КОТОРОЙ обновляем.
const MIGRATIONS = {
  2: `
    ALTER TABLE products ADD COLUMN attributes TEXT;
    CREATE TABLE IF NOT EXISTS moderation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      source TEXT NOT NULL,
      body TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
};

if (fs.existsSync(dbPath)) {
  const probe = new DatabaseSync(dbPath);
  let { user_version: version } = probe.prepare('PRAGMA user_version').get();
  // Сначала пробуем обновить базу «на месте» — пользователи и объявления сохраняются
  while (version !== SCHEMA_VERSION && MIGRATIONS[version]) {
    probe.exec('BEGIN');
    try {
      probe.exec(MIGRATIONS[version]);
      probe.exec(`PRAGMA user_version = ${version + 1}`);
      probe.exec('COMMIT');
      console.log(`[GearVault] База обновлена: версия ${version} → ${version + 1}`);
      version += 1;
    } catch (err) {
      probe.exec('ROLLBACK');
      console.error('[GearVault] Не удалось обновить базу на месте:', err.message);
      break;
    }
  }
  probe.close();
  // Если обновить на месте нельзя (слишком старая версия) — откладываем
  // старый файл как резервную копию и создаём новую базу
  if (version !== SCHEMA_VERSION) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(__dirname, `database.backup-v${version}-${stamp}.sqlite`);
    fs.renameSync(dbPath, backupPath);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.renameSync(dbPath + suffix, backupPath + suffix);
    }
    console.log(`[GearVault] Старая база (версия ${version}) сохранена как ${path.basename(backupPath)}, создаю новую (версия ${SCHEMA_VERSION}).`);
  }
}

if (!fs.existsSync(dbPath)) {
  // Первый запуск: создаём и наполняем базу
  require('./init.js');
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

// Встроенные в SQLite lower()/LIKE регистронезависимы только для ASCII,
// кириллицу ("Бравл" vs "бравл") они не приводят. Регистрируем свою
// функцию на JS, где toLowerCase() корректно работает с юникодом.
// Заодно ё приравнивается к е, чтобы «ежик» находил «Ёжик».
db.function('lower_ru', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase().replace(/ё/g, 'е')));

// Обёртка транзакции: всё внутри fn либо применяется целиком, либо откатывается,
// если fn бросила исключение.
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN');
  try {
    const result = fn(...args);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

module.exports = db;
