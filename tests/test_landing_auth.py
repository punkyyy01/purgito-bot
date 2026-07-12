"""Tests del soporte de sesión para la landing (purgito.app):

- /api/public/me informa el estado de sesión sin redirigir.
- _auth_login solo acepta el literal "landing" en ?from= (whitelist, nunca
  una URL arbitraria — eso sería un open redirect).
- _auth_callback ya cubierto indirectamente: consume post_login_redirect
  con session.pop, así que un valor no guardado jamás redirige a la landing.
"""

import asyncio
import json

import pytest
from aiohttp import web

import webapi


class FakeRequest:
    def __init__(self, query: dict | None = None):
        self.query = query or {}


def _patch_session(monkeypatch, session: dict):
    async def fake_get_session(request):
        return session

    monkeypatch.setattr(webapi, "get_session", fake_get_session)


# ---------------- /api/public/me ----------------


def test_public_me_logged_in(monkeypatch):
    _patch_session(
        monkeypatch,
        {"user_id": "42", "username": "framb", "avatar_url": "https://cdn/x.png"},
    )
    resp = asyncio.run(webapi._api_public_me(FakeRequest()))
    assert resp.status == 200
    assert json.loads(resp.text) == {
        "logged_in": True,
        "username": "framb",
        "avatar_url": "https://cdn/x.png",
    }


def test_public_me_anonymous(monkeypatch):
    _patch_session(monkeypatch, {})
    resp = asyncio.run(webapi._api_public_me(FakeRequest()))
    assert resp.status == 200
    assert json.loads(resp.text) == {"logged_in": False}


# ---------------- whitelist de ?from= en _auth_login ----------------


def _run_login(monkeypatch, query: dict) -> dict:
    """Ejecuta _auth_login (siempre termina en HTTPFound a Discord) y
    devuelve la sesión resultante para inspeccionar qué guardó."""
    session: dict = {}
    _patch_session(monkeypatch, session)
    with pytest.raises(web.HTTPFound) as exc:
        asyncio.run(webapi._auth_login(FakeRequest(query)))
    assert str(exc.value.location).startswith("https://discord.com/oauth2/authorize")
    assert "oauth_state" in session  # el flujo OAuth normal sigue intacto
    return session


def test_login_from_landing_stores_redirect(monkeypatch):
    session = _run_login(monkeypatch, {"from": "landing"})
    assert session.get("post_login_redirect") == "landing"


def test_login_from_other_value_ignored(monkeypatch):
    # Cualquier valor que no sea el literal "landing" se ignora: no debe
    # quedar rastro en la sesión (whitelist, no passthrough).
    session = _run_login(monkeypatch, {"from": "https://evil.example.com"})
    assert "post_login_redirect" not in session


def test_login_without_from_ignored(monkeypatch):
    session = _run_login(monkeypatch, {})
    assert "post_login_redirect" not in session
