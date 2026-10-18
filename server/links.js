'use strict';
// Resolve a retailer product link into an item draft. Shopify stores (most direct-to-consumer
// menswear brands) expose /products/<handle>.js with every variant's colour and photo, so a
// link that carries ?variant=<id> identifies the exact piece the owner bought.
const { classify } = require('./classify');

let fetchImpl = (...args) => globalThis.fetch(...args);
function setFetch(fn) { fetchImpl = fn; }

async function fetchJson(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 wardrobec/0.1', 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

function parseLink(raw) {
  const url = new URL(String(raw).trim());
  const m = url.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) throw new Error('not a product link');
  return { origin: url.origin, handle: m[1], variantId: url.searchParams.get('variant'), clean: `${url.origin}/products/${m[1]}${url.searchParams.get('variant') ? `?variant=${url.searchParams.get('variant')}` : ''}` };
}

function titleFromHandle(handle) {
  return handle.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function pickColor(product, variant) {
  const names = (product.options || []).map(o => (typeof o === 'string' ? o : o.name) || '');
  const idx = names.findIndex(n => /colou?r|shade|hue/i.test(n));
  if (variant) {
    if (idx >= 0) return variant[`option${idx + 1}`] || '';
    // No option called colour: take the first option value that is not a size.
    for (const k of ['option1', 'option2', 'option3']) {
      const v = variant[k];
      if (v && !/^(xxs|xs|s|m|l|xl|xxl|xxxl|\d{1,2}(x\d{1,2})?|\d{2}[lrs]?|one size|os)$/i.test(String(v).trim())) return v;
    }
  }
  return '';
}

function normalizeProduct(data) {
  const p = data.product || data; // .json wraps in { product }, .js does not
  return {
    title: p.title || '', vendor: p.vendor || '', type: p.product_type || p.type || '', tags: Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',').map(s => s.trim()).filter(Boolean),
    options: p.options || [], variants: p.variants || [], images: p.images || [], featured: p.featured_image || null, body: String(p.body_html || p.description || ''),
  };
}

function imageUrl(src) {
  if (!src) return '';
  const s = typeof src === 'string' ? src : (src.src || '');
  if (!s) return '';
  return s.startsWith('//') ? 'https:' + s : s;
}

/** Turn a product (already fetched) plus optional variant id into an item draft. */
function draftFromProduct(product, variantId, link) {
  const p = normalizeProduct(product);
  const variant = variantId ? p.variants.find(v => String(v.id) === String(variantId)) : null;
  const color = pickColor(p, variant || p.variants[0]);
  const cleanTitle = p.title.replace(/^\s*(men'?s|women'?s|unisex)\s+/i, '').replace(/\s*[-–|]\s*(men'?s|women'?s|unisex)\s*$/i, '').trim();
  const text = [color, p.type, cleanTitle, p.tags.join(' ')].filter(Boolean).join(' ');
  const draft = classify(text);
  draft.name = [color, cleanTitle].filter(Boolean).join(' ').trim() || titleFromHandle(link.handle);
  draft.brand = p.vendor;
  draft.url = link.clean;
  draft.image = imageUrl((variant && variant.featured_image) || p.featured || p.images[0]);
  if (color) draft.color = color.toLowerCase();
  draft.variant_matched = !!variant;
  draft.resolved = true;
  if (variantId && !variant) draft.warning = 'variant id not found on this product; colour may be wrong';
  return draft;
}

/** Resolve one link. Never throws: unresolved links return a low-confidence draft named from the URL. */
async function resolveLink(raw) {
  let link;
  try { link = parseLink(raw); }
  catch (e) { return { name: String(raw).slice(0, 80), url: String(raw), resolved: false, error: e.message, ...blankDraft() }; }
  const attempts = [`${link.origin}/products/${link.handle}.js`, `${link.origin}/products/${link.handle}.json`];
  let lastErr = 'unreachable';
  for (const u of attempts) {
    try { return draftFromProduct(await fetchJson(u), link.variantId, link); }
    catch (e) { lastErr = e.message; }
  }
  const draft = classify(titleFromHandle(link.handle));
  return { ...draft, name: titleFromHandle(link.handle), url: link.clean, brand: '', resolved: false, error: `could not read product data (${lastErr}); check the name and colour`, confidence: 'low' };
}
function blankDraft() { const d = classify(''); d.confidence = 'low'; return d; }

async function resolveLinks(raws) {
  const seen = new Map();
  const order = [];
  for (const r of raws) {
    let key = String(r).trim();
    try { key = parseLink(r).clean; } catch {}
    if (!seen.has(key)) { seen.set(key, { raw: r, count: 0 }); order.push(key); }
    seen.get(key).count++;
  }
  const drafts = await Promise.all(order.map(k => resolveLink(seen.get(k).raw)));
  return drafts.map((d, i) => ({ ...d, duplicates: seen.get(order[i]).count - 1 }));
}

module.exports = { parseLink, draftFromProduct, resolveLink, resolveLinks, setFetch };
