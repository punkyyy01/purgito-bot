// Punto de entrada del módulo en /server/{id} (pages/panel.py).
// document.currentScript es null dentro de un módulo ES, así que el guild se
// lee del data-guild-id del propio <script> vía querySelector.
import { setGuildId } from './core/config.js';
import { initPanel } from './panel-shell.js';

const script = document.querySelector('script[data-guild-id]');
setGuildId(script ? script.dataset.guildId : '');
initPanel();
