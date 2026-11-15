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

const LS = { items: 'myvpn.items', sel: 'myvpn.sel', client: 'myvpn.client', onboarded: 'myvpn.onboarded', hwid: 'myvpn.hwid' };

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

/** Случайный ID этого устройства — провайдеры с лимитом устройств считают по нему. */
let hwid = load(LS.hwid, null);
if (typeof hwid !== 'string' || !/^[a-f0-9]{16,64}$/.test(hwid)) {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  hwid = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  save(LS.hwid, hwid);
}

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
  if (found[0].kind === 'sub') {
    const sub = items.find((x) => x.raw === found[0].raw);
    if (sub) refreshSub(sub, true);
  } else {
    toast(added ? 'Добавлено ключей: ' + added : 'Это уже добавлено');
  }
}

/* ---------- подписки ---------- */

function decodeHeaderText(v) {
  if (!v) return '';
  if (v.startsWith('base64:')) { try { return b64decode(v.slice(7)); } catch { return ''; } }
  return v;
}

/** Ответ провайдера → {servers, notices, info}. «Ключи» на 0.0.0.0 — это сообщения провайдера. */
function parseSubResponse(data) {
  let text = String(data.body || '').trim();
  if (!text.includes('://')) { try { text = b64decode(text); } catch { /* как есть */ } }
  const servers = [], notices = [];
  for (const line of text.split(/\s+/)) {
    const p = parseKey(line.trim());
    if (!p) continue;
    if (/^0\.0\.0\.0:/.test(p.host)) { if (p.name) notices.push(p.name); continue; }
    servers.push({ raw: line.trim(), name: p.name || p.host, proto: p.proto });
  }
  const h = data.headers || {};
  const info = { title: decodeHeaderText(h['profile-title']).slice(0, 80), announce: decodeHeaderText(h.announce).slice(0, 300) };
  for (const part of String(h['subscription-userinfo'] || '').split(';')) {
    const [k, v] = part.split('=').map((x) => (x || '').trim());
    const n = Number(v) || 0;
    if (k === 'upload' || k === 'download') info.used = (info.used || 0) + n;
    if (k === 'total') info.total = n;
    if (k === 'expire') info.expire = n;
  }
  const su = h['support-url'] || '';
  if (/^https:\/\//.test(su)) info.support = su;
  return { servers, notices, info };
}

const refreshing = new Set();
async function refreshSub(sub, announce) {
  if (refreshing.has(sub.id)) return;
  refreshing.add(sub.id);
  render();
  try {
    const r = await fetch('/api/sub', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sub.raw, hwid }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Не удалось загрузить подписку');
    const { servers, notices, info } = parseSubResponse(data);
    sub.servers = servers;
    sub.notices = notices;
    sub.info = info;
    sub.updatedAt = Date.now();
    if (info.title) sub.name = info.title;
    sub.error = servers.length ? '' : (notices.join(' · ') || 'В подписке нет серверов');
    if (announce) toast(servers.length ? 'Серверов: ' + servers.length : sub.error);
  } catch (e) {
    sub.error = e.message;
    if (announce) toast(e.message);
  } finally {
    refreshing.delete(sub.id);
    save(LS.items, items);
    render();
  }
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
const REFRESH = ['M20 11a8 8 0 0 0-14.6-4.5L4 8', 'M4 3v5h5', 'M4 13a8 8 0 0 0 14.6 4.5L20 16', 'M20 21v-5h-5'];

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

/** Все локации: одиночные ключи + серверы из подписок (подписка без серверов — одна строка). */
function locations() {
  const out = [];
  for (const it of items) {
    if (it.kind === 'sub' && it.servers && it.servers.length) {
      it.servers.forEach((sv, i) => out.push({ id: it.id + '/' + i, kind: 'key', name: sv.name, proto: sv.proto, raw: sv.raw, parent: it }));
    } else {
      out.push({ id: it.id, kind: it.kind, name: it.name, proto: it.proto, raw: it.raw, parent: null, item: it });
    }
  }
  return out;
}
function selected() { const l = locations(); return l.find((x) => x.id === selId) || l[0] || null; }

function pluralLoc(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return n + ' локация';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + ' локации';
  return n + ' локаций';
}

function fmtGB(b) { return (b / 1073741824).toFixed(b >= 10 * 1073741824 ? 0 : 1) + ' ГБ'; }
function fmtDate(unix) { return new Date(unix * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }); }

function deleteItem(it) {
  if (!confirm('Удалить «' + splitFlag(it.name).text + '»?')) return;
  items = items.filter((x) => x.id !== it.id);
  if (selId && (selId === it.id || selId.startsWith(it.id + '/'))) selId = null;
  save(LS.items, items); save(LS.sel, selId); render();
}

function renderSubs() {
  const box = $('subs');
  box.replaceChildren();
  const subs = items.filter((x) => x.kind === 'sub');
  $('subs-wrap').hidden = subs.length === 0;
  for (const sub of subs) {
    const card = document.createElement('div'); card.className = 'glass sub-card';
    const head = document.createElement('div'); head.className = 'sub-head';
    const title = document.createElement('div'); title.className = 'sub-title'; title.textContent = sub.name;
    const actions = document.createElement('div'); actions.className = 'sub-actions';
    const upd = document.createElement('button'); upd.className = 'icon-btn small'; upd.setAttribute('aria-label', 'Обновить');
    upd.append(icon(REFRESH));
    if (refreshing.has(sub.id)) upd.classList.add('spinning');
    upd.addEventListener('click', () => refreshSub(sub, true));
    const del = document.createElement('button'); del.className = 'icon-btn small'; del.setAttribute('aria-label', 'Удалить подписку');
    del.append(icon(TRASH));
    del.addEventListener('click', () => deleteItem(sub));
    actions.append(upd, del);
    head.append(title, actions);
    card.append(head);

    const info = sub.info || {};
    const meta = document.createElement('div'); meta.className = 'sub-meta';
    const parts = [];
    if (info.expire) parts.push((info.expire * 1000 < Date.now() ? 'истекла ' : 'до ') + fmtDate(info.expire));
    if (sub.servers && sub.servers.length) parts.push(pluralLoc(sub.servers.length));
    meta.textContent = parts.join(' · ') || (refreshing.has(sub.id) ? 'Загружаем…' : '');
    card.append(meta);

    if (info.total) {
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = Math.min(100, (info.used || 0) / info.total * 100) + '%';
      bar.append(fill);
      const t = document.createElement('div'); t.className = 'bar-text';
      t.textContent = fmtGB(info.used || 0) + ' из ' + fmtGB(info.total);
      card.append(bar, t);
    }
    if (info.announce) { const a = document.createElement('div'); a.className = 'sub-announce'; a.textContent = info.announce; card.append(a); }
    if (sub.error) { const e = document.createElement('div'); e.className = 'sub-error'; e.textContent = sub.error; card.append(e); }
    if (info.support) {
      const a = document.createElement('a'); a.className = 'sub-link'; a.href = info.support; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = 'Поддержка провайдера'; card.append(a);
    }
    box.append(card);
  }
}

function render() {
  const locs = locations();
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
  renderSubs();
  $('locations-wrap').hidden = locs.length === 0;
  $('count').textContent = pluralLoc(locs.length);

  const list = $('list');
  list.replaceChildren();
  for (const loc of locs) {
    const li = document.createElement('li');
    li.className = 'loc' + (sel && loc.id === sel.id ? ' sel' : '');
    li.tabIndex = 0;
    const flag = document.createElement('span'); flag.className = 'flag'; fillFlag(flag, loc);
    const body = document.createElement('div'); body.className = 'body';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = splitFlag(loc.name).text;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = loc.kind === 'sub' ? 'Подписка · откроется в ' + c.name
      : protoLabel(loc) + (loc.parent ? ' · ' + loc.parent.name : '');
    body.append(name, meta);
    const check = document.createElement('span'); check.className = 'check'; check.append(icon(CHECK));
    li.append(flag, body, check);
    if (!loc.parent && loc.kind !== 'sub') {
      const del = document.createElement('button');
      del.className = 'del'; del.setAttribute('aria-label', 'Удалить'); del.append(icon(TRASH));
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteItem(loc.item); });
      li.append(del);
    }
    const choose = () => { selId = loc.id; save(LS.sel, selId); render(); };
    li.addEventListener('click', choose);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(); });
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
  for (const it of items) {
    if (it.kind === 'sub' && (!it.updatedAt || Date.now() - it.updatedAt > 30 * 60 * 1000)) refreshSub(it, false);
  }
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
