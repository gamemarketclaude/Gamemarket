'use strict';
const express = require('express');
const QRCode = require('qrcode');
const config = require('../config');
const { query, tx } = require('../db');
const { requireAuth } = require('../middleware/security');
const { rotateSubscription } = require('../services/subscription');

const router = express.Router();

async function activePlans() {
  const { rows } = await query('SELECT id, name, days, price_kopecks FROM plans WHERE is_active ORDER BY days');
  return rows;
}

router.get('/', async (req, res, next) => {
  try {
    const plans = await activePlans();
    if (!req.user) return res.render('index', { title: config.brandName, plans });

    const { rows } = await query(
      'SELECT sub_token, expires_at, expires_at > now() AS active FROM subscriptions WHERE user_id = $1',
      [req.user.id]
    );
    const sub = rows[0];
    const subUrl = `${config.publicUrl}/sub/${sub.sub_token}`;
    const qr = await QRCode.toDataURL(subUrl, { margin: 1, width: 220 });
    const { rows: payments } = await query(
      `SELECT p.created_at, p.amount_kopecks, p.days, p.status, pl.name
         FROM payments p JOIN plans pl ON pl.id = p.plan_id
        WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.render('dashboard', {
      title: 'Личный кабинет',
      sub, subUrl, qr, plans, payments,
      happLink: `happ://add/${subUrl}`,
      v2raytunLink: `v2raytun://import/${subUrl}`,
      paymentsEnabled: config.yookassa.enabled,
    });
  } catch (e) { next(e); }
});

router.post('/subscription/rotate', requireAuth, async (req, res, next) => {
  try {
    await tx((c) => rotateSubscription(c, req.user.id));
    req.flash('ok', 'Ссылка перевыпущена. Старая больше не работает — добавьте новую в приложение.');
    res.redirect('/');
  } catch (e) { next(e); }
});

module.exports = router;
