'use strict';
// Использование: npm run make-admin -- user@example.com
const { pool } = require('../db');

(async () => {
  const email = process.argv[2];
  if (!email) throw new Error('Укажите email: npm run make-admin -- user@example.com');
  const { rowCount } = await pool.query('UPDATE users SET is_admin = true WHERE email = $1', [email]);
  console.log(rowCount ? 'Готово: пользователь стал админом' : 'Пользователь не найден (сначала зарегистрируйтесь на сайте)');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
