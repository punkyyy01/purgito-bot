"""Validación y construcción de layouts Components V2 (discord.py 2.7.1).

Un mensaje de Discord NO puede mezclar embeds clásicos (`embeds=`) con
Components V2 (`view=LayoutView`) — son excluyentes vía el flag
IS_COMPONENTS_V2. Por eso cada plantilla/anuncio lleva un `content_mode`
('classic_embed' | 'layout_v2') que dice cómo interpretar su JSON guardado.

El JSON de un layout tiene forma:
    {"blocks": [ <block>, ... ]}
donde cada block es uno de:
    {"type": "container", "accent_color": "#RRGGBB"|int|null, "children": [<block>...]}
    {"type": "text", "content": str}
    {"type": "section", "texts": [str, ...(1-3)], "accessory": <thumbnail|button>}
    {"type": "media_gallery", "items": [{"url": str, "description": str?}, ...(1-10)]}
    {"type": "separator", "visible": bool, "spacing": "small"|"large"}
    {"type": "action_row", "buttons": [<button>, ...(1-5)]}
    accessory thumbnail: {"type": "thumbnail", "url": str, "description": str?}
    button (Fase 2: solo link): {"style": "link", "label": str, "url": str}
"""

import discord

MAX_COMPONENTS = 40  # total de componentes por mensaje (incluye anidados)
MAX_TEXT_TOTAL = 4000  # suma de caracteres de TODOS los TextDisplay del layout
MAX_SECTION_TEXTS = 3
MAX_GALLERY_ITEMS = 10
MAX_ROW_BUTTONS = 5
MAX_BUTTON_LABEL = 80

_SPACING = {
    "small": discord.SeparatorSpacing.small,
    "large": discord.SeparatorSpacing.large,
}


def _parse_color(value):
    """Acepta '#RRGGBB' o int; devuelve int (o None)."""
    if isinstance(value, str):
        return int(value.lstrip("#"), 16)
    return value


# ─── Validación ──────────────────────────────────────────────────────────────


def _validate_button(btn) -> str | None:
    if not isinstance(btn, dict):
        return "botón inválido"
    label = (btn.get("label") or "").strip()
    if len(label) > MAX_BUTTON_LABEL:
        return f"el texto del botón supera los {MAX_BUTTON_LABEL} caracteres"
    # Fase 2: solo botones de enlace (los de acción/rol llegan en Fase 3).
    if btn.get("style", "link") != "link":
        return "tipo de botón no soportado todavía (solo enlaces por ahora)"
    url = (btn.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        return "un botón de enlace necesita una URL http(s)"
    if not label:
        return "un botón de enlace necesita un texto"
    return None


def _validate_accessory(acc, state) -> str | None:
    if not isinstance(acc, dict):
        return "la sección necesita un accesorio (miniatura o botón)"
    state["count"] += 1
    kind = acc.get("type")
    if kind == "thumbnail":
        if not (acc.get("url") or "").strip():
            return "la miniatura de la sección no tiene URL"
        return None
    if kind == "button":
        return _validate_button(acc)
    return "accesorio inválido: usa una miniatura o un botón"


def _validate_blocks(blocks, state, in_container=False) -> str | None:
    if not isinstance(blocks, list) or not blocks:
        return "el layout necesita al menos un bloque"
    for i, b in enumerate(blocks):
        if not isinstance(b, dict):
            return f"bloque {i + 1} inválido"
        state["count"] += 1
        kind = b.get("type")
        if kind == "container":
            if in_container:
                return "no se pueden anidar containers"
            err = _validate_blocks(b.get("children"), state, in_container=True)
            if err:
                return err
        elif kind == "text":
            content = b.get("content")
            if not isinstance(content, str) or not content.strip():
                return "un bloque de texto no puede estar vacío"
            state["text"] += len(content)
        elif kind == "section":
            texts = b.get("texts")
            if not isinstance(texts, list) or not (1 <= len(texts) <= MAX_SECTION_TEXTS):
                return f"una sección necesita entre 1 y {MAX_SECTION_TEXTS} textos"
            for tx in texts:
                if not isinstance(tx, str) or not tx.strip():
                    return "una sección tiene un texto vacío"
                state["count"] += 1  # cada texto es un TextDisplay
                state["text"] += len(tx)
            err = _validate_accessory(b.get("accessory"), state)
            if err:
                return err
        elif kind == "media_gallery":
            items = b.get("items")
            if not isinstance(items, list) or not (1 <= len(items) <= MAX_GALLERY_ITEMS):
                return f"una galería necesita entre 1 y {MAX_GALLERY_ITEMS} imágenes"
            for it in items:
                if not isinstance(it, dict) or not (it.get("url") or "").strip():
                    return "una imagen de la galería no tiene URL"
        elif kind == "separator":
            pass
        elif kind == "action_row":
            buttons = b.get("buttons")
            if not isinstance(buttons, list) or not buttons:
                return "una fila de botones necesita al menos un botón"
            if len(buttons) > MAX_ROW_BUTTONS:
                return f"máximo {MAX_ROW_BUTTONS} botones por fila"
            for btn in buttons:
                state["count"] += 1
                err = _validate_button(btn)
                if err:
                    return err
        else:
            return f"tipo de bloque desconocido: {kind}"
    return None


def validate_layout_v2_payload(layout) -> str | None:
    """Devuelve un mensaje de error o None si el layout es válido."""
    if not isinstance(layout, dict):
        return "layout inválido: se esperaba un objeto"
    state = {"count": 0, "text": 0}
    err = _validate_blocks(layout.get("blocks"), state)
    if err:
        return err
    if state["count"] > MAX_COMPONENTS:
        return f"el layout supera los {MAX_COMPONENTS} componentes"
    if state["text"] > MAX_TEXT_TOTAL:
        return f"el texto total supera los {MAX_TEXT_TOTAL} caracteres"
    return None


# ─── Construcción ────────────────────────────────────────────────────────────


def _build_button(btn) -> discord.ui.Button:
    return discord.ui.Button(
        style=discord.ButtonStyle.link,
        label=(btn.get("label") or "").strip(),
        url=btn["url"].strip(),
    )


def _build_accessory(acc):
    if acc.get("type") == "thumbnail":
        desc = (acc.get("description") or "").strip()
        if desc:
            return discord.ui.Thumbnail(acc["url"].strip(), description=desc)
        return discord.ui.Thumbnail(acc["url"].strip())
    return _build_button(acc)


def _gallery_item(it) -> discord.MediaGalleryItem:
    desc = (it.get("description") or "").strip()
    if desc:
        return discord.MediaGalleryItem(it["url"].strip(), description=desc)
    return discord.MediaGalleryItem(it["url"].strip())


def _build_block(b):
    kind = b.get("type")
    if kind == "container":
        children = [_build_block(c) for c in b.get("children", [])]
        color = b.get("accent_color")
        if color is not None:
            return discord.ui.Container(*children, accent_colour=_parse_color(color))
        return discord.ui.Container(*children)
    if kind == "text":
        return discord.ui.TextDisplay(b["content"])
    if kind == "section":
        texts = [discord.ui.TextDisplay(tx) for tx in b.get("texts", [])]
        return discord.ui.Section(*texts, accessory=_build_accessory(b["accessory"]))
    if kind == "media_gallery":
        return discord.ui.MediaGallery(*[_gallery_item(it) for it in b.get("items", [])])
    if kind == "separator":
        spacing = _SPACING.get(b.get("spacing", "small"), discord.SeparatorSpacing.small)
        return discord.ui.Separator(visible=b.get("visible", True), spacing=spacing)
    if kind == "action_row":
        return discord.ui.ActionRow(*[_build_button(btn) for btn in b.get("buttons", [])])
    raise ValueError(f"tipo de bloque desconocido: {kind}")


def build_layout_view(layout: dict, timeout: float | None = None) -> discord.ui.LayoutView:
    """Arma una LayoutView a partir del JSON del layout. Asume que el layout ya
    pasó validate_layout_v2_payload."""
    view = discord.ui.LayoutView(timeout=timeout)
    for block in layout.get("blocks", []):
        view.add_item(_build_block(block))
    return view
