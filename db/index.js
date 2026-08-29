const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  // Первый запуск: создаём и наполняем базу
  require('./init.js');
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// SQLite's встроенный lower()/LIKE регистронезависим только для ASCII —
// кириллица ("Бравл" vs "бравл") им не приводится. Регистрируем свою
// функцию на JS, где toLowerCase() корректно работает с юникодом.
db.function('lower_ru', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

module.exports = db;
