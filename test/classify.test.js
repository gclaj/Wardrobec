'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, classifyMany } = require('../server/classify');

test('recognises common pieces with colour, material and dress code', () => {
  const b = classify('navy wool blazer');
  assert.equal(b.category, 'layer'); assert.equal(b.subcategory, 'blazer'); assert.equal(b.color_family, 'navy'); assert.equal(b.material, 'wool');
  assert.ok(b.formality_min >= 3);
  const s = classify('grey running shorts');
  assert.equal(s.category, 'bottom'); assert.equal(s.formality_max, 0); assert.ok(s.occasions.includes('gym'));
  const belt = classify('black leather dress belt');
  assert.equal(belt.category, 'accessory'); assert.equal(belt.subcategory, 'belt');
});

test('longest keyword wins and modifiers adjust attributes', () => {
  assert.equal(classify('white running shoes').subcategory, 'training shoes');
  assert.equal(classify('brown suede chelsea boots').rain_ok, false);
  assert.equal(classify('olive rain jacket').rain_ok, true);
  assert.ok(classify('linen shirt').warmth < classify('flannel shirt').warmth);
  assert.equal(classify('blue striped dress shirt').pattern, 'striped');
});

test('unknown text degrades gracefully', () => {
  const x = classify('thingamajig');
  assert.equal(x.confidence, 'low'); assert.equal(x.category, 'top');
  assert.equal(classifyMany('a\n\n b \n').length, 2);
});
