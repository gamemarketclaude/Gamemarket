'use strict';
const express = require('express');
const { z } = require('zod');
const { query, tx } = require('../db');
const { requireAdmin } = require('../middleware/security');
const { extendSubscription } = require('../services/subscription');
const { newNodeToken, sha256 } = require('../services/tokens');

const router = express.Router();
router.use('/admin', requireAdmin);

const notFound = (res) => res.status(404).render('error', { title: 'Не найдено', message: 'Запись не найдена.' });
const idParam = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

router.get('/admin', async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    const [users, nodes, plans, stats] = await Promise.all([
      query(
        `SELECT u.id, u.email, u.created_at, s.expires_at, s.expires_at > now() AS active
           FROM users u JOIN subscriptions s ON s.user_id = u.id
          WHERE u.email ILIKE $1 ORDER BY u.id DESC LIMIT 100`, [like]),
      query('SELECT id, name, host, port, sni, is_active, last_sync_at FROM nodes ORDER BY id'),
      query('SELECT id, name, days, price_kopecks, is_active FROM plans ORDER BY days'),
      query(`SELECT (SELECT count(*) FROM users)::int AS users,
                    (SELECT count(*) FROM subscriptions WHERE expires_at > now())::int AS active,
                    (SELECT coalesce(sum(amount_kopecks),0) FROM payments
                      WHERE status = 'succeeded' AND paid_at > now() - interval '30 days')::bigint AS revenue30`),
    ]);
    res.render('admin', { title: 'Админка', q, users: users.rows, nodes: nodes.rows, plans: plans.rows, stats: stats.rows[0] });
  } catch (e) { next(e); }
});

const daysSchema = z.object({ days: z.coerce.number().int().min(1).max(3660) });

router.post('/admin/users/:id/extend', async (req, res, next) => {
  const id = idParam(req.params.id);
  const parsed = daysSchema.safeParse(req.body);
  if (!id) return notFound(res);
  if (!parsed.success) { req.flash('err', 'Дни: целое число 1–3660'); return res.redirect('/admin'); }
  try {
    const found = await tx(async (c) => {
      const { rows } = await c.query('SELECT 1 FROM users WHERE id = $1', [id]);
      if (!rows[0]) return false;
      await extendSubscription(c, id, parsed.data.days);
      return true;
    });
    if (!found) return notFound(res);
    req.flash('ok', `Подписка пользователя #${id} продлена на ${parsed.data.days} дн.`);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

router.post('/admin/users/:id/revoke', async (req, res, next) => {
  const id = idParam(req.params.id);
  if (!id) return notFound(res);
  try {
    const { rowCount } = await query('UPDATE subscriptions SET expires_at = now() WHERE user_id = $1', [id]);
    if (!rowCount) return notFound(res);
    req.flash('ok', `Подписка #${id} отключена`);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

const hostRe = /^(?=.{1,253}$)([a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}$|^[0-9a-fA-F:]{2,39}$/;
const nodeSchema = z.object({
  name: z.string().trim().min(1).max(64),
  host: z.string().trim().regex(hostRe, 'Некорректный host'),
  port: z.coerce.number().int().min(1).max(65535),
  sni: z.string().trim().regex(/^(?=.{1,253}$)([a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/, 'Некорректный SNI'),
  public_key: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/, 'Public key: 43 символа base64url (из xray x25519)'),
  short_id: z.string().trim().regex(/^([0-9a-f]{2}){0,8}$/, 'Short ID: hex, чётной длины, до 16 символов'),
});

router.post('/admin/nodes', async (req, res, next) => {
  const parsed = nodeSchema.safeParse(req.body);
  if (!parsed.success) { req.flash('err', parsed.error.issues[0].message); return res.redirect('/admin'); }
  try {
    const d = parsed.data;
    const token = newNodeToken();
    const { rows } = await query(
      `INSERT INTO nodes (name, host, port, sni, public_key, short_id, token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name`,
      [d.name, d.host, d.port, d.sni, d.public_key, d.short_id, sha256(token)]
    );
    res.set('Cache-Control', 'no-store');
    res.render('admin-node-token', { title: 'Токен сервера', node: rows[0], token });
  } catch (e) { next(e); }
});

async function toggle(table, req, res, next) {
  const id = idParam(req.params.id);
  if (!id) return notFound(res);
  try {
    // table — только из фиксированного списка ниже, не из запроса.
    const { rowCount } = await query(`UPDATE ${table} SET is_active = NOT is_active WHERE id = $1`, [id]);
    if (!rowCount) return notFound(res);
    res.redirect('/admin');
  } catch (e) { next(e); }
}
router.post('/admin/nodes/:id/toggle', (req, res, next) => toggle('nodes', req, res, next));
router.post('/admin/plans/:id/toggle', (req, res, next) => toggle('plans', req, res, next));

const planSchema = z.object({
  name: z.string().trim().min(1).max(64),
  days: z.coerce.number().int().min(1).max(3660),
  price_rub: z.coerce.number().positive().max(1_000_000),
});

router.post('/admin/plans', async (req, res, next) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) { req.flash('err', 'Тариф: проверьте название, дни и цену'); return res.redirect('/admin'); }
  try {
    const { name, days, price_rub } = parsed.data;
    await query('INSERT INTO plans (name, days, price_kopecks) VALUES ($1, $2, $3)', [name, days, Math.round(price_rub * 100)]);
    req.flash('ok', 'Тариф добавлен');
    res.redirect('/admin');
  } catch (e) { next(e); }
});

module.exports = router;
