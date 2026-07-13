"""BOT_OWNER_ID rompía el arranque con BOT_OWNER_ID="" (presente pero vacío,
como viene en .env.example): int(os.getenv("BOT_OWNER_ID", "0")) nunca
aplicaba el default "0" porque os.getenv devuelve "" (no None) cuando la
variable está seteada pero vacía, e int("") lanza ValueError.

Ver _env_int_or_none en config.py: ausente, vacío o no-numérico -> None sin
excepción; "0" también resuelve a None (mismo sentinel que ya usaba el
código original antes de este fix).
"""

import config


def test_bot_owner_id_empty_string_is_none(monkeypatch):
    monkeypatch.setenv("BOT_OWNER_ID", "")
    assert config._env_int_or_none("BOT_OWNER_ID") is None


def test_bot_owner_id_absent_is_none(monkeypatch):
    monkeypatch.delenv("BOT_OWNER_ID", raising=False)
    assert config._env_int_or_none("BOT_OWNER_ID") is None


def test_bot_owner_id_valid_value(monkeypatch):
    monkeypatch.setenv("BOT_OWNER_ID", "123456789012345678")
    assert config._env_int_or_none("BOT_OWNER_ID") == 123456789012345678


def test_bot_owner_id_zero_is_none(monkeypatch):
    monkeypatch.setenv("BOT_OWNER_ID", "0")
    assert config._env_int_or_none("BOT_OWNER_ID") is None


def test_bot_owner_id_garbage_is_none(monkeypatch):
    monkeypatch.setenv("BOT_OWNER_ID", "no-es-un-numero")
    assert config._env_int_or_none("BOT_OWNER_ID") is None
