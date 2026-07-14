"""Cliente Cloudflare R2 con inicialización perezosa.

El cliente se crea la primera vez que se necesita; si faltan variables de
entorno el módulo igual importa sin romper nada y available() devuelve False.
"""

import asyncio
import hashlib
import logging
import os

import requests

log = logging.getLogger(__name__)

_client = None
_checked = False

# Sentinel: el GIF supera el límite de tamaño (no guardar en DB, no reintentar).
GIF_TOO_LARGE = ""

_IMAGE_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def public_url() -> str:
    return os.getenv("R2_PUBLIC_URL", "").strip()


def _bucket() -> str:
    return os.getenv("R2_BUCKET_NAME", "").strip()


def get_client():
    global _client, _checked
    if not _checked:
        _checked = True
        endpoint = os.getenv("R2_ENDPOINT_URL", "").strip()
        key_id = os.getenv("R2_ACCESS_KEY_ID", "").strip()
        secret = os.getenv("R2_SECRET_ACCESS_KEY", "").strip()
        if endpoint and key_id and secret and _bucket():
            import boto3
            from botocore.config import Config

            _client = boto3.client(
                "s3",
                endpoint_url=endpoint,
                aws_access_key_id=key_id,
                aws_secret_access_key=secret,
                config=Config(signature_version="s3v4"),
                region_name="auto",
            )
    return _client


def available() -> bool:
    return get_client() is not None


def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.getenv(name, "") or default)
        return v if v > 0 else default
    except (ValueError, TypeError):
        return default


def upload_gif_sync(url: str, guild_id: int) -> str | None:
    """Retorna URL de R2, '' (GIF_TOO_LARGE) si supera el límite, None en otros errores."""
    client = get_client()
    if client is None:
        return None
    max_bytes = _env_int("MAX_GIF_DOWNLOAD_BYTES", 8 * 1024 * 1024)
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; bot)"}
        resp = requests.get(url, headers=headers, timeout=15, stream=True)
        if resp.status_code != 200:
            log.error("HTTP %s al descargar GIF para R2: %s", resp.status_code, url)
            return None
        cl = resp.headers.get("Content-Length")
        if cl and int(cl) > max_bytes:
            log.debug("GIF descartado (Content-Length %s > %d): %s", cl, max_bytes, url)
            resp.close()
            return GIF_TOO_LARGE
        data = resp.content
        resp.close()
        if len(data) > max_bytes:
            log.debug("GIF descartado (%d bytes > %d): %s", len(data), max_bytes, url)
            return GIF_TOO_LARGE
        key = f"{guild_id}/{hashlib.md5(url.encode(), usedforsecurity=False).hexdigest()}.gif"
        client.put_object(
            Bucket=_bucket(),
            Key=key,
            Body=data,
            ContentType="image/gif",
            CacheControl="public, max-age=31536000, immutable",
        )
        return f"{public_url().rstrip('/')}/{key}"
    except Exception:
        log.exception("Error subiendo GIF a R2: %s", url)
        return None


def upload_image_bytes_sync(url: str, data: bytes, guild_id: int, ext: str) -> str | None:
    """Sube bytes ya descargados (y validados como imagen real por el caller);
    `url` solo se usa para derivar la key y para los logs de error."""
    client = get_client()
    if client is None:
        return None
    content_type = _IMAGE_CONTENT_TYPES.get(ext.lower(), "image/png")
    try:
        key = f"{guild_id}/{hashlib.md5(url.encode(), usedforsecurity=False).hexdigest()}{ext}"
        client.put_object(
            Bucket=_bucket(),
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )
        return f"{public_url().rstrip('/')}/{key}"
    except Exception:
        log.exception("Error subiendo imagen a R2: %s", url)
        return None


def is_url_alive(url: str, timeout: float = 4.0) -> bool:
    """HEAD rápido (con fallback a GET) para chequear un GIF antes de mandarlo a Discord."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; bot)"}
        resp = requests.head(
            url, headers=headers, timeout=timeout, allow_redirects=True
        )
        if resp.status_code == 405:
            resp = requests.get(url, headers=headers, timeout=timeout, stream=True)
            resp.close()
        return resp.status_code == 200
    except Exception:
        return False


_VALID_MEDIA_CONTENT_TYPES = ("image/", "video/")


def check_gif_url_health(url: str, timeout: float = 6.0) -> str:
    """Chequea un GIF guardado para la galería del panel: "ok" / "dead" /
    "unreachable". A propósito NO manda un header Referer de navegador, para
    comportarse lo más parecido posible a cómo Discord lo desempaqueta (a
    diferencia de un <img> de navegador, que sí manda el Referer que activa
    la protección anti-hotlink de muchos hosts de GIFs).

    "dead": el link está confirmado roto (404/410, o un Content-Type que no
    es de imagen/video) -- esto también le va a fallar a Discord.
    "unreachable": fallo de red o timeout puntual, no alcanza para asegurar
    que el link esté muerto (podría ser una caída transitoria del host).
    """
    headers = {"User-Agent": "Mozilla/5.0 (compatible; bot)"}
    try:
        resp = requests.head(
            url, headers=headers, timeout=timeout, allow_redirects=True
        )
        if resp.status_code == 405 or not resp.headers.get("Content-Type"):
            resp = requests.get(url, headers=headers, timeout=timeout, stream=True)
            resp.close()
    except Exception:
        return "unreachable"

    if resp.status_code in (404, 410):
        return "dead"
    if resp.status_code != 200:
        return "unreachable"

    content_type = resp.headers.get("Content-Type", "").split(";")[0].strip().lower()
    if content_type.startswith(_VALID_MEDIA_CONTENT_TYPES):
        return "ok"
    return "dead"


async def delete_url(url: str) -> None:
    """Borra un objeto de R2 si la URL le pertenece. No-op para URLs externas."""
    pub = public_url()
    if not pub or not url.startswith(pub):
        return
    client = get_client()
    if client is None:
        return
    key = url[len(pub.rstrip("/")) + 1 :]
    try:
        await asyncio.to_thread(client.delete_object, Bucket=_bucket(), Key=key)
    except Exception:
        log.warning("No se pudo eliminar objeto de R2: %s", url)
