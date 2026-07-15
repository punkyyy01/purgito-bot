import { apiFetch } from '../core/api.js';
import { el, spinner, emptyState, flash, renderError, delBtn, icon } from '../core/dom.js';
import { GUILD_ID } from '../core/config.js';
import { getChannels, channelSelect, content, activate } from '../panel-shell.js';

export async function loadMemes() {
  const box = content();
  box.append(spinner());
  let data;
  try {
    data = await apiFetch(`/api/server/${GUILD_ID}/settings/memes`);
  } catch (e) {
    box.innerHTML = '';
    if (e.premium) {
      box.append(el('div', { class: 'premium-card' },
        el('h2', {}, icon('star'), el('span', {}, 'Función premium')),
        el('p', { class: 'dim' },
          'Los memes programados están disponibles solo para servidores premium.'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => activate('premium', true),
        }, 'Ver planes premium')));
    } else {
      renderError(box, e);
    }
    return;
  }
  try {
    const channels = await getChannels();
    box.innerHTML = '';
    box.append(el('p', { class: 'dim' }, 'Canales con memes programados:'));
    const list = el('ul', { class: 'item-list' });
    if (!data.schedules.length) box.append(emptyState('No hay memes programados en ningún canal todavía.'));
    for (const s of data.schedules) {
      list.append(el('li', {},
        el('span', {}, `#${s.channel_name || s.channel_id} — cada ${s.interval_hours} h`),
        delBtn(box, () => apiFetch(`/api/server/${GUILD_ID}/settings/memes/${s.channel_id}`, { method: 'DELETE' }), loadMemes)));
    }
    const sel = channelSelect(channels, null, 'Elegir canal…');
    const hours = el('input', { type: 'number', min: '2', max: '24', value: '6', style: 'width:90px' });
    box.append(list, el('div', { class: 'add-row' }, sel, hours,
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const h = parseInt(hours.value, 10);
          if (!sel.value || !(h >= 2 && h <= 24)) {
            flash(box, false, 'Elige un canal y un intervalo entre 2 y 24 horas');
            return;
          }
          try {
            await apiFetch(`/api/server/${GUILD_ID}/settings/memes`, {
              method: 'POST', body: { channel_id: sel.value, interval_hours: h },
            });
            loadMemes();
          } catch (e) { flash(box, false, e.message); }
        },
      }, 'Agregar')));
  } catch (e) { renderError(box, e); }
}
