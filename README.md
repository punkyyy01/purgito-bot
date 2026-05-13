# Bot de Discord — Markov + GIFs + YouTube

Bot para Discord escrito en Python que aprende el estilo de conversación de tu servidor, genera respuestas automáticas con cadenas de Markov, colecciona GIFs y notifica nuevos videos de YouTube.

---

## Características

- **Respuestas Markov automáticas** — aprende del chat y genera réplicas al estilo del servidor cada 15 mensajes nuevos
- **Imitación de usuarios** — genera un mensaje imitando el estilo de cualquier miembro con `/imitar`
- **Modo chat** — responde al ser mencionado o al responderle directamente
- **Colección de GIFs** — guarda GIFs de Tenor, Giphy y Discord automáticamente; los de Discord CDN se suben a Cloudflare R2 para que no caduquen
- **Notificaciones de YouTube** — sondea canales cada 15 minutos y avisa en Discord cuando hay video nuevo
- **Corpus administrable** — importa el historial del servidor con `/refeed`, consulta estadísticas o limpia todo con un comando

---

## Requisitos

- Python 3.11+
- Token de bot Discord ([Developer Portal](https://discord.com/developers/applications))
- **Intents privilegiados** activados: `Message Content Intent` y `Server Members Intent`
- (Opcional) Credenciales de Cloudflare R2 para persistir GIFs de Discord CDN

---

## Instalación

```bash
# Linux / macOS
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Windows (PowerShell)
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

---

## Variables de entorno

Copia `.env.example` a `.env` y rellena los valores:

```env
# ── Obligatorio ──────────────────────────────────────────────────────────────
DISCORD_TOKEN=tu_token_aquí

# ── Desarrollo (sync instantáneo de slash commands en tu servidor) ────────────
GUILD_ID=123456789012345678

# ── Intents (desactiva si no tienes el intent habilitado en el portal) ────────
ENABLE_MESSAGE_CONTENT=true

# ── Cloudflare R2 (necesario para persistir GIFs de cdn.discordapp.com) ──────
R2_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=tu_key
R2_SECRET_ACCESS_KEY=tu_secret
R2_BUCKET_NAME=nombre-del-bucket
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

---

## Arrancar

```bash
python src/bot.py
```

---

## Comandos

### Markov y corpus

| Comando | Descripción | Permisos |
|---|---|---|
| `/refeed` | Importa los últimos mensajes del canal actual al corpus (máx. 20 000) | Rol autorizado |
| `/refeed_all` | Importa mensajes de todos los canales del servidor | Rol autorizado |
| `/generar` | Genera un mensaje con el modelo Markov del servidor | Todos |
| `/imitar @usuario` | Genera un mensaje imitando el estilo del usuario (mín. 30 mensajes) | Todos |
| `/corpus_info` | Muestra cuántos mensajes tiene el corpus en el canal actual | Todos |
| `/corpus_wipe` | Borra todo el corpus del servidor y reinicia la caché Markov | Rol autorizado |

### Chat automático

| Comando | Descripción | Permisos |
|---|---|---|
| `/chatmode on [#canal]` | Activa auto-reply al ser mencionado o al responderle | Gestionar servidor |
| `/chatmode off` | Desactiva el auto-reply | Gestionar servidor |

### GIFs

| Comando | Descripción | Permisos |
|---|---|---|
| `/gif_add <url>` | Añade un GIF manualmente a la colección (Tenor, Giphy o Discord CDN) | Rol autorizado |

### YouTube

| Comando | Descripción | Permisos |
|---|---|---|
| `/youtube_add <channel_id> #canal [rol]` | Suscribe un canal de YouTube; los nuevos videos se anuncian en el canal de Discord indicado | Rol autorizado |
| `/youtube_remove <channel_id>` | Elimina una suscripción | Rol autorizado |
| `/youtube_list` | Lista todas las suscripciones activas del servidor | Rol autorizado |
| `/youtube_set_mention <channel_id> [rol]` | Configura (o quita) el rol a mencionar en las notificaciones | Rol autorizado |

### Utilidades

| Comando | Descripción |
|---|---|
| `!ping` | Responde `Pong!` para verificar que el bot está online |

---

## Comportamiento automático

### Corpus y limpieza de mensajes

Cada mensaje de usuario pasa por un filtro antes de guardarse: se eliminan URLs, menciones de Discord, secuencias ANSI y líneas sin letras. Los mensajes de menos de 4 palabras se descartan. El corpus tiene deduplicación por `(servidor, canal, contenido)`.

El bot mantiene dos corpus independientes:
- **Servidor** — usado para generar respuestas generales con `/generar` y el auto-reply
- **Por usuario** — usado exclusivamente para `/imitar`

### Generación automática

Cada vez que se insertan 15 mensajes nuevos en el corpus de un canal, el bot genera una respuesta. Con un **35 % de probabilidad** envía un GIF aleatorio de la colección en lugar del texto generado.

La caché del modelo Markov se invalida automáticamente cada 50 inserciones para mantenerse actualizada sin reconstruir en cada mensaje.

### Auto-reply (chatmode)

Si el modo está activo, el bot responde cuando:

- Lo mencionan con `@bot`
- Alguien responde (reply) directamente a uno de sus mensajes

Se puede restringir a un canal específico con `/chatmode on #canal`. Requiere el permiso **Gestionar servidor** para activarlo o desactivarlo.

### Reacción aleatoria

Con un **5 % de probabilidad**, el bot reacciona a mensajes con un emoji custom del servidor.

### Colección de GIFs

Los GIFs detectados automáticamente en mensajes (Tenor, Giphy, adjuntos `.gif`) se guardan en la base de datos. Los de `cdn.discordapp.com` se suben a Cloudflare R2 para que no caduquen cuando Discord elimine el adjunto.

### Notificaciones de YouTube

Una tarea en segundo plano sondea el RSS de cada canal suscrito cada 15 minutos. Si detecta un video nuevo, envía un mensaje en el canal de Discord configurado con el título, el enlace y la mención al rol (si está configurado).

---

## Estructura del proyecto

```
.
├── src/
│   ├── bot.py         # Lógica principal, eventos y slash commands
│   ├── db.py          # Capa de datos: aiosqlite, WAL mode, migraciones
│   └── __init__.py
├── data/
│   └── bot.db         # Base de datos SQLite (se crea al arrancar)
├── requirements.txt
├── .env.example
└── .gitignore
```

---

## Permisos del bot en Discord

Al generar el enlace de invitación, incluye:

| Categoría | Valores |
|---|---|
| **OAuth2 Scopes** | `bot`, `applications.commands` |
| **Permisos de bot** | `Read Messages`, `Send Messages`, `Read Message History`, `Add Reactions`, `Embed Links` |
| **Intents privilegiados** | `Message Content Intent`, `Server Members Intent` |

---

## Notas

- Los slash commands se propagan globalmente en hasta 1 hora. Para verlos al instante durante el desarrollo, pon `GUILD_ID=<id>` en `.env`.
- El modelo Markov necesita al menos **50 mensajes** en el corpus del servidor para generar respuestas, y **30** para `/imitar`.
- Si los slash commands no aparecen, verifica que el bot esté invitado con el scope `applications.commands`.
- La base de datos usa **modo WAL** para mejor concurrencia entre lecturas y escrituras asíncronas.
