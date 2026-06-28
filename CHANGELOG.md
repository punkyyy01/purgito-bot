# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

## [Unreleased]

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
