'use strict';
const crypto = require('crypto');
const { newSubToken } = require('./tokens');

/** Продлевает подписку на days дней. Вызывать ТОЛЬКО внутри транзакции (client из tx()). */
async function extendSubscription(client, userId, days) {
  if (!Number.isInteger(days) || days <= 0 || days > 3660) throw new Error('bad days');
  const { rows } = await client.query(
    'SELECT user_id FROM subscriptions WHERE user_id = $1 FOR UPDATE', [userId]
  );
  if (!rows[0]) throw new Error('subscription not found');
  await client.query(
    `UPDATE subscriptions
        SET expires_at = GREATEST(expires_at, now()) + make_interval(days => $2::int)
      WHERE user_id = $1`,
    [userId, days]
  );
}

/** Новый UUID клиента и новый токен — старая ссылка и старый ключ перестают работать. */
async function rotateSubscription(client, userId) {
  await client.query(
    'UPDATE subscriptions SET client_uuid = $2, sub_token = $3 WHERE user_id = $1',
    [userId, crypto.randomUUID(), newSubToken()]
  );
}

async function createSubscription(client, userId) {
  await client.query(
    'INSERT INTO subscriptions (user_id, client_uuid, sub_token) VALUES ($1, $2, $3)',
    [userId, crypto.randomUUID(), newSubToken()]
  );
}

module.exports = { extendSubscription, rotateSubscription, createSubscription };
