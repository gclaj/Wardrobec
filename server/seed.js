'use strict';
// A sample closet that covers all four occasions across every weather band.
// Lines are classified automatically; the object form overrides anything the classifier guesses.
const { classify } = require('./classify');

const SAMPLE = [
  // Gym
  'black performance tee', 'grey performance tee', 'navy tank top', 'black running shorts', 'grey training shorts',
  'black joggers', 'white running shoes', 'black training shoes', 'grey quarter-zip', 'black windbreaker',
  { text: 'black sports watch' }, { text: 'black gym bag' }, 'black baseball cap',
  // Casual tops
  'white t-shirt', 'navy t-shirt', 'heather grey t-shirt', 'olive henley', 'navy polo', 'white polo',
  'blue chambray button-down shirt', 'red plaid flannel shirt', 'grey long-sleeve tee',
  // Casual bottoms
  'dark blue jeans', 'black jeans', 'khaki chinos', 'navy chinos', 'olive chinos', 'tan shorts', 'navy shorts',
  // Casual layers / outerwear
  'grey hoodie', 'navy crewneck sweater', 'charcoal merino sweater', 'tan cardigan', 'olive field jacket',
  'blue denim jacket', 'black leather jacket', 'navy puffer parka', 'olive rain jacket',
  // Casual shoes
  'white sneakers', 'grey sneakers', 'brown chukka boots', 'brown leather boots', 'tan boat shoes', 'black sandals',
  // Business casual
  'white oxford shirt', 'light blue oxford shirt', 'blue striped dress shirt', 'white dress shirt', 'pink dress shirt',
  'navy blazer', 'grey tweed sport coat', 'grey dress trousers', 'charcoal wool trousers', 'navy dress pants',
  'brown loafers', 'brown chelsea boots', 'black derby dress shoes', 'tan trench coat', 'camel overcoat',
  'brown leather belt', 'black leather dress belt', 'brown leather briefcase bag', 'silver dress watch', 'navy wool scarf', 'black leather gloves',
  // Formal
  { text: 'navy suit jacket', set_id: 'navy-suit' }, { text: 'navy suit trousers', set_id: 'navy-suit' },
  { text: 'charcoal suit jacket', set_id: 'charcoal-suit' }, { text: 'charcoal suit trousers', set_id: 'charcoal-suit' },
  { text: 'black tuxedo jacket', set_id: 'tux' }, { text: 'black tuxedo trousers', set_id: 'tux' }, 'white tuxedo shirt',
  'black oxford cap-toe dress shoes', 'black patent dress shoes', 'burgundy silk tie', 'navy tie', 'black bow tie',
  'white pocket square', 'silver cufflinks', 'black umbrella', 'black sunglasses',
];

// The owner's 20-piece capsule from their personal style guide, plus the belt and cap worn in every look.
const CAPSULE = [
  { text: 'navy blazer', formality_min: 3, formality_max: 4 },
  { text: 'light blue dress shirt' },
  { text: 'white button-down shirt' },
  { text: 'gray oxford flannel button-down shirt', warmth: 3, pattern: 'solid' },
  { text: 'navy henley' },
  { text: 'olive quarter-zip', occasions: ['casual', 'business_casual', 'gym'] },
  { text: 'oatmeal sweater', color: 'oatmeal', color_family: 'tan' },
  { text: 'vintage red t-shirt', color: 'vintage red', color_family: 'red', occasions: ['casual', 'gym'] },
  { text: 'white t-shirt', occasions: ['casual', 'gym'] },
  { text: 'black performance hoodie' },
  { text: 'khaki chinos' },
  { text: 'olive 5-pocket pants', subcategory: 'five-pocket pants', formality_min: 1, formality_max: 2 },
  { text: 'navy 5-pocket pants', subcategory: 'five-pocket pants', formality_min: 1, formality_max: 3 },
  { text: 'dark blue jeans' },
  { text: 'gray 7-inch athletic shorts', occasions: ['gym', 'casual'], formality_min: 0, formality_max: 1 },
  { text: 'black jogger pants', subcategory: 'joggers', occasions: ['gym', 'casual'], formality_min: 0, formality_max: 1 },
  { text: 'white sneakers' },
  { text: 'brown loafers' },
  { text: 'brown suede chukka boots' },
  { text: 'black sling day backpack bag', subcategory: 'bag', formality_min: 0, formality_max: 2, occasions: ['gym', 'casual'] },
  { text: 'brown leather belt' },
  { text: 'navy baseball cap' },
];

function capsuleItems() { return build(CAPSULE); }

function build(list) {
  return list.map(entry => {
    const text = typeof entry === 'string' ? entry : entry.text;
    const draft = classify(text);
    delete draft.confidence;
    if (typeof entry === 'object') Object.assign(draft, entry, { name: text });
    delete draft.text;
    return draft;
  });
}

function sampleItems() { return build(SAMPLE); }

module.exports = { sampleItems, capsuleItems };

if (require.main === module) {
  // `npm run seed` loads the sample closet into the configured database.
  const { openDb } = require('./db');
  const { insertItems } = require('./store');
  const db = openDb(process.env.WARDROBE_DB || require('node:path').join(__dirname, '..', 'data', 'wardrobe.db'));
  const n = insertItems(db, sampleItems());
  console.log(`seeded ${n} items`);
}
