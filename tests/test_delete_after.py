"""Test de _parse_delete_after_seconds (settings.py): validación del campo
opcional de autoborrado en los modales de anuncios."""

import pytest

from cogs.settings import _parse_delete_after_seconds


def test_empty_means_no_autoborrado():
    assert _parse_delete_after_seconds("") is None
    assert _parse_delete_after_seconds("   ") is None


def test_valid_range():
    assert _parse_delete_after_seconds("1") == 1
    assert _parse_delete_after_seconds("86400") == 86400


@pytest.mark.parametrize("raw", ["0", "-1", "86401", "abc", "1.5"])
def test_invalid_raises(raw):
    with pytest.raises(ValueError):
        _parse_delete_after_seconds(raw)
