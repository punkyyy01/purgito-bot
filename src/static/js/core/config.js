// Estado global compartido del panel: el guild activo y los caches de
// roles/canales/emojis que varios módulos leen. main-panel.js llama a
// setGuildId() al arrancar (lee el data-guild-id del <script>), antes de que
// cualquier función que use GUILD_ID corra.
//
// Los caches viven acá (y no en panel-shell.js, que es quien los llena vía
// getChannels/getRoles) para que core/markdown.js pueda leer roleCache/
// channelCache sin importar de panel-shell y armar un ciclo innecesario.
// Se exponen como `export let` (binding vivo de lectura) + un setter, porque
// un módulo importador no puede reasignar un binding importado.

export let GUILD_ID = null;
export function setGuildId(id) { GUILD_ID = id; }

export let channelCache = null;
export let roleCache = null;
export let emojiCache = null;
export function setChannelCache(v) { channelCache = v; }
export function setRoleCache(v) { roleCache = v; }
export function setEmojiCache(v) { emojiCache = v; }
