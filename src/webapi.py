"""Web API pública: galería de GIFs de PURG4TORY + health check + dashboard OAuth2."""

import hashlib
import html
import logging
import secrets
import time
from urllib.parse import urlencode

import aiohttp
from aiohttp import web
from aiohttp_session import get_session, setup as setup_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage

import config
from config import (
    DASHBOARD_BASE_URL,
    DASHBOARD_ENABLED,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    PURGATORY_GUILD_ID,
    SESSION_SECRET,
    WEB_PORT,
)
from db import count_gif_urls, delete_gif_url_by_id, list_gif_urls, save_gif_url
from gif_gallery import GIF_GALLERY_HTML
from utils import LRUDict
import r2

log = logging.getLogger(__name__)

_rate_post: LRUDict = LRUDict(512)
_rate_delete: LRUDict = LRUDict(512)
_runner: web.AppRunner | None = None

_DISCORD_API = "https://discord.com/api"
_ADMINISTRATOR = 1 << 3
_MANAGE_GUILD = 1 << 5
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
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
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


# ---------------- GIF API ----------------

async def _api_gif_list(request: web.Request) -> web.Response:
    gifs = await list_gif_urls(PURGATORY_GUILD_ID)
    return web.json_response({"gifs": gifs, "total": len(gifs)})


async def _api_gif_add(request: web.Request) -> web.Response:
    ip = request.remote or "unknown"
    if not _rate_ok(_rate_post, ip, 5):
        return web.json_response({"error": "rate limit"}, status=429)
    try:
        data = await request.json()
        url = (data.get("url") or "").strip()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not url or not _valid_gif_url(url):
        return web.json_response({"error": "url inválida o no permitida"}, status=400)
    inserted = await save_gif_url(PURGATORY_GUILD_ID, url)
    total = await count_gif_urls(PURGATORY_GUILD_ID)
    return web.json_response({"inserted": inserted, "total": total})


async def _api_gif_delete(request: web.Request) -> web.Response:
    ip = request.remote or "unknown"
    if not _rate_ok(_rate_delete, ip, 3):
        return web.json_response({"error": "rate limit"}, status=429)
    try:
        gif_id = int(request.match_info["id"])
    except (KeyError, ValueError):
        return web.json_response({"error": "id inválido"}, status=400)
    deleted = await delete_gif_url_by_id(PURGATORY_GUILD_ID, gif_id)
    return web.json_response({"deleted": deleted})


async def _api_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def _gallery(request: web.Request) -> web.Response:
    return web.Response(text=GIF_GALLERY_HTML, content_type="text/html", charset="utf-8")


# ---------------- Auth OAuth2 ----------------

def _can_manage(member: dict, guild: dict) -> bool:
    """True si el miembro es owner o tiene ADMINISTRATOR/MANAGE_GUILD por sus roles."""
    if guild.get("owner_id") == member.get("user", {}).get("id"):
        return True
    role_perms = {r["id"]: int(r["permissions"]) for r in guild.get("roles", [])}
    perms = role_perms.get(guild.get("id"), 0)  # @everyone (role id == guild id)
    for rid in member.get("roles", []):
        perms |= role_perms.get(rid, 0)
    return bool(perms & (_ADMINISTRATOR | _MANAGE_GUILD))


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

    headers_bot = {"Authorization": f"Bot {config.TOKEN}"}
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

            # Verificación de permiso con el BOT TOKEN (no confiamos en el cliente).
            async with http.get(f"{_DISCORD_API}/guilds/{PURGATORY_GUILD_ID}/members/{user['id']}",
                                headers=headers_bot) as r:
                if r.status != 200:  # 404 = no es miembro
                    raise web.HTTPFound("/auth/error")
                member = await r.json()

            async with http.get(f"{_DISCORD_API}/guilds/{PURGATORY_GUILD_ID}",
                                headers=headers_bot) as r:
                if r.status != 200:
                    raise web.HTTPFound("/auth/error")
                guild = await r.json()
    except aiohttp.ClientError:
        log.exception("Fallo llamando a la API de Discord en el callback OAuth2")
        raise web.HTTPFound("/auth/error")

    if not _can_manage(member, guild):
        raise web.HTTPFound("/auth/error")

    session["user_id"] = user["id"]
    session["username"] = user.get("global_name") or user.get("username") or "admin"
    raise web.HTTPFound("/dashboard")


async def _auth_logout(request: web.Request) -> web.StreamResponse:
    session = await get_session(request)
    session.invalidate()
    raise web.HTTPFound("/")


async def _auth_error(request: web.Request) -> web.Response:
    body = (
        "<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'>"
        "<title>Acceso denegado</title></head>"
        "<body style='background:#0a0a0a;color:#e0e0e0;font-family:monospace;"
        "text-align:center;padding-top:15vh'>"
        "<h1 style='color:#8b0000'>Acceso denegado</h1>"
        "<p>Necesitás ser miembro de PURG4TORY con permiso de administrar el servidor.</p>"
        "<p><a href='/' style='color:#8b0000'>← volver</a></p>"
        "</body></html>"
    )
    return web.Response(text=body, content_type="text/html", charset="utf-8")


async def _dashboard(request: web.Request) -> web.Response:
    session = await get_session(request)
    username = html.escape(str(session.get("username", "admin")))
    return web.Response(text=_DASHBOARD_HTML.replace("{{USERNAME}}", username),
                        content_type="text/html", charset="utf-8")


# ---------------- Server ----------------

def _new_session_storage() -> EncryptedCookieStorage:
    # Derivamos 32 bytes exactos desde SESSION_SECRET (cualquier longitud) para Fernet.
    key = hashlib.sha256(SESSION_SECRET.encode()).digest()
    return EncryptedCookieStorage(key, cookie_name="PURGITO_SESSION",
                                  max_age=7 * 24 * 3600, httponly=True, samesite="Lax")


async def start_web_server() -> None:
    global _runner
    if _runner is not None:
        return
    app = web.Application(middlewares=[_cors_middleware])
    app.router.add_get("/", _gallery)
    app.router.add_get("/api/gifs", _api_gif_list)
    app.router.add_get("/health", _api_health)

    if DASHBOARD_ENABLED:
        setup_session(app, _new_session_storage())
        app.router.add_post("/api/gifs", require_login(_api_gif_add))
        app.router.add_delete("/api/gifs/{id}", require_login(_api_gif_delete))
        app.router.add_get("/auth/login", _auth_login)
        app.router.add_get("/auth/callback", _auth_callback)
        app.router.add_get("/auth/logout", _auth_logout)
        app.router.add_get("/auth/error", _auth_error)
        app.router.add_get("/dashboard", require_login(_dashboard))
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


_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Purgito · Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body { background:#0a0a0a; color:#e0e0e0; font-family:monospace; margin:0; padding:24px; }
  h1, h2 { color:#8b0000; font-weight:normal; }
  header { display:flex; justify-content:space-between; align-items:center;
           border-bottom:1px solid #8b0000; padding-bottom:12px; margin-bottom:24px; }
  a.btn, button { background:#1a1a1a; color:#e0e0e0; border:1px solid #8b0000;
                  padding:6px 12px; cursor:pointer; text-decoration:none; font-family:monospace; }
  a.btn:hover, button:hover { background:#8b0000; }
  form { margin:16px 0; display:flex; gap:8px; }
  input[type=text] { flex:1; background:#111; color:#e0e0e0; border:1px solid #333; padding:8px; }
  ul { list-style:none; padding:0; }
  li { display:flex; align-items:center; gap:12px; border:1px solid #222; padding:8px; margin-bottom:8px; }
  li img { height:64px; width:auto; background:#000; }
  li span { flex:1; word-break:break-all; font-size:12px; color:#999; }
  #msg { min-height:18px; color:#c41230; }
</style>
</head>
<body>
<header>
  <h1>Hola, {{USERNAME}}</h1>
  <a class="btn" href="/auth/logout">Cerrar sesión</a>
</header>

<h2>GIFs de PURG4TORY</h2>
<form id="addForm">
  <input type="text" id="url" placeholder="https://tenor.com/... o URL de R2" required>
  <button type="submit">Agregar</button>
</form>
<div id="msg"></div>
<ul id="list"></ul>

<script>
const msg = document.getElementById('msg');
async function load() {
  const r = await fetch('/api/gifs');
  const data = await r.json();
  const list = document.getElementById('list');
  list.innerHTML = '';
  for (const g of data.gifs) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = g.media_url || g.url;
    img.loading = 'lazy';
    const span = document.createElement('span');
    span.textContent = g.url;
    const btn = document.createElement('button');
    btn.textContent = 'Borrar';
    btn.onclick = () => del(g.id);
    li.append(img, span, btn);
    list.append(li);
  }
}
async function del(id) {
  const r = await fetch('/api/gifs/' + id, { method: 'DELETE', credentials: 'include' });
  if (!r.ok) { msg.textContent = 'Error al borrar (' + r.status + ')'; return; }
  msg.textContent = '';
  load();
}
document.getElementById('addForm').onsubmit = async (e) => {
  e.preventDefault();
  const url = document.getElementById('url').value.trim();
  const r = await fetch('/api/gifs', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { msg.textContent = data.error || ('Error ' + r.status); return; }
  msg.textContent = ''; document.getElementById('url').value = '';
  load();
};
load();
</script>
</body>
</html>
"""
