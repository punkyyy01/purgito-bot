# Contribuir a bot-discord-purg

¡Gracias por querer aportar! Acá está todo lo que necesitás saber para trabajar localmente.

## Setup local

### Requisitos

- Python 3.11+
- Una cuenta de Discord con un bot creado en el [Portal de Desarrolladores](https://discord.com/developers/applications)
- (Opcional) Cuenta de Cloudflare con un bucket R2 para los GIFs
- (Opcional) FFmpeg instalado para reproducción de música

### Pasos

1. **Fork y cloná el repo**
```bash
   git clone https://github.com/<tu-usuario>/bot-discord-purg.git
   cd bot-discord-purg
```

2. **Creá un entorno virtual e instalá dependencias**
```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
```

3. **Configurá las variables de entorno**
   Copiá el archivo de ejemplo y completá tus valores:
```bash
   cp .env.example .env
```
   Editá `.env` con tus credenciales (ver sección "Variables de entorno" en el README).

4. **Correlo localmente**
```bash
   python src/bot.py
```

## Convenciones

- **Ramas:** `feat/nombre-feature`, `fix/descripcion-bug`, `chore/tarea`
- **Commits:** mensajes en minúscula con prefijo: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- **Código:** seguir el estilo existente; no romper comandos actuales del bot
- **PRs:** completar el template, describir qué cambiaste y cómo probarlo

## Reportar bugs

Usá los [issue templates](.github/ISSUE_TEMPLATE/) del repo.

## ¿Preguntas?

Abrí una discusión o un issue con el tag `question`.
