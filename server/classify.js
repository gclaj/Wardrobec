'use strict';
// Turns a free-text description ("navy wool blazer", "grey running shorts") into a
// fully attributed wardrobe item. Used by Quick Add so the owner can enumerate a
// whole closet in minutes and correct the few guesses that are wrong.

const COLOR_FAMILIES = {
  black: ['black', 'jet', 'onyx'],
  charcoal: ['charcoal', 'anthracite'],
  white: ['white', 'cream', 'ivory', 'off-white', 'ecru', 'bone'],
  gray: ['gray', 'grey', 'heather', 'slate', 'silver', 'graphite', 'ash'],
  navy: ['navy', 'midnight', 'indigo', 'ink'],
  blue: ['blue', 'denim', 'cobalt', 'sapphire', 'sky', 'royal', 'chambray', 'light-blue', 'powder', 'icy', 'ice'],
  teal: ['teal', 'petrol', 'peacock'],
  brown: ['brown', 'chocolate', 'coffee', 'walnut', 'mocha', 'chestnut', 'cognac', 'espresso', 'rust', 'rusty', 'copper'],
  tan: ['tan', 'beige', 'khaki', 'camel', 'sand', 'stone', 'taupe', 'oatmeal', 'nude', 'wheat'],
  olive: ['olive', 'army', 'moss', 'sage', 'od'],
  green: ['green', 'forest', 'emerald', 'hunter', 'pine', 'mint', 'lime'],
  red: ['red', 'crimson', 'scarlet', 'cherry', 'cranberry'],
  burgundy: ['burgundy', 'maroon', 'wine', 'oxblood', 'bordeaux', 'merlot'],
  pink: ['pink', 'blush', 'rose', 'salmon', 'coral', 'magenta', 'fuchsia'],
  orange: ['orange', 'tangerine', 'peach', 'apricot'],
  yellow: ['yellow', 'mustard', 'gold', 'lemon'],
  purple: ['purple', 'lavender', 'violet', 'plum', 'lilac', 'mauve'],
  multi: ['multi', 'multicolor', 'multicolour', 'rainbow', 'tie-dye'],
};
const NEUTRALS = new Set(['black', 'charcoal', 'white', 'gray', 'navy', 'tan', 'brown', 'olive']);

const PATTERNS = ['striped', 'stripe', 'plaid', 'check', 'checked', 'gingham', 'houndstooth', 'herringbone',
  'floral', 'paisley', 'polka', 'dot', 'dotted', 'camo', 'camouflage', 'graphic', 'print', 'printed',
  'argyle', 'pinstripe', 'tartan', 'logo', 'colorblock', 'tweed', 'windowpane', 'glen'];

const MATERIALS = ['wool', 'cotton', 'linen', 'silk', 'cashmere', 'merino', 'leather', 'suede', 'denim',
  'polyester', 'nylon', 'fleece', 'down', 'gore-tex', 'goretex', 'tweed', 'flannel', 'corduroy', 'velvet',
  'canvas', 'satin', 'chiffon', 'spandex', 'lycra', 'rayon', 'viscose', 'tencel', 'twill', 'oxford',
  'jersey', 'knit', 'mesh', 'rubber', 'synthetic', 'tech', 'performance', 'dri-fit', 'drifit'];

// Each rule: keywords → attributes. First match (in order) wins for category/subcategory.
// warmth: 1 hot-weather .. 5 deep cold. formality: [min, max] on 0..5 (0 athletic, 5 black tie).
const RULES = [
  // ---- athletic ----
  { kw: ['running shoes', 'trainers', 'training shoes', 'gym shoes', 'cross trainers', 'crosstrainers', 'lifting shoes', 'cleats'], category: 'shoes', sub: 'training shoes', warmth: 2, formality: [0, 0], occ: ['gym'], wbw: 999 },
  { kw: ['sports bra'], category: 'top', sub: 'sports bra', warmth: 1, formality: [0, 0], occ: ['gym'], wbw: 1 },
  { kw: ['running shorts', 'gym shorts', 'athletic shorts', 'training shorts', 'basketball shorts', 'workout shorts'], category: 'bottom', sub: 'athletic shorts', warmth: 1, formality: [0, 0], occ: ['gym'], wbw: 1 },
  { kw: ['leggings', 'tights', 'yoga pants'], category: 'bottom', sub: 'leggings', warmth: 2, formality: [0, 1], occ: ['gym'], wbw: 1 },
  { kw: ['joggers', 'sweatpants', 'track pants', 'training pants', 'warm-up pants'], category: 'bottom', sub: 'joggers', warmth: 3, formality: [0, 1], occ: ['gym', 'casual'], wbw: 2 },
  { kw: ['tank top', 'tank', 'singlet', 'muscle tee'], category: 'top', sub: 'tank top', warmth: 1, formality: [0, 1], occ: ['gym'], wbw: 1 },
  { kw: ['performance tee', 'dri-fit', 'drifit', 'workout shirt', 'training shirt', 'gym shirt', 'tech tee', 'running shirt', 'athletic shirt', 'compression'], category: 'top', sub: 'performance tee', warmth: 1, formality: [0, 0], occ: ['gym'], wbw: 1 },
  { kw: ['quarter zip', 'quarter-zip', 'half zip', 'half-zip', '1/4 zip'], category: 'layer', sub: 'quarter-zip', warmth: 3, formality: [0, 3], occ: ['gym', 'casual', 'business_casual'], wbw: 4 },
  { kw: ['hoodie', 'hooded sweatshirt'], category: 'layer', sub: 'hoodie', warmth: 3, formality: [0, 1], occ: ['gym', 'casual'], wbw: 4 },
  { kw: ['sweatshirt', 'crewneck sweatshirt'], category: 'layer', sub: 'sweatshirt', warmth: 3, formality: [0, 1], occ: ['gym', 'casual'], wbw: 4 },
  { kw: ['windbreaker', 'running jacket', 'track jacket', 'shell jacket', 'softshell'], category: 'outerwear', sub: 'windbreaker', warmth: 2, formality: [0, 1], occ: ['gym', 'casual'], rain: true, wind: true, wbw: 15 },

  // ---- outerwear ----
  { kw: ['rain jacket', 'raincoat', 'rain shell', 'hardshell', 'gore-tex jacket', 'anorak'], category: 'outerwear', sub: 'rain jacket', warmth: 2, formality: [1, 2], occ: ['casual'], rain: true, wind: true, wbw: 20 },
  { kw: ['trench', 'trench coat', 'mac coat'], category: 'outerwear', sub: 'trench coat', warmth: 3, formality: [2, 4], occ: ['business_casual', 'formal'], rain: true, wind: true, wbw: 20 },
  { kw: ['parka', 'puffer', 'down jacket', 'puffy'], category: 'outerwear', sub: 'parka', warmth: 5, formality: [1, 2], occ: ['casual'], rain: true, wind: true, wbw: 20 },
  { kw: ['overcoat', 'topcoat', 'wool coat', 'peacoat', 'pea coat', 'camel coat'], category: 'outerwear', sub: 'overcoat', warmth: 4, formality: [2, 5], occ: ['business_casual', 'formal'], wind: true, wbw: 20 },
  { kw: ['suit jacket'], category: 'layer', sub: 'suit jacket', warmth: 2, formality: [4, 5], occ: ['formal'], wbw: 8 },
  { kw: ['tuxedo jacket', 'dinner jacket'], category: 'layer', sub: 'tuxedo jacket', warmth: 2, formality: [5, 5], occ: ['formal'], wbw: 8 },
  { kw: ['blazer', 'sport coat', 'sportcoat'], category: 'layer', sub: 'blazer', warmth: 2, formality: [3, 4], occ: ['business_casual', 'formal'], wbw: 8 },
  { kw: ['denim jacket', 'jean jacket', 'trucker jacket'], category: 'outerwear', sub: 'denim jacket', warmth: 3, formality: [1, 2], occ: ['casual'], wbw: 15 },
  { kw: ['leather jacket', 'moto jacket', 'biker jacket'], category: 'outerwear', sub: 'leather jacket', warmth: 3, formality: [1, 2], occ: ['casual'], wind: true, wbw: 30 },
  { kw: ['bomber'], category: 'outerwear', sub: 'bomber jacket', warmth: 3, formality: [1, 2], occ: ['casual'], wind: true, wbw: 15 },
  { kw: ['field jacket', 'chore coat', 'chore jacket', 'utility jacket', 'harrington', 'coach jacket'], category: 'outerwear', sub: 'field jacket', warmth: 3, formality: [1, 2], occ: ['casual'], wind: true, wbw: 15 },
  { kw: ['fleece jacket', 'fleece'], category: 'layer', sub: 'fleece', warmth: 3, formality: [0, 1], occ: ['gym', 'casual'], wbw: 6 },
  { kw: ['vest', 'gilet'], category: 'layer', sub: 'vest', warmth: 3, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 10 },
  { kw: ['coat'], category: 'outerwear', sub: 'coat', warmth: 4, formality: [1, 3], occ: ['casual', 'business_casual'], wind: true, wbw: 20 },
  { kw: ['jacket'], category: 'outerwear', sub: 'jacket', warmth: 3, formality: [1, 2], occ: ['casual'], wbw: 15 },

  // ---- layers ----
  { kw: ['cardigan'], category: 'layer', sub: 'cardigan', warmth: 3, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 4 },
  { kw: ['sweater vest'], category: 'layer', sub: 'sweater vest', warmth: 2, formality: [2, 3], occ: ['business_casual'], wbw: 4 },
  { kw: ['turtleneck', 'roll neck', 'rollneck'], category: 'top', sub: 'turtleneck', warmth: 4, formality: [1, 4], occ: ['casual', 'business_casual', 'formal'], wbw: 2 },
  { kw: ['sweater', 'jumper', 'pullover'], category: 'layer', sub: 'sweater', warmth: 4, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 4 },

  // ---- tops ----
  { kw: ['tuxedo shirt'], category: 'top', sub: 'tuxedo shirt', warmth: 2, formality: [5, 5], occ: ['formal'], wbw: 1 },
  { kw: ['dress shirt', 'french cuff'], category: 'top', sub: 'dress shirt', warmth: 2, formality: [3, 5], occ: ['business_casual', 'formal'], wbw: 1 },
  { kw: ['oxford', 'ocbd', 'button-down', 'button down', 'button-up', 'button up', 'shirt'], category: 'top', sub: 'button-down shirt', warmth: 2, formality: [2, 4], occ: ['casual', 'business_casual', 'formal'], wbw: 1 },
  { kw: ['polo'], category: 'top', sub: 'polo', warmth: 2, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 1 },
  { kw: ['henley'], category: 'top', sub: 'henley', warmth: 2, formality: [1, 2], occ: ['casual'], wbw: 1 },
  { kw: ['blouse'], category: 'top', sub: 'blouse', warmth: 2, formality: [2, 4], occ: ['business_casual', 'formal'], wbw: 1 },
  { kw: ['flannel'], category: 'top', sub: 'flannel shirt', warmth: 3, formality: [1, 2], occ: ['casual'], wbw: 2 },
  { kw: ['t-shirt', 'tshirt', 'tee'], category: 'top', sub: 't-shirt', warmth: 1, formality: [1, 2], occ: ['casual'], wbw: 1 },
  { kw: ['long sleeve', 'long-sleeve', 'longsleeve'], category: 'top', sub: 'long-sleeve tee', warmth: 2, formality: [1, 2], occ: ['casual'], wbw: 1 },
  { kw: ['camisole', 'cami'], category: 'top', sub: 'camisole', warmth: 1, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 1 },

  // ---- dresses / one-piece ----
  { kw: ['gown', 'evening dress', 'cocktail dress'], category: 'dress', sub: 'evening dress', warmth: 2, formality: [4, 5], occ: ['formal'], wbw: 2 },
  { kw: ['sheath dress', 'wrap dress', 'shirt dress', 'midi dress'], category: 'dress', sub: 'dress', warmth: 2, formality: [2, 4], occ: ['business_casual', 'formal'], wbw: 1 },
  { kw: ['sundress', 'maxi dress', 'dress'], category: 'dress', sub: 'dress', warmth: 1, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 1 },
  { kw: ['jumpsuit', 'romper'], category: 'dress', sub: 'jumpsuit', warmth: 2, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 1 },

  // ---- bottoms ----
  { kw: ['tuxedo trousers', 'tuxedo pants'], category: 'bottom', sub: 'tuxedo trousers', warmth: 3, formality: [5, 5], occ: ['formal'], wbw: 4 },
  { kw: ['suit trousers', 'suit pants'], category: 'bottom', sub: 'suit trousers', warmth: 3, formality: [4, 5], occ: ['formal'], wbw: 4 },
  { kw: ['dress pants', 'dress trousers', 'wool trousers', 'slacks', 'trousers'], category: 'bottom', sub: 'dress trousers', warmth: 3, formality: [3, 4], occ: ['business_casual', 'formal'], wbw: 4 },
  { kw: ['chinos', 'khakis'], category: 'bottom', sub: 'chinos', warmth: 3, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 3 },
  { kw: ['cords', 'corduroys', 'corduroy pants'], category: 'bottom', sub: 'corduroys', warmth: 4, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 3 },
  { kw: ['jeans', 'denim pants'], category: 'bottom', sub: 'jeans', warmth: 3, formality: [1, 2], occ: ['casual'], wbw: 4 },
  { kw: ['cargo'], category: 'bottom', sub: 'cargo pants', warmth: 3, formality: [1, 1], occ: ['casual'], wbw: 3 },
  { kw: ['pencil skirt'], category: 'bottom', sub: 'pencil skirt', warmth: 2, formality: [3, 4], occ: ['business_casual', 'formal'], wbw: 3 },
  { kw: ['skirt'], category: 'bottom', sub: 'skirt', warmth: 2, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 2 },
  { kw: ['shorts'], category: 'bottom', sub: 'shorts', warmth: 1, formality: [1, 2], occ: ['casual'], wbw: 2 },
  { kw: ['pants'], category: 'bottom', sub: 'pants', warmth: 3, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 3 },

  // ---- shoes ----
  { kw: ['patent', 'opera pumps'], category: 'shoes', sub: 'patent dress shoes', warmth: 2, formality: [5, 5], occ: ['formal'], wbw: 999 },
  { kw: ['oxfords', 'oxford shoes', 'cap toe', 'cap-toe', 'wholecut', 'derby', 'derbies', 'brogues', 'dress shoes', 'monk strap', 'monkstrap'], category: 'shoes', sub: 'dress shoes', warmth: 2, formality: [3, 5], occ: ['business_casual', 'formal'], wbw: 999 },
  { kw: ['heels', 'pumps', 'stilettos'], category: 'shoes', sub: 'heels', warmth: 2, formality: [3, 5], occ: ['business_casual', 'formal'], wbw: 999 },
  { kw: ['loafers', 'penny loafers', 'driving shoes', 'drivers'], category: 'shoes', sub: 'loafers', warmth: 2, formality: [2, 4], occ: ['casual', 'business_casual', 'formal'], wbw: 999 },
  { kw: ['chelsea'], category: 'shoes', sub: 'chelsea boots', warmth: 3, formality: [2, 4], occ: ['casual', 'business_casual', 'formal'], rain: true, wbw: 999 },
  { kw: ['chukka', 'desert boots'], category: 'shoes', sub: 'chukka boots', warmth: 3, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 999 },
  { kw: ['hiking boots', 'hikers'], category: 'shoes', sub: 'hiking boots', warmth: 4, formality: [0, 1], occ: ['casual'], rain: true, wbw: 999 },
  { kw: ['snow boots', 'winter boots', 'duck boots', 'rain boots', 'wellies', 'wellingtons'], category: 'shoes', sub: 'weather boots', warmth: 5, formality: [1, 1], occ: ['casual'], rain: true, wbw: 999 },
  { kw: ['boots'], category: 'shoes', sub: 'boots', warmth: 4, formality: [1, 3], occ: ['casual', 'business_casual'], rain: true, wbw: 999 },
  { kw: ['flats', 'ballet flats'], category: 'shoes', sub: 'flats', warmth: 2, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 999 },
  { kw: ['sandals', 'flip flops', 'flip-flops', 'slides'], category: 'shoes', sub: 'sandals', warmth: 1, formality: [1, 1], occ: ['casual'], wbw: 999 },
  { kw: ['boat shoes', 'espadrilles'], category: 'shoes', sub: 'boat shoes', warmth: 1, formality: [1, 2], occ: ['casual'], wbw: 999 },
  { kw: ['sneakers', 'tennis shoes', 'kicks'], category: 'shoes', sub: 'sneakers', warmth: 2, formality: [0, 2], occ: ['gym', 'casual'], wbw: 999 },
  { kw: ['shoes'], category: 'shoes', sub: 'shoes', warmth: 2, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 999 },

  // ---- accessories ----
  { kw: ['bow tie', 'bowtie'], category: 'accessory', sub: 'bow tie', warmth: 1, formality: [5, 5], occ: ['formal'], wbw: 999 },
  { kw: ['tie', 'necktie'], category: 'accessory', sub: 'tie', warmth: 1, formality: [3, 5], occ: ['formal', 'business_casual'], wbw: 999 },
  { kw: ['pocket square'], category: 'accessory', sub: 'pocket square', warmth: 1, formality: [3, 5], occ: ['formal'], wbw: 999 },
  { kw: ['cufflinks'], category: 'accessory', sub: 'cufflinks', warmth: 1, formality: [4, 5], occ: ['formal'], wbw: 999 },
  { kw: ['dress belt'], category: 'accessory', sub: 'belt', warmth: 1, formality: [3, 5], occ: ['business_casual', 'formal'], wbw: 999 },
  { kw: ['belt'], category: 'accessory', sub: 'belt', warmth: 1, formality: [1, 4], occ: ['casual', 'business_casual', 'formal'], wbw: 999 },
  { kw: ['dress watch'], category: 'accessory', sub: 'watch', warmth: 1, formality: [3, 5], occ: ['business_casual', 'formal'], wbw: 999 },
  { kw: ['smartwatch', 'sports watch', 'fitness watch', 'garmin', 'apple watch'], category: 'accessory', sub: 'sports watch', warmth: 1, formality: [0, 2], occ: ['gym', 'casual'], wbw: 999 },
  { kw: ['watch'], category: 'accessory', sub: 'watch', warmth: 1, formality: [1, 4], occ: ['casual', 'business_casual', 'formal'], wbw: 999 },
  { kw: ['scarf'], category: 'accessory', sub: 'scarf', warmth: 4, formality: [1, 4], occ: ['casual', 'business_casual', 'formal'], wbw: 999 },
  { kw: ['gloves'], category: 'accessory', sub: 'gloves', warmth: 5, formality: [1, 4], occ: ['casual', 'business_casual', 'formal'], wbw: 999 },
  { kw: ['beanie', 'wool hat', 'knit hat', 'watch cap'], category: 'accessory', sub: 'beanie', warmth: 5, formality: [0, 2], occ: ['gym', 'casual'], wbw: 999 },
  { kw: ['baseball cap', 'cap', 'snapback', 'trucker hat'], category: 'accessory', sub: 'cap', warmth: 1, formality: [0, 1], occ: ['gym', 'casual'], wbw: 999 },
  { kw: ['fedora', 'panama hat', 'hat'], category: 'accessory', sub: 'hat', warmth: 2, formality: [1, 3], occ: ['casual', 'business_casual'], wbw: 999 },
  { kw: ['umbrella'], category: 'accessory', sub: 'umbrella', warmth: 1, formality: [1, 5], occ: ['gym', 'casual', 'business_casual', 'formal'], rain: true, wbw: 999 },
  { kw: ['sunglasses', 'shades'], category: 'accessory', sub: 'sunglasses', warmth: 1, formality: [0, 3], occ: ['gym', 'casual', 'business_casual'], wbw: 999 },
  { kw: ['gym bag', 'duffel', 'duffle'], category: 'accessory', sub: 'bag', warmth: 1, formality: [0, 1], occ: ['gym'], wbw: 999 },
  { kw: ['briefcase', 'messenger', 'laptop bag', 'tote', 'work bag', 'leather bag'], category: 'accessory', sub: 'bag', warmth: 1, formality: [2, 4], occ: ['business_casual', 'formal'], wbw: 999 },
  { kw: ['backpack', 'bag'], category: 'accessory', sub: 'bag', warmth: 1, formality: [0, 2], occ: ['gym', 'casual'], wbw: 999 },
  { kw: ['socks'], category: 'accessory', sub: 'socks', warmth: 2, formality: [0, 4], occ: ['gym', 'casual', 'business_casual', 'formal'], wbw: 1 },
];

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[_/]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectColor(text) {
  const words = text.split(/[\s,]+/);
  for (const [family, names] of Object.entries(COLOR_FAMILIES)) {
    for (const n of names) {
      if (words.includes(n) || text.includes(n + ' ') || text.startsWith(n)) {
        return { color: n, color_family: family };
      }
    }
  }
  return { color: '', color_family: 'other' };
}

function detectPattern(text) {
  for (const p of PATTERNS) {
    if (text.includes(p)) {
      if (['stripe', 'striped', 'pinstripe'].includes(p)) return 'striped';
      if (['check', 'checked', 'gingham', 'plaid', 'tartan', 'windowpane', 'glen'].includes(p)) return 'checked';
      if (['dot', 'dotted', 'polka'].includes(p)) return 'dotted';
      if (['camo', 'camouflage'].includes(p)) return 'camo';
      if (['print', 'printed', 'graphic', 'logo'].includes(p)) return 'graphic';
      return p;
    }
  }
  return 'solid';
}

function detectMaterial(text) {
  for (const m of MATERIALS) if (text.includes(m)) return m;
  return '';
}

function matchRule(text) {
  // Longest keyword wins so "dress belt" beats "dress" and "running shoes" beats "shoes".
  const padded = ' ' + text + ' ';
  let best = null, bestLen = 0;
  for (const rule of RULES) {
    for (const kw of rule.kw) {
      if (padded.includes(' ' + kw + ' ') || padded.includes(' ' + kw + 's ')) {
        if (kw.length > bestLen) { best = rule; bestLen = kw.length; }
      }
    }
  }
  return best;
}

/**
 * Classify one free-text description into an item draft.
 * Material and explicit words adjust the rule defaults, e.g. "linen" lowers warmth,
 * "wool" raises it, "waterproof" sets rain_ok, "formal" raises formality.
 */
function classify(text) {
  const t = normalize(text);
  const rule = matchRule(t);
  const { color, color_family } = detectColor(t);
  const pattern = detectPattern(t);
  const material = detectMaterial(t);
  const draft = {
    name: String(text || '').trim(),
    category: rule ? rule.category : 'top',
    subcategory: rule ? rule.sub : '',
    color, color_family, pattern, material,
    formality_min: rule ? rule.formality[0] : 1,
    formality_max: rule ? rule.formality[1] : 2,
    warmth: rule ? rule.warmth : 2,
    rain_ok: !!(rule && rule.rain),
    wind_ok: !!(rule && rule.wind),
    occasions: rule ? [...rule.occ] : ['casual'],
    seasons: [],
    wears_before_wash: rule ? rule.wbw : 1,
    confidence: rule ? 'high' : 'low',
  };

  // Material and modifier adjustments.
  if (['linen', 'seersucker', 'mesh'].some(m => t.includes(m))) draft.warmth = Math.max(1, draft.warmth - 1);
  if (['wool', 'cashmere', 'flannel', 'fleece', 'down', 'tweed', 'shearling', 'thermal', 'insulated', 'lined', 'heavy'].some(m => t.includes(m))) draft.warmth = Math.min(5, draft.warmth + 1);
  if (['lightweight', 'light', 'summer', 'breathable', 'thin', 'unlined'].some(m => t.includes(m))) draft.warmth = Math.max(1, draft.warmth - 1);
  if (['waterproof', 'water-resistant', 'water resistant', 'rain', 'gore-tex', 'goretex', 'rubber', 'weatherproof'].some(m => t.includes(m))) draft.rain_ok = true;
  if (['suede', 'canvas', 'linen', 'silk', 'satin'].some(m => t.includes(m)) && draft.category !== 'accessory') draft.rain_ok = false;
  if (t.includes('formal') || t.includes('dress ') || t.includes('tuxedo')) {
    draft.formality_min = Math.max(draft.formality_min, 3);
    draft.formality_max = Math.max(draft.formality_max, 4);
    if (!draft.occasions.includes('formal')) draft.occasions.push('formal');
  }
  if (t.includes('casual') && !draft.occasions.includes('casual') && draft.formality_min <= 2) draft.occasions.push('casual');
  if (['gym', 'workout', 'training', 'athletic', 'running', 'performance'].some(m => t.includes(m)) && !draft.occasions.includes('gym')) {
    draft.occasions.push('gym');
    draft.formality_min = 0;
  }
  // Pattern narrows formality at the top end a little (loud patterns rarely black tie).
  if (['graphic', 'camo'].includes(pattern)) draft.formality_max = Math.min(draft.formality_max, 1);
  if (draft.formality_min > draft.formality_max) draft.formality_min = draft.formality_max;
  return draft;
}

function classifyMany(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(classify);
}

module.exports = { classify, classifyMany, COLOR_FAMILIES, NEUTRALS };
