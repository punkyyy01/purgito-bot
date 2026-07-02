"""Web API pública: galería de GIFs + health check + panel de configuración multi-guild."""

import hashlib
import html
import logging
import secrets
import time
from pathlib import Path
from urllib.parse import urlencode

import aiohttp
from aiohttp import web
from aiohttp_session import get_session, setup as setup_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from discord.ext import commands

from config import (
    DASHBOARD_BASE_URL,
    DASHBOARD_ENABLED,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    PURGATORY_GUILD_ID,
    SESSION_SECRET,
    WEB_PORT,
    get_invite_url,
)
from cogs.premium import is_premium_guild
from db import (
    add_frase_especial,
    add_ignored_channel,
    add_meme_schedule,
    add_reaction_to_pool,
    add_youtube_sub,
    count_gif_urls,
    delete_frase_especial,
    delete_gif_url_by_id,
    get_chat_settings,
    list_frases_especiales,
    list_gif_urls,
    list_ignored_channels,
    list_meme_schedules,
    list_reaction_pool,
    list_youtube_subs,
    remove_ignored_channel,
    remove_meme_schedule,
    remove_reaction_from_pool,
    remove_youtube_sub,
    save_gif_url,
    set_chat_mode,
    set_youtube_mention_role,
)
from gif_gallery import GIF_GALLERY_HTML
from pages.panel import PANEL_HTML
from pages.selector import SELECTOR_HTML
from utils import LRUDict
import r2

log = logging.getLogger(__name__)

_rate_post: LRUDict = LRUDict(512)
_rate_delete: LRUDict = LRUDict(512)
# user_id -> (expira_monotonic, [guilds con manage_guild]) — cache 5 min para
# no golpear a Discord en cada click del panel.
_user_guilds_cache: LRUDict = LRUDict(256)
_runner: web.AppRunner | None = None

_DISCORD_API = "https://discord.com/api"
_ADMINISTRATOR = 1 << 3
_MANAGE_GUILD = 1 << 5
_GUILDS_CACHE_TTL = 300.0
_PUBLIC_GETS = ("/", "/api/gifs", "/health")


def _rate_ok(store: LRUDict, ip: str, limit: int, window: float = 60.0) -> bool:
    now = time.monotonic()
    ts = [t for t in store.get(ip, []) if now - t < window]
    if len(ts) >= limit:
        store[ip] = ts
        return False
    ts.append(now)
    store[ip] = ts
    return True


def _valid_gif_url(url: str) -> bool:
    if "tenor.com" in url or "giphy.com" in url:
        return True
    pub = r2.public_url()
    return bool(pub and url.startswith(pub))


@web.middleware
async def _cors_middleware(request: web.Request, handler) -> web.StreamResponse:
    origin = request.headers.get("Origin", "")
    if request.method == "OPTIONS":
        resp: web.StreamResponse = web.Response()
    else:
        resp = await handler(request)
    if DASHBOARD_ENABLED and origin and origin == DASHBOARD_BASE_URL:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Credentials"] = "true"
    elif request.method in ("GET", "OPTIONS") and request.path in _PUBLIC_GETS:
        resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


def require_login(handler):
    """Envuelve un handler exigiendo sesión con user_id; si no, manda a /auth/login."""

    async def wrapper(request: web.Request) -> web.StreamResponse:
        session = await get_session(request)
        if not session.get("user_id"):
            raise web.HTTPFound("/auth/login")
        return await handler(request)

    return wrapper


# ---------------- Permisos por guild ----------------

def _filter_manage_guilds(guilds: list[dict]) -> list[dict]:
    """Filtra los guilds donde el usuario es owner o tiene MANAGE_GUILD/ADMINISTRATOR."""
    manage = []
    for g in guilds:
        try:
            perms = int(g.get("permissions") or 0)
        except (TypeError, ValueError):
            perms = 0
        if g.get("owner") or perms & (_MANAGE_GUILD | _ADMINISTRATOR):
            manage.append(g)
    return manage


async def _fetch_manage_guilds(request: web.Request) -> list[dict] | None:
    """Guilds del usuario donde tiene MANAGE_GUILD/owner, cacheados 5 min por user_id."""
    session = await get_session(request)
    user_id = session.get("user_id")
    token = session.get("access_token")
    if not user_id or not token:
        return None
    now = time.monotonic()
    cached = _user_guilds_cache.get(user_id)
    if cached and cached[0] > now:
        return cached[1]
    try:
        async with aiohttp.ClientSession() as http:
            async with http.get(f"{_DISCORD_API}/users/@me/guilds",
                                headers={"Authorization": f"Bearer {token}"}) as r:
                if r.status != 200:
                    log.warning("GET /users/@me/guilds devolvió %s para user %s "
                                "(429 = rate limit de Discord en este endpoint)", r.status, user_id)
                    return None
                guilds = await r.json()
    except aiohttp.ClientError:
        log.exception("Fallo consultando /users/@me/guilds")
        return None
    manage = _filter_manage_guilds(guilds)
    _user_guilds_cache[user_id] = (now + _GUILDS_CACHE_TTL, manage)
    return manage


async def check_guild_access(request: web.Request, guild_id: int) -> web.Response | None:
    """None si el usuario puede administrar el guild; si no, la respuesta de error."""
    manage = await _fetch_manage_guilds(request)
    if manage is None:
        return web.json_response({"error": "sesión expirada, reingresá"}, status=401)
    if not any(int(g["id"]) == guild_id for g in manage):
        return web.json_response({"error": "acceso denegado"}, status=403)
    return None


def guild_api(handler):
    """Handler de API por guild: exige login + manage_guild y pasa guild_id ya validado."""

    async def wrapper(request: web.Request) -> web.StreamResponse:
        session = await get_session(request)
        if not session.get("user_id"):
            return web.json_response({"error": "no autenticado"}, status=401)
        try:
            guild_id = int(request.match_info["guild_id"])
        except (KeyError, ValueError):
            return web.json_response({"error": "guild_id inválido"}, status=400)
        denied = await check_guild_access(request, guild_id)
        if denied is not None:
            return denied
        return await handler(request, guild_id)

    return wrapper


async def _json_body(request: web.Request) -> dict | None:
    try:
        data = await request.json()
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _to_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _bot_guild(request: web.Request, guild_id: int):
    return request.app["bot"].get_guild(guild_id)


def _channel_name(guild, channel_id: int | None) -> str | None:
    if guild is None or channel_id is None:
        return None
    return getattr(guild.get_channel(channel_id), "name", None)


# ---------------- GIF API ----------------

async def _gif_add_impl(request: web.Request, guild_id: int) -> web.Response:
    ip = request.remote or "unknown"
    if not _rate_ok(_rate_post, ip, 5):
        return web.json_response({"error": "rate limit"}, status=429)
    data = await _json_body(request)
    url = (data.get("url") or "").strip() if data else ""
    if not url or not _valid_gif_url(url):
        return web.json_response({"error": "url inválida o no permitida"}, status=400)
    inserted = await save_gif_url(guild_id, url)
    total = await count_gif_urls(guild_id)
    return web.json_response({"inserted": inserted, "total": total})


async def _gif_delete_impl(request: web.Request, guild_id: int, raw_id: str) -> web.Response:
    ip = request.remote or "unknown"
    if not _rate_ok(_rate_delete, ip, 3):
        return web.json_response({"error": "rate limit"}, status=429)
    gif_id = _to_int(raw_id)
    if gif_id is None:
        return web.json_response({"error": "id inválido"}, status=400)
    deleted = await delete_gif_url_by_id(guild_id, gif_id)
    return web.json_response({"deleted": deleted})


async def _api_gif_list(request: web.Request) -> web.Response:
    gifs = await list_gif_urls(PURGATORY_GUILD_ID)
    return web.json_response({"gifs": gifs, "total": len(gifs)})


async def _api_gif_add(request: web.Request) -> web.Response:
    # Endpoint legacy: opera sobre PURG4TORY.
    return await _gif_add_impl(request, PURGATORY_GUILD_ID)


async def _api_gif_delete(request: web.Request) -> web.Response:
    # Endpoint legacy: opera sobre PURG4TORY.
    return await _gif_delete_impl(request, PURGATORY_GUILD_ID, request.match_info.get("id", ""))


async def _api_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def _gallery(request: web.Request) -> web.Response:
    return web.Response(text=GIF_GALLERY_HTML, content_type="text/html", charset="utf-8")


# ---------------- Auth OAuth2 ----------------

def _avatar_url(user: dict) -> str:
    avatar = user.get("avatar")
    if avatar:
        return f"https://cdn.discordapp.com/avatars/{user['id']}/{avatar}.png?size=64"
    index = (int(user["id"]) >> 22) % 6
    return f"https://cdn.discordapp.com/embed/avatars/{index}.png"


async def _auth_login(request: web.Request) -> web.StreamResponse:
    session = await get_session(request)
    state = secrets.token_urlsafe(24)
    session["oauth_state"] = state
    params = urlencode({
        "client_id": DISCORD_CLIENT_ID,
        "redirect_uri": f"{DASHBOARD_BASE_URL}/auth/callback",
        "response_type": "code",
        "scope": "identify guilds",
        "state": state,
    })
    raise web.HTTPFound(f"https://discord.com/oauth2/authorize?{params}")


async def _auth_callback(request: web.Request) -> web.StreamResponse:
    session = await get_session(request)
    code = request.query.get("code")
    state = request.query.get("state")
    if not code or not state or state != session.pop("oauth_state", None):
        raise web.HTTPFound("/auth/error")

    try:
        async with aiohttp.ClientSession() as http:
            # Canje del code por access_token (grant authorization_code).
            async with http.post(f"{_DISCORD_API}/oauth2/token", data={
                "client_id": DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": f"{DASHBOARD_BASE_URL}/auth/callback",
            }) as r:
                if r.status != 200:
                    raise web.HTTPFound("/auth/error")
                access = (await r.json()).get("access_token")

            # Quién es el usuario.
            async with http.get(f"{_DISCORD_API}/users/@me",
                                headers={"Authorization": f"Bearer {access}"}) as r:
                if r.status != 200:
                    raise web.HTTPFound("/auth/error")
                user = await r.json()

            # Guilds del usuario, para verificar que administre alguno donde esté el bot.
            async with http.get(f"{_DISCORD_API}/users/@me/guilds",
                                headers={"Authorization": f"Bearer {access}"}) as r:
                if r.status != 200:
                    raise web.HTTPFound("/auth/error")
                user_guilds = await r.json()
    except aiohttp.ClientError:
        log.exception("Fallo llamando a la API de Discord en el callback OAuth2")
        raise web.HTTPFound("/auth/error")

    manage = _filter_manage_guilds(user_guilds)
    manage_ids = {int(g["id"]) for g in manage}
    bot_guild_ids = {g.id for g in request.app["bot"].guilds}
    # debug temporal: diagnóstico de no_guilds y de pérdida de sesión post-login.
    log.info("OAuth callback user=%s: user_guilds=%d, manage_ids=%s, bot_guild_ids=%s, "
             "intersección=%s", user["id"], len(user_guilds), manage_ids, bot_guild_ids,
             manage_ids & bot_guild_ids)
    # Basta con administrar algún servidor: si el bot no está en ninguno,
    # /servers muestra la sección "Invitar Purgito" para añadirlo.
    if not manage_ids:
        raise web.HTTPFound("/auth/error?reason=no_guilds")

    session["user_id"] = user["id"]
    session["username"] = user.get("global_name") or user.get("username") or "admin"
    session["avatar_url"] = _avatar_url(user)
    # Solo server-side (cookie cifrada): se usa para consultar /users/@me/guilds.
    session["access_token"] = access
    # Precarga el cache con los guilds recién obtenidos: /users/@me/guilds tiene un
    # rate limit estricto por token (~1 req/s) y sin esto el primer /api/me/guilds
    # del panel re-consulta a Discord ~1 s después del callback, recibe 429 → el
    # panel responde 401 → el JS redirige a /auth/login como si no hubiera sesión.
    _user_guilds_cache[user["id"]] = (time.monotonic() + _GUILDS_CACHE_TTL, manage)
    raise web.HTTPFound("/servers")


async def _auth_logout(request: web.Request) -> web.StreamResponse:
    session = await get_session(request)
    session.invalidate()
    raise web.HTTPFound("/auth/login")


async def _auth_error(request: web.Request) -> web.Response:
    if request.query.get("reason") == "no_guilds":
        message = "No administrás ningún servidor de Discord."
    else:
        message = "No se pudo completar el inicio de sesión con Discord."
    body = (
        "<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'>"
        "<title>Acceso denegado</title></head>"
        "<body style='background:#0a0a0a;color:#e0e0e0;font-family:monospace;"
        "text-align:center;padding-top:15vh'>"
        "<h1 style='color:#8b0000'>Acceso denegado</h1>"
        f"<p>{message}</p>"
        "<p><a href='/auth/login' style='color:#8b0000'>← volver a intentar</a></p>"
        "</body></html>"
    )
    return web.Response(text=body, content_type="text/html", charset="utf-8")


# ---------------- Páginas del panel ----------------

async def _dashboard(request: web.Request) -> web.StreamResponse:
    # Mantiene bookmarks viejos funcionando.
    raise web.HTTPFound("/servers")


async def _servers_page(request: web.Request) -> web.Response:
    session = await get_session(request)
    body = (SELECTOR_HTML
            .replace("{{USERNAME}}", html.escape(str(session.get("username", ""))))
            .replace("{{AVATAR_URL}}", html.escape(str(session.get("avatar_url", "")))))
    return web.Response(text=body, content_type="text/html", charset="utf-8")


async def _server_page(request: web.Request) -> web.Response:
    guild_id = _to_int(request.match_info.get("guild_id"))
    if guild_id is None:
        raise web.HTTPNotFound()
    body = PANEL_HTML.replace("{{GUILD_ID}}", str(guild_id))
    return web.Response(text=body, content_type="text/html", charset="utf-8")


# ---------------- API: guilds del usuario ----------------

async def _api_me_guilds(request: web.Request) -> web.Response:
    session = await get_session(request)
    if not session.get("user_id"):
        return web.json_response({"error": "no autenticado"}, status=401)
    manage = await _fetch_manage_guilds(request)
    if manage is None:
        return web.json_response({"error": "sesión expirada, reingresá"}, status=401)
    bot = request.app["bot"]
    bot_guild_ids = {g.id for g in bot.guilds}
    configured, available = [], []
    for g in manage:
        gid = int(g["id"])
        icon = g.get("icon")
        icon_url = f"https://cdn.discordapp.com/icons/{gid}/{icon}.png?size=128" if icon else None
        if gid in bot_guild_ids:
            bot_guild = bot.get_guild(gid)
            configured.append({
                "id": str(gid),
                "name": g.get("name", ""),
                "icon_url": icon_url,
                "member_count": getattr(bot_guild, "member_count", None),
                "is_premium": is_premium_guild(gid),
            })
        else:
            available.append({
                "id": str(gid),
                "name": g.get("name", ""),
                "icon_url": icon_url,
                "invite_url": get_invite_url(str(gid)),
            })
    return web.json_response({"configured": configured, "available": available})


# ---------------- API: canales y roles ----------------

@guild_api
async def _api_channels(request: web.Request, guild_id: int) -> web.Response:
    guild = _bot_guild(request, guild_id)
    if guild is None:
        return web.json_response({"error": "el bot no está en ese servidor"}, status=404)
    channels = [{"id": str(c.id), "name": c.name} for c in guild.text_channels]
    return web.json_response({"channels": channels})


@guild_api
async def _api_roles(request: web.Request, guild_id: int) -> web.Response:
    guild = _bot_guild(request, guild_id)
    if guild is None:
        return web.json_response({"error": "el bot no está en ese servidor"}, status=404)
    roles = [
        {"id": str(r.id), "name": r.name, "color": f"#{r.colour.value:06x}"}
        for r in guild.roles if not r.is_default()
    ]
    return web.json_response({"roles": roles})


# ---------------- API: chat ----------------

@guild_api
async def _api_chat_get(request: web.Request, guild_id: int) -> web.Response:
    settings = await get_chat_settings(guild_id)
    channel_id = settings["channel_id"]
    return web.json_response({
        "enabled": settings["enabled"],
        "channel_id": str(channel_id) if channel_id else None,
    })


@guild_api
async def _api_chat_put(request: web.Request, guild_id: int) -> web.Response:
    data = await _json_body(request)
    if data is None or not isinstance(data.get("enabled"), bool):
        return web.json_response({"error": "body inválido"}, status=400)
    channel_id = None
    if data.get("channel_id") is not None:
        channel_id = _to_int(data["channel_id"])
        if channel_id is None:
            return web.json_response({"error": "channel_id inválido"}, status=400)
    await set_chat_mode(guild_id, data["enabled"], channel_id)
    return web.json_response({"ok": True})


# ---------------- API: corpus (canales ignorados) ----------------

@guild_api
async def _api_corpus_get(request: web.Request, guild_id: int) -> web.Response:
    guild = _bot_guild(request, guild_id)
    channel_ids = await list_ignored_channels(guild_id)
    channels = [{"id": str(cid), "name": _channel_name(guild, cid)} for cid in channel_ids]
    return web.json_response({"channels": channels})


@guild_api
async def _api_corpus_post(request: web.Request, guild_id: int) -> web.Response:
    data = await _json_body(request)
    channel_id = _to_int(data.get("channel_id")) if data else None
    if channel_id is None:
        return web.json_response({"error": "channel_id inválido"}, status=400)
    added = await add_ignored_channel(guild_id, channel_id)
    return web.json_response({"added": added})


@guild_api
async def _api_corpus_delete(request: web.Request, guild_id: int) -> web.Response:
    channel_id = _to_int(request.match_info.get("channel_id"))
    if channel_id is None:
        return web.json_response({"error": "channel_id inválido"}, status=400)
    removed = await remove_ignored_channel(guild_id, channel_id)
    return web.json_response({"removed": removed})


# ---------------- API: reacciones ----------------

@guild_api
async def _api_reacciones_get(request: web.Request, guild_id: int) -> web.Response:
    pool = await list_reaction_pool(guild_id)
    return web.json_response({"reactions": pool})


@guild_api
async def _api_reacciones_post(request: web.Request, guild_id: int) -> web.Response:
    data = await _json_body(request)
    emoji = (data.get("emoji") or "").strip() if data else ""
    if not emoji:
        return web.json_response({"error": "emoji vacío"}, status=400)
    added = await add_reaction_to_pool(guild_id, emoji)
    return web.json_response({"added": added})


@guild_api
async def _api_reacciones_delete(request: web.Request, guild_id: int) -> web.Response:
    reaction_id = _to_int(request.match_info.get("reaction_id"))
    if reaction_id is None:
        return web.json_response({"error": "reaction_id inválido"}, status=400)
    removed = await remove_reaction_from_pool(guild_id, reaction_id)
    return web.json_response({"removed": removed})


# ---------------- API: frases ----------------

@guild_api
async def _api_frases_get(request: web.Request, guild_id: int) -> web.Response:
    frases = await list_frases_especiales(guild_id)
    return web.json_response({"frases": [
        {"id": f["id"], "frase": f["frase"], "user_name": f["user_name"]} for f in frases
    ]})


@guild_api
async def _api_frases_post(request: web.Request, guild_id: int) -> web.Response:
    data = await _json_body(request)
    frase = (data.get("frase") or "").strip() if data else ""
    if not frase:
        return web.json_response({"error": "frase vacía"}, status=400)
    session = await get_session(request)
    added = await add_frase_especial(
        guild_id, int(session["user_id"]), str(session.get("username", "panel")), frase
    )
    return web.json_response({"added": added})


@guild_api
async def _api_frases_delete(request: web.Request, guild_id: int) -> web.Response:
    frase_id = _to_int(request.match_info.get("frase_id"))
    if frase_id is None:
        return web.json_response({"error": "frase_id inválido"}, status=400)
    deleted = await delete_frase_especial(guild_id, frase_id)
    return web.json_response({"deleted": deleted})


# ---------------- API: YouTube ----------------

@guild_api
async def _api_youtube_get(request: web.Request, guild_id: int) -> web.Response:
    guild = _bot_guild(request, guild_id)
    subs = await list_youtube_subs(guild_id)
    out = []
    for s in subs:
        role_id = s["mention_role_id"]
        role = guild.get_role(role_id) if guild and role_id else None
        out.append({
            "youtube_channel_id": s["youtube_channel_id"],
            "youtube_channel_name": s["youtube_channel_name"],
            "discord_channel_id": str(s["discord_channel_id"]),
            "discord_channel_name": _channel_name(guild, s["discord_channel_id"]),
            "mention_role_id": str(role_id) if role_id else None,
            "mention_role_name": getattr(role, "name", None),
        })
    return web.json_response({"subs": out})


@guild_api
async def _api_youtube_post(request: web.Request, guild_id: int) -> web.Response:
    data = await _json_body(request)
    if data is None:
        return web.json_response({"error": "body inválido"}, status=400)
    yt_id = str(data.get("youtube_channel_id") or "").strip()
    yt_name = str(data.get("youtube_channel_name") or "").strip()
    discord_channel_id = _to_int(data.get("discord_channel_id"))
    if not yt_id or not yt_name or discord_channel_id is None:
        return web.json_response({"error": "faltan campos"}, status=400)
    added = await add_youtube_sub(guild_id, 0, yt_id, yt_name, discord_channel_id)
    return web.json_response({"added": added})


@guild_api
async def _api_youtube_delete(request: web.Request, guild_id: int) -> web.Response:
    yt_id = request.match_info.get("youtube_channel_id", "")
    removed = await remove_youtube_sub(guild_id, yt_id)
    return web.json_response({"removed": removed})


@guild_api
async def _api_youtube_mention_put(request: web.Request, guild_id: int) -> web.Response:
    data = await _json_body(request)
    if data is None:
        return web.json_response({"error": "body inválido"}, status=400)
    role_id = None
    if data.get("role_id") is not None:
        role_id = _to_int(data["role_id"])
        if role_id is None:
            return web.json_response({"error": "role_id inválido"}, status=400)
    yt_id = request.match_info.get("youtube_channel_id", "")
    updated = await set_youtube_mention_role(guild_id, yt_id, role_id)
    return web.json_response({"updated": updated})


# ---------------- API: memes (premium) ----------------

def _premium_gate(guild_id: int) -> web.Response | None:
    if not is_premium_guild(guild_id):
        return web.json_response({"error": "feature premium", "premium": True}, status=403)
    return None


@guild_api
async def _api_memes_get(request: web.Request, guild_id: int) -> web.Response:
    gate = _premium_gate(guild_id)
    if gate is not None:
        return gate
    guild = _bot_guild(request, guild_id)
    schedules = await list_meme_schedules(guild_id)
    return web.json_response({"schedules": [
        {
            "channel_id": str(s["channel_id"]),
            "channel_name": _channel_name(guild, s["channel_id"]),
            "interval_hours": s["interval_minutes"] // 60,
        }
        for s in schedules
    ]})


@guild_api
async def _api_memes_post(request: web.Request, guild_id: int) -> web.Response:
    gate = _premium_gate(guild_id)
    if gate is not None:
        return gate
    data = await _json_body(request)
    channel_id = _to_int(data.get("channel_id")) if data else None
    interval_hours = _to_int(data.get("interval_hours")) if data else None
    if channel_id is None or interval_hours is None or not (2 <= interval_hours <= 24):
        return web.json_response({"error": "channel_id o interval_hours (2-24) inválidos"}, status=400)
    added = await add_meme_schedule(guild_id, channel_id, interval_hours * 60)
    return web.json_response({"added": added})


@guild_api
async def _api_memes_delete(request: web.Request, guild_id: int) -> web.Response:
    gate = _premium_gate(guild_id)
    if gate is not None:
        return gate
    channel_id = _to_int(request.match_info.get("channel_id"))
    if channel_id is None:
        return web.json_response({"error": "channel_id inválido"}, status=400)
    removed = await remove_meme_schedule(guild_id, channel_id)
    return web.json_response({"removed": removed})


# ---------------- API: gifs por guild ----------------

@guild_api
async def _api_server_gifs_get(request: web.Request, guild_id: int) -> web.Response:
    gifs = await list_gif_urls(guild_id)
    return web.json_response({"gifs": gifs, "total": len(gifs)})


@guild_api
async def _api_server_gifs_post(request: web.Request, guild_id: int) -> web.Response:
    return await _gif_add_impl(request, guild_id)


@guild_api
async def _api_server_gifs_delete(request: web.Request, guild_id: int) -> web.Response:
    return await _gif_delete_impl(request, guild_id, request.match_info.get("gif_id", ""))


# ---------------- Server ----------------

async def _log_auth_set_cookie(request: web.Request, response: web.StreamResponse) -> None:
    # debug temporal: verifica que el Set-Cookie de sesión salga en las respuestas
    # de /auth/* (se loggean atributos, nunca el valor cifrado).
    if not request.path.startswith("/auth/"):
        return
    cookies = response.headers.getall("Set-Cookie", [])
    if not cookies:
        log.info("Respuesta %s %s SIN Set-Cookie", response.status, request.path)
        return
    for c in cookies:
        name = c.split("=", 1)[0]
        attrs = c.partition(";")[2].strip()
        log.info("Respuesta %s %s Set-Cookie: %s=<cifrado>; %s",
                 response.status, request.path, name, attrs)


def _new_session_storage() -> EncryptedCookieStorage:
    # Derivamos 32 bytes exactos desde SESSION_SECRET (cualquier longitud) para Fernet.
    key = hashlib.sha256(SESSION_SECRET.encode()).digest()
    return EncryptedCookieStorage(key, cookie_name="PURGITO_SESSION",
                                  max_age=7 * 24 * 3600, httponly=True,
                                  samesite="Lax", secure=True)


async def start_web_server(bot: commands.Bot) -> None:
    global _runner
    if _runner is not None:
        return
    app = web.Application(middlewares=[_cors_middleware])
    app["bot"] = bot
    app.router.add_get("/", _gallery)
    app.router.add_get("/api/gifs", _api_gif_list)
    app.router.add_get("/health", _api_health)
    app.router.add_static("/static", Path(__file__).parent / "static")

    if DASHBOARD_ENABLED:
        setup_session(app, _new_session_storage())
        app.on_response_prepare.append(_log_auth_set_cookie)  # debug temporal
        app.router.add_post("/api/gifs", require_login(_api_gif_add))
        app.router.add_delete("/api/gifs/{id}", require_login(_api_gif_delete))
        app.router.add_get("/auth/login", _auth_login)
        app.router.add_get("/auth/callback", _auth_callback)
        app.router.add_get("/auth/logout", _auth_logout)
        app.router.add_get("/auth/error", _auth_error)

        # Páginas del panel
        app.router.add_get("/dashboard", require_login(_dashboard))
        app.router.add_get("/servers", require_login(_servers_page))
        app.router.add_get("/server/{guild_id}", require_login(_server_page))
        app.router.add_get("/server/{guild_id}/{category}", require_login(_server_page))

        # API del panel (guild_api verifica login + manage_guild por dentro)
        app.router.add_get("/api/me/guilds", _api_me_guilds)
        base = "/api/server/{guild_id}"
        app.router.add_get(f"{base}/channels", _api_channels)
        app.router.add_get(f"{base}/roles", _api_roles)
        app.router.add_get(f"{base}/settings/chat", _api_chat_get)
        app.router.add_put(f"{base}/settings/chat", _api_chat_put)
        app.router.add_get(f"{base}/settings/corpus", _api_corpus_get)
        app.router.add_post(f"{base}/settings/corpus", _api_corpus_post)
        app.router.add_delete(f"{base}/settings/corpus/{{channel_id}}", _api_corpus_delete)
        app.router.add_get(f"{base}/settings/reacciones", _api_reacciones_get)
        app.router.add_post(f"{base}/settings/reacciones", _api_reacciones_post)
        app.router.add_delete(f"{base}/settings/reacciones/{{reaction_id}}", _api_reacciones_delete)
        app.router.add_get(f"{base}/settings/frases", _api_frases_get)
        app.router.add_post(f"{base}/settings/frases", _api_frases_post)
        app.router.add_delete(f"{base}/settings/frases/{{frase_id}}", _api_frases_delete)
        app.router.add_get(f"{base}/settings/youtube", _api_youtube_get)
        app.router.add_post(f"{base}/settings/youtube", _api_youtube_post)
        app.router.add_delete(f"{base}/settings/youtube/{{youtube_channel_id}}", _api_youtube_delete)
        app.router.add_put(f"{base}/settings/youtube/{{youtube_channel_id}}/mention", _api_youtube_mention_put)
        app.router.add_get(f"{base}/settings/memes", _api_memes_get)
        app.router.add_post(f"{base}/settings/memes", _api_memes_post)
        app.router.add_delete(f"{base}/settings/memes/{{channel_id}}", _api_memes_delete)
        app.router.add_get(f"{base}/settings/gifs", _api_server_gifs_get)
        app.router.add_post(f"{base}/settings/gifs", _api_server_gifs_post)
        app.router.add_delete(f"{base}/settings/gifs/{{gif_id}}", _api_server_gifs_delete)
        log.info("Dashboard OAuth2 habilitado")
    else:
        # Sin dashboard: la escritura queda cerrada al público.
        app.router.add_post("/api/gifs", _api_gif_add)
        app.router.add_delete("/api/gifs/{id}", _api_gif_delete)

    _runner = web.AppRunner(app)
    await _runner.setup()
    site = web.TCPSite(_runner, "0.0.0.0", WEB_PORT)
    await site.start()
    log.info("Web API iniciada en 0.0.0.0:%s", WEB_PORT)


async def stop_web_server() -> None:
    global _runner
    if _runner is not None:
        await _runner.cleanup()
        _runner = None
