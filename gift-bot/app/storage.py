"""SQLite: уже показанные лоты, заблокированные подарки, фильтры. Все запросы параметризованы."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import aiosqlite

from .filters import Filters
from .models import Listing

SCHEMA = """
CREATE TABLE IF NOT EXISTS seen (
    market    TEXT NOT NULL,
    nft_id    TEXT NOT NULL,
    listed_at TEXT NOT NULL,
    seen_at   REAL NOT NULL,
    PRIMARY KEY (market, nft_id, listed_at)
);
CREATE TABLE IF NOT EXISTS gift_keys (
    id       TEXT PRIMARY KEY,
    gift_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blocked (
    gift_key   TEXT PRIMARY KEY,
    blocked_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

SEEN_KEEP_SECONDS = 3 * 24 * 3600


def gift_key_id(gift_key: str) -> str:
    """Короткий id подарка для кнопки (у Telegram лимит 64 байта на callback_data)."""
    return hashlib.sha256(gift_key.encode()).hexdigest()[:16]


class Storage:
    def __init__(self, path: Path):
        self._path = path
        self._db: aiosqlite.Connection | None = None

    async def open(self) -> None:
        self._db = await aiosqlite.connect(self._path)
        await self._db.executescript(SCHEMA)
        await self._db.commit()
        try:
            self._path.chmod(0o600)
        except OSError:
            pass

    async def close(self) -> None:
        if self._db:
            await self._db.close()

    @property
    def db(self) -> aiosqlite.Connection:
        assert self._db is not None, "Storage.open() не вызван"
        return self._db

    # --- дедупликация ---
    async def filter_new(self, listings: list[Listing]) -> list[Listing]:
        """Возвращает лоты, которых ещё не было, и сразу помечает их как увиденные."""
        new: list[Listing] = []
        now = time.time()
        for l in listings:
            cur = await self.db.execute(
                "INSERT OR IGNORE INTO seen (market, nft_id, listed_at, seen_at) VALUES (?, ?, ?, ?)",
                (l.market, l.nft_id, l.listed_at or "", now),
            )
            if cur.rowcount:
                new.append(l)
        await self.db.commit()
        return new

    async def prune_seen(self) -> None:
        await self.db.execute("DELETE FROM seen WHERE seen_at < ?", (time.time() - SEEN_KEEP_SECONDS,))
        await self.db.commit()

    # --- блокировка подарков ---
    async def remember_gift(self, gift_key: str) -> str:
        key_id = gift_key_id(gift_key)
        await self.db.execute(
            "INSERT OR IGNORE INTO gift_keys (id, gift_key) VALUES (?, ?)", (key_id, gift_key)
        )
        await self.db.commit()
        return key_id

    async def gift_by_id(self, key_id: str) -> str | None:
        cur = await self.db.execute("SELECT gift_key FROM gift_keys WHERE id = ?", (key_id,))
        row = await cur.fetchone()
        return row[0] if row else None

    async def set_blocked(self, gift_key: str, blocked: bool) -> None:
        if blocked:
            await self.db.execute(
                "INSERT OR IGNORE INTO blocked (gift_key, blocked_at) VALUES (?, ?)",
                (gift_key, time.time()),
            )
        else:
            await self.db.execute("DELETE FROM blocked WHERE gift_key = ?", (gift_key,))
        await self.db.commit()

    async def is_blocked(self, gift_key: str) -> bool:
        cur = await self.db.execute("SELECT 1 FROM blocked WHERE gift_key = ?", (gift_key,))
        return await cur.fetchone() is not None

    async def list_blocked(self, limit: int = 50) -> list[str]:
        cur = await self.db.execute(
            "SELECT gift_key FROM blocked ORDER BY blocked_at DESC LIMIT ?", (limit,)
        )
        return [r[0] for r in await cur.fetchall()]

    # --- настройки ---
    async def _get_setting(self, key: str) -> str | None:
        cur = await self.db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cur.fetchone()
        return row[0] if row else None

    async def _set_setting(self, key: str, value: str) -> None:
        await self.db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await self.db.commit()

    async def get_filters(self) -> Filters:
        raw = await self._get_setting("filters")
        if not raw:
            return Filters()
        try:
            return Filters.from_dict(json.loads(raw))
        except ValueError:
            return Filters()

    async def save_filters(self, filters: Filters) -> None:
        await self._set_setting("filters", json.dumps(filters.to_dict(), ensure_ascii=False))

    async def is_paused(self) -> bool:
        return await self._get_setting("paused") == "1"

    async def set_paused(self, paused: bool) -> None:
        await self._set_setting("paused", "1" if paused else "0")
