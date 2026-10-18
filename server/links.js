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

const ATHLETIC_HOSTS = /lululemon|nike\.|adidas|underarmour|gymshark|alphalete|alphacountry|vuori|rhone|tenthousand|onrunning|hoka|brooksrunning|newbalance|reebok|puma/i;

function parseLink(raw) {
  const url = new URL(String(raw).trim());
  const shop = url.pathname.match(/\/products\/([^/?#]+)/);
  if (shop) {
    const v = url.searchParams.get('variant');
    return { kind: 'shopify', origin: url.origin, host: url.host, handle: shop[1], variantId: v, clean: `${url.origin}/products/${shop[1]}${v ? `?variant=${v}` : ''}` };
  }
  // Generic: the most word-like path segment is the product slug; colour/sku/variant params identify the piece.
  const segs = url.pathname.split('/').filter(Boolean);
  const slug = segs.filter(x => /[a-z]/i.test(x) && /-/.test(x)).sort((a, b) => b.length - a.length)[0] || segs[segs.length - 1];
  if (!slug) throw new Error('not a product link');
  const colorId = url.searchParams.get('color') || url.searchParams.get('colour') || url.searchParams.get('variant') || url.searchParams.get('sku') || url.searchParams.get('dwvar_color') || '';
  const clean = `${url.origin}${url.pathname}${colorId ? `?color=${encodeURIComponent(colorId)}` : ''}`;
  return { kind: 'generic', origin: url.origin, host: url.host, handle: slug, variantId: colorId || null, clean };
}

async function fetchText(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) wardrobec/0.1', 'Accept': 'text/html' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}

/** Pull product facts out of a page: JSON-LD Product first, Open Graph tags second. */
function extractPageProduct(html) {
  const out = { title: '', color: '', image: '', brand: '', description: '' };
  const ld = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of ld) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
    for (const n of nodes) {
      const type = Array.isArray(n['@type']) ? n['@type'].join(' ') : String(n['@type'] || '');
      if (!/Product/i.test(type)) continue;
      out.title = out.title || n.name || '';
      out.color = out.color || n.color || '';
      out.brand = out.brand || (typeof n.brand === 'string' ? n.brand : (n.brand && n.brand.name) || '');
      out.description = out.description || n.description || '';
      const img = Array.isArray(n.image) ? n.image[0] : n.image;
      out.image = out.image || (typeof img === 'string' ? img : (img && img.url) || '');
    }
  }
  const meta = (prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i')); return m ? m[1] : ''; };
  out.title = out.title || meta('og:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  out.image = out.image || meta('og:image');
  out.brand = out.brand || meta('product:brand') || meta('og:site_name');
  out.description = out.description || meta('og:description');
  out.title = out.title.replace(/&amp;/g, '&').replace(/\s*[|–-]\s*[^|–-]*$/i, (m) => (/lululemon|shop|store|official/i.test(m) ? '' : m)).trim();
  return out;
}

function athleticTouch(draft, host) {
  if (!ATHLETIC_HOSTS.test(host || '')) return draft;
  if (['top', 'shoes'].includes(draft.category) || draft.subcategory === 'shorts') {
    if (!draft.occasions.includes('gym')) draft.occasions.push('gym');
    draft.formality_min = 0;
    if (draft.subcategory === 'shorts') { draft.subcategory = 'athletic shorts'; draft.formality_max = Math.min(draft.formality_max, 1); draft.warmth = 1; draft.wears_before_wash = 1; }
  }
  return draft;
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
  return athleticTouch(draft, link.host);
}

/** Generic page: name, colour and photo from the page's product metadata. */
function draftFromPage(html, link) {
  const p = extractPageProduct(html);
  const name = (p.title || titleFromHandle(link.handle)).replace(/^\s*(men'?s|women'?s|unisex)\s+/i, '').trim();
  const draft = classify([p.color, name, p.description.slice(0, 120)].filter(Boolean).join(' '));
  draft.name = [p.color, name].filter(Boolean).join(' ').trim();
  draft.brand = p.brand || '';
  draft.url = link.clean;
  draft.image = imageUrl(p.image);
  draft.color = (p.color || draft.color || '').toLowerCase();
  draft.resolved = true;
  draft.variant_matched = !!p.color;
  if (!p.color) {
    draft.warning = link.variantId ? `colour not readable from the page (colour code ${link.variantId}); set it by hand` : 'colour not readable from the page; set it by hand';
    if (link.variantId) draft.notes = `colour code ${link.variantId}`;
  }
  return athleticTouch(draft, link.host);
}

/** Resolve one link. Never throws: unresolved links return a low-confidence draft named from the URL. */
async function resolveLink(raw) {
  let link;
  try { link = parseLink(raw); }
  catch (e) { return { name: String(raw).slice(0, 80), url: String(raw), resolved: false, error: e.message, ...blankDraft() }; }
  let lastErr = 'unreachable';
  if (link.kind === 'shopify') {
    for (const u of [`${link.origin}/products/${link.handle}.js`, `${link.origin}/products/${link.handle}.json`]) {
      try { return draftFromProduct(await fetchJson(u), link.variantId, link); }
      catch (e) { lastErr = e.message; }
    }
  }
  try { return draftFromPage(await fetchText(link.clean), link); }
  catch (e) { lastErr = e.message; }
  const draft = athleticTouch(classify(titleFromHandle(link.handle)), link.host);
  return { ...draft, name: titleFromHandle(link.handle), url: link.clean, brand: '', resolved: false, notes: link.variantId ? `colour code ${link.variantId}` : '', error: `could not read product data (${lastErr}); check the name and colour`, confidence: 'low' };
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

module.exports = { parseLink, draftFromProduct, draftFromPage, extractPageProduct, resolveLink, resolveLinks, setFetch };
