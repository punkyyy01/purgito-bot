"""Tests del webhook de Polar (/webhooks/polar) sin red ni credenciales reales.

Los casos con tipos que polar-sdk modela (active/revoked) parchean validate_event
con un evento fabricado; el caso paused firma el payload de verdad con
standardwebhooks (misma lib que usa el SDK) para ejercitar la verificación real
y el fallback de JSON crudo para tipos que el SDK no conoce.
"""

import asyncio
import base64
import json
from datetime import datetime, timezone
from types import SimpleNamespace

from standardwebhooks.webhooks import Webhook

import webapi
from polar_sdk.webhooks import WebhookVerificationError

SECRET = "test-secret"
MONTHLY = "prod-monthly"
ANNUAL = "prod-annual"


class FakeRequest:
    def __init__(self, body: bytes, headers: dict | None = None):
        self._body = body
        self.headers = headers or {}
        self.remote = "127.0.0.1"

    async def read(self) -> bytes:
        return self._body


def _signed_headers(body: str) -> dict:
    ts = datetime.now(timezone.utc)
    signer = Webhook(base64.b64encode(SECRET.encode()).decode())
    return {
        "webhook-id": "msg_test",
        "webhook-timestamp": str(int(ts.timestamp())),
        "webhook-signature": signer.sign("msg_test", ts, body),
    }


def _fake_event(event_type: str, metadata, product_id: str = MONTHLY, status=None):
    return SimpleNamespace(
        TYPE=event_type,
        data=SimpleNamespace(metadata=metadata, product_id=product_id, status=status),
    )


def _run(
    monkeypatch,
    request: FakeRequest,
    fake_event=None,
    raise_verification=False,
    set_returns=True,
):
    """Ejecuta el handler con set/unset espiados; retorna (response, calls).

    set_returns controla lo que devuelve set_premium (True = alta nueva, False =
    ya era premium), para ejercitar la rama idempotente del handler."""
    calls = {"set": [], "unset": []}

    async def fake_set(guild_id, note=None):
        calls["set"].append((guild_id, note))
        return set_returns

    async def fake_unset(guild_id):
        calls["unset"].append(guild_id)
        return True

    monkeypatch.setattr(webapi, "set_premium", fake_set)
    monkeypatch.setattr(webapi, "unset_premium", fake_unset)
    monkeypatch.setattr(webapi, "POLAR_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(webapi, "POLAR_PRODUCT_ID_MONTHLY", MONTHLY)
    monkeypatch.setattr(webapi, "POLAR_PRODUCT_ID_ANNUAL", ANNUAL)
    if raise_verification:

        def fake_validate(body, headers, secret):
            raise WebhookVerificationError("no matching signature")

        monkeypatch.setattr(webapi, "validate_event", fake_validate)
    elif fake_event is not None:
        monkeypatch.setattr(
            webapi, "validate_event", lambda body, headers, secret: fake_event
        )
    resp = asyncio.run(webapi._webhook_polar(request))
    return resp, calls


def test_active_sets_premium(monkeypatch):
    event = _fake_event("subscription.active", {"guild_id": "123"}, MONTHLY)
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), fake_event=event)
    assert resp.status == 200
    assert calls["set"] == [(123, "Polar — mensual")]
    assert calls["unset"] == []


def test_active_annual_note(monkeypatch):
    event = _fake_event("subscription.active", {"guild_id": "123"}, ANNUAL)
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), fake_event=event)
    assert calls["set"] == [(123, "Polar — anual")]


def test_created_trialing_sets_premium(monkeypatch):
    # El caso que motivó este cambio: con free trial configurado en Polar,
    # subscription.active recién llega al terminar el trial — subscription.created
    # con status "trialing" es lo único que avisa que el trial arrancó.
    event = _fake_event(
        "subscription.created", {"guild_id": "123"}, MONTHLY, status="trialing"
    )
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), fake_event=event)
    assert resp.status == 200
    assert calls["set"] == [(123, "Polar — mensual")]
    assert calls["unset"] == []


def test_created_incomplete_is_ignored(monkeypatch):
    # subscription.created también dispara con status "incomplete" mientras se
    # procesa el primer pago (sin trial): no debe activar premium todavía.
    event = _fake_event(
        "subscription.created", {"guild_id": "123"}, MONTHLY, status="incomplete"
    )
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), fake_event=event)
    assert resp.status == 200
    assert calls["set"] == [] and calls["unset"] == []


def test_created_already_active_status_is_ignored(monkeypatch):
    # Si subscription.created llegara con status "active" (pago inmediato sin
    # trial), no la tratamos como alta acá: subscription.active se encarga.
    event = _fake_event(
        "subscription.created", {"guild_id": "123"}, MONTHLY, status="active"
    )
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), fake_event=event)
    assert resp.status == 200
    assert calls["set"] == [] and calls["unset"] == []


def test_active_after_trial_is_idempotent(monkeypatch, caplog):
    # Fin del trial: subscription.active llega para una suscripción que
    # subscription.created ya había activado. set_premium (INSERT OR IGNORE)
    # devuelve False; el handler debe seguir llamándola (sin romper nada) pero
    # loguear como "sin cambios", no como una activación nueva.
    event = _fake_event("subscription.active", {"guild_id": "123"}, MONTHLY)
    with caplog.at_level("DEBUG", logger="webapi"):
        resp, calls = _run(
            monkeypatch, FakeRequest(b"{}"), fake_event=event, set_returns=False
        )
    assert resp.status == 200
    assert calls["set"] == [(123, "Polar — mensual")]
    assert not [r for r in caplog.records if "activado" in r.getMessage().lower()]
    assert any("sin cambios" in r.getMessage() for r in caplog.records)


def test_revoked_unsets_premium(monkeypatch):
    event = _fake_event("subscription.revoked", {"guild_id": "456"})
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), fake_event=event)
    assert resp.status == 200
    assert calls["unset"] == [456]
    assert calls["set"] == []


def test_invalid_signature_403(monkeypatch):
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), raise_verification=True)
    assert resp.status == 403
    assert calls["set"] == [] and calls["unset"] == []


def test_missing_guild_id_responds_200(monkeypatch):
    event = _fake_event("subscription.active", {})
    resp, calls = _run(monkeypatch, FakeRequest(b"{}"), fake_event=event)
    assert resp.status == 200
    assert calls["set"] == [] and calls["unset"] == []


def test_paused_real_signature_unknown_type_fallback(monkeypatch):
    # subscription.paused no existe en polar-sdk 0.31.7: firma real, el handler
    # debe caer al fallback de JSON crudo y desactivar premium igual.
    body = json.dumps(
        {
            "type": "subscription.paused",
            "data": {"metadata": {"guild_id": "789"}, "product_id": MONTHLY},
        }
    )
    req = FakeRequest(body.encode(), _signed_headers(body))
    resp, calls = _run(monkeypatch, req)
    assert resp.status == 200
    assert calls["unset"] == [789]


def test_bad_signature_real_path_403(monkeypatch):
    body = json.dumps({"type": "subscription.active", "data": {}})
    headers = _signed_headers(body)
    headers["webhook-signature"] = "v1,QUFBQQ=="
    resp, calls = _run(monkeypatch, FakeRequest(body.encode(), headers))
    assert resp.status == 403
    assert calls["set"] == [] and calls["unset"] == []
