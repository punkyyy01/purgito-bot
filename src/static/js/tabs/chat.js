import { apiFetch } from '../core/api.js';
import { el, spinner, flash, renderError } from '../core/dom.js';
import { GUILD_ID } from '../core/config.js';
import { getChannels, channelSelect, content } from '../panel-shell.js';

export async function loadChat() {
  const box = content();
  box.append(spinner());
  try {
    const [data, channels] = await Promise.all([
      apiFetch(`/api/server/${GUILD_ID}/settings/chat`), getChannels()]);
    box.innerHTML = '';
    const check = el('input', { type: 'checkbox', checked: data.enabled });
    const sel = channelSelect(channels, data.channel_id, 'Todos los canales');
    box.append(
      el('div', { class: 'field' }, el('label', { class: 'toggle' }, check, 'Chat activado')),
      el('div', { class: 'field' }, el('label', {}, 'Canal donde responde'), sel),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            await apiFetch(`/api/server/${GUILD_ID}/settings/chat`, {
              method: 'PUT',
              body: { enabled: check.checked, channel_id: sel.value || null },
            });
            flash(box, true, 'Guardado');
          } catch (e) { flash(box, false, e.message); }
        },
      }, 'Guardar'));
  } catch (e) { renderError(box, e); }
}
