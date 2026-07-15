import { apiFetch } from '../core/api.js';
import { el, spinner, emptyState, flash, renderError, delBtn } from '../core/dom.js';
import { GUILD_ID } from '../core/config.js';
import { content } from '../panel-shell.js';

export async function loadReacciones() {
  const box = content();
  box.append(spinner());
  try {
    const data = await apiFetch(`/api/server/${GUILD_ID}/settings/reacciones`);
    box.innerHTML = '';
    box.append(el('p', { class: 'dim' }, 'Colección de emojis con los que el bot reacciona al azar:'));
    const list = el('ul', { class: 'item-list' });
    if (!data.reactions.length) box.append(emptyState('Todavía no has agregado ningún emoji de reacción.'));
    for (const r of data.reactions) {
      list.append(el('li', {},
        el('span', {}, r.emoji_text),
        delBtn(box, () => apiFetch(`/api/server/${GUILD_ID}/settings/reacciones/${r.id}`, { method: 'DELETE' }), loadReacciones)));
    }
    const input = el('input', { type: 'text', placeholder: 'Emoji (😀 o <:nombre:id>)', maxlength: '64' });
    box.append(list, el('div', { class: 'add-row' }, input,
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const emoji = input.value.trim();
          if (!emoji) return;
          try {
            await apiFetch(`/api/server/${GUILD_ID}/settings/reacciones`, {
              method: 'POST', body: { emoji },
            });
            loadReacciones();
          } catch (e) { flash(box, false, e.message); }
        },
      }, 'Agregar')));
  } catch (e) { renderError(box, e); }
}
