'use strict';
/**
 * POST /api/sub — загрузить подписку провайдера от имени веб-версии.
 * Браузер не может сам (CORS), поэтому запрос делает сервер.
 * Ссылка подписки — секрет пользователя: НЕ логируем её и не храним.
 */
const dns = require('dns').promises;
const net = require('net');

const MAX_BODY = 2 * 1024 * 1024;
const PASS_HEADERS = ['profile-title', 'subscription-userinfo', 'announce', 'support-url', 'profile-update-interval'];

// Простой лимит запросов на инстанс (best effort: у serverless несколько инстансов).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 20;
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

async function readLimited(resp) {
  const reader = resp.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('too big'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  // Только со своего сайта (защита от использования как открытого прокси с чужих страниц).
  const origin = req.headers.origin || '';
  let originHost = '';
  try { originHost = new URL(origin).host; } catch { /* пусто */ }
  if (!originHost || originHost !== req.headers.host) return res.status(403).json({ error: 'origin' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Слишком много запросов, подождите минуту' });

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const { url, hwid } = body;
  if (typeof url !== 'string' || url.length > 2048) return res.status(400).json({ error: 'Некорректная ссылка' });
  if (typeof hwid !== 'string' || !/^[a-f0-9]{16,64}$/.test(hwid)) return res.status(400).json({ error: 'Некорректный ID устройства' });

  let target;
  try { target = new URL(url); } catch { return res.status(400).json({ error: 'Некорректная ссылка' }); }
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) {
    return res.status(400).json({ error: 'Поддерживаются только ссылки https://' });
  }

  // Не ходим во внутренние сети (SSRF).
  try {
    const addrs = await dns.lookup(target.hostname, { all: true, verbatim: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      return res.status(400).json({ error: 'Адрес подписки недоступен' });
    }
  } catch {
    return res.status(400).json({ error: 'Сервер подписки не найден' });
  }

  try {
    const resp = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'MyVPN-Web/1.0',
        'x-hwid': hwid,
        'x-device-os': 'iOS',
        'x-ver-os': '18',
        'x-device-model': 'iPhone (web)',
        Accept: 'text/plain, */*',
      },
    });
    if (resp.status >= 300 && resp.status < 400) return res.status(502).json({ error: 'Провайдер перенаправил запрос — такие ссылки не поддерживаются' });
    if (!resp.ok) return res.status(502).json({ error: 'Провайдер ответил ошибкой ' + resp.status });
    const text = await readLimited(resp);
    const headers = {};
    for (const h of PASS_HEADERS) {
      const v = resp.headers.get(h);
      if (v) headers[h] = v.slice(0, 1000);
    }
    return res.status(200).json({ headers, body: text });
  } catch {
    return res.status(502).json({ error: 'Не удалось загрузить подписку' });
  }
};
