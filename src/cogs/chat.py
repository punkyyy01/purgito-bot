"""Chat: corpus, Markov y respuestas automáticas."""

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable

import discord
from discord import app_commands
from discord.ext import commands

import generation
import i18n
from cogs.gifs import save_gif_candidates
from cogs.memes import is_meme_trigger
from config import REFEED_ALL_MAX_MESSAGES, REFEED_MAX_MESSAGES
from db import (
    count_corpus_messages,
    count_user_messages,
    get_channel_refeed_status,
    get_chat_settings,
    get_random_gif,
    get_random_reaction,
    is_channel_ignored,
    save_corpus_and_user_message,
    upsert_channel_refeed_status,
)
from utils import chunk_message, has_admin_permission

log = logging.getLogger(__name__)

# guild_id -> task del refeed_all/auto-refeed en curso (evita dos corridas en paralelo)
_refeed_all_running: dict[int, asyncio.Task] = {}


class Chat(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def _save_message_to_corpus(self, guild_id: int, message: discord.Message) -> bool:
        """Limpia y guarda un mensaje en corpus + user_corpus. Retorna si se insertó al corpus."""
        cleaned = generation.clean_for_corpus(message.content or "")
        if cleaned is None:
            return False
        corpus_ins, user_ins = await save_corpus_and_user_message(
            guild_id, message.channel.id,
            message.author.id, message.author.display_name, cleaned,
            message_id=message.id,
        )
        if corpus_ins:
            generation.note_corpus_insert(guild_id, message.channel.id)
        if user_ins:
            generation.note_user_corpus_insert(guild_id, message.author.id)
        return corpus_ins

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return
        if is_meme_trigger(self.bot, message):
            return  # lo maneja el cog de memes; no entra al corpus
        if (message.content or "").strip().startswith("!"):
            return  # comandos de prefijo: los procesa commands.Bot

        auto_generate = False

        if message.guild:
            if await is_channel_ignored(message.guild.id, message.channel.id):
                return

            inserted = await self._save_message_to_corpus(message.guild.id, message)
            if inserted:
                auto_generate = generation.note_message_for_auto_generate(
                    message.guild.id, message.channel.id
                )

            # Reacción aleatoria con emoji del pool configurable
            if random.random() < 0.05:
                try:
                    reaction = await get_random_reaction(message.guild.id)
                    if reaction:
                        await message.add_reaction(reaction["emoji_text"])
                except Exception:
                    log.exception("Error añadiendo reacción emoji")

        # Verificar si el bot fue mencionado o si le respondieron a él directamente
        mention_bot = bool(self.bot.user and self.bot.user.id in (message.raw_mentions or []))
        reply_to_bot = False
        if message.reference and message.reference.message_id and self.bot.user:
            ref_msg = message.reference.resolved
            if isinstance(ref_msg, discord.Message):
                reply_to_bot = ref_msg.author.id == self.bot.user.id

        if not (mention_bot or reply_to_bot):
            if message.guild and auto_generate:
                try:
                    if random.random() < 0.45:
                        gif_url = await get_random_gif(message.guild.id)
                        if gif_url:
                            await message.channel.send(gif_url)
                            return
                    text, is_special = await generation.generate_response(message.guild.id)
                    if text is not None:
                        final = text if is_special else generation.post_process_reply(text)
                        for chunk in chunk_message(final):
                            await message.channel.send(chunk)
                except Exception:
                    log.exception("Error en generación automática de respuesta")
            return

        if not message.guild:
            return

        # Respetar restricciones de canal y modo de chat
        settings = await get_chat_settings(message.guild.id)
        if not settings["enabled"]:
            return
        if settings["channel_id"] and message.channel.id != settings["channel_id"]:
            return

        if random.random() < 0.45:
            gif_url = await get_random_gif(message.guild.id)
            if gif_url:
                await message.reply(gif_url)
                return

        text, is_special = await generation.generate_response(message.guild.id)
        if text is None:
            # Servidor sin historial suficiente: explicar en vez de contestar "...".
            # throttle=True: las instrucciones completas salen 1 vez cada 15 min por guild.
            locale = await i18n.guild_locale(message.guild.id)
            reply = generation.empty_corpus_reply(message.guild.id, locale, throttle=True)
        elif is_special:
            reply = text
        else:
            reply = generation.post_process_reply(text)
        for chunk in chunk_message(reply):
            await message.reply(chunk)

    # --- COMANDOS ---

    @app_commands.command(name="generar", description="Genera un mensaje usando el modelo Markov del canal.")
    async def generar(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message("Solo en servidores.", ephemeral=True)
            return

        await interaction.response.defer(thinking=True)
        if interaction.channel is None:
            await interaction.followup.send("No puedo determinar el canal.", ephemeral=True)
            return
        text, is_special = await generation.generate_response(interaction.guild.id)
        if text is None:
            # Comando explícito: siempre el mensaje completo con instrucciones.
            locale = await i18n.guild_locale(interaction.guild.id)
            reply = generation.empty_corpus_reply(interaction.guild.id, locale)
        elif is_special:
            reply = text
        else:
            reply = generation.post_process_reply(text)
        await interaction.followup.send(reply)

    @app_commands.command(name="imitar", description="Genera un mensaje imitando el estilo de un usuario del servidor.")
    @app_commands.describe(usuario="Usuario a imitar")
    async def imitar(self, interaction: discord.Interaction, usuario: discord.Member):
        if not interaction.guild:
            await interaction.response.send_message("Solo en servidores.", ephemeral=True)
            return

        await interaction.response.defer(thinking=True)

        count = await count_user_messages(interaction.guild.id, usuario.id)
        if count < 30:
            await interaction.followup.send(
                f"⚠️ **{usuario.display_name}** solo tiene {count} mensaje(s) en el corpus. Necesita al menos 30."
            )
            return

        result = await generation.generate_markov_for_user(interaction.guild.id, usuario.id)
        if result is None:
            await interaction.followup.send(
                f"⚠️ No se pudo generar un mensaje para **{usuario.display_name}**. Intenta más tarde."
            )
            return

        await interaction.followup.send(f'🎭 **{usuario.display_name}** diría: "{result}"')

    # --- CORPUS ---

    async def _refeed_channel(self, guild_id: int, channel, max_messages: int) -> dict:
        """Lee el historial de un canal hacia el corpus, con estado persistente por canal.

        Si el backfill ya terminó, hace lectura incremental hacia adelante (sin límite);
        si no, continúa hacia atrás desde donde quedó, hasta max_messages.
        Retorna {"saved", "backfill_complete", "was_incremental", "forbidden"}.
        """
        status = await get_channel_refeed_status(guild_id, channel.id)
        saved = 0
        forbidden = False

        if status and status["backfill_complete"]:
            newest = status["newest_message_id"]
            after_obj = discord.Object(id=newest) if newest else None
            try:
                async for msg in channel.history(limit=None, after=after_obj, oldest_first=True):
                    if newest is None or msg.id > newest:
                        newest = msg.id
                    if msg.author.bot:
                        continue
                    await save_gif_candidates(guild_id, msg)
                    if await self._save_message_to_corpus(guild_id, msg):
                        saved += 1
            except discord.Forbidden:
                forbidden = True
            await upsert_channel_refeed_status(guild_id, channel.id, newest_message_id=newest)
            return {"saved": saved, "backfill_complete": True, "was_incremental": True, "forbidden": forbidden}

        # Backfill hacia atrás: reanuda desde oldest_message_id si una corrida previa quedó a medias.
        newest_seen = status["newest_message_id"] if status else None
        oldest = status["oldest_message_id"] if status else None
        fetched = 0
        complete = False

        while fetched < max_messages:
            before_obj = discord.Object(id=oldest) if oldest else None
            try:
                batch = [msg async for msg in channel.history(limit=100, before=before_obj, oldest_first=False)]
            except discord.Forbidden:
                forbidden = True
                break
            if not batch:
                complete = True
                break
            fetched += len(batch)
            if newest_seen is None or batch[0].id > newest_seen:
                newest_seen = batch[0].id

            for msg in batch:
                if msg.author.bot:
                    continue
                await save_gif_candidates(guild_id, msg)
                if await self._save_message_to_corpus(guild_id, msg):
                    saved += 1

            oldest = batch[-1].id

        await upsert_channel_refeed_status(
            guild_id, channel.id,
            newest_message_id=newest_seen,
            oldest_message_id=oldest,
            backfill_complete=complete,
        )
        return {"saved": saved, "backfill_complete": complete, "was_incremental": False, "forbidden": forbidden}

    async def _refeed_guild(self, guild: discord.Guild, progress_msg, report_channel) -> None:
        """Recorre todos los canales de texto del guild editando progress_msg con el avance,
        y manda el resumen final con report_channel.send() (no depende de ningún interaction)."""
        me = guild.me
        if me is None and self.bot.user is not None:
            me = guild.get_member(self.bot.user.id)
        if me is None:
            log.warning("refeed_guild: no puedo determinar los permisos del bot en %s", guild.id)
            return

        totals = {"saved": 0, "completed": 0, "incremental": 0, "partial": 0, "forbidden": 0, "errors": 0}
        done_lines: list[str] = []

        def render(current: str | None) -> str:
            # ponytail: colapsa el detalle viejo en un contador para no pasar los 2000 chars
            shown = done_lines[-8:]
            lines = []
            if len(done_lines) > len(shown):
                lines.append(f"✅ {len(done_lines) - len(shown)} canales procesados")
            lines += shown
            if current:
                lines.append(current)
            return "\n".join(lines)[:1990] or "🔄 Leyendo historial…"

        async def update(current: str | None) -> None:
            if progress_msg is None:
                return
            try:
                await progress_msg.edit(content=render(current))
            except Exception:
                log.debug("refeed_guild: no se pudo editar el mensaje de progreso", exc_info=True)

        for channel in guild.text_channels:
            perms = channel.permissions_for(me)
            if not (perms.read_messages and perms.read_message_history):
                continue
            if await is_channel_ignored(guild.id, channel.id):
                continue

            await update(f"🔄 {channel.mention} — leyendo historial…")
            try:
                res = await self._refeed_channel(guild.id, channel, REFEED_ALL_MAX_MESSAGES)
            except Exception:
                log.exception("refeed_guild: error procesando canal %s (%s)", channel.id, guild.id)
                totals["errors"] += 1
                done_lines.append(f"❌ {channel.mention} — error inesperado")
                continue

            totals["saved"] += res["saved"]
            if res["forbidden"]:
                totals["forbidden"] += 1
                done_lines.append(f"🚫 {channel.mention} — sin permisos para leer el historial")
            elif res["was_incremental"]:
                totals["incremental"] += 1
                done_lines.append(f"⏭️ {channel.mention} — ya estaba al día ({res['saved']} mensajes nuevos)")
            elif res["backfill_complete"]:
                totals["completed"] += 1
                done_lines.append(f"✅ {channel.mention} — {res['saved']:,} mensajes nuevos (historial completo)")
            else:
                totals["partial"] += 1
                done_lines.append(f"✅ {channel.mention} — {res['saved']:,} mensajes nuevos (historial incompleto por el límite)")

        await update(None)

        parts = [f"🏁 Terminé de leer el historial. Total: {totals['saved']:,} mensajes nuevos guardados."]
        if totals["completed"]:
            parts.append(f"✅ {totals['completed']} canal(es) con historial completo por primera vez.")
        if totals["incremental"]:
            parts.append(f"⏭️ {totals['incremental']} canal(es) que ya estaban al día.")
        if totals["partial"]:
            parts.append(f"⚠️ {totals['partial']} canal(es) quedaron incompletos por el límite de {REFEED_ALL_MAX_MESSAGES:,} mensajes; corre `/refeed_all` de nuevo para continuar donde quedó.")
        if totals["forbidden"]:
            parts.append(f"🚫 {totals['forbidden']} canal(es) sin permisos para leer.")
        if totals["errors"]:
            parts.append(f"❌ {totals['errors']} canal(es) con error.")
        try:
            await report_channel.send("\n".join(parts))
        except Exception:
            log.warning("refeed_guild: no se pudo enviar el resumen final en %s", guild.id)

    def start_refeed_all(
        self,
        guild: discord.Guild,
        progress_msg,
        report_channel,
        on_done: Callable[[], Awaitable[None]] | None = None,
    ) -> bool:
        """Lanza el refeed de todo el guild en background. False si ya hay uno corriendo."""
        existing = _refeed_all_running.get(guild.id)
        if existing and not existing.done():
            return False

        async def runner():
            try:
                await self._refeed_guild(guild, progress_msg, report_channel)
                if on_done is not None:
                    await on_done()
            except Exception:
                log.exception("refeed_all: fallo procesando guild %s", guild.id)
            finally:
                _refeed_all_running.pop(guild.id, None)

        _refeed_all_running[guild.id] = asyncio.create_task(runner())
        return True

    @app_commands.command(name="refeed", description="Guarda los últimos mensajes del canal en el corpus del modelo Markov.")
    async def refeed(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message("Solo en servidores.", ephemeral=True)
            return

        if not has_admin_permission(interaction):
            await interaction.response.send_message("❌ No tienes permisos para usar este comando.", ephemeral=True)
            return

        await interaction.response.defer(thinking=True)

        channel = interaction.channel
        if not isinstance(channel, discord.abc.Messageable):
            await interaction.followup.send("No puedo leer el historial de este canal.")
            return

        if await is_channel_ignored(interaction.guild.id, channel.id):
            await interaction.followup.send("⚠️ Este canal está en la lista de ignorados. Quítalo primero desde `/settings` si quieres incluirlo.")
            return

        res = await self._refeed_channel(interaction.guild.id, channel, REFEED_MAX_MESSAGES)

        if res["forbidden"] and res["saved"] == 0:
            await interaction.followup.send("❌ Sin permisos para leer el historial de este canal.")
            return
        if res["was_incremental"]:
            result = f"⏭️ Este canal ya estaba al día: {res['saved']} mensajes nuevos guardados."
        elif res["backfill_complete"]:
            result = f"✅ Historial completo leído: {res['saved']} mensajes guardados."
        else:
            result = (
                f"✅ Guardados {res['saved']} mensajes (leyendo el historial por primera vez).\n"
                f"⚠️ Límite de {REFEED_MAX_MESSAGES:,} mensajes alcanzado; corre `/refeed` de nuevo para continuar donde quedó."
            )
        await interaction.followup.send(result)

    @app_commands.command(name="refeed_all", description="Guarda mensajes de todos los canales de texto del servidor en el corpus del modelo Markov.")
    async def refeed_all(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message("Solo en servidores.", ephemeral=True)
            return

        if not has_admin_permission(interaction):
            await interaction.response.send_message("❌ No tienes permisos para usar este comando.", ephemeral=True)
            return

        existing = _refeed_all_running.get(interaction.guild.id)
        if existing and not existing.done():
            await interaction.response.send_message("⏳ Ya hay un refeed en curso en este servidor; espera a que termine.", ephemeral=True)
            return

        await interaction.response.send_message("🔄 Empezando a leer el historial de los canales…")
        progress_msg = await interaction.original_response()
        # Refetch como Message normal: la edición vía interaction muere a los 15 min con el token.
        if interaction.channel is not None:
            try:
                progress_msg = await interaction.channel.fetch_message(progress_msg.id)
            except Exception:
                log.debug("refeed_all: no se pudo refetchear el mensaje de progreso", exc_info=True)

        self.start_refeed_all(interaction.guild, progress_msg, interaction.channel)

    @app_commands.command(name="corpus_info", description="Muestra cuántos mensajes hay en el corpus del canal actual.")
    async def corpus_info(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message("Solo en servidores.", ephemeral=True)
            return

        if interaction.channel is None:
            await interaction.response.send_message("No puedo determinar el canal.", ephemeral=True)
            return

        count = await count_corpus_messages(interaction.guild.id, interaction.channel.id)
        msg = f"📊 El corpus de este canal tiene {count} mensajes."
        if count < 50:
            msg += "\n⚠️ Necesita al menos 50 mensajes para generar bien."
        await interaction.response.send_message(msg)

async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Chat(bot))
