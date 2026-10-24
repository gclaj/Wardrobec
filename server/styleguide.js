'use strict';
// The owner's personal style guide, encoded as the stylist's base programming.
// Everything the engine does on top of raw weather and dress-code logic comes from here:
// the eight outfit formulas, the colour palette, and the style principles.

const PHILOSOPHY = 'Athletic-tailored fit + restrained colour palette + simple layering + quality footwear + minimal accessories.';

const DIRECTION = 'Classic American menswear with a modern, athletic fit. Refined, masculine, functional, understated: tailored basics, rich colours, quality fabrics, minimal branding, clothing that works for professional settings, family activities, and travel alike.';

const PRINCIPLES = [
  { key: 'fit', title: 'Fit', text: 'Athletic or tailored, never tight. Room in the shoulders, chest and arms; mid-rise, straight or tapered trousers; structured shoulders on jackets; 7-inch shorts.' },
  { key: 'palette', title: 'Restrained palette', text: 'Core neutrals carry the outfit; one accent colour at most. Navy, olive, charcoal, stone, khaki and chocolate are the foundation; rust, burgundy, deep teal, oatmeal, ivory and sage are the accents.' },
  { key: 'layering', title: 'Simple layering', text: 'One mid-layer, one outer layer, no more. Quarter-zips, light jackets and blazers handle fluctuating temperatures and travel.' },
  { key: 'footwear', title: 'Quality footwear', text: 'Three shoes do the work: clean white sneakers for casual versatility, brown loafers for polished situations, brown chukkas for evenings and autumn.' },
  { key: 'accessories', title: 'Minimal accessories', text: 'A brown leather belt, an understated watch, classic sunglasses. A compact sling or day bag. Hats optional.' },
];

// Palette families as the engine names them. Neutrals never count as an accent.
const NEUTRAL_FAMILIES = new Set(['navy', 'olive', 'charcoal', 'tan', 'white', 'brown', 'black', 'gray']);
const ACCENT_FAMILIES = new Set(['green', 'red', 'burgundy', 'blue', 'teal', 'orange', 'yellow', 'pink', 'purple', 'multi']);

const PALETTE = {
  neutrals: ['navy', 'olive', 'charcoal', 'stone', 'khaki', 'cream', 'chocolate'],
  accents: ['forest', 'rust', 'burgundy', 'deep blue', 'sage', 'terracotta', 'mustard', 'deep teal', 'oatmeal', 'ivory'],
  avoid: ['icy pastels', 'neon brights', 'pure white head to toe', 'cool greys', 'very light blue', 'purple and pink tones'],
};

/**
 * The eight looks. Each formula lists, per slot, the garment types that belong, in order of
 * preference. The engine rewards pieces on the list, penalises pieces off it, and drops slots
 * the formula does not use when the weather allows.
 */
const LOOKS = {
  polished_work: {
    key: 'polished_work', name: 'Polished Work', occasion: 'formal', lean: 'standard',
    summary: 'Blazer + dress shirt + chinos + loafers',
    why: 'Structured, professional, and appropriate for business meetings without requiring a full suit.',
    formula: { layer: ['blazer', 'suit jacket'], top: ['dress shirt', 'button-down shirt'], bottom: ['chinos', 'dress trousers', 'five-pocket pants'], shoes: ['loafers', 'dress shoes', 'chelsea boots'] },
  },
  business_casual: {
    key: 'business_casual', name: 'Business Casual', occasion: 'business_casual', lean: 'standard',
    summary: 'Quarter-zip over a shirt + navy pants + brown leather shoes',
    why: 'Clean and approachable while remaining professional.',
    formula: { layer: ['quarter-zip', 'sweater', 'cardigan'], top: ['button-down shirt', 'dress shirt', 'polo'], bottom: ['dress trousers', 'chinos', 'five-pocket pants'], shoes: ['loafers', 'chukka boots', 'chelsea boots', 'dress shoes'] },
  },
  casual_friday: {
    key: 'casual_friday', name: 'Casual Friday', occasion: 'business_casual', lean: 'relaxed',
    summary: 'Button-down + 5-pocket pants + sneakers',
    why: 'The combination works without a blazer or other formal layers.',
    formula: { top: ['button-down shirt', 'flannel shirt', 'short-sleeve button-down shirt', 'polo'], bottom: ['five-pocket pants', 'jeans', 'chinos'], shoes: ['sneakers', 'loafers', 'chukka boots'] },
    noLayer: true,
  },
  weekend: {
    key: 'weekend', name: 'Weekend / Errands', occasion: 'casual', lean: 'relaxed',
    summary: 'T-shirt + shorts + sneakers + sling',
    why: 'Comfortable for time with your children, walking, and everyday errands.',
    formula: { top: ['t-shirt', 'performance tee', 'polo', 'camp shirt'], bottom: ['shorts', 'athletic shorts', 'five-pocket pants'], shoes: ['sneakers', 'training shoes'], accessory: ['bag'] },
  },
  date_night: {
    key: 'date_night', name: 'Date Night', occasion: 'casual', lean: 'elevated',
    summary: 'Henley + jeans + boots',
    why: 'A fitted but not tight silhouette that looks intentionally dressed without being formal.',
    formula: { top: ['henley', 'long-sleeve tee', 'turtleneck', 'polo', 'button-down shirt', 'camp shirt'], bottom: ['jeans', 'five-pocket pants'], shoes: ['chukka boots', 'chelsea boots', 'boots', 'mid-top boots', 'loafers'] },
  },
  school_event: {
    key: 'school_event', name: 'School Event / Elevated Casual', occasion: 'casual', lean: 'elevated',
    summary: 'Sweater + 5-pocket pants + sneakers',
    why: 'Relaxed enough for family activities but polished enough for a social event.',
    formula: { layer: ['sweater', 'quarter-zip', 'cardigan'], top: ['t-shirt', 'button-down shirt', 'polo', 'henley'], bottom: ['five-pocket pants', 'chinos', 'jeans'], shoes: ['sneakers', 'loafers', 'chukka boots'] },
  },
  travel: {
    key: 'travel', name: 'Travel / On-the-Go', occasion: 'casual', lean: 'relaxed',
    summary: 'Hoodie + joggers + sneakers + backpack',
    why: 'Comfortable during flights, driving, or long days on your feet.',
    formula: { layer: ['hoodie', 'sweatshirt', 'quarter-zip', 'fleece'], top: ['t-shirt', 'performance tee', 'long-sleeve tee'], bottom: ['joggers', 'five-pocket pants', 'utility pants'], shoes: ['sneakers', 'training shoes'], accessory: ['bag'] },
  },
  dinner: {
    key: 'dinner', name: 'Dinner / Drinks', occasion: 'casual', lean: 'elevated',
    summary: 'Jacket + t-shirt or henley + jeans + boots',
    why: 'One structured piece on top makes an easy evening look.',
    formula: { outerwear: ['field jacket', 'overshirt', 'softshell', 'bomber', 'denim jacket', 'leather jacket', 'chore coat', 'harrington'], layer: ['quarter-zip', 'sweater'], top: ['t-shirt', 'henley', 'long-sleeve tee'], bottom: ['jeans', 'five-pocket pants'], shoes: ['chukka boots', 'chelsea boots', 'boots', 'mid-top boots', 'loafers'] },
  },
};
const LOOK_KEYS = Object.keys(LOOKS);

/**
 * The guide's 20-piece capsule, each with what counts as owning it and what the stylist
 * substitutes when it is missing. Status is computed live from the closet.
 */
const CAPSULE = [
  { n: 1, name: 'Navy blazer', match: { category: 'layer', sub: ['blazer', 'suit jacket'], fam: ['navy'] } },
  { n: 2, name: 'Light blue dress shirt', match: { category: 'top', sub: ['dress shirt', 'button-down shirt'], fam: ['blue'] } },
  { n: 3, name: 'White button-down', match: { category: 'top', sub: ['button-down shirt', 'dress shirt'], fam: ['white'] } },
  { n: 4, name: 'Gray button-down (flannel or oxford)', match: { category: 'top', sub: ['button-down shirt', 'flannel shirt'], fam: ['gray'] } },
  { n: 5, name: 'Navy henley', match: { category: 'top', sub: ['henley'] }, near: { category: 'top', sub: ['long-sleeve tee', 'polo'] } },
  { n: 6, name: 'Olive quarter-zip', match: { category: 'layer', sub: ['quarter-zip'], fam: ['olive', 'green'] } },
  { n: 7, name: 'Oatmeal sweater', match: { category: 'layer', sub: ['sweater', 'quarter-zip', 'cardigan'], fam: ['tan', 'white'] } },
  { n: 8, name: 'Vintage red T-shirt', match: { category: 'top', sub: ['t-shirt', 'performance tee'], fam: ['red', 'burgundy'] } },
  { n: 9, name: 'White T-shirt', match: { category: 'top', sub: ['t-shirt', 'performance tee'], fam: ['white'] } },
  { n: 10, name: 'Performance hoodie', match: { category: 'layer', sub: ['hoodie', 'sweatshirt'] }, near: { category: 'layer', sub: ['quarter-zip', 'fleece'] } },
  { n: 11, name: 'Khaki chinos', match: { category: 'bottom', sub: ['chinos', 'utility pants', 'five-pocket pants', 'dress trousers'], fam: ['tan'] } },
  { n: 12, name: 'Olive 5-pocket pants', match: { category: 'bottom', sub: ['five-pocket pants', 'utility pants', 'chinos'], fam: ['olive', 'green'] } },
  { n: 13, name: 'Navy 5-pocket pants', match: { category: 'bottom', sub: ['five-pocket pants', 'chinos', 'dress trousers'], fam: ['navy'] } },
  { n: 14, name: 'Dark jeans', match: { category: 'bottom', sub: ['jeans'] } },
  { n: 15, name: '7" athletic shorts', match: { category: 'bottom', sub: ['athletic shorts'] } },
  { n: 16, name: 'Jogger pants', match: { category: 'bottom', sub: ['joggers'] } },
  { n: 17, name: 'White sneakers', match: { category: 'shoes', sub: ['sneakers'], fam: ['white'] } },
  { n: 18, name: 'Brown loafers', match: { category: 'shoes', sub: ['loafers'], fam: ['brown', 'tan'] }, near: { category: 'shoes', sub: ['dress shoes'], fam: ['brown', 'tan'] } },
  { n: 19, name: 'Brown suede chukka boots', match: { category: 'shoes', sub: ['chukka boots'] }, near: { category: 'shoes', sub: ['mid-top boots', 'boots', 'chelsea boots'] } },
  { n: 20, name: 'Sling / day backpack', match: { category: 'accessory', sub: ['bag'] } },
];

function matches(item, rule) {
  if (!rule || item.category !== rule.category || item.status === 'retired') return false;
  const sub = String(item.subcategory || '').toLowerCase();
  if (rule.sub && !rule.sub.some(x => sub === x || sub.includes(x))) return false;
  if (rule.fam && !rule.fam.includes(item.color_family)) return false;
  return true;
}

/** Each capsule piece with status owned | substitute | missing and the closet items that fill it. */
function capsuleStatus(items) {
  const rows = CAPSULE.map(p => {
    const owned = items.filter(i => matches(i, p.match));
    if (owned.length) return { ...p, status: 'owned', items: owned.map(i => i.name) };
    const near = p.near ? items.filter(i => matches(i, p.near)) : [];
    if (near.length) return { ...p, status: 'substitute', items: near.slice(0, 3).map(i => i.name) };
    return { ...p, status: 'missing', items: [] };
  });
  const counts = { owned: 0, substitute: 0, missing: 0 };
  for (const r of rows) counts[r.status]++;
  return { rows, counts };
}

/** Which look the four standing options default to, given occasion and warmth target. */
function defaultLook(occasionKey, target) {
  switch (occasionKey) {
    case 'formal': return 'polished_work';
    case 'business_casual': return 'business_casual';
    case 'casual': return target != null && target <= 1.6 ? 'weekend' : 'school_event';
    default: return null;
  }
}

/** Per-slot formula fit for an item. Negative is a bonus. */
function formulaPenalty(item, slot, look) {
  if (!look) return 0;
  const list = look.formula[slot];
  const sub = String(item.subcategory || '').toLowerCase();
  if (!list) {
    if ((slot === 'layer' && look.noLayer)) return 2.0;      // formula is deliberately layer-free
    if (slot === 'layer' || slot === 'outerwear') return 0.4; // not part of the look, weather may still demand it
    return 0;
  }
  // Exact type matches rank ahead of partial ones ("short-sleeve button-down shirt" is a weaker
  // match for "button-down shirt" than the real thing).
  let idx = list.findIndex(x => sub === x);
  if (idx < 0) { const part = list.findIndex(x => sub.includes(x)); if (part >= 0) idx = part + 2; }
  const optional = slot === 'layer' || slot === 'outerwear';
  if (idx >= 0) return -(optional ? [1.0, 0.7, 0.5, 0.3] : [2.5, 1.5, 1.0, 0.5])[Math.min(idx, 3)];
  return optional ? 1.5 : 1.0; // the look names this slot, so an off-formula piece here works against it
}

/** Combination-level style rules from the guide. */
function styleRules(c, notes) {
  let p = 0;
  const pieces = ['top', 'dress', 'layer', 'outerwear', 'bottom', 'shoes'].map(k => c[k]).filter(Boolean);
  const accents = new Set(pieces.map(x => x.color_family).filter(f => ACCENT_FAMILIES.has(f)));
  if (accents.size > 1) { p += 1.0; notes.push('more than one accent colour; the guide keeps it to one'); }
  if (c.layer && c.outerwear && ['blazer', 'suit jacket'].includes(c.layer.subcategory) && ['field jacket', 'denim jacket', 'bomber', 'softshell', 'windbreaker', 'puffer'].includes(c.outerwear.subcategory)) {
    p += 1.0; notes.push('a casual jacket over a blazer breaks the simple-layering rule');
  }
  return p;
}

module.exports = { PHILOSOPHY, DIRECTION, PRINCIPLES, PALETTE, LOOKS, LOOK_KEYS, CAPSULE, capsuleStatus, NEUTRAL_FAMILIES, ACCENT_FAMILIES, defaultLook, formulaPenalty, styleRules };
