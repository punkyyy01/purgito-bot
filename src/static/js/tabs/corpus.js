import { apiFetch } from '../core/api.js';
import { el, spinner, emptyState, flash, renderError, delBtn } from '../core/dom.js';
import { GUILD_ID } from '../core/config.js';
import { getChannels, channelSelect, content } from '../panel-shell.js';

export async function loadCorpus() {
  const box = content();
  box.append(spinner());
  try {
    const [data, channels] = await Promise.all([
      apiFetch(`/api/server/${GUILD_ID}/settings/corpus`), getChannels()]);
    box.innerHTML = '';
    box.append(el('p', { class: 'dim' }, 'Canales que el bot ignora al aprender mensajes:'));
    const list = el('ul', { class: 'item-list' });
    if (!data.channels.length) box.append(emptyState('Todavía no has ignorado ningún canal — el bot aprende de todos.'));
    for (const ch of data.channels) {
      list.append(el('li', {},
        el('span', {}, '#' + (ch.name || ch.id)),
        delBtn(box, () => apiFetch(`/api/server/${GUILD_ID}/settings/corpus/${ch.id}`, { method: 'DELETE' }), loadCorpus)));
    }
    const ignored = new Set(data.channels.map(c => c.id));
    const sel = channelSelect(channels.filter(c => !ignored.has(c.id)), null, 'Elegir canal…');
    box.append(list, el('div', { class: 'add-row' }, sel,
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          if (!sel.value) return;
          try {
            await apiFetch(`/api/server/${GUILD_ID}/settings/corpus`, {
              method: 'POST', body: { channel_id: sel.value },
            });
            loadCorpus();
          } catch (e) { flash(box, false, e.message); }
        },
      }, 'Agregar')));
  } catch (e) { renderError(box, e); }
}
