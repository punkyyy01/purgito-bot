"""Opciones finas de envío del editor de embeds (Fase 5.6 del panel).

Un dict de opciones tiene forma:
    {"silent": bool, "restrict_mentions": bool, "allowed_role_ids": [int, ...]}

- silent: el mensaje no genera notificación push/escritorio (flag nativo de
  Discord, discord.py lo expone como `silent=` en channel.send).
- restrict_mentions: aunque el texto contenga @everyone/@here/menciones de rol
  escritas a mano, no se pinguea a nadie salvo los roles de allowed_role_ids
  (mapea a discord.AllowedMentions en channel.send).

Vive en su propio módulo porque lo comparten webapi.py (envío inmediato) y
cogs/anuncios.py (envío programado) sin arrastrar dependencias de uno al otro.
"""

import discord

# Tope defensivo del listado de roles permitidos; Discord admite hasta 100
# entradas en allowed_mentions, pero el panel no necesita ni cerca de eso.
MAX_ALLOWED_ROLES = 20


def sanitize_send_options(raw) -> dict | None:
    """Normaliza el dict que manda el frontend. Devuelve None si no hay nada
    que aplicar (todo en default) — así el JSON guardado no arrastra opciones
    vacías y las filas viejas sin opciones siguen siendo el caso común."""
    if not isinstance(raw, dict):
        return None
    silent = bool(raw.get("silent"))
    restrict = bool(raw.get("restrict_mentions"))
    role_ids: list[int] = []
    for r in (raw.get("allowed_role_ids") or [])[:MAX_ALLOWED_ROLES]:
        try:
            role_ids.append(int(r))
        except (TypeError, ValueError):
            continue
    if not silent and not restrict:
        return None
    return {"silent": silent, "restrict_mentions": restrict, "allowed_role_ids": role_ids}


def send_kwargs(options: dict | None) -> dict:
    """kwargs extra para channel.send según las opciones (vacío si None)."""
    if not options:
        return {}
    kw: dict = {}
    if options.get("silent"):
        kw["silent"] = True
    if options.get("restrict_mentions"):
        role_ids = options.get("allowed_role_ids") or []
        kw["allowed_mentions"] = discord.AllowedMentions(
            everyone=False,
            users=False,
            roles=[discord.Object(id=i) for i in role_ids] if role_ids else False,
        )
    return kw
