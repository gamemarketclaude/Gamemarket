from datetime import datetime, timedelta, timezone

import pytest

from app.filters import FilterError, Filters, clean_items
from app.markets.portals import extract_init_data, parse_listing, parse_sale, short_name
from app.models import Enrichment, Listing, Sale
from app.render import ago, fmt_ton, render_listing

RAW = {
    "id": "0b1c-uuid",
    "name": "Nail Bracelet",
    "external_collection_number": 3300,
    "price": "100.0",
    "listed_at": "2026-11-05T17:19:00Z",
    "attributes": [
        {"type": "model", "value": "Vague Dream", "rarity_per_mille": 10},
        {"type": "backdrop", "value": "Gunship Green", "rarity_per_mille": 15},
        {"type": "symbol", "value": "Kite", "rarity_per_mille": 3},
    ],
}


def make(**kw) -> Listing:
    base = parse_listing(RAW)
    return Listing(**{**base.__dict__, **kw})


def test_parse_listing():
    l = parse_listing(RAW)
    assert (l.collection, l.number, l.model, l.backdrop, l.symbol, l.price) == (
        "Nail Bracelet", 3300, "Vague Dream", "Gunship Green", "Kite", 100.0)
    assert l.tg_url == "https://t.me/nft/NailBracelet-3300"
    assert l.gift_key == "Nail Bracelet#3300"


def test_parse_listing_rejects_garbage():
    assert parse_listing({"id": "x"}) is None
    assert parse_listing({"id": "x", "name": "A", "price": "abc"}) is None
    assert parse_listing("nope") is None


def test_parse_sale():
    s = parse_sale({"amount": "95.71", "created_at": "2026-11-04T10:00:00Z",
                    "nft": {"external_collection_number": 1503}})
    assert s.number == 1503 and s.price == 95.71 and s.at.tzinfo is not None
    assert parse_sale({"amount": None}) is None


def test_short_name_and_tg_url_punctuation():
    assert short_name("Durov's Cap") == "durovscap"
    assert short_name("Jack-in-the-Box") == "jackinthebox"
    assert make(collection="Durov's Cap", number=7).tg_url == "https://t.me/nft/DurovsCap-7"


def test_extract_init_data():
    url = "https://portal-market.com/#tgWebAppData=query_id%3DAA%26user%3D%257B%257D%26hash%3Dabc&tgWebAppVersion=8.0"
    assert extract_init_data(url) == "query_id=AA&user=%7B%7D&hash=abc"


def test_filters():
    l = make()
    assert Filters().matches(l)
    assert not Filters(max_price=10).matches(l)
    assert Filters(min_price=50, max_price=100).matches(l)
    assert Filters(backdrops=["gunship green"]).matches(l)       # без учёта регистра
    assert not Filters(backdrops=["Black"]).matches(l)
    assert Filters(collections=["Plush Pepe", "Nail Bracelet"], models=["Vague Dream"]).matches(l)
    assert not Filters(models=["Other"]).matches(make(model=None))


def test_filters_validation_and_roundtrip():
    with pytest.raises(FilterError):
        clean_items(["x" * 100])
    assert clean_items([" A ", "a", "", "B"]) == ["A", "B"]
    f = Filters.from_dict({"max_price": 10, "backdrops": ["Black", 5], "evil": 1, "min_price": -3})
    assert f.max_price == 10 and f.backdrops == ["Black"] and f.min_price is None
    assert Filters.from_dict(f.to_dict()) == f


def test_fmt_and_ago():
    assert fmt_ton(100) == "100.0" and fmt_ton(100.99) == "100.99" and fmt_ton(4.5) == "4.5"
    now = datetime(2026, 11, 5, 12, tzinfo=timezone.utc)
    assert ago(now - timedelta(seconds=10), now) == "только что"
    assert ago(now - timedelta(minutes=5), now) == "5 минут назад"
    assert ago(now - timedelta(hours=1), now) == "1 час назад"
    assert ago(now - timedelta(days=3), now) == "3 дня назад"
    assert ago(now - timedelta(days=140), now) == "4 месяца назад"


def test_render_matches_screenshot_layout_and_escapes():
    now = datetime(2026, 11, 5, 18, tzinfo=timezone.utc)
    info = Enrichment(96.0, 100.0, [
        Sale(1503, 100.99, "portals", now - timedelta(hours=2)),
        Sale(1503, 95.71, "portals", now - timedelta(days=1)),
    ])
    text = render_listing(make(), info, "https://t.me/portals/market?startapp=gift_0b1c-uuid", now)
    assert "<b>ЛИСТИНГ</b>" in text
    assert '<a href="https://t.me/nft/NailBracelet-3300">Nail Bracelet #3300</a> на ' in text
    assert "за <b>100.0 TON</b>" in text
    assert "Модель: Vague Dream" in text and "Фон: Gunship Green" in text
    assert "Флор гифта: <b>96.0</b> TON" in text and "Флор модели: <b>100.0</b> TON" in text
    assert "#1503 за <b>100.99</b> TON на Portals — 2 часа назад" in text
    assert "<blockquote expandable>" in text
    evil = render_listing(make(model="<script>"), Enrichment(), "https://x/1", now)
    assert "<script>" not in evil and "&lt;script&gt;" in evil
    assert "Флор гифта: нет данных" in evil
