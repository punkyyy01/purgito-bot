// Panel web de Purgito — vanilla JS, sin dependencias.
// initSelector() corre en /servers; initPanel() corre en /server/{id}.

// ---------- helpers ----------

async function apiFetch(url, options = {}) {
  const opts = { credentials: 'include', ...options };
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  let r;
  try {
    r = await fetch(url, opts);
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
  }
  if (r.status === 401) {
    location.href = '/auth/login';
    throw new Error('Sesión expirada.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error || humanError(r.status));
    err.status = r.status;
    err.premium = !!data.premium;
    throw err;
  }
  return data;
}

function humanError(status) {
  if (status === 429) return 'Estás haciendo demasiadas solicitudes — espera un momento e intenta de nuevo.';
  if (status >= 500) return 'Algo salió mal de nuestro lado. Intenta de nuevo en un rato.';
  if (status === 403) return 'No tienes permiso para hacer esto.';
  if (status === 404) return 'No se encontró lo que buscabas.';
  return 'No se pudo completar la solicitud (código ' + status + ').';
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node[k] = v;
    else if (k === 'checked' || k === 'value') node[k] = v;
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function spinner() { return el('div', { class: 'spinner' }); }

function emptyState(msg) { return el('div', { class: 'empty-state' }, msg); }

function flash(container, ok, msg) {
  const box = el('div', { class: 'flash ' + (ok ? 'flash-ok' : 'flash-err') }, msg);
  container.prepend(box);
  setTimeout(() => box.remove(), 3000);
}

// Toast flotante reusable (requiere <div id="toast"></div> en la página, ver
// pages/panel.py). Por ahora solo lo usa el tab de GIFs — flash() se queda
// para el resto de tabs, ver nota en la respuesta de este cambio.
let _toastTimer = null;
function toast(msg, type) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.className = 'show ' + (type || '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { box.className = ''; }, 3200);
}

function renderError(box, e) {
  box.innerHTML = '';
  box.append(el('p', { class: 'error' }, e.message));
}

function guildIcon(g) {
  if (g.icon_url) return el('img', { class: 'guild-icon', src: g.icon_url, alt: '' });
  return el('div', { class: 'guild-icon guild-initial' }, (g.name || '?').trim().charAt(0).toUpperCase());
}

function delBtn(box, fn, reload) {
  return el('button', {
    class: 'btn btn-danger btn-sm',
    onclick: async () => {
      try { await fn(); reload(); }
      catch (e) { flash(box, false, e.message); }
    },
  }, 'Quitar');
}

// ---------- selector de servidores (/servers) ----------

async function initSelector() {
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

function guildCard(g, configured) {
  const info = el('div', { class: 'card-info' },
    el('div', { class: 'card-name' }, g.name,
      configured && g.is_premium ? el('span', { class: 'badge badge-premium' }, 'PREMIUM') : null),
    el('div', { class: 'card-sub' },
      configured
        ? (g.member_count != null ? g.member_count + ' miembros' : '')
        : 'Purgito no está aquí'));
  const btn = configured
    ? el('a', { class: 'btn btn-primary', href: '/server/' + g.id }, 'Configurar')
    : el('a', { class: 'btn btn-primary', href: g.invite_url, target: '_blank', rel: 'noopener' }, 'Invitar');
  return el('div', { class: 'card' }, guildIcon(g), info, btn);
}

// ---------- panel por servidor (/server/{id}) ----------

// Íconos de línea (estilo Lucide, currentColor, viewBox 24). Se inyectan por
// innerHTML sobre un <span class="nav-icon">; el parser HTML del navegador crea
// los nodos SVG con el namespace correcto.
const ICONS = {
  chat:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  corpus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  smile:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  sparkle:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/></svg>',
  play:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>',
  image:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
  film:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>',
  star:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  layout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
  info:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

function icon(name) {
  const s = el('span', { class: 'nav-icon' });
  s.innerHTML = ICONS[name] || '';
  return s;
}

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

// Cacheados por la vida de la página.
let _channels = null;
let _roles = null;

async function getChannels() {
  if (!_channels) _channels = (await apiFetch(`/api/server/${GUILD_ID}/channels`)).channels;
  return _channels;
}

async function getRoles() {
  if (!_roles) _roles = (await apiFetch(`/api/server/${GUILD_ID}/roles`)).roles;
  return _roles;
}

function channelSelect(channels, selectedId, noneLabel) {
  const sel = el('select', {});
  if (noneLabel !== undefined) sel.append(el('option', { value: '' }, noneLabel));
  for (const ch of channels) sel.append(el('option', { value: ch.id }, '#' + (ch.name || ch.id)));
  sel.value = selectedId || '';
  return sel;
}

function roleSelect(roles, selectedId, noneLabel) {
  const sel = el('select', {});
  sel.append(el('option', { value: '' }, noneLabel));
  for (const r of roles) sel.append(el('option', { value: r.id }, '@' + r.name));
  sel.value = selectedId || '';
  return sel;
}

function content() {
  const box = document.getElementById('catContent');
  box.innerHTML = '';
  return box;
}

function currentCatFromUrl() {
  const key = location.pathname.split('/')[3] || 'chat';
  return CATEGORIES.some(c => c.key === key) ? key : 'chat';
}

function initPanel() {
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
  activate(currentCatFromUrl(), false);
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

function activate(key, push) {
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.key === key));
  const cat = CATEGORIES.find(c => c.key === key);
  const title = document.getElementById('catTitle');
  title.innerHTML = '';
  title.append(icon(cat.icon), el('span', {}, cat.label));
  if (push) history.pushState({}, '', `/server/${GUILD_ID}/${key}`);
  LOADERS[key]();
}

// ---------- Chat ----------

async function loadChat() {
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

// ---------- Corpus ----------

async function loadCorpus() {
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

// ---------- Reacciones ----------

async function loadReacciones() {
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

// ---------- Frases ----------

async function loadFrases() {
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

// ---------- YouTube ----------

function extractYoutubeId(raw) {
  // Acepta el ID pelado o una URL tipo youtube.com/channel/UCxxxx.
  const m = raw.match(/channel\/([\w-]+)/);
  return m ? m[1] : raw;
}

async function loadYouTube() {
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

// ---------- Embeds ----------

// Espejo de los límites de validate_embed_payload (webapi.py) para dar
// feedback inmediato sin esperar el 400 del server.
const EMBED_LIMITS = {
  title: 256, description: 4096, fields: 25, fieldName: 256,
  fieldValue: 1024, footer: 2048, author: 256, total: 6000,
};

let _embedTab = 'editor';
// Estado del editor: persiste al cambiar de sub-vista (así "Cargar en el
// editor" desde plantillas no se pierde al navegar).
let _embed = null;

function blankEmbed() {
  return {
    title: '', description: '', color: '#8B6EF5',
    authorName: '', authorIcon: '', footerText: '', footerIcon: '',
    thumbnail: '', image: '', fields: [], templateId: null, templateName: '',
  };
}

// Estado del formulario -> dict de embed estilo API de Discord (solo lo no vacío).
function embedDict(s) {
  const e = {};
  if (s.title.trim()) e.title = s.title.trim();
  if (s.description.trim()) e.description = s.description.trim();
  if (s.color) e.color = s.color; // hex "#RRGGBB"; el backend lo convierte a int
  if (s.authorName.trim()) {
    e.author = { name: s.authorName.trim() };
    if (s.authorIcon.trim()) e.author.icon_url = s.authorIcon.trim();
  }
  if (s.footerText.trim()) {
    e.footer = { text: s.footerText.trim() };
    if (s.footerIcon.trim()) e.footer.icon_url = s.footerIcon.trim();
  }
  if (s.thumbnail.trim()) e.thumbnail = { url: s.thumbnail.trim() };
  if (s.image.trim()) e.image = { url: s.image.trim() };
  const fields = s.fields
    .filter(f => f.name.trim() && f.value.trim())
    .map(f => ({ name: f.name.trim(), value: f.value.trim(), inline: !!f.inline }));
  if (fields.length) e.fields = fields;
  return e;
}

// Inverso: dict de embed guardado -> estado del formulario.
function embedToState(e, templateId, templateName) {
  const s = blankEmbed();
  s.title = e.title || '';
  s.description = e.description || '';
  if (typeof e.color === 'number') s.color = '#' + e.color.toString(16).padStart(6, '0');
  else if (typeof e.color === 'string') s.color = e.color;
  s.authorName = (e.author && e.author.name) || '';
  s.authorIcon = (e.author && e.author.icon_url) || '';
  s.footerText = (e.footer && e.footer.text) || '';
  s.footerIcon = (e.footer && e.footer.icon_url) || '';
  s.thumbnail = (e.thumbnail && e.thumbnail.url) || '';
  s.image = (e.image && e.image.url) || '';
  s.fields = (e.fields || []).map(f => ({ name: f.name || '', value: f.value || '', inline: !!f.inline }));
  s.templateId = templateId || null;
  s.templateName = templateName || '';
  return s;
}

function validateEmbedClient(e) {
  if ((e.title || '').length > EMBED_LIMITS.title) return `El título supera los ${EMBED_LIMITS.title} caracteres.`;
  if ((e.description || '').length > EMBED_LIMITS.description) return `La descripción supera los ${EMBED_LIMITS.description} caracteres.`;
  const fields = e.fields || [];
  if (fields.length > EMBED_LIMITS.fields) return `Máximo ${EMBED_LIMITS.fields} fields.`;
  let total = (e.title || '').length + (e.description || '').length
    + ((e.footer && e.footer.text) || '').length + ((e.author && e.author.name) || '').length;
  for (const f of fields) {
    if (f.name.length > EMBED_LIMITS.fieldName) return `Un field tiene el nombre demasiado largo (máx ${EMBED_LIMITS.fieldName}).`;
    if (f.value.length > EMBED_LIMITS.fieldValue) return `Un field tiene el valor demasiado largo (máx ${EMBED_LIMITS.fieldValue}).`;
    total += f.name.length + f.value.length;
  }
  if (((e.footer && e.footer.text) || '').length > EMBED_LIMITS.footer) return `El footer supera los ${EMBED_LIMITS.footer} caracteres.`;
  if (((e.author && e.author.name) || '').length > EMBED_LIMITS.author) return `El autor supera los ${EMBED_LIMITS.author} caracteres.`;
  if (total > EMBED_LIMITS.total) return `El embed supera los ${EMBED_LIMITS.total} caracteres en total.`;
  if (!e.title && !e.description && !fields.length && !e.image && !e.thumbnail && !e.author && !e.footer) {
    return 'El embed está vacío: completa al menos un campo.';
  }
  return null;
}

// Imagen que se oculta sola si la URL no carga (igual que hace Discord).
function embedImg(attrs) {
  const img = el('img', attrs);
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

// Preview puro HTML/CSS de un embed de Discord; sin llamada al backend.
function renderEmbedPreview(e) {
  if (!Object.keys(e).length) return emptyState('El preview aparece aquí a medida que completas el formulario.');
  const main = el('div', { class: 'd-embed-main' });
  if (e.author) {
    main.append(el('div', { class: 'd-embed-author' },
      e.author.icon_url ? embedImg({ src: e.author.icon_url, alt: '' }) : null,
      e.author.name));
  }
  if (e.title) main.append(el('div', { class: 'd-embed-title' }, e.title));
  if (e.description) main.append(el('div', { class: 'd-embed-desc' }, e.description));
  if (e.fields) {
    const grid = el('div', { class: 'd-embed-fields' });
    for (const f of e.fields) {
      grid.append(el('div', { class: 'd-embed-field' + (f.inline ? ' inline' : '') },
        el('div', { class: 'd-embed-field-name' }, f.name),
        el('div', { class: 'd-embed-field-value' }, f.value)));
    }
    main.append(grid);
  }
  const body = el('div', { class: 'd-embed-body' }, main);
  if (e.thumbnail) body.append(el('div', { class: 'd-embed-thumb' }, embedImg({ src: e.thumbnail.url, alt: '' })));
  if (e.image) body.append(el('div', { class: 'd-embed-image' }, embedImg({ src: e.image.url, alt: '' })));
  if (e.footer) {
    body.append(el('div', { class: 'd-embed-footer' },
      e.footer.icon_url ? embedImg({ src: e.footer.icon_url, alt: '' }) : null,
      e.footer.text));
  }
  const color = typeof e.color === 'string' ? e.color : '#8B6EF5';
  return el('div', { class: 'd-embed' },
    el('div', { class: 'd-embed-bar', style: 'background:' + color }), body);
}

async function loadEmbeds() {
  const box = content();
  const tabs = el('div', { class: 'embed-tabs' },
    el('div', { class: 'embed-tab' + (_embedTab === 'editor' ? ' active' : ''), onclick: () => { _embedTab = 'editor'; loadEmbeds(); } }, 'Crear / Enviar'),
    el('div', { class: 'embed-tab' + (_embedTab === 'templates' ? ' active' : ''), onclick: () => { _embedTab = 'templates'; loadEmbeds(); } }, 'Mis plantillas'));
  const view = el('div', {});
  box.append(tabs, view);
  if (_embedTab === 'editor') await renderEmbedEditor(view);
  else await renderEmbedTemplates(view);
}

async function renderEmbedEditor(box) {
  box.append(spinner());
  let channels;
  try { channels = await getChannels(); }
  catch (e) { renderError(box, e); return; }
  box.innerHTML = '';

  if (!_embed) _embed = blankEmbed();
  const s = _embed;

  const previewBox = el('div', {});
  function updatePreview() {
    previewBox.innerHTML = '';
    previewBox.append(renderEmbedPreview(embedDict(s)));
  }

  function bound(tag, key, attrs) {
    const node = el(tag, { ...attrs, value: s[key] });
    if (tag === 'textarea') node.value = s[key];
    node.oninput = () => { s[key] = node.value; updatePreview(); };
    return node;
  }

  function fieldBlock(label, node) {
    return el('div', { class: 'field' }, el('label', {}, label), node);
  }

  // --- fields dinámicos ---
  const fieldsBox = el('div', {});
  const addFieldBtn = el('button', {
    class: 'btn btn-secondary btn-sm',
    onclick: () => { s.fields.push({ name: '', value: '', inline: false }); renderFields(); updatePreview(); },
  }, '+ Agregar field');

  function renderFields() {
    fieldsBox.innerHTML = '';
    s.fields.forEach((f, i) => {
      const name = el('input', { type: 'text', placeholder: 'Nombre', maxlength: String(EMBED_LIMITS.fieldName), value: f.name });
      name.oninput = () => { f.name = name.value; updatePreview(); };
      const value = el('input', { type: 'text', placeholder: 'Valor', maxlength: String(EMBED_LIMITS.fieldValue), value: f.value });
      value.oninput = () => { f.value = value.value; updatePreview(); };
      const inline = el('input', { type: 'checkbox', checked: f.inline });
      inline.onchange = () => { f.inline = inline.checked; updatePreview(); };
      fieldsBox.append(el('div', { class: 'embed-field-row' },
        name, value,
        el('label', { class: 'toggle' }, inline, 'inline'),
        el('button', {
          class: 'btn btn-danger btn-sm',
          onclick: () => { s.fields.splice(i, 1); renderFields(); updatePreview(); },
        }, '✗')));
    });
    addFieldBtn.disabled = s.fields.length >= EMBED_LIMITS.fields;
  }
  renderFields();

  // --- destino y modo de envío ---
  const chSel = channelSelect(channels, null, 'Canal destino…');
  const modeNow = el('input', { type: 'radio', name: 'embedMode', checked: true });
  const modeSched = el('input', { type: 'radio', name: 'embedMode' });
  const schedType = el('select', {},
    el('option', { value: 'interval' }, 'Por intervalo'),
    el('option', { value: 'daily' }, 'A hora fija'));
  const intervalInput = el('input', { type: 'number', min: '5', max: '1440', value: '60', style: 'width:110px' });
  const timeInput = el('input', { type: 'time', value: '09:00' });
  const schedControls = el('div', { class: 'add-row', style: 'display:none;margin-top:8px' },
    schedType, intervalInput, timeInput);

  function syncSched() {
    schedControls.style.display = modeSched.checked ? '' : 'none';
    const daily = schedType.value === 'daily';
    intervalInput.style.display = daily ? 'none' : '';
    timeInput.style.display = daily ? '' : 'none';
    sendBtn.textContent = modeSched.checked ? 'Programar' : 'Enviar ahora';
  }
  modeNow.onchange = modeSched.onchange = schedType.onchange = syncSched;

  const sendBtn = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      const e = embedDict(s);
      const err = validateEmbedClient(e);
      if (err) { toast(err, 'err'); return; }
      if (!chSel.value) { toast('Elige un canal destino', 'err'); return; }
      try {
        if (modeSched.checked) {
          const body = { channel_id: chSel.value, embed: e, mode: schedType.value };
          if (schedType.value === 'interval') {
            body.interval_minutes = parseInt(intervalInput.value, 10);
          } else {
            const [h, m] = timeInput.value.split(':');
            body.hour = parseInt(h, 10); body.minute = parseInt(m, 10);
          }
          await apiFetch(`/api/server/${GUILD_ID}/embeds/schedule`, { method: 'POST', body });
          toast('Embed programado', 'ok');
        } else {
          await apiFetch(`/api/server/${GUILD_ID}/embeds/send`, { method: 'POST', body: { channel_id: chSel.value, embed: e } });
          toast('Embed enviado', 'ok');
        }
      } catch (err2) { toast(err2.message, err2.status === 429 ? 'warn' : 'err'); }
    },
  }, 'Enviar ahora');

  const saveBtn = el('button', {
    class: 'btn btn-secondary',
    onclick: async () => {
      const e = embedDict(s);
      const err = validateEmbedClient(e);
      if (err) { toast(err, 'err'); return; }
      const name = (prompt('Nombre de la plantilla:', s.templateName || '') || '').trim();
      if (!name) return;
      try {
        if (s.templateId) {
          await apiFetch(`/api/server/${GUILD_ID}/embeds/templates/${s.templateId}`, { method: 'PUT', body: { name, embed: e } });
          toast('Plantilla actualizada', 'ok');
        } else {
          const resp = await apiFetch(`/api/server/${GUILD_ID}/embeds/templates`, { method: 'POST', body: { name, embed: e } });
          s.templateId = resp.id;
          toast('Plantilla guardada', 'ok');
        }
        s.templateName = name;
      } catch (err2) { toast(err2.message, err2.status === 409 ? 'warn' : 'err'); }
    },
  }, 'Guardar como plantilla');

  const clearBtn = el('button', {
    class: 'btn btn-secondary',
    onclick: () => { _embed = blankEmbed(); loadEmbeds(); },
  }, 'Limpiar');

  const form = el('div', { class: 'embed-form' },
    fieldBlock('Título', bound('input', 'title', { type: 'text', maxlength: String(EMBED_LIMITS.title) })),
    fieldBlock('Descripción', bound('textarea', 'description', { maxlength: String(EMBED_LIMITS.description) })),
    fieldBlock('Color', bound('input', 'color', { type: 'color' })),
    el('div', { class: 'embed-two' },
      fieldBlock('Autor', bound('input', 'authorName', { type: 'text', maxlength: String(EMBED_LIMITS.author) })),
      fieldBlock('URL del ícono del autor', bound('input', 'authorIcon', { type: 'url', placeholder: 'https://…' }))),
    el('div', { class: 'embed-two' },
      fieldBlock('Footer', bound('input', 'footerText', { type: 'text', maxlength: String(EMBED_LIMITS.footer) })),
      fieldBlock('URL del ícono del footer', bound('input', 'footerIcon', { type: 'url', placeholder: 'https://…' }))),
    el('div', { class: 'embed-two' },
      fieldBlock('Thumbnail (URL)', bound('input', 'thumbnail', { type: 'url', placeholder: 'https://…' })),
      fieldBlock('Imagen grande (URL)', bound('input', 'image', { type: 'url', placeholder: 'https://…' }))),
    el('div', { class: 'field' }, el('label', {}, 'Fields'), fieldsBox, addFieldBtn),
    el('div', { class: 'field' }, el('label', {}, 'Canal destino'), chSel),
    el('div', { class: 'field' },
      el('label', { class: 'toggle' }, modeNow, 'Enviar ahora'),
      el('label', { class: 'toggle' }, modeSched, 'Programar'),
      schedControls),
    el('div', { class: 'add-row' }, sendBtn, saveBtn, clearBtn));

  box.append(el('div', { class: 'embed-layout' },
    form,
    el('div', { class: 'd-embed-wrap' }, el('p', { class: 'dim', style: 'margin-top:0' }, 'Preview'), previewBox)));
  updatePreview();
  syncSched();
}

async function renderEmbedTemplates(box) {
  box.append(spinner());
  let data;
  try { data = await apiFetch(`/api/server/${GUILD_ID}/embeds/templates`); }
  catch (e) { renderError(box, e); return; }
  box.innerHTML = '';

  box.append(el('p', { class: 'dim gif-stats' },
    el('strong', { class: 'stat-num' }, String(data.total)), ` / ${data.limit} plantillas usadas`));

  if (!data.templates.length) {
    box.append(emptyState('Todavía no hay plantillas guardadas — crea una desde "Crear / Enviar".'));
    return;
  }

  const list = el('ul', { class: 'item-list' });
  for (const t of data.templates) {
    const e = t.embed;
    const color = typeof e.color === 'number' ? '#' + e.color.toString(16).padStart(6, '0')
      : (typeof e.color === 'string' ? e.color : '#8B6EF5');
    const snippet = e.title || e.description || (e.fields && e.fields[0] && e.fields[0].name) || '(sin texto)';
    list.append(el('li', {},
      el('span', {},
        el('span', { class: 'tpl-dot', style: 'background:' + color }), ' ',
        el('strong', {}, t.name), ' — ',
        el('span', { class: 'dim' }, snippet.slice(0, 60))),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: () => { _embed = embedToState(e, t.id, t.name); _embedTab = 'editor'; loadEmbeds(); },
      }, 'Cargar en el editor'),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: async () => {
          const name = (prompt('Nuevo nombre:', t.name) || '').trim();
          if (!name || name === t.name) return;
          try {
            await apiFetch(`/api/server/${GUILD_ID}/embeds/templates/${t.id}`, { method: 'PUT', body: { name, embed: e } });
            loadEmbeds();
          } catch (err) { toast(err.message, 'err'); }
        },
      }, 'Renombrar'),
      el('button', {
        class: 'btn btn-danger btn-sm',
        onclick: async () => {
          if (!confirm(`¿Eliminar la plantilla "${t.name}"?`)) return;
          try {
            await apiFetch(`/api/server/${GUILD_ID}/embeds/templates/${t.id}`, { method: 'DELETE' });
            toast('Plantilla eliminada', 'ok');
            loadEmbeds();
          } catch (err) { toast(err.message, 'err'); }
        },
      }, 'Eliminar')));
  }
  box.append(list);
}

// ---------- Memes (premium) ----------

async function loadMemes() {
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

// ---------- Premium ----------

function checkoutBtn(box, plan, label) {
  return el('button', {
    class: 'btn btn-primary',
    onclick: async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const data = await apiFetch(`/api/server/${GUILD_ID}/premium/checkout`, {
          method: 'POST', body: { plan },
        });
        window.location.href = data.checkout_url;
      } catch (e) {
        btn.disabled = false;
        flash(box, false, e.message);
      }
    },
  }, label);
}

async function loadPremium() {
  const box = content();
  box.append(spinner());
  try {
    const data = await apiFetch(`/api/server/${GUILD_ID}/premium`);
    box.innerHTML = '';
    const premiumRows = [
      ['Memes automáticos programados', 'No disponible', 'Disponible'],
      ['Mensajes guardados en memoria (corpus)', '15.000', '50.000'],
      ['Mensajes de usuario en memoria', '5.000', '20.000'],
      ['GIFs guardados', '1.500', '4.000'],
      ['Imágenes en la colección de memes', '75', '200'],
    ];
    if (data.premium) {
      box.append(el('div', { class: 'premium-layout' },
        el('div', { class: 'premium-card premium-card-wide' },
          el('h2', {}, icon('star'), el('span', {}, 'Premium activo')),
          el('p', { class: 'dim' },
            'Este servidor tiene acceso a todas las funciones premium.',
            data.note ? ` Plan: ${data.note}.` : ''),
          el('ul', { class: 'premium-receipt' },
            el('li', {}, 'Memes automáticos programados desbloqueados'),
            el('li', {}, 'Límites de corpus ampliados a 50.000 mensajes'),
            el('li', {}, 'Límite de corpus de usuario ampliado a 20.000 mensajes'),
            el('li', {}, 'Límite de GIFs guardados ampliado a 4.000'),
            el('li', {}, 'Colección de memes ampliada a 200 imágenes')))));
      return;
    }
    const cardWide = el('div', { class: 'premium-card premium-card-wide' },
      el('h2', {}, icon('star'), el('span', {}, 'Activa premium')),
      el('p', { class: 'dim' },
        'Desbloquea las funciones premium de Purgito en este servidor. El pago se procesa en Polar y el premium se activa automáticamente al completarlo.'),
      el('table', { class: 'premium-comparison' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Beneficio'),
          el('th', {}, 'Free'),
          el('th', { class: 'premium-column' }, 'Premium'))),
        el('tbody', {}, premiumRows.map(([benefit, free, premium]) =>
          el('tr', {},
            el('th', { scope: 'row' }, benefit),
            el('td', {}, free),
            el('td', { class: 'premium-column' }, premium))))),
      el('div', { class: 'premium-plans' },
        el('article', { class: 'premium-plan-card' },
          el('span', { class: 'premium-plan-badge premium-plan-badge-trial' }, '7 días gratis'),
          el('div', { class: 'premium-plan-copy' },
            el('h3', {}, 'Mensual'),
            el('div', { class: 'premium-plan-price' }, '$4.99', el('span', {}, '/mes')),
            el('p', { class: 'dim' },
              'Empieza gratis, sin compromiso — cancela cuando quieras durante la prueba y no se te cobra nada.'),
            el('p', { class: 'premium-plan-fineprint' },
              'La prueba gratis aplica una vez por cliente (mismo comprador o método de pago), aunque la actives en otro servidor.')),
          checkoutBtn(box, 'monthly', 'Empezar prueba gratis — 7 días')),
        el('article', { class: 'premium-plan-card premium-plan-featured' },
          el('span', { class: 'premium-plan-badge' }, 'Ahorra ~33%'),
          el('span', { class: 'premium-plan-recommended' }, 'Recomendado'),
          el('div', { class: 'premium-plan-copy' },
            el('h3', {}, 'Anual'),
            el('div', { class: 'premium-plan-price' }, '$39.99', el('span', {}, '/año')),
            el('p', { class: 'dim' }, 'La mejor opción: pagas una vez y ahorras ~33% frente a 12 meses sueltos.')),
          checkoutBtn(box, 'annual', 'Suscribirse — Anual $39.99/año'))));

    // TODO: /terms y /privacy no están expuestas como rutas en webapi.py todavía
    // (solo existen docs/TERMS.md y docs/PRIVACY.md en el repo) — hay que
    // servirlas antes de que estos links funcionen.
    const legalNote = el('p', { class: 'premium-plan-fineprint' },
      'Al continuar aceptas los ',
      el('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'Términos'),
      ' y la ',
      el('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Política de Privacidad'),
      '.');
    cardWide.append(legalNote);

    // Nota discreta: no compite por atención con las tarjetas de precio de arriba.
    const cancelNote = el('div', { class: 'premium-note' },
      icon('info'),
      el('div', { class: 'premium-note-body' },
        el('h3', {}, '¿Cómo cancelo o gestiono mi suscripción?'),
        el('p', {},
          'El pago se procesa a través de Polar, nuestro proveedor de pagos (Merchant of Record) — la suscripción se gestiona ahí, no en este dashboard.'),
        el('p', {},
          'Al suscribirte, Polar te envía un correo de confirmación (no Purgito) con un link a tu portal de cliente. Desde ahí puedes cancelar la suscripción, cambiar de plan (mensual ↔ anual) o ver tus recibos, cuando quieras. Si no lo encuentras, revisa spam o promociones.'),
        el('p', {},
          'Cancelar no corta el acceso al tiro: el premium sigue activo hasta el final del período ya pagado, y simplemente no se renueva después.')));

    box.append(el('div', { class: 'premium-layout' }, cardWide, cancelNote));
  } catch (e) { renderError(box, e); }
}

// ---------- GIFs ----------

const GIFS_PAGE = 30;
let _gifPool = [];
let _gifStatsEl = null;

// Misma clasificación que la galería pública (gif_gallery.py).
function classifyGif(gif) {
  if (gif.media_url) return { type: 'img', src: gif.media_url };
  const u = gif.url;
  if (u.includes('cdn.discordapp.com')) return { type: 'img', src: u };
  if (u.includes('giphy.com/gifs/')) {
    const parts = u.split('/gifs/').pop().split('-');
    const id = parts[parts.length - 1];
    return { type: 'img', src: `https://media.giphy.com/media/${id}/giphy.gif` };
  }
  if (u.includes('tenor.com/view/')) {
    const parts = u.split('/');
    const id = parts[parts.length - 1].split('-').pop();
    return { type: 'iframe', src: `https://tenor.com/embed/${id}` };
  }
  return { type: 'link', src: null };
}

function gifLinkCard(url) {
  return el('a', {
    class: 'gif-placeholder', href: url, target: '_blank', rel: 'noopener', title: url,
    style: 'flex-direction:column;gap:4px',
  },
    el('span', {}, '⛓'),
    el('span', { style: 'font-size:10px;letter-spacing:0.15em' }, 'ABRIR GIF'));
}

function gifThumb(g) {
  const { type, src } = classifyGif(g);
  if (type === 'img') {
    const img = el('img', { src, loading: 'lazy', alt: '' });
    img.onerror = () => img.replaceWith(gifLinkCard(g.url));
    return img;
  }
  if (type === 'iframe') {
    const frame = el('iframe', { src, loading: 'lazy', frameborder: '0' });
    frame.style.cssText = 'width:100%;height:110px;border:none;pointer-events:none;border-radius:3px;background:#000';
    return frame;
  }
  return gifLinkCard(g.url);
}

// Igual que el header de gif_gallery.py: total + desglose preview/link,
// recalculado sobre el pool en memoria (no pide de nuevo al backend).
function updateGifStats() {
  if (!_gifStatsEl) return;
  let preview = 0, link = 0;
  for (const g of _gifPool) {
    if (classifyGif(g).type === 'link') link++; else preview++;
  }
  _gifStatsEl.innerHTML = '';
  _gifStatsEl.append(
    el('strong', { class: 'stat-num' }, String(_gifPool.length)), ' GIFs — ',
    el('strong', { class: 'stat-num' }, String(preview)), ' con preview · ',
    el('strong', { class: 'stat-num' }, String(link)), ' como link');
}

function syncGifMore() {
  const grid = document.getElementById('gifGrid');
  const btn = document.getElementById('gifMoreBtn');
  if (!grid || !btn) return;
  const left = _gifPool.length - grid.querySelectorAll('.gif-card').length;
  btn.parentElement.style.display = left > 0 ? '' : 'none';
  if (left > 0) btn.textContent = `Cargar más (${left} restantes)`;
}

function renderGifBatch() {
  const grid = document.getElementById('gifGrid');
  if (!grid) return;
  const from = grid.querySelectorAll('.gif-card').length;
  const frag = document.createDocumentFragment();
  for (const g of _gifPool.slice(from, from + GIFS_PAGE)) frag.append(gifCard(g));
  grid.append(frag);
  syncGifMore();
}

// Confirmación de borrado en dos pasos (mismo patrón que attachDelBtn/
// askConfirm de gif_gallery.py): "Quitar" -> "¿Seguro? ✓ ✗" -> ejecuta o revierte.
function gifDeleteActions(gifId, card) {
  const wrap = el('div', { class: 'gif-actions' });

  function showButton() {
    wrap.innerHTML = '';
    wrap.append(el('button', { class: 'btn btn-danger btn-sm', onclick: showConfirm }, 'Quitar'));
  }
  function showConfirm() {
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'gif-confirm' },
      '¿Seguro?',
      el('button', { class: 'btn btn-danger btn-sm', onclick: doDelete }, '✓'),
      el('button', { class: 'btn btn-secondary btn-sm', onclick: showButton }, '✗')));
  }
  async function doDelete() {
    try {
      const resp = await apiFetch(`/api/server/${GUILD_ID}/settings/gifs/${gifId}`, { method: 'DELETE' });
      if (!resp.deleted) {
        toast('No se encontró ese GIF', 'warn');
        showButton();
        return;
      }
      toast('GIF eliminado', 'ok');
      card.classList.add('out');
      _gifPool = _gifPool.filter(g => g.id !== gifId);
      updateGifStats();
      setTimeout(() => { card.remove(); syncGifMore(); }, 240);
    } catch (e) {
      toast(e.status === 429 ? 'Rate limit — espera antes de borrar más' : e.message, e.status === 429 ? 'warn' : 'err');
      showButton();
    }
  }

  showButton();
  return wrap;
}

function gifCard(g) {
  const card = el('div', { class: 'gif-card' },
    gifThumb(g),
    el('a', { class: 'gif-url', href: g.url, target: '_blank', rel: 'noopener' }, g.url));
  card.append(gifDeleteActions(g.id, card));
  return card;
}

async function loadGifs() {
  const box = content();
  box.append(spinner());
  try {
    const data = await apiFetch(`/api/server/${GUILD_ID}/settings/gifs`);
    box.innerHTML = '';

    _gifPool = data.gifs;
    _gifStatsEl = el('p', { class: 'dim gif-stats' });
    box.append(_gifStatsEl);
    updateGifStats();

    const input = el('input', { type: 'text', placeholder: 'https://tenor.com/… o URL de R2', style: 'flex:1' });
    box.append(el('div', { class: 'add-row' }, input,
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const url = input.value.trim();
          if (!url) return;
          try {
            const addResp = await apiFetch(`/api/server/${GUILD_ID}/settings/gifs`, {
              method: 'POST', body: { url },
            });
            if (addResp.inserted) {
              toast('GIF agregado', 'ok');
              loadGifs();
            } else {
              toast('Ese GIF ya estaba guardado', 'warn');
            }
          } catch (e) {
            toast(e.status === 429 ? 'Rate limit — espera antes de agregar más' : e.message, e.status === 429 ? 'warn' : 'err');
          }
        },
      }, 'Agregar')));

    if (!_gifPool.length) {
      box.append(emptyState('Todavía no hay GIFs guardados — añade uno con el campo de arriba.'));
      return;
    }

    const grid = el('div', { class: 'gif-grid', id: 'gifGrid' });
    box.append(grid);
    renderGifBatch();

    const moreBtn = el('button', { class: 'btn btn-secondary', id: 'gifMoreBtn', onclick: renderGifBatch }, 'Cargar más');
    box.append(el('div', { class: 'gif-more-wrap' }, moreBtn));
    syncGifMore();
  } catch (e) { renderError(box, e); }
}
