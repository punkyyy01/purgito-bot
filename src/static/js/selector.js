// Selector de servidores (/servers): initSelector() lista los guilds
// configurados y los disponibles para invitar.

import { apiFetch } from './core/api.js';
import { el, guildIcon, renderError } from './core/dom.js';

export async function initSelector() {
  const conf = document.getElementById('configured');
  const avail = document.getElementById('available');
  try {
    const data = await apiFetch('/api/me/guilds');
    conf.innerHTML = '';
    if (!data.configured.length) {
      conf.append(el('p', { class: 'dim' }, 'Purgito todavía no está en ninguno de tus servidores.'));
    }
    for (const g of data.configured) conf.append(guildCard(g, true));
    avail.innerHTML = '';
    if (!data.available.length) {
      avail.append(el('p', { class: 'dim' }, 'Purgito ya está en todos tus servidores.'));
    }
    for (const g of data.available) avail.append(guildCard(g, false));
  } catch (e) {
    renderError(conf, e);
  }
}

// Share pendiente (link /share/{id}): viene en ?share= al llegar del link, y
// queda en sessionStorage tras cargarse en un panel — así volver al selector y
// elegir OTRO servidor no pierde el embed compartido (no depende de la URL).
function pendingShareId() {
  return new URLSearchParams(location.search).get('share')
    || sessionStorage.getItem('purgito_share_id');
}

function guildCard(g, configured) {
  const info = el('div', { class: 'card-info' },
    el('div', { class: 'card-name' }, g.name,
      configured && g.is_premium ? el('span', { class: 'badge badge-premium' }, 'PREMIUM') : null),
    el('div', { class: 'card-sub' },
      configured
        ? (g.member_count != null ? g.member_count + ' miembros' : '')
        : 'Purgito no está aquí'));
  const share = configured ? pendingShareId() : null;
  const btn = configured
    ? el('a', {
        class: 'btn btn-primary',
        href: '/server/' + g.id + (share ? '/embeds?share=' + encodeURIComponent(share) : ''),
      }, 'Configurar')
    : el('a', { class: 'btn btn-primary', href: g.invite_url, target: '_blank', rel: 'noopener' }, 'Invitar');
  return el('div', { class: 'card' }, guildIcon(g), info, btn);
}
