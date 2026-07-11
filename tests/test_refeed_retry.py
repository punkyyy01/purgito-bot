"""Tests de _fetch_history_batch (cogs/chat.py): reintentos ante errores
transitorios de Discord durante el refeed.

Cubre: (1) discord.RateLimited trae .retry_after y se respeta en vez del
backoff exponencial; discord.HTTPException normal no lo trae, así que cae al
backoff exponencial; (2) se agotan los reintentos y devuelve None sin
propagar; (3) el backoff usa asyncio.sleep (no bloqueante), nunca time.sleep
-- si lo hiciera, congelaría el event loop del bot entero.

Sin bot ni red: channel.history() se simula con un fake mínimo.
"""

import asyncio
from types import SimpleNamespace

import discord
import pytest

import cogs.chat as chat_mod
from cogs.chat import Chat


class _FakeResponse:
    status = 500
    reason = "Internal Server Error"


def _http_exc():
    return discord.HTTPException(_FakeResponse(), "boom")


class _FakeHistory:
    """Resultado de un channel.history(**kwargs): yieldea una lista fija de
    mensajes o levanta la excepción dada."""

    def __init__(self, item):
        self._item = item

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        if isinstance(self._item, BaseException):
            raise self._item
        for m in self._item:
            yield m


class _FakeChannel:
    """Cada llamada a history() consume el próximo ítem del script."""

    def __init__(self, id_, script):
        self.id = id_
        self._script = list(script)

    def history(self, **kwargs):
        return _FakeHistory(self._script.pop(0))


@pytest.fixture
def cog(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)

    def blocking_sleep_forbidden(seconds):
        raise AssertionError(
            "no debe usarse time.sleep bloqueante en el retry: congelaría "
            "el event loop del bot para todos los guilds"
        )

    monkeypatch.setattr(chat_mod.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(chat_mod.time, "sleep", blocking_sleep_forbidden)
    return Chat(SimpleNamespace()), sleeps


def test_respects_retry_after_from_rate_limited(cog):
    """discord.RateLimited trae .retry_after: el backoff debe usar ese valor,
    no el exponencial (2**attempt)."""
    chat, sleeps = cog
    channel = _FakeChannel(
        1,
        [
            discord.RateLimited(5.0),
            [SimpleNamespace(id=1), SimpleNamespace(id=2)],
        ],
    )

    result = asyncio.run(chat._fetch_history_batch(channel, limit=100))

    assert [m.id for m in result] == [1, 2]
    assert sleeps == [5.0]


def test_falls_back_to_exponential_backoff_without_retry_after(cog):
    """discord.HTTPException normal no trae .retry_after: cae al backoff
    exponencial 2**attempt."""
    chat, sleeps = cog
    channel = _FakeChannel(
        1,
        [_http_exc(), [SimpleNamespace(id=7)]],
    )

    result = asyncio.run(chat._fetch_history_batch(channel, limit=100))

    assert [m.id for m in result] == [7]
    assert sleeps == [1]  # 2**0


def test_gives_up_after_retries_exhausted(cog):
    """Se agotan los _HISTORY_FETCH_RETRIES intentos: devuelve None sin
    propagar la excepción, y no reintenta una vez más."""
    chat, sleeps = cog
    n = chat_mod._HISTORY_FETCH_RETRIES
    channel = _FakeChannel(1, [_http_exc() for _ in range(n)])

    result = asyncio.run(chat._fetch_history_batch(channel, limit=100))

    assert result is None
    assert sleeps == [2**i for i in range(n - 1)]


def test_forbidden_propagates_without_retry(cog):
    """discord.Forbidden no se reintenta: se propaga tal cual en el primer intento."""
    chat, sleeps = cog
    channel = _FakeChannel(1, [discord.Forbidden(_FakeResponse(), "nope")])

    with pytest.raises(discord.Forbidden):
        asyncio.run(chat._fetch_history_batch(channel, limit=100))

    assert sleeps == []
