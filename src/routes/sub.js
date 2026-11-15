'use strict';
const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { SUB_TOKEN_RE } = require('../services/tokens');
const { vlessRealityLink } = require('../services/xray');
const { subLimiter } = require('../middleware/security');

const router = express.Router();

/**
 * URL подписки, который пользователь вставляет в Happ / v2RayTun.
 * Формат: base64 от списка ссылок через \n + заголовки, которые эти клиенты понимают.
 */
router.get('/sub/:token', subLimiter, async (req, res, next) => {
  const { token } = req.params;
  if (!SUB_TOKEN_RE.test(token)) return res.sendStatus(404);
  try {
    const { rows } = await query(
      'SELECT client_uuid, expires_at, expires_at > now() AS active FROM subscriptions WHERE sub_token = $1',
      [token]
    );
    const sub = rows[0];
    if (!sub) return res.sendStatus(404);

    let links = [];
    if (sub.active) {
      const { rows: nodes } = await query(
        'SELECT name, host, port, sni, public_key, short_id FROM nodes WHERE is_active ORDER BY id'
      );
      links = nodes.map((n) => vlessRealityLink(n, sub.client_uuid));
    }

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'profile-title': 'base64:' + Buffer.from(config.brandName).toString('base64'),
      'profile-update-interval': '6',
      'subscription-userinfo': `upload=0; download=0; total=0; expire=${Math.floor(new Date(sub.expires_at).getTime() / 1000)}`,
      'profile-web-page-url': config.publicUrl,
    });
    if (config.supportUrl) res.set('support-url', config.supportUrl);
    res.send(Buffer.from(links.join('\n')).toString('base64'));
  } catch (e) { next(e); }
});

module.exports = router;
