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

function sampleItems() {
  return SAMPLE.map(entry => {
    const text = typeof entry === 'string' ? entry : entry.text;
    const draft = classify(text);
    delete draft.confidence;
    if (typeof entry === 'object') Object.assign(draft, entry, { name: text });
    delete draft.text;
    return draft;
  });
}

module.exports = { sampleItems };

if (require.main === module) {
  // `npm run seed` loads the sample closet into the configured database.
  const { openDb } = require('./db');
  const { insertItems } = require('./store');
  const db = openDb(process.env.WARDROBE_DB || require('node:path').join(__dirname, '..', 'data', 'wardrobe.db'));
  const n = insertItems(db, sampleItems());
  console.log(`seeded ${n} items`);
}
