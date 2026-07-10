"""Sistema premium_guilds: estado compartido, gestionado desde el panel de administración."""

import logging

from discord.ext import commands

from config import PANEL_URL, PURGATORY_GUILD_ID
from db import add_premium_guild, list_premium_guilds, remove_premium_guild

log = logging.getLogger(__name__)

# Set poblado desde la tabla premium_guilds al cargar el cog; consultado por
# el resto de cogs en cada feature premium.
_premium_guild_ids: set[int] = set()


def is_premium_guild(guild_id: int | None) -> bool:
    """Retorna True si el guild tiene acceso a features premium (memes, pool de imágenes, etc.)."""
    if guild_id == PURGATORY_GUILD_ID:
        return True
    if guild_id is None:
        return False
    return guild_id in _premium_guild_ids


def premium_required_message() -> str:
    """Texto estándar del gate de premium; único lugar donde se redacta."""
    return (
        "⭐ Esta función solo está disponible en servidores premium. "
        f"Puedes ver cómo conseguirlo en {PANEL_URL}"
    )


def discard_premium_guild(guild_id: int) -> None:
    _premium_guild_ids.discard(guild_id)


async def set_premium(guild_id: int, note: str | None = None) -> bool:
    """Agrega un guild a premium: escribe en DB y sincroniza el set en memoria.

    Retorna True si era nuevo (igual que add_premium_guild)."""
    added = await add_premium_guild(guild_id, note)
    _premium_guild_ids.add(guild_id)
    return added


async def unset_premium(guild_id: int) -> bool:
    """Quita un guild de premium: escribe en DB y sincroniza el set en memoria.

    Retorna True si existía (igual que remove_premium_guild)."""
    removed = await remove_premium_guild(guild_id)
    _premium_guild_ids.discard(guild_id)
    return removed


class Premium(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self) -> None:
        global _premium_guild_ids
        _premium_guild_ids = {g["guild_id"] for g in await list_premium_guilds()}
        log.info("Servidores premium cargados: %s", _premium_guild_ids)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Premium(bot))
