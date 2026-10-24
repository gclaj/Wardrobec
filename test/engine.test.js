'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOutfit, targetWarmth, coverageReport, formalityPenalty, OCCASIONS, freshnessPenalty } = require('../server/engine');
const { sampleItems } = require('../server/seed');

const closet = () => sampleItems().map((d, i) => ({ ...d, id: i + 1, status: 'clean', wear_count: 0, last_worn: null }));
const names = (o) => o.items.map(i => i.name);

test('warmth target scales with temperature', () => {
  assert.ok(targetWarmth(90) < targetWarmth(60));
  assert.ok(targetWarmth(60) < targetWarmth(20));
  assert.equal(targetWarmth(82), 1);
  assert.ok(Math.abs(targetWarmth(40) - 4) < 0.01);
  assert.ok(targetWarmth(20, 'gym') < targetWarmth(20), 'gym target is damped');
});

test('formality: athletic gear is ineligible outside the gym, suits ineligible for casual', () => {
  const shorts = { formality_min: 0, formality_max: 0, occasions: ['gym'], category: 'bottom' };
  assert.equal(formalityPenalty(shorts, OCCASIONS.formal), null);
  assert.equal(formalityPenalty(shorts, OCCASIONS.gym), 0);
  const suitJacket = { formality_min: 4, formality_max: 5, occasions: ['formal'], category: 'layer' };
  assert.equal(formalityPenalty(suitJacket, OCCASIONS.casual), null);
  assert.ok(formalityPenalty(suitJacket, OCCASIONS.formal) < 0.5);
});

test('each occasion produces a complete outfit in every weather band', () => {
  const items = closet();
  for (const occ of Object.keys(OCCASIONS)) {
    for (const temp of [95, 75, 60, 45, 25]) {
      for (const rain of [0, 90]) {
        const o = buildOutfit(items, occ, { date: '2026-10-18', weather: { feelsLike: temp, precipProb: rain } });
        assert.ok(o.complete, `${occ} at ${temp}F rain ${rain}: missing ${o.missing}`);
        assert.ok(o.slots.shoes, 'has shoes');
        assert.ok(o.slots.dress || (o.slots.top && o.slots.bottom));
      }
    }
  }
});

test('gym outfits only use athletic pieces', () => {
  const o = buildOutfit(closet(), 'gym', { weather: { feelsLike: 70 } });
  for (const it of o.items) assert.ok(it.occasions.includes('gym') || it.formality_max === 0, it.name);
});

test('formal outfits wear a jacket and never gym shoes', () => {
  const o = buildOutfit(closet(), 'formal', { weather: { feelsLike: 70 } });
  assert.ok(o.slots.layer && ['suit jacket', 'blazer', 'tuxedo jacket'].includes(o.slots.layer.subcategory), 'jacket present');
  assert.ok(o.slots.shoes.formality_min >= 2);
});

test('suits stay together', () => {
  const items = closet();
  for (let attempt = 0; attempt < 6; attempt++) {
    const o = buildOutfit(items, 'formal', { weather: { feelsLike: 65 }, attempt });
    const sets = new Set(o.items.filter(i => i.set_id).map(i => i.set_id));
    assert.ok(sets.size <= 1, `attempt ${attempt} mixed suits: ${names(o)}`);
  }
});

test('cold weather adds outerwear, hot weather removes it', () => {
  const items = closet();
  const cold = buildOutfit(items, 'casual', { weather: { feelsLike: 25 } });
  assert.ok(cold.slots.outerwear, 'coat in the cold: ' + names(cold));
  assert.ok(cold.slots.bottom.subcategory !== 'shorts');
  const hot = buildOutfit(items, 'casual', { weather: { feelsLike: 92 } });
  assert.ok(!hot.slots.outerwear || hot.slots.outerwear.warmth <= 2, 'no heavy coat in heat: ' + names(hot));
  assert.ok(hot.slots.top.warmth <= 2);
});

test('rain prefers rain-ready shoes and outerwear, and adds an umbrella', () => {
  const items = closet();
  const o = buildOutfit(items, 'business_casual', { weather: { feelsLike: 55, precipProb: 85 } });
  assert.ok(o.slots.shoes.rain_ok, 'rain-ok shoes: ' + o.slots.shoes.name);
  assert.ok(!o.slots.outerwear || o.slots.outerwear.rain_ok, 'rain-ok outerwear');
  assert.ok(o.accessories.some(a => a.subcategory === 'umbrella'));
});

test('business casual does not resort to shorts in the heat when trousers exist', () => {
  const o = buildOutfit(closet(), 'business_casual', { weather: { feelsLike: 90 } });
  assert.notEqual(o.slots.bottom.subcategory, 'shorts', names(o).join(', '));
  assert.notEqual(o.slots.bottom.subcategory, 'athletic shorts');
});

test('recently worn and dirty pieces are avoided; excluded ids never appear', () => {
  const items = closet();
  const base = buildOutfit(items, 'casual', { date: '2026-10-18', weather: { feelsLike: 65 }, deterministic: true });
  const top = base.slots.top;
  const dirtied = items.map(i => i.id === top.id ? { ...i, status: 'dirty' } : i);
  const next = buildOutfit(dirtied, 'casual', { date: '2026-10-18', weather: { feelsLike: 65 }, deterministic: true });
  assert.notEqual(next.slots.top.id, top.id, 'dirty top not reused');
  assert.ok(freshnessPenalty({ last_worn: '2026-10-17' }, '2026-10-18') > freshnessPenalty({ last_worn: '2026-10-01' }, '2026-10-18'));
  const ex = buildOutfit(items, 'casual', { weather: { feelsLike: 65 }, exclude: new Set([top.id]) });
  assert.ok(!ex.items.some(i => i.id === top.id));
});

test('locks pin a slot and alternatives are offered for swaps', () => {
  const items = closet();
  const o = buildOutfit(items, 'casual', { weather: { feelsLike: 65 } });
  const altTop = o.alternatives.top[0].item;
  const locked = buildOutfit(items, 'casual', { weather: { feelsLike: 65 }, lock: { top: altTop.id, bottom: o.slots.bottom.id, shoes: o.slots.shoes.id } });
  assert.equal(locked.slots.top.id, altTop.id);
  assert.equal(locked.slots.bottom.id, o.slots.bottom.id);
  assert.equal(locked.slots.shoes.id, o.slots.shoes.id);
});

test('regenerate (attempt) changes the result for the same day', () => {
  const items = closet();
  const seen = new Set();
  for (let a = 0; a < 8; a++) seen.add(names(buildOutfit(items, 'casual', { date: '2026-10-18', weather: { feelsLike: 65 }, attempt: a })).join('|'));
  assert.ok(seen.size > 1);
});

test('color rules: three loud colours or a clash costs more than neutrals', () => {
  const mk = (id, category, color_family, extra = {}) => ({ id, name: `${color_family} ${category}`, category, subcategory: category, color_family, pattern: 'solid', formality_min: 1, formality_max: 2, warmth: 2, occasions: ['casual'], status: 'clean', ...extra });
  const neutral = [mk(1, 'top', 'white'), mk(2, 'bottom', 'navy'), mk(3, 'shoes', 'brown')];
  const loud = [mk(1, 'top', 'red'), mk(2, 'bottom', 'orange'), mk(3, 'shoes', 'purple')];
  const a = buildOutfit(neutral, 'casual', { weather: { feelsLike: 70 }, deterministic: true });
  const b = buildOutfit(loud, 'casual', { weather: { feelsLike: 70 }, deterministic: true });
  assert.ok(b.score > a.score + 1.5, `${a.score} vs ${b.score}`);
});

test('coverage report flags gaps in a closet with no rain gear', () => {
  const items = closet().filter(i => !i.rain_ok && i.subcategory !== 'umbrella');
  const rep = coverageReport(items);
  const rainy = rep.cells.filter(c => c.rain);
  assert.ok(rainy.some(c => c.status !== 'good' || c.problems.length), 'at least one rainy cell is weak');
  const full = coverageReport(closet());
  assert.equal(full.cells.filter(c => c.status === 'gap').length, 0);
});

test('an empty closet returns an incomplete, non-crashing outfit', () => {
  const o = buildOutfit([], 'casual', { weather: { feelsLike: 65 } });
  assert.equal(o.complete, false);
  assert.deepEqual(o.missing.sort(), ['bottom', 'shoes', 'top']);
});

test('colour profile pulls flattering colours toward the face and pushes warm tones away', () => {
  const { PRESETS } = require('../server/profile');
  const { paletteRating } = require('../server/engine');
  const mk = (id, category, color_family, name, extra = {}) => ({ id, name, category, subcategory: category, color_family, pattern: 'solid', formality_min: 1, formality_max: 2, warmth: 2, occasions: ['casual'], status: 'clean', ...extra });
  const items = [mk(1, 'top', 'navy', 'navy polo'), mk(2, 'top', 'tan', 'camel polo'), mk(3, 'bottom', 'gray', 'grey chinos'), mk(4, 'shoes', 'white', 'white sneakers')];
  const plain = buildOutfit(items, 'casual', { weather: { feelsLike: 70 }, deterministic: true });
  const winter = buildOutfit(items, 'casual', { weather: { feelsLike: 70 }, deterministic: true, profile: PRESETS.deep_winter });
  assert.equal(winter.slots.top.name, 'navy polo');
  assert.ok(paletteRating(mk(9, 'top', 'blue', 'icy blue shirt'), PRESETS.deep_winter) > 0);
  assert.ok(paletteRating(mk(9, 'top', 'tan', 'warm beige sweater'), PRESETS.deep_winter) < -1);
  assert.ok(paletteRating(mk(9, 'top', 'red', 'rusty red sweater'), PRESETS.deep_winter) < 0, 'shade overrides family');
  assert.ok(paletteRating(mk(9, 'top', 'red', 'cranberry sweater'), PRESETS.deep_winter) > 0);
  assert.ok(winter.rationale.some(l => /palette/i.test(l)));
  assert.ok(plain.rationale.every(l => !/palette/i.test(l)));
});

test('a flattering colour is never a reason to add a layer in the heat', () => {
  const { PRESETS } = require('../server/profile');
  const o = buildOutfit(closet(), 'business_casual', { weather: { feelsLike: 88 }, deterministic: true, profile: PRESETS.deep_winter });
  assert.ok(!o.slots.layer && !o.slots.outerwear, o.items.map(i => i.name).join(', '));
});

test('formal reaches one step down with a penalty, but suit trousers always win when present', () => {
  const { capsuleItems } = require('../server/seed');
  const capsule = capsuleItems().map((d, i) => ({ ...d, id: i + 1, status: 'clean' }));
  const o = buildOutfit(capsule, 'formal', { weather: { feelsLike: 60 }, deterministic: true, look: null });
  assert.ok(o.complete, 'capsule can dress formal via chinos');
  assert.equal(o.slots.bottom.subcategory, 'chinos');
  assert.notEqual(o.fit, 'excellent');
  const full = buildOutfit(closet(), 'formal', { weather: { feelsLike: 60 }, deterministic: true, look: null });
  assert.ok(full.slots.bottom.formality_min >= 4, full.slots.bottom.name);
  const empty = buildOutfit(capsule.filter(i => i.category !== 'shoes'), 'formal', { weather: { feelsLike: 60 } });
  assert.equal(empty.fit, 'incomplete');
});

test('Deep Autumn and Deep Winter presets disagree where the reports disagree, agree on navy and burgundy', () => {
  const { PRESETS, paletteRating } = require('../server/profile');
  const mk = (name, color_family) => ({ id: 1, name, color_family, color: '' });
  assert.ok(paletteRating(mk('khaki chinos', 'tan'), PRESETS.deep_autumn) > 0);
  assert.ok(paletteRating(mk('khaki chinos', 'tan'), PRESETS.deep_winter) < 0);
  assert.ok(paletteRating(mk('icy blue shirt', 'blue'), PRESETS.deep_autumn) < 0);
  assert.ok(paletteRating(mk('icy blue shirt', 'blue'), PRESETS.deep_winter) > 0);
  for (const key of ['deep_winter', 'deep_autumn', 'shared_ground']) {
    assert.ok(paletteRating(mk('navy blazer', 'navy'), PRESETS[key]) >= 1.5, key);
    assert.ok(paletteRating(mk('burgundy tie', 'burgundy'), PRESETS[key]) >= 1.5, key);
  }
  assert.equal(paletteRating(mk('khaki chinos', 'tan'), PRESETS.shared_ground), 0);
});

test('no layer gets added in hot weather just because it is unworn or on-palette', () => {
  const { PRESETS } = require('../server/profile');
  const items = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'my-closet.json'), 'utf8')).items.map((d, i) => ({ ...d, id: i + 1, status: 'clean', wear_count: 0 }));
  for (const occ of ['gym', 'casual']) {
    const o = buildOutfit(items, occ, { weather: { feelsLike: 88 }, deterministic: true, profile: PRESETS.shared_ground });
    assert.ok(!o.slots.layer, `${occ}: ${o.items.map(i => i.name).join(', ')}`);
  }
});

test('lean nudges within the band: elevated casual avoids sneakers, relaxed prefers them', () => {
  const items = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'my-closet.json'), 'utf8')).items.map((d, i) => ({ ...d, id: i + 1, status: 'clean', wear_count: 0 }));
  const up = buildOutfit(items, 'casual', { weather: { feelsLike: 62 }, deterministic: true, lean: 'elevated', look: null });
  const down = buildOutfit(items, 'casual', { weather: { feelsLike: 62 }, deterministic: true, lean: 'relaxed', look: null });
  assert.ok(!/sneaker/i.test(up.slots.shoes.subcategory), up.slots.shoes.name);
  assert.ok(/sneaker/i.test(down.slots.shoes.subcategory), down.slots.shoes.name);
  assert.match(up.rationale[0], /elevated/);
});

test('style guide looks arrange the owner closet into the guide formulas', () => {
  const { PRESETS } = require('../server/profile');
  const items = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'my-closet.json'), 'utf8')).items.map((d, i) => ({ ...d, id: i + 1, status: 'clean', wear_count: 0 }));
  const o = (occ, look, t = 62) => buildOutfit(items, occ, { weather: { feelsLike: t }, deterministic: true, profile: PRESETS.style_guide, look });
  const pw = o('formal', 'polished_work');
  assert.equal(pw.slots.layer.subcategory, 'blazer'); assert.match(pw.slots.top.subcategory, /button-down/); assert.match(pw.slots.shoes.subcategory, /loafers|dress shoes/);
  assert.equal(pw.look.key, 'polished_work'); assert.match(pw.rationale[0], /Blazer \+ dress shirt/);
  const we = o('casual', 'weekend', 85);
  assert.match(we.slots.bottom.subcategory, /shorts/); assert.match(we.slots.shoes.subcategory, /sneakers|training/);
  const tr = o('casual', 'travel', 65);
  assert.equal(tr.slots.bottom.subcategory, 'joggers');
  const dn = o('casual', 'date_night', 58);
  assert.match(dn.slots.shoes.subcategory, /boots|loafers/); assert.equal(dn.slots.bottom.subcategory, 'jeans');
  const cf = o('business_casual', 'casual_friday', 70);
  assert.ok(!cf.slots.layer, 'casual friday drops the layer');
  // default look selection
  assert.equal(buildOutfit(items, 'formal', { weather: { feelsLike: 60 }, deterministic: true }).look.key, 'polished_work');
  assert.equal(buildOutfit(items, 'casual', { weather: { feelsLike: 88 }, deterministic: true }).look.key, 'weekend');
  assert.equal(buildOutfit(items, 'casual', { weather: { feelsLike: 60 }, deterministic: true }).look.key, 'school_event');
  assert.equal(buildOutfit(items, 'gym', { weather: { feelsLike: 60 }, deterministic: true }).look, null);
  assert.equal(buildOutfit(items, 'casual', { weather: { feelsLike: 60 }, deterministic: true, look: null }).look, null, 'explicit null disables the look');
});

test('style rules: two accent colours cost more than one', () => {
  const { styleRules } = require('../server/styleguide');
  const mk = (category, color_family, subcategory = category) => ({ category, color_family, subcategory });
  const one = { top: mk('top', 'burgundy'), bottom: mk('bottom', 'navy'), shoes: mk('shoes', 'brown') };
  const two = { top: mk('top', 'burgundy'), bottom: mk('bottom', 'green'), shoes: mk('shoes', 'brown') };
  assert.equal(styleRules(one, []), 0);
  assert.ok(styleRules(two, []) >= 1);
});

test('capsule audit reports owned, stand-in and missing pieces from the closet', () => {
  const { capsuleStatus } = require('../server/styleguide');
  const items = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'my-closet.json'), 'utf8')).items.map((d, i) => ({ ...d, id: i + 1, status: 'clean' }));
  const c = capsuleStatus(items);
  assert.equal(c.rows.length, 20);
  const by = Object.fromEntries(c.rows.map(r => [r.n, r]));
  assert.equal(by[1].status, 'owned'); assert.equal(by[3].status, 'owned'); assert.equal(by[14].status, 'owned'); assert.equal(by[17].status, 'owned');
  assert.equal(by[5].status, 'substitute'); assert.equal(by[18].status, 'substitute'); assert.equal(by[19].status, 'substitute');
  assert.equal(by[20].status, 'missing');
  assert.equal(c.counts.owned + c.counts.substitute + c.counts.missing, 20);
  assert.equal(capsuleStatus([]).counts.missing, 20);
});

test('never again bans the exact combination; love it brings it back', () => {
  const { PRESETS } = require('../server/profile');
  const { comboKeyFromIds, pairKeys } = require('../server/engine');
  const items = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'my-closet.json'), 'utf8')).items.map((d, i) => ({ ...d, id: i + 1, status: 'clean', wear_count: 0 }));
  const opts = { weather: { feelsLike: 60 }, deterministic: true, profile: PRESETS.style_guide, look: 'business_casual' };
  const first = buildOutfit(items, 'business_casual', opts);
  const ids = first.items.map(i => i.id);
  const banned = new Set([comboKeyFromIds(ids)]); const pairs = new Map(); for (const pk of pairKeys(ids)) pairs.set(pk, 0.7);
  const second = buildOutfit(items, 'business_casual', { ...opts, feedback: { banned, fab: new Set(), pairs } });
  assert.notEqual(second.comboKey, first.comboKey, 'banned combo is not proposed again');
  const fab = new Set([comboKeyFromIds(ids)]);
  const third = buildOutfit(items, 'business_casual', { ...opts, weather: { feelsLike: 66 }, feedback: { banned: new Set(), fab, pairs: new Map() } });
  assert.equal(third.comboKey, first.comboKey, 'loved combo wins when conditions allow');
  assert.equal(third.fab, true);
});

test('packing covers every requested outfit with a smaller bag than the outfits add up to', () => {
  const { planTrip } = require('../server/packing');
  const { PRESETS } = require('../server/profile');
  const items = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'my-closet.json'), 'utf8')).items.map((d, i) => ({ ...d, id: i + 1, status: 'clean', wear_count: 0 }));
  const plan = planTrip(items, { requests: { business_casual: 2, polished_work: 1, weekend: 2, dinner: 1, gym: 2 }, weather: { tempHigh: 68, tempLow: 50, precipProb: 20 }, profile: PRESETS.style_guide });
  assert.equal(plan.outfits.length, 8);
  assert.equal(plan.stats.incomplete, 0);
  const naive = plan.outfits.reduce((n, x) => n + x.outfit.items.length, 0);
  assert.ok(plan.stats.pieces < naive, `${plan.stats.pieces} pieces vs ${naive} if nothing were reused`);
  assert.ok(plan.stats.ratio >= 0.35, 'pieces are reused: ' + plan.stats.ratio);
  // tops wash every wear so no top is worn twice without laundry; bottoms and shoes repeat
  const topUses = plan.bag.filter(b => b.item.category === 'top').map(b => b.usedIn);
  assert.ok(topUses.every(u => u <= 1), 'no top reused without laundry');
  assert.ok(plan.bag.some(b => ['bottom', 'shoes'].includes(b.item.category) && b.usedIn >= 2), 'bottoms or shoes are reused');
  const withLaundry = planTrip(items, { requests: { business_casual: 2, polished_work: 1, weekend: 2, dinner: 1, gym: 2 }, weather: { tempHigh: 68, tempLow: 50, precipProb: 20 }, laundry: true, profile: PRESETS.style_guide });
  assert.ok(withLaundry.stats.pieces <= plan.stats.pieces, 'laundry never makes the bag bigger');
  assert.equal(planTrip(items, { requests: {}, weather: { tempHigh: 70 } }).outfits.length, 0);
});
