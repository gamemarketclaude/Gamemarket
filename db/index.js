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

module.exports = db;
