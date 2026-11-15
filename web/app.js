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

const LS = { items: 'myvpn.items', sel: 'myvpn.sel', client: 'myvpn.client', hint: 'myvpn.hintClosed' };

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

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function selected() { return items.find((x) => x.id === selId) || items[0] || null; }

function render() {
  const sel = selected();
  if (sel && sel.id !== selId) { selId = sel.id; save(LS.sel, selId); }
  const c = CLIENTS[client];

  $('connect').disabled = !sel;
  $('connect-sub').textContent = sel ? 'откроется в ' + c.name : 'нет ключей';
  $('selected-name').textContent = sel ? sel.name : '';
  $('client-line').textContent = sel ? 'Приложение: ' + c.name + ' · сменить в ⚙︎' : '';
  $('empty').hidden = items.length > 0;
  $('list-title').hidden = items.length === 0;

  const list = $('list');
  list.replaceChildren();
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'item' + (sel && it.id === sel.id ? ' sel' : '');
    const radio = document.createElement('span'); radio.className = 'radio';
    const body = document.createElement('div'); body.className = 'body';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = it.name;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = it.kind === 'sub' ? 'Подписка · серверы выберете в ' + c.name : (PROTO_NAMES[it.proto] || it.proto);
    body.append(name, meta);
    const del = document.createElement('button');
    del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Удалить');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Удалить «' + it.name + '»?')) return;
      items = items.filter((x) => x.id !== it.id);
      if (selId === it.id) selId = items[0] ? items[0].id : null;
      save(LS.items, items); save(LS.sel, selId); render();
    });
    li.append(radio, body, del);
    li.addEventListener('click', () => { selId = it.id; save(LS.sel, selId); render(); });
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
    a.href = c.store; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Установить';
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
    toast('Нет доступа к буферу — вставьте вручную');
    openManual();
  }
}

function openManual() {
  $('manual-text').value = '';
  $('manual-dlg').showModal();
  setTimeout(() => $('manual-text').focus(), 50);
}

function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent); }
function isStandalone() { return window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }

document.addEventListener('DOMContentLoaded', () => {
  $('connect').addEventListener('click', connect);
  $('paste').addEventListener('click', pasteFromClipboard);
  $('manual').addEventListener('click', openManual);
  $('manual-dlg').addEventListener('close', () => {
    if ($('manual-dlg').returnValue === 'ok') addFromText($('manual-text').value);
  });
  $('settings-btn').addEventListener('click', () => { renderClients(); $('settings-dlg').showModal(); });
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => {
      $(b.dataset.close).hidden = true;
      save(LS.hint, true);
    }));
  if (isIOS() && !isStandalone() && !load(LS.hint, false)) $('install-hint').hidden = false;
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
});
