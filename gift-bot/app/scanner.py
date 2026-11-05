"""Цикл опроса маркета: новые лоты -> фильтры -> уведомление владельцу."""
from __future__ import annotations

import asyncio
import logging
import time

from aiogram import Bot
from aiogram.exceptions import TelegramRetryAfter
from aiogram.types import LinkPreviewOptions

from .bot import Status, listing_keyboard
from .markets.portals import MarketAuthError, MarketError, PortalsClient
from .models import Listing
from .render import render_listing
from .storage import Storage

log = logging.getLogger(__name__)

PAGE_SIZE = 30
MAX_BACKOFF = 60
PRUNE_EVERY = 3600


class Scanner:
    def __init__(self, market: PortalsClient, storage: Storage, bot: Bot, owner_id: int,
                 interval: float, status: Status):
        self.market = market
        self.storage = storage
        self.bot = bot
        self.owner_id = owner_id
        self.interval = interval
        self.status = status
        self._warm = False          # первый проход только запоминает текущие лоты
        self._auth_alerted = False
        self._last_prune = 0.0

    async def run(self) -> None:
        backoff = self.interval
        while True:
            try:
                await self.tick()
                self.status.last_ok = time.time()
                self.status.last_error = None
                self._auth_alerted = False
                backoff = self.interval
            except MarketAuthError as exc:
                self.status.last_error = str(exc)
                log.error("%s", exc)
                await self._alert_once(f"⚠️ Проблема со входом в Portals: {exc}")
                backoff = MAX_BACKOFF
            except MarketError as exc:
                self.status.last_error = str(exc)
                log.warning("%s", exc)
                backoff = min(backoff * 2, MAX_BACKOFF)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # не даём циклу умереть
                self.status.last_error = type(exc).__name__
                log.exception("Неожиданная ошибка в цикле опроса")
                backoff = min(backoff * 2, MAX_BACKOFF)
            await asyncio.sleep(backoff)

    async def tick(self) -> None:
        listings = await self.market.latest_listings(PAGE_SIZE)
        new = await self.storage.filter_new(listings)

        if time.time() - self._last_prune > PRUNE_EVERY:
            await self.storage.prune_seen()
            self._last_prune = time.time()

        if not self._warm:
            self._warm = True
            log.info("Portals: запомнил %d текущих лотов, дальше присылаю только новые", len(new))
            return
        if len(new) >= PAGE_SIZE:
            log.warning("Portals: за один опрос пришло %d+ лотов — часть могла не попасть", PAGE_SIZE)
        if not new or await self.storage.is_paused():
            return

        filters = await self.storage.get_filters()
        to_send: list[Listing] = []
        for l in reversed(new):  # сначала старые, чтобы порядок в чате был хронологический
            if filters.matches(l) and not await self.storage.is_blocked(l.gift_key):
                to_send.append(l)
        if not to_send:
            return

        infos = await asyncio.gather(*(self.market.enrich(l) for l in to_send))
        for listing, info in zip(to_send, infos):
            await self._send(listing, info)

    async def _send(self, listing: Listing, info) -> None:
        lot_url = self.market.lot_url(listing)
        key_id = await self.storage.remember_gift(listing.gift_key)
        text = render_listing(listing, info, lot_url)
        preview = (
            LinkPreviewOptions(url=listing.tg_url, prefer_large_media=True)
            if listing.tg_url else LinkPreviewOptions(is_disabled=True)
        )
        for _ in range(3):
            try:
                await self.bot.send_message(
                    self.owner_id, text,
                    link_preview_options=preview,
                    reply_markup=listing_keyboard(lot_url, key_id),
                )
                self.status.sent += 1
                return
            except TelegramRetryAfter as exc:
                await asyncio.sleep(exc.retry_after)
            except Exception as exc:
                # Одна неудачная отправка не должна останавливать остальные уведомления.
                log.warning("Не удалось отправить уведомление %s: %s", listing.gift_key, type(exc).__name__)
                return

    async def _alert_once(self, text: str) -> None:
        if self._auth_alerted:
            return
        self._auth_alerted = True
        try:
            await self.bot.send_message(self.owner_id, text)
        except Exception:
            log.warning("Не удалось отправить предупреждение владельцу")
