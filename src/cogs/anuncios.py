"""Anuncios programados: mensajes de texto que el bot envía solo a un canal,
por intervalo o a una hora fija (ver /settings > Anuncios). Distinto de
frases_especiales (esas se mezclan al azar en el chat Markov)."""

import asyncio
import logging

import json

import discord
from discord.ext import commands, tasks

from db import (
    get_due_scheduled_announcements,
    normalize_embeds_json,
    update_announcement_last_sent,
)
from layout_v2 import build_layout_view

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
                perms = channel.permissions_for(channel.guild.me)
                if not perms.send_messages:
                    return
                if item.get("embed_json") and item.get("content_mode") == "layout_v2":
                    # Layout Components V2 armado en el editor del panel.
                    if not perms.embed_links:
                        return
                    view = build_layout_view(json.loads(item["embed_json"]))
                    await channel.send(view=view)
                elif item.get("embed_json"):
                    # Embeds clásicos. El JSON es siempre una lista (Discord
                    # admite hasta 10); normalize_embeds_json envuelve el formato
                    # viejo de un solo dict, así que este branch no las distingue.
                    if not perms.embed_links:
                        return
                    embeds = [
                        discord.Embed.from_dict(e)
                        for e in normalize_embeds_json(item["embed_json"])
                    ]
                    await channel.send(embeds=embeds)
                else:
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
