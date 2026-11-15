'use strict';
const crypto = require('crypto');

const newSubToken = () => crypto.randomBytes(24).toString('base64url'); // 32 символа
const newNodeToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = { newSubToken, newNodeToken, sha256, safeEqual, SUB_TOKEN_RE: /^[A-Za-z0-9_-]{32}$/ };
