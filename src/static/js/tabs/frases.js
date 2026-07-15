import { apiFetch } from '../core/api.js';
import { el, spinner, emptyState, flash, renderError, delBtn } from '../core/dom.js';
import { GUILD_ID } from '../core/config.js';
import { content } from '../panel-shell.js';

export async function loadFrases() {
  const box = content();
  box.append(spinner());
  try {
    const data = await apiFetch(`/api/server/${GUILD_ID}/settings/frases`);
    box.innerHTML = '';
    box.append(el('p', { class: 'dim' }, 'Frases especiales que el bot puede enviar de vez en cuando:'));
    const list = el('ul', { class: 'item-list' });
    if (!data.frases.length) box.append(emptyState('Todavía no has agregado ninguna frase especial.'));
    for (const f of data.frases) {
      list.append(el('li', {},
        el('span', {}, f.frase),
        delBtn(box, () => apiFetch(`/api/server/${GUILD_ID}/settings/frases/${f.id}`, { method: 'DELETE' }), loadFrases)));
    }
    const textarea = el('textarea', { placeholder: 'Nueva frase…', maxlength: '300' });
    box.append(list,
      el('div', { class: 'field' }, textarea),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const frase = textarea.value.trim();
          if (!frase) return;
          try {
            await apiFetch(`/api/server/${GUILD_ID}/settings/frases`, {
              method: 'POST', body: { frase },
            });
            loadFrases();
          } catch (e) { flash(box, false, e.message); }
        },
      }, 'Agregar'));
  } catch (e) { renderError(box, e); }
}
