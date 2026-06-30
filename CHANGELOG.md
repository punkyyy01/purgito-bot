# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

## [Unreleased]

### Added
- Sistema de servidores premium: tabla `premium_guilds`, comandos `/premium add|quitar|lista` (solo bot owner, funcionan por DM). Las features restringidas (memos, pool de imágenes, frases especiales, reacciones) siguen siempre activas en PURGATORY_GUILD_ID hardcodeado; para otros servidores se controla desde la tabla. `HOME_GUILD_ID` se migra automáticamente a la tabla en el primer arranque.
- Limpieza diferida de datos al salir de un servidor: `on_guild_remove` registra la salida en `guild_departures`; task diaria purga datos (DB + R2) después de `GUILD_DATA_RETENTION_DAYS` (default 30). Reinvitar al bot dentro del período cancela el borrado.
- Límites de almacenamiento por servidor: `MAX_CORPUS_MESSAGES_PER_GUILD` (50k), `MAX_USER_CORPUS_MESSAGES_PER_GUILD` (20k total del guild), `MAX_GIFS_PER_GUILD` (300), `MAX_IMAGES_PER_GUILD` (200) — eviction del registro más viejo al insertar uno nuevo, con limpieza de R2 cuando aplica.
- Límite de tamaño de GIF antes de subir a R2: `MAX_GIF_DOWNLOAD_BYTES` (8MB default); GIFs más grandes se descartan silenciosamente sin guardar la URL en la DB.
- Mensaje de bienvenida en `on_guild_join` adaptado: servidores no-premium no ven referencias a `/momo`, 🎯 ni memes. `/help` marca con ⭐ las funciones premium.

### Changed
- `is_home_guild()` renombrado a `is_premium_guild()` y ahora consulta un `set` en memoria cargado al arrancar (sin hit a DB por evento/comando).
- `HOME_GUILD_ID` marcada como deprecada en `.env.example` — se sigue leyendo una vez para migrar, luego no tiene efecto en runtime.
- Frases especiales (`/añadir_frase`, `/ver_frases`, `/borrar_frase`) y pool de reacciones (`/reacciones add|quitar|lista`) liberados del gate premium; ahora disponibles en todos los servidores.

## [1.1.0] — 2026-06-28

### Added
- Generación de memes con `/momo` y `/meme` (Pillow + fuente Impact)
- Captions inteligentes con Groq (llama-4-scout) con fallback a Markov
- Pool de imágenes para memes: reacción 🎯 para guardar plantillas en R2
- Memes automáticos en canales configurables (`/meme_auto activar/desactivar/lista`)
- Pool de frases especiales (`/añadir_frase`, `/ver_frases`, `/borrar_frase`) con 5% de probabilidad y cooldown de 40 min
- Pool de reacciones configurables (`/reacciones add/quitar/lista`) — el bot reacciona al 5% de los mensajes
- Notificaciones de YouTube por RSS cada 15 min (`/youtube_add`, `/youtube_remove`, `/youtube_list`, `/youtube_set_mention`)
- Modo chat: auto-reply cuando mencionan al bot o le hacen reply (`/chatmode on/off`)
- Canales ignorados para el corpus (`/corpus_ignorar add/quitar/lista`)
- Imitación de usuarios individuales con `/imitar @usuario` (corpus por usuario)
- Embed de bienvenida al unirse a un servidor nuevo
- Trigger rápido por texto plano: reply a imagen + `<trigger> generar`

### Changed
- Motor Markov reemplazado por implementación propia (`SimpleMarkov`) sin dependencia de markovify en runtime
- Caché Markov se invalida automáticamente cada 50 inserciones

## [1.0.0] — 2026-06-01

### Added
- Bot base con discord.py y comandos slash
- Sistema de GIFs con almacenamiento en Cloudflare R2 y SQLite
- Galería pública de GIFs en https://gifs.purg4t0ry.com (aiohttp)
- Generación de texto con cadenas de Markov entrenadas en el corpus del servidor
- Reproducción de música con yt-dlp y FFmpeg
- Restricción de comandos al servidor home (PURG4TORY)
- Rate limiting por guild para respuestas especiales
- Clasificación de URLs de GIF: R2, Discord CDN, Giphy, Tenor (embeds)
- Reverse proxy con nginx + Cloudflare (SSL gratuito)

[Unreleased]: https://github.com/punkyyy01/bot-discord-purg/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/punkyyy01/bot-discord-purg/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/punkyyy01/bot-discord-purg/releases/tag/v1.0.0
