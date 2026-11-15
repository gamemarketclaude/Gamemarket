'use strict';
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM plans');
  if (rows[0].n === 0) {
    await pool.query(
      `INSERT INTO plans (name, days, price_kopecks) VALUES
       ('1 месяц', 30, 19900), ('3 месяца', 90, 49900), ('12 месяцев', 365, 169000)`
    );
    console.log('Добавлены тарифы по умолчанию (цены поменяйте в админке)');
  }
  console.log('Миграция выполнена');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
