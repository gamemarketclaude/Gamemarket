from app.bot import Status
from app.filters import Filters
from app.models import Enrichment
from app.scanner import Scanner
from app.storage import Storage

from .test_core import make


class FakeMarket:
    def __init__(self):
        self.listings = []

    async def latest_listings(self, limit):
        return list(self.listings)

    async def enrich(self, listing):
        return Enrichment(collection_floor=1.0)

    def lot_url(self, listing):
        return f"https://t.me/portals/market?startapp=gift_{listing.nft_id}"


class FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, **kw):
        self.sent.append((chat_id, text, kw))


async def test_scanner_flow(tmp_path):
    storage = Storage(tmp_path / "db.sqlite3")
    await storage.open()
    market, bot = FakeMarket(), FakeBot()
    sc = Scanner(market, storage, bot, owner_id=42, interval=1, status=Status())

    market.listings = [make(nft_id="old")]
    await sc.tick()                       # первый проход: только запоминаем
    assert bot.sent == []

    market.listings = [make(nft_id="new", price=5.0), make(nft_id="old")]
    await sc.tick()
    assert len(bot.sent) == 1 and bot.sent[0][0] == 42
    kb = bot.sent[0][2]["reply_markup"].inline_keyboard
    assert kb[0][0].url.endswith("gift_new") and kb[1][0].callback_data.startswith("blk:")

    await sc.tick()                       # тот же лот второй раз не присылаем
    assert len(bot.sent) == 1

    await storage.save_filters(Filters(max_price=10))
    market.listings = [make(nft_id="pricey", price=50.0), make(nft_id="cheap", price=9.0)]
    await sc.tick()
    assert len(bot.sent) == 2 and "gift_cheap" in bot.sent[-1][2]["reply_markup"].inline_keyboard[0][0].url

    await storage.set_blocked(make(number=1).gift_key, True)
    market.listings = [make(nft_id="blocked", number=1, price=1.0)]
    await sc.tick()
    assert len(bot.sent) == 2

    await storage.set_paused(True)
    market.listings = [make(nft_id="paused", number=2, price=1.0)]
    await sc.tick()
    assert len(bot.sent) == 2
    await storage.close()
