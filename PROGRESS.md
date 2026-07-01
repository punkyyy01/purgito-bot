# Progress Log

## Estado actual

- Repositorio: `/home/frambuesa/Proyectos/ProyectosP/purgito-bot`
- Startup: `python src/bot.py`
- Servidor de galería: corre en el mismo proceso en `0.0.0.0:8080`
- Deploy: systemd unit `bot-purg`
- Documentación principal: README, CHANGELOG y PROGRESS actualizados con el estado real del bot

## Session Log

### Session 001 — 2026-06
- **Goal**: Bot base funcional para PURG4TORY
- **Completed**: Comandos slash, sistema de GIFs con R2, galería pública, cadenas de Markov, música con yt-dlp

### Session 002 — 2026-06
- **Goal**: Expandir funcionalidades del bot
- **Completed**: Sistema de memes (Pillow + Groq), pool de imágenes con 🎯, memes automáticos, frases especiales, pool de reacciones, notificaciones de YouTube, chatmode, imitación de usuarios, canales ignorados, panel `/settings`, onboarding `/setup`, embed de bienvenida
- **Next**: Agregar tests unitarios, dockerización, mejorar cobertura de documentación técnica
