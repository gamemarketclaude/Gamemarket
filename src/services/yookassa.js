'use strict';
const config = require('../config');

const API = 'https://api.yookassa.ru/v3';
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authHeader() {
  const { shopId, secretKey } = config.yookassa;
  return 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64');
}

const kopecksToValue = (k) => (k / 100).toFixed(2);
function valueToKopecks(v) {
  if (typeof v !== 'string' || !/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
  const [r, f = ''] = v.split('.');
  return parseInt(r, 10) * 100 + parseInt(f.padEnd(2, '0'), 10);
}

async function createPayment({ paymentId, amountKopecks, description, returnUrl }) {
  const res = await fetch(`${API}/payments`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Idempotence-Key': paymentId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: { value: kopecksToValue(amountKopecks), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: returnUrl },
      description: description.slice(0, 128),
      metadata: { payment_id: paymentId },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`YooKassa create payment: HTTP ${res.status}`);
  return res.json();
}

/** Источник истины о платеже — только этот запрос к API, а не тело вебхука. */
async function getPayment(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const res = await fetch(`${API}/payments/${id}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`YooKassa get payment: HTTP ${res.status}`);
  return res.json();
}

module.exports = { createPayment, getPayment, valueToKopecks, kopecksToValue };
