<div align="center">

# 🤖 Purgatory Bot

**Bot de Discord que aprende a hablar como tu servidor.**

Cadenas de Markov · Colección de GIFs · Notificaciones de YouTube

---

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)
![discord.py](https://img.shields.io/badge/discord.py-2.x-5865F2?style=flat-square&logo=discord&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite&logoColor=white)
![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2-F38020?style=flat-square&logo=cloudflare&logoColor=white)

</div>

---

## ✨ Características

| | Característica | Descripción |
|---|---|---|
| 🧠 | **Markov automático** | Aprende del chat y genera réplicas al estilo del servidor cada 15 mensajes |
| 🎭 | **Imitación de usuarios** | Imita el estilo de escritura de cualquier miembro con `/imitar` |
| 💬 | **Modo chat** | Responde cuando lo mencionas o le haces reply |
| 🎞️ | **Colección de GIFs** | Guarda GIFs de Tenor/Giphy automáticamente; los de Discord CDN se suben a R2 |
| 📺 | **Notificaciones YouTube** | Sondea canales cada 15 min y avisa cuando hay video nuevo |
| 🖼️ | **Memes (manual y automático)** | Genera memes con `/momo` o respondiendo a una imagen con `artemis generar`; opción de captions con Groq |
| 🎯 | **Pool de imágenes** | Con reacción 🎯 a una imagen, se guarda en un pool para memes |
| 🗂️ | **Corpus administrable** | Importa historial, consulta estadísticas, ignora canales o limpia el corpus |

---

## 🚀 Instalación

### 1. Clonar e instalar dependencias

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

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus valores:

```env
# ── Obligatorio ────────────────────────────────────────────────────
DISCORD_TOKEN=tu_token_aquí

# ── Desarrollo (sync instantáneo de slash commands) ────────────────
GUILD_ID=123456789012345678

# ── Intents ────────────────────────────────────────────────────────
ENABLE_MESSAGE_CONTENT=true

# ── Límites de importación de historial (corpus) ───────────────────
# /refeed: máximo de mensajes a leer del canal actual
REFEED_MAX_MESSAGES=80000
# /refeed_all: máximo de mensajes a leer por canal
REFEED_ALL_MAX_MESSAGES=20000

# ── Markov (muestra de entrenamiento) ──────────────────────────────
# Evita cargar todo el corpus a RAM. Se entrena con un muestreo aleatorio.
MARKOV_TRAINING_MESSAGES=5000
USER_MARKOV_TRAINING_MESSAGES=2000

# ── Cloudflare R2 (para persistir GIFs de Discord CDN) ────────────
R2_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=tu_key
R2_SECRET_ACCESS_KEY=tu_secret
R2_BUCKET_NAME=nombre-del-bucket
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

### 3. Arrancar

```bash
python src/bot.py
```

---

## 📋 Comandos

### 🧠 Markov y corpus

| Comando | Descripción | Permisos |
|---|---|---|
| `/refeed` | Importa los últimos mensajes del canal al corpus (máx. 80 000 por defecto) | Rol autorizado |
| `/refeed_all` | Importa mensajes de todos los canales del servidor (máx. 20 000 por canal por defecto) | Rol autorizado |
| `/generar` | Genera un mensaje con el modelo Markov del servidor | Todos |
| `/imitar @usuario` | Genera un mensaje imitando el estilo del usuario (mín. 30 msgs) | Todos |
| `/corpus_info` | Muestra cuántos mensajes tiene el corpus en el canal actual | Todos |
| `/corpus_wipe` | Borra todo el corpus y reinicia la caché Markov | Rol autorizado |

### 🚫 Canales ignorados (corpus)

| Comando | Descripción | Permisos |
|---|---|---|
| `/corpus_ignorar add #canal` | Añade un canal a la lista de ignorados | Rol autorizado |
| `/corpus_ignorar quitar #canal` | Quita un canal de la lista de ignorados | Rol autorizado |
| `/corpus_ignorar lista` | Lista canales ignorados | Rol autorizado |

### 💬 Chat automático

| Comando | Descripción | Permisos |
|---|---|---|
| `/chatmode on [#canal]` | Activa auto-reply al ser mencionado o al responderle | Gestionar servidor |
| `/chatmode off` | Desactiva el auto-reply | Gestionar servidor |

### 🎞️ GIFs

| Comando | Descripción | Permisos |
|---|---|---|
| `/gif_add <url>` | Añade un GIF manualmente (Tenor, Giphy o Discord CDN) | Rol autorizado |

### 🖼️ Memes

| Comando | Descripción | Permisos |
|---|---|---|
| `/momo` | Genera un meme usando una imagen del pool (cooldown ~45s por usuario) | Todos |
| `/meme` | Alias de `/momo` | Todos |

**Trigger rápido (sin slash):** responde (reply) a un mensaje con imagen y escribe `artemis generar` o `@bot generar`.

### ⏱️ Memes automáticos

| Comando | Descripción | Permisos |
|---|---|---|
| `/meme_auto activar #canal <horas>` | Activa memes automáticos cada 2–24h | Rol autorizado |
| `/meme_auto desactivar #canal` | Desactiva memes automáticos | Rol autorizado |
| `/meme_auto lista` | Lista configuración actual | Rol autorizado |

### 📺 YouTube

| Comando | Descripción | Permisos |
|---|---|---|
| `/youtube_add <channel_id> #canal [rol]` | Suscribe un canal de YouTube a un canal de Discord | Rol autorizado |
| `/youtube_remove <channel_id>` | Elimina una suscripción | Rol autorizado |
| `/youtube_list` | Lista todas las suscripciones activas del servidor | Rol autorizado |
| `/youtube_set_mention <channel_id> [rol]` | Configura (o quita) el rol a mencionar en notificaciones | Rol autorizado |

### 🔧 Utilidades

| Comando | Descripción |
|---|---|
| `!ping` | Responde `Pong!` para verificar que el bot está online |

---

## ⚙️ Comportamiento automático

<details>
<summary><b>🧠 Construcción del corpus</b></summary>

Cada mensaje de usuario pasa por un filtro antes de guardarse: se eliminan URLs, menciones de Discord, secuencias ANSI típicas de logs y líneas sin letras. Se colapsan espacios y se descartan mensajes que queden vacíos. El corpus deduplica por `(servidor, message_id)`.

El bot mantiene **dos corpus independientes**:
- **Servidor** — para respuestas generales (`/generar`, auto-reply)
- **Por usuario** — exclusivo para `/imitar`

</details>

<details>
<summary><b>⚡ Generación automática</b></summary>

Cada **15 mensajes nuevos** insertados en el corpus de un canal, el bot genera una respuesta. Con un **35 % de probabilidad** envía un GIF aleatorio de la colección en lugar del texto.

La caché del modelo Markov se invalida automáticamente cada **50 inserciones** para mantenerse actualizada.

</details>

<details>
<summary><b>💬 Auto-reply (chatmode)</b></summary>

Si el modo está activo, el bot responde cuando:
- Lo mencionan con `@bot`
- Alguien le hace reply a uno de sus mensajes

Se puede restringir a un canal específico con `/chatmode on #canal`. Requiere el permiso **Gestionar servidor**.

</details>

<details>
<summary><b>🎞️ Colección de GIFs</b></summary>

Los GIFs detectados en mensajes (Tenor, Giphy, adjuntos `.gif`) se guardan automáticamente. Los de `cdn.discordapp.com` se suben a **Cloudflare R2** para que no caduquen cuando Discord elimine el adjunto original.

</details>

<details>
<summary><b>🎯 Pool de imágenes</b></summary>

Al reaccionar con **🎯** a un mensaje con imagen (`.png`, `.jpg`, `.jpeg`, `.webp`), el bot sube la imagen a **R2** (si está configurado) y guarda su URL en la base de datos para usarla luego en `/momo` y en los memes automáticos.

</details>

<details>
<summary><b>😄 Reacción aleatoria</b></summary>

Con un **5 % de probabilidad**, el bot reacciona a mensajes con un emoji custom del servidor.

</details>

<details>
<summary><b>📺 Notificaciones de YouTube</b></summary>

Una tarea en segundo plano sondea el RSS de cada canal suscrito cada **15 minutos**. Si detecta un video nuevo, envía un mensaje en el canal de Discord configurado con el título, enlace y mención al rol (si está configurado).

</details>

---

## 🏗️ Estructura del proyecto

```
.
├── src/
│   ├── bot.py         # Lógica principal, eventos y slash commands
│   ├── db.py          # Capa de datos: aiosqlite, WAL mode, migraciones
│   └── __init__.py
├── data/
│   └── bot.db         # Base de datos SQLite (generada al arrancar)
├── requirements.txt
├── .env.example
└── .gitignore
```

---

## 🔐 Permisos necesarios

Al generar el enlace de invitación en el **Developer Portal**:

| Categoría | Valores requeridos |
|---|---|
| **OAuth2 Scopes** | `bot`, `applications.commands` |
| **Permisos de bot** | `Read Messages` · `Send Messages` · `Read Message History` · `Add Reactions` · `Embed Links` |
| **Intents privilegiados** | `Message Content Intent` · `Server Members Intent` |

---

## 📝 Notas

> **Los slash commands tardan hasta 1 hora** en propagarse globalmente. Para verlos al instante en desarrollo, pon `GUILD_ID=<id>` en `.env`.

> El modelo Markov necesita al menos **50 mensajes** en el corpus del servidor para generar respuestas, y **30** para `/imitar`.

> La base de datos usa **modo WAL** para mejor concurrencia entre lecturas y escrituras asíncronas.

> Si los slash commands no aparecen después de reiniciar, verifica que el bot esté invitado con el scope `applications.commands`.
