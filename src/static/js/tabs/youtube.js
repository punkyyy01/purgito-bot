import { apiFetch } from '../core/api.js';
import { el, spinner, flash, renderError, delBtn } from '../core/dom.js';
import { GUILD_ID } from '../core/config.js';
import { getChannels, getRoles, channelSelect, roleSelect, content } from '../panel-shell.js';

export function extractYoutubeId(raw) {
  // Acepta el ID pelado o una URL tipo youtube.com/channel/UCxxxx.
  const m = raw.match(/channel\/([\w-]+)/);
  return m ? m[1] : raw;
}

export async function loadYouTube() {
  const box = content();
  box.append(spinner());
  try {
    const [data, channels, roles] = await Promise.all([
      apiFetch(`/api/server/${GUILD_ID}/settings/youtube`), getChannels(), getRoles()]);
    box.innerHTML = '';
    box.append(el('p', { class: 'dim' }, 'Canales de YouTube anunciados cuando publican videos:'));
    const list = el('ul', { class: 'item-list' });
    if (!data.subs.length) list.append(el('li', {}, el('span', { class: 'dim' }, 'Ninguna suscripción')));
    for (const s of data.subs) {
      const rSel = roleSelect(roles, s.mention_role_id, 'Sin rol de mención');
      rSel.onchange = async () => {
        try {
          await apiFetch(`/api/server/${GUILD_ID}/settings/youtube/${encodeURIComponent(s.youtube_channel_id)}/mention`, {
            method: 'PUT', body: { role_id: rSel.value || null },
          });
          flash(box, true, 'Rol de mención actualizado');
        } catch (e) { flash(box, false, e.message); }
      };
      list.append(el('li', {},
        el('span', {}, `${s.youtube_channel_name} → #${s.discord_channel_name || s.discord_channel_id}`),
        rSel,
        delBtn(box, () => apiFetch(`/api/server/${GUILD_ID}/settings/youtube/${encodeURIComponent(s.youtube_channel_id)}`, { method: 'DELETE' }), loadYouTube)));
    }
    const idInput = el('input', { type: 'text', placeholder: 'URL o ID del canal de YouTube' });
    const nameInput = el('input', { type: 'text', placeholder: 'Nombre del canal' });
    const chSel = channelSelect(channels, null, 'Canal de Discord…');
    const roleSel = roleSelect(roles, null, 'Rol de mención (opcional)');
    box.append(list, el('div', { class: 'add-row' }, idInput, nameInput, chSel, roleSel,
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const ytId = extractYoutubeId(idInput.value.trim());
          const ytName = nameInput.value.trim();
          if (!ytId || !ytName || !chSel.value) {
            flash(box, false, 'Completa el canal de YouTube, el nombre y el canal de Discord');
            return;
          }
          try {
            await apiFetch(`/api/server/${GUILD_ID}/settings/youtube`, {
              method: 'POST',
              body: { youtube_channel_id: ytId, youtube_channel_name: ytName, discord_channel_id: chSel.value },
            });
            if (roleSel.value) {
              await apiFetch(`/api/server/${GUILD_ID}/settings/youtube/${encodeURIComponent(ytId)}/mention`, {
                method: 'PUT', body: { role_id: roleSel.value },
              });
            }
            loadYouTube();
          } catch (e) { flash(box, false, e.message); }
        },
      }, 'Agregar')));
  } catch (e) { renderError(box, e); }
}
