'use strict';
const express = require('express');
const argon2 = require('argon2');
const { z } = require('zod');
const { tx, query } = require('../db');
const { createSubscription } = require('../services/subscription');
const { authLimiter } = require('../middleware/security');

const router = express.Router();

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Хеш-пустышка, чтобы время ответа не выдавало, существует ли email.
const dummyHashP = argon2.hash('dummy-password-for-timing', ARGON);

const credsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, 'Пароль — минимум 10 символов').max(128),
});

function loginSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

router.get('/register', (req, res) => res.render('register', { title: 'Регистрация', error: null, email: '' }));
router.get('/login', (req, res) => res.render('login', { title: 'Вход', error: null, email: '' }));

router.post('/register', authLimiter, async (req, res, next) => {
  const parsed = credsSchema.safeParse(req.body);
  const email = typeof req.body.email === 'string' ? req.body.email.slice(0, 254) : '';
  if (!parsed.success) {
    return res.status(400).render('register', { title: 'Регистрация', error: parsed.error.issues[0].message, email });
  }
  try {
    const hash = await argon2.hash(parsed.data.password, ARGON);
    const userId = await tx(async (c) => {
      const { rows } = await c.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id',
        [parsed.data.email, hash]
      );
      if (!rows[0]) return null;
      await createSubscription(c, rows[0].id);
      return rows[0].id;
    });
    if (!userId) {
      return res.status(400).render('register', { title: 'Регистрация', error: 'Этот email уже зарегистрирован', email });
    }
    await loginSession(req, userId);
    res.redirect('/');
  } catch (e) { next(e); }
});

router.post('/login', authLimiter, async (req, res, next) => {
  const parsed = credsSchema.safeParse(req.body);
  const email = typeof req.body.email === 'string' ? req.body.email.slice(0, 254) : '';
  const fail = () => res.status(400).render('login', { title: 'Вход', error: 'Неверный email или пароль', email });
  if (!parsed.success) return fail();
  try {
    const { rows } = await query('SELECT id, password_hash FROM users WHERE email = $1', [parsed.data.email]);
    const hash = rows[0] ? rows[0].password_hash : await dummyHashP;
    const ok = await argon2.verify(hash, parsed.data.password);
    if (!rows[0] || !ok) return fail();
    await loginSession(req, rows[0].id);
    res.redirect('/');
  } catch (e) { next(e); }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.redirect('/');
  });
});

module.exports = router;
