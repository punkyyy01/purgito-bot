"""Tests del aviso de chat silenciado (cogs/chat.py).

Cubren el throttle por guild (mensaje completo → 🤐 dentro del cooldown) y la
regresión más delicada del reordenamiento de on_message: un canal ignorado
NUNCA debe guardar mensajes al corpus, con o sin mención al bot.

Sin bot ni red: db e i18n se parchean con monkeypatch, discord.Message se
simula con un fake mínimo, y el flujo async se ejecuta con asyncio.run.
"""

import asyncio
from types import SimpleNamespace

import pytest

import i18n
import cogs.chat as chat_mod
from cogs.chat import Chat

BOT_ID = 999


class FakeMessage:
    def __init__(self, mention=True, guild_id=1, channel_id=10):
        self.id = 123
        self.author = SimpleNamespace(bot=False, id=5, display_name="user")
        self.guild = SimpleNamespace(id=guild_id)
        self.channel = SimpleNamespace(id=channel_id)
        self.content = "hola" + (f" <@{BOT_ID}>" if mention else " mundo")
        self.raw_mentions = [BOT_ID] if mention else []
        self.reference = None
        self.replies: list[str] = []
        self.reactions: list[str] = []

    async def reply(self, text):
        self.replies.append(text)

    async def add_reaction(self, emoji):
        self.reactions.append(emoji)


@pytest.fixture
def cog(monkeypatch):
    """Cog de Chat aislado: cooldowns limpios, db parcheada, azar desactivado."""
    chat_mod._muted_reply_cooldowns.clear()
    # random() = 1.0: nunca dispara la reacción aleatoria (0.05) ni el GIF (0.45).
    monkeypatch.setattr(chat_mod, "random", SimpleNamespace(random=lambda: 1.0))

    saved: list[str] = []

    async def fake_save(guild_id, channel_id, author_id, name, text, message_id=None):
        saved.append(text)
        return (False, False)

    async def fake_locale(guild_id):
        return "es"

    monkeypatch.setattr(chat_mod, "save_corpus_and_user_message", fake_save)
    monkeypatch.setattr(i18n, "guild_locale", fake_locale)

    bot = SimpleNamespace(user=SimpleNamespace(id=BOT_ID))
    return Chat(bot), saved, monkeypatch


def _patch_ctx(monkeypatch, ignored=False, enabled=True, channel_id=None):
    async def fake_ignored(guild_id, chan_id):
        return ignored

    async def fake_settings(guild_id):
        return {"enabled": enabled, "channel_id": channel_id}

    monkeypatch.setattr(chat_mod, "is_channel_ignored", fake_ignored)
    monkeypatch.setattr(chat_mod, "get_chat_settings", fake_settings)


# ─── Throttle: mensaje completo la primera vez, 🤐 dentro del cooldown ────────


def test_muted_full_message_then_reaction(cog):
    chat, _, mp = cog
    _patch_ctx(mp, enabled=False)

    m1 = FakeMessage()
    asyncio.run(chat.on_message(m1))
    assert m1.replies == [i18n.t("chat.muted.disabled", "es")]
    assert m1.reactions == []

    m2 = FakeMessage()
    asyncio.run(chat.on_message(m2))
    assert m2.replies == []
    assert m2.reactions == ["🤐"]


def test_muted_cooldown_is_per_guild(cog):
    chat, _, mp = cog
    _patch_ctx(mp, enabled=False)

    asyncio.run(chat.on_message(FakeMessage(guild_id=1)))
    other = FakeMessage(guild_id=2)
    asyncio.run(chat.on_message(other))
    # Otro guild no comparte el cooldown: recibe su mensaje completo.
    assert other.replies == [i18n.t("chat.muted.disabled", "es")]


def test_wrong_channel_names_configured_channel(cog):
    chat, saved, mp = cog
    _patch_ctx(mp, enabled=True, channel_id=20)

    m = FakeMessage(channel_id=10)
    asyncio.run(chat.on_message(m))
    assert m.replies == [i18n.t("chat.muted.wrong_channel", "es", channel="<#20>")]
    # Canal NO ignorado: el mensaje sí entra al corpus aunque el chat no responda.
    assert saved == ["hola"]


# ─── Regresión de corpus: canal ignorado nunca guarda ────────────────────────


def test_ignored_channel_never_saves_corpus(cog):
    chat, saved, mp = cog
    _patch_ctx(mp, ignored=True)

    # Sin mención: silencio total y nada al corpus (comportamiento original).
    plain = FakeMessage(mention=False)
    asyncio.run(chat.on_message(plain))
    assert plain.replies == [] and plain.reactions == []
    assert saved == []

    # Con mención: ahora explica por qué no responde, pero SIGUE sin guardar.
    mentioned = FakeMessage()
    asyncio.run(chat.on_message(mentioned))
    assert mentioned.replies == [i18n.t("chat.muted.ignored_channel", "es")]
    assert saved == []
