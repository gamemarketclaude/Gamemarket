"""Одноразовый вход в ОТДЕЛЬНЫЙ Telegram-аккаунт и проверка доступа к Portals.

Запуск: python -m scripts.login

Создаёт файл data/account.session. Это полный доступ к аккаунту — никому его не отдавай
и не коммить (data/ уже в .gitignore).
"""
from __future__ import annotations

import asyncio
import os

from telethon import TelegramClient

from app.config import load_telegram_account
from app.markets.portals import PortalsAuth, PortalsClient


async def main() -> None:
    api_id, api_hash, session_path = load_telegram_account()

    print("Вход в отдельный аккаунт. Telegram пришлёт код в приложение этого аккаунта.")
    client = TelegramClient(str(session_path), api_id, api_hash)
    await client.start()  # спросит номер, код и пароль 2FA прямо в терминале
    me = await client.get_me()
    print(f"Вошёл как: {me.first_name} (id {me.id})")
    await client.disconnect()
    try:
        os.chmod(str(session_path) + ".session", 0o600)
    except OSError:
        pass

    print("Проверяю доступ к Portals…")
    auth = PortalsAuth(api_id, api_hash, session_path)
    await auth.start()
    portals = PortalsClient(auth, "https://example.invalid/{id}")
    try:
        listings = await portals.latest_listings(5)
        print(f"Готово: Portals отдал {len(listings)} последних лотов.")
        for l in listings:
            print(f"  {l.collection} #{l.number} — {l.price} TON (модель {l.model}, фон {l.backdrop})")
    finally:
        await portals.close()
        await auth.close()


if __name__ == "__main__":
    asyncio.run(main())
