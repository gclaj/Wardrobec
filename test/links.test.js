'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../server/links');

const PRODUCT = {
  title: 'Tactical 5-Pocket Pant', vendor: 'Ten Thousand', product_type: 'Pants', tags: 'bottoms, everyday',
  options: [{ name: 'Color' }, { name: 'Size' }],
  variants: [
    { id: 42030099431511, option1: 'Olive', option2: '32', featured_image: { src: '//cdn.shopify.com/olive.jpg' } },
    { id: 42030098907223, option1: 'Black', option2: '32' },
  ],
  images: [{ src: '//cdn.shopify.com/main.jpg' }],
};
const TANK = { title: "Men's Forge Tank", vendor: 'Alpha Country', product_type: 'Tanks', options: ['Size', 'Color'], variants: [{ id: 50273759265053, option1: 'L', option2: 'Heather Grey' }], images: ['https://cdn.shopify.com/tank.jpg'] };

test.before(() => links.setFetch(async (url) => {
  if (url.includes('tactical-5-pocket-pant.js')) return { ok: true, json: async () => PRODUCT };
  if (url.includes('mens-forge-tank.json')) return { ok: true, json: async () => ({ product: TANK }) };
  if (url.includes('mens-forge-tank.js')) return { ok: false, status: 404 };
  throw new Error('ENOTFOUND');
}));

test('a variant link resolves to the exact colour, photo, brand and classification', async () => {
  const [d] = await links.resolveLinks(['https://www.tenthousand.cc/products/tactical-5-pocket-pant?variant=42030099431511']);
  assert.equal(d.name, 'Olive Tactical 5-Pocket Pant');
  assert.equal(d.brand, 'Ten Thousand');
  assert.equal(d.color_family, 'olive');
  assert.equal(d.category, 'bottom');
  assert.equal(d.subcategory, 'five-pocket pants');
  assert.equal(d.image, 'https://cdn.shopify.com/olive.jpg');
  assert.equal(d.url, 'https://www.tenthousand.cc/products/tactical-5-pocket-pant?variant=42030099431511');
  assert.equal(d.variant_matched, true);
});

test('falls back to the .json endpoint, finds colour when the option is not first, and dedupes identical links', async () => {
  const u = 'https://thealphacountry.com/products/mens-forge-tank?variant=50273759265053&_su_rec=junk';
  const out = await links.resolveLinks([u, u, u]);
  assert.equal(out.length, 1);
  assert.equal(out[0].duplicates, 2);
  assert.equal(out[0].name, 'Heather Grey Forge Tank');
  assert.equal(out[0].category, 'top');
  assert.ok(out[0].occasions.includes('gym'));
  assert.equal(out[0].image, 'https://cdn.shopify.com/tank.jpg');
});

test('unreachable stores and non-product links degrade to editable low-confidence drafts', async () => {
  const [a, b] = await links.resolveLinks(['https://gohaus.com/products/mens-performance-quarter-zip?variant=1', 'https://example.com/not-a-product']);
  assert.equal(a.resolved, false);
  assert.equal(a.name, 'Mens Performance Quarter Zip');
  assert.equal(a.category, 'layer');
  assert.match(a.error, /could not read/);
  assert.equal(b.resolved, false);
});

test('a wrong variant id still resolves the product but warns', async () => {
  const [d] = await links.resolveLinks(['https://www.tenthousand.cc/products/tactical-5-pocket-pant?variant=999']);
  assert.equal(d.resolved, true);
  assert.match(d.warning, /variant/);
});

test('non-Shopify links: slug and colour code parsed, page metadata read, athletic brand → gym shorts', async () => {
  const html = `<html><head><title>Pace Breaker Linerless Short 7" | Men's Shorts | lululemon</title>
    <meta property="og:image" content="https://images.lululemon.com/pb.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Pace Breaker Linerless Short 7\\"","color":"True Navy","brand":{"@type":"Brand","name":"lululemon"},"image":["https://images.lululemon.com/pb-navy.jpg"]}</script></head><body></body></html>`;
  links.setFetch(async (url) => {
    if (/lululemon/.test(url) && /color=72760/.test(url)) return { ok: true, text: async () => html };
    if (/lululemon/.test(url)) return { ok: true, text: async () => html.replace(/,"color":"True Navy"/, '') };
    throw new Error('ENOTFOUND');
  });
  const urls = [
    'https://shop.lululemon.com/p/pace-breaker-short-linerless-7-update/jd2tq0pqw6?fp=1&color=72760',
    'https://shop.lululemon.com/p/pace-breaker-short-linerless-7-update/jd2tq0pqw6?color=72762&fp=1',
  ];
  const [a, b] = await links.resolveLinks(urls);
  assert.equal(a.name, 'True Navy Pace Breaker Linerless Short 7"');
  assert.equal(a.brand, 'lululemon');
  assert.equal(a.color_family, 'navy');
  assert.equal(a.category, 'bottom');
  assert.equal(a.subcategory, 'athletic shorts');
  assert.ok(a.occasions.includes('gym'));
  assert.equal(a.formality_max, 1);
  assert.equal(a.image, 'https://images.lululemon.com/pb-navy.jpg');
  assert.equal(a.url, 'https://shop.lululemon.com/p/pace-breaker-short-linerless-7-update/jd2tq0pqw6?color=72760');
  // Second colour code is a distinct item even though the page gave no colour
  assert.equal(b.resolved, true);
  assert.equal(b.variant_matched, false);
  assert.match(b.warning, /72762/);
  assert.equal(b.notes, 'colour code 72762');
  assert.equal(b.subcategory, 'athletic shorts');
});
