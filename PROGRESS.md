# Progress Log

## Estado actual

- Repositorio: `/bot-discord-purg`
- Startup: `python src/bot.py`
- Servidor de galería: corre en el mismo proceso en `0.0.0.0:8080`
- Deploy: DigitalOcean droplet Ubuntu, systemd unit `bot-purg`

## Session Log

### Session 001 — 2026-06
- **Goal**: Bot base funcional para PURG4TORY
- **Completed**: Comandos slash, sistema de GIFs con R2, galería pública, cadenas de Markov, música con yt-dlp

### Session 002 — 2026-06
- **Goal**: Expandir funcionalidades del bot
- **Completed**: Sistema de memes (Pillow + Groq), pool de imágenes con 🎯, memes automáticos, frases especiales, pool de reacciones, notificaciones de YouTube, chatmode, imitación de usuarios, canales ignorados, embed de bienvenida
- **Next**: Refactorizar `bot.py` en Cogs, agregar tests unitarios, dockerización
