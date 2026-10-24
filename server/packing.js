'use strict';
// Trip packing: cover every requested outfit with the fewest pieces, mixing and matching.
const { buildOutfit } = require('./engine');
const guide = require('./styleguide');
const { OCCASIONS } = require('./engine');

const RANK = { formal: 0, business_casual: 1, casual: 2, gym: 3 };

function eveningWeather(w) {
  const lo = Number(w.tempLow ?? w.feelsLike), hi = Number(w.tempHigh ?? w.feelsLike);
  return { ...w, feelsLike: Math.round((lo * 0.7 + hi * 0.3) * 10) / 10 };
}
function dayWeather(w) {
  const lo = Number(w.tempLow ?? w.feelsLike), hi = Number(w.tempHigh ?? w.feelsLike);
  return { ...w, feelsLike: Math.round((hi * 0.65 + lo * 0.35) * 10) / 10 };
}

/** requests: { lookKeyOrOccasion: count }. weather: { tempHigh, tempLow, precipProb }. */
function planTrip(items, { requests = {}, weather = {}, laundry = false, profile, feedback } = {}) {
  const slots = [];
  for (const [key, count] of Object.entries(requests)) {
    const n = Math.max(0, Math.min(14, Number(count) || 0));
    const look = guide.LOOKS[key] ? key : null;
    const occasion = look ? guide.LOOKS[key].occasion : (OCCASIONS[key] ? key : null);
    if (!occasion) continue;
    for (let i = 0; i < n; i++) slots.push({ key, look, occasion, label: look ? guide.LOOKS[key].name : OCCASIONS[key].label });
  }
  if (!slots.length) return { bag: [], outfits: [], stats: { pieces: 0, outfits: 0, ratio: 0 }, weather };

  const orderings = [
    [...slots].sort((a, b) => RANK[a.occasion] - RANK[b.occasion]),
    [...slots].sort((a, b) => RANK[b.occasion] - RANK[a.occasion]),
    [...slots],
  ];
  let best = null;
  for (const order of orderings) {
    const result = packOnce(items, order, { weather, laundry, profile, feedback });
    if (!best || result.stats.pieces < best.stats.pieces || (result.stats.pieces === best.stats.pieces && result.stats.incomplete < best.stats.incomplete)) best = result;
  }
  return best;
}

function packOnce(items, slots, { weather, laundry, profile, feedback }) {
  const uses = new Map();
  for (const it of items) {
    const w = Number(it.wears_before_wash || 1);
    uses.set(it.id, w >= 999 ? Infinity : (laundry ? w * 2 : w));
  }
  const packed = new Set();
  const usedIn = new Map();
  const outfits = [];
  for (const slot of slots) {
    const wx = (slot.look === 'dinner' || slot.look === 'date_night') ? eveningWeather(weather) : dayWeather(weather);
    const o = buildOutfit(items, slot.occasion, { weather: wx, look: slot.look || undefined, prefer: packed, uses, profile, feedback, deterministic: true, ignoreStatus: true });
    for (const it of [...o.items, ...o.accessories]) {
      packed.add(it.id);
      uses.set(it.id, (uses.get(it.id) ?? Infinity) - 1);
      usedIn.set(it.id, (usedIn.get(it.id) || 0) + 1);
    }
    outfits.push({ slot, outfit: o });
  }
  const byId = new Map(items.map(i => [i.id, i]));
  const bag = [...packed].map(id => ({ item: byId.get(id), usedIn: usedIn.get(id) || 0 }))
    .sort((a, b) => cat(a.item) - cat(b.item) || b.usedIn - a.usedIn);
  const incomplete = outfits.filter(x => !x.outfit.complete).length;
  const pieces = bag.filter(b => b.item.category !== 'accessory').length;
  return { bag, outfits, stats: { pieces, accessories: bag.length - pieces, outfits: outfits.length, incomplete, ratio: pieces ? Math.round((outfits.length / pieces) * 100) / 100 : 0 }, weather };
}
const CAT_ORDER = ['outerwear', 'layer', 'top', 'dress', 'bottom', 'shoes', 'accessory'];
function cat(it) { return CAT_ORDER.indexOf(it.category); }

module.exports = { planTrip };
