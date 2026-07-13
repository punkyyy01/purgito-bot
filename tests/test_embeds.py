"""Tests del editor de embeds: validate_embed_payload (webapi.py), CRUD de
embed_templates con límite free y chequeo de propiedad por guild_id (IDOR), y
la rama embed_json vs texto plano en el envío de anuncios programados. Usa una
DB SQLite en memoria inyectada en db._db, sin tocar data/bot.db."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import aiosqlite
import discord
import pytest

import db
from cogs.anuncios import Anuncios
from webapi import validate_embed_payload


@pytest.fixture
def memory_db(monkeypatch):
    conn = asyncio.run(_open_memory_db())
    monkeypatch.setattr(db, "_db", conn)
    yield conn
    asyncio.run(conn.close())


async def _open_memory_db() -> aiosqlite.Connection:
    conn = await aiosqlite.connect(":memory:")
    await conn.executescript(db.SCHEMA)
    await conn.commit()
    return conn


# ─── validate_embed_payload ──────────────────────────────────────────────────


def test_valid_minimal_embed():
    assert validate_embed_payload({"title": "hola"}) is None


def test_valid_full_embed():
    embed = {
        "title": "t",
        "description": "d",
        "color": 0x8B6EF5,
        "author": {"name": "autor"},
        "footer": {"text": "pie"},
        "fields": [{"name": "n", "value": "v", "inline": True}],
    }
    assert validate_embed_payload(embed) is None


def test_not_a_dict():
    assert validate_embed_payload(None) is not None
    assert validate_embed_payload("x") is not None


def test_empty_embed_rejected():
    assert validate_embed_payload({}) is not None


def test_title_too_long():
    assert validate_embed_payload({"title": "x" * 257}) is not None
    assert validate_embed_payload({"title": "x" * 256}) is None


def test_description_too_long():
    assert validate_embed_payload({"description": "x" * 4097}) is not None
    assert validate_embed_payload({"description": "x" * 4096}) is None


def test_too_many_fields():
    ok = {"fields": [{"name": "n", "value": "v"}] * 25}
    over = {"fields": [{"name": "n", "value": "v"}] * 26}
    assert validate_embed_payload(ok) is None
    assert validate_embed_payload(over) is not None


def test_field_name_and_value_limits():
    assert validate_embed_payload(
        {"fields": [{"name": "x" * 257, "value": "v"}]}
    ) is not None
    assert validate_embed_payload(
        {"fields": [{"name": "n", "value": "x" * 1025}]}
    ) is not None
    assert validate_embed_payload(
        {"fields": [{"name": "", "value": "v"}]}
    ) is not None


def test_footer_and_author_limits():
    assert validate_embed_payload({"footer": {"text": "x" * 2049}}) is not None
    assert validate_embed_payload({"author": {"name": "x" * 257}}) is not None


def test_total_over_6000():
    # Cada parte respeta su propio límite, pero la suma pasa de 6000.
    embed = {
        "description": "x" * 4000,
        "fields": [{"name": "n", "value": "x" * 1024}, {"name": "n", "value": "x" * 1024}],
    }
    assert validate_embed_payload(embed) is not None


def test_color_hex_string_converted_to_int():
    embed = {"title": "t", "color": "#8B6EF5"}
    assert validate_embed_payload(embed) is None
    assert embed["color"] == 0x8B6EF5


def test_color_invalid_string_rejected():
    assert validate_embed_payload({"title": "t", "color": "#zzz"}) is not None


def test_color_out_of_range_rejected():
    assert validate_embed_payload({"title": "t", "color": 0x1000000}) is not None


# ─── Plantillas: límite free ─────────────────────────────────────────────────


def test_add_embed_template_rejects_over_limit(memory_db):
    guild_id = 1
    embed_json = json.dumps({"title": "t"})
    for i in range(5):  # MAX_EMBED_TEMPLATES_PER_GUILD_FREE=5 en limits.env
        new_id = asyncio.run(db.add_embed_template(guild_id, f"tpl{i}", embed_json))
        assert new_id is not None
    rejected = asyncio.run(db.add_embed_template(guild_id, "tpl6", embed_json))
    assert rejected is None
    # El rechazo no evictó nada: siguen las 5 originales.
    assert len(asyncio.run(db.list_embed_templates(guild_id))) == 5


# ─── Plantillas: propiedad por guild_id (IDOR) ───────────────────────────────


def test_template_ownership_checks(memory_db):
    owner, intruder = 1, 2
    embed_json = json.dumps({"title": "t"})
    template_id = asyncio.run(db.add_embed_template(owner, "mia", embed_json))

    assert asyncio.run(db.get_embed_template(template_id, intruder)) is None
    assert not asyncio.run(
        db.update_embed_template(template_id, intruder, "robada", embed_json)
    )
    assert not asyncio.run(db.delete_embed_template(template_id, intruder))

    # El dueño sí puede todo.
    tpl = asyncio.run(db.get_embed_template(template_id, owner))
    assert tpl is not None and tpl["name"] == "mia"
    assert asyncio.run(
        db.update_embed_template(template_id, owner, "renombrada", embed_json)
    )
    assert asyncio.run(db.get_embed_template(template_id, owner))["name"] == "renombrada"
    assert asyncio.run(db.delete_embed_template(template_id, owner))
    assert asyncio.run(db.get_embed_template(template_id, owner)) is None


# ─── Anuncios: rama embed_json vs texto plano ────────────────────────────────


def _fake_channel():
    channel = MagicMock(spec=discord.TextChannel)
    perms = MagicMock()
    perms.send_messages = True
    perms.embed_links = True
    channel.permissions_for.return_value = perms
    channel.send = AsyncMock()
    return channel


def _run_announcement_loop(channel):
    bot = MagicMock()
    bot.get_channel.return_value = channel
    cog = Anuncios(bot)
    asyncio.run(cog.check_announcements.coro(cog))


def test_scheduled_announcement_plain_text_branch(memory_db):
    asyncio.run(
        db.add_scheduled_announcement(1, 10, "hola texto", "interval", 1, interval_minutes=30)
    )
    channel = _fake_channel()
    _run_announcement_loop(channel)
    channel.send.assert_awaited_once_with("hola texto")


def test_scheduled_announcement_embed_branch(memory_db):
    embed_dict = {"title": "anuncio embed", "color": 0x8B6EF5}
    asyncio.run(
        db.add_scheduled_announcement(
            1, 10, "[embed]", "interval", 1,
            interval_minutes=30, embed_json=json.dumps(embed_dict),
        )
    )
    channel = _fake_channel()
    _run_announcement_loop(channel)
    channel.send.assert_awaited_once()
    kwargs = channel.send.await_args.kwargs
    assert channel.send.await_args.args == ()
    assert kwargs["embed"].title == "anuncio embed"
    assert kwargs["embed"].colour.value == 0x8B6EF5


def test_get_due_includes_embed_json(memory_db):
    asyncio.run(
        db.add_scheduled_announcement(
            1, 10, "[embed]", "interval", 1,
            interval_minutes=30, embed_json='{"title": "x"}',
        )
    )
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert len(due) == 1
    assert due[0]["embed_json"] == '{"title": "x"}'
