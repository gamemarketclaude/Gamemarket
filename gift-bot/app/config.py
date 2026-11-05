"""Настройки бота. Все секреты берутся только из переменных окружения / файла .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

DEFAULT_PORTALS_LOT_LINK = "https://t.me/portals/market?startapp=gift_{id}"


@dataclass(frozen=True)
class Config:
    bot_token: str
    owner_id: int
    tg_api_id: int
    tg_api_hash: str
    session_path: Path
    db_path: Path
    poll_interval: float
    portals_lot_link: str


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value or value.startswith("PUT_"):
        raise SystemExit(f"Переменная {name} не задана. Заполни файл .env (образец — .env.example).")
    return value


def _required_int(name: str) -> int:
    raw = _required(name)
    try:
        return int(raw)
    except ValueError:
        raise SystemExit(f"Переменная {name} должна быть числом.") from None


def load_telegram_account() -> tuple[int, str, Path]:
    """Только данные отдельного аккаунта — нужно скрипту входа, которому не нужен токен бота."""
    load_dotenv(BASE_DIR / ".env")
    DATA_DIR.mkdir(mode=0o700, exist_ok=True)
    return _required_int("TG_API_ID"), _required("TG_API_HASH"), DATA_DIR / "account"


def load_config() -> Config:
    api_id, api_hash, session_path = load_telegram_account()

    try:
        poll = float(os.getenv("POLL_INTERVAL", "2"))
    except ValueError:
        raise SystemExit("POLL_INTERVAL должен быть числом.") from None
    # Не чаще раза в секунду: иначе маркет может заблокировать доступ.
    poll = max(poll, 1.0)

    lot_link = os.getenv("PORTALS_LOT_LINK", "").strip() or DEFAULT_PORTALS_LOT_LINK
    if "{id}" not in lot_link or not lot_link.startswith("https://"):
        raise SystemExit("PORTALS_LOT_LINK должен начинаться с https:// и содержать {id}.")

    return Config(
        bot_token=_required("BOT_TOKEN"),
        owner_id=_required_int("OWNER_ID"),
        tg_api_id=api_id,
        tg_api_hash=api_hash,
        session_path=session_path,
        db_path=DATA_DIR / "bot.sqlite3",
        poll_interval=poll,
        portals_lot_link=lot_link,
    )
