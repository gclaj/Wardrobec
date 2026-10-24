'use strict';
// Outfit engine. Pure functions over plain item objects: no I/O, fully testable.
//
// Scales used throughout:
//   formality 0..5   0 athletic, 1 casual, 2 smart casual, 3 business casual, 4 business formal, 5 black tie
//   warmth    1..5   1 hot-weather piece .. 5 deep-cold piece
//   temperatures are Fahrenheit (apparent / "feels like" where available)

const { NEUTRALS } = require('./classify');
const { paletteRating, normalizeProfile, JEWEL, DARK, LIGHT } = require('./profile');
const guide = require('./styleguide');

// How much a piece's colour matters, by how close it sits to the face.
const PALETTE_WEIGHT = { top: 0.9, dress: 0.9, layer: 0.8, outerwear: 0.6, accessory: 0.5, bottom: 0.3, shoes: 0.2 };

const OCCASIONS = {
  gym:             { key: 'gym',             label: 'Gym',             band: [0, 0], ideal: 0, tolerance: 0 },
  casual:          { key: 'casual',          label: 'Casual',          band: [1, 2], ideal: 1.5, tolerance: 1 },
  business_casual: { key: 'business_casual', label: 'Business Casual', band: [3, 3], ideal: 3, tolerance: 1 },
  formal:          { key: 'formal',          label: 'Formal',          band: [4, 5], ideal: 4.5, tolerance: 1 },
};
const OCCASION_KEYS = Object.keys(OCCASIONS);
const LEANS = { relaxed: { shift: -0.5, label: 'Relaxed' }, standard: { shift: 0, label: 'Standard' }, elevated: { shift: 0.5, label: 'Elevated' } };
const SNEAKER_SUBS = /sneaker|trainer|training shoe|running/i;
const DRESSY_SHOE_SUBS = /loafer|chukka|chelsea|dress shoe|derby|oxford|boot/i;

const JACKET_SUBS = new Set(['blazer', 'suit jacket', 'tuxedo jacket', 'sport coat']);
const CLASHES = [
  ['red', 'pink'], ['red', 'orange'], ['red', 'purple'], ['orange', 'pink'], ['green', 'red'],
  ['purple', 'yellow'], ['orange', 'purple'], ['burgundy', 'red'], ['burgundy', 'orange'], ['pink', 'yellow'],
];

// ---------- seeded randomness, so a given day is stable but "regenerate" varies ----------
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- weather → targets ----------
/** Warmth an outfit should deliver for a given apparent temperature (°F). 82→1, 68→2, 54→3, 40→4, 26→5. */
function targetWarmth(tempF, occasionKey) {
  if (tempF == null || Number.isNaN(tempF)) return 2.5;
  const t = clamp(1 + (82 - tempF) / 14, 1, 5.5);
  // Gym sessions are mostly indoors and you warm up fast: damp the cold-weather target.
  return occasionKey === 'gym' ? 1 + (t - 1) * 0.6 : t;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Normalise an arbitrary weather object into what the engine needs. */
function weatherContext(w, occasionKey) {
  w = w || {};
  const temp = firstNumber(w.feelsLike, w.apparentTemp, w.temp, w.tempHigh);
  const precipProb = firstNumber(w.precipProb, 0);
  const code = w.code != null ? Number(w.code) : null;
  const isSnow = w.isSnow != null ? !!w.isSnow : (code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86));
  const isRain = w.isRain != null ? !!w.isRain : (precipProb >= 45 || (code != null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95)));
  const wind = firstNumber(w.windMax, w.wind, 0);
  const uv = firstNumber(w.uv, w.uvIndex, 0);
  return { temp, target: targetWarmth(temp, occasionKey), precipProb, isRain, isSnow, wind, uv, code, summary: w.summary || '' };
}
function firstNumber(...vals) {
  for (const v of vals) if (v != null && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

// ---------- per-item scoring ----------
function daysBetween(a, b) {
  if (!a || !b) return Infinity;
  const ms = Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z');
  return Math.round(ms / 86400000);
}

/** Formality fit: 0 = fits; positive = penalty; null = ineligible. */
function formalityPenalty(item, occ) {
  const [lo, hi] = occ.band;
  const tagged = Array.isArray(item.occasions) && item.occasions.includes(occ.key);
  const min = Number(item.formality_min ?? 1), max = Number(item.formality_max ?? min);
  if (occ.key === 'gym') return (tagged || max === 0) ? 0 : null;
  if (max === 0 && !tagged) return null; // pure athletic gear outside the gym
  const overlap = Math.max(min, lo) <= Math.min(max, hi);
  let pen;
  if (overlap) {
    pen = 0;
  } else {
    const gap = min > hi ? min - hi : lo - max;
    if (gap > occ.tolerance && !tagged) return null;
    pen = 2.5 * gap;
  }
  if (tagged) pen *= 0.5;
  // Gentle pull toward the centre of the dress code, so a dress shirt beats an oxford under a suit.
  pen += 0.3 * Math.abs((min + max) / 2 - occ.ideal);
  return pen;
}

function freshnessPenalty(item, date) {
  const d = daysBetween(item.last_worn, date);
  if (d < 0) return 0;          // last_worn after the planning date (planning ahead)
  if (d === 0) return 4;
  if (d === 1) return 3;
  if (d <= 3) return 1.5;
  if (d <= 6) return 0.5;
  return 0;
}

function itemWeatherPenalty(item, slot, wx) {
  const w = Number(item.warmth || 2), t = wx.target;
  let p = 0;
  switch (slot) {
    case 'bottom':
      p += Math.max(0, t - w - 0.5) * 1.5;        // shorts in the cold
      p += Math.max(0, w - t - 1.2) * 1.0;        // wool trousers in a heat wave
      break;
    case 'shoes':
      p += Math.max(0, t - w - 1.5) * 1.2;
      p += Math.max(0, w - t - 1) * 1.0;          // boots in a heat wave
      if (wx.isRain && !item.rain_ok) p += 2.2;
      if (wx.isSnow && !item.rain_ok) p += 3;
      if (wx.isSnow && w < 3) p += 1.5;
      break;
    case 'top':
    case 'dress':
      p += Math.max(0, w - t - 0.5) * 1.5;        // a sweater-weight top when it is hot
      if (slot === 'dress') p += Math.max(0, t - w - 1.5) * 1.0;
      break;
    case 'layer':
      p += Math.max(0, w - t - 1.2) * 1.2;
      break;
    case 'outerwear':
      if (wx.isRain && item.rain_ok) p -= 0.8;
      if (wx.isRain && !item.rain_ok && Number(item.warmth) >= 4) p += 0.6; // soaking a wool coat
      if (wx.wind >= 20 && item.wind_ok) p -= 0.4;
      break;
    default: break;
  }
  return p;
}

/**
 * Score one item for a slot in context. Lower is better. Returns null when ineligible.
 * ctx: { occasion, date, wx, affinity: Map(itemId→score), exclude: Set, ignoreStatus, allowDirty, rand }
 */
function scoreItem(item, slot, ctx) {
  if (ctx.exclude && ctx.exclude.has(item.id)) return null;
  if (ctx.uses && ctx.uses.has(item.id) && ctx.uses.get(item.id) <= 0) return null; // used up on this trip
  if (!ctx.ignoreStatus) {
    if (item.status === 'retired' || item.status === 'laundry') return null;
    if (item.status === 'dirty' && !ctx.allowDirty) return null;
  }
  const f = formalityPenalty(item, ctx.occasion);
  if (f == null) return null;
  let s = f;
  if (!ctx.ignoreStatus) {
    s += freshnessPenalty(item, ctx.date);
    if (item.status === 'dirty') s += 4;
  }
  s += itemWeatherPenalty(item, slot, ctx.wx);
  if (ctx.occasion.look) s += guide.formulaPenalty(item, slot, ctx.occasion.look);
  if (slot === 'shoes' && ctx.occasion.lean === 'elevated' && SNEAKER_SUBS.test(item.subcategory || '')) s += 0.8;
  if (slot === 'shoes' && ctx.occasion.lean === 'relaxed' && DRESSY_SHOE_SUBS.test(item.subcategory || '') && !item.rain_ok) s += 0.5;
  if (item.favorite) s -= 0.7;
  if (ctx.prefer && ctx.prefer.has(item.id)) s -= 1.5; // already in the bag: mix and match
  if (ctx.profile) s -= ctx.pr(item) * (PALETTE_WEIGHT[slot] || 0.3);
  const aff = ctx.affinity ? (ctx.affinity.get(item.id) || 0) : 0;
  s -= aff * 0.6;
  s -= 0.3 * (1 - Math.min(Number(item.wear_count || 0), 10) / 10); // rotate underused pieces in
  if (ctx.rand) s += ctx.rand() * 0.8;
  return s;
}

// ---------- combination scoring ----------
function outfitWarmth(c) {
  let w = c.dress ? Number(c.dress.warmth) : (c.top ? Number(c.top.warmth) : 1.5);
  if (c.layer) w += 0.4 + 0.4 * (Number(c.layer.warmth) - 1);
  if (c.outerwear) w += 0.3 + 0.7 * (Number(c.outerwear.warmth) - 1);
  return Math.min(w, 6);
}

/** Stable key for a combination of core pieces (accessories excluded). */
function comboKey(c) {
  return ['top', 'dress', 'layer', 'outerwear', 'bottom', 'shoes'].map(k => c[k] && c[k].id).filter(Boolean).sort((a, b) => a - b).join(',');
}
function comboKeyFromIds(ids) { return [...new Set(ids.map(Number))].sort((a, b) => a - b).join(','); }
function pairKeys(ids) {
  const s = [...new Set(ids.map(Number))].sort((a, b) => a - b); const out = [];
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) out.push(s[i] + '|' + s[j]);
  return out;
}

function center(item) { return (Number(item.formality_min ?? 1) + Number(item.formality_max ?? 1)) / 2; }

const DEFAULT_PAIR_RULES = [
  { a: 'navy', b: 'olive', verdict: 'never' },
  { a: 'navy', b: 'green', verdict: 'never' },
];
const GREENS = { olive: 'green-ish', green: 'green-ish' };

/** Owner-defined colour pairings: 'never' removes the combination, 'avoid' discourages it. */
function pairRulePenalty(c, rules, notes) {
  if (!rules || !rules.length) return 0;
  const near = ['top', 'dress', 'layer', 'outerwear'].map(k => c[k]).filter(Boolean);
  const pieces = [...near, c.bottom, c.shoes].filter(Boolean);
  let p = 0;
  const seen = new Set();
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const fa = pieces[i].color_family, fb = pieces[j].color_family;
    for (const r of rules) {
      const hit = (fa === r.a && fb === r.b) || (fa === r.b && fb === r.a);
      if (!hit) continue;
      const key = [r.a, r.b].sort().join('+');
      if (seen.has(key)) continue; seen.add(key);
      if (r.verdict === 'never') { p += 8; notes.push(`you have said ${r.a} and ${r.b} do not go together`); }
      else { p += 1.5; notes.push(`${r.a} with ${r.b} is one you prefer to avoid`); }
    }
  }
  return p;
}

function colorPenalty(c, notes) {
  const pieces = ['top', 'dress', 'layer', 'outerwear', 'bottom', 'shoes'].map(k => c[k]).filter(Boolean);
  const fams = pieces.map(p => p.color_family || 'other');
  const nonNeutral = [...new Set(fams.filter(f => !NEUTRALS.has(f) && f !== 'other' && f !== 'white'))];
  let p = 0;
  if (fams.includes('multi') && nonNeutral.length > 1) { p += 1.0; }
  if (nonNeutral.length >= 3) { p += 1.5; notes.push('too many competing colors'); }
  for (const [a, b] of CLASHES) if (nonNeutral.includes(a) && nonNeutral.includes(b)) { p += 1.0; notes.push(`${a} and ${b} fight each other`); }
  const bottomFam = c.bottom && c.bottom.color_family, shoeFam = c.shoes && c.shoes.color_family;
  if ((bottomFam === 'black' || bottomFam === 'charcoal') && shoeFam === 'brown' && center(c.bottom) >= 3) { p += 0.8; notes.push('brown shoes with black trousers'); }
  const topFam = (c.top || c.dress || {}).color_family;
  if (topFam && bottomFam && topFam === bottomFam && !NEUTRALS.has(topFam) && topFam !== 'other') { p += 0.5; notes.push('same strong color top and bottom'); }
  if ((topFam === 'navy' && bottomFam === 'black') || (topFam === 'black' && bottomFam === 'navy')) p += 0.3;
  if (topFam === 'white' && bottomFam === 'white') { p += 1.0; notes.push('white head to toe'); }
  const patterned = ['top', 'dress', 'layer', 'outerwear', 'bottom'].map(k => c[k]).filter(x => x && x.pattern && x.pattern !== 'solid');
  if (patterned.length >= 2) { p += 1.0; notes.push('two patterns competing'); }
  return p;
}

function profileComboPenalty(c, profile, notes, pr, occasionKey) {
  let p = 0;
  const near = ['top', 'dress', 'layer', 'outerwear'].map(k => c[k]).filter(Boolean);
  // Per-item bonuses were already applied in scoreItem; cap their total so a flattering colour
  // never becomes a reason to add an unnecessary layer.
  let bonus = 0;
  for (const slot of ['top', 'dress', 'layer', 'outerwear', 'bottom', 'shoes']) if (c[slot]) bonus += Math.max(0, pr(c[slot])) * (PALETTE_WEIGHT[slot] || 0.3);
  if (bonus > 2.0) p += bonus - 2.0;
  for (const it of near) {
    const r = pr(it);
    if (r <= -1.5) notes.push(`${it.name} reads warm or dusty against your colouring`);
  }
  if (profile.contrast === 'high' && occasionKey !== 'gym') {
    const fams = near.map(x => x.color_family);
    const hasDark = fams.some(f => DARK.has(f)) || (c.bottom && DARK.has(c.bottom.color_family));
    const hasLight = fams.some(f => LIGHT.has(f));
    const hasJewel = [...near, c.bottom].filter(Boolean).some(x => JEWEL.has(x.color_family) && x.color_family !== 'navy');
    if (hasDark && hasLight) p -= 0.6;                 // crisp contrast near the face
    if (hasDark && hasLight && hasJewel) p -= 0.4;     // the full formula
    if (!hasDark && !hasLight && near.length) p += 0.5; // everything mid-tone: flat on a high-contrast face
  }
  return p;
}

function ratingCache(profile) {
  const cache = new Map();
  return (item) => {
    const key = item.id != null ? item.id : item.name;
    if (!cache.has(key)) cache.set(key, paletteRating(item, profile));
    return cache.get(key);
  };
}

function setPenalty(c, items, notes) {
  const chosen = ['layer', 'outerwear', 'bottom', 'top', 'dress'].map(k => c[k]).filter(x => x && x.set_id);
  if (!chosen.length) return 0;
  const sets = new Set(chosen.map(x => x.set_id));
  if (sets.size > 1) { notes.push('mixing pieces from different suits'); return 3; }
  const setId = chosen[0].set_id;
  const members = items.filter(i => i.set_id === setId);
  const chosenIds = new Set(chosen.map(x => x.id));
  const missing = members.filter(m => !chosenIds.has(m.id) && m.category !== 'accessory');
  if (missing.length) { notes.push('suit split from its matching piece'); return 2; }
  return -1; // full suit worn together
}

/** Score a full combination. Returns { score, notes }. Lower is better. */
function scoreCombo(c, ctx, items) {
  const wx = ctx.wx, occ = ctx.occasion, notes = [];
  let s = 0;
  for (const slot of ['top', 'dress', 'layer', 'outerwear', 'bottom', 'shoes']) {
    if (c[slot]) s += (c[slot]._slotScore != null ? c[slot]._slotScore : 0);
  }
  // Warmth balance
  const warmth = outfitWarmth(c);
  const diff = warmth - wx.target;
  s += diff < 0 ? -diff * 2.0 : diff * 1.6;
  if (wx.target <= 1.4 && c.layer && !(occ.key === 'formal' || occ.key === 'business_casual') ) { s += 1.5; notes.push('too hot for a layer'); }
  if (wx.target <= 1.4 && c.layer && (occ.key === 'formal' || occ.key === 'business_casual') && !JACKET_SUBS.has(c.layer.subcategory)) { s += 1.5; notes.push('too hot for a layer'); }
  if (wx.target >= 3.3 && !c.outerwear && !c.layer) { s += 2.5; notes.push('no layer for the cold'); }
  if (wx.target >= 4.2 && !c.outerwear) { s += 2.0; notes.push('a coat is needed'); }
  if (wx.target <= 1.5 && c.outerwear && Number(c.outerwear.warmth) >= 3) { s += 2.0; notes.push('too heavy for the heat'); }
  if (c.layer && c.outerwear && wx.target < 2.2) { s += 1.0; }
  // Rain / wind
  if (wx.isRain) {
    if (c.outerwear && !c.outerwear.rain_ok) s += 1.0;
    if (!c.outerwear && wx.target >= 2.2) { s += 1.0; notes.push('nothing to keep the rain off'); }
  }
  if (wx.wind >= 20 && !c.outerwear && wx.target >= 2.5) s += 0.6;
  // Formality coherence and dress-code completion
  const pieces = ['top', 'dress', 'layer', 'outerwear', 'bottom', 'shoes'].map(k => c[k]).filter(Boolean);
  const centers = pieces.map(center);
  const spread = Math.max(...centers) - Math.min(...centers);
  if (spread > 1.5) s += (spread - 1.5) * 0.8;
  const jacket = [c.layer, c.outerwear].find(x => x && JACKET_SUBS.has(x.subcategory));
  if (occ.key === 'formal') {
    if (jacket) s -= 1.0; else { s += 1.5; notes.push('no jacket for a formal setting'); }
  } else if (occ.key === 'business_casual') {
    if (jacket && !(occ.look && occ.look.noLayer)) s -= 0.5;
  } else if (occ.key === 'casual' && jacket && center(jacket) >= 4) {
    s += 1.0; // suit jacket at a cookout
  }
  if (c.dress && occ.key === 'gym') s += 10;
  // Personal colour profile: contrast and the "look formula" (dark base + crisp white + jewel accent)
  if (ctx.profile) s += profileComboPenalty(c, ctx.profile, notes, ctx.pr, occ.key);
  // What the owner has said about this exact combination and the pairs inside it
  if (ctx.feedback) {
    const key = comboKey(c);
    if (ctx.feedback.banned.has(key)) { s += 100; notes.push('you said never again'); }
    if (ctx.feedback.fab.has(key)) { s -= 3.0; }
    if (ctx.feedback.pairs.size) for (const pk of pairKeys(key.split(',').filter(Boolean))) s += ctx.feedback.pairs.get(pk) || 0;
  }
  // Style-guide rules (one accent colour, simple layering)
  if (occ.look || (ctx.profile && ctx.profile.key === 'style_guide')) s += guide.styleRules(c, notes);
  // Suits
  s += setPenalty(c, items, notes);
  // Color
  s += colorPenalty(c, notes);
  s += pairRulePenalty(c, ctx.pairRules, notes);
  if (ctx.rand) s += ctx.rand() * 0.5;
  return { score: s, notes, warmth };
}

// ---------- building ----------
function pool(items, slot, ctx, limit) {
  const cat = slot;
  const out = [];
  for (const it of items) {
    if (it.category !== cat) continue;
    const sc = scoreItem(it, slot, ctx);
    if (sc == null) continue;
    out.push({ ...it, _slotScore: sc });
  }
  out.sort((a, b) => a._slotScore - b._slotScore);
  return out.slice(0, limit);
}

function enumerate(pools, ctx, items) {
  const results = [];
  const tops = pools.top, bottoms = pools.bottom, shoes = pools.shoes.length ? pools.shoes : [null];
  const layers = [null, ...pools.layer], outers = [null, ...pools.outerwear];
  const push = (c) => { const r = scoreCombo(c, ctx, items); results.push({ combo: c, ...r }); };
  for (const top of tops.length ? tops : [null]) for (const bottom of bottoms.length ? bottoms : [null]) {
    if (!top && !bottom) continue;
    for (const sh of shoes) for (const layer of layers) for (const outer of outers) {
      push({ top, bottom, shoes: sh, layer, outerwear: outer });
    }
  }
  if (ctx.occasion.key !== 'gym') {
    for (const dress of pools.dress) for (const sh of shoes) for (const layer of layers) for (const outer of outers) {
      push({ dress, shoes: sh, layer, outerwear: outer });
    }
  }
  results.sort((a, b) => a.score - b.score);
  return results;
}

function pickAccessories(items, chosen, ctx, lockedIds) {
  const wx = ctx.wx, occ = ctx.occasion;
  const acc = pool(items, 'accessory', ctx, 100);
  const chosenIds = new Set(Object.values(chosen).filter(Boolean).map(x => x.id));
  const picks = [];
  const bySub = (sub) => acc.filter(a => a.subcategory === sub && !chosenIds.has(a.id));
  const take = (list, why) => { if (list.length) { picks.push({ ...list[0], _why: why }); chosenIds.add(list[0].id); } };
  const shoeFam = chosen.shoes && chosen.shoes.color_family;

  if (wx.isRain) take(bySub('umbrella'), 'rain in the forecast');
  if (occ.key === 'formal') { take(bySub('bow tie').filter(b => center(b) >= 5 && center(chosen.layer || {}) >= 5), 'black tie'); if (!picks.some(p => p.subcategory === 'bow tie')) take(bySub('tie'), 'formal setting'); }
  if (chosen.bottom && occ.key !== 'gym' && center(chosen.bottom) >= 1 && chosen.bottom.subcategory !== 'joggers' && chosen.bottom.subcategory !== 'leggings') {
    const belts = bySub('belt');
    const matched = belts.filter(b => b.color_family === shoeFam);
    take(matched.length ? matched : belts, matched.length ? 'belt matches the shoes' : 'belt');
  }
  const watches = occ.key === 'gym' ? [...bySub('sports watch'), ...bySub('watch')] : [...bySub('watch'), ...(occ.key === 'casual' ? bySub('sports watch') : [])];
  take(watches, 'watch');
  if (wx.target >= 3.8) { take(bySub('scarf'), 'cold'); if (wx.target >= 4.4) { take(bySub('gloves'), 'cold'); if (occ.key !== 'formal') take(bySub('beanie'), 'cold'); } }
  if (wx.target <= 2.2 && (occ.key === 'gym' || occ.key === 'casual')) take(bySub('cap'), 'sun');
  if (wx.uv >= 5 && occ.key !== 'formal') take(bySub('sunglasses'), 'bright day');
  if (occ.key === 'formal' && chosen.layer && JACKET_SUBS.has(chosen.layer.subcategory)) take(bySub('pocket square'), 'finishing touch');
  if (occ.key === 'business_casual') take(bySub('bag').filter(b => center(b) >= 2), 'work bag');
  if (occ.key === 'gym') take(bySub('bag').filter(b => /gym/i.test(b.name)), 'gym bag');
  if (occ.look && occ.look.formula.accessory && occ.look.formula.accessory.includes('bag') && !picks.some(p => p.subcategory === 'bag')) take(bySub('bag').filter(b => center(b) <= 2), 'sling or day bag');
  // Locked accessories the user insisted on
  if (lockedIds) for (const id of lockedIds) { const a = acc.find(x => x.id === id); if (a && !chosenIds.has(id)) picks.push({ ...a, _why: 'kept' }); }
  return picks.slice(0, 5);
}

function rationale(ctx, best, chosen) {
  const wx = ctx.wx, occ = ctx.occasion, lines = [];
  const t = wx.temp != null ? `${Math.round(wx.temp)}°F` : 'unknown temperature';
  if (occ.look) {
    lines.push(`${occ.look.name}: ${occ.look.summary}.`);
    lines.push(occ.look.why);
  } else {
    lines.push(`${occ.label}${occ.lean && occ.lean !== 'standard' ? ' (' + LEANS[occ.lean].label.toLowerCase() + ')' : ''}: dress code band ${occ.band[0]}–${occ.band[1]} of 5.`);
  }
  const layerBits = [];
  if (chosen.outerwear) layerBits.push(chosen.outerwear.name);
  if (chosen.layer) layerBits.push(chosen.layer.name);
  if (wx.temp != null) {
    const raw = targetWarmth(wx.temp);
    const feel = raw >= 4.4 ? 'cold' : raw >= 3.3 ? 'cool' : raw >= 2.3 ? 'mild' : raw >= 1.6 ? 'warm' : 'hot';
    lines.push(`Feels like ${t} (${feel})${layerBits.length ? `, so ${layerBits.join(' over ')} ${layerBits.length > 1 ? 'go' : 'goes'} on top` : ', no outer layer needed'}.`);
  }
  if (wx.isSnow) lines.push('Snow expected: weather-ready footwear prioritised.');
  else if (wx.isRain) lines.push(`Rain likely (${Math.round(wx.precipProb)}%): ${chosen.outerwear && chosen.outerwear.rain_ok ? chosen.outerwear.name + ' sheds water' : 'take an umbrella'}; ${chosen.shoes && chosen.shoes.rain_ok ? 'shoes can take it' : 'shoes will get wet'}.`);
  if (wx.wind >= 20) lines.push(`Wind up to ${Math.round(wx.wind)} mph.`);
  if (ctx.profile) {
    const near = ['outerwear', 'layer', 'top', 'dress'].map(k => chosen[k]).filter(Boolean);
    const good = near.filter(x => ctx.pr(x) >= 1.5).map(x => x.name);
    if (good.length) lines.push(`${ctx.profile.season || 'Your'} palette: ${good.join(', ')} ${good.length > 1 ? 'brighten' : 'brightens'} you.`);
  }
  if (best.notes.length) lines.push('Watch-outs: ' + [...new Set(best.notes)].join('; ') + '.');
  return lines;
}

/**
 * Build the best outfit for an occasion and weather.
 * opts: { date, weather, attempt, exclude:Set<id>, lock:{slot:id}, affinity:Map, allowDirty, ignoreStatus, seedSalt }
 */
function buildOutfit(items, occasionKey, opts = {}) {
  const base = OCCASIONS[occasionKey];
  if (!base) throw new Error('unknown occasion ' + occasionKey);
  // A lean nudges the ideal within the band: "date night" is casual but wants a henley and
  // boots, "errands" is casual but wants a tee and sneakers.
  const wxPre = weatherContext(opts.weather, occasionKey);
  const lookKey = opts.look === undefined ? guide.defaultLook(occasionKey, wxPre.target) : opts.look;
  const look = lookKey && guide.LOOKS[lookKey] && guide.LOOKS[lookKey].occasion === occasionKey ? guide.LOOKS[lookKey] : null;
  const lean = LEANS[opts.lean] ? opts.lean : (look ? look.lean : 'standard');
  const occ = { ...base, ideal: base.ideal + LEANS[lean].shift, lean, look };
  const wx = weatherContext(opts.weather, occasionKey);
  const seed = hashString(`${opts.date || ''}|${occasionKey}|${opts.attempt || 0}|${opts.seedSalt || ''}`);
  const ctx = {
    occasion: occ, date: opts.date, wx,
    exclude: opts.exclude || new Set(), affinity: opts.affinity, allowDirty: !!opts.allowDirty,
    ignoreStatus: !!opts.ignoreStatus, rand: opts.deterministic ? null : mulberry32(seed),
    profile: normalizeProfile(opts.profile),
    feedback: opts.feedback || null, prefer: opts.prefer || null, uses: opts.uses || null,
    pairRules: opts.pairRules === undefined ? DEFAULT_PAIR_RULES : (opts.pairRules || []),
  };
  ctx.pr = ctx.profile ? ratingCache(ctx.profile) : () => 0;
  const lock = opts.lock || {};
  const lockedItem = (slot) => lock[slot] ? items.find(i => i.id === lock[slot] && i.category === slot) : null;

  const L = opts.fast ? { top: 4, bottom: 4, shoes: 3, layer: 3, outerwear: 3, dress: 2 } : { top: 8, bottom: 8, shoes: 6, layer: 5, outerwear: 5, dress: 4 };
  let pools = {
    top: pool(items, 'top', ctx, L.top), bottom: pool(items, 'bottom', ctx, L.bottom), shoes: pool(items, 'shoes', ctx, L.shoes),
    layer: pool(items, 'layer', ctx, L.layer), outerwear: pool(items, 'outerwear', ctx, L.outerwear), dress: pool(items, 'dress', ctx, L.dress),
  };
  for (const slot of Object.keys(pools)) {
    const li = lockedItem(slot);
    if (li) pools[slot] = [{ ...li, _slotScore: scoreItem(li, slot, { ...ctx, ignoreStatus: true }) ?? 0 }];
  }
  if (lock.top || lock.bottom) pools.dress = [];
  if (lock.dress) { pools.top = []; pools.bottom = []; }
  // When the user locks "no layer"/"no outerwear" we accept lock[slot] === null → empty pool
  if (lock.layer === null) pools.layer = [];
  if (lock.outerwear === null) pools.outerwear = [];

  // Fallback: nothing clean in a required slot → allow dirty pieces rather than return nothing.
  for (const slot of ['top', 'bottom', 'shoes']) {
    if (!pools[slot].length && !ctx.allowDirty && !ctx.ignoreStatus && !(slot !== 'shoes' && pools.dress.length)) {
      pools[slot] = pool(items, slot, { ...ctx, allowDirty: true }, 8);
    }
  }

  const ranked = enumerate(pools, ctx, items);
  if (!ranked.length) {
    return { occasion: occasionKey, complete: false, items: [], missing: missingSlots({}, occ), accessories: [], score: null, rationale: ['Nothing in the closet is eligible for this occasion yet.'], weather: wx, alternatives: {} };
  }
  const best = ranked[0];
  const chosen = best.combo;
  const accessories = pickAccessories(items, chosen, ctx, lock.accessories);
  const missing = missingSlots(chosen, occ);

  // Alternatives: for each filled or fillable slot, the best swaps holding the rest constant.
  const alternatives = {};
  for (const slot of ['top', 'dress', 'layer', 'outerwear', 'bottom', 'shoes']) {
    const current = chosen[slot];
    const candidates = pools[slot].filter(x => !current || x.id !== current.id);
    const scored = candidates.map(x => {
      const c = { ...chosen, [slot]: x };
      if (slot === 'dress') { delete c.top; delete c.bottom; }
      if (slot === 'top' || slot === 'bottom') delete c.dress;
      return { item: stripInternal(x), delta: scoreCombo(c, { ...ctx, rand: null }, items).score - best.score };
    }).sort((a, b) => a.delta - b.delta).slice(0, 5);
    if (current && (slot === 'layer' || slot === 'outerwear')) {
      const c = { ...chosen, [slot]: null };
      scored.push({ item: null, delta: scoreCombo(c, { ...ctx, rand: null }, items).score - best.score });
    }
    if (scored.length) alternatives[slot] = scored;
  }

  const slots = {};
  for (const slot of ['outerwear', 'layer', 'top', 'dress', 'bottom', 'shoes']) if (chosen[slot]) slots[slot] = stripInternal(chosen[slot]);
  return {
    occasion: occasionKey,
    label: occ.label,
    look: occ.look ? { key: occ.look.key, name: occ.look.name, summary: occ.look.summary } : null,
    comboKey: comboKey(chosen),
    fab: !!(ctx.feedback && ctx.feedback.fab.has(comboKey(chosen))),
    lean,
    complete: missing.length === 0,
    missing,
    slots,
    items: Object.values(slots),
    accessories: accessories.map(a => ({ ...stripInternal(a), why: a._why })),
    score: round(best.score),
    fit: missing.length ? 'incomplete' : fitLabel(best.score),
    warmth: round(best.warmth),
    targetWarmth: round(wx.target),
    rationale: rationale(ctx, best, chosen),
    notes: [...new Set(best.notes)],
    weather: wx,
    alternatives,
  };
}

function missingSlots(c, occ) {
  const m = [];
  if (!c.dress) { if (!c.top) m.push('top'); if (!c.bottom) m.push('bottom'); }
  if (!c.shoes) m.push('shoes');
  return m;
}
function stripInternal(x) { if (!x) return x; const { _slotScore, _why, ...rest } = x; return rest; }
function round(n) { return n == null ? null : Math.round(n * 10) / 10; }
function fitLabel(score) {
  if (score == null) return 'incomplete';
  if (score < 1.5) return 'excellent';
  if (score < 4) return 'good';
  if (score < 7) return 'workable';
  return 'stretch';
}

/**
 * Plan a whole day: the four standard options plus one outfit per calendar event.
 * Event outfits never share pieces with each other (you would actually wear them all).
 */
function planDay(items, { date, weather, hourly, events = [], attempt = 0, affinity, attempts = {} }) {
  const standard = {};
  for (const key of OCCASION_KEYS) {
    standard[key] = buildOutfit(items, key, { date, weather, attempt: attempts[key] ?? attempt, affinity });
  }
  const used = new Set();
  const eventPlans = [];
  const sorted = [...events].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  for (const ev of sorted) {
    const wxAt = hourly && ev.time ? (hourlyAt(hourly, ev.time) || weather) : weather;
    const outfit = buildOutfit(items, ev.occasion, { date, weather: wxAt, attempt: attempts['event:' + ev.id] ?? attempt, affinity, exclude: new Set(used), seedSalt: 'event' + ev.id });
    for (const it of outfit.items) used.add(it.id);
    eventPlans.push({ event: ev, outfit });
  }
  return { date, weather, standard, events: eventPlans };
}

function hourlyAt(hourly, time) {
  if (!Array.isArray(hourly) || !hourly.length) return null;
  const h = parseInt(String(time).slice(0, 2), 10);
  if (Number.isNaN(h)) return null;
  return hourly.find(x => x.hour === h) || null;
}

/** Guess the occasion from pieces the owner has already chosen. */
function inferOccasion(pieces) {
  const ps = pieces.filter(Boolean);
  if (!ps.length) return 'casual';
  const gymTagged = p => (p.occasions || []).includes('gym');
  const gymOnly = p => Number(p.formality_max) === 0 || ((p.occasions || []).length > 0 && (p.occasions || []).every(o => o === 'gym'));
  if (ps.every(gymTagged) && ps.some(gymOnly)) return 'gym';
  // A piece's floor says more than its ceiling: dress shoes reach 5 but are worn at 3 all week.
  const mins = ps.map(p => Number(p.formality_min));
  const centers = ps.map(p => (Number(p.formality_min) + Number(p.formality_max)) / 2);
  const avg = centers.reduce((a, b) => a + b, 0) / centers.length;
  const jacket = ps.some(p => JACKET_SUBS.has(p.subcategory));
  if (jacket || Math.max(...mins) >= 4) return 'formal';
  if (Math.max(...mins) >= 3 || avg >= 2.5) return 'business_casual';
  return 'casual';
}

/** Coverage report: can the closet produce a complete outfit for every occasion × temperature × rain? */
function coverageReport(items, profile, pairRules) {
  const bands = [
    { key: 'hot', label: 'Hot (85°F+)', temp: 90 }, { key: 'warm', label: 'Warm (70–85)', temp: 76 },
    { key: 'mild', label: 'Mild (55–70)', temp: 62 }, { key: 'cool', label: 'Cool (40–55)', temp: 47 },
    { key: 'cold', label: 'Cold (<40)', temp: 30 },
  ];
  const report = [];
  for (const occ of OCCASION_KEYS) {
    for (const band of bands) {
      for (const rain of [false, true]) {
        const r = buildOutfit(items, occ, { weather: { feelsLike: band.temp, precipProb: rain ? 80 : 5 }, ignoreStatus: true, deterministic: true, fast: true, profile, pairRules });
        let status = 'good';
        const problems = [];
        if (!r.complete) { status = 'gap'; problems.push('missing ' + r.missing.join(', ')); }
        else if (r.score >= 7) { status = 'gap'; }
        else if (r.score >= 3.5) { status = 'weak'; }
        for (const n of r.notes) if (!problems.includes(n)) problems.push(n);
        if (rain && r.slots.shoes && !r.slots.shoes.rain_ok) problems.push('no rain-ready shoes');
        report.push({ occasion: occ, band: band.key, bandLabel: band.label, rain, status, score: r.score, problems });
      }
    }
  }
  return { bands, occasions: OCCASION_KEYS, cells: report };
}

module.exports = {
  comboKey, comboKeyFromIds, pairKeys, DEFAULT_PAIR_RULES, pairRulePenalty, inferOccasion,
  OCCASIONS, OCCASION_KEYS, LEANS, targetWarmth, weatherContext, scoreItem, scoreCombo, buildOutfit, planDay,
  coverageReport, formalityPenalty, freshnessPenalty, outfitWarmth, hashString, mulberry32, hourlyAt, paletteRating,
};
