"""Текст уведомления «ЛИСТИНГ» в формате, как на скриншоте."""
from __future__ import annotations

from datetime import datetime, timezone
from html import escape

from .models import MARKET_TITLES, Enrichment, Listing


def fmt_ton(value: float) -> str:
    """100 -> '100.0', 100.99 -> '100.99'."""
    text = f"{value:.2f}".rstrip("0")
    return text + "0" if text.endswith(".") else text


def _plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def ago(at: datetime | None, now: datetime | None = None) -> str:
    if at is None:
        return "время неизвестно"
    now = now or datetime.now(timezone.utc)
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    seconds = max(0, int((now - at).total_seconds()))
    if seconds < 60:
        return "только что"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} {_plural(minutes, 'минуту', 'минуты', 'минут')} назад"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} {_plural(hours, 'час', 'часа', 'часов')} назад"
    days = hours // 24
    if days < 30:
        return f"{days} {_plural(days, 'день', 'дня', 'дней')} назад"
    months = days // 30
    return f"{months} {_plural(months, 'месяц', 'месяца', 'месяцев')} назад"


def render_listing(listing: Listing, info: Enrichment, lot_url: str, now: datetime | None = None) -> str:
    e = escape
    name = f"{e(listing.collection)} #{listing.number}" if listing.number is not None else e(listing.collection)
    if listing.tg_url:
        name = f'<a href="{e(listing.tg_url)}">{name}</a>'
    market = f'<a href="{e(lot_url)}">{e(listing.market_title)}</a>'

    lines = [
        "✅ <b>ЛИСТИНГ</b>",
        f"{name} на {market} за <b>{fmt_ton(listing.price)} TON</b>",
    ]
    if listing.model:
        lines.append(f"Модель: {e(listing.model)}")
    if listing.backdrop:
        lines.append(f"Фон: {e(listing.backdrop)}")
    if listing.symbol:
        lines.append(f"Символ: {e(listing.symbol)}")

    lines.append("")
    cf = f"<b>{fmt_ton(info.collection_floor)}</b> TON" if info.collection_floor is not None else "нет данных"
    mf = f"<b>{fmt_ton(info.model_floor)}</b> TON" if info.model_floor is not None else "нет данных"
    lines.append(f"Флор гифта: {cf}")
    lines.append(f"Флор модели: {mf}")

    lines.append("")
    lines.append("Последние продажи модели:")
    if info.sales:
        sale_lines = []
        for s in info.sales:
            num = f"#{s.number}" if s.number is not None else "#?"
            where = e(MARKET_TITLES.get(s.market, s.market))
            sale_lines.append(f"{num} за <b>{fmt_ton(s.price)}</b> TON на {where} — {ago(s.at, now)}")
        lines.append("<blockquote expandable>" + "\n".join(sale_lines) + "</blockquote>")
    else:
        lines.append("нет данных")

    return "\n".join(lines)
