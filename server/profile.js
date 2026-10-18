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
