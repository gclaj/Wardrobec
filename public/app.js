/* Wardrobec front end. Vanilla JS, hash routing, talks to /api. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const fmtDate = (iso, opts = { weekday: 'long', month: 'long', day: 'numeric' }) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, opts);
  const title = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }
  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false; t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 2600);
  }
  function modal(html, onMount) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog">${html}</div></div>`;
    const close = () => { root.innerHTML = ''; };
    root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) close(); });
    root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    if (onMount) onMount(root.querySelector('.modal'), close);
    return close;
  }

  const COLOR_HEX = { black: '#1d1d1f', charcoal: '#3b3f46', white: '#f3f3f1', gray: '#8a8f98', navy: '#1f2f56', blue: '#3f7ed9', teal: '#0f5f6b', brown: '#6b4a2b', tan: '#c8b08a', olive: '#6b7a3a', green: '#2f8a4a', red: '#c0392b', burgundy: '#6e1b2e', pink: '#e58fb0', orange: '#e67e22', yellow: '#e3c233', purple: '#6c4ab6', multi: 'linear-gradient(135deg,#e74c3c,#f1c40f,#2ecc71,#3498db)', other: '#b5b8c0' };
  const CAT_ABBR = { top: 'TOP', bottom: 'BTM', dress: 'DRS', layer: 'LYR', outerwear: 'OUT', shoes: 'SHO', accessory: 'ACC' };
  function swatch(item, cls = '') {
    if (item.image) return `<div class="swatch ${cls}"><img src="${esc(item.image)}" alt=""></div>`;
    const bg = COLOR_HEX[item.color_family] || COLOR_HEX.other;
    return `<div class="swatch ${cls}" style="background:${bg}" title="${esc(item.color_family)}">${CAT_ABBR[item.category] || ''}</div>`;
  }
  const tempFmt = (f) => f == null ? '–' : (state.settings.units === 'C' ? `${Math.round((f - 32) * 5 / 9)}°C` : `${Math.round(f)}°F`);
  const fitClass = (fit) => ({ excellent: 'good', good: 'good', workable: 'warn', stretch: 'bad', incomplete: 'bad' }[fit] || '');

  // ---------- state ----------
  const state = { settings: { units: 'F' }, meta: null, date: todayISO(), plan: null, attempts: {}, locks: {}, items: [], filters: {}, week: null };

  // ---------- router ----------
  const views = { today: renderToday, closet: renderCloset, events: renderEvents, history: renderHistory, settings: renderSettings };
  async function route() {
    const hash = (location.hash || '#today').slice(1).split('?')[0];
    const view = views[hash] ? hash : 'today';
    document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    const app = $('#app');
    try { await views[view](app); } catch (e) { app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message)}</p></div>`; }
  }
  window.addEventListener('hashchange', route);

  // ---------- TODAY ----------
  async function renderToday(app) {
    app.innerHTML = '<p class="muted">Planning your day…</p>';
    const q = new URLSearchParams({ date: state.date });
    for (const [k, v] of Object.entries(state.attempts)) q.set('attempt_' + k, v);
    const plan = await api('GET', '/api/plan?' + q.toString());
    state.plan = plan;
    if (!plan.itemCount) { app.innerHTML = emptyCloset(); wireEmpty(app); return; }
    const w = plan.weather;
    const isToday = state.date === todayISO();
    app.innerHTML = `
      <div class="row between" style="margin-bottom:14px">
        <div><h1>${isToday ? 'Today' : fmtDate(state.date, { weekday: 'long' })}</h1><div class="muted">${fmtDate(state.date)}${plan.profile ? ` · <a href="#settings" class="chip accent" title="Colour profile applied to every pick">${esc(plan.profile.label)} palette</a>` : ''}</div></div>
        <div class="row">
          <button class="small" id="prev-day">‹</button>
          <input type="date" id="date-pick" value="${state.date}" style="width:auto">
          <button class="small" id="next-day">›</button>
          ${isToday ? '' : '<button class="small" id="go-today">Today</button>'}
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">${weatherCard(w, plan)}</div>
      ${plan.events.length ? `<h2 style="margin:4px 0 10px">On your calendar</h2><div class="grid cols-2" style="margin-bottom:20px">${plan.events.map(ep => outfitCard(ep.outfit, 'event' + ep.event.id, { event: ep.event, weatherAt: ep.weatherAt })).join('')}</div>` : ''}
      <h2 style="margin:4px 0 10px">Your four options</h2>
      <div class="grid cols-2">${['gym', 'casual', 'business_casual', 'formal'].map(k => outfitCard(plan.standard[k], k)).join('')}</div>
      ${plan.wornToday.length ? `<h2 style="margin:20px 0 10px">Already worn ${isToday ? 'today' : 'that day'}</h2><div class="grid cols-3">${plan.wornToday.map(h => `<div class="card compact"><b>${esc(title(h.occasion))}</b><div class="small muted">${h.items.map(i => esc(i.name)).join(', ')}</div></div>`).join('')}</div>` : ''}
    `;
    $('#date-pick').addEventListener('change', e => { state.date = e.target.value; state.attempts = {}; state.locks = {}; route(); });
    $('#prev-day').addEventListener('click', () => { state.date = addDays(state.date, -1); state.attempts = {}; state.locks = {}; route(); });
    $('#next-day').addEventListener('click', () => { state.date = addDays(state.date, 1); state.attempts = {}; state.locks = {}; route(); });
    const gt = $('#go-today'); if (gt) gt.addEventListener('click', () => { state.date = todayISO(); state.attempts = {}; state.locks = {}; route(); });
    const ov = $('#set-weather'); if (ov) ov.addEventListener('click', () => overrideModal(state.date, () => route()));
    const rf = $('#refresh-weather'); if (rf) rf.addEventListener('click', async () => { await api('POST', '/api/weather/refresh'); route(); });
    app.querySelectorAll('[data-outfit]').forEach(card => wireOutfitCard(card));
  }

  function weatherCard(w, plan) {
    const src = plan.weatherSource;
    const badge = src === 'override' ? '<span class="chip warn">manual</span>' : src === 'stale' ? '<span class="chip warn">stale forecast</span>' : src === 'forecast' ? '<span class="chip good">live forecast</span>' : '<span class="chip bad">no weather</span>';
    if (!w) {
      return `<div class="row between"><div><h2>Weather unavailable ${badge}</h2><p class="muted">${esc(plan.weatherReason || '')}. ${state.settings.lat == null ? 'Set your location in <a href="#settings">Settings</a>, or ' : 'Or '}enter today's conditions by hand.</p></div><div class="row"><button id="set-weather">Enter weather</button>${state.settings.lat != null ? '<button id="refresh-weather" class="ghost">Retry</button>' : ''}</div></div>`;
    }
    const hourly = (plan.hourly || []).filter(h => h.hour >= 6 && h.hour <= 22 && h.hour % 2 === 0);
    return `
      <div class="weather">
        <div class="temp">${tempFmt(w.feelsLike)}</div>
        <div>
          <div class="row" style="gap:8px"><b>${esc(w.summary || '')}</b> ${badge} ${state.settings.location_name ? `<span class="muted small">${esc(state.settings.location_name)}</span>` : ''}</div>
          <div class="meta">
            <span>Feels like, day-weighted</span>
            <span>High ${tempFmt(w.tempHigh)} · Low ${tempFmt(w.tempLow)}</span>
            <span>Rain ${Math.round(w.precipProb || 0)}%</span>
            <span>Wind ${Math.round(w.windMax || 0)} mph</span>
            ${w.uv != null ? `<span>UV ${Math.round(w.uv)}</span>` : ''}
          </div>
        </div>
      </div>
      ${hourly.length ? `<div class="hourly">${hourly.map(h => `<div class="h">${h.hour}:00<b>${tempFmt(h.feelsLike)}</b>${h.precipProb >= 30 ? `<span>${Math.round(h.precipProb)}%</span>` : '<span>&nbsp;</span>'}</div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:8px"><button class="small ghost" id="set-weather">${src === 'override' ? 'Edit manual weather' : 'Override weather'}</button>${src !== 'override' && state.settings.lat != null ? '<button class="small ghost" id="refresh-weather">Refresh forecast</button>' : ''}</div>`;
  }

  const SLOT_ORDER = ['outerwear', 'layer', 'top', 'dress', 'bottom', 'shoes'];
  function outfitCard(o, key, opts = {}) {
    const ev = opts.event;
    const head = ev
      ? `<div><h3>${esc(ev.title)}</h3><div class="small muted">${ev.time ? esc(ev.time) + ' · ' : ''}${esc(title(ev.occasion))}${opts.weatherAt ? ` · ${tempFmt(opts.weatherAt.feelsLike)} ${esc(opts.weatherAt.summary || '')}` : ''}</div></div>`
      : `<h3>${esc(o.label || title(o.occasion))}</h3>`;
    const slots = SLOT_ORDER.filter(s => o.slots && o.slots[s]).map(s => slotRow(s, o.slots[s], o.alternatives[s]));
    const emptyOptional = ['outerwear', 'layer'].filter(s => !(o.slots && o.slots[s]) && o.alternatives[s] && o.alternatives[s].length)
      .map(s => `<div class="slot slot-wrap" data-slot="${s}"><div class="swatch" style="background:var(--surface-2);color:var(--muted);text-shadow:none">+</div><div class="grow"><span class="muted small">No ${s}</span></div><button class="small ghost" data-alts="${s}">Add</button></div>`);
    return `
      <div class="card outfit ${ev ? 'event-card' : ''}" data-outfit="${key}" data-occasion="${esc(o.occasion)}" ${ev ? `data-event="${ev.id}"` : ''}>
        <div class="card-head">${head}<span class="chip ${fitClass(o.fit)}" title="score ${o.score}">${esc(o.fit)}</span></div>
        ${o.missing && o.missing.length ? `<p class="small" style="color:var(--bad)">Missing: ${o.missing.join(', ')}. Add pieces in the Closet.</p>` : ''}
        ${slots.join('')}${emptyOptional.join('')}
        ${o.accessories && o.accessories.length ? `<div class="acc chips">${o.accessories.map(a => `<span class="chip" title="${esc(a.why || '')}">${esc(a.name)}</span>`).join('')}</div>` : ''}
        <ul class="rationale">${(o.rationale || []).map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <div class="actions">
          <button class="primary small" data-act="wear" ${o.items.length ? '' : 'disabled'}>Wear this</button>
          <button class="small" data-act="regen">Regenerate</button>
          <button class="small ghost" data-act="like" title="More like this">Like</button>
          <button class="small ghost" data-act="dislike" title="Less like this">Dislike</button>
        </div>
      </div>`;
  }
  function slotRow(slot, item, alts) {
    return `<div class="slot slot-wrap" data-slot="${slot}">${swatch(item)}<div class="grow"><div class="name">${esc(item.name)}</div><div class="sub">${esc(slot)}${item.subcategory ? ' · ' + esc(item.subcategory) : ''}${item.status === 'dirty' ? ' · <span style="color:var(--warn)">dirty</span>' : ''}</div></div>${alts && alts.length ? `<button class="small ghost" data-alts="${slot}">Swap</button>` : ''}</div>`;
  }

  function wireOutfitCard(card) {
    const key = card.dataset.outfit, occasion = card.dataset.occasion, eventId = card.dataset.event ? Number(card.dataset.event) : null;
    const getOutfit = () => eventId ? state.plan.events.find(e => e.event.id === eventId).outfit : state.plan.standard[key];
    const setOutfit = (o) => { if (eventId) state.plan.events.find(e => e.event.id === eventId).outfit = o; else state.plan.standard[key] = o; };
    const rerender = (o) => {
      const ep = eventId ? state.plan.events.find(e => e.event.id === eventId) : null;
      const tmp = document.createElement('div'); tmp.innerHTML = outfitCard(o, key, ep ? { event: ep.event, weatherAt: ep.weatherAt } : {});
      const fresh = tmp.firstElementChild; card.replaceWith(fresh); wireOutfitCard(fresh);
    };
    const regenerate = async (lock) => {
      const o = getOutfit();
      const ep = eventId ? state.plan.events.find(e => e.event.id === eventId) : null;
      const attempt = lock ? (state.attempts[key] || 0) : (state.attempts[key] = (state.attempts[key] || 0) + 1);
      const body = { occasion, date: state.date, attempt, lock: lock || {}, salt: eventId ? 'event' + eventId : '' };
      if (ep && ep.event.time) body.time = ep.event.time;
      if (ep) body.exclude = state.plan.events.filter(x => x.event.id !== eventId).flatMap(x => x.outfit.items.map(i => i.id));
      if (!lock) state.locks[key] = {};
      const fresh = await api('POST', '/api/outfits/generate', body);
      setOutfit(fresh); rerender(fresh);
    };
    card.querySelectorAll('[data-alts]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = btn.dataset.alts, o = getOutfit();
      document.querySelectorAll('.alts').forEach(x => x.remove());
      const box = document.createElement('div'); box.className = 'alts';
      box.innerHTML = (o.alternatives[slot] || []).map((a, i) => a.item
        ? `<button data-i="${i}">${swatch(a.item)}<span>${esc(a.item.name)}</span><span class="delta">${a.delta > 0 ? '+' : ''}${a.delta.toFixed(1)}</span></button>`
        : `<button data-i="${i}"><span class="swatch" style="background:var(--surface-2);color:var(--muted);text-shadow:none">–</span><span>None</span><span class="delta">${a.delta > 0 ? '+' : ''}${a.delta.toFixed(1)}</span></button>`).join('');
      btn.closest('.slot-wrap').appendChild(box);
      const closeBox = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener('click', closeBox); } };
      setTimeout(() => document.addEventListener('click', closeBox), 0);
      box.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
        const alt = o.alternatives[slot][Number(b.dataset.i)];
        const lock = {};
        for (const s of SLOT_ORDER) if (o.slots[s]) lock[s] = o.slots[s].id;
        lock[slot] = alt.item ? alt.item.id : null;
        if (slot === 'dress') { delete lock.top; delete lock.bottom; }
        if (slot === 'top' || slot === 'bottom') delete lock.dress;
        state.locks[key] = lock;
        box.remove();
        try { await regenerate(lock); } catch (err) { toast(err.message, true); }
      }));
    }));
    card.querySelector('[data-act="regen"]').addEventListener('click', async () => { try { await regenerate(null); } catch (err) { toast(err.message, true); } });
    card.querySelector('[data-act="wear"]').addEventListener('click', async () => {
      const o = getOutfit();
      const ids = [...o.items.map(i => i.id), ...o.accessories.map(a => a.id)];
      try {
        await api('POST', '/api/outfits/wear', { date: state.date, occasion, item_ids: ids, event_id: eventId, weather: state.plan.weather || {} });
        toast('Logged. Worn pieces are marked for laundry where due.');
        state.attempts = {}; state.locks = {}; route();
      } catch (err) { toast(err.message, true); }
    });
    for (const vote of ['like', 'dislike']) card.querySelector(`[data-act="${vote}"]`).addEventListener('click', async () => {
      const o = getOutfit();
      try { await api('POST', '/api/outfits/feedback', { date: state.date, occasion, item_ids: o.items.map(i => i.id), vote: vote === 'like' ? 1 : -1 }); toast(vote === 'like' ? 'Noted. You will see more of these pieces together.' : 'Noted. These pieces will rank lower for ' + title(occasion) + '.'); }
      catch (err) { toast(err.message, true); }
    });
  }

  function emptyCloset() {
    return `<div class="card empty"><h3>Your closet is empty</h3><p>Wardrobec can only recommend what it knows you own. Add your clothes, or load the sample closet to see how it works.</p><div class="row" style="justify-content:center"><button class="primary" id="go-quick">Quick-add my clothes</button><button id="load-capsule">Load my 20-piece capsule</button><button id="load-sample">Load sample closet</button></div></div>`;
  }
  function wireEmpty(app) {
    $('#go-quick', app).addEventListener('click', () => { location.hash = '#closet'; setTimeout(quickAddModal, 50); });
    $('#load-sample', app).addEventListener('click', async () => { await api('POST', '/api/seed'); toast('Sample closet loaded'); route(); });
    $('#load-capsule', app).addEventListener('click', async () => { await api('POST', '/api/seed', { set: 'capsule' }); toast('Capsule loaded'); route(); });
  }

  // ---------- CLOSET ----------
  async function renderCloset(app) {
    app.innerHTML = '<p class="muted">Opening the closet…</p>';
    const f = state.filters;
    const q = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
    const [items, meta] = await Promise.all([api('GET', '/api/items?' + q), state.meta || api('GET', '/api/meta')]);
    state.meta = meta; state.items = items;
    const counts = { clean: 0, dirty: 0, laundry: 0, retired: 0 };
    for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
    app.innerHTML = `
      <div class="row between" style="margin-bottom:12px">
        <div><h1>Closet</h1><div class="muted">${items.length} item${items.length === 1 ? '' : 's'} shown · ${counts.clean} clean · ${counts.dirty + counts.laundry} in the wash</div></div>
        <div class="row">
          <button class="primary" id="add-item">Add item</button>
          <button id="quick-add">Quick add</button>
          <button id="link-add">Add from links</button>
          <button id="laundry-done" title="Mark everything dirty as clean again">Laundry done</button>
          <button class="ghost" id="more-menu">More…</button>
        </div>
      </div>
      <div class="toolbar">
        <input id="f-q" placeholder="Search" value="${esc(f.q || '')}">
        <select id="f-category"><option value="">All categories</option>${meta.categories.map(c => `<option value="${c}" ${f.category === c ? 'selected' : ''}>${title(c)}</option>`).join('')}</select>
        <select id="f-occasion"><option value="">All occasions</option>${Object.values(meta.occasions).map(o => `<option value="${o.key}" ${f.occasion === o.key ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
        <select id="f-status"><option value="">Any status</option>${meta.statuses.map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${title(s)}</option>`).join('')}</select>
        ${Object.values(f).some(Boolean) ? '<button class="small ghost" id="f-clear">Clear</button>' : ''}
      </div>
      ${items.length ? `<div class="grid cols-4" id="item-grid">${items.map(itemCard).join('')}</div>` : (Object.values(f).some(Boolean) ? '<div class="card empty">Nothing matches those filters.</div>' : emptyCloset())}
      <details class="card" style="margin-top:20px"><summary>Wardrobe coverage: where you are thin</summary><div id="coverage" style="margin-top:12px"><p class="muted">Loading…</p></div></details>
    `;
    if (!items.length && !Object.values(f).some(Boolean)) wireEmpty(app);
    const applyFilters = () => { state.filters = { q: $('#f-q').value.trim(), category: $('#f-category').value, occasion: $('#f-occasion').value, status: $('#f-status').value }; renderCloset(app); };
    let deb; $('#f-q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(applyFilters, 250); });
    ['#f-category', '#f-occasion', '#f-status'].forEach(s => $(s).addEventListener('change', applyFilters));
    const fc = $('#f-clear'); if (fc) fc.addEventListener('click', () => { state.filters = {}; renderCloset(app); });
    $('#add-item').addEventListener('click', () => itemModal(null, () => renderCloset(app)));
    $('#quick-add').addEventListener('click', () => quickAddModal(() => renderCloset(app)));
    $('#link-add').addEventListener('click', () => linkAddModal(() => renderCloset(app)));
    $('#laundry-done').addEventListener('click', async () => { const r = await api('POST', '/api/laundry/done'); toast(`${r.cleaned} item${r.cleaned === 1 ? '' : 's'} back in rotation`); renderCloset(app); });
    $('#more-menu').addEventListener('click', () => moreMenu(() => renderCloset(app)));
    app.querySelectorAll('[data-item]').forEach(card => wireItemCard(card, () => renderCloset(app)));
    const det = app.querySelector('details');
    det.addEventListener('toggle', async () => { if (det.open) $('#coverage').innerHTML = coverageGrid(await api('GET', '/api/coverage')); }, { once: true });
  }

  function itemCard(i) {
    const formality = i.formality_min === i.formality_max ? `F${i.formality_min}` : `F${i.formality_min}–${i.formality_max}`;
    return `<div class="card compact item-card ${i.status !== 'clean' ? 'dirty' : ''}" data-item="${i.id}">
      <div class="top">${swatch(i)}<div><div class="title">${esc(i.name)}${i.favorite ? ' <span title="favorite" style="color:var(--warn)">★</span>' : ''}</div><div class="meta">${i.brand ? esc(i.brand) + ' · ' : ''}${esc(title(i.category))}${i.subcategory ? ' · ' + esc(i.subcategory) : ''}${i.material ? ' · ' + esc(i.material) : ''}${i.url ? ` · <a href="${esc(i.url)}" target="_blank" rel="noopener">link</a>` : ''}</div></div></div>
      <div class="chips"><span class="chip" title="formality 0 athletic … 5 black tie">${formality}</span><span class="chip" title="warmth 1 hot … 5 cold">W${i.warmth}</span>${i.rain_ok ? '<span class="chip">rain ok</span>' : ''}${i.pattern && i.pattern !== 'solid' ? `<span class="chip">${esc(i.pattern)}</span>` : ''}${(i.occasions || []).map(o => `<span class="chip accent">${esc(title(o))}</span>`).join('')}${i.status !== 'clean' ? `<span class="chip warn">${esc(i.status)}</span>` : ''}${paletteChip(i)}</div>
      <div class="meta">${i.wear_count ? `worn ${i.wear_count}×` : 'never worn'}${i.last_worn ? ', last ' + esc(i.last_worn) : ''}${i.wears_before_wash < 999 ? ` · wash every ${i.wears_before_wash}` : ''}</div>
      <div class="foot"><button class="small" data-act="toggle">${i.status === 'clean' ? 'Mark dirty' : 'Mark clean'}</button><button class="small ghost" data-act="edit">Edit</button><button class="small ghost danger" data-act="delete">Delete</button></div>
    </div>`;
  }
  function paletteChip(i) {
    if (!i.palette_label || i.palette_label === 'neutral') return '';
    const cls = { flatters: 'good', good: 'good', muted: 'warn', avoid: 'bad' }[i.palette_label] || '';
    return `<span class="chip ${cls}" title="colour profile rating ${i.palette_rating > 0 ? '+' : ''}${i.palette_rating}">${esc(i.palette_label)}</span>`;
  }
  function wireItemCard(card, refresh) {
    const id = Number(card.dataset.item);
    const item = state.items.find(i => i.id === id);
    card.querySelector('[data-act="toggle"]').addEventListener('click', async () => { await api('POST', `/api/items/${id}/status`, { status: item.status === 'clean' ? 'dirty' : 'clean' }); refresh(); });
    card.querySelector('[data-act="edit"]').addEventListener('click', () => itemModal(item, refresh));
    card.querySelector('[data-act="delete"]').addEventListener('click', async () => { if (confirm(`Delete "${item.name}"?`)) { await api('DELETE', `/api/items/${id}`); toast('Deleted'); refresh(); } });
  }

  function coverageGrid(cov) {
    const occ = cov.occasions, bands = cov.bands;
    const cell = (o, b) => {
      const dry = cov.cells.find(c => c.occasion === o && c.band === b.key && !c.rain), wet = cov.cells.find(c => c.occasion === o && c.band === b.key && c.rain);
      const dot = (c, lbl) => `<span class="dot ${c.status}" title="${esc(lbl)}: ${c.status}${c.problems.length ? ' – ' + c.problems.join('; ') : ''}">${lbl}</span>`;
      return `<div class="cell"><div class="pair">${dot(dry, 'dry')}${dot(wet, 'rain')}</div></div>`;
    };
    return `<p class="small muted">Each cell asks: can the closet dress this occasion in this weather, dry and in rain? Green is solid, amber is workable, red is a gap. Hover a cell for the reason.</p>
      <div class="coverage"><div class="hd"></div>${bands.map(b => `<div class="hd">${esc(b.label)}</div>`).join('')}
      ${occ.map(o => `<div class="hd">${esc(title(o))}</div>${bands.map(b => cell(o, b)).join('')}`).join('')}</div>`;
  }

  // ---------- item form ----------
  async function itemModal(item, onSaved) {
    const meta = state.meta || (state.meta = await api('GET', '/api/meta'));
    const it = item || { name: '', brand: '', url: '', category: 'top', subcategory: '', color: '', color_family: 'other', pattern: 'solid', material: '', formality_min: 1, formality_max: 2, warmth: 2, rain_ok: false, wind_ok: false, occasions: ['casual'], status: 'clean', wears_before_wash: 1, favorite: false, set_id: '', image: '', notes: '' };
    const fams = Object.keys(COLOR_HEX);
    const html = `
      <h2>${item ? 'Edit item' : 'Add item'}</h2>
      <form id="item-form">
        <div class="form-grid">
          <div class="field wide"><label>Name</label><input name="name" required value="${esc(it.name)}" placeholder="e.g. Navy wool blazer"></div>
          ${item ? '' : '<div class="field wide small muted">Tip: type the name and press <b>Auto-fill</b> to let Wardrobec guess the rest, then correct anything it got wrong.</div>'}
          <div class="field"><label>Category</label><select name="category">${meta.categories.map(c => `<option value="${c}" ${it.category === c ? 'selected' : ''}>${title(c)}</option>`).join('')}</select></div>
          <div class="field"><label>Type</label><input name="subcategory" value="${esc(it.subcategory)}" placeholder="chinos, blazer, loafers…"></div>
          <div class="field"><label>Color (as you call it)</label><input name="color" value="${esc(it.color)}"></div>
          <div class="field"><label>Color family</label><select name="color_family">${fams.map(c => `<option value="${c}" ${it.color_family === c ? 'selected' : ''}>${title(c)}</option>`).join('')}</select></div>
          <div class="field"><label>Pattern</label><select name="pattern">${['solid', 'striped', 'checked', 'dotted', 'floral', 'graphic', 'camo', 'herringbone', 'houndstooth', 'paisley', 'tweed', 'other'].map(p => `<option ${it.pattern === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
          <div class="field"><label>Material</label><input name="material" value="${esc(it.material)}"></div>
          <div class="field"><label>Formality min (0 athletic – 5 black tie)</label><input name="formality_min" type="number" min="0" max="5" value="${it.formality_min}"></div>
          <div class="field"><label>Formality max</label><input name="formality_max" type="number" min="0" max="5" value="${it.formality_max}"></div>
          <div class="field"><label>Warmth (1 hot-weather – 5 deep cold)</label><input name="warmth" type="number" min="1" max="5" value="${it.warmth}"></div>
          <div class="field"><label>Wears before wash (999 = never)</label><input name="wears_before_wash" type="number" min="1" max="999" value="${it.wears_before_wash}"></div>
          <div class="field"><label>Suit / set ID (pairs jacket with trousers)</label><input name="set_id" value="${esc(it.set_id)}" placeholder="navy-suit"></div>
          <div class="field"><label>Status</label><select name="status">${meta.statuses.map(s => `<option value="${s}" ${it.status === s ? 'selected' : ''}>${title(s)}</option>`).join('')}</select></div>
          <div class="field wide"><label>Occasions</label><div class="row">${Object.values(meta.occasions).map(o => `<label style="display:flex;gap:6px;align-items:center;color:var(--text);font-size:.9rem"><input type="checkbox" name="occ" value="${o.key}" ${it.occasions.includes(o.key) ? 'checked' : ''}>${o.label}</label>`).join('')}</div></div>
          <div class="field wide row"><label style="display:flex;gap:6px;align-items:center;color:var(--text);font-size:.9rem"><input type="checkbox" name="rain_ok" ${it.rain_ok ? 'checked' : ''}>Fine in rain</label><label style="display:flex;gap:6px;align-items:center;color:var(--text);font-size:.9rem"><input type="checkbox" name="wind_ok" ${it.wind_ok ? 'checked' : ''}>Blocks wind</label><label style="display:flex;gap:6px;align-items:center;color:var(--text);font-size:.9rem"><input type="checkbox" name="favorite" ${it.favorite ? 'checked' : ''}>Favorite</label></div>
          <div class="field wide"><label>Photo (optional)</label><div class="row"><input type="file" id="img-file" accept="image/*" style="width:auto"><span id="img-preview">${it.image ? swatch(it) : ''}</span>${it.image ? '<button type="button" class="small ghost" id="img-clear">Remove</button>' : ''}</div></div>
          <div class="field"><label>Brand</label><input name="brand" value="${esc(it.brand || '')}"></div>
          <div class="field"><label>Product link</label><input name="url" value="${esc(it.url || '')}" placeholder="https://…"></div>
          <div class="field wide"><label>Notes</label><input name="notes" value="${esc(it.notes)}"></div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:8px">${item ? '' : '<button type="button" id="autofill">Auto-fill from name</button>'}<button type="button" data-close>Cancel</button><button class="primary" type="submit">Save</button></div>
      </form>`;
    modal(html, (m, close) => {
      let image = it.image || '';
      const form = $('#item-form', m);
      $('#img-file', m).addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; image = await resizeImage(f); $('#img-preview', m).innerHTML = `<div class="swatch"><img src="${image}" alt=""></div>`; });
      const ic = $('#img-clear', m); if (ic) ic.addEventListener('click', () => { image = ''; $('#img-preview', m).innerHTML = ''; });
      const af = $('#autofill', m); if (af) af.addEventListener('click', async () => {
        const name = form.name.value.trim(); if (!name) return;
        const { items } = await api('POST', '/api/items/classify', { text: name });
        const d = items[0]; if (!d) return;
        for (const k of ['category', 'subcategory', 'color', 'color_family', 'pattern', 'material', 'formality_min', 'formality_max', 'warmth', 'wears_before_wash']) if (form[k]) form[k].value = d[k];
        form.rain_ok.checked = d.rain_ok; form.wind_ok.checked = d.wind_ok;
        form.querySelectorAll('[name="occ"]').forEach(cb => { cb.checked = d.occasions.includes(cb.value); });
        toast(d.confidence === 'high' ? 'Filled in. Check the guesses.' : 'Could not recognise that type; filled defaults.');
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const body = Object.fromEntries(fd.entries());
        body.occasions = fd.getAll('occ'); body.rain_ok = form.rain_ok.checked; body.wind_ok = form.wind_ok.checked; body.favorite = form.favorite.checked; body.image = image;
        delete body.occ;
        try { if (item) await api('PUT', `/api/items/${item.id}`, body); else await api('POST', '/api/items', body); toast('Saved'); close(); onSaved && onSaved(); }
        catch (err) { toast(err.message, true); }
      });
    });
  }
  function resizeImage(file, max = 360) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82)); };
      img.onerror = reject; img.src = url;
    });
  }

  // ---------- draft preview table (shared by quick add and add-from-links) ----------
  function draftTable(m, drafts, meta, onSave, opts = {}) {
    $('#qa-preview', m).innerHTML = `
      <div style="overflow:auto"><table><thead><tr>${opts.images ? '<th></th>' : ''}<th>Name</th>${opts.images ? '<th>Brand</th>' : ''}<th>Category</th><th>Type</th><th>Color</th><th>Form.</th><th>Warmth</th><th>Rain</th><th>Occasions</th></tr></thead><tbody>
      ${drafts.map((d, i) => `<tr data-i="${i}" ${d.confidence === 'low' || d.resolved === false ? 'style="background:var(--warn-soft)"' : ''}>
        ${opts.images ? `<td>${d.image ? `<div class="swatch"><img src="${esc(d.image)}" alt=""></div>` : ''}</td>` : ''}
        <td><input data-k="name" value="${esc(d.name)}">${d.error ? `<div class="small" style="color:var(--bad)">${esc(d.error)}</div>` : ''}${d.warning ? `<div class="small" style="color:var(--warn)">${esc(d.warning)}</div>` : ''}${d.duplicates ? `<div class="small muted">pasted ${d.duplicates + 1}×, added once</div>` : ''}</td>
        ${opts.images ? `<td><input data-k="brand" value="${esc(d.brand || '')}" style="min-width:90px"></td>` : ''}
        <td><select data-k="category">${meta.categories.map(c => `<option value="${c}" ${d.category === c ? 'selected' : ''}>${title(c)}</option>`).join('')}</select></td>
        <td><input data-k="subcategory" value="${esc(d.subcategory)}" style="min-width:90px"></td>
        <td><select data-k="color_family">${Object.keys(COLOR_HEX).map(c => `<option value="${c}" ${d.color_family === c ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
        <td style="white-space:nowrap"><input data-k="formality_min" type="number" min="0" max="5" value="${d.formality_min}" style="width:46px">–<input data-k="formality_max" type="number" min="0" max="5" value="${d.formality_max}" style="width:46px"></td>
        <td><input data-k="warmth" type="number" min="1" max="5" value="${d.warmth}" style="width:50px"></td>
        <td><input data-k="rain_ok" type="checkbox" ${d.rain_ok ? 'checked' : ''}></td>
        <td style="white-space:nowrap">${Object.keys(meta.occasions).map(o => `<label style="display:inline-flex;gap:3px;margin-right:6px;color:var(--text)"><input type="checkbox" data-occ="${o}" ${d.occasions.includes(o) ? 'checked' : ''}>${o === 'business_casual' ? 'biz' : o}</label>`).join('')}</td>
      </tr>`).join('')}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">Amber rows need a look: ${opts.images ? 'the store could not be read or the variant was not found' : 'the type was not recognised'}. Fix the cells and save.</p>
      <div class="row" style="justify-content:flex-end"><button class="primary" id="qa-save">Add ${drafts.length} item${drafts.length === 1 ? '' : 's'}</button></div>`;
    $('#qa-save', m).addEventListener('click', async () => {
      const rows = [...m.querySelectorAll('tr[data-i]')].map(tr => {
        const d = { ...drafts[Number(tr.dataset.i)] };
        tr.querySelectorAll('[data-k]').forEach(el => { d[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; });
        d.occasions = [...tr.querySelectorAll('[data-occ]')].filter(cb => cb.checked).map(cb => cb.dataset.occ);
        for (const k of ['confidence', 'resolved', 'error', 'warning', 'duplicates', 'variant_matched']) delete d[k];
        return d;
      });
      onSave(rows);
    });
  }

  async function linkAddModal(onSaved) {
    const meta = state.meta || (state.meta = await api('GET', '/api/meta'));
    modal(`
      <h2>Add from product links</h2>
      <p class="muted small">Paste links from the stores you bought from, one per line. Links that include a <code>?variant=</code> id resolve to the exact colour and photo. Shopify stores resolve exactly; other stores (Lululemon, Nike…) are read from the page's product metadata, and a colour that cannot be read is flagged for you to set.</p>
      <textarea id="qa-text" placeholder="https://www.example.com/products/tactical-5-pocket-pant?variant=42030099431511"></textarea>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" data-close>Cancel</button><button class="primary" id="qa-resolve">Look up</button></div>
      <div id="qa-preview" style="margin-top:12px"></div>`, (m, close) => {
      $('#qa-resolve', m).addEventListener('click', async () => {
        const text = $('#qa-text', m).value; if (!text.trim()) return;
        $('#qa-preview', m).innerHTML = '<p class="muted small">Reading product pages…</p>';
        let drafts;
        try { drafts = (await api('POST', '/api/items/from-links', { text })).items; }
        catch (err) { $('#qa-preview', m).innerHTML = `<p class="small" style="color:var(--bad)">${esc(err.message)}</p>`; return; }
        draftTable(m, drafts, meta, async (rows) => {
          try { const r = await api('POST', '/api/items/bulk', { items: rows }); toast(`Added ${r.inserted} items`); close(); onSaved && onSaved(); }
          catch (err) { toast(err.message, true); }
        }, { images: true });
      });
    });
  }

  // ---------- quick add ----------
  async function quickAddModal(onSaved) {
    const meta = state.meta || (state.meta = await api('GET', '/api/meta'));
    modal(`
      <h2>Quick add</h2>
      <p class="muted small">One item per line, the way you would describe it to a friend: colour, material, type. Wardrobec classifies each line; you can correct any cell before saving.</p>
      <textarea id="qa-text" placeholder="navy wool blazer&#10;white oxford shirt&#10;dark blue jeans&#10;brown suede chelsea boots&#10;black running shorts"></textarea>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" data-close>Cancel</button><button class="primary" id="qa-classify">Classify</button></div>
      <div id="qa-preview" style="margin-top:12px"></div>`, (m, close) => {
      let drafts = [];
      $('#qa-classify', m).addEventListener('click', async () => {
        const text = $('#qa-text', m).value; if (!text.trim()) return;
        drafts = (await api('POST', '/api/items/classify', { text })).items;
        draftTable(m, drafts, meta, async (rows) => {
          try { const r = await api('POST', '/api/items/bulk', { items: rows }); toast(`Added ${r.inserted} items`); close(); onSaved && onSaved(); }
          catch (err) { toast(err.message, true); }
        });
      });
    });
  }

  function moreMenu(refresh) {
    modal(`<h2>Closet data</h2><div class="stack">
      <div class="row"><button id="exp">Export JSON</button><span class="muted small">Everything: items, events, history, settings.</span></div>
      <div class="row"><label class="btn" style="margin:0">Import JSON <input type="file" id="imp" accept="application/json" hidden></label><span class="muted small">Adds items from an export file (does not delete existing items).</span></div>
      <div class="row"><button id="seed-capsule">Load my 20-piece capsule</button><span class="muted small">The capsule from your personal style guide (plus belt and cap).</span></div>
      <div class="row"><button id="seed">Load sample closet</button><span class="muted small">Adds an 80-piece demonstration wardrobe.</span></div>
      <div class="row"><button class="danger" id="reset">Delete everything</button><span class="muted small">Removes all items, events and history. Settings are kept.</span></div>
      </div><div class="row" style="justify-content:flex-end;margin-top:14px"><button data-close>Close</button></div>`, (m, close) => {
      $('#exp', m).addEventListener('click', async () => { const data = await api('GET', '/api/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `wardrobec-${todayISO()}.json`; a.click(); });
      $('#imp', m).addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); const r = await api('POST', '/api/import', { items: data.items || data }); toast(`Imported ${r.inserted} items`); close(); refresh(); } catch (err) { toast(err.message, true); } });
      $('#seed', m).addEventListener('click', async () => { await api('POST', '/api/seed'); toast('Sample closet loaded'); close(); refresh(); });
      $('#seed-capsule', m).addEventListener('click', async () => { const r = await api('POST', '/api/seed', { set: 'capsule' }); toast(`Capsule loaded: ${r.inserted} pieces`); close(); refresh(); });
      $('#reset', m).addEventListener('click', async () => { if (prompt('Type DELETE to remove every item, event and log entry.') === 'DELETE') { await api('POST', '/api/reset', { confirm: 'DELETE' }); toast('Closet emptied'); close(); refresh(); } });
    });
  }

  // ---------- EVENTS ----------
  async function renderEvents(app) {
    app.innerHTML = '<p class="muted">Loading…</p>';
    const meta = state.meta || (state.meta = await api('GET', '/api/meta'));
    const [events, week] = await Promise.all([api('GET', '/api/events?from=' + addDays(todayISO(), -1)), api('GET', '/api/weather/week').catch(() => ({ days: [] }))]);
    const byDate = {};
    for (const e of events) (byDate[e.date] ||= []).push(e);
    app.innerHTML = `
      <div class="row between" style="margin-bottom:12px"><div><h1>Events</h1><div class="muted">Anything on the calendar gets its own outfit on the Today page, matched to the hour's weather.</div></div></div>
      <div class="card" style="margin-bottom:16px"><h3>Week ahead</h3>${week.days.length ? `<div class="week">${week.days.slice(0, 7).map(d => `<div class="day" data-date="${d.date}"><b>${fmtDate(d.date, { weekday: 'short', day: 'numeric' })}</b>${tempFmt(d.tempHigh)} / ${tempFmt(d.tempLow)}<br><span class="muted">${esc(d.summary || '')}${d.precipProb >= 30 ? ` · ${Math.round(d.precipProb)}%` : ''}</span><br><span class="muted">${(byDate[d.date] || []).length ? (byDate[d.date].length + ' event' + (byDate[d.date].length > 1 ? 's' : '')) : '&nbsp;'}</span></div>`).join('')}</div>` : `<p class="muted small">No forecast available${state.settings.lat == null ? ': set a location in <a href="#settings">Settings</a>' : ''}.</p>`}</div>
      <div class="grid cols-2">
        <div class="card"><h3>Add an event</h3><form id="ev-form"><div class="form-grid">
          <div class="field"><label>Date</label><input type="date" name="date" required value="${state.date}"></div>
          <div class="field"><label>Time</label><input type="time" name="time"></div>
          <div class="field wide"><label>Title</label><input name="title" placeholder="Client dinner, 5k run, team off-site…"></div>
          <div class="field"><label>Dress code</label><select name="occasion">${Object.values(meta.occasions).map(o => `<option value="${o.key}" ${o.key === 'business_casual' ? 'selected' : ''}>${o.label}</option>`).join('')}</select></div>
          <div class="field"><label>Notes</label><input name="notes"></div>
        </div><div class="row" style="justify-content:flex-end"><button class="primary" type="submit">Add</button></div></form></div>
        <div class="card"><h3>Upcoming</h3>${events.length ? Object.keys(byDate).sort().map(d => `<h4 style="margin-top:10px">${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' })}</h4>${byDate[d].map(e => `<div class="row between" style="padding:6px 0;border-bottom:1px dashed var(--border)"><div><b>${esc(e.title)}</b> <span class="chip accent">${esc(meta.occasions[e.occasion]?.label || e.occasion)}</span><div class="small muted">${e.time ? esc(e.time) : 'all day'}${e.notes ? ' · ' + esc(e.notes) : ''}</div></div><div class="row" style="gap:6px"><a class="btn small" href="#today" data-plan="${e.date}">Plan</a><button class="small ghost danger" data-del="${e.id}">Remove</button></div></div>`).join('')}`).join('') : '<p class="muted">Nothing scheduled. Add gym sessions, work days and dinners here, or just use the four standard options each day.</p>'}</div>
      </div>`;
    $('#ev-form').addEventListener('submit', async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target).entries()); try { await api('POST', '/api/events', body); toast('Event added'); renderEvents(app); } catch (err) { toast(err.message, true); } });
    app.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await api('DELETE', `/api/events/${b.dataset.del}`); renderEvents(app); }));
    app.querySelectorAll('[data-plan]').forEach(a => a.addEventListener('click', () => { state.date = a.dataset.plan; state.attempts = {}; state.locks = {}; }));
    app.querySelectorAll('.week .day').forEach(d => d.addEventListener('click', () => { state.date = d.dataset.date; state.attempts = {}; state.locks = {}; location.hash = '#today'; }));
  }

  // ---------- HISTORY ----------
  async function renderHistory(app) {
    app.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await api('GET', '/api/history?limit=100');
    app.innerHTML = `<h1>History</h1><p class="muted">What you actually wore. Undo an entry if you logged it by mistake.</p>
      ${rows.length ? `<div class="grid cols-3">${rows.map(h => `<div class="card compact"><div class="card-head"><b>${fmtDate(h.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b><span class="chip accent">${esc(title(h.occasion))}</span></div>
        ${h.items.map(i => `<div class="row" style="gap:8px;padding:3px 0">${swatch(i)}<span class="small">${esc(i.name)}</span></div>`).join('')}
        ${h.weather && h.weather.feelsLike != null ? `<div class="small muted" style="margin-top:6px">${tempFmt(h.weather.feelsLike)} · ${esc(h.weather.summary || '')}</div>` : ''}
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="small ghost" data-undo="${h.id}">Undo</button></div></div>`).join('')}</div>` : '<div class="card empty">No outfits logged yet. Press <b>Wear this</b> on the Today page.</div>'}`;
    app.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', async () => { await api('DELETE', `/api/history/${b.dataset.undo}`); toast('Entry removed; items restored'); renderHistory(app); }));
  }

  // ---------- SETTINGS ----------
  async function renderSettings(app) {
    const s = state.settings = await api('GET', '/api/settings');
    const overrides = await api('GET', '/api/weather/overrides');
    app.innerHTML = `<h1>Settings</h1>
      <div class="grid cols-2">
        <div class="card"><h3>Location</h3><p class="muted small">Weather comes from Open-Meteo, free and keyless. Search a city or enter coordinates.</p>
          <div class="row"><input id="geo-q" placeholder="City, e.g. Clarksville TN" value=""><button id="geo-go">Search</button></div>
          <div id="geo-results" class="stack" style="margin:8px 0"></div>
          <div class="form-grid" style="margin-top:8px">
            <div class="field wide"><label>Current location</label><input id="loc-name" value="${esc(s.location_name || '')}" placeholder="Not set"></div>
            <div class="field"><label>Latitude</label><input id="loc-lat" type="number" step="0.0001" value="${s.lat ?? ''}"></div>
            <div class="field"><label>Longitude</label><input id="loc-lon" type="number" step="0.0001" value="${s.lon ?? ''}"></div>
            <div class="field"><label>Units</label><select id="units"><option value="F" ${s.units !== 'C' ? 'selected' : ''}>Fahrenheit</option><option value="C" ${s.units === 'C' ? 'selected' : ''}>Celsius</option></select></div>
          </div>
          <div class="row" style="justify-content:flex-end"><button class="primary" id="save-loc">Save</button></div>
        </div>
        <div class="card"><h3>Manual weather</h3><p class="muted small">Use this when the forecast is unavailable or you know better. A manual entry wins over the forecast for that date.</p>
          ${overrides.length ? `<div class="stack" style="margin-bottom:10px">${overrides.map(o => `<div class="row between small"><span>${esc(o.date)}: ${tempFmt(o.tempHigh)} / ${tempFmt(o.tempLow)}, rain ${o.precipProb}%</span><button class="small ghost" data-del-ov="${o.date}">Remove</button></div>`).join('')}</div>` : ''}
          <button id="add-ov">Enter weather for a date</button>
        </div>
        <div class="card" id="profile-card" style="grid-column:1 / -1"><h3>Style profile</h3><p class="muted small">Your personal colour analysis. The engine rewards pieces in flattering colours, most strongly for anything near your face (tops, layers, ties), and penalises colours that wash you out or overpower you. Edit any rating; the Deep Winter preset comes from your colour report.</p>
          <div class="row" style="margin-bottom:10px"><select id="prof-preset" style="width:auto"></select><select id="prof-contrast" style="width:auto"><option value="any">Contrast: not set</option><option value="high">Contrast: high (dark base + crisp white)</option><option value="medium">Contrast: medium</option><option value="low">Contrast: low</option></select><button class="small ghost" id="prof-reset">Reset to preset</button></div>
          <div id="prof-body"></div>
          <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="primary" id="prof-save">Save profile</button></div>
        </div>
        <div class="card"><h3>How the engine thinks</h3>
          <p class="small">Every item has a <b>formality range</b> (0 athletic to 5 black tie) and a <b>warmth</b> rating (1 hot-weather to 5 deep cold). Each occasion has a dress-code band: Gym 0, Casual 1–2, Business Casual 3, Formal 4–5.</p>
          <p class="small">The day's apparent temperature sets a warmth target; the engine stacks top, layer and outerwear to hit it, keeps shoes and outerwear rain-ready when rain is likely, and penalises colour clashes, duplicate patterns, split suits, and anything worn in the last few days. Like and Dislike nudge pieces up or down for that occasion.</p>
          <p class="small muted">Wears-before-wash controls laundry: a shirt goes dirty after one wear, jeans after four, shoes never. "Laundry done" in the Closet resets everything.</p>
        </div>
      </div>`;
    $('#geo-go').addEventListener('click', async () => {
      const q = $('#geo-q').value.trim(); if (!q) return;
      const box = $('#geo-results'); box.innerHTML = '<span class="muted small">Searching…</span>';
      try {
        const { results } = await api('GET', '/api/geocode?q=' + encodeURIComponent(q));
        box.innerHTML = results.length ? results.map((r, i) => `<button class="small" data-pick="${i}">${esc(r.name)} <span class="muted">(${r.lat.toFixed(2)}, ${r.lon.toFixed(2)})</span></button>`).join('') : '<span class="muted small">No matches.</span>';
        box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { const r = results[Number(b.dataset.pick)]; $('#loc-name').value = r.name; $('#loc-lat').value = r.lat; $('#loc-lon').value = r.lon; box.innerHTML = ''; }));
      } catch (err) { box.innerHTML = `<span class="small" style="color:var(--bad)">${esc(err.message)}. Enter coordinates manually.</span>`; }
    });
    $('#geo-q').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#geo-go').click(); } });
    $('#save-loc').addEventListener('click', async () => {
      try { state.settings = await api('PUT', '/api/settings', { location_name: $('#loc-name').value, lat: $('#loc-lat').value, lon: $('#loc-lon').value, units: $('#units').value }); toast('Saved'); renderSettings(app); }
      catch (err) { toast(err.message, true); }
    });
    $('#add-ov').addEventListener('click', () => overrideModal(state.date, () => renderSettings(app)));
    await wireProfile(app, s);
    app.querySelectorAll('[data-del-ov]').forEach(b => b.addEventListener('click', async () => { await api('DELETE', `/api/weather/override/${b.dataset.delOv}`); renderSettings(app); }));
  }

  async function wireProfile(app, s) {
    const { presets } = await api('GET', '/api/profiles');
    let prof = s.style_profile ? JSON.parse(JSON.stringify(s.style_profile)) : null;
    const sel = $('#prof-preset');
    sel.innerHTML = presets.map(p => `<option value="${p.key}" ${(prof ? prof.key : 'none') === p.key ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
    $('#prof-contrast').value = prof ? prof.contrast : 'any';
    const fams = Object.keys(COLOR_HEX);
    const draw = () => {
      const body = $('#prof-body');
      if (!prof) { body.innerHTML = '<p class="muted small">No colour profile. Every colour scores the same; only harmony rules apply.</p>'; return; }
      body.innerHTML = `
        ${prof.notes ? `<p class="small"><b>${esc(prof.season || prof.label)}</b> · ${esc(prof.notes)}</p>` : ''}
        <h4 style="margin-top:8px">Colour families</h4>
        <div class="grid cols-4" style="gap:8px 14px">${fams.map(f => `<label style="display:flex;align-items:center;gap:8px;color:var(--text)"><span class="swatch" style="background:${COLOR_HEX[f]};width:22px;height:22px;border-radius:6px"></span><span style="width:70px">${f}</span><input type="range" min="-3" max="3" step="0.5" data-fam="${f}" value="${prof.families[f] ?? 0}" style="padding:0"><b style="width:30px;text-align:right" data-fam-val="${f}">${fmtR(prof.families[f] ?? 0)}</b></label>`).join('')}</div>
        <h4 style="margin-top:14px">Specific shades <span class="muted small" style="font-weight:400">override the family when the word appears in an item's colour or name</span></h4>
        <div id="shade-list" class="chips" style="margin-bottom:8px">${Object.entries(prof.shades).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip ${v >= 1.5 ? 'good' : v <= -1.5 ? 'bad' : v < 0 ? 'warn' : ''}">${esc(k)} ${fmtR(v)} <a href="#" data-del-shade="${esc(k)}" title="remove" style="margin-left:4px;color:inherit">×</a></span>`).join('')}</div>
        <div class="row"><input id="shade-name" placeholder="shade, e.g. icy blue" style="width:200px"><input id="shade-val" type="number" min="-3" max="3" step="0.5" value="2" style="width:80px"><button class="small" id="shade-add">Add shade</button></div>`;
      body.querySelectorAll('[data-fam]').forEach(r => r.addEventListener('input', () => { prof.families[r.dataset.fam] = Number(r.value); body.querySelector(`[data-fam-val="${r.dataset.fam}"]`).textContent = fmtR(r.value); }));
      body.querySelectorAll('[data-del-shade]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); delete prof.shades[a.dataset.delShade]; draw(); }));
      $('#shade-add', body).addEventListener('click', () => { const n = $('#shade-name', body).value.trim().toLowerCase(); if (!n) return; prof.shades[n] = Number($('#shade-val', body).value); draw(); });
    };
    const fmtR = (v) => (Number(v) > 0 ? '+' : '') + Number(v);
    const loadPreset = (key) => { const p = presets.find(x => x.key === key); prof = key === 'none' ? null : JSON.parse(JSON.stringify(p)); $('#prof-contrast').value = prof ? prof.contrast : 'any'; draw(); };
    sel.addEventListener('change', () => loadPreset(sel.value));
    $('#prof-reset').addEventListener('click', () => loadPreset(sel.value));
    $('#prof-contrast').addEventListener('change', () => { if (prof) prof.contrast = $('#prof-contrast').value; });
    $('#prof-save').addEventListener('click', async () => {
      try { state.settings = await api('PUT', '/api/settings', { style_profile: prof }); toast(prof ? 'Profile saved. Picks now favour your palette.' : 'Profile cleared.'); }
      catch (err) { toast(err.message, true); }
    });
    draw();
  }

  function overrideModal(date, onSaved) {
    const toF = (v) => state.settings.units === 'C' ? (Number(v) * 9 / 5 + 32) : Number(v);
    const u = state.settings.units === 'C' ? '°C' : '°F';
    modal(`<h2>Enter weather</h2><form id="ov-form"><div class="form-grid">
      <div class="field"><label>Date</label><input type="date" name="date" value="${date}" required></div>
      <div class="field"><label>High (${u})</label><input type="number" name="hi" required></div>
      <div class="field"><label>Low (${u})</label><input type="number" name="lo"></div>
      <div class="field"><label>Chance of rain (%)</label><input type="number" name="precip" min="0" max="100" value="0"></div>
      <div class="field"><label>Wind (mph)</label><input type="number" name="wind" min="0" value="0"></div>
      <div class="field"><label>Conditions</label><select name="code"><option value="1">Clear</option><option value="3">Overcast</option><option value="61">Rain</option><option value="65">Heavy rain</option><option value="73">Snow</option><option value="95">Thunderstorm</option></select></div>
      </div><div class="row" style="justify-content:flex-end;margin-top:8px"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Save</button></div></form>`, (m, close) => {
      $('#ov-form', m).addEventListener('submit', async (e) => {
        e.preventDefault(); const f = e.target;
        const code = Number(f.code.value);
        try { await api('PUT', '/api/weather/override', { date: f.date.value, tempHigh: toF(f.hi.value), tempLow: f.lo.value === '' ? toF(f.hi.value) : toF(f.lo.value), precipProb: Number(f.precip.value), windMax: Number(f.wind.value), code, isSnow: code === 73 }); toast('Weather set'); close(); onSaved && onSaved(); }
        catch (err) { toast(err.message, true); }
      });
    });
  }

  // ---------- boot ----------
  (async () => {
    try { state.settings = await api('GET', '/api/settings'); } catch {}
    route();
  })();
})();
