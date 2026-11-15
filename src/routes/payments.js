'use strict';
const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { query, tx } = require('../db');
const yk = require('../services/yookassa');
const { extendSubscription } = require('../services/subscription');
const { requireAuth, payLimiter } = require('../middleware/security');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Роуты с сессией и CSRF. */
const router = express.Router();

router.post('/pay/:planId', requireAuth, payLimiter, async (req, res, next) => {
  if (!config.yookassa.enabled) {
    req.flash('err', 'Оплата пока не настроена.');
    return res.redirect('/');
  }
  const planId = Number(req.params.planId);
  if (!Number.isInteger(planId) || planId <= 0) return res.status(404).render('error', { title: 'Не найдено', message: 'Тариф не найден.' });
  try {
    // Цена и срок — только из БД.
    const { rows } = await query('SELECT id, name, days, price_kopecks FROM plans WHERE id = $1 AND is_active', [planId]);
    const plan = rows[0];
    if (!plan) return res.status(404).render('error', { title: 'Не найдено', message: 'Тариф не найден.' });

    const paymentId = crypto.randomUUID();
    await query(
      'INSERT INTO payments (id, user_id, plan_id, amount_kopecks, days) VALUES ($1, $2, $3, $4, $5)',
      [paymentId, req.user.id, plan.id, plan.price_kopecks, plan.days]
    );
    const remote = await yk.createPayment({
      paymentId,
      amountKopecks: plan.price_kopecks,
      description: `${config.brandName}: ${plan.name}`,
      returnUrl: `${config.publicUrl}/pay/return`,
    });
    await query('UPDATE payments SET provider_payment_id = $2 WHERE id = $1 AND user_id = $3', [paymentId, remote.id, req.user.id]);
    const url = remote.confirmation && remote.confirmation.confirmation_url;
    if (typeof url !== 'string' || !/^https:\/\/([a-z0-9-]+\.)*(yoomoney|yookassa)\.ru\//i.test(url)) {
      throw new Error('YooKassa: неожиданный confirmation_url');
    }
    res.redirect(303, url);
  } catch (e) { next(e); }
});

router.get('/pay/return', requireAuth, (req, res) => {
  req.flash('ok', 'Если оплата прошла, подписка продлится в течение минуты. Обновите страницу.');
  res.redirect('/');
});

/** Вебхук ЮKassa — без сессии и CSRF. */
const webhook = express.Router();

webhook.post('/webhooks/yookassa', express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    if (!config.yookassa.enabled) return res.sendStatus(404);
    const id = req.body && req.body.object && req.body.object.id;
    // ЮKassa не подписывает уведомления, поэтому телу НЕ доверяем: перезапрашиваем платёж из API.
    const remote = await yk.getPayment(id);
    if (!remote) return res.sendStatus(400);
    const localId = remote.metadata && remote.metadata.payment_id;
    if (typeof localId !== 'string' || !UUID_RE.test(localId)) return res.sendStatus(200);

    await tx(async (c) => {
      const { rows } = await c.query(
        'SELECT id, user_id, amount_kopecks, days, status FROM payments WHERE id = $1 AND provider_payment_id = $2 FOR UPDATE',
        [localId, remote.id]
      );
      const p = rows[0];
      if (!p || p.status !== 'pending') return; // идемпотентность: повторный вебхук ничего не делает

      if (remote.status === 'succeeded' && remote.paid === true) {
        const amount = yk.valueToKopecks(remote.amount && remote.amount.value);
        if (remote.amount.currency !== 'RUB' || amount !== p.amount_kopecks) {
          console.error(`payment ${p.id}: сумма не совпадает, подписка не продлена`);
          return;
        }
        await c.query("UPDATE payments SET status = 'succeeded', paid_at = now() WHERE id = $1", [p.id]);
        await extendSubscription(c, p.user_id, p.days);
      } else if (remote.status === 'canceled') {
        await c.query("UPDATE payments SET status = 'canceled' WHERE id = $1", [p.id]);
      }
    });
    res.sendStatus(200);
  } catch (e) { next(e); } // 500 → ЮKassa повторит доставку
});

module.exports = { router, webhook };
