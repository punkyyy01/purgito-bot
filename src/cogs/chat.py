"""Chat: corpus, Markov y respuestas automáticas."""

import logging
import random

import discord
from discord import app_commands
from discord.ext import commands

import generation
from cogs.gifs import save_gif_candidates
from cogs.memes import is_meme_trigger
from config import REFEED_ALL_MAX_MESSAGES, REFEED_MAX_MESSAGES
from db import (
    count_corpus_messages,
    count_user_messages,
    get_chat_settings,
    get_random_gif,
    get_random_reaction,
    is_channel_ignored,
    save_corpus_and_user_message,
)
from utils import chunk_message, has_admin_permission

log = logging.getLogger(__name__)


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
            reply = "..."
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
            reply = "..."
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

        saved = 0
        fetched = 0

        last_msg_id: int | None = None
        while fetched < REFEED_MAX_MESSAGES:
            before_obj = discord.Object(id=last_msg_id) if last_msg_id else None
            try:
                batch = [msg async for msg in channel.history(limit=100, before=before_obj, oldest_first=False)]
            except discord.Forbidden:
                await interaction.followup.send("❌ Sin permisos para leer el historial de este canal.")
                return
            if not batch:
                break
            fetched += len(batch)

            for msg in batch:
                if msg.author.bot:
                    continue
                await save_gif_candidates(interaction.guild.id, msg)
                if await self._save_message_to_corpus(interaction.guild.id, msg):
                    saved += 1

            last_msg_id = batch[-1].id

        result = f"✅ Guardados {saved} mensajes en el corpus."
        if fetched >= REFEED_MAX_MESSAGES:
            result += f"\n⚠️ Límite de {REFEED_MAX_MESSAGES:,} mensajes leídos alcanzado; el canal puede tener más."
        await interaction.followup.send(result)

    @app_commands.command(name="refeed_all", description="Guarda mensajes de todos los canales de texto del servidor en el corpus del modelo Markov.")
    async def refeed_all(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message("Solo en servidores.", ephemeral=True)
            return

        if not has_admin_permission(interaction):
            await interaction.response.send_message("❌ No tienes permisos para usar este comando.", ephemeral=True)
            return

        await interaction.response.defer(thinking=True)

        me = interaction.guild.me
        if me is None and self.bot.user is not None:
            me = interaction.guild.get_member(self.bot.user.id)
        if me is None:
            await interaction.followup.send("No puedo determinar los permisos del bot.")
            return

        total_saved = 0
        any_channel_hit_limit = False

        for channel in interaction.guild.text_channels:
            perms = channel.permissions_for(me)
            if not (perms.read_messages and perms.read_message_history):
                continue
            if await is_channel_ignored(interaction.guild.id, channel.id):
                continue

            channel_fetched = 0
            last_msg_id: int | None = None
            while channel_fetched < REFEED_ALL_MAX_MESSAGES:
                before_obj = discord.Object(id=last_msg_id) if last_msg_id else None
                try:
                    batch = [msg async for msg in channel.history(limit=100, before=before_obj, oldest_first=False)]
                except discord.Forbidden:
                    break
                if not batch:
                    break
                channel_fetched += len(batch)

                for msg in batch:
                    if msg.author.bot:
                        continue
                    await save_gif_candidates(interaction.guild.id, msg)
                    if await self._save_message_to_corpus(interaction.guild.id, msg):
                        total_saved += 1

                last_msg_id = batch[-1].id

            if channel_fetched >= REFEED_ALL_MAX_MESSAGES:
                any_channel_hit_limit = True

        result = f"✅ Refeed_all completado. Total guardado: {total_saved} mensajes."
        if any_channel_hit_limit:
            result += f"\n⚠️ Límite de {REFEED_ALL_MAX_MESSAGES:,} mensajes leídos alcanzado; algunos canales pueden estar incompletos."
        await interaction.followup.send(result)

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
