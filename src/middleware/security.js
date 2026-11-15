'use strict';
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { safeEqual } = require('../services/tokens');
const { query } = require('../db');

/** CSRF: synchronizer token в сессии, проверяется на всех мутирующих запросах. */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('base64url');
  res.locals.csrf = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.body && req.body._csrf;
  if (typeof token !== 'string' || !safeEqual(token, req.session.csrf)) {
    return res.status(403).render('error', { title: 'Ошибка', message: 'Сессия устарела, обновите страницу и повторите.' });
  }
  next();
}

async function loadUser(req, res, next) {
  res.locals.user = null;
  if (!req.session.userId) return next();
  try {
    const { rows } = await query('SELECT id, email, is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (!rows[0]) return req.session.destroy(() => res.redirect('/login'));
    req.user = rows[0];
    res.locals.user = rows[0];
    next();
  } catch (e) { next(e); }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) return res.status(404).render('error', { title: 'Не найдено', message: 'Страница не найдена.' });
  next();
}

function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  next();
}

const limiter = (windowMs, limit) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false });

module.exports = {
  csrf, loadUser, requireAuth, requireAdmin, flash,
  authLimiter: limiter(15 * 60 * 1000, 20),
  payLimiter: limiter(60 * 1000, 10),
  subLimiter: limiter(60 * 1000, 60),
  nodeLimiter: limiter(60 * 1000, 120),
};
