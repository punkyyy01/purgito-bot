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
// action opcional: { label, onclick } — para avisos que ofrecen deshacer/
// descartar algo (ej. el borrador recuperado). El resto de llamadas sigue
// pasando solo (msg, type).
function toast(msg, type, action) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.innerHTML = '';
  box.append(document.createTextNode(msg));
  if (action) {
    box.append(el('button', {
      class: 'toast-action',
      onclick: () => { clearTimeout(_toastTimer); box.className = ''; action.onclick(); },
    }, action.label));
  }
  box.className = 'show ' + (type || '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { box.className = ''; }, action ? 6000 : 3200);
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
  fieldValue: 1024, footer: 2048, author: 256, total: 6000, count: 10,
};

let _embedTab = 'editor';
// Modo de contenido: 'classic' (embeds clásicos) o 'layout' (Components V2).
// Discord no permite combinar ambos en un mismo mensaje.
let _embedMode = 'classic';
// Documento del editor clásico: array de hasta 10 embeds + el embed activo +
// datos de la plantilla cargada (si aplica). Persiste al cambiar de sub-vista.
let _embedDoc = null;
// Documento del editor Layout V2 (bloques). Se mantiene aparte del clásico,
// así cambiar de modo no destruye el trabajo del otro editor.
let _layoutDoc = null;

function blankDoc() {
  return { embeds: [blankEmbed()], active: 0, templateId: null, templateName: '',
           channelId: '', sendMode: 'now', schedType: 'interval', interval: '60', time: '09:00',
           sendOpts: blankSendOpts() };
}

function blankEmbed() {
  return {
    title: '', description: '', color: '#8B6EF5',
    authorName: '', authorIcon: '', footerText: '', footerIcon: '',
    // `url` no tiene campo visible: lo gestiona el atajo de galería, que agrupa
    // embeds consecutivos que comparten el mismo `url` (así los muestra Discord).
    thumbnail: '', image: '', url: '', fields: [],
  };
}

// Estado del formulario -> dict de embed estilo API de Discord (solo lo no vacío).
function embedDict(s) {
  const e = {};
  if (s.title.trim()) e.title = s.title.trim();
  if (s.description.trim()) e.description = s.description.trim();
  if (s.color) e.color = s.color; // hex "#RRGGBB"; el backend lo convierte a int
  if (s.url && s.url.trim()) e.url = s.url.trim();
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
function embedToState(e) {
  const s = blankEmbed();
  s.title = e.title || '';
  s.description = e.description || '';
  if (typeof e.color === 'number') s.color = '#' + e.color.toString(16).padStart(6, '0');
  else if (typeof e.color === 'string') s.color = e.color;
  s.url = e.url || '';
  s.authorName = (e.author && e.author.name) || '';
  s.authorIcon = (e.author && e.author.icon_url) || '';
  s.footerText = (e.footer && e.footer.text) || '';
  s.footerIcon = (e.footer && e.footer.icon_url) || '';
  s.thumbnail = (e.thumbnail && e.thumbnail.url) || '';
  s.image = (e.image && e.image.url) || '';
  s.fields = (e.fields || []).map(f => ({ name: f.name || '', value: f.value || '', inline: !!f.inline }));
  return s;
}

// Doc a partir de un array de embeds guardados (plantilla).
function docFromEmbeds(embeds, templateId, templateName, sendOptions) {
  const doc = blankDoc();
  doc.embeds = (embeds && embeds.length ? embeds : [{}]).map(embedToState);
  doc.active = 0;
  doc.templateId = templateId || null;
  doc.templateName = templateName || '';
  doc.sendOpts = sendOptsFromApi(sendOptions);
  return doc;
}

// Caracteres que Discord cuenta contra el límite de 6000 por mensaje.
// Espejo de embed_char_count() en webapi.py — mantener en sync.
function embedChars(e) {
  let total = (e.title || '').length + (e.description || '').length
    + ((e.footer && e.footer.text) || '').length + ((e.author && e.author.name) || '').length;
  for (const f of e.fields || []) total += f.name.length + f.value.length;
  return total;
}

function validateEmbedClient(e) {
  if ((e.title || '').length > EMBED_LIMITS.title) return `El título supera los ${EMBED_LIMITS.title} caracteres.`;
  if ((e.description || '').length > EMBED_LIMITS.description) return `La descripción supera los ${EMBED_LIMITS.description} caracteres.`;
  const fields = e.fields || [];
  if (fields.length > EMBED_LIMITS.fields) return `Máximo ${EMBED_LIMITS.fields} fields.`;
  for (const f of fields) {
    if (f.name.length > EMBED_LIMITS.fieldName) return `Un field tiene el nombre demasiado largo (máx ${EMBED_LIMITS.fieldName}).`;
    if (f.value.length > EMBED_LIMITS.fieldValue) return `Un field tiene el valor demasiado largo (máx ${EMBED_LIMITS.fieldValue}).`;
  }
  if (((e.footer && e.footer.text) || '').length > EMBED_LIMITS.footer) return `El footer supera los ${EMBED_LIMITS.footer} caracteres.`;
  if (((e.author && e.author.name) || '').length > EMBED_LIMITS.author) return `El autor supera los ${EMBED_LIMITS.author} caracteres.`;
  if (!e.title && !e.description && !fields.length && !e.image && !e.thumbnail && !e.author && !e.footer) {
    return 'El embed está vacío: completa al menos un campo.';
  }
  return null;
}

// Valida el array completo (espejo de validate_embeds_payload en el backend).
// El tope de 6000 aplica a la SUMA de todos los embeds del mensaje (regla real
// de Discord), no por embed.
function validateEmbedsClient(dicts) {
  if (!dicts.length) return 'Agrega al menos un embed con contenido.';
  if (dicts.length > EMBED_LIMITS.count) return `Máximo ${EMBED_LIMITS.count} embeds por mensaje.`;
  for (let i = 0; i < dicts.length; i++) {
    const err = validateEmbedClient(dicts[i]);
    if (err) return `Embed ${i + 1}: ${err}`;
  }
  const total = dicts.reduce((n, d) => n + embedChars(d), 0);
  if (total > EMBED_LIMITS.total) {
    return `El mensaje supera los ${EMBED_LIMITS.total} caracteres sumando todos los embeds (${total}).`;
  }
  return null;
}

// dicts no vacíos del doc (los tabs sin contenido no se envían ni guardan).
function docDicts(doc) {
  return doc.embeds.map(embedDict).filter(d => Object.keys(d).length);
}

// Textarea que crece con su contenido (tope 400px, luego scroll interno).
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 400) + 'px';
}

// Detecta URLs de Tenor/Giphy y devuelve { note, url, warn } o null. Para
// Giphy normaliza a la URL del archivo directo (Discord no embebe la página);
// para una página de Tenor no se puede derivar el archivo de forma fiable en
// el cliente, así que solo se avisa.
function detectGif(raw) {
  const url = (raw || '').trim();
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
  if (host.endsWith('giphy.com')) {
    const m = url.match(/giphy\.com\/(?:gifs|media)\/(?:.*-)?(\w+)/);
    if (m && !host.startsWith('media')) {
      return { note: 'GIF de Giphy detectado — usaremos el archivo optimizado.', url: `https://media.giphy.com/media/${m[1]}/giphy.gif` };
    }
    return null;
  }
  if (host.endsWith('tenor.com')) {
    if (host.startsWith('media') || host.startsWith('c.')) return null; // ya es archivo directo
    return { warn: true, url, note: 'Página de Tenor detectada — para que se vea en el embed pegá el enlace directo del GIF (media.tenor.com/…), no el de la página.' };
  }
  return null;
}

// Imagen que se oculta sola si la URL no carga (igual que hace Discord).
function embedImg(attrs) {
  const img = el('img', attrs);
  img.onerror = () => { img.style.display = 'none'; };
  return img;
}

// ---------- Markdown estilo Discord + menciones para el Preview ----------
// Puramente visual: el JSON guardado/enviado nunca pasa por acá (docDicts,
// blockToApi, etc. siguen usando el texto crudo). _roles/_channels son el
// mismo cache que ya alimenta el picker de menciones (5.1).

// <@&id> -> @Rol (con su color real si tiene uno asignado), <#id> -> #canal,
// <@id>/<@!id> -> @usuario genérico (no hay endpoint de miembros en el panel).
// Si el rol/canal ya no existe, se muestra un placeholder mudo en vez de romper.
function resolveMentionNode(kind, id) {
  if (kind === 'role') {
    const r = (_roles || []).find(x => x.id === id);
    if (!r) return el('span', { class: 'd-embed-mention d-embed-mention-unknown' }, '@rol-eliminado');
    const span = el('span', { class: 'd-embed-mention' }, '@' + r.name);
    if (r.color && r.color !== '#000000') {
      span.style.color = r.color;
      span.style.background = `color-mix(in srgb, ${r.color} 30%, transparent)`;
    }
    return span;
  }
  if (kind === 'channel') {
    const c = (_channels || []).find(x => x.id === id);
    if (!c) return el('span', { class: 'd-embed-mention d-embed-mention-unknown' }, '#canal-eliminado');
    return el('span', { class: 'd-embed-mention' }, '#' + c.name);
  }
  return el('span', { class: 'd-embed-mention' }, '@usuario');
}

// Emoji custom <:nombre:id> / animado <a:nombre:id>: el ID ya trae todo lo
// necesario para construir la URL del CDN de Discord sin pedirle nada al
// backend. Si la imagen no carga (emoji borrado, CDN caído), se cae a
// :nombre: en vez de dejar un ícono roto.
function customEmojiNode(name, id, animated) {
  const fallback = ':' + name + ':';
  const img = el('img', {
    src: `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=24&quality=lossless`,
    alt: fallback, class: 'd-embed-emoji',
  });
  img.onerror = () => { img.replaceWith(document.createTextNode(fallback)); };
  return img;
}

// Formato de <t:unix:estilo>, compartido con el picker de fecha (5.1) para
// no duplicar la lógica de Intl.DateTimeFormat/RelativeTimeFormat.
function discordTimestampText(date, style) {
  const s = style || 'f';
  if (s === 'R') {
    const sec = Math.round((date - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat('es');
    const abs = Math.abs(sec);
    if (abs < 60) return rtf.format(sec, 'second');
    if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
    return rtf.format(Math.round(sec / 86400), 'day');
  }
  const opts = {
    t: { timeStyle: 'short' }, T: { timeStyle: 'medium' },
    d: { dateStyle: 'short' }, D: { dateStyle: 'long' },
    f: { dateStyle: 'long', timeStyle: 'short' }, F: { dateStyle: 'full', timeStyle: 'short' },
  }[s] || { dateStyle: 'long', timeStyle: 'short' };
  return new Intl.DateTimeFormat('es', opts).format(date);
}

// Solo esquemas seguros son clickeables; una URL rara (p.ej. "javascript:")
// se muestra igual con el estilo de link pero sin href, para no correr JS
// arbitrario desde una plantilla pegada/importada.
function mdLinkNode(text, url) {
  const attrs = { class: 'd-embed-link', title: url };
  if (/^(https?:|mailto:)/i.test(url)) {
    attrs.href = url; attrs.target = '_blank'; attrs.rel = 'noopener noreferrer';
  }
  return el('a', attrs, ...parseInline(text));
}

// Formato inline completo: escape, código, links enmascarados, spoiler,
// negrita+cursiva, negrita, subrayado, tachado, cursiva (* o _), las tres
// menciones, emoji custom y timestamps. Grupos con nombre en vez de índices
// numéricos: agregar una alternativa no corre el riesgo de desalinear el
// resto. El orden de la alternancia importa (más específico primero: ***
// antes que **, ** antes que *) para que la regex no confunda negrita con
// cursiva.
const MD_INLINE_RE = new RegExp([
  String.raw`\\(?<esc>[\s\S])`,
  String.raw`\x60(?<code>[^\x60\n]+?)\x60`,
  String.raw`\[(?<linktext>[^\[\]]+)\]\((?<linkurl>(?:[^()\s]|\([^()\s]*\))+)\)`,
  String.raw`\|\|(?<spoiler>[\s\S]+?)\|\|`,
  String.raw`\*\*\*(?<bi>[\s\S]+?)\*\*\*`,
  String.raw`\*\*(?<bold>[\s\S]+?)\*\*`,
  String.raw`__(?<under>[\s\S]+?)__`,
  String.raw`~~(?<strike>[\s\S]+?)~~`,
  String.raw`\*(?<italic1>[^*\n]+?)\*`,
  String.raw`_(?<italic2>[^_\n]+?)_`,
  String.raw`<@&(?<role>\d+)>`,
  String.raw`<#(?<channel>\d+)>`,
  String.raw`<@!?(?<user>\d+)>`,
  String.raw`<(?<emojia>a)?:(?<emojiname>[a-zA-Z0-9_]{2,32}):(?<emojiid>\d+)>`,
  String.raw`<t:(?<ts>-?\d+)(?::(?<tstyle>[tTdDfFR]))?>`,
].join('|'), 'g');

function parseInline(text) {
  const nodes = [];
  const re = new RegExp(MD_INLINE_RE);
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    const g = m.groups;
    if (g.esc !== undefined) nodes.push(document.createTextNode(g.esc));
    else if (g.code !== undefined) nodes.push(el('code', { class: 'd-embed-code' }, g.code));
    else if (g.linktext !== undefined) nodes.push(mdLinkNode(g.linktext, g.linkurl));
    else if (g.spoiler !== undefined) nodes.push(el('span', { class: 'd-embed-spoiler' }, ...parseInline(g.spoiler)));
    else if (g.bi !== undefined) nodes.push(el('strong', {}, el('em', {}, ...parseInline(g.bi))));
    else if (g.bold !== undefined) nodes.push(el('strong', {}, ...parseInline(g.bold)));
    else if (g.under !== undefined) nodes.push(el('u', {}, ...parseInline(g.under)));
    else if (g.strike !== undefined) nodes.push(el('s', {}, ...parseInline(g.strike)));
    else if (g.italic1 !== undefined) nodes.push(el('em', {}, ...parseInline(g.italic1)));
    else if (g.italic2 !== undefined) nodes.push(el('em', {}, ...parseInline(g.italic2)));
    else if (g.role !== undefined) nodes.push(resolveMentionNode('role', g.role));
    else if (g.channel !== undefined) nodes.push(resolveMentionNode('channel', g.channel));
    else if (g.user !== undefined) nodes.push(resolveMentionNode('user', g.user));
    else if (g.emojiid !== undefined) nodes.push(customEmojiNode(g.emojiname, g.emojiid, !!g.emojia));
    else if (g.ts !== undefined) {
      const date = new Date(parseInt(g.ts, 10) * 1000);
      nodes.push(el('span', { class: 'd-embed-timestamp' }, discordTimestampText(date, g.tstyle)));
    }
    last = re.lastIndex;
    if (re.lastIndex === m.index) re.lastIndex++; // salvaguarda anti bucle infinito
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

// Reconoce si una línea abre un bloque especial (cita, subtexto, encabezado,
// lista) — usado para saber cuándo cortar la acumulación de un párrafo llano.
function isBlockLine(line) {
  return /^>\s?/.test(line) || /^-#\s?/.test(line) || /^#{1,3}\s+/.test(line) ||
         /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
}

// Lista (no ordenada u ordenada) con sangría visual: Discord no dibuja
// bullets/viñetas distintas por nivel, solo corre la línea entera hacia la
// derecha, así que la sangría se resuelve con margin-left por ítem en vez de
// listas anidadas de verdad.
function buildList(items, ordered) {
  const attrs = { class: 'd-embed-list' };
  if (ordered) attrs.start = String(items[0].num);
  const list = el(ordered ? 'ol' : 'ul', attrs);
  const base = items[0].indent;
  for (const it of items) {
    const level = Math.max(0, Math.round((it.indent - base) / 2));
    const li = el('li', {}, ...parseInline(it.content));
    if (level > 0) li.style.marginLeft = (level * 18) + 'px';
    list.append(li);
  }
  return list;
}

// Bloques: cita de una o más líneas ("> "), cita de bloque completo hasta el
// final del tramo (">>> "), subtexto ("-# "), encabezados (#/##/###) y
// listas (-/* , 1.) con su sangría; el resto pasa por el formato inline. Los
// saltos de línea sobrantes los resuelve el white-space:pre-wrap ya usado en
// .d-embed-desc/.lv2-text.
function mdBlocksFromText(chunk) {
  if (!chunk) return [];
  const lines = chunk.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ">>> " citas todo lo que sigue hasta el final del tramo, no solo esa línea.
    const tripleM = /^>>>\s?/.exec(line);
    if (tripleM) {
      const rest = [line.slice(tripleM[0].length), ...lines.slice(i + 1)].join('\n');
      out.push(el('div', { class: 'd-embed-quote' }, ...parseInline(rest)));
      i = lines.length;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = el('div', { class: 'd-embed-quote' });
      let first = true;
      while (i < lines.length && /^>\s?/.test(lines[i]) && !/^>>>\s?/.test(lines[i])) {
        if (!first) quote.append(document.createTextNode('\n'));
        quote.append(...parseInline(lines[i].replace(/^>\s?/, '')));
        first = false;
        i++;
      }
      out.push(quote);
      continue;
    }

    if (/^-#\s?/.test(line)) {
      const sub = el('div', { class: 'd-embed-subtext' });
      let first = true;
      while (i < lines.length && /^-#\s?/.test(lines[i])) {
        if (!first) sub.append(document.createTextNode('\n'));
        sub.append(...parseInline(lines[i].replace(/^-#\s?/, '')));
        first = false;
        i++;
      }
      out.push(sub);
      continue;
    }

    const headM = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headM) {
      out.push(el('div', { class: 'd-embed-h d-embed-h' + headM[1].length }, ...parseInline(headM[2])));
      i++;
      continue;
    }

    const ulFirst = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (ulFirst) {
      const items = [];
      while (i < lines.length) {
        const mm = /^(\s*)[-*]\s+(.*)$/.exec(lines[i]);
        if (!mm) break;
        items.push({ indent: mm[1].length, content: mm[2] });
        i++;
      }
      out.push(buildList(items, false));
      continue;
    }

    const olFirst = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (olFirst) {
      const items = [];
      while (i < lines.length) {
        const mm = /^(\s*)(\d+)\.\s+(.*)$/.exec(lines[i]);
        if (!mm) break;
        items.push({ indent: mm[1].length, num: parseInt(mm[2], 10), content: mm[3] });
        i++;
      }
      out.push(buildList(items, true));
      continue;
    }

    const plain = [];
    while (i < lines.length && !isBlockLine(lines[i])) { plain.push(lines[i]); i++; }
    out.push(...parseInline(plain.join('\n')));
  }
  return out;
}

// Bloques de código ``` ``` primero (protegidos del resto del parseo), y
// dentro de cada tramo restante, citas + formato inline.
function mdToNodes(raw) {
  const text = raw || '';
  const fenceRe = /```(?:[a-zA-Z0-9_+-]*\n)?([\s\S]*?)```/g;
  const nodes = [];
  let last = 0, m;
  while ((m = fenceRe.exec(text))) {
    if (m.index > last) nodes.push(...mdBlocksFromText(text.slice(last, m.index)));
    let code = m[1];
    if (code.endsWith('\n')) code = code.slice(0, -1);
    nodes.push(el('div', { class: 'd-embed-codeblock' }, code));
    last = fenceRe.lastIndex;
  }
  if (last < text.length) nodes.push(...mdBlocksFromText(text.slice(last)));
  return nodes;
}

// Preview en vivo: reusar el mismo <img> entre re-renders evita que la imagen
// se vuelva a decodificar (y parpadee) en cada tecla. El Set de "reclamados"
// se reinicia por render, así dos embeds con la misma URL igual reciben nodos
// distintos (no se roban el nodo cacheado).
const _previewImgCache = new Map();
let _previewImgClaimed = null;
function beginPreviewRender() { _previewImgClaimed = new Set(); }
function endPreviewRender() { _previewImgClaimed = null; }
function previewImg(attrs) {
  const src = attrs.src || '';
  if (_previewImgClaimed && src && !_previewImgClaimed.has(src) && _previewImgCache.has(src)) {
    const img = _previewImgCache.get(src);
    _previewImgClaimed.add(src);
    if (attrs.class) img.className = attrs.class;
    img.style.display = '';
    return img;
  }
  const img = embedImg(attrs);
  if (_previewImgClaimed && src) { _previewImgClaimed.add(src); _previewImgCache.set(src, img); }
  return img;
}

// Grupo de campos con eyebrow-caret (la firma de Purgito). El caret ▍ es
// decorativo y se pinta con ::before en CSS, así el lector de pantalla no lo
// anuncia antes del título.
function formGroup(title, ...children) {
  return el('div', { class: 'form-group' },
    el('div', { class: 'form-group-title' }, title), ...children);
}

// Variante colapsable de formGroup (editor de embeds clásico): <details>
// nativo, así el toggle es accesible (teclado, lector de pantalla) sin JS.
// `open` indica si arranca expandido — se pasa según el estado del embed.
function accordionGroup(title, open, ...children) {
  return el('details', { class: 'embed-group', open: open ? '' : null },
    el('summary', { class: 'embed-group-title' }, title),
    el('div', { class: 'embed-group-body' }, ...children));
}

// Estado vacío del preview con el caret parpadeante en vez de un rectángulo muerto.
function previewEmpty(msg) {
  return el('div', { class: 'preview-empty' },
    el('div', { class: 'caret', 'aria-hidden': 'true' }, '▍'),
    el('div', {}, msg || 'Así se va a ver tu mensaje'));
}

// Error de validación inline y persistente (a diferencia del toast). Vaciar con msg falsy.
function showFormAlert(box, msg) {
  box.innerHTML = '';
  if (msg) box.append(el('div', { class: 'form-alert', role: 'alert' }, msg));
}

// ---------- Fase 5: helpers compartidos del editor ----------

// Modal genérico del panel (historial, JSON). Cierra con ✗, click afuera o Escape.
function panelModal(title, body) {
  const overlay = el('div', {
    class: 'modal-overlay',
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  },
    el('div', { class: 'modal-box' },
      el('div', { class: 'modal-head' },
        el('strong', {}, title),
        el('button', { class: 'btn btn-secondary btn-sm', onclick: () => overlay.remove() }, '✗')),
      body));
  overlay.tabIndex = -1;
  overlay.onkeydown = (e) => { if (e.key === 'Escape') overlay.remove(); };
  document.body.append(overlay);
  overlay.focus();
  return overlay;
}

let _emojis = null;
async function getEmojis() {
  if (!_emojis) _emojis = (await apiFetch(`/api/server/${GUILD_ID}/emojis`)).emojis;
  return _emojis;
}

// Emojis unicode comunes con palabras clave en español para el buscador.
// Lista curada a propósito (un índice completo de unicode pesa cientos de KB).
const EMOJI_LIST = [
  ['😀', 'sonrisa feliz'], ['😂', 'risa llorar'], ['🤣', 'carcajada risa'], ['😊', 'sonrisa tierna'],
  ['😍', 'enamorado corazones'], ['🥰', 'amor carino'], ['😎', 'lentes cool'], ['🤔', 'pensando duda'],
  ['😅', 'risa nervios'], ['😭', 'llorar triste'], ['😢', 'lagrima triste'], ['😡', 'enojado furia'],
  ['🥺', 'ojitos porfa'], ['😴', 'dormir sueno'], ['🤯', 'explota mente'], ['😱', 'grito susto'],
  ['🙄', 'ojos vueltos'], ['😉', 'guino'], ['🤗', 'abrazo'], ['🤫', 'silencio secreto'],
  ['👍', 'pulgar arriba ok'], ['👎', 'pulgar abajo'], ['👏', 'aplausos'], ['🙌', 'manos celebrar'],
  ['🙏', 'gracias rezar porfa'], ['💪', 'fuerza musculo'], ['🤝', 'apreton trato'], ['👋', 'hola chau saludo'],
  ['✌️', 'paz victoria'], ['🤞', 'suerte dedos'], ['👀', 'ojos mirando'], ['🧠', 'cerebro'],
  ['❤️', 'corazon rojo amor'], ['🧡', 'corazon naranja'], ['💛', 'corazon amarillo'], ['💚', 'corazon verde'],
  ['💙', 'corazon azul'], ['💜', 'corazon violeta'], ['🖤', 'corazon negro'], ['💔', 'corazon roto'],
  ['✨', 'brillos destellos'], ['⭐', 'estrella'], ['🌟', 'estrella brillante'], ['🔥', 'fuego'],
  ['💥', 'explosion boom'], ['🎉', 'fiesta confeti festejo'], ['🎊', 'festejo bola confeti'], ['🎈', 'globo'],
  ['🎁', 'regalo'], ['🏆', 'trofeo campeon'], ['🥇', 'medalla oro primero'], ['🎮', 'juego gamer control'],
  ['🎵', 'musica nota'], ['🎶', 'musica notas'], ['🎤', 'microfono cantar'], ['🎬', 'cine claqueta'],
  ['📢', 'anuncio megafono'], ['📣', 'megafono aviso'], ['🔔', 'campana notificacion'], ['🔕', 'campana silencio'],
  ['📌', 'pin fijado'], ['📍', 'ubicacion pin'], ['📎', 'clip adjunto'], ['🔗', 'link enlace'],
  ['📅', 'calendario fecha'], ['⏰', 'reloj alarma'], ['⏳', 'reloj arena espera'], ['🕐', 'reloj hora'],
  ['✅', 'check listo verde'], ['❌', 'cruz error rojo'], ['⚠️', 'advertencia cuidado'], ['🚫', 'prohibido'],
  ['❓', 'pregunta duda'], ['❗', 'exclamacion importante'], ['💡', 'idea foco'], ['🔒', 'candado bloqueado'],
  ['🔓', 'candado abierto'], ['🔑', 'llave'], ['⚙️', 'engranaje config'], ['🛠️', 'herramientas'],
  ['📝', 'nota escribir'], ['📖', 'libro leer'], ['📊', 'grafico estadisticas'], ['💰', 'dinero bolsa'],
  ['💎', 'diamante gema'], ['🚀', 'cohete lanzamiento'], ['🌈', 'arcoiris'], ['☀️', 'sol'],
  ['🌙', 'luna noche'], ['⛈️', 'tormenta lluvia'], ['❄️', 'nieve copo'], ['🌊', 'ola mar'],
  ['🍕', 'pizza'], ['🍔', 'hamburguesa'], ['🌮', 'taco'], ['🍦', 'helado'],
  ['☕', 'cafe'], ['🍺', 'cerveza'], ['🐱', 'gato'], ['🐶', 'perro'],
  ['🦊', 'zorro'], ['🐸', 'rana'], ['🐢', 'tortuga'], ['🦆', 'pato'],
];

// Inserta texto en la posición del cursor del input/textarea activo y dispara
// 'input' para que los handlers existentes actualicen estado + preview.
function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.selectionStart = input.selectionEnd = pos;
  input.focus();
  input.dispatchEvent(new Event('input'));
}

// --- Popover unificado de inserción (menciones / fecha / emoji) ---

let _insPop = null;
function closeInsertPopover() {
  if (_insPop) { _insPop.remove(); _insPop = null; }
  document.removeEventListener('mousedown', _insPopOutside);
  document.removeEventListener('scroll', _insPopScroll, true);
}
function _insPopOutside(e) {
  if (_insPop && !_insPop.contains(e.target)) closeInsertPopover();
}
// El popover es position:fixed calculado una sola vez al abrir; si el
// formulario/preview (ahora con scroll propio) se mueve por debajo, el
// popover quedaría "flotando" desconectado de su campo. Cerrarlo en
// cualquier scroll fuera de él mismo (su lista interna sí puede scrollear
// sin cerrarse). 'scroll' no burbujea, así que se escucha en captura.
function _insPopScroll(e) {
  if (_insPop && !_insPop.contains(e.target)) closeInsertPopover();
}

const INS_TAB_LABELS = { menciones: 'Menciones', fecha: 'Fecha', emoji: 'Emoji' };

function openInsertPopover(anchor, input, tabs, initialTab) {
  closeInsertPopover();
  const pop = el('div', { class: 'ins-pop' });
  const body = el('div', { class: 'ins-pop-body' });
  let active = initialTab && tabs.includes(initialTab) ? initialTab : tabs[0];
  const tabBar = el('div', { class: 'ins-pop-tabs' });

  function renderTabs() {
    tabBar.innerHTML = '';
    for (const t of tabs) {
      tabBar.append(el('div', {
        class: 'ins-pop-tab' + (t === active ? ' active' : ''),
        onclick: () => { active = t; renderTabs(); renderBody(); },
      }, INS_TAB_LABELS[t]));
    }
  }

  function insert(text, ev) {
    insertAtCursor(input, text);
    // Shift+click mantiene el popover abierto para insertar varios seguidos.
    if (!ev || !ev.shiftKey) closeInsertPopover();
  }

  async function renderBody() {
    body.innerHTML = '';
    if (active === 'menciones') {
      body.append(spinner());
      let roles, channels;
      try { [roles, channels] = await Promise.all([getRoles(), getChannels()]); }
      catch (e) { body.innerHTML = ''; body.append(el('p', { class: 'error' }, e.message)); return; }
      body.innerHTML = '';
      const search = el('input', { type: 'text', placeholder: 'Buscar rol o canal…' });
      const list = el('div', { class: 'ins-pop-list' });
      function renderList() {
        const q = search.value.trim().toLowerCase();
        list.innerHTML = '';
        for (const r of roles) {
          if (q && !r.name.toLowerCase().includes(q)) continue;
          list.append(el('div', { class: 'ins-pop-item', onclick: (ev) => insert(`<@&${r.id}>`, ev) },
            el('span', { class: 'ins-dot', style: 'background:' + (r.color !== '#000000' ? r.color : 'var(--text-muted)') }),
            '@' + r.name));
        }
        for (const c of channels) {
          if (q && !c.name.toLowerCase().includes(q)) continue;
          list.append(el('div', { class: 'ins-pop-item', onclick: (ev) => insert(`<#${c.id}>`, ev) }, '#' + c.name));
        }
        if (!list.children.length) list.append(el('p', { class: 'dim', style: 'padding:8px' }, 'Sin resultados'));
      }
      search.oninput = renderList;
      body.append(search, list);
      renderList();
      search.focus();
    } else if (active === 'fecha') {
      // datetime-local nativo, redondeado al minuto actual.
      const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const dt = el('input', { type: 'datetime-local', value: now });
      const list = el('div', { class: 'ins-pop-list' });
      const STYLES = [
        ['t', 'Hora corta'], ['T', 'Hora con segundos'], ['d', 'Fecha corta'],
        ['D', 'Fecha larga'], ['f', 'Fecha y hora'], ['F', 'Fecha y hora completa'],
        ['R', 'Relativo (hace / en…)'],
      ];
      // El formato en sí (Intl.DateTimeFormat/RelativeTimeFormat) vive en
      // discordTimestampText, compartido con el renderer del Preview.
      function renderStyles() {
        const date = dt.value ? new Date(dt.value) : new Date();
        list.innerHTML = '';
        for (const [code, label] of STYLES) {
          list.append(el('div', {
            class: 'ins-pop-item',
            onclick: (ev) => insert(`<t:${Math.floor(date.getTime() / 1000)}:${code}>`, ev),
          },
            el('span', { class: 'ins-item-label' }, label),
            el('span', { class: 'dim' }, discordTimestampText(date, code))));
        }
      }
      dt.onchange = renderStyles;
      body.append(el('div', { class: 'field' }, dt), list);
      renderStyles();
    } else {
      // emoji
      const search = el('input', { type: 'text', placeholder: 'Buscar emoji…' });
      const grid = el('div', { class: 'ins-emoji-grid' });
      let custom = [];
      try { custom = await getEmojis(); } catch (e) { /* sin custom, unicode igual sirve */ }
      function renderGrid() {
        const q = search.value.trim().toLowerCase();
        grid.innerHTML = '';
        for (const em of custom) {
          if (q && !em.name.toLowerCase().includes(q)) continue;
          const code = `<${em.animated ? 'a' : ''}:${em.name}:${em.id}>`;
          grid.append(el('button', {
            class: 'ins-emoji', title: ':' + em.name + ':',
            onclick: (ev) => insert(code, ev),
          }, embedImg({ src: em.url, alt: em.name, class: 'ins-emoji-img' })));
        }
        for (const [ch, keywords] of EMOJI_LIST) {
          if (q && !keywords.includes(q)) continue;
          grid.append(el('button', { class: 'ins-emoji', onclick: (ev) => insert(ch, ev) }, ch));
        }
        if (!grid.children.length) grid.append(el('p', { class: 'dim', style: 'padding:8px' }, 'Sin resultados'));
      }
      search.oninput = renderGrid;
      body.append(search, grid);
      renderGrid();
      search.focus();
    }
  }

  pop.append(tabBar, body);
  pop.onkeydown = (e) => { if (e.key === 'Escape') { closeInsertPopover(); input.focus(); } };
  document.body.append(pop);
  // Posicionar bajo el ancla, sin salirse del viewport.
  const rect = anchor.getBoundingClientRect();
  pop.style.top = Math.min(rect.bottom + 4, window.innerHeight - 340) + 'px';
  pop.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
  _insPop = pop;
  setTimeout(() => {
    document.addEventListener('mousedown', _insPopOutside);
    document.addEventListener('scroll', _insPopScroll, true);
  }, 0);
  renderTabs();
  renderBody();
}

// Envuelve un input/textarea con el botón de inserción asistida + atajos
// Ctrl/Cmd+M (menciones), Ctrl/Cmd+P (fecha), Ctrl/Cmd+E (emoji).
function insertWrap(input, tabs) {
  const btn = el('button', {
    type: 'button', class: 'ins-btn', title: 'Insertar mención, fecha o emoji',
    onclick: () => openInsertPopover(btn, input, tabs),
  });
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  const SHORTCUTS = { m: 'menciones', p: 'fecha', e: 'emoji' };
  input.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
    const tab = SHORTCUTS[ev.key.toLowerCase()];
    // preventDefault SOLO para las combinaciones propias (no pisar otras del navegador).
    if (tab && tabs.includes(tab)) { ev.preventDefault(); openInsertPopover(btn, input, tabs, tab); }
  });
  return el('div', { class: 'ins-wrap' }, input, btn);
}

// --- Subida directa de imágenes (5.2) ---

// Archivos subidos en esta sesión de página, para el desplegable "reusar".
let _uploadedImages = [];

async function uploadImageBlob(blob, name) {
  let r;
  try {
    r = await fetch(`/api/server/${GUILD_ID}/embeds/upload`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || humanError(r.status));
  if (!_uploadedImages.some(u => u.url === data.url)) {
    _uploadedImages.push({ name: name || 'imagen', url: data.url });
  }
  return data.url;
}

const _PASTE_HINT = /mac/i.test(navigator.platform || '') ? '⌘V' : 'Ctrl+V';

// Widget combinado de imagen: URL manual + subir archivo + pegar del
// portapapeles + reusar ya subida. Guarda la URL final en obj[key].
function imageField(obj, key, onChange, opts = {}) {
  const wrap = el('div', { class: 'img-field' });

  function set(url) { obj[key] = url; onChange(); render(); }

  async function handleUpload(file) {
    // Estado de carga claro dentro del widget (no dejar el botón inerte).
    wrap.innerHTML = '';
    wrap.append(el('div', { class: 'img-uploading' }, spinner(), el('span', {}, 'Subiendo imagen…')));
    try {
      const url = await uploadImageBlob(file, file.name);
      set(url);
      toast('Imagen subida', 'ok');
    } catch (e) {
      // El error queda visible en el campo (además del toast), no solo un toast
      // que desaparece.
      render();
      wrap.prepend(el('div', { class: 'img-error' }, 'No se pudo subir: ' + e.message));
      toast(e.message, e.status === 429 ? 'warn' : 'err');
    }
  }

  function render() {
    wrap.innerHTML = '';
    const val = (obj[key] || '').trim();
    if (val) {
      const known = _uploadedImages.find(u => u.url === val);
      wrap.append(el('div', { class: 'img-chip' },
        embedImg({ src: val, class: 'img-chip-thumb', alt: '' }),
        el('span', { class: 'img-chip-name', title: val },
          known ? known.name : (val.length > 42 ? val.slice(0, 42) + '…' : val)),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => set('') }, '✗')));
      return;
    }

    const url = el('input', { type: 'url', placeholder: '…o pega un enlace de imagen' });
    const gifNote = el('div', { class: 'embed-gif-note' });
    url.oninput = () => {
      if (!opts.gif) return;
      const d = detectGif(url.value);
      gifNote.className = 'embed-gif-note' + (d ? (d.warn ? ' warn' : ' ok') : '');
      gifNote.textContent = d ? d.note : '';
    };
    url.onchange = () => {
      let v = url.value.trim();
      if (opts.gif) {
        const d = detectGif(v);
        if (d && !d.warn) v = d.url;
      }
      if (v) set(v);
    };

    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: 'display:none' });
    fileInput.onchange = () => { if (fileInput.files[0]) handleUpload(fileInput.files[0]); };
    // Ajuste 5.2: "Subir" es la acción primaria (visual y funcionalmente), el
    // campo de URL pasa a secundario para que el usuario no-técnico no vea
    // "esto empieza con una URL".
    const uploadBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() },
      icon('image'), 'Subir imagen');
    const pasteBtn = el('button', {
      type: 'button', class: 'btn btn-secondary btn-sm', title: 'También puedes pegar con ' + _PASTE_HINT + ' con el campo enfocado',
      onclick: async () => {
        // clipboard.read() solo anda en Chromium con permiso; el paste con
        // teclado (listener de abajo) es el camino universal.
        try {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const type = item.types.find(t => t.startsWith('image/'));
            if (type) { handleUpload(await item.getType(type)); return; }
          }
          toast('No hay imagen en el portapapeles', 'warn');
        } catch (e) {
          toast('Usa ' + _PASTE_HINT + ' con el campo de URL enfocado', 'warn');
        }
      },
    }, 'Pegar (' + _PASTE_HINT + ')');
    url.addEventListener('paste', (ev) => {
      const file = [...(ev.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
      if (file) { ev.preventDefault(); handleUpload(file); }
    });

    const secondary = el('div', { class: 'img-field-secondary' }, url, pasteBtn);
    if (_uploadedImages.length) {
      const reuse = el('select', {}, el('option', { value: '' }, 'Reusar archivo ya subido…'));
      for (const u of _uploadedImages) reuse.append(el('option', { value: u.url }, u.name));
      reuse.onchange = () => { if (reuse.value) set(reuse.value); };
      secondary.append(reuse);
    }
    wrap.append(
      el('div', { class: 'img-field-primary' }, uploadBtn, fileInput),
      secondary, gifNote);
  }

  render();
  return wrap;
}

// Swatch nativo + input de texto para hex, sincronizados en ambos sentidos.
function colorField(obj, key, onChange) {
  const swatch = el('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(obj[key]) ? obj[key] : '#8B6EF5' });
  const text = el('input', {
    type: 'text',
    class: 'color-hex-input',
    value: obj[key] || '',
    placeholder: '#8B6EF5',
    maxlength: '7',
    spellcheck: 'false',
  });

  swatch.oninput = () => {
    obj[key] = swatch.value;
    text.value = swatch.value;
    text.classList.remove('invalid');
    onChange();
  };

  text.oninput = () => {
    let v = text.value.trim();
    if (v && !v.startsWith('#')) v = '#' + v;
    if (v === '') {
      obj[key] = '';
      text.classList.remove('invalid');
      onChange();
      return;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      obj[key] = v;
      swatch.value = v;
      text.classList.remove('invalid');
      onChange();
    } else {
      // Se deja escribir libremente (por si está a medio pegar/tipear), pero
      // no se guarda en `obj` ni se dispara onChange hasta que sea un hex
      // válido de 6 dígitos.
      text.classList.add('invalid');
    }
  };

  text.onblur = () => { text.value = obj[key] || ''; text.classList.remove('invalid'); };

  return el('div', { class: 'color-field' }, swatch, text);
}

// --- Historial local (5.4) ---

const HIST_MAX = 20;
let _histTimer = null;

function histKey() { return `purgito_hist_${GUILD_ID}_${_embedMode}`; }

function readHistory() {
  try { return JSON.parse(localStorage.getItem(histKey()) || '[]'); }
  catch (e) { return []; }
}

function saveHistorySnapshot() {
  const doc = _embedMode === 'layout' ? _layoutDoc : _embedDoc;
  if (!doc) return;
  const list = readHistory();
  const snap = JSON.stringify(doc);
  if (list.length && JSON.stringify(list[0].doc) === snap) return; // sin cambios
  list.unshift({ ts: Date.now(), doc: JSON.parse(snap) });
  try { localStorage.setItem(histKey(), JSON.stringify(list.slice(0, HIST_MAX))); }
  catch (e) { /* quota llena: el historial es red de seguridad, no crítico */ }
}

function scheduleHistorySnapshot() {
  clearTimeout(_histTimer);
  _histTimer = setTimeout(saveHistorySnapshot, 3000);
}

function historySummary(doc) {
  if (doc.blocks) return `Layout con ${doc.blocks.length} bloque(s)`;
  const n = doc.embeds.map(embedDict).filter(d => Object.keys(d).length).length;
  return `${n} embed(s)`;
}

function openHistoryModal() {
  saveHistorySnapshot(); // el estado actual también entra, así restaurar es reversible
  const list = readHistory();
  const body = el('div', { class: 'hist-list' });
  if (!list.length) body.append(emptyState('Todavía no hay versiones guardadas — se van a guardar solas a medida que editás.'));
  list.forEach((entry, i) => {
    const previewBox = el('div', { style: 'display:none' });
    let previewLoaded = false;
    const row = el('div', { class: 'hist-entry' },
      el('div', { class: 'hist-entry-head' },
        el('span', {}, new Date(entry.ts).toLocaleString()),
        el('span', { class: 'dim' }, historySummary(entry.doc)),
        el('button', {
          class: 'btn btn-secondary btn-sm',
          onclick: () => {
            if (!previewLoaded) {
              previewLoaded = true;
              previewBox.append(entry.doc.blocks
                ? renderLayoutPreview(entry.doc.blocks.map(blockToApi))
                : renderEmbedsPreview(entry.doc.embeds.map(embedDict)));
            }
            previewBox.style.display = previewBox.style.display === 'none' ? '' : 'none';
          },
        }, 'Ver'),
        el('button', {
          class: 'btn btn-primary btn-sm',
          onclick: () => {
            if (entry.doc.blocks) _layoutDoc = entry.doc; else _embedDoc = entry.doc;
            // Deshacer lineal: restaurar descarta las versiones posteriores.
            try { localStorage.setItem(histKey(), JSON.stringify(list.slice(i))); } catch (e) {}
            document.querySelector('.modal-overlay')?.remove();
            loadEmbeds();
          },
        }, 'Restaurar')),
      previewBox);
    body.append(row);
  });
  panelModal('Historial local', body);
}

// --- Borrador automático (autosave del estado en progreso) ---
// Distinto del historial de arriba: acá hay UN solo slot por guild+modo que
// se restaura solo al entrar, sin tope de versiones ni expiración por
// tiempo (localStorage no expira nada por sí solo, así que no hace falta
// lógica de TTL para lograr "indefinido" — solo evitar borrarlo por error).
// Vive hasta que el usuario lo descarta, limpia el editor, o lo consume un
// envío/guardado exitoso (ver saveEmbedDraft/clearEmbedDraft más abajo).
let _draftTimer = null;

function draftKey(mode) { return `purgito_draft_${GUILD_ID}_${mode}`; }

function saveEmbedDraft() {
  const doc = _embedMode === 'layout' ? _layoutDoc : _embedDoc;
  if (!doc) return;
  try { localStorage.setItem(draftKey(_embedMode), JSON.stringify(doc)); }
  catch (e) { /* quota llena: el borrador es una comodidad, no crítico */ }
}

function scheduleDraftSave() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(saveEmbedDraft, 3000);
}

function readEmbedDraft(mode) {
  try {
    const raw = localStorage.getItem(draftKey(mode));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearEmbedDraft(mode) {
  clearTimeout(_draftTimer);
  try { localStorage.removeItem(draftKey(mode)); } catch (e) {}
}

// --- Modo JSON (5.5) ---

function openJsonModal() {
  const isLayout = _embedMode === 'layout';
  const doc = isLayout ? _layoutDoc : _embedDoc;
  const payload = isLayout
    ? { blocks: doc.blocks.map(blockToApi) }
    : { embeds: docDicts(doc) };
  const ta = el('textarea', { class: 'json-editor', spellcheck: 'false' });
  ta.value = JSON.stringify(payload, null, 2);
  ta.wrap = 'off';
  const errBox = el('p', { class: 'error', style: 'min-height:1.2em;margin:6px 0' }, '');
  const applyBtn = el('button', { class: 'btn btn-primary', disabled: true }, 'Aplicar');
  let parsed = payload;
  let validateTimer = null;

  async function validate() {
    try { parsed = JSON.parse(ta.value); }
    catch (e) { errBox.textContent = 'JSON inválido: ' + e.message; applyBtn.disabled = true; return; }
    const body = isLayout
      ? { content_mode: 'layout_v2', layout: parsed }
      : { content_mode: 'classic_embed', embeds: parsed.embeds };
    try {
      const resp = await apiFetch(`/api/server/${GUILD_ID}/embeds/validate`, { method: 'POST', body });
      errBox.textContent = resp.ok ? '' : resp.error;
      applyBtn.disabled = !resp.ok;
    } catch (e) { errBox.textContent = e.message; applyBtn.disabled = true; }
  }
  ta.oninput = () => { clearTimeout(validateTimer); validateTimer = setTimeout(validate, 400); };

  const wrapChk = el('input', { type: 'checkbox' });
  wrapChk.onchange = () => { ta.wrap = wrapChk.checked ? 'soft' : 'off'; };

  applyBtn.onclick = () => {
    if (isLayout) doc.blocks = (parsed.blocks || []).map(apiToBlock);
    else { doc.embeds = (parsed.embeds && parsed.embeds.length ? parsed.embeds : [{}]).map(embedToState); doc.active = 0; }
    document.querySelector('.modal-overlay')?.remove();
    loadEmbeds();
  };

  panelModal('Editar como JSON', el('div', {},
    ta, errBox,
    el('div', { class: 'add-row' },
      applyBtn,
      el('button', { class: 'btn btn-secondary', onclick: () => document.querySelector('.modal-overlay')?.remove() }, 'Cancelar'),
      el('label', { class: 'toggle' }, wrapChk, 'Ajuste de línea'))));
  validate();
}

// --- Opciones de envío finas (5.6) ---

function blankSendOpts() { return { silent: false, restrict: false, roleIds: [] }; }

function sendOptsToApi(o) {
  if (!o || (!o.silent && !o.restrict)) return undefined; // defaults: no mandar nada
  return { silent: o.silent, restrict_mentions: o.restrict, allowed_role_ids: o.roleIds };
}

function sendOptsFromApi(so) {
  const o = blankSendOpts();
  if (so) {
    o.silent = !!so.silent;
    o.restrict = !!so.restrict_mentions;
    o.roleIds = (so.allowed_role_ids || []).map(String);
  }
  return o;
}

// Panel colapsable (details/summary nativo) con las opciones de envío.
function sendOptionsPanel(o, roles) {
  const silent = el('input', { type: 'checkbox', checked: o.silent });
  silent.onchange = () => { o.silent = silent.checked; };
  const restrict = el('input', { type: 'checkbox', checked: o.restrict });
  const roleSel = el('select', { multiple: 'multiple', size: '5', class: 'send-opts-roles' });
  for (const r of roles) {
    const opt = el('option', { value: r.id }, '@' + r.name);
    opt.selected = o.roleIds.includes(r.id);
    roleSel.append(opt);
  }
  roleSel.onchange = () => { o.roleIds = [...roleSel.selectedOptions].map(x => x.value); };
  const roleBlock = el('div', { class: 'field', style: o.restrict ? '' : 'display:none' },
    el('label', {}, 'Roles que SÍ pueden ser pingueados (vacío = nadie; Ctrl+click para varios)'),
    roleSel);
  restrict.onchange = () => { o.restrict = restrict.checked; roleBlock.style.display = o.restrict ? '' : 'none'; };
  const details = el('details', { class: 'send-opts' },
    el('summary', {}, 'Opciones de envío'),
    el('div', { class: 'field' }, el('label', { class: 'toggle' }, silent, 'Envío silencioso (sin notificación push)')),
    el('div', { class: 'field' }, el('label', { class: 'toggle' }, restrict, 'No mencionar a nadie salvo lo explícito')),
    roleBlock);
  if (o.silent || o.restrict) details.open = true;
  return details;
}

// Preview puro HTML/CSS de un embed de Discord; sin llamada al backend.
function renderEmbedPreview(e) {
  if (!Object.keys(e).length) return previewEmpty();
  const main = el('div', { class: 'd-embed-main' });
  if (e.author) {
    main.append(el('div', { class: 'd-embed-author' },
      e.author.icon_url ? previewImg({ src: e.author.icon_url, alt: '' }) : null,
      e.author.name));
  }
  // Título, descripción y fields soportan markdown/menciones como en Discord
  // real; autor y footer (más abajo) son texto plano — Discord no los formatea.
  if (e.title) main.append(el('div', { class: 'd-embed-title' }, ...mdToNodes(e.title)));
  if (e.description) main.append(el('div', { class: 'd-embed-desc' }, ...mdToNodes(e.description)));
  if (e.fields) {
    const grid = el('div', { class: 'd-embed-fields' });
    for (const f of e.fields) {
      grid.append(el('div', { class: 'd-embed-field' + (f.inline ? ' inline' : '') },
        el('div', { class: 'd-embed-field-name' }, ...mdToNodes(f.name)),
        el('div', { class: 'd-embed-field-value' }, ...mdToNodes(f.value))));
    }
    main.append(grid);
  }
  const body = el('div', { class: 'd-embed-body' }, main);
  if (e.thumbnail) body.append(el('div', { class: 'd-embed-thumb' }, previewImg({ src: e.thumbnail.url, alt: '' })));
  if (e.image) body.append(el('div', { class: 'd-embed-image' }, previewImg({ src: e.image.url, alt: '' })));
  if (e.footer) {
    body.append(el('div', { class: 'd-embed-footer' },
      e.footer.icon_url ? previewImg({ src: e.footer.icon_url, alt: '' }) : null,
      e.footer.text));
  }
  const color = typeof e.color === 'string' ? e.color : '#8B6EF5';
  return el('div', { class: 'd-embed' },
    el('div', { class: 'd-embed-bar', style: 'background:' + color }), body);
}

// Preview de todos los embeds del doc, apilados como los muestra Discord.
function renderEmbedsPreview(dicts) {
  const nonEmpty = dicts.filter(d => Object.keys(d).length);
  if (!nonEmpty.length) return previewEmpty();
  const stack = el('div', { class: 'd-embed-stack' });
  for (const d of nonEmpty) stack.append(renderEmbedPreview(d));
  return stack;
}

async function loadEmbeds() {
  closeInsertPopover();
  // Cambiar de tab/bloque/modo también persiste una versión en el historial.
  saveHistorySnapshot();
  const box = content();
  const tabs = el('div', { class: 'embed-tabs' },
    el('div', { class: 'embed-tab' + (_embedTab === 'editor' ? ' active' : ''), onclick: () => { _embedTab = 'editor'; loadEmbeds(); } }, 'Crear / Enviar'),
    el('div', { class: 'embed-tab' + (_embedTab === 'templates' ? ' active' : ''), onclick: () => { _embedTab = 'templates'; loadEmbeds(); } }, 'Mis plantillas'));
  const view = el('div', {});
  box.append(tabs, view);
  if (_embedTab === 'editor') await renderEmbedEditor(view);
  else await renderEmbedTemplates(view);
}

function modeRadio(mode, label) {
  return el('label', { class: 'toggle' },
    el('input', {
      type: 'radio', name: 'contentMode', checked: _embedMode === mode,
      onchange: () => { _embedMode = mode; loadEmbeds(); },
    }), label);
}

async function renderEmbedEditor(box) {
  box.append(spinner());
  let channels, roles;
  // roles solo lo usa el modo Layout (botones de "asignar rol"), pero
  // getChannels/getRoles cachean tras la primera visita, así que pedirlo
  // siempre es barato y evita otro roundtrip al cambiar de modo.
  try { [channels, roles] = await Promise.all([getChannels(), getRoles()]); }
  catch (e) { renderError(box, e); return; }
  box.innerHTML = '';

  // Selector de modo: embeds clásicos vs Layout V2 (excluyentes en Discord).
  box.append(el('div', { class: 'embed-mode-sel' },
    modeRadio('classic', 'Embeds clásicos'),
    modeRadio('layout', 'Layout V2')));
  const inner = el('div', {});
  box.append(inner);
  if (_embedMode === 'layout') renderLayoutEditor(inner, channels, roles);
  else renderClassicEditor(inner, channels, roles);
}

function renderClassicEditor(box, channels, roles) {
  if (!_embedDoc) {
    const draft = readEmbedDraft('classic');
    if (draft) {
      _embedDoc = draft;
      toast('Recuperamos tu borrador anterior', 'ok', {
        label: 'Descartar', onclick: () => { clearEmbedDraft('classic'); _embedDoc = blankDoc(); loadEmbeds(); },
      });
    } else {
      _embedDoc = blankDoc();
    }
  }
  const doc = _embedDoc;
  // Docs restaurados de un historial/borrador anterior a la Fase 5 no traen sendOpts.
  if (!doc.sendOpts) doc.sendOpts = blankSendOpts();
  const s = doc.embeds[doc.active];  // embed activo

  const previewBox = el('div', {});
  // Contador en vivo contra el límite de 6000 (suma de todos los embeds del
  // mensaje — mismo cálculo que validateEmbedsClient) + marca de tabs vacíos.
  const charCounter = el('span', { class: 'char-counter' });
  const embedPills = [];  // se llena al armar embedBar, más abajo
  function refreshEmbedMeta(dicts) {
    const total = dicts.reduce((n, d) => n + embedChars(d), 0);
    charCounter.textContent = `${total.toLocaleString('es')} / ${EMBED_LIMITS.total.toLocaleString('es')}`;
    charCounter.className = 'char-counter'
      + (total > EMBED_LIMITS.total ? ' over' : total >= EMBED_LIMITS.total * 0.9 ? ' near' : '');
    embedPills.forEach((pill, i) => {
      const empty = !Object.keys(dicts[i] || {}).length;
      pill.classList.toggle('empty', empty);
      pill.title = empty ? 'Este embed está vacío y no se va a enviar' : '';
    });
  }
  function updatePreview() {
    const dicts = doc.embeds.map(embedDict);
    previewBox.innerHTML = '';
    beginPreviewRender();
    previewBox.append(renderEmbedsPreview(dicts));
    endPreviewRender();
    refreshEmbedMeta(dicts);
    scheduleHistorySnapshot();
    scheduleDraftSave();
  }

  function bound(tag, key, attrs) {
    const node = el(tag, { ...attrs, value: s[key] });
    if (tag === 'textarea') { node.value = s[key]; node.classList.add('autogrow'); }
    node.oninput = () => {
      s[key] = node.value;
      if (tag === 'textarea') autoGrow(node);
      updatePreview();
    };
    return node;
  }

  function fieldBlock(label, node) {
    return el('div', { class: 'field' }, el('label', {}, label), node);
  }

  // --- fields dinámicos ---
  const fieldsBox = el('div', {});
  // Estado abierto/cerrado de cada field entre re-renders (reorden, duplicar,
  // borrar). Set de referencias a los objetos de s.fields — los splices mueven
  // las mismas refs, así que sobrevive. Regla inicial: ≤3 fields todos
  // abiertos, con más solo el primero (mismo criterio que accordionGroup).
  const openFields = new Set(s.fields.length <= 3 ? s.fields : s.fields.slice(0, 1));
  const addFieldBtn = el('button', {
    class: 'btn btn-secondary btn-sm',
    onclick: () => {
      const f = { name: '', value: '', inline: false };
      s.fields.push(f);
      openFields.add(f);  // recién agregado nace abierto para escribir ya
      renderFields();
      updatePreview();
    },
  }, '+ Agregar field');

  function renderFields() {
    fieldsBox.innerHTML = '';
    s.fields.forEach((f, i) => {
      // Header: "Field N" o "Field N — {nombre|valor}" (patrón fieldNText de
      // Discohook), actualizado en vivo mientras se escribe.
      const headText = () => {
        const t = (f.name || '').trim() || (f.value || '').trim();
        return `Field ${i + 1}` + (t ? ` — ${t.length > 40 ? t.slice(0, 40) + '…' : t}` : '');
      };
      const label = el('span', { class: 'embed-field-label' }, headText());

      const name = el('input', { type: 'text', placeholder: 'Nombre', maxlength: String(EMBED_LIMITS.fieldName), value: f.name });
      name.oninput = () => { f.name = name.value; label.textContent = headText(); updatePreview(); };
      const value = el('textarea', { placeholder: 'Valor', maxlength: String(EMBED_LIMITS.fieldValue), rows: '2' });
      value.value = f.value;
      value.oninput = () => { f.value = value.value; label.textContent = headText(); updatePreview(); };
      const inline = el('input', { type: 'checkbox', checked: f.inline });
      inline.onchange = () => { f.inline = inline.checked; updatePreview(); };

      // Solo el handle es draggable: arrastrar desde los inputs seguiría
      // seleccionando texto normalmente. DnD nativo (mismo enfoque que
      // Discohook) — no funciona en touch; ahí el fallback son los ▲/▼.
      const handle = el('span', {
        class: 'field-drag-handle', draggable: 'true',
        title: 'Arrastra para reordenar', 'aria-label': 'Arrastra para reordenar',
      }, '⠿');

      // Acciones del header. preventDefault evita que el click pliegue el
      // <details> (default de summary); el re-render repone visibilidad ▲/▼.
      const action = (icon, title, hidden, fn) => hidden ? null : el('button', {
        class: 'field-action' + (icon === '✗' ? ' danger' : ''), title, 'aria-label': title,
        onclick: (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); renderFields(); updatePreview(); },
      }, icon);
      const moveTo = (to) => { s.fields.splice(i, 1); s.fields.splice(to, 0, f); };
      const actions = el('span', { class: 'embed-field-actions' },
        action('▲', 'Mover arriba', i === 0, () => moveTo(i - 1)),
        action('▼', 'Mover abajo', i === s.fields.length - 1, () => moveTo(i + 1)),
        action('⧉', 'Duplicar', s.fields.length >= EMBED_LIMITS.fields, () => {
          const dup = { name: f.name, value: f.value, inline: f.inline };
          s.fields.splice(i + 1, 0, dup);
          openFields.add(dup);
        }),
        action('✗', 'Eliminar', false, () => { s.fields.splice(i, 1); openFields.delete(f); }));

      const det = el('details', { class: 'embed-field', open: openFields.has(f) ? '' : null },
        el('summary', { class: 'embed-field-head' }, handle, label, actions),
        el('div', { class: 'embed-field-body' },
          el('div', { class: 'embed-field-name-row' },
            name, el('label', { class: 'toggle' }, inline, 'inline')),
          value));
      det.ontoggle = () => { if (det.open) openFields.add(f); else openFields.delete(f); };

      handle.ondragstart = (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        det.classList.add('dragging');
      };
      handle.ondragend = () => det.classList.remove('dragging');
      det.ondragover = (e) => { e.preventDefault(); det.classList.add('drag-over'); };
      det.ondragleave = () => det.classList.remove('drag-over');
      det.ondrop = (e) => {
        e.preventDefault();
        det.classList.remove('drag-over');
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (Number.isNaN(from) || from === i) return;
        const [moved] = s.fields.splice(from, 1);
        s.fields.splice(i, 0, moved);
        renderFields();
        updatePreview();
      };
      fieldsBox.append(det);
    });
    addFieldBtn.disabled = s.fields.length >= EMBED_LIMITS.fields;
  }
  renderFields();

  // --- barra de embeds (tabs Embed 1..N + agregar + galería) ---
  const atMax = doc.embeds.length >= EMBED_LIMITS.count;
  const embedBar = el('div', { class: 'embed-bar-tabs' });
  doc.embeds.forEach((_, i) => {
    const pill = el('div', {
      class: 'embed-pill' + (i === doc.active ? ' active' : ''),
      onclick: () => { doc.active = i; loadEmbeds(); },
    },
      'Embed ' + (i + 1),
      doc.embeds.length > 1 ? el('span', {
        class: 'embed-pill-x',
        onclick: (ev) => {
          ev.stopPropagation();
          doc.embeds.splice(i, 1);
          if (doc.active >= doc.embeds.length) doc.active = doc.embeds.length - 1;
          loadEmbeds();
        },
      }, '✗') : null);
    embedPills.push(pill);
    embedBar.append(pill);
  });
  embedBar.append(el('button', {
    class: 'btn btn-secondary btn-sm', disabled: atMax || null,
    onclick: () => { doc.embeds.push(blankEmbed()); doc.active = doc.embeds.length - 1; loadEmbeds(); },
  }, '+ Agregar embed'));
  embedBar.append(el('button', {
    class: 'btn btn-secondary btn-sm', disabled: atMax || null,
    title: 'Agrupa varias imágenes en una galería compartiendo el enlace del embed actual',
    onclick: () => {
      if (!s.image.trim()) { toast('Agrega primero una imagen a este embed', 'warn'); return; }
      // Discord agrupa en galería los embeds que comparten el mismo `url`;
      // usamos la imagen del embed activo como enlace compartido.
      const shared = s.url.trim() || s.image.trim();
      s.url = shared;
      const extra = blankEmbed();
      extra.url = shared;
      doc.embeds.push(extra);
      doc.active = doc.embeds.length - 1;
      loadEmbeds();
    },
  }, '+ Galería'));

  // --- destino y modo de envío (persistidos en el doc) ---
  const chSel = channelSelect(channels, doc.channelId, 'Canal destino…');
  chSel.onchange = () => { doc.channelId = chSel.value; };
  const modeNow = el('input', { type: 'radio', name: 'embedMode', checked: doc.sendMode === 'now' });
  const modeSched = el('input', { type: 'radio', name: 'embedMode', checked: doc.sendMode === 'sched' });
  const schedType = el('select', {},
    el('option', { value: 'interval' }, 'Por intervalo'),
    el('option', { value: 'daily' }, 'A hora fija'));
  schedType.value = doc.schedType;
  const intervalInput = el('input', { type: 'number', min: '5', max: '1440', value: doc.interval, style: 'width:110px' });
  const timeInput = el('input', { type: 'time', value: doc.time });
  const schedControls = el('div', { class: 'add-row', style: 'margin-top:8px' },
    schedType, intervalInput, timeInput);

  function syncSched() {
    doc.sendMode = modeSched.checked ? 'sched' : 'now';
    doc.schedType = schedType.value;
    schedControls.style.display = modeSched.checked ? '' : 'none';
    const daily = schedType.value === 'daily';
    intervalInput.style.display = daily ? 'none' : '';
    timeInput.style.display = daily ? '' : 'none';
    sendBtn.textContent = modeSched.checked ? 'Programar' : 'Enviar ahora';
  }
  modeNow.onchange = modeSched.onchange = schedType.onchange = syncSched;
  intervalInput.oninput = () => { doc.interval = intervalInput.value; };
  timeInput.oninput = () => { doc.time = timeInput.value; };

  // Error de validación persistente sobre la barra de acciones (el toast se
  // reserva para el resultado async de enviar/programar).
  const alertBox = el('div', {});

  const sendBtn = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      const dicts = docDicts(doc);
      const err = validateEmbedsClient(dicts);
      if (err) { showFormAlert(alertBox, err); return; }
      if (!chSel.value) { showFormAlert(alertBox, 'Elige un canal destino'); return; }
      showFormAlert(alertBox, '');
      try {
        const sendOpts = sendOptsToApi(doc.sendOpts);
        if (modeSched.checked) {
          const body = { channel_id: chSel.value, embeds: dicts, mode: schedType.value, send_options: sendOpts };
          if (schedType.value === 'interval') {
            body.interval_minutes = parseInt(intervalInput.value, 10);
          } else {
            const [h, m] = timeInput.value.split(':');
            body.hour = parseInt(h, 10); body.minute = parseInt(m, 10);
          }
          await apiFetch(`/api/server/${GUILD_ID}/embeds/schedule`, { method: 'POST', body });
          toast('Embed programado', 'ok');
        } else {
          await apiFetch(`/api/server/${GUILD_ID}/embeds/send`, { method: 'POST', body: { channel_id: chSel.value, embeds: dicts, send_options: sendOpts } });
          toast(dicts.length > 1 ? `${dicts.length} embeds enviados` : 'Embed enviado', 'ok');
          // Envío inmediato ya salió: el borrador de "lo que tengo a medio
          // escribir" dejó de tener sentido (a diferencia de programar, donde
          // seguís editando variantes). Ver criterio en el reporte.
          clearEmbedDraft('classic');
        }
      } catch (err2) { toast(err2.message, err2.status === 429 ? 'warn' : 'err'); }
    },
  }, 'Enviar ahora');

  const saveBtn = el('button', {
    class: 'btn btn-secondary',
    onclick: async () => {
      const dicts = docDicts(doc);
      const err = validateEmbedsClient(dicts);
      if (err) { showFormAlert(alertBox, err); return; }
      showFormAlert(alertBox, '');
      const name = (prompt('Nombre de la plantilla:', doc.templateName || '') || '').trim();
      if (!name) return;
      try {
        const body = { name, embeds: dicts, send_options: sendOptsToApi(doc.sendOpts) };
        if (doc.templateId) {
          await apiFetch(`/api/server/${GUILD_ID}/embeds/templates/${doc.templateId}`, { method: 'PUT', body });
          toast('Plantilla actualizada', 'ok');
        } else {
          const resp = await apiFetch(`/api/server/${GUILD_ID}/embeds/templates`, { method: 'POST', body });
          doc.templateId = resp.id;
          toast('Plantilla guardada', 'ok');
        }
        doc.templateName = name;
      } catch (err2) { toast(err2.message, err2.status === 409 ? 'warn' : 'err'); }
    },
  }, 'Guardar como plantilla');

  const clearBtn = el('button', {
    class: 'btn btn-secondary',
    onclick: () => { clearEmbedDraft('classic'); _embedDoc = blankDoc(); loadEmbeds(); },
  }, 'Limpiar');

  const histBtn = el('button', { class: 'btn btn-secondary', onclick: openHistoryModal }, 'Historial');
  const jsonBtn = el('button', { class: 'btn btn-secondary', onclick: openJsonModal }, 'Ver/editar JSON');

  const form = el('div', { class: 'embed-form' },
    embedBar,
    accordionGroup('Cuerpo', true,
      fieldBlock('Título', bound('input', 'title', { type: 'text', maxlength: String(EMBED_LIMITS.title) })),
      fieldBlock('Descripción', insertWrap(
        bound('textarea', 'description', { maxlength: String(EMBED_LIMITS.description) }),
        ['menciones', 'fecha', 'emoji'])),
      fieldBlock('Color', colorField(s, 'color', updatePreview))),
    accordionGroup('Autor', !!(s.authorName || s.authorIcon),
      el('div', { class: 'embed-two' },
        fieldBlock('Nombre', insertWrap(
          bound('input', 'authorName', { type: 'text', maxlength: String(EMBED_LIMITS.author) }), ['emoji'])),
        fieldBlock('Ícono del autor', imageField(s, 'authorIcon', updatePreview)))),
    accordionGroup('Imágenes', !!(s.thumbnail || s.image),
      el('div', { class: 'embed-two' },
        fieldBlock('Thumbnail', imageField(s, 'thumbnail', updatePreview, { gif: true })),
        fieldBlock('Imagen grande', imageField(s, 'image', updatePreview, { gif: true })))),
    accordionGroup('Footer', !!(s.footerText || s.footerIcon),
      el('div', { class: 'embed-two' },
        fieldBlock('Texto', insertWrap(
          bound('input', 'footerText', { type: 'text', maxlength: String(EMBED_LIMITS.footer) }), ['emoji'])),
        fieldBlock('Ícono del footer', imageField(s, 'footerIcon', updatePreview)))),
    accordionGroup('Fields', s.fields.length > 0,
      el('div', { class: 'field' }, fieldsBox, addFieldBtn)),
    formGroup('Destino y envío',
      el('div', { class: 'field' }, el('label', {}, 'Canal destino'), chSel),
      el('div', { class: 'field' },
        el('label', { class: 'toggle' }, modeNow, 'Enviar ahora'),
        el('label', { class: 'toggle' }, modeSched, 'Programar'),
        schedControls),
      sendOptionsPanel(doc.sendOpts, roles)),
    alertBox,
    el('div', { class: 'embed-actions' },
      sendBtn, saveBtn, clearBtn,
      el('span', { class: 'embed-actions-spacer' }),
      histBtn, jsonBtn));

  box.append(el('div', { class: 'embed-layout' },
    form,
    el('div', { class: 'd-embed-wrap' },
      el('p', { class: 'dim preview-header', style: 'margin-top:0' }, 'Preview', charCounter),
      previewBox)));
  box.querySelectorAll('.autogrow').forEach(autoGrow);
  updatePreview();
  syncSched();
}

// ---------- Editor Layout V2 (Components V2) ----------

const BLOCK_LABELS = {
  text: 'Texto', section: 'Sección', media_gallery: 'Galería',
  separator: 'Separador', action_row: 'Botones', container: 'Container',
};

function blankLayoutDoc() {
  return { blocks: [], channelId: '', sendMode: 'now', schedType: 'interval',
           interval: '60', time: '09:00', templateId: null, templateName: '',
           sendOpts: blankSendOpts() };
}

function newBlock(type) {
  if (type === 'text') return { type: 'text', content: '' };
  if (type === 'section') return { type: 'section', texts: [''], accessory: { type: 'thumbnail', url: '', description: '', label: '', style: 'link', role_id: '' } };
  if (type === 'media_gallery') return { type: 'media_gallery', items: [{ url: '', description: '' }] };
  if (type === 'separator') return { type: 'separator', visible: true, spacing: 'small' };
  if (type === 'action_row') return { type: 'action_row', buttons: [{ style: 'link', label: '', url: '', role_id: '' }] };
  return { type: 'container', accent: true, accent_color: '#8B6EF5', children: [] };
}

function colorToHex(c) {
  if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0');
  return typeof c === 'string' ? c : null;
}

// Estado de un botón del editor -> dict API. Botones "role" nunca llevan
// custom_id desde el frontend — lo asigna el backend recién al enviar/programar.
function buttonToApi(bt) {
  if (bt.style === 'role') {
    return { style: 'role', label: bt.label, role_id: bt.role_id ? parseInt(bt.role_id, 10) : null };
  }
  return { style: 'link', label: bt.label, url: bt.url };
}

function buttonFromApi(bt) {
  return { style: bt.style === 'role' ? 'role' : 'link', label: bt.label || '', url: bt.url || '', role_id: bt.role_id != null ? String(bt.role_id) : '' };
}

// Estado del editor -> dict de bloque estilo API (lo que valida/construye el backend).
function blockToApi(b) {
  if (b.type === 'container') {
    return { type: 'container', accent_color: b.accent ? b.accent_color : null, children: b.children.map(blockToApi) };
  }
  if (b.type === 'text') return { type: 'text', content: b.content };
  if (b.type === 'section') {
    const acc = b.accessory.type === 'thumbnail'
      ? { type: 'thumbnail', url: b.accessory.url, description: b.accessory.description }
      : { type: 'button', ...buttonToApi(b.accessory) };
    return { type: 'section', texts: b.texts.slice(), accessory: acc };
  }
  if (b.type === 'media_gallery') return { type: 'media_gallery', items: b.items.map(it => ({ url: it.url, description: it.description })) };
  if (b.type === 'separator') return { type: 'separator', visible: b.visible, spacing: b.spacing };
  return { type: 'action_row', buttons: b.buttons.map(buttonToApi) };
}

// Inverso: dict de bloque guardado -> estado del editor.
function apiToBlock(b) {
  if (b.type === 'container') return { type: 'container', accent: b.accent_color != null, accent_color: colorToHex(b.accent_color) || '#8B6EF5', children: (b.children || []).map(apiToBlock) };
  if (b.type === 'section') {
    const a = b.accessory || {};
    return { type: 'section', texts: (b.texts || ['']).slice(), accessory: { type: a.type === 'button' ? 'button' : 'thumbnail', url: a.url || '', description: a.description || '', ...buttonFromApi(a) } };
  }
  if (b.type === 'media_gallery') return { type: 'media_gallery', items: (b.items || []).map(it => ({ url: it.url || '', description: it.description || '' })) };
  if (b.type === 'separator') return { type: 'separator', visible: b.visible !== false, spacing: b.spacing || 'small' };
  if (b.type === 'action_row') return { type: 'action_row', buttons: (b.buttons || []).map(buttonFromApi) };
  return { type: 'text', content: b.content || '' };
}

function docFromLayout(layout, templateId, templateName, sendOptions) {
  const doc = blankLayoutDoc();
  doc.blocks = (layout.blocks || []).map(apiToBlock);
  doc.templateId = templateId || null;
  doc.templateName = templateName || '';
  doc.sendOpts = sendOptsFromApi(sendOptions || layout.send_options);
  return doc;
}

// --- Outline de bloques (5.3): resumen, advertencias y conteo de componentes ---

function firstWords(text, max = 40) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t;
}

// Adelanto corto del contenido de un bloque para su fila colapsada.
function blockSummary(b) {
  if (b.type === 'text') return firstWords(b.content);
  if (b.type === 'section') return firstWords((b.texts || []).find(t => t.trim()) || '');
  if (b.type === 'media_gallery') {
    const n = b.items.filter(it => it.url.trim()).length;
    return n ? `${n} imagen(es)` : '';
  }
  if (b.type === 'action_row') return b.buttons.map(bt => bt.label.trim()).filter(Boolean).join(', ');
  if (b.type === 'separator') return b.visible ? 'línea visible' : 'solo espacio';
  if (b.type === 'container') return `${b.children.length} bloque(s)`;
  return '';
}

function btnWarn(bt) {
  if (!bt.label.trim()) return 'Botón sin texto';
  if (bt.style === 'link' && !/^https?:\/\//.test((bt.url || '').trim())) return 'Botón sin URL válida';
  if (bt.style === 'role' && !bt.role_id) return 'Botón sin rol elegido';
  return null;
}

// Problema de validación visible en la fila colapsada, sin expandir el bloque.
function blockWarning(b) {
  if (b.type === 'text' && !b.content.trim()) return 'Texto vacío';
  if (b.type === 'section') {
    if (!(b.texts || []).some(t => t.trim())) return 'Sección sin texto';
    if (b.accessory.type === 'thumbnail' && !b.accessory.url.trim()) return 'Miniatura sin imagen';
    if (b.accessory.type === 'button') return btnWarn(b.accessory);
  }
  if (b.type === 'media_gallery' && !b.items.some(it => it.url.trim())) return 'Galería sin imágenes';
  if (b.type === 'action_row') {
    if (!b.buttons.length) return 'Fila sin botones';
    for (const bt of b.buttons) { const w = btnWarn(bt); if (w) return w; }
  }
  if (b.type === 'container') {
    if (!b.children.length) return 'Container vacío';
    for (const c of b.children) { const w = blockWarning(c); if (w) return w; }
  }
  return null;
}

// Espejo del conteo de validate_layout_v2_payload (máx 40 componentes).
function componentCount(blocks) {
  let n = 0;
  for (const b of blocks) {
    n++;
    if (b.type === 'container') n += componentCount(b.children);
    else if (b.type === 'section') n += b.texts.length + 1; // textos + accesorio
    else if (b.type === 'action_row') n += b.buttons.length;
  }
  return n;
}

// Al duplicar, limpiar cualquier identificador único (custom_id de botones)
// para que la copia no colisione con el original. El estado del editor no
// suele llevarlos (se mintean en el backend), pero un doc restaurado de
// historial o pegado por JSON podría traerlos.
function stripBlockIds(b) {
  delete b.custom_id;
  (b.buttons || []).forEach(bt => delete bt.custom_id);
  if (b.accessory) delete b.accessory.custom_id;
  (b.children || []).forEach(stripBlockIds);
}

const LAYOUT_MAX_COMPONENTS = 40;

// Lista editable de bloques (recursiva: un container tiene su propia lista).
function renderBlocks(listEl, blocks, inContainer, onChange, roles) {
  listEl.innerHTML = '';
  // Numeración correlativa POR TIPO (un Separator entre dos Textos no corre
  // la numeración de los Textos).
  const typeCounts = {};
  blocks.forEach((b, i) => {
    typeCounts[b.type] = (typeCounts[b.type] || 0) + 1;
    listEl.append(renderBlockCard(listEl, blocks, i, typeCounts[b.type], inContainer, onChange, roles));
  });
  // Outline recién iniciado: invitar a agregar el primer bloque en vez de una
  // lista vacía sin indicación.
  if (!blocks.length && !inContainer) {
    listEl.append(el('div', { class: 'outline-empty' },
      'Todavía no hay bloques. Agregá el primero con los botones de abajo.'));
  }
  const adder = el('div', { class: 'add-row layout-adder' });
  const atMax = componentCount(_layoutDoc ? _layoutDoc.blocks : blocks) >= LAYOUT_MAX_COMPONENTS;
  const types = [['text', '+ Texto'], ['section', '+ Sección'], ['media_gallery', '+ Galería'],
                 ['separator', '+ Separador'], ['action_row', '+ Botones']];
  if (!inContainer) types.push(['container', '+ Container']);
  for (const [t, label] of types) {
    adder.append(el('button', {
      class: 'btn btn-secondary btn-sm',
      disabled: atMax || null,
      title: atMax ? `Límite de ${LAYOUT_MAX_COMPONENTS} componentes por mensaje alcanzado` : null,
      onclick: () => { blocks.push(newBlock(t)); renderBlocks(listEl, blocks, inContainer, onChange, roles); onChange(); },
    }, label));
  }
  listEl.append(adder);
}

function renderBlockCard(listEl, blocks, i, typeNum, inContainer, onChange, roles) {
  const b = blocks[i];
  function rerender() { renderBlocks(listEl, blocks, inContainer, onChange, roles); onChange(); }
  const warn = blockWarning(b);
  const summary = blockSummary(b);
  const body = el('div', { class: 'layout-block-body' }, renderBlockForm(b, onChange, roles));
  if (b._collapsed) body.style.display = 'none';
  const toggle = el('button', {
    class: 'btn btn-secondary btn-sm',
    title: b._collapsed ? 'Expandir' : 'Colapsar',
    onclick: () => {
      // _collapsed vive solo en el estado del editor (blockToApi nunca lo copia).
      b._collapsed = !b._collapsed;
      rerender();
    },
  }, b._collapsed ? '▸' : '▾');
  const head = el('div', { class: 'layout-block-head' },
    el('span', { class: 'layout-block-title' },
      toggle,
      el('span', { class: 'layout-block-type' }, `${BLOCK_LABELS[b.type]} ${typeNum}`),
      warn ? el('span', { class: 'layout-warn', title: warn }, '!') : null,
      summary ? el('span', { class: 'layout-block-summary dim' }, summary) : null),
    el('span', { class: 'layout-block-actions' },
      el('button', {
        class: 'btn btn-secondary btn-sm', title: 'Duplicar bloque',
        disabled: componentCount(_layoutDoc ? _layoutDoc.blocks : blocks) >= LAYOUT_MAX_COMPONENTS || null,
        onclick: () => {
          const copy = structuredClone(b);
          stripBlockIds(copy);
          blocks.splice(i + 1, 0, copy);
          rerender();
        },
      }, '⧉'),
      el('button', { class: 'btn btn-secondary btn-sm', disabled: i === 0 || null, onclick: () => { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; rerender(); } }, '↑'),
      el('button', { class: 'btn btn-secondary btn-sm', disabled: i === blocks.length - 1 || null, onclick: () => { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; rerender(); } }, '↓'),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => { blocks.splice(i, 1); rerender(); } }, '✗')));
  return el('div', { class: 'layout-block' }, head, body);
}

// Campos de un botón: selector Enlace/Asignar rol + los inputs correspondientes.
function buttonStyleFields(bt, onChange, roles) {
  const styleSel = el('select', {}, el('option', { value: 'link' }, 'Enlace'), el('option', { value: 'role' }, 'Asignar rol'));
  styleSel.value = bt.style || 'link';
  const label = el('input', { type: 'text', placeholder: 'Texto del botón', maxlength: '80', value: bt.label });
  label.oninput = () => { bt.label = label.value; onChange(); };
  const urlInput = el('input', { type: 'url', placeholder: 'https://…', value: bt.url || '' });
  urlInput.oninput = () => { bt.url = urlInput.value; onChange(); };
  const roleSel = roleSelect(roles, bt.role_id, 'Elegir rol…');
  roleSel.onchange = () => { bt.role_id = roleSel.value; onChange(); };
  function sync() {
    const isRole = styleSel.value === 'role';
    urlInput.style.display = isRole ? 'none' : '';
    roleSel.style.display = isRole ? '' : 'none';
  }
  styleSel.onchange = () => { bt.style = styleSel.value; sync(); onChange(); };
  sync();
  return el('div', { class: 'add-row layout-btn-fields' }, styleSel, label, urlInput, roleSel);
}

function renderBlockForm(b, onChange, roles) {
  if (b.type === 'text') {
    const ta = el('textarea', { class: 'autogrow', placeholder: 'Texto (markdown de Discord)' });
    ta.value = b.content;
    ta.oninput = () => { b.content = ta.value; autoGrow(ta); onChange(); };
    return insertWrap(ta, ['menciones', 'fecha', 'emoji']);
  }
  if (b.type === 'separator') {
    const vis = el('input', { type: 'checkbox', checked: b.visible });
    vis.onchange = () => { b.visible = vis.checked; onChange(); };
    const sp = el('select', {}, el('option', { value: 'small' }, 'Espacio chico'), el('option', { value: 'large' }, 'Espacio grande'));
    sp.value = b.spacing;
    sp.onchange = () => { b.spacing = sp.value; onChange(); };
    return el('div', { class: 'add-row' }, el('label', { class: 'toggle' }, vis, 'Línea visible'), sp);
  }
  if (b.type === 'media_gallery') {
    const box = el('div', {});
    function renderItems() {
      box.innerHTML = '';
      b.items.forEach((it, idx) => {
        const desc = el('input', { type: 'text', placeholder: 'Descripción (opcional)', value: it.description });
        desc.oninput = () => { it.description = desc.value; onChange(); };
        box.append(el('div', { class: 'gallery-item-row' },
          imageField(it, 'url', onChange),
          desc,
          b.items.length > 1 ? el('button', { class: 'btn btn-danger btn-sm', onclick: () => { b.items.splice(idx, 1); renderItems(); onChange(); } }, '✗') : null));
      });
      box.append(el('button', { class: 'btn btn-secondary btn-sm', disabled: b.items.length >= 10 || null, onclick: () => { b.items.push({ url: '', description: '' }); renderItems(); onChange(); } }, '+ Imagen'));
    }
    renderItems();
    return box;
  }
  if (b.type === 'action_row') {
    const box = el('div', {});
    function renderBtns() {
      box.innerHTML = '';
      b.buttons.forEach((bt, idx) => {
        box.append(el('div', { class: 'layout-btn-row' },
          buttonStyleFields(bt, onChange, roles),
          el('button', { class: 'btn btn-danger btn-sm', onclick: () => { b.buttons.splice(idx, 1); renderBtns(); onChange(); } }, '✗')));
      });
      box.append(el('button', { class: 'btn btn-secondary btn-sm', disabled: b.buttons.length >= 5 || null, onclick: () => { b.buttons.push({ style: 'link', label: '', url: '', role_id: '' }); renderBtns(); onChange(); } }, '+ Botón'));
    }
    renderBtns();
    return box;
  }
  if (b.type === 'section') {
    const box = el('div', {});
    const textsBox = el('div', {});
    function renderTexts() {
      textsBox.innerHTML = '';
      b.texts.forEach((tx, idx) => {
        const inp = el('input', { type: 'text', placeholder: 'Texto ' + (idx + 1), value: tx });
        inp.oninput = () => { b.texts[idx] = inp.value; onChange(); };
        textsBox.append(el('div', { class: 'add-row' }, insertWrap(inp, ['menciones', 'fecha', 'emoji']),
          b.texts.length > 1 ? el('button', { class: 'btn btn-danger btn-sm', onclick: () => { b.texts.splice(idx, 1); renderTexts(); onChange(); } }, '✗') : null));
      });
      textsBox.append(el('button', { class: 'btn btn-secondary btn-sm', disabled: b.texts.length >= 3 || null, onclick: () => { b.texts.push(''); renderTexts(); onChange(); } }, '+ Texto'));
    }
    renderTexts();
    const accType = el('select', {}, el('option', { value: 'thumbnail' }, 'Miniatura'), el('option', { value: 'button' }, 'Botón'));
    accType.value = b.accessory.type;
    const accBox = el('div', {});
    function renderAcc() {
      accBox.innerHTML = '';
      if (b.accessory.type === 'thumbnail') {
        const desc = el('input', { type: 'text', placeholder: 'Descripción (opcional)', value: b.accessory.description });
        desc.oninput = () => { b.accessory.description = desc.value; onChange(); };
        accBox.append(el('div', { class: 'add-row' }, imageField(b.accessory, 'url', onChange), desc));
      } else {
        accBox.append(buttonStyleFields(b.accessory, onChange, roles));
      }
    }
    accType.onchange = () => { b.accessory.type = accType.value; renderAcc(); onChange(); };
    renderAcc();
    return el('div', {},
      el('div', { class: 'field' }, el('label', {}, 'Textos (máx 3)'), textsBox),
      el('div', { class: 'field' }, el('label', {}, 'Accesorio'), accType, accBox));
  }
  // container
  const box = el('div', {});
  const accentChk = el('input', { type: 'checkbox', checked: b.accent });
  accentChk.onchange = () => { b.accent = accentChk.checked; onChange(); };
  box.append(el('div', { class: 'add-row' }, el('label', { class: 'toggle' }, accentChk, 'Barra de color'), colorField(b, 'accent_color', onChange)));
  const nested = el('div', { class: 'layout-nested' });
  renderBlocks(nested, b.children, true, onChange, roles);
  box.append(nested);
  return box;
}

// Preview anidado de un layout (bloques ya en formato API).
function renderLayoutPreview(blocks) {
  if (!blocks.length) return previewEmpty('Agrega bloques para ver tu mensaje');
  const wrap = el('div', { class: 'lv2-preview' });
  for (const b of blocks) wrap.append(renderPreviewBlock(b));
  return wrap;
}

// Botón del preview: los de "asignar rol" llevan una etiqueta de texto (sin
// emoji, mismo criterio del resto del panel) para distinguirlos de un link.
function lv2Button(bt) {
  return el('span', { class: 'lv2-btn' + (bt.style === 'role' ? ' lv2-btn-role' : '') },
    bt.label || 'botón', bt.style === 'role' ? el('span', { class: 'lv2-btn-tag' }, 'ROL') : null);
}

function renderPreviewBlock(b) {
  if (b.type === 'container') {
    const inner = el('div', { class: 'lv2-container-inner' });
    for (const c of b.children) inner.append(renderPreviewBlock(c));
    const cont = el('div', { class: 'lv2-container' }, inner);
    if (b.accent_color != null) cont.style.borderLeft = '4px solid ' + (colorToHex(b.accent_color) || '#8B6EF5');
    return cont;
  }
  if (b.type === 'text') return el('div', { class: 'lv2-text' }, ...mdToNodes(b.content || ''));
  if (b.type === 'section') {
    const texts = el('div', { class: 'lv2-section-texts' },
      b.texts.map(t => el('div', { class: 'lv2-text' }, ...mdToNodes(t))));
    let acc;
    if (b.accessory.type === 'thumbnail') acc = b.accessory.url ? previewImg({ src: b.accessory.url, alt: '', class: 'lv2-thumb' }) : null;
    else acc = lv2Button(b.accessory);
    return el('div', { class: 'lv2-section' }, texts, el('div', { class: 'lv2-accessory' }, acc));
  }
  if (b.type === 'media_gallery') {
    const grid = el('div', { class: 'lv2-gallery' });
    for (const it of b.items) if (it.url) grid.append(previewImg({ src: it.url, alt: it.description || '' }));
    return grid;
  }
  if (b.type === 'separator') return el('div', { class: 'lv2-sep' + (b.visible ? ' visible' : '') });
  if (b.type === 'action_row') return el('div', { class: 'lv2-row' }, b.buttons.map(lv2Button));
  return el('div', {});
}

function renderLayoutEditor(box, channels, roles) {
  if (!_layoutDoc) {
    const draft = readEmbedDraft('layout');
    if (draft) {
      _layoutDoc = draft;
      toast('Recuperamos tu borrador anterior', 'ok', {
        label: 'Descartar', onclick: () => { clearEmbedDraft('layout'); _layoutDoc = blankLayoutDoc(); loadEmbeds(); },
      });
    } else {
      _layoutDoc = blankLayoutDoc();
    }
  }
  const doc = _layoutDoc;
  if (!doc.sendOpts) doc.sendOpts = blankSendOpts();

  box.append(el('div', { class: 'embed-warn' },
    'Los layouts V2 no pueden combinar con embeds clásicos en el mismo mensaje — es una limitación de Discord, no del panel.'));

  const previewBox = el('div', {});
  function updatePreview() {
    previewBox.innerHTML = '';
    beginPreviewRender();
    previewBox.append(renderLayoutPreview(doc.blocks.map(blockToApi)));
    endPreviewRender();
    scheduleHistorySnapshot();
    scheduleDraftSave();
  }

  const blocksList = el('div', { class: 'layout-list' });
  renderBlocks(blocksList, doc.blocks, false, updatePreview, roles);

  // destino + modo de envío (persistidos en el doc), misma UX que el clásico.
  const chSel = channelSelect(channels, doc.channelId, 'Canal destino…');
  chSel.onchange = () => { doc.channelId = chSel.value; };
  const modeNow = el('input', { type: 'radio', name: 'lvMode', checked: doc.sendMode === 'now' });
  const modeSched = el('input', { type: 'radio', name: 'lvMode', checked: doc.sendMode === 'sched' });
  const schedType = el('select', {}, el('option', { value: 'interval' }, 'Por intervalo'), el('option', { value: 'daily' }, 'A hora fija'));
  schedType.value = doc.schedType;
  const intervalInput = el('input', { type: 'number', min: '5', max: '1440', value: doc.interval, style: 'width:110px' });
  const timeInput = el('input', { type: 'time', value: doc.time });
  const schedControls = el('div', { class: 'add-row', style: 'margin-top:8px' }, schedType, intervalInput, timeInput);

  function syncSched() {
    doc.sendMode = modeSched.checked ? 'sched' : 'now';
    doc.schedType = schedType.value;
    schedControls.style.display = modeSched.checked ? '' : 'none';
    const daily = schedType.value === 'daily';
    intervalInput.style.display = daily ? 'none' : '';
    timeInput.style.display = daily ? '' : 'none';
    sendBtn.textContent = modeSched.checked ? 'Programar' : 'Enviar ahora';
  }
  modeNow.onchange = modeSched.onchange = schedType.onchange = syncSched;
  intervalInput.oninput = () => { doc.interval = intervalInput.value; };
  timeInput.oninput = () => { doc.time = timeInput.value; };

  const alertBox = el('div', {});

  const sendBtn = el('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      if (!doc.blocks.length) { showFormAlert(alertBox, 'Agrega al menos un bloque'); return; }
      if (!chSel.value) { showFormAlert(alertBox, 'Elige un canal destino'); return; }
      showFormAlert(alertBox, '');
      const layout = { blocks: doc.blocks.map(blockToApi) };
      try {
        const sendOpts = sendOptsToApi(doc.sendOpts);
        if (modeSched.checked) {
          const body = { channel_id: chSel.value, content_mode: 'layout_v2', layout, mode: schedType.value, send_options: sendOpts };
          if (schedType.value === 'interval') body.interval_minutes = parseInt(intervalInput.value, 10);
          else { const [h, m] = timeInput.value.split(':'); body.hour = parseInt(h, 10); body.minute = parseInt(m, 10); }
          await apiFetch(`/api/server/${GUILD_ID}/embeds/schedule`, { method: 'POST', body });
          toast('Layout programado', 'ok');
        } else {
          await apiFetch(`/api/server/${GUILD_ID}/embeds/send`, { method: 'POST', body: { channel_id: chSel.value, content_mode: 'layout_v2', layout, send_options: sendOpts } });
          toast('Layout enviado', 'ok');
          clearEmbedDraft('layout'); // ver criterio (envío inmediato) en el reporte
        }
      } catch (e) { toast(e.message, e.status === 429 ? 'warn' : 'err'); }
    },
  }, 'Enviar ahora');

  const saveBtn = el('button', {
    class: 'btn btn-secondary',
    onclick: async () => {
      if (!doc.blocks.length) { showFormAlert(alertBox, 'Agrega al menos un bloque'); return; }
      showFormAlert(alertBox, '');
      const layout = { blocks: doc.blocks.map(blockToApi) };
      const name = (prompt('Nombre de la plantilla:', doc.templateName || '') || '').trim();
      if (!name) return;
      try {
        const body = { name, content_mode: 'layout_v2', layout, send_options: sendOptsToApi(doc.sendOpts) };
        if (doc.templateId) {
          await apiFetch(`/api/server/${GUILD_ID}/embeds/templates/${doc.templateId}`, { method: 'PUT', body });
          toast('Plantilla actualizada', 'ok');
        } else {
          const resp = await apiFetch(`/api/server/${GUILD_ID}/embeds/templates`, { method: 'POST', body });
          doc.templateId = resp.id;
          toast('Plantilla guardada', 'ok');
        }
        doc.templateName = name;
      } catch (e) { toast(e.message, e.status === 409 ? 'warn' : 'err'); }
    },
  }, 'Guardar como plantilla');

  const clearBtn = el('button', { class: 'btn btn-secondary', onclick: () => { clearEmbedDraft('layout'); _layoutDoc = blankLayoutDoc(); loadEmbeds(); } }, 'Limpiar');
  const histBtn = el('button', { class: 'btn btn-secondary', onclick: openHistoryModal }, 'Historial');
  const jsonBtn = el('button', { class: 'btn btn-secondary', onclick: openJsonModal }, 'Ver/editar JSON');

  const form = el('div', { class: 'embed-form' },
    formGroup('Bloques',
      el('div', { class: 'field' }, blocksList)),
    formGroup('Destino y envío',
      el('div', { class: 'field' }, el('label', {}, 'Canal destino'), chSel),
      el('div', { class: 'field' },
        el('label', { class: 'toggle' }, modeNow, 'Enviar ahora'),
        el('label', { class: 'toggle' }, modeSched, 'Programar'),
        schedControls),
      sendOptionsPanel(doc.sendOpts, roles)),
    alertBox,
    el('div', { class: 'embed-actions' },
      sendBtn, saveBtn, clearBtn,
      el('span', { class: 'embed-actions-spacer' }),
      histBtn, jsonBtn));

  box.append(el('div', { class: 'embed-layout' },
    form,
    el('div', { class: 'd-embed-wrap' }, el('p', { class: 'dim', style: 'margin-top:0' }, 'Preview'), previewBox)));
  box.querySelectorAll('.autogrow').forEach(autoGrow);
  updatePreview();
  syncSched();
}

// Snippet de texto legible del primer embed no vacío de una plantilla.
function templateSnippet(embeds) {
  const e = embeds.find(x => x && Object.keys(x).length) || {};
  return e.title || e.description || (e.fields && e.fields[0] && e.fields[0].name) || '(sin texto)';
}

// Snippet del primer bloque con texto de un layout V2 (para "Mis plantillas").
function layoutSnippet(layout) {
  function text(b) {
    if (b.type === 'text') return (b.content || '').trim();
    if (b.type === 'section') return (b.texts || []).find(t => t && t.trim()) || '';
    if (b.type === 'container') { for (const c of b.children || []) { const s = text(c); if (s) return s; } }
    return '';
  }
  for (const b of (layout && layout.blocks) || []) { const s = text(b); if (s) return s; }
  return '(layout sin texto)';
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
    const isLayout = t.content_mode === 'layout_v2';
    const embeds = t.embeds || [];
    const first = embeds.find(x => x && Object.keys(x).length) || {};
    const color = typeof first.color === 'number' ? '#' + first.color.toString(16).padStart(6, '0')
      : (typeof first.color === 'string' ? first.color : '#8B6EF5');
    const badge = isLayout
      ? el('span', { class: 'badge badge-premium' }, 'LAYOUT')
      : (embeds.length > 1 ? el('span', { class: 'badge' }, embeds.length + ' embeds') : null);
    const snippet = isLayout ? layoutSnippet(t.layout) : templateSnippet(embeds);
    // Payload que reusa el "Renombrar" (PUT exige revalidar todo el contenido;
    // send_options viaja de vuelta para no perderse en el re-guardado).
    const renameBody = (name) => isLayout
      ? { name, content_mode: 'layout_v2', layout: t.layout, send_options: t.send_options || undefined }
      : { name, embeds, send_options: t.send_options || undefined };
    list.append(el('li', {},
      el('span', {},
        el('span', { class: 'tpl-dot', style: 'background:' + color }), ' ',
        el('strong', {}, t.name),
        badge,
        ' — ',
        el('span', { class: 'dim' }, snippet.slice(0, 60))),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: () => {
          if (isLayout) { _embedMode = 'layout'; _layoutDoc = docFromLayout(t.layout, t.id, t.name, t.send_options); }
          else { _embedMode = 'classic'; _embedDoc = docFromEmbeds(embeds, t.id, t.name, t.send_options); }
          _embedTab = 'editor'; loadEmbeds();
        },
      }, 'Cargar en el editor'),
      el('button', {
        class: 'btn btn-secondary btn-sm',
        onclick: async () => {
          const name = (prompt('Nuevo nombre:', t.name) || '').trim();
          if (!name || name === t.name) return;
          try {
            await apiFetch(`/api/server/${GUILD_ID}/embeds/templates/${t.id}`, { method: 'PUT', body: renameBody(name) });
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
      ['Plantillas de embeds guardadas', '20', '50'],
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
            el('li', {}, 'Colección de memes ampliada a 200 imágenes'),
            el('li', {}, 'Límite de plantillas de embeds ampliado a 50')))));
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
    // Clase propia (antes reusaba .premium-plan-fineprint, pensada para el
    // gap:18px de una tarjeta individual): sin eso, este párrafo quedaba sin
    // separación del grid de precios — pegado a su borde inferior, en la
    // costura entre ambas tarjetas. Ver diagnóstico en el reporte del fix.
    const legalNote = el('p', { class: 'premium-legal-note' },
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
    const verifyBtn = el('button', {
      class: 'btn btn-secondary',
      title: 'Revisa cada GIF contra su host de origen y saca los que estén '
        + 'realmente muertos (los que solo el navegador no puede previsualizar '
        + 'no se tocan). Puede tardar unos minutos.',
      onclick: async () => {
        verifyBtn.disabled = true;
        const original = verifyBtn.textContent;
        verifyBtn.textContent = 'Verificando…';
        try {
          const resp = await apiFetch(`/api/server/${GUILD_ID}/settings/gifs/verify`, { method: 'POST' });
          const msg = resp.checking < resp.total
            ? `Verificando los ${resp.checking} más antiguos de ${resp.total} GIFs — el resto se cubre en próximos ciclos`
            : `Verificación de ${resp.total} GIFs iniciada en segundo plano`;
          toast(`${msg} — recargá esta sección en unos minutos`, 'ok');
        } catch (e) {
          toast(e.status === 429 ? 'Ya hay una verificación reciente — esperá antes de disparar otra' : e.message, e.status === 429 ? 'warn' : 'err');
        } finally {
          verifyBtn.disabled = false;
          verifyBtn.textContent = original;
        }
      },
    }, 'Verificar GIFs');
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
      }, 'Agregar'),
      verifyBtn));

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
