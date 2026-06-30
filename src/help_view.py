"""
Nuevo /help para Purgito: embed intro + botones de navegación por categoría.

Integración en bot.py:
    from help_view import register_help_command
    ...
    register_help_command(bot)   # después de crear `bot`, antes de bot.run(...)

Si ya existe un @bot.tree.command(name="help", ...) en otro archivo, hay que
borrarlo (o renombrarlo) para evitar el error de comando duplicado al sincronizar.
"""

import discord

PURGITO_COLOR = 0x8B00FF  # color de marca usado en todo el proyecto (welcome embed, music_player.py)

INTRO_DESCRIPTION = (
    "**Purgito** es el bot del servidor: aprende a hablar como la comunidad "
    "usando cadenas de Markov entrenadas con los propios mensajes del server, "
    "reproduce música, guarda los GIFs que se comparten en una galería pública "
    "y avisa cuando tus creadores de YouTube favoritos suben contenido nuevo.\n\n"
    "Todos los comandos son **slash commands** (`/`) — escribí `/` en el chat y "
    "Discord te va a mostrar las opciones con autocompletado. La única excepción "
    "es `!ping`, que es un comando de texto clásico.\n\n"
    "Usá los botones de abajo para ver los comandos de cada sección."
)

CATEGORIES = {
    "musica": {
        "emoji": "🎵",
        "label": "Música",
        "title": "🎵 Música",
        "row": 0,
        "commands": [
            ("/play <query>", "reproduce o encola una canción"),
            ("/skip", "salta la canción actual"),
            ("/stop", "detiene y vacía la cola"),
            ("/pause · /resume", "pausa o reanuda"),
            ("/nowplaying", "muestra la canción actual"),
            ("/queue", "muestra la cola"),
            ("/volume <1-100>", "ajusta el volumen"),
            ("/loop", "alterna loop: off / canción / cola"),
            ("/shuffle", "mezcla la cola"),
            ("/leave", "sale del canal de voz"),
        ],
    },
    "chat": {
        "emoji": "🤖",
        "label": "Markov / Chat",
        "title": "🤖 Markov / Chat",
        "row": 0,
        "commands": [
            ("/generar", "genera un mensaje con Markov"),
            ("/imitar @usuario", "imita el estilo de un miembro"),
            ("/chatmode on|off [#canal]", "activa/desactiva auto-reply"),
            ("/corpus_info", "mensajes en el corpus del canal"),
            ("/añadir_frase <texto>", "agrega una frase especial al pool"),
            ("/ver_frases", "lista las frases especiales"),
            ("/borrar_frase <id>", "borra una frase especial"),
        ],
    },
    "memes": {
        "emoji": "😏",
        "label": "Memes ⭐",
        "title": "😏 Memes ⭐",
        "row": 0,
        "intro": "⭐ **Función premium** — no disponible en todos los servidores.",
        "commands": [
            ("/momo · /meme", "genera un meme del pool de imágenes"),
            ('Reply a una imagen + “generar”', "meme de esa imagen"),
            ("/meme_auto activar #canal <horas>", "memes automáticos"),
            ("/meme_auto desactivar #canal", "desactiva memes automáticos"),
            ("/meme_auto lista", "canales con memes automáticos"),
        ],
    },
    "youtube": {
        "emoji": "📺",
        "label": "YouTube",
        "title": "📺 YouTube",
        "row": 1,
        "commands": [
            ("/youtube_add <id> #canal [rol]", "suscribe un canal de YouTube"),
            ("/youtube_remove <id>", "elimina una suscripción"),
            ("/youtube_list", "lista suscripciones activas"),
            ("/youtube_set_mention <id> [rol]", "configura mención"),
        ],
    },
    "admin": {
        "emoji": "⚙️",
        "label": "Administración",
        "title": "⚙️ Administración",
        "row": 1,
        "commands": [
            ("/refeed", "importa mensajes del canal al corpus"),
            ("/refeed_all", "importa todos los canales"),
            ("/corpus_wipe", "borra el corpus del servidor"),
            ("/corpus_ignorar add|quitar|lista", "gestiona canales ignorados"),
            ("/gif_add <url>", "agrega un GIF a la colección ⭐"),
            ("/reacciones add|quitar|lista", "pool de emojis de reacción"),
            ("!ping", "verifica que el bot está online"),
        ],
    },
}


def build_intro_embed(guild_name: str) -> discord.Embed:
    embed = discord.Embed(
        title="📖 ¿Qué es Purgito?",
        description=INTRO_DESCRIPTION,
        color=PURGITO_COLOR,
    )
    embed.set_footer(text=f"Comandos disponibles en {guild_name} · usá los botones de abajo")
    return embed


def build_category_embed(key: str, guild_name: str) -> discord.Embed:
    cat = CATEGORIES[key]
    lines = []
    if "intro" in cat:
        lines.append(cat["intro"])
        lines.append("")
    for cmd, desc in cat["commands"]:
        lines.append(f"`{cmd}` — {desc}")
    embed = discord.Embed(title=cat["title"], description="\n".join(lines), color=PURGITO_COLOR)
    embed.set_footer(text=f"{guild_name} · /help para volver al inicio")
    return embed


class HelpView(discord.ui.View):
    def __init__(self, author_id: int, guild_name: str, timeout: float = 180.0):
        super().__init__(timeout=timeout)
        self.author_id = author_id
        self.guild_name = guild_name
        self.message: discord.Message | None = None

        home_button = discord.ui.Button(
            label="Inicio", emoji="🏠", style=discord.ButtonStyle.primary, row=0
        )
        home_button.callback = self._make_home_callback()
        self.add_item(home_button)

        for key, cat in CATEGORIES.items():
            button = discord.ui.Button(
                label=cat["label"],
                emoji=cat["emoji"],
                style=discord.ButtonStyle.secondary,
                row=cat["row"],
            )
            button.callback = self._make_category_callback(key)
            self.add_item(button)

    def _make_home_callback(self):
        async def callback(interaction: discord.Interaction):
            embed = build_intro_embed(self.guild_name)
            await interaction.response.edit_message(embed=embed, view=self)
        return callback

    def _make_category_callback(self, key: str):
        async def callback(interaction: discord.Interaction):
            embed = build_category_embed(key, self.guild_name)
            await interaction.response.edit_message(embed=embed, view=self)
        return callback

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Este menú lo abrió otra persona — usá `/help` para abrir el tuyo.",
                ephemeral=True,
            )
            return False
        return True

    async def on_timeout(self) -> None:
        for item in self.children:
            item.disabled = True
        if self.message:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass


def register_help_command(bot: discord.Client) -> None:
    @bot.tree.command(name="help", description="Muestra los comandos de Purgito y cómo usarlos.")
    async def help_slash(interaction: discord.Interaction):
        guild_name = interaction.guild.name if interaction.guild else "este servidor"
        embed = build_intro_embed(guild_name)
        view = HelpView(author_id=interaction.user.id, guild_name=guild_name)
        await interaction.response.send_message(embed=embed, view=view)
        view.message = await interaction.original_response()
