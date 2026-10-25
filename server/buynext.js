'use strict';
// Recommended next buys: what single purchases would most improve the closet, and why.
const guide = require('./styleguide');
const { OCCASIONS, formalityPenalty, coverageReport } = require('./engine');
const { NEUTRAL_FAMILIES, ACCENT_FAMILIES } = guide;

const COLOUR_FOR = {
  'henley': ['navy', 'olive', 'charcoal'], 'chukka boots': ['brown suede'], 'loafers': ['brown'], 'belt': ['brown leather, to match the tan oxford', 'black leather'],
  'bag': ['black'], 'hoodie': ['charcoal', 'navy'], 'field jacket': ['olive'], 'overshirt': ['olive', 'navy'], 'sweater': ['oatmeal', 'navy', 'burgundy'],
  'dress shirt': ['light blue', 'white'], 'button-down shirt': ['white', 'light blue', 'chambray'], 'chinos': ['khaki', 'olive', 'navy'], 'polo': ['navy', 'burgundy', 'sage'],
  'sneakers': ['white'], 'dress shoes': ['brown', 'black'], 'quarter-zip': ['olive', 'charcoal'], 'blazer': ['navy', 'charcoal'],
};
const NICE = { 'sweater': 'a sweater or polo in an accent colour', 'chukka boots': 'brown suede chukka boots', 'henley': 'navy henley', 'bag': 'compact sling or day backpack', 'belt': 'brown leather belt', 'hoodie': 'performance hoodie', 'field jacket': 'olive field jacket or overshirt', 'overshirt': 'overshirt' };
const ACCESSORY_WANTS = [
  { sub: 'belt', why: 'The guide lists a brown leather belt as the one accessory every trouser look needs, and the engine matches belt to shoe colour once you own one.', score: 2.2 },
  { sub: 'bag', why: 'Weekend and Travel formulas end in a compact sling or day bag.', score: 0.8 },
  { sub: 'watch', why: 'An understated watch finishes polished looks.', score: 1.5 },
  { sub: 'sunglasses', why: 'Classic sunglasses for bright days.', score: 1.2 },
];

function hasSub(items, sub) { return items.filter(i => String(i.subcategory || '').toLowerCase().includes(sub)); }

function recommend(items, profile, pairRules) {
  items = items.filter(i => i.status !== 'retired');
  const recs = new Map();
  const add = (type, score, why, unlocks = [], colours = null) => {
    const key = type;
    const r = recs.get(key) || { type, title: NICE[type] || type, score: 0, why: [], unlocks: new Set(), colours: colours || COLOUR_FOR[type] || [] };
    r.score += score; if (why && !r.why.includes(why)) r.why.push(why); for (const u of unlocks) r.unlocks.add(u);
    if (colours && colours.length) r.colours = colours;
    recs.set(key, r);
  };

  // 1. Looks whose first or second choice in a slot is something you do not own.
  for (const look of Object.values(guide.LOOKS)) {
    for (const [slot, list] of Object.entries(look.formula)) {
      if (slot === 'accessory') continue;
      const owned = list.map(t => hasSub(items, t).length);
      if (owned[0] === 0) {
        const fallback = list.findIndex(n => n && hasSub(items, n).length > 0);
        add(list[0], fallback === -1 ? 2.5 : 1.0, fallback === -1 ? `${look.name} has nothing for its ${slot} slot.` : `${look.name} calls for ${list[0]} first; the stylist is substituting ${list[fallback]}.`, [look.name]);
      }
    }
  }
  // 2. The guide's 20-piece capsule: missing and stand-ins.
  for (const row of guide.capsuleStatus(items).rows) {
    if (row.status === 'owned') continue;
    const type = row.match.sub[0];
    add(type, row.status === 'missing' ? 2.5 : 1.0, row.status === 'missing' ? `Piece ${row.n} of your 20-piece capsule (${row.name}) is missing.` : `Piece ${row.n} of your capsule (${row.name}) is covered by a stand-in: ${row.items.slice(0, 2).join(', ')}.`, [], row.match.fam ? row.match.fam.map(f => f === 'tan' ? 'khaki' : f) : null);
  }
  // 3. Accessories the guide names.
  for (const a of ACCESSORY_WANTS) if (!hasSub(items, a.sub).length) add(a.sub, a.score, a.why);
  // 4. Thin rotations: how many clean-able tops can serve each occasion?
  for (const occ of Object.values(OCCASIONS)) {
    const tops = items.filter(i => i.category === 'top' && formalityPenalty(i, occ) != null);
    const need = occ.key === 'gym' ? 5 : occ.key === 'formal' ? 3 : 5;
    if (tops.length < need) {
      const type = occ.key === 'gym' ? 'performance tee' : occ.key === 'formal' ? 'dress shirt' : occ.key === 'business_casual' ? 'button-down shirt' : 't-shirt';
      add(type, 1.5 + (need - tops.length) * 0.4, `Only ${tops.length} top${tops.length === 1 ? '' : 's'} can serve ${occ.label}; shirts wash after one wear, so that is ${tops.length} day${tops.length === 1 ? '' : 's'} before laundry.`, [occ.label]);
    }
  }
  // 5. Palette accents with nothing near the face.
  if (profile && profile.families) {
    const near = items.filter(i => ['top', 'layer', 'outerwear'].includes(i.category));
    const famCount = {}; for (const i of near) famCount[i.color_family] = (famCount[i.color_family] || 0) + 1;
    const accents = Object.entries(profile.families).filter(([f, r]) => r >= 1.5 && ACCENT_FAMILIES.has(f)).map(([f]) => f);
    const missing = accents.filter(f => !(famCount[f] > 0));
    if (missing.length) add('sweater', 1.4, `Your palette's accent colours ${missing.join(', ')} have nothing near your face; the closet reads mostly navy, black, grey and cream up top. One knit or polo in an accent colour gives every casual look a second note.`, ['Date Night', 'School Event / Elevated Casual'], missing);
  }
  // 6. Coverage gaps, if any.
  const cov = coverageReport(items, profile, pairRules);
  for (const c of cov.cells.filter(x => x.status !== 'good')) {
    const miss = (c.problems.find(p => p.startsWith('missing ')) || '').replace('missing ', '');
    const type = miss.includes('shoes') ? 'shoes' : miss.includes('top') ? 'top' : miss.includes('bottom') ? 'bottom' : (c.rain ? 'rain jacket' : 'coat');
    add(type, 3, `${OCCASIONS[c.occasion].label} cannot be dressed in ${c.bandLabel.toLowerCase()}${c.rain ? ' rain' : ''}: ${c.problems.join('; ') || 'weak'}.`, [OCCASIONS[c.occasion].label]);
  }

  const ranked = [...recs.values()].sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1, unlocks: [...r.unlocks], priority: r.score >= 3.5 ? 'high' : r.score >= 2 ? 'medium' : 'low' }));

  // What you already have plenty of.
  const bySub = {}; for (const i of items) { const k = i.subcategory || i.category; bySub[k] = (bySub[k] || 0) + 1; }
  const plenty = Object.entries(bySub).filter(([, n]) => n >= 6).sort((a, b) => b[1] - a[1]).map(([sub, n]) => ({ type: sub, count: n }));

  return { recommendations: ranked, plenty, coverage: { good: cov.cells.filter(c => c.status === 'good').length, total: cov.cells.length } };
}

module.exports = { recommend };
