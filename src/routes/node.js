'use strict';
const express = require('express');
const { query } = require('../db');
const { sha256 } = require('../services/tokens');
const { nodeLimiter } = require('../middleware/security');

const router = express.Router();

/** Агент на VPN-сервере забирает список активных клиентов. Auth: Bearer <токен ноды>. */
router.get('/api/node/clients', nodeLimiter, async (req, res, next) => {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '');
  if (!m) return res.sendStatus(401);
  try {
    const { rows } = await query(
      'UPDATE nodes SET last_sync_at = now() WHERE token_hash = $1 AND is_active RETURNING id',
      [sha256(m[1])]
    );
    if (!rows[0]) return res.sendStatus(401);
    const { rows: subs } = await query(
      'SELECT user_id, client_uuid FROM subscriptions WHERE expires_at > now() ORDER BY user_id'
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      clients: subs.map((s) => ({ id: s.client_uuid, email: `u${s.user_id}`, flow: 'xtls-rprx-vision' })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
