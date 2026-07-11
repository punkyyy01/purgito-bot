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
  frases: loadFrases, youtube: loadYouTube, memes: loadMemes, gifs: loadGifs,
  premium: loadPremium,
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
    box.append(el('div', { class: 'premium-layout' },
      el('div', { class: 'premium-card premium-card-wide' },
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
              el('td', { class: 'premium-column' }, premium)))))),
        el('div', { class: 'premium-plans' },
          el('article', { class: 'premium-plan-card' },
            el('div', { class: 'premium-plan-copy' },
              el('h3', {}, 'Mensual'),
              el('div', { class: 'premium-plan-price' }, '$4.99', el('span', {}, '/mes')),
              el('p', { class: 'dim' }, 'Cobro mensual, ideal si quieres probar premium sin compromiso.')),
            checkoutBtn(box, 'monthly', 'Suscribirse — Mensual $4.99/mes')),
          el('article', { class: 'premium-plan-card premium-plan-featured' },
            el('span', { class: 'premium-plan-badge' }, 'Ahorra ~33%'),
            el('span', { class: 'premium-plan-recommended' }, 'Recomendado'),
            el('div', { class: 'premium-plan-copy' },
              el('h3', {}, 'Anual'),
              el('div', { class: 'premium-plan-price' }, '$39.99', el('span', {}, '/año')),
              el('p', { class: 'dim' }, 'La mejor opción: pagas una vez y ahorras ~33% frente a 12 meses sueltos.')),
            checkoutBtn(box, 'annual', 'Suscribirse — Anual $39.99/año')))));
  } catch (e) { renderError(box, e); }
}

// ---------- GIFs ----------

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

async function loadGifs() {
  const box = content();
  box.append(spinner());
  try {
    const data = await apiFetch(`/api/server/${GUILD_ID}/settings/gifs`);
    box.innerHTML = '';
    const input = el('input', { type: 'text', placeholder: 'https://tenor.com/… o URL de R2', style: 'flex:1' });
    box.append(el('div', { class: 'add-row' }, input,
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const url = input.value.trim();
          if (!url) return;
          try {
            await apiFetch(`/api/server/${GUILD_ID}/settings/gifs`, {
              method: 'POST', body: { url },
            });
            loadGifs();
          } catch (e) { flash(box, false, e.message); }
        },
      }, 'Agregar')));
    const grid = el('div', { class: 'gif-grid' });
    if (!data.gifs.length) box.append(emptyState('Todavía no hay GIFs guardados — añade uno con el campo de arriba.'));
    for (const g of data.gifs) {
      grid.append(el('div', { class: 'gif-card' },
        gifThumb(g),
        el('a', { class: 'gif-url', href: g.url, target: '_blank', rel: 'noopener' }, g.url),
        delBtn(box, () => apiFetch(`/api/server/${GUILD_ID}/settings/gifs/${g.id}`, { method: 'DELETE' }), loadGifs)));
    }
    box.append(grid);
  } catch (e) { renderError(box, e); }
}
