"""Tests de scheduled_announcements (db.py): get_due_scheduled_announcements
para modo interval y modo daily, y el rechazo de add_scheduled_announcement al
llegar al límite. Usa una DB SQLite en memoria inyectada en db._db, sin tocar
data/bot.db (que está trackeada en git)."""

import asyncio
from datetime import datetime, timedelta, timezone

import aiosqlite
import pytest

import db
from config import ANNOUNCEMENTS_TIMEZONE

# "Ahora" fijo para que el test no dependa de la hora real de ejecución.
_FIXED_NOW = datetime(2026, 7, 10, 9, 0, 0, tzinfo=ANNOUNCEMENTS_TIMEZONE)


class _FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return _FIXED_NOW.astimezone(tz) if tz else _FIXED_NOW


@pytest.fixture
def memory_db(monkeypatch):
    conn = asyncio.run(_open_memory_db())
    monkeypatch.setattr(db, "_db", conn)
    monkeypatch.setattr(db, "datetime", _FixedDatetime)
    yield conn
    asyncio.run(conn.close())


async def _open_memory_db() -> aiosqlite.Connection:
    conn = await aiosqlite.connect(":memory:")
    await conn.executescript(db.SCHEMA)
    await conn.commit()
    return conn


def _insert(conn, **overrides):
    row = dict(
        guild_id=1,
        channel_id=10,
        message="hola",
        mode="interval",
        interval_minutes=None,
        hour=None,
        minute=None,
        last_sent_at=None,
        created_by=1,
    )
    row.update(overrides)
    asyncio.run(
        conn.execute(
            "INSERT INTO scheduled_announcements "
            "(guild_id, channel_id, message, mode, interval_minutes, hour, minute, last_sent_at, created_by) "
            "VALUES (:guild_id, :channel_id, :message, :mode, :interval_minutes, :hour, :minute, :last_sent_at, :created_by)",
            row,
        )
    )
    asyncio.run(conn.commit())


def _sql_utc(dt_local: datetime) -> str:
    return dt_local.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ─── Modo interval ────────────────────────────────────────────────────────────


def test_interval_never_sent_is_due(memory_db):
    _insert(memory_db, mode="interval", interval_minutes=30, last_sent_at=None)
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert len(due) == 1


def test_interval_elapsed_is_due(memory_db):
    # El modo interval se resuelve con datetime('now') de SQLite (reloj real,
    # no el datetime de Python parcheado), así que estos dos anclan al reloj real.
    real_now = datetime.now(timezone.utc)
    last = _sql_utc(real_now - timedelta(minutes=31))
    _insert(memory_db, mode="interval", interval_minutes=30, last_sent_at=last)
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert len(due) == 1


def test_interval_not_elapsed_is_not_due(memory_db):
    real_now = datetime.now(timezone.utc)
    last = _sql_utc(real_now - timedelta(minutes=10))
    _insert(memory_db, mode="interval", interval_minutes=30, last_sent_at=last)
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert due == []


# ─── Modo daily ───────────────────────────────────────────────────────────────


def test_daily_hour_passed_never_sent_is_due(memory_db):
    _insert(memory_db, mode="daily", hour=8, minute=0, last_sent_at=None)
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert len(due) == 1


def test_daily_hour_not_reached_is_not_due(memory_db):
    _insert(memory_db, mode="daily", hour=10, minute=0, last_sent_at=None)
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert due == []


def test_daily_already_sent_today_is_not_due(memory_db):
    last = _sql_utc(_FIXED_NOW.replace(hour=8, minute=1))
    _insert(memory_db, mode="daily", hour=8, minute=0, last_sent_at=last)
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert due == []


def test_daily_sent_yesterday_is_due_again(memory_db):
    last = _sql_utc(_FIXED_NOW - timedelta(days=1))
    _insert(memory_db, mode="daily", hour=8, minute=0, last_sent_at=last)
    due = asyncio.run(db.get_due_scheduled_announcements())
    assert len(due) == 1


# ─── Límite por guild ───────────────────────────────────────────────────────


def test_add_scheduled_announcement_rejects_over_limit(memory_db):
    guild_id = 5
    for _ in range(3):  # MAX_ANNOUNCEMENTS_PER_GUILD_FREE=3 en limits.env
        new_id = asyncio.run(
            db.add_scheduled_announcement(
                guild_id, 10, "msg", "interval", 1, interval_minutes=30
            )
        )
        assert new_id is not None
    rejected = asyncio.run(
        db.add_scheduled_announcement(
            guild_id, 10, "msg4", "interval", 1, interval_minutes=30
        )
    )
    assert rejected is None
