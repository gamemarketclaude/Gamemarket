// ---------------------------------------------------------------------------
// Хранилище сессий на базе уже используемой SQLite-базы (через better-sqlite3).
// Нужно, чтобы "запомнить меня" реально работало долго — сессия переживает
// перезапуск сервера, а не живёт только в памяти процесса.
// ---------------------------------------------------------------------------

const session = require('express-session');

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    this._get = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?');
    this._upsert = db.prepare(`
      INSERT INTO sessions (sid, data, expires_at) VALUES (@sid, @data, @expires_at)
      ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
    `);
    this._destroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._touch = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this._prune = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

    // Периодически подчищаем протухшие сессии
    this._pruneInterval = setInterval(() => {
      try { this._prune.run(Date.now()); } catch (_) { /* ignore */ }
    }, 1000 * 60 * 60);
    this._pruneInterval.unref();
  }

  _maxAgeMs(sessionData) {
    const maxAge = sessionData.cookie && sessionData.cookie.maxAge;
    return typeof maxAge === 'number' ? maxAge : 1000 * 60 * 60 * 24; // сессионная кука: держим запись сутки
  }

  get(sid, cb) {
    try {
      const row = this._get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at < Date.now()) {
        this._destroy.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sessionData, cb) {
    try {
      this._upsert.run({
        sid,
        data: JSON.stringify(sessionData),
        expires_at: Date.now() + this._maxAgeMs(sessionData),
      });
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this._destroy.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sessionData, cb) {
    try {
      this._touch.run(Date.now() + this._maxAgeMs(sessionData), sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }
}

module.exports = SqliteSessionStore;
