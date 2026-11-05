"""Общий формат данных для всех маркетов."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

MARKET_TITLES = {
    "portals": "Portals",
    "tonnel": "Tonnel",
    "mrkt": "MRKT",
    "getgems": "Getgems",
}


@dataclass(frozen=True)
class Listing:
    market: str            # "portals"
    nft_id: str            # id лота на маркете
    collection: str        # "Nail Bracelet"
    number: int | None     # 3300
    model: str | None
    backdrop: str | None
    symbol: str | None
    price: float           # в TON
    listed_at: str | None  # как пришло от маркета, используется для дедупликации

    @property
    def gift_key(self) -> str:
        """Один и тот же подарок на любом маркете: коллекция + номер."""
        return f"{self.collection}#{self.number}"

    @property
    def tg_url(self) -> str | None:
        """Страница подарка в самом Telegram (t.me/nft/NailBracelet-3300)."""
        if self.number is None:
            return None
        slug = re.sub(r"[^0-9A-Za-z]", "", self.collection)
        return f"https://t.me/nft/{slug}-{self.number}" if slug else None

    @property
    def market_title(self) -> str:
        return MARKET_TITLES.get(self.market, self.market)


@dataclass(frozen=True)
class Sale:
    number: int | None
    price: float
    market: str
    at: datetime | None


@dataclass(frozen=True)
class Enrichment:
    collection_floor: float | None = None
    model_floor: float | None = None
    sales: list[Sale] = field(default_factory=list)
