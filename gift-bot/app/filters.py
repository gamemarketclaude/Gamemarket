"""Фильтры листингов. Пустой фильтр пропускает всё."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

from .models import Listing

MAX_ITEMS = 50
MAX_ITEM_LEN = 64
MAX_PRICE = 1_000_000.0

LIST_FIELDS = ("collections", "models", "backdrops", "symbols")


class FilterError(ValueError):
    pass


def _norm(value: str | None) -> str:
    return (value or "").strip().casefold()


def clean_items(items: list[str]) -> list[str]:
    result: list[str] = []
    for item in items:
        item = item.strip()
        if not item:
            continue
        if len(item) > MAX_ITEM_LEN:
            raise FilterError(f"Слишком длинное значение: «{item[:20]}…»")
        if _norm(item) not in {_norm(x) for x in result}:
            result.append(item)
    if len(result) > MAX_ITEMS:
        raise FilterError(f"Не больше {MAX_ITEMS} значений в одном фильтре.")
    return result


def clean_price(value: float | None) -> float | None:
    if value is None:
        return None
    if not (0 <= value <= MAX_PRICE):
        raise FilterError(f"Цена должна быть от 0 до {MAX_PRICE:g} TON.")
    return float(value)


@dataclass
class Filters:
    min_price: float | None = None
    max_price: float | None = None
    collections: list[str] = field(default_factory=list)
    models: list[str] = field(default_factory=list)
    backdrops: list[str] = field(default_factory=list)
    symbols: list[str] = field(default_factory=list)

    def matches(self, listing: Listing) -> bool:
        if self.min_price is not None and listing.price < self.min_price:
            return False
        if self.max_price is not None and listing.price > self.max_price:
            return False
        checks = (
            (self.collections, listing.collection),
            (self.models, listing.model),
            (self.backdrops, listing.backdrop),
            (self.symbols, listing.symbol),
        )
        for allowed, value in checks:
            if allowed and _norm(value) not in {_norm(a) for a in allowed}:
                return False
        return True

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Filters":
        """Только известные поля, с проверкой — данные из БД тоже не доверяем вслепую."""
        if not isinstance(data, dict):
            return cls()
        f = cls()
        for name in ("min_price", "max_price"):
            raw = data.get(name)
            if isinstance(raw, (int, float)) and not isinstance(raw, bool):
                try:
                    setattr(f, name, clean_price(float(raw)))
                except FilterError:
                    pass
        for name in LIST_FIELDS:
            raw = data.get(name)
            if isinstance(raw, list):
                try:
                    setattr(f, name, clean_items([x for x in raw if isinstance(x, str)]))
                except FilterError:
                    pass
        return f

    def is_empty(self) -> bool:
        return self.min_price is None and self.max_price is None and not any(
            getattr(self, n) for n in LIST_FIELDS
        )
