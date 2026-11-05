"""Команды бота и кнопки. Отвечает только владельцу (OWNER_ID)."""
from __future__ import annotations

import logging
import time
from html import escape
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware, F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    TelegramObject,
)

from .filters import FilterError, Filters, clean_items, clean_price
from .render import fmt_ton
from .storage import Storage

log = logging.getLogger(__name__)

HELP = """<b>Бот листингов подарков</b>
Присылаю новые лоты с маркетов. Сейчас подключён: Portals.

<b>Фильтры</b> (все необязательные, без них присылаю всё):
/price 0 10 — цена от и до в TON (<code>-</code> = без ограничения, например <code>/price - 10</code>)
/collection Nail Bracelet, Plush Pepe — только эти коллекции
/model Vague Dream — только эти модели
/backdrop Black — только эти фоны
/symbol Kite — только эти символы
Чтобы убрать фильтр: <code>/backdrop -</code>
/filters — показать текущие фильтры
/reset — сбросить все фильтры

<b>Прочее</b>
/blocked — заблокированные подарки
/pause и /resume — приостановить или возобновить уведомления
/status — состояние бота"""


class Status:
    """Простое состояние для /status."""

    def __init__(self) -> None:
        self.started_at = time.time()
        self.last_ok: float | None = None
        self.last_error: str | None = None
        self.sent = 0


class OwnerOnly(BaseMiddleware):
    """Пропускает только владельца. Чужие сообщения молча игнорируются."""

    def __init__(self, owner_id: int):
        self.owner_id = owner_id

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        user = getattr(event, "from_user", None)
        if user is None or user.id != self.owner_id:
            if isinstance(event, CallbackQuery):
                await event.answer()
            return None
        return await handler(event, data)


def listing_keyboard(lot_url: str, key_id: str, blocked: bool = False) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Ссылка", url=lot_url)],
            [
                InlineKeyboardButton(
                    text="Разблокировать подарок" if blocked else "Заблокировать подарок",
                    callback_data=f"{'unb' if blocked else 'blk'}:{key_id}",
                )
            ],
        ]
    )


def describe_filters(f: Filters) -> str:
    if f.is_empty():
        return "Фильтров нет — присылаю все новые лоты."
    lo = fmt_ton(f.min_price) if f.min_price is not None else "—"
    hi = fmt_ton(f.max_price) if f.max_price is not None else "—"
    rows = [f"Цена: от {lo} до {hi} TON"]
    for title, items in (
        ("Коллекции", f.collections),
        ("Модели", f.models),
        ("Фоны", f.backdrops),
        ("Символы", f.symbols),
    ):
        rows.append(f"{title}: {escape(', '.join(items)) if items else 'любые'}")
    return "<b>Текущие фильтры</b>\n" + "\n".join(rows)


def _parse_price(token: str) -> float | None:
    if token in ("-", "—"):
        return None
    try:
        return float(token.replace(",", "."))
    except ValueError:
        raise FilterError(f"«{escape(token[:20])}» — не число.") from None


def build_router(storage: Storage, status: Status) -> Router:
    router = Router()

    @router.message(Command("start", "help"))
    async def cmd_help(message: Message) -> None:
        await message.answer(HELP)

    @router.message(Command("filters"))
    async def cmd_filters(message: Message) -> None:
        await message.answer(describe_filters(await storage.get_filters()))

    @router.message(Command("reset"))
    async def cmd_reset(message: Message) -> None:
        await storage.save_filters(Filters())
        await message.answer("Фильтры сброшены. Присылаю все новые лоты.")

    @router.message(Command("price"))
    async def cmd_price(message: Message, command: CommandObject) -> None:
        parts = (command.args or "").split()
        if len(parts) != 2:
            await message.answer("Формат: <code>/price 0 10</code> или <code>/price - 10</code>")
            return
        try:
            lo, hi = (clean_price(_parse_price(p)) for p in parts)
            if lo is not None and hi is not None and lo > hi:
                raise FilterError("Минимальная цена больше максимальной.")
        except FilterError as exc:
            await message.answer(str(exc))
            return
        f = await storage.get_filters()
        f.min_price, f.max_price = lo, hi
        await storage.save_filters(f)
        await message.answer(describe_filters(f))

    def list_command(name: str, field_name: str) -> None:
        @router.message(Command(name))
        async def handler(message: Message, command: CommandObject) -> None:
            args = (command.args or "").strip()
            if not args:
                await message.answer(
                    f"Формат: <code>/{name} значение1, значение2</code>. Убрать фильтр: <code>/{name} -</code>"
                )
                return
            try:
                items = [] if args in ("-", "—") else clean_items(args.split(","))
            except FilterError as exc:
                await message.answer(escape(str(exc)))
                return
            f = await storage.get_filters()
            setattr(f, field_name, items)
            await storage.save_filters(f)
            await message.answer(describe_filters(f))

    list_command("collection", "collections")
    list_command("model", "models")
    list_command("backdrop", "backdrops")
    list_command("symbol", "symbols")

    @router.message(Command("pause"))
    async def cmd_pause(message: Message) -> None:
        await storage.set_paused(True)
        await message.answer("⏸ Уведомления на паузе. Вернуть: /resume")

    @router.message(Command("resume"))
    async def cmd_resume(message: Message) -> None:
        await storage.set_paused(False)
        await message.answer("▶️ Уведомления включены.")

    @router.message(Command("status"))
    async def cmd_status(message: Message) -> None:
        paused = await storage.is_paused()
        last_ok = (
            f"{int(time.time() - status.last_ok)} сек. назад" if status.last_ok else "ещё не было"
        )
        text = (
            f"Состояние: {'⏸ пауза' if paused else '▶️ работает'}\n"
            f"Последний успешный опрос Portals: {last_ok}\n"
            f"Отправлено уведомлений: {status.sent}"
        )
        if status.last_error:
            text += f"\nПоследняя ошибка: {escape(status.last_error)}"
        await message.answer(text)

    @router.message(Command("blocked"))
    async def cmd_blocked(message: Message) -> None:
        keys = await storage.list_blocked()
        if not keys:
            await message.answer("Заблокированных подарков нет.")
            return
        rows = []
        for key in keys:
            key_id = await storage.remember_gift(key)
            rows.append([InlineKeyboardButton(text=f"Разблокировать {key}"[:64], callback_data=f"unb:{key_id}")])
        await message.answer(
            "Заблокированные подарки (нажми, чтобы разблокировать):",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=rows),
        )

    @router.callback_query(F.data.regexp(r"^(blk|unb):[0-9a-f]{16}$"))
    async def on_block(call: CallbackQuery) -> None:
        action, key_id = call.data.split(":", 1)
        gift_key = await storage.gift_by_id(key_id)
        if gift_key is None:
            await call.answer("Подарок не найден", show_alert=True)
            return
        block = action == "blk"
        await storage.set_blocked(gift_key, block)
        await call.answer(f"{gift_key} {'заблокирован' if block else 'разблокирован'}")
        # Обновляем кнопку под уведомлением, если это оно.
        if not isinstance(call.message, Message):
            return  # сообщение слишком старое, Telegram его уже не отдаёт
        markup = call.message.reply_markup
        if markup and markup.inline_keyboard and markup.inline_keyboard[0][0].url:
            await call.message.edit_reply_markup(
                reply_markup=listing_keyboard(markup.inline_keyboard[0][0].url, key_id, blocked=block)
            )

    return router
