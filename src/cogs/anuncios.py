"""Anuncios programados: mensajes de texto que el bot envía solo a un canal,
por intervalo o a una hora fija (ver /settings > Anuncios). Distinto de
frases_especiales (esas se mezclan al azar en el chat Markov)."""

import asyncio
import logging

import discord
from discord.ext import commands, tasks

from db import get_due_scheduled_announcements, update_announcement_last_sent

log = logging.getLogger(__name__)


class Anuncios(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self) -> None:
        self.check_announcements.start()

    async def cog_unload(self) -> None:
        self.check_announcements.cancel()

    @tasks.loop(minutes=1)
    async def check_announcements(self):
        due = await get_due_scheduled_announcements()

        async def _send_one(item: dict) -> None:
            try:
                channel = self.bot.get_channel(item["channel_id"])
                if not isinstance(channel, discord.TextChannel):
                    return
                if not channel.permissions_for(channel.guild.me).send_messages:
                    return
                await channel.send(item["message"])
                await update_announcement_last_sent(item["id"])
            except Exception:
                log.exception("Error enviando anuncio programado %s", item["id"])

        await asyncio.gather(*(_send_one(item) for item in due))

    @check_announcements.before_loop
    async def _wait_ready(self):
        await self.bot.wait_until_ready()


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Anuncios(bot))
