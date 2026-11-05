"""Portals (portal-market.com) — неофициальный API.

Официальной документации у Portals нет. Адреса и формат ответов взяты из
открытых библиотек сообщества (portalsmp / faportalsmp) и могут измениться.
Бот только ЧИТАЕТ данные: ничего не покупает, не выставляет и не переводит.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs

from curl_cffi.requests import AsyncSession
from telethon import TelegramClient
from telethon.tl.functions.messages import RequestAppWebViewRequest
from telethon.tl.types import InputBotAppShortName, InputUser

from ..models import Enrichment, Listing, Sale

log = logging.getLogger(__name__)

API_URL = "https://portal-market.com/api/"
BASE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
    "Origin": "https://portal-market.com",
    "Referer": "https://portal-market.com/",
}
AUTH_TTL = 20 * 60        # обновлять вход каждые 20 минут
FLOORS_TTL = 60           # кэш флоров
SALES_TTL = 30            # кэш последних продаж модели


class MarketError(Exception):
    """Ошибка запроса к маркету. Текст безопасен для логов (без токенов)."""


class MarketAuthError(MarketError):
    pass


# ---------- Разбор ответов (чистые функции, покрыты тестами) ----------

def _attr(item: dict, kind: str) -> str | None:
    for a in item.get("attributes") or []:
        if isinstance(a, dict) and a.get("type") == kind:
            value = a.get("value")
            return str(value) if value is not None else None
    return None


def _to_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_datetime(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_listing(item: dict) -> Listing | None:
    if not isinstance(item, dict):
        return None
    nft_id = item.get("id")
    name = item.get("name")
    price = _to_float(item.get("price"))
    if not nft_id or not name or price is None:
        return None
    return Listing(
        market="portals",
        nft_id=str(nft_id),
        collection=str(name),
        number=_to_int(item.get("external_collection_number")),
        model=_attr(item, "model"),
        backdrop=_attr(item, "backdrop"),
        symbol=_attr(item, "symbol"),
        price=price,
        listed_at=str(item.get("listed_at") or ""),
    )


def parse_sale(action: dict) -> Sale | None:
    if not isinstance(action, dict):
        return None
    amount = _to_float(action.get("amount"))
    if amount is None:
        return None
    nft = action.get("nft") if isinstance(action.get("nft"), dict) else {}
    return Sale(
        number=_to_int(nft.get("external_collection_number")),
        price=amount,
        market="portals",
        at=parse_datetime(action.get("created_at")),
    )


def short_name(collection: str) -> str:
    """Так Portals называет коллекции в ответах флоров: 'Durov's Cap' -> 'durovscap'."""
    return re.sub(r"[\s'’\-]", "", collection).lower()


def extract_init_data(webview_url: str) -> str:
    """Достаёт tgWebAppData из ссылки мини-приложения."""
    fragment = webview_url.split("#", 1)[1] if "#" in webview_url else ""
    values = parse_qs(fragment).get("tgWebAppData")
    if not values or not values[0]:
        raise MarketAuthError("Telegram не вернул данные входа для Portals.")
    return values[0]


# ---------- Вход через отдельный Telegram-аккаунт ----------

class PortalsAuth:
    def __init__(self, api_id: int, api_hash: str, session_path: Path):
        self._client = TelegramClient(str(session_path), api_id, api_hash)
        self._token: str | None = None
        self._obtained_at = 0.0
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        await self._client.connect()
        if not await self._client.is_user_authorized():
            raise MarketAuthError(
                "Отдельный аккаунт не авторизован. Сначала запусти: python -m scripts.login"
            )

    async def close(self) -> None:
        await self._client.disconnect()

    async def token(self, force: bool = False) -> str:
        async with self._lock:
            fresh = self._token and time.monotonic() - self._obtained_at < AUTH_TTL
            if force or not fresh:
                self._token = await self._request_token()
                self._obtained_at = time.monotonic()
            return self._token  # type: ignore[return-value]

    async def _request_token(self) -> str:
        bot = await self._client.get_input_entity("portals")
        result = await self._client(
            RequestAppWebViewRequest(
                peer=bot,
                app=InputBotAppShortName(
                    bot_id=InputUser(user_id=bot.user_id, access_hash=bot.access_hash),
                    short_name="market",
                ),
                platform="desktop",
            )
        )
        return "tma " + extract_init_data(result.url)


# ---------- Клиент ----------

class PortalsClient:
    name = "portals"

    def __init__(self, auth: PortalsAuth, lot_link_template: str):
        self._auth = auth
        self._lot_link = lot_link_template
        self._http = AsyncSession(impersonate="chrome", timeout=15)
        self._collection_floors: tuple[float, dict] = (0.0, {})
        self._model_floors: dict[str, tuple[float, dict]] = {}
        self._sales: dict[tuple[str, str], tuple[float, list[Sale]]] = {}

    async def close(self) -> None:
        await self._http.close()

    async def _get(self, path: str, params: dict) -> dict:
        for attempt in range(2):
            token = await self._auth.token(force=attempt > 0)
            try:
                resp = await self._http.get(
                    API_URL + path, params=params, headers={**BASE_HEADERS, "Authorization": token}
                )
            except Exception as exc:  # сетевые ошибки curl
                raise MarketError(f"Portals: нет соединения ({type(exc).__name__})") from None
            if resp.status_code in (401, 403) and attempt == 0:
                continue  # вход устарел — обновляем и пробуем ещё раз
            if resp.status_code == 429:
                raise MarketError("Portals: слишком частые запросы (429)")
            if not 200 <= resp.status_code < 300:
                if resp.status_code in (401, 403):
                    raise MarketAuthError(f"Portals: доступ запрещён ({resp.status_code})")
                raise MarketError(f"Portals: ошибка {resp.status_code}")
            try:
                data = resp.json()
            except ValueError:
                raise MarketError("Portals: ответ не JSON") from None
            if not isinstance(data, dict):
                raise MarketError("Portals: неожиданный формат ответа")
            return data
        raise MarketAuthError("Portals: не удалось войти")

    async def latest_listings(self, limit: int = 30) -> list[Listing]:
        data = await self._get(
            "nfts/search",
            {
                "offset": 0,
                "limit": limit,
                "sort_by": "listed_at desc",
                "status": "listed",
                "exclude_bundled": "true",
                "premarket_status": "all",
            },
        )
        items = data.get("results") or []
        return [l for l in (parse_listing(i) for i in items) if l is not None]

    async def model_sales(self, collection: str, model: str | None, limit: int = 5) -> list[Sale]:
        key = (collection, model or "")
        cached = self._sales.get(key)
        if cached and time.monotonic() - cached[0] < SALES_TTL:
            return cached[1]
        params = {
            "offset": 0,
            "limit": limit,
            "sort_by": "listed_at desc",
            "action_types": "buy",
            "filter_by_collections": collection,
        }
        if model:
            params["filter_by_models"] = model
        data = await self._get("market/actions/", params)
        sales = [s for s in (parse_sale(a) for a in data.get("actions") or []) if s is not None]
        self._sales[key] = (time.monotonic(), sales)
        return sales

    async def collection_floor(self, collection: str) -> float | None:
        ts, floors = self._collection_floors
        if time.monotonic() - ts > FLOORS_TTL:
            data = await self._get("collections/floors", {})
            floors = data.get("floorPrices") or {}
            self._collection_floors = (time.monotonic(), floors)
        return _to_float(floors.get(short_name(collection)))

    async def model_floor(self, collection: str, model: str | None) -> float | None:
        if not model:
            return None
        sn = short_name(collection)
        cached = self._model_floors.get(sn)
        if not cached or time.monotonic() - cached[0] > FLOORS_TTL:
            data = await self._get("collections/filters", {"short_names": sn})
            floors = (data.get("floor_prices") or {}).get(sn) or {}
            cached = (time.monotonic(), floors)
            self._model_floors[sn] = cached
        models = cached[1].get("models") or {}
        # Регистр названий у Portals бывает разный — ищем без учёта регистра.
        for name, value in models.items():
            if str(name).casefold() == model.casefold():
                return _to_float(value)
        return None

    async def enrich(self, listing: Listing) -> Enrichment:
        """Флоры и продажи. Если что-то не получилось — просто не показываем это поле."""
        results = await asyncio.gather(
            self.collection_floor(listing.collection),
            self.model_floor(listing.collection, listing.model),
            self.model_sales(listing.collection, listing.model),
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                log.warning("Portals: не удалось получить доп. данные: %s", r)
        cf, mf, sales = (None if isinstance(r, Exception) else r for r in results)
        return Enrichment(collection_floor=cf, model_floor=mf, sales=sales or [])

    def lot_url(self, listing: Listing) -> str:
        return self._lot_link.replace("{id}", listing.nft_id)
