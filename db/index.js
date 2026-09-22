const path = require('path');
const fs = require('fs');
// Встроенный в Node.js SQLite: ничего не нужно компилировать при установке,
// поэтому `npm install` работает на Windows без Visual Studio.
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, 'database.sqlite');

if (!fs.existsSync(dbPath)) {
  // Первый запуск: создаём и наполняем базу
  require('./init.js');
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

// Встроенные в SQLite lower()/LIKE регистронезависимы только для ASCII,
// кириллицу ("Бравл" vs "бравл") они не приводят. Регистрируем свою
// функцию на JS, где toLowerCase() корректно работает с юникодом.
db.function('lower_ru', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase()));

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
