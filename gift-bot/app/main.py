"""Точка входа: python -m app.main"""
from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand

from .bot import OwnerOnly, Status, build_router
from .config import load_config
from .markets.portals import PortalsAuth, PortalsClient
from .scanner import Scanner
from .storage import Storage

COMMANDS = [
    BotCommand(command="filters", description="Текущие фильтры"),
    BotCommand(command="price", description="Цена от и до"),
    BotCommand(command="collection", description="Коллекции"),
    BotCommand(command="model", description="Модели"),
    BotCommand(command="backdrop", description="Фоны"),
    BotCommand(command="symbol", description="Символы"),
    BotCommand(command="reset", description="Сбросить фильтры"),
    BotCommand(command="blocked", description="Заблокированные подарки"),
    BotCommand(command="pause", description="Пауза"),
    BotCommand(command="resume", description="Продолжить"),
    BotCommand(command="status", description="Состояние"),
]


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # Логи HTTP-библиотек могут содержать адреса запросов — держим их тише.
    logging.getLogger("aiogram.event").setLevel(logging.WARNING)
    logging.getLogger("telethon").setLevel(logging.WARNING)

    cfg = load_config()

    storage = Storage(cfg.db_path)
    await storage.open()

    auth = PortalsAuth(cfg.tg_api_id, cfg.tg_api_hash, cfg.session_path)
    await auth.start()
    portals = PortalsClient(auth, cfg.portals_lot_link)

    bot = Bot(cfg.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    owner_only = OwnerOnly(cfg.owner_id)
    dp.message.outer_middleware(owner_only)
    dp.callback_query.outer_middleware(owner_only)
    status = Status()
    dp.include_router(build_router(storage, status))

    await bot.set_my_commands(COMMANDS)
    scanner = Scanner(portals, storage, bot, cfg.owner_id, cfg.poll_interval, status)
    scan_task = asyncio.create_task(scanner.run())
    try:
        await bot.send_message(cfg.owner_id, "🟢 Бот запущен. Слежу за Portals. Команды: /help")
        await dp.start_polling(bot, allowed_updates=["message", "callback_query"])
    finally:
        scan_task.cancel()
        await asyncio.gather(scan_task, return_exceptions=True)
        await portals.close()
        await auth.close()
        await storage.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
