'use strict';
/*
 * «Мой VPN» — веб-версия для iPhone (добавляется на экран «Домой»).
 * iOS разрешает поднимать VPN только приложениям из App Store, поэтому
 * кнопка «Подключить» передаёт выбранный ключ в установленный клиент (Happ / v2RayTun / Streisand).
 * Ключи хранятся только в localStorage этого устройства и никуда не отправляются.
 */

const CLIENTS = {
  happ: {
    name: 'Happ',
    store: 'https://apps.apple.com/app/id6504287215',
    link: (raw) => 'happ://add/' + raw,
  },
  v2raytun: {
    name: 'v2RayTun',
    store: 'https://apps.apple.com/app/id6476628951',
    link: (raw) => 'v2raytun://import/' + raw,
  },
  streisand: {
    name: 'Streisand',
    store: 'https://apps.apple.com/app/id6450534064',
    link: (raw) => 'streisand://import/' + raw,
  },
};

const LS = { items: 'myvpn.items', sel: 'myvpn.sel', client: 'myvpn.client', onboarded: 'myvpn.onboarded' };

function load(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { toast('Не удалось сохранить: память браузера недоступна'); }
}

let items = load(LS.items, []);
let selId = load(LS.sel, null);
let client = load(LS.client, 'happ');
if (!CLIENTS[client]) client = 'happ';

const $ = (id) => document.getElementById(id);

/* ---------- разбор ключей ---------- */

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

function b64decode(s) {
  s = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const PROTO_NAMES = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', ss: 'Shadowsocks' };

/** Возвращает {proto, name, host} или null. */
function parseKey(raw) {
  const m = /^([a-z0-9]+):\/\//i.exec(raw);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const hashAt = raw.indexOf('#');
  const name = hashAt >= 0 ? safeDecode(raw.slice(hashAt + 1)) : '';
  const body = raw.slice(m[0].length, hashAt >= 0 ? hashAt : undefined);

  if (scheme === 'vless' || scheme === 'trojan') {
    const hm = /^[^@]+@(\[[^\]]+\]|[^:/?#]+):(\d+)/.exec(body);
    if (!hm) return null;
    return { proto: scheme, name, host: hm[1].replace(/^\[|\]$/g, '') + ':' + hm[2] };
  }
  if (scheme === 'vmess') {
    try {
      const j = JSON.parse(b64decode(body));
      if (!j.add || !j.port || !j.id) return null;
      return { proto: 'vmess', name: String(j.ps || ''), host: j.add + ':' + j.port };
    } catch { return null; }
  }
  if (scheme === 'ss') {
    let rest = body.split('?')[0].replace(/\/$/, '');
    let hostport;
    const at = rest.lastIndexOf('@');
    if (at >= 0) hostport = rest.slice(at + 1);
    else {
      try { const d = b64decode(rest); hostport = d.slice(d.lastIndexOf('@') + 1); } catch { return null; }
    }
    if (!/:\d+$/.test(hostport || '')) return null;
    return { proto: 'ss', name, host: hostport };
  }
  return null;
}

function isSubUrl(t) { return /^https?:\/\/[^\s]+$/i.test(t); }

/** Текст из буфера/поля → массив новых элементов. */
function parseInput(text) {
  text = (text || '').trim();
  if (!text) throw new Error('Пусто. Сначала скопируйте ключ.');
  if (isSubUrl(text)) {
    let host = 'Подписка';
    try { host = new URL(text).hostname; } catch {}
    return [{ kind: 'sub', raw: text, name: host, proto: 'sub', host: '' }];
  }
  let lines = text.split(/\s+/);
  if (!text.includes('://')) {
    try { lines = b64decode(text).split(/\s+/); } catch { /* не base64 */ }
  }
  const out = [];
  for (const line of lines) {
    const p = parseKey(line.trim());
    if (p) out.push({ kind: 'key', raw: line.trim(), name: p.name || p.host, proto: p.proto, host: p.host });
  }
  if (!out.length) {
    throw new Error('Не похоже на ключ. Нужен vless://, vmess://, trojan://, ss:// или ссылка https://');
  }
  return out;
}

function addFromText(text) {
  let found;
  try { found = parseInput(text); } catch (e) { toast(e.message); return; }
  let added = 0;
  for (const it of found) {
    if (items.some((x) => x.raw === it.raw)) continue;
    it.id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
    items.push(it);
    added++;
    if (!selId) selId = it.id;
  }
  save(LS.items, items);
  save(LS.sel, selId);
  render();
  toast(added ? (found[0].kind === 'sub' ? 'Подписка добавлена' : 'Добавлено ключей: ' + added) : 'Это уже добавлено');
}

/* ---------- интерфейс ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const GLOBE = ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'];
const LAYERS = ['M12 3 3 8l9 5 9-5z', 'M3 13l9 5 9-5'];
const CHECK = ['M5 12.5l4.5 4.5L19 7.5'];
const TRASH = ['M5 7h14', 'M10 7V5h4v2', 'M7 7l1 12h8l1-12'];

/** Флаг страны из начала названия («🇳🇱 Нидерланды») — если есть. */
function splitFlag(name) {
  const m = /^((?:\uD83C[\uDDE6-\uDDFF]){2})\s*/.exec(name || '');
  return m ? { flag: m[1], text: name.slice(m[0].length) || name } : { flag: '', text: name || '' };
}

function fillFlag(el, it) {
  el.replaceChildren();
  const { flag } = splitFlag(it.name);
  if (flag) el.textContent = flag;
  else el.append(icon(it.kind === 'sub' ? LAYERS : GLOBE));
}

function protoLabel(it) { return it.kind === 'sub' ? 'Подписка' : (PROTO_NAMES[it.proto] || it.proto); }

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}

function selected() { return items.find((x) => x.id === selId) || items[0] || null; }

function pluralLoc(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + ' локация';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' локации';
  return n + ' локаций';
}

function render() {
  const sel = selected();
  if (sel && sel.id !== selId) { selId = sel.id; save(LS.sel, selId); }
  const c = CLIENTS[client];

  $('connect').disabled = !sel;
  $('connect-sub').textContent = sel ? 'через ' + c.name : 'добавьте ключ';
  $('current').hidden = !sel;
  if (sel) {
    fillFlag($('current-flag'), sel);
    $('current-name').textContent = splitFlag(sel.name).text;
    $('current-proto').textContent = protoLabel(sel);
  }
  $('empty').hidden = items.length > 0;
  $('locations-wrap').hidden = items.length === 0;
  $('count').textContent = pluralLoc(items.length);

  const list = $('list');
  list.replaceChildren();
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'loc' + (sel && it.id === sel.id ? ' sel' : '');
    li.tabIndex = 0;
    const flag = document.createElement('span'); flag.className = 'flag'; fillFlag(flag, it);
    const body = document.createElement('div'); body.className = 'body';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = splitFlag(it.name).text;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = it.kind === 'sub' ? 'Подписка · серверы внутри ' + c.name : protoLabel(it);
    body.append(name, meta);
    const check = document.createElement('span'); check.className = 'check'; check.append(icon(CHECK));
    const del = document.createElement('button');
    del.className = 'del'; del.setAttribute('aria-label', 'Удалить'); del.append(icon(TRASH));
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Удалить «' + splitFlag(it.name).text + '»?')) return;
      items = items.filter((x) => x.id !== it.id);
      if (selId === it.id) selId = items[0] ? items[0].id : null;
      save(LS.items, items); save(LS.sel, selId); render();
    });
    const choose = () => { selId = it.id; save(LS.sel, selId); render(); };
    li.addEventListener('click', choose);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(); });
    li.append(flag, body, check, del);
    list.append(li);
  }
}

function renderClients() {
  const box = $('clients');
  box.replaceChildren();
  for (const [id, c] of Object.entries(CLIENTS)) {
    const row = document.createElement('div'); row.className = 'client';
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'client'; input.value = id; input.checked = id === client;
    input.addEventListener('change', () => { client = id; save(LS.client, client); render(); });
    const span = document.createElement('span'); span.textContent = c.name;
    label.append(input, span);
    const a = document.createElement('a');
    a.href = c.store; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'App Store';
    row.append(label, a);
    box.append(row);
  }
}

function connect() {
  const sel = selected();
  if (!sel) return;
  const c = CLIENTS[client];
  let hidden = false;
  const onHide = () => { if (document.visibilityState === 'hidden') hidden = true; };
  document.addEventListener('visibilitychange', onHide);
  window.location.href = c.link(sel.raw);
  // Если через 2 секунды мы всё ещё на странице — приложение, скорее всего, не установлено.
  setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide);
    if (!hidden && document.visibilityState === 'visible') {
      $('need-app-name').textContent = c.name;
      $('need-app-link').href = c.store;
      $('need-app-dlg').showModal();
    }
  }, 2000);
}

async function pasteFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.readText) { openManual(); return; }
  try {
    addFromText(await navigator.clipboard.readText());
  } catch {
    openManual();
  }
}

function openManual() {
  $('manual-text').value = '';
  $('manual-dlg').showModal();
  setTimeout(() => $('manual-text').focus(), 60);
}

function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent); }

document.addEventListener('DOMContentLoaded', () => {
  $('connect').addEventListener('click', connect);
  $('current').addEventListener('click', () => $('locations-wrap').scrollIntoView({ behavior: 'smooth' }));
  $('paste').addEventListener('click', pasteFromClipboard);
  $('manual').addEventListener('click', openManual);
  $('manual-dlg').addEventListener('close', () => {
    if ($('manual-dlg').returnValue === 'ok') addFromText($('manual-text').value);
  });
  $('settings-btn').addEventListener('click', () => { renderClients(); $('settings-dlg').showModal(); });
  // Закрытие листов тапом по затемнению
  document.querySelectorAll('dialog.sheet').forEach((d) =>
    d.addEventListener('click', (e) => { if (e.target === d) d.close('cancel'); }));
  render();
  if (isIOS() && !load(LS.onboarded, false)) {
    save(LS.onboarded, true);
    const c = CLIENTS[client];
    $('onboard-client').textContent = c.name;
    $('onboard-store').href = c.store;
    $('onboard-store').textContent = 'Скачать ' + c.name;
    $('onboard-dlg').showModal();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
});
