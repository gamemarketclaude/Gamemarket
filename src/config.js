'use strict';
require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name}`);
  return v;
}

function optionalUrl(name) {
  const v = process.env[name];
  if (!v) return '';
  const u = new URL(v); // бросит ошибку на мусоре
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`${name}: только http(s)`);
  return u.toString();
}

const isProd = process.env.NODE_ENV === 'production';

const sessionSecret = required('SESSION_SECRET');
if (sessionSecret.length < 32 || sessionSecret === 'CHANGE_ME') {
  throw new Error('SESSION_SECRET должен быть случайной строкой длиной >= 32 символов');
}

const publicUrl = required('PUBLIC_URL').replace(/\/+$/, '');
if (isProd && !publicUrl.startsWith('https://')) {
  throw new Error('В production PUBLIC_URL должен быть https://');
}

const brandName = (process.env.BRAND_NAME || 'VPN').slice(0, 64);

module.exports = {
  isProd,
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  sessionSecret,
  publicUrl,
  brandName,
  supportUrl: optionalUrl('SUPPORT_URL'),
  yookassa: {
    shopId: process.env.YOOKASSA_SHOP_ID || '',
    secretKey: process.env.YOOKASSA_SECRET_KEY || '',
    get enabled() { return Boolean(this.shopId && this.secretKey); },
  },
};
