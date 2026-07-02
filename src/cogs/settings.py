"""Panel unificado /settings + onboarding (/setup y bienvenida al unirse a un servidor).

Todo el texto pasa por i18n (src/i18n.py + src/locales/*.json).

Para agregar una categoría nueva:
  1. Crear una clase que herede de SettingsCategory (key + build_embed + build_items).
  2. Agregar sus strings a src/locales/*.json (settings.cat.<key>.label/desc/title).
  3. Registrarla en CATEGORIES al final de este módulo.
El sistema de navegación no necesita cambios.
"""

import logging

import discord
from discord import app_commands
from discord.ext import commands

import generation
import i18n
from cogs.premium import is_premium_guild
from cogs.youtube import get_latest_video
from config import BOT_TRIGGER_NAME, PANEL_URL
from db import (
    add_frase_especial,
    add_ignored_channel,
    add_meme_schedule,
    add_reaction_to_pool,
    add_youtube_sub,
    delete_frase_especial,
    get_chat_settings,
    list_frases_especiales,
    list_ignored_channels,
    list_meme_schedules,
    list_reaction_pool,
    list_youtube_subs,
    remove_ignored_channel,
    remove_meme_schedule,
    remove_reaction_from_pool,
    remove_youtube_sub,
    set_chat_mode,
    set_youtube_mention_role,
    update_last_video_id,
    wipe_corpus,
)
from i18n import t

log = logging.getLogger(__name__)

PURGITO_COLOR = 0x8B00FF


# ─── Infraestructura del panel ───────────────────────────────────────────────

class SettingsCategory:
    """Una categoría del panel. Subclases definen key, emoji y sus componentes."""

    key: str = ""
    emoji: str = "⚙️"
    premium_only: bool = False

    def label(self, locale: str) -> str:
        return t(f"settings.cat.{self.key}.label", locale)

    def description(self, locale: str) -> str:
        return t(f"settings.cat.{self.key}.desc", locale)

    def title(self, locale: str) -> str:
        return t(f"settings.cat.{self.key}.title", locale)

    async def build_embed(self, panel: "SettingsPanel") -> discord.Embed:
        raise NotImplementedError

    async def build_items(self, panel: "SettingsPanel") -> list[discord.ui.Item]:
        raise NotImplementedError


class CategorySelect(discord.ui.Select):
    def __init__(self, panel: "SettingsPanel"):
        options = [
            discord.SelectOption(
                label=cat.label(panel.locale),
                description=cat.description(panel.locale)[:100],
                value=cat.key,
                emoji=cat.emoji,
                default=panel.current_key == cat.key,
            )
            for cat in CATEGORIES
        ]
        super().__init__(placeholder=t("settings.select_placeholder", panel.locale), options=options, row=0)
        self.panel = panel

    async def callback(self, interaction: discord.Interaction):
        self.panel.current_key = self.values[0]
        await self.panel.refresh(interaction)


class SettingsPanel(discord.ui.View):
    """Vista navegable: select de categorías (fila 0) + componentes de la categoría actual."""

    def __init__(self, guild: discord.Guild, locale: str, invoker_id: int,
                 intro: tuple[str, str] | None = None):
        super().__init__(timeout=600)
        self.guild = guild
        self.locale = locale
        self.invoker_id = invoker_id
        # (título, cuerpo) mostrado cuando no hay categoría elegida (portada /settings o /setup)
        self.intro = intro or (t("settings.title", locale), t("settings.intro", locale))
        # Footer con el panel web solo en la portada de /settings; /setup ya lo menciona en el cuerpo.
        self.show_panel_footer = intro is None
        self.current_key: str | None = None

    def _category(self) -> SettingsCategory | None:
        for cat in CATEGORIES:
            if cat.key == self.current_key:
                return cat
        return None

    async def build_embed(self) -> discord.Embed:
        cat = self._category()
        if cat is None:
            title, body = self.intro
            embed = discord.Embed(title=title, description=body, color=PURGITO_COLOR)
            if self.show_panel_footer:
                embed.set_footer(text=t("settings.panel_footer", self.locale, url=PANEL_URL))
            return embed
        return await cat.build_embed(self)

    async def rebuild(self) -> None:
        self.clear_items()
        self.add_item(CategorySelect(self))
        cat = self._category()
        if cat is None:
            return
        if cat.premium_only and not is_premium_guild(self.guild.id):
            return
        for item in await cat.build_items(self):
            self.add_item(item)

    async def refresh(self, interaction: discord.Interaction) -> None:
        """Re-renderiza embed + componentes en el mensaje del panel."""
        await self.rebuild()
        embed = await self.build_embed()
        if interaction.response.is_done():
            await interaction.edit_original_response(embed=embed, view=self)
        else:
            await interaction.response.edit_message(embed=embed, view=self)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.invoker_id:
            await interaction.response.send_message(
                t("settings.not_your_panel", self.locale), ephemeral=True
            )
            return False
        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:
            await interaction.response.send_message(
                t("settings.no_permission", self.locale), ephemeral=True
            )
            return False
        return True


def _premium_locked_embed(panel: SettingsPanel, cat: SettingsCategory) -> discord.Embed:
    return discord.Embed(
        title=cat.title(panel.locale),
        description=t("settings.premium_only", panel.locale),
        color=PURGITO_COLOR,
    )


# ─── Categorías ──────────────────────────────────────────────────────────────

class IdiomaCategory(SettingsCategory):
    key = "idioma"
    emoji = "🌐"

    def _language_name(self, locale: str) -> str:
        return dict(i18n.SUPPORTED_LOCALES).get(locale, locale)

    async def build_embed(self, panel: SettingsPanel) -> discord.Embed:
        return discord.Embed(
            title=self.title(panel.locale),
            description=t("settings.idioma.body", panel.locale, language=self._language_name(panel.locale)),
            color=PURGITO_COLOR,
        )

    async def build_items(self, panel: SettingsPanel) -> list[discord.ui.Item]:
        select = discord.ui.Select(
            placeholder=t("settings.idioma.placeholder", panel.locale),
            options=[
                discord.SelectOption(label=name, value=code, default=code == panel.locale)
                for code, name in i18n.SUPPORTED_LOCALES
            ],
            row=1,
        )

        async def on_select(interaction: discord.Interaction):
            new_locale = select.values[0]
            await i18n.set_locale(panel.guild.id, new_locale)
            panel.locale = new_locale
            panel.intro = (t("settings.title", new_locale), t("settings.intro", new_locale))
            await panel.refresh(interaction)

        select.callback = on_select
        return [select]


class ChatCategory(SettingsCategory):
    key = "chat"
    emoji = "💬"

    async def build_embed(self, panel: SettingsPanel) -> discord.Embed:
        settings = await get_chat_settings(panel.guild.id)
        lines = [
            t("settings.chat.status_on" if settings["enabled"] else "settings.chat.status_off", panel.locale)
        ]
        if settings["channel_id"]:
            lines.append(t("settings.chat.channel_only", panel.locale, channel=f"<#{settings['channel_id']}>"))
        else:
            lines.append(t("settings.chat.channel_all", panel.locale))
        return discord.Embed(
            title=self.title(panel.locale),
            description="\n".join(lines),
            color=PURGITO_COLOR,
        )

    async def build_items(self, panel: SettingsPanel) -> list[discord.ui.Item]:
        settings = await get_chat_settings(panel.guild.id)

        enable_btn = discord.ui.Button(
            label=t("settings.chat.btn_enable", panel.locale),
            style=discord.ButtonStyle.success,
            disabled=settings["enabled"],
            row=1,
        )
        disable_btn = discord.ui.Button(
            label=t("settings.chat.btn_disable", panel.locale),
            style=discord.ButtonStyle.danger,
            disabled=not settings["enabled"],
            row=1,
        )
        all_channels_btn = discord.ui.Button(
            label=t("settings.chat.btn_all_channels", panel.locale),
            style=discord.ButtonStyle.secondary,
            disabled=settings["channel_id"] is None,
            row=1,
        )
        channel_select = discord.ui.ChannelSelect(
            channel_types=[discord.ChannelType.text],
            placeholder=t("settings.chat.channel_placeholder", panel.locale),
            row=2,
        )

        async def on_enable(interaction: discord.Interaction):
            current = await get_chat_settings(panel.guild.id)
            await set_chat_mode(panel.guild.id, True, current["channel_id"])
            await panel.refresh(interaction)

        async def on_disable(interaction: discord.Interaction):
            current = await get_chat_settings(panel.guild.id)
            await set_chat_mode(panel.guild.id, False, current["channel_id"])
            await panel.refresh(interaction)

        async def on_all_channels(interaction: discord.Interaction):
            current = await get_chat_settings(panel.guild.id)
            await set_chat_mode(panel.guild.id, current["enabled"], None)
            await panel.refresh(interaction)

        async def on_channel(interaction: discord.Interaction):
            current = await get_chat_settings(panel.guild.id)
            await set_chat_mode(panel.guild.id, current["enabled"], channel_select.values[0].id)
            await panel.refresh(interaction)

        enable_btn.callback = on_enable
        disable_btn.callback = on_disable
        all_channels_btn.callback = on_all_channels
        channel_select.callback = on_channel
        return [enable_btn, disable_btn, all_channels_btn, channel_select]


class CorpusCategory(SettingsCategory):
    key = "corpus"
    emoji = "🚫"

    async def build_embed(self, panel: SettingsPanel) -> discord.Embed:
        channel_ids = await list_ignored_channels(panel.guild.id)
        body = t("settings.corpus.body", panel.locale)
        if channel_ids:
            body += "\n\n" + "\n".join(f"• <#{cid}>" for cid in channel_ids)
        else:
            body += "\n\n" + t("settings.corpus.none", panel.locale)
        return discord.Embed(title=self.title(panel.locale), description=body[:4000], color=PURGITO_COLOR)

    async def build_items(self, panel: SettingsPanel) -> list[discord.ui.Item]:
        channel_select = discord.ui.ChannelSelect(
            channel_types=[discord.ChannelType.text],
            placeholder=t("settings.corpus.placeholder", panel.locale),
            row=1,
        )

        async def on_channel(interaction: discord.Interaction):
            channel_id = channel_select.values[0].id
            ignored = await list_ignored_channels(panel.guild.id)
            if channel_id in ignored:
                await remove_ignored_channel(panel.guild.id, channel_id)
            else:
                await add_ignored_channel(panel.guild.id, channel_id)
            await panel.refresh(interaction)

        channel_select.callback = on_channel

        wipe_btn = discord.ui.Button(
            label=t("settings.corpus.btn_wipe", panel.locale),
            style=discord.ButtonStyle.danger,
            row=2,
        )

        class WipeConfirmModal(discord.ui.Modal):
            def __init__(self):
                super().__init__(title=t("settings.corpus.wipe_modal_title", panel.locale))
                self.confirm_input = discord.ui.TextInput(
                    label=t("settings.corpus.wipe_modal_field", panel.locale)[:45],
                    max_length=100,
                )
                self.add_item(self.confirm_input)

            async def on_submit(self, interaction: discord.Interaction):
                if self.confirm_input.value.strip() != panel.guild.name:
                    await interaction.response.send_message(
                        t("settings.corpus.wipe_mismatch", panel.locale), ephemeral=True
                    )
                    return
                await wipe_corpus(panel.guild.id)
                generation.reset_guild_caches(panel.guild.id)
                await panel.refresh(interaction)
                await interaction.followup.send(
                    t("settings.corpus.wipe_success", panel.locale), ephemeral=True
                )

        async def on_wipe(interaction: discord.Interaction):
            await interaction.response.send_modal(WipeConfirmModal())

        wipe_btn.callback = on_wipe
        return [channel_select, wipe_btn]


class ReaccionesCategory(SettingsCategory):
    key = "reacciones"
    emoji = "😀"

    async def build_embed(self, panel: SettingsPanel) -> discord.Embed:
        pool = await list_reaction_pool(panel.guild.id)
        body = t("settings.reacciones.body", panel.locale)
        if pool:
            body += "\n\n" + "\n".join(f"`{r['id']}` — {r['emoji_text']}" for r in pool)
        else:
            body += "\n\n" + t("settings.reacciones.none", panel.locale)
        return discord.Embed(title=self.title(panel.locale), description=body[:4000], color=PURGITO_COLOR)

    async def build_items(self, panel: SettingsPanel) -> list[discord.ui.Item]:
        items: list[discord.ui.Item] = []

        add_btn = discord.ui.Button(
            label=t("settings.reacciones.btn_add", panel.locale),
            style=discord.ButtonStyle.primary,
            row=1,
        )

        class AddEmojiModal(discord.ui.Modal):
            def __init__(self):
                super().__init__(title=t("settings.reacciones.modal_title", panel.locale))
                self.emoji_input = discord.ui.TextInput(
                    label=t("settings.reacciones.modal_field", panel.locale)[:45],
                    max_length=64,
                )
                self.add_item(self.emoji_input)

            async def on_submit(self, interaction: discord.Interaction):
                text = self.emoji_input.value.strip()
                if not text:
                    await interaction.response.send_message(
                        t("settings.reacciones.invalid", panel.locale), ephemeral=True
                    )
                    return
                await add_reaction_to_pool(panel.guild.id, text)
                await panel.refresh(interaction)

        async def on_add(interaction: discord.Interaction):
            await interaction.response.send_modal(AddEmojiModal())

        add_btn.callback = on_add
        items.append(add_btn)

        pool = await list_reaction_pool(panel.guild.id)
        if pool:
            remove_select = discord.ui.Select(
                placeholder=t("settings.reacciones.remove_placeholder", panel.locale),
                options=[
                    discord.SelectOption(label=r["emoji_text"][:100], value=str(r["id"]))
                    for r in pool[:25]
                ],
                row=2,
            )

            async def on_remove(interaction: discord.Interaction):
                await remove_reaction_from_pool(panel.guild.id, int(remove_select.values[0]))
                await panel.refresh(interaction)

            remove_select.callback = on_remove
            items.append(remove_select)

        return items


class FrasesCategory(SettingsCategory):
    key = "frases"
    emoji = "🗨️"

    async def build_embed(self, panel: SettingsPanel) -> discord.Embed:
        frases = await list_frases_especiales(panel.guild.id)
        body = t("settings.frases.body", panel.locale)
        if frases:
            body += "\n\n" + "\n".join(f"`{f['id']}` — {f['frase']}" for f in frases)
        else:
            body += "\n\n" + t("settings.frases.none", panel.locale)
        return discord.Embed(title=self.title(panel.locale), description=body[:4000], color=PURGITO_COLOR)

    async def build_items(self, panel: SettingsPanel) -> list[discord.ui.Item]:
        items: list[discord.ui.Item] = []

        add_btn = discord.ui.Button(
            label=t("settings.frases.btn_add", panel.locale),
            style=discord.ButtonStyle.primary,
            row=1,
        )

        class AddFraseModal(discord.ui.Modal):
            def __init__(self):
                super().__init__(title=t("settings.frases.modal_title", panel.locale))
                self.frase_input = discord.ui.TextInput(
                    label=t("settings.frases.modal_field", panel.locale)[:45],
                    max_length=300,
                )
                self.add_item(self.frase_input)

            async def on_submit(self, interaction: discord.Interaction):
                text = self.frase_input.value.strip()
                if not text:
                    await interaction.response.send_message(
                        t("settings.frases.invalid", panel.locale), ephemeral=True
                    )
                    return
                await add_frase_especial(panel.guild.id, interaction.user.id, interaction.user.display_name, text)
                await panel.refresh(interaction)

        async def on_add(interaction: discord.Interaction):
            await interaction.response.send_modal(AddFraseModal())

        add_btn.callback = on_add
        items.append(add_btn)

        frases = await list_frases_especiales(panel.guild.id)
        if frases:
            remove_select = discord.ui.Select(
                placeholder=t("settings.frases.remove_placeholder", panel.locale),
                options=[
                    discord.SelectOption(label=f["frase"][:100], value=str(f["id"]))
                    for f in frases[:25]
                ],
                row=2,
            )

            async def on_remove(interaction: discord.Interaction):
                await delete_frase_especial(panel.guild.id, int(remove_select.values[0]))
                await panel.refresh(interaction)

            remove_select.callback = on_remove
            items.append(remove_select)

        return items


class YouTubeCategory(SettingsCategory):
    key = "youtube"
    emoji = "📺"

    async def build_embed(self, panel: SettingsPanel) -> discord.Embed:
        subs = await list_youtube_subs(panel.guild.id)
        body = t("settings.youtube.body", panel.locale)
        if subs:
            body += "\n\n" + "\n".join(
                f"• **{s['youtube_channel_name']}** → <#{s['discord_channel_id']}>" for s in subs
            )
        else:
            body += "\n\n" + t("settings.youtube.none", panel.locale)
        if getattr(panel, "yt_pending_channel", None):
            body += "\n\n" + t("settings.youtube.add_pending_hint", panel.locale)
        if getattr(panel, "yt_add_error", False):
            body += "\n\n" + t("settings.youtube.add_invalid", panel.locale)
            panel.yt_add_error = False
        if getattr(panel, "yt_pending_mention", None):
            body += "\n\n" + t("settings.youtube.mention_pending_hint", panel.locale)
        return discord.Embed(title=self.title(panel.locale), description=body[:4000], color=PURGITO_COLOR)

    async def build_items(self, panel: SettingsPanel) -> list[discord.ui.Item]:
        subs = await list_youtube_subs(panel.guild.id)
        items: list[discord.ui.Item] = []

        if subs:
            remove_select = discord.ui.Select(
                placeholder=t("settings.youtube.remove_placeholder", panel.locale),
                options=[
                    discord.SelectOption(
                        label=s["youtube_channel_name"][:100],
                        value=s["youtube_channel_id"],
                    )
                    for s in subs[:25]
                ],
                row=1,
            )

            async def on_remove(interaction: discord.Interaction):
                await remove_youtube_sub(panel.guild.id, remove_select.values[0])
                await panel.refresh(interaction)

            remove_select.callback = on_remove
            items.append(remove_select)

        pending_channel: str | None = getattr(panel, "yt_pending_channel", None)
        if pending_channel:
            dest_select = discord.ui.ChannelSelect(
                channel_types=[discord.ChannelType.text],
                placeholder=t("settings.youtube.add_channel_placeholder", panel.locale),
                row=2,
            )

            async def on_dest_channel(interaction: discord.Interaction):
                video = await get_latest_video(pending_channel)
                panel.yt_pending_channel = None
                if video is None:
                    panel.yt_add_error = True
                    await panel.refresh(interaction)
                    return
                channel_name = video["author"] or pending_channel
                added = await add_youtube_sub(
                    panel.guild.id,
                    interaction.channel.id if interaction.channel else 0,
                    pending_channel,
                    channel_name,
                    dest_select.values[0].id,
                )
                if added:
                    await update_last_video_id(panel.guild.id, pending_channel, video["id"])
                await panel.refresh(interaction)

            dest_select.callback = on_dest_channel
            items.append(dest_select)
        else:
            add_btn = discord.ui.Button(
                label=t("settings.youtube.btn_add", panel.locale),
                style=discord.ButtonStyle.primary,
                row=2,
            )

            class AddChannelModal(discord.ui.Modal):
                def __init__(self):
                    super().__init__(title=t("settings.youtube.add_modal_title", panel.locale))
                    self.channel_input = discord.ui.TextInput(
                        label=t("settings.youtube.add_modal_field", panel.locale)[:45],
                        max_length=100,
                    )
                    self.add_item(self.channel_input)

                async def on_submit(self, interaction: discord.Interaction):
                    text = self.channel_input.value.strip()
                    if not text:
                        await interaction.response.send_message(
                            t("settings.youtube.add_invalid", panel.locale), ephemeral=True
                        )
                        return
                    panel.yt_pending_channel = text
                    await panel.refresh(interaction)

            async def on_add(interaction: discord.Interaction):
                await interaction.response.send_modal(AddChannelModal())

            add_btn.callback = on_add
            items.append(add_btn)

        pending_mention: str | None = getattr(panel, "yt_pending_mention", None)
        if pending_mention:
            role_select = discord.ui.RoleSelect(
                placeholder=t("settings.youtube.mention_role_placeholder", panel.locale),
                min_values=0,
                max_values=1,
                row=3,
            )

            async def on_role(interaction: discord.Interaction):
                role_id = role_select.values[0].id if role_select.values else None
                await set_youtube_mention_role(panel.guild.id, pending_mention, role_id)
                panel.yt_pending_mention = None
                await panel.refresh(interaction)

            role_select.callback = on_role
            items.append(role_select)
        elif subs:
            mention_select = discord.ui.Select(
                placeholder=t("settings.youtube.mention_placeholder", panel.locale),
                options=[
                    discord.SelectOption(
                        label=s["youtube_channel_name"][:100],
                        value=s["youtube_channel_id"],
                    )
                    for s in subs[:25]
                ],
                row=3,
            )

            async def on_mention_target(interaction: discord.Interaction):
                panel.yt_pending_mention = mention_select.values[0]
                await panel.refresh(interaction)

            mention_select.callback = on_mention_target
            items.append(mention_select)

        return items


class MemesCategory(SettingsCategory):
    key = "memes"
    emoji = "😏"
    premium_only = True

    async def build_embed(self, panel: SettingsPanel) -> discord.Embed:
        if not is_premium_guild(panel.guild.id):
            return _premium_locked_embed(panel, self)
        schedules = await list_meme_schedules(panel.guild.id)
        body = t("settings.memes.body", panel.locale)
        if schedules:
            body += "\n\n" + "\n".join(
                f"• <#{s['channel_id']}> — " + t("settings.memes.entry", panel.locale, hours=s["interval_minutes"] // 60)
                for s in schedules
            )
        else:
            body += "\n\n" + t("settings.memes.none", panel.locale)
        if getattr(panel, "memes_pending_interval", None):
            body += "\n\n" + t("settings.memes.activate_pending_hint", panel.locale)
        return discord.Embed(title=self.title(panel.locale), description=body[:4000], color=PURGITO_COLOR)

    async def build_items(self, panel: SettingsPanel) -> list[discord.ui.Item]:
        schedules = await list_meme_schedules(panel.guild.id)
        items: list[discord.ui.Item] = []

        if schedules:
            channel_names = {
                s["channel_id"]: getattr(panel.guild.get_channel(s["channel_id"]), "name", str(s["channel_id"]))
                for s in schedules
            }
            remove_select = discord.ui.Select(
                placeholder=t("settings.memes.remove_placeholder", panel.locale),
                options=[
                    discord.SelectOption(label=f"#{channel_names[s['channel_id']]}"[:100], value=str(s["channel_id"]))
                    for s in schedules[:25]
                ],
                row=1,
            )

            async def on_remove(interaction: discord.Interaction):
                await remove_meme_schedule(panel.guild.id, int(remove_select.values[0]))
                await panel.refresh(interaction)

            remove_select.callback = on_remove
            items.append(remove_select)

        pending_interval: int | None = getattr(panel, "memes_pending_interval", None)
        if pending_interval:
            channel_select = discord.ui.ChannelSelect(
                channel_types=[discord.ChannelType.text],
                placeholder=t("settings.memes.activate_channel_placeholder", panel.locale),
                row=2,
            )

            async def on_channel(interaction: discord.Interaction):
                await add_meme_schedule(panel.guild.id, channel_select.values[0].id, pending_interval * 60)
                panel.memes_pending_interval = None
                await panel.refresh(interaction)

            channel_select.callback = on_channel
            items.append(channel_select)
        else:
            activate_btn = discord.ui.Button(
                label=t("settings.memes.btn_activate", panel.locale),
                style=discord.ButtonStyle.primary,
                row=2,
            )

            class ActivateModal(discord.ui.Modal):
                def __init__(self):
                    super().__init__(title=t("settings.memes.activate_modal_title", panel.locale))
                    self.interval_input = discord.ui.TextInput(
                        label=t("settings.memes.activate_modal_field", panel.locale)[:45],
                        max_length=3,
                    )
                    self.add_item(self.interval_input)

                async def on_submit(self, interaction: discord.Interaction):
                    raw = self.interval_input.value.strip()
                    if not raw.isdigit() or not (2 <= int(raw) <= 24):
                        await interaction.response.send_message(
                            t("settings.memes.activate_invalid", panel.locale), ephemeral=True
                        )
                        return
                    panel.memes_pending_interval = int(raw)
                    await panel.refresh(interaction)

            async def on_activate(interaction: discord.Interaction):
                await interaction.response.send_modal(ActivateModal())

            activate_btn.callback = on_activate
            items.append(activate_btn)

        return items


# Registro de categorías: agregar aquí las nuevas (orden = orden en el menú).
CATEGORIES: list[SettingsCategory] = [
    IdiomaCategory(),
    ChatCategory(),
    CorpusCategory(),
    ReaccionesCategory(),
    FrasesCategory(),
    YouTubeCategory(),
    MemesCategory(),
]


# ─── Onboarding ──────────────────────────────────────────────────────────────

def build_welcome_embed(guild: discord.Guild, locale: str) -> discord.Embed:
    is_prem = is_premium_guild(guild.id)
    parts = [
        t("welcome.intro", locale),
        "",
        t("welcome.getting_started", locale),
    ]
    if is_prem:
        parts.append(t("welcome.premium_target", locale))
    parts += ["", t("welcome.commands_header", locale), t("welcome.commands", locale)]
    if is_prem:
        parts.append(t("welcome.premium_momo", locale))
    parts.append(t("welcome.commands_tail", locale))
    parts.append("")
    if is_prem:
        parts.append(t("welcome.trigger_hint", locale, trigger=BOT_TRIGGER_NAME))
    else:
        parts.append(t("welcome.free_note", locale))
    return discord.Embed(
        title=t("welcome.title", locale),
        description="\n".join(parts),
        color=PURGITO_COLOR,
    )


class WelcomeView(discord.ui.View):
    """Botón persistente de bienvenida: abre el panel de setup en modo efímero."""

    def __init__(self, locale: str = i18n.DEFAULT_LOCALE):
        super().__init__(timeout=None)
        self.configure_btn.label = t("welcome.btn_configure", locale)

    @discord.ui.button(style=discord.ButtonStyle.primary, custom_id="purgito_setup_btn")
    async def configure_btn(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.guild:
            return
        locale = await i18n.guild_locale(interaction.guild.id)
        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:
            await interaction.response.send_message(t("settings.no_permission", locale), ephemeral=True)
            return
        await _send_setup_panel(interaction, locale)


async def _send_setup_panel(interaction: discord.Interaction, locale: str) -> None:
    panel = SettingsPanel(
        interaction.guild,
        locale,
        interaction.user.id,
        intro=(t("setup.title", locale),
               t("setup.body", locale) + "\n\n" + t("setup.panel_cta", locale, url=PANEL_URL)),
    )
    await panel.rebuild()
    embed = await panel.build_embed()
    await interaction.response.send_message(embed=embed, view=panel, ephemeral=True)


# ─── Cog ─────────────────────────────────────────────────────────────────────

class Settings(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self) -> None:
        # Vista persistente: el botón de bienvenida sigue funcionando tras reinicios.
        self.bot.add_view(WelcomeView())

    @commands.Cog.listener()
    async def on_guild_join(self, guild: discord.Guild):
        locale = await i18n.guild_locale(guild.id)
        embed = build_welcome_embed(guild, locale)
        view = WelcomeView(locale)
        for channel in guild.text_channels:
            perms = channel.permissions_for(guild.me)
            if perms.send_messages:
                try:
                    await channel.send(embed=embed, view=view)
                except Exception:
                    log.warning("on_guild_join: no se pudo enviar mensaje en %s (%s)", channel.id, guild.id)
                break

    @app_commands.command(name="settings", description="Abre el panel de configuración del servidor.")
    async def settings(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message(t("settings.guild_only"), ephemeral=True)
            return
        locale = await i18n.guild_locale(interaction.guild.id)
        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:
            await interaction.response.send_message(t("settings.no_permission", locale), ephemeral=True)
            return
        panel = SettingsPanel(interaction.guild, locale, interaction.user.id)
        await panel.rebuild()
        embed = await panel.build_embed()
        await interaction.response.send_message(embed=embed, view=panel, ephemeral=True)

    @app_commands.command(name="setup", description="Guía de configuración inicial de Purgito.")
    async def setup_cmd(self, interaction: discord.Interaction):
        if not interaction.guild:
            await interaction.response.send_message(t("settings.guild_only"), ephemeral=True)
            return
        locale = await i18n.guild_locale(interaction.guild.id)
        if not isinstance(interaction.user, discord.Member) or not interaction.user.guild_permissions.manage_guild:
            await interaction.response.send_message(t("settings.no_permission", locale), ephemeral=True)
            return
        await _send_setup_panel(interaction, locale)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Settings(bot))
