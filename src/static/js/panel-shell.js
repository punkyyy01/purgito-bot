// Cascarón del panel por servidor (/server/{id}): navegación por categorías,
// caches de canales/roles, y el ruteo entre tabs sin recargar la página.

import { apiFetch } from './core/api.js';
import { el, icon, guildIcon } from './core/dom.js';
import {
  GUILD_ID, channelCache, setChannelCache, roleCache, setRoleCache,
} from './core/config.js';
import { loadChat } from './tabs/chat.js';
import { loadCorpus } from './tabs/corpus.js';
import { loadReacciones } from './tabs/reacciones.js';
import { loadFrases } from './tabs/frases.js';
import { loadYouTube } from './tabs/youtube.js';
import { loadMemes } from './tabs/memes.js';
import { loadGifs } from './tabs/gifs.js';
import { loadPremium } from './tabs/premium.js';
import { loadEmbeds, loadSharedEmbed } from './embeds/shared-ui.js';

const CATEGORIES = [
  { key: 'chat',       icon: 'chat',    label: 'Chat' },
  { key: 'corpus',     icon: 'corpus',  label: 'Corpus' },
  { key: 'reacciones', icon: 'smile',   label: 'Reacciones' },
  { key: 'frases',     icon: 'sparkle', label: 'Frases' },
  { key: 'youtube',    icon: 'play',    label: 'YouTube' },
  { key: 'embeds',     icon: 'layout',  label: 'Embeds' },
  { key: 'memes',      icon: 'image',   label: 'Memes', premium: true },
  { key: 'gifs',       icon: 'film',    label: 'GIFs' },
  { key: 'premium',    icon: 'star',    label: 'Premium' },
];

// Cacheados por la vida de la página (viven en core/config.js para que
// core/markdown.js pueda leerlos sin importar de acá).
export async function getChannels() {
  if (!channelCache) setChannelCache((await apiFetch(`/api/server/${GUILD_ID}/channels`)).channels);
  return channelCache;
}

export async function getRoles() {
  if (!roleCache) setRoleCache((await apiFetch(`/api/server/${GUILD_ID}/roles`)).roles);
  return roleCache;
}

export function channelSelect(channels, selectedId, noneLabel) {
  const sel = el('select', {});
  if (noneLabel !== undefined) sel.append(el('option', { value: '' }, noneLabel));
  for (const ch of channels) sel.append(el('option', { value: ch.id }, '#' + (ch.name || ch.id)));
  sel.value = selectedId || '';
  return sel;
}

export function roleSelect(roles, selectedId, noneLabel) {
  const sel = el('select', {});
  sel.append(el('option', { value: '' }, noneLabel));
  for (const r of roles) sel.append(el('option', { value: r.id }, '@' + r.name));
  sel.value = selectedId || '';
  return sel;
}

export function content() {
  const box = document.getElementById('catContent');
  box.innerHTML = '';
  return box;
}

export function currentCatFromUrl() {
  const key = location.pathname.split('/')[3] || 'chat';
  return CATEGORIES.some(c => c.key === key) ? key : 'chat';
}

export function initPanel() {
  const nav = document.getElementById('catNav');
  for (const c of CATEGORIES) {
    nav.append(el('div', {
      class: 'nav-item',
      'data-key': c.key,
      tabindex: '0',
      role: 'button',
      'aria-label': c.label,
      onclick: () => activate(c.key, true),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activate(c.key, true);
        }
      },
    },
      icon(c.icon),
      el('span', { class: 'nav-label' }, c.label),
      c.premium ? el('span', { class: 'badge badge-premium nav-label' }, 'PREMIUM') : null));
  }
  loadServerHead();
  const shareId = new URLSearchParams(location.search).get('share');
  if (shareId) loadSharedEmbed(shareId).finally(() => activate(currentCatFromUrl(), false));
  else activate(currentCatFromUrl(), false);
  window.onpopstate = () => activate(currentCatFromUrl(), false);
}

async function loadServerHead() {
  try {
    const data = await apiFetch('/api/me/guilds');
    const g = data.configured.find(x => x.id === GUILD_ID);
    if (!g) return;
    const head = document.getElementById('serverHead');
    head.innerHTML = '';
    head.append(guildIcon(g), el('span', { class: 'server-name' }, g.name));
  } catch (e) { /* el header es decorativo, no bloquea el panel */ }
}

const LOADERS = {
  chat: loadChat, corpus: loadCorpus, reacciones: loadReacciones,
  frases: loadFrases, youtube: loadYouTube, embeds: loadEmbeds,
  memes: loadMemes, gifs: loadGifs, premium: loadPremium,
};

export function activate(key, push) {
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.key === key));
  const cat = CATEGORIES.find(c => c.key === key);
  const title = document.getElementById('catTitle');
  title.innerHTML = '';
  title.append(icon(cat.icon), el('span', {}, cat.label));
  if (push) history.pushState({}, '', `/server/${GUILD_ID}/${key}`);
  LOADERS[key]();
}
