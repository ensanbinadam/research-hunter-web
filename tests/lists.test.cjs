'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/core.js');
const terms = ['رياضيات', 'معلمو الرياضيات', '#رياضيات'];
const options = () => C.normalizeOptions({ type: 'lists', batchSize: 20, language: 'ar', accounts: ['math_demo'], since: '2026-01-01', until: '2026-12-31', required: 'تعليم', exclude: 'إعلان', match: 'words', noReplies: true, noReposts: true });
const session = () => ({ terms, options: options(), index: 1, opened: [0], startedAt: '2026-11-22T08:00:00.000Z' });
const category = () => ({ id: 'math-test', title: 'الرياضيات', description: '', symbol: 'ع', language: 'ar', terms, preset: options() });

test('list discovery URLs use native singular list tab and round-trip Arabic query', () => {
  const query = 'معلمو الرياضيات #تعليم';
  const url = new URL(C.searchUrl(query, 'lists'));
  assert.equal(url.origin, 'https://x.com'); assert.equal(url.pathname, '/search');
  assert.deepEqual([...url.searchParams], [['q', query], ['src', 'typed_query'], ['f', 'list']]);
});

test('list rounds preserve phrase order and deduplicate without adding post operators', () => {
  const plan = C.buildPlan([...terms, 'رياضيات', '  معلمو الرياضيات  '], options());
  assert.deepEqual(plan.terms, terms); assert.equal(plan.batches.length, 3);
  assert.deepEqual(plan.batches.map(b => b.terms), terms.map(t => [t]));
  assert.deepEqual(plan.batches.map(b => b.query), terms);
  for (const b of plan.batches) assert.equal(new URL(b.url).searchParams.get('q'), b.query);
  assert.deepEqual(plan.options, options());
});

test('list queries respect query and encoded URL bounds without truncating valid terms', () => {
  assert.deepEqual(C.buildPlan([], { type: 'lists' }).batches, []);
  assert.throws(() => C.buildPlan(['"\\"'], { type: 'lists' }), /فارغة/);
  assert.throws(() => C.buildPlan(['a'.repeat(381)], { type: 'lists' }), /أطول/);
  const unicode = C.buildPlan(['😀'.repeat(190)], { type: 'lists' }).batches[0];
  assert.equal(new URL(unicode.url).searchParams.get('q'), '😀'.repeat(190));
  assert.ok(unicode.url.length <= 3500);
  assert.equal(C.buildPlan(['a'.repeat(380)], { type: 'lists' }).batches[0].query.length, 380);
});

test('returning from list discovery restores all post search preferences', () => {
  const plan = C.buildPlan(terms, options());
  const posts = C.buildPlan(terms, { ...plan.options, type: 'latest' });
  assert.equal(posts.batches.length, 1);
  const q = posts.batches[0].query;
  for (const expected of ['lang:ar', 'from:math_demo', 'since:2026-01-01', 'until:2026-12-31', '-filter:replies', '-filter:retweets', 'تعليم', 'إعلان', ' OR ']) assert.ok(q.includes(expected), expected);
  assert.equal(new URL(posts.batches[0].url).searchParams.get('f'), 'live');
});

test('full backup preserves list presets and current and named session context', () => {
  const state = { version: 1, categories: [category()], selected: ['math-test'], exportSelected: ['math-test'], options: options(), extra: '', draft: C.defaultDraft(), session: session(), savedSessions: [{ ...session(), id: 'saved-math', name: 'قوائم الرياضيات', savedAt: '2026-11-22T08:00:00.000Z' }], samples: [] };
  const restored = C.parseArchive(JSON.stringify(C.backupArchive(state))).state;
  assert.equal(restored.options.type, 'lists'); assert.equal(restored.categories[0].preset.type, 'lists');
  for (const s of [restored.session, restored.savedSessions[0]]) {
    assert.equal(s.index, 1); assert.deepEqual(s.opened, [0]);
    assert.equal(new URL(C.buildPlan(s.terms, s.options).batches[1].url).searchParams.get('f'), 'list');
  }
});

test('post-only preferences are not counted as active filters for lists', () => {
  assert.equal(C.countActiveFilters(options()), 0);
  assert.equal(C.countActiveFilters(options(), 'فيزياء'), 1);
  assert.ok(C.countActiveFilters({ ...options(), type: 'latest' }) > 1);
});

test('manual list sample retains the result tab through validation and backup', () => {
  const sample = C.validateSample({ label: 'قوائم متخصصة', reviewed: 10, relevant: 7, query: 'رياضيات', type: 'lists' });
  assert.equal(sample.type, 'lists'); assert.equal(new URL(C.searchUrl(sample.query, sample.type)).searchParams.get('f'), 'list');
  const summary = C.summarizeSamples([sample]); assert.equal(summary[0].percentage, 70);
  const restored = C.validateState({ version: 1, categories: [category()], options: options(), samples: [sample] });
  assert.equal(restored.samples[0].type, 'lists');
});

test('changing result tab marks session stale and exports exact list links', () => {
  const plan = C.buildPlan(terms, options());
  assert.equal(C.isSessionStale(session(), plan), false);
  assert.equal(C.isSessionStale(session(), C.buildPlan(terms, { ...options(), type: 'top' })), true);
  const csv = C.planCSV(plan);
  for (const b of plan.batches) assert.ok(csv.includes(b.url));
  assert.ok(!csv.includes('from%3A')); assert.ok(!csv.includes('since%3A'));
});

test('retired list preferences become latest when edited without mutating saved archive or preset', () => {
  const original = options(), before = JSON.stringify(original);
  const editable = C.editableOptions(original);
  assert.equal(editable.type, 'latest');
  assert.deepEqual(editable, { ...original, type: 'latest' });
  assert.equal(JSON.stringify(original), before);
  const plan = C.buildPlan(terms, editable);
  assert.equal(new URL(plan.batches[0].url).searchParams.get('f'), 'live');
  assert.ok(plan.batches[0].query.includes('from:math_demo'));
  assert.equal(C.validateSavedSession({ ...session(), id:'old-list', name:'أرشيف القوائم' }).options.type, 'lists');
});

test('editable result tabs retain supported preferences and reject malformed retired filters', () => {
  for (const type of ['latest','top','users','media']) {
    const original = C.normalizeOptions({ ...options(), type });
    assert.deepEqual(C.editableOptions(original), original);
  }
  assert.throws(() => C.editableOptions({ type:'lists', accounts:'bad OR name' }), /حساب/);
  assert.throws(() => C.editableOptions({ type:'unknown' }), /إعدادات/);
  assert.throws(() => C.editableOptions(null), /كائن/);
});
