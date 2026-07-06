"""Notificaciones de YouTube: suscripciones por RSS y chequeo periódico."""

import asyncio
import logging

import discord
import feedparser
import requests
from discord.ext import commands, tasks

from db import get_all_youtube_subs, update_last_video_id

log = logging.getLogger(__name__)


async def get_latest_video(youtube_channel_id: str) -> dict | None:
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={youtube_channel_id}"
    try:
        # Se descarga con timeout explícito: feedparser.parse(url) usa urllib
        # sin timeout y puede colgar el thread (y con él, el loop de chequeo).
        def _fetch():
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            return feedparser.parse(resp.content)

        feed = await asyncio.to_thread(_fetch)
        if not feed.entries:
            return None
        entry = feed.entries[0]
        video_id = getattr(entry, "yt_videoid", None) or entry.get("id", "").split(":")[-1]
        if not video_id:
            return None
        return {
            "id": video_id,
            "title": entry.get("title", ""),
            "url": entry.get("link", ""),
            "author": entry.get("author", ""),
        }
    except Exception:
        log.exception("Error obteniendo RSS para canal YouTube %s", youtube_channel_id)
        return None


class YouTube(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self) -> None:
        self.check_youtube.start()

    async def cog_unload(self) -> None:
        self.check_youtube.cancel()

    @tasks.loop(minutes=15)
    async def check_youtube(self):
        subs = await get_all_youtube_subs()

        async def _check_one(sub: dict) -> None:
            try:
                video = await get_latest_video(sub["youtube_channel_id"])
                if video is None:
                    return
                if video["id"] != sub["last_video_id"]:
                    channel = self.bot.get_channel(sub["discord_channel_id"])
                    if channel and isinstance(channel, discord.TextChannel):
                        mention = ""
                        if sub.get("mention_role_id"):
                            mention = f"<@&{sub['mention_role_id']}> "
                        await channel.send(
                            f"{mention}📺 **{video['author']}** subió un video nuevo!\n"
                            f"**{video['title']}**\n{video['url']}"
                        )
                        await update_last_video_id(sub["guild_id"], sub["youtube_channel_id"], video["id"])
            except Exception:
                log.exception("Error procesando suscripción YouTube %s", sub["youtube_channel_id"])

        await asyncio.gather(*(_check_one(sub) for sub in subs))

    @check_youtube.before_loop
    async def _wait_ready(self):
        await self.bot.wait_until_ready()


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(YouTube(bot))
