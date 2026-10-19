'use strict';
// Personal colour profile: which colours flatter the wearer. Ratings run -3 (works against you)
// to +3 (brightens you). Family ratings are the fallback; shade keywords found in an item's
// colour or name override them, so "icy blue" and "warm beige" can differ from plain blue and tan.

const PRESETS = {
  none: { key: 'none', label: 'No colour profile', season: '', undertone: '', contrast: 'any', families: {}, shades: {}, notes: '' },
  deep_winter: {
    key: 'deep_winter', label: 'Deep Winter', season: 'Deep Winter', undertone: 'neutral-cool', contrast: 'high',
    notes: 'Refined, crisp, high-contrast, classic. Formula: ink navy or charcoal base + crisp white + one deep jewel-tone accent.',
    families: {
      navy: 2, white: 2, blue: 1.5, teal: 2, burgundy: 2, red: 1, green: 1, purple: 1, pink: 1,
      charcoal: 1.5, black: 1, gray: 0.5, brown: 0, olive: -1, tan: -1.5, yellow: -2.5, orange: -2.5, multi: 0, other: 0,
    },
    shades: {
      // Brightens
      'ink navy': 2.5, 'cobalt': 2.5, 'sapphire': 2.5, 'crisp white': 2.5, 'deep teal': 2.5, 'emerald': 2, 'icy blue': 2,
      'cranberry': 2, 'cool red': 2, 'blue-red': 2, 'blue red': 2, 'deep magenta': 2, 'magenta': 1.5, 'fuchsia': 1.5, 'royal blue': 2,
      // Softens / best neutrals
      'charcoal': 1.5, 'cool espresso': 1.5, 'espresso': 1, 'forest pine': 1.5, 'forest': 1, 'pine': 1, 'hunter': 1,
      'plum': 1.5, 'graphite': 1, 'burgundy': 2, 'wine': 1.5, 'oxblood': 1.5, 'bright white': 2,
      // Washes out
      'warm beige': -2, 'beige': -1.5, 'peach': -2, 'camel': -2, 'khaki': -1.2, 'stone': -1, 'sand': -1.5, 'oatmeal': -1, 'cream': -0.5,
      // Overpowers
      'mustard': -2.5, 'orange': -2.5, 'yellow-gold': -2.5, 'gold': -2.5, 'yellow': -2.5, 'rust': -2.5, 'rusty': -2.5, 'copper': -2.5,
      'dusty olive': -1.5, 'tangerine': -2.5, 'coral': -1.5, 'salmon': -1.5, 'apricot': -2,
    },
  },
};

PRESETS.deep_autumn = {
  key: 'deep_autumn', label: 'Deep Autumn', season: 'Deep Autumn', undertone: 'warm-neutral', contrast: 'high',
  notes: 'Warm, muted, rich. Earthy neutrals (navy, olive, charcoal, stone, khaki, cream, brown) with forest, rust, burgundy, deep blue, sage, terracotta and mustard accents. Avoid icy pastels, neon brights, pure white head to toe, cool greys and purple/pink.',
  families: {
    navy: 2, olive: 2, charcoal: 1.5, tan: 1.5, brown: 1.5, green: 1.5, burgundy: 2, blue: 1, red: 1, orange: 1, yellow: 0.5,
    white: 0, black: 0.5, gray: -1, teal: 0, purple: -2, pink: -2, multi: 0, other: 0,
  },
  shades: {
    'stone': 1.5, 'khaki': 1.5, 'cream': 1.5, 'oatmeal': 1.5, 'camel': 1.5, 'sand': 1, 'chocolate': 1.5, 'espresso': 1.5,
    'forest': 2, 'pine': 2, 'hunter': 2, 'rust': 2, 'terracotta': 2, 'burgundy': 2, 'wine': 2, 'oxblood': 2, 'deep blue': 2, 'sage': 1.5,
    'mustard': 1.5, 'vintage red': 1.5, 'brick': 1.5, 'cognac': 1.5, 'tobacco': 1.5,
    'icy': -2.5, 'ice blue': -2.5, 'icy blue': -2.5, 'pastel': -2.5, 'neon': -2.5, 'very light blue': -2, 'powder blue': -2, 'baby blue': -2,
    'cool grey': -2, 'cool gray': -2, 'silver': -1.5, 'light grey': -1.5, 'light gray': -1.5, 'heather grey': -1, 'heather gray': -1,
    'lavender': -2.5, 'lilac': -2.5, 'fuchsia': -2.5, 'magenta': -2.5, 'hot pink': -2.5, 'bright white': -0.5,
  },
};
PRESETS.style_guide = {
  key: 'style_guide', label: 'Personal Style Guide', season: 'Style guide', undertone: 'warm-neutral (provisional)', contrast: 'high',
  notes: 'From the owner\'s personal style guide. Core neutrals: navy, olive, charcoal, stone, khaki, chocolate. Accents: rust, burgundy, deep teal, oatmeal, ivory, sage. Avoid icy pastels, neon brights, pure white head to toe, cool greys, very light blue, purple and pink.',
  families: {
    navy: 2, olive: 2, charcoal: 2, tan: 1.5, brown: 1.5, white: 1, black: 0.5, gray: -0.5,
    burgundy: 2, green: 1.5, blue: 1.5, teal: 1.5, red: 1, orange: 1, yellow: 0.5, purple: -2.5, pink: -2.5, multi: -1, other: 0,
  },
  shades: {
    'stone': 1.5, 'khaki': 1.5, 'cream': 1.5, 'ivory': 1.5, 'oatmeal': 1.5, 'chocolate': 1.5, 'espresso': 1.5,
    'forest': 2, 'pine': 2, 'hunter': 2, 'rust': 2, 'terracotta': 2, 'burgundy': 2, 'wine': 2, 'oxblood': 2, 'deep blue': 2, 'deep teal': 2, 'sage': 1.5, 'mustard': 1.5, 'vintage red': 1.5, 'brick': 1.5,
    'icy': -2.5, 'ice blue': -2.5, 'pastel': -2.5, 'neon': -2.5, 'very light blue': -2, 'powder blue': -2, 'baby blue': -2,
    'cool grey': -2, 'cool gray': -2, 'silver': -1.5, 'light grey': -1, 'light gray': -1, 'heather grey': -0.5, 'heather gray': -0.5,
    'lavender': -2.5, 'lilac': -2.5, 'fuchsia': -2.5, 'magenta': -2.5, 'hot pink': -2.5,
  },
};
PRESETS.shared_ground = {
  key: 'shared_ground', label: 'Shared ground (Winter ∩ Autumn)', season: 'Shared ground', undertone: 'unresolved', contrast: 'high',
  notes: 'Only the colours both of your reports agree on are rewarded: navy, charcoal, olive, forest, burgundy, deep blue, espresso brown. Contested colours (white, khaki, camel, rust, mustard, icy blue, cool grey, plum) score neutral until you settle the undertone question.',
  families: {
    navy: 2, charcoal: 1.5, olive: 1.5, burgundy: 2, green: 1.5, blue: 1, brown: 1, black: 0.5,
    white: 0, tan: 0, gray: 0, red: 0, orange: -1, yellow: -1, purple: -0.5, pink: -0.5, teal: 0.5, multi: 0, other: 0,
  },
  shades: { 'forest': 2, 'pine': 2, 'hunter': 2, 'espresso': 1.5, 'deep blue': 2, 'cobalt': 1, 'neon': -2.5, 'pastel': -2 },
};

const JEWEL = new Set(['burgundy', 'teal', 'green', 'blue', 'purple', 'pink', 'red', 'navy']);
const DARK = new Set(['black', 'navy', 'charcoal', 'burgundy', 'brown']);
const LIGHT = new Set(['white']);

function normalizeProfile(p) {
  if (!p || typeof p !== 'object' || !p.key || p.key === 'none') return null;
  const base = PRESETS[p.key] || PRESETS.none;
  return { ...base, ...p, families: { ...base.families, ...(p.families || {}) }, shades: { ...base.shades, ...(p.shades || {}) } };
}

/** Rating for one item under a profile: -3..+3, 0 when unknown or no profile. */
function paletteRating(item, profile) {
  if (!profile) return 0;
  const text = ' ' + `${item.color || ''} ${item.name || ''}`.toLowerCase().replace(/[_/]/g, ' ') + ' ';
  let best = null, bestLen = 0;
  for (const [shade, r] of Object.entries(profile.shades || {})) {
    if (text.includes(' ' + shade + ' ') && shade.length > bestLen) { best = r; bestLen = shade.length; }
  }
  if (best != null) return clamp(best);
  const fam = profile.families || {};
  if (item.color_family in fam) return clamp(fam[item.color_family]);
  return 0;
}
function clamp(v) { return Math.max(-3, Math.min(3, Number(v) || 0)); }

function ratingLabel(r) {
  if (r >= 1.5) return 'flatters';
  if (r >= 0.5) return 'good';
  if (r <= -1.5) return 'avoid';
  if (r <= -0.5) return 'muted';
  return 'neutral';
}

module.exports = { PRESETS, normalizeProfile, paletteRating, ratingLabel, JEWEL, DARK, LIGHT };
