'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const C = require('../assets/core.js');
const name = 'research-hunter-web.v1';
const state = () => C.validateState({ version: 1, categories: [{ id: 'quality', title: 'اختبار الجودة', description: '', symbol: 'ع', language: 'both', terms: ['3.5 turbo', 'الرياضيات السعودية'] }], selected: ['quality'], exportSelected: ['quality'], options: {}, draft: C.defaultDraft(), session: null, samples: [] });
const memory = (entries = [], reject = () => false) => {
  const data = new Map(entries);
  return { data, getItem: k => data.get(k) ?? null, setItem(k, value) { if (reject(k, value)) throw Error('QuotaExceededError'); data.set(k, value); } };
};
const session = () => ({ terms: ['رياضيات', 'مناهج'], options: C.normalizeOptions({ batchSize: 1 }), index: 1, startedAt: '2026-11-19' });
const sample = () => ({ id: 'sample', label: 'تجربة', reviewed: 10, relevant: 7, query: 'رياضيات', recordedAt: '2026-11-19' });
const stored = (value, reject) => { const raw = JSON.stringify(value), mem = memory([[name, raw]], reject); return { raw, mem, storage: new C.StorageManager(mem) }; };

test('numeric model versions survive text parsing while spaced list markers are removed', () => {
  assert.deepEqual(C.parseTerms('3.5 turbo\n4.1 mini\n1.2.3 model\n-3.5\n1. فكرة\n2) مثال\n1234. عنوان\n- عنصر'), ['3.5 turbo', '4.1 mini', '1.2.3 model', '-3.5', 'فكرة', 'مثال', 'عنوان', 'عنصر']);
});
test('structured numeric terms retain evidence through the editable draft and backup', () => {
  const parsed = C.parseResponse(JSON.stringify({ format: 'research-hunter-draft', version: 1, groups: { EN_PHRASES: [{ term: '3.5 turbo', sourceUrl: 'https://example.org/model', observedAt: '2026-11-19', note: 'إصدار' }] }, accounts: [], exclusions: [] }));
  const s = state(); s.draft.groups.EN_PHRASES.terms = parsed.groups.EN_PHRASES.join('\n'); s.draft.evidence = parsed.evidence;
  const restored = C.parseArchive(JSON.stringify(C.backupArchive(s))).state;
  assert.deepEqual(C.parseTerms(restored.draft.groups.EN_PHRASES.terms), ['3.5 turbo']); assert.equal(restored.draft.evidence[0].term, '3.5 turbo');
});
test('invalid options produce an Arabic validation error rather than TypeError', () => {
  for (const value of [null, [], 42, 'bad']) assert.throws(() => C.normalizeOptions(value), error => !(error instanceof TypeError) && /إعدادات البحث/.test(error.message));
});
test('local invalid round preserves the latest library, protects the original, and permits safe saving', () => {
  const s = state(); s.session = { ...session(), index: 99 }; const { raw, mem, storage } = stored(s), result = storage.read();
  assert.equal(result.blocked, false); assert.equal(result.state.session, null); assert.deepEqual(result.state.categories, s.categories); assert.match(result.warning, /الجولة/);
  assert.equal(JSON.parse(mem.getItem(name + '.recovery'))[0].raw, raw); assert.equal(mem.getItem(name), raw);
  assert.equal(storage.save(result.state).ok, true); assert.equal(JSON.parse(storage.raw().recovery)[0].raw, raw);
});
test('local options repair preserves valid session, draft, selections, and sample history', () => {
  const s = state(); s.options = null; s.session = session(); s.draft.topic = 'المناهج'; s.samples = [sample()];
  const result = stored(s).storage.read(); assert.equal(result.blocked, false); assert.deepEqual(result.state.options, C.normalizeOptions());
  assert.equal(result.state.session.index, 1); assert.equal(result.state.draft.topic, 'المناهج'); assert.equal(result.state.samples.length, 1); assert.deepEqual(result.state.exportSelected, ['quality']);
});
test('local damaged draft evidence preserves terms and valid account metadata', () => {
  const s = state(); s.draft.groups.AR_PHRASES.terms = 'مناهج الرياضيات'; s.draft.evidence = [{ term: 'مناهج الرياضيات', sourceUrl: 'javascript:bad' }];
  s.draft.accounts = [{ handle: 'math_teacher', sourceUrl: 'https://example.org/teacher', observedAt: '2026-11-19', note: 'معلم' }]; s.draft.selectedAccounts = ['math_teacher'];
  const result = stored(s).storage.read(); assert.equal(result.blocked, false); assert.equal(result.state.draft.groups.AR_PHRASES.terms, 'مناهج الرياضيات');
  assert.deepEqual(result.state.draft.evidence, []); assert.equal(result.state.draft.accounts.length, 1); assert.deepEqual(result.state.draft.selectedAccounts, ['math_teacher']); assert.match(result.warning, /شواهد المسودة/);
});
test('local non-object draft is isolated without blocking a valid library', () => {
  const s = state(); s.draft = 'bad'; const result = stored(s).storage.read(); assert.equal(result.blocked, false); assert.deepEqual(result.state.draft, C.defaultDraft()); assert.match(result.warning, /مسودة المولّد/);
});
test('local bad sample is isolated while valid sample records survive', () => {
  const s = state(); s.samples = [sample(), { ...sample(), relevant: 99 }]; const result = stored(s).storage.read();
  assert.equal(result.blocked, false); assert.equal(result.state.samples.length, 1); assert.equal(result.state.samples[0].relevant, 7); assert.match(result.warning, /سجلات العينات/);
});
test('over-limit local sample history resets only history and archives every original record', () => {
  const s = state(); s.samples = Array.from({ length: 101 }, sample); const { raw, storage } = stored(s), result = storage.read();
  assert.deepEqual(result.state.samples, []); assert.equal(result.state.categories.length, 1); assert.equal(JSON.parse(storage.raw().recovery)[0].raw, raw);
});
test('imports remain strict for invalid options, rounds, drafts and samples', () => {
  for (const patch of [{ options: null }, { session: { ...session(), index: 99 } }, { draft: 'bad' }, { samples: [{ ...sample(), relevant: 99 }] }]) {
    const s = { ...state(), ...patch }, { categories, ...settings } = s;
    assert.throws(() => C.parseArchive(JSON.stringify({ format: 'research-hunter-web-backup', version: 1, categories, state: settings })));
  }
});
test('invalid library is never partially accepted; fallback protects the broken primary', () => {
  const s = state(), broken = JSON.stringify({ ...s, categories: [...s.categories, { bad: true }] }), previous = JSON.stringify(s);
  const mem = memory([[name, broken], [name + '.previous', previous]]), result = new C.StorageManager(mem).read();
  assert.equal(result.recovered, true); assert.equal(result.blocked, false); assert.equal(result.state.categories.length, 1); assert.equal(JSON.parse(mem.getItem(name + '.recovery'))[0].raw, broken);
});
test('unrecoverable library blocks all automatic replacement and keeps raw bytes', () => {
  const raw = '{"version":1,"categories":[{"bad":true}]}', mem = memory([[name, raw]]), result = new C.StorageManager(mem).read();
  assert.equal(result.blocked, true); assert.equal(result.state, null); assert.equal(mem.getItem(name), raw); assert.equal(mem.getItem(name + '.recovery'), null);
});
test('failed original protection exposes salvaged data read-only and leaves original storage untouched', () => {
  const s = state(); s.session = { ...session(), index: 99 }; const { raw, mem, storage } = stored(s, k => k.endsWith('.recovery')), result = storage.read();
  assert.equal(result.blocked, true); assert.equal(result.state.categories.length, 1); assert.equal(mem.getItem(name), raw); assert.equal(mem.getItem(name + '.recovery'), null); assert.match(result.warning, /الحفظ متوقف/);
});
test('recovery archive deduplicates exact bytes, preserves case and appends subsequent originals', () => {
  const s = state(); s.options = null; const { raw, mem, storage } = stored(s); storage.read(); storage.read();
  const second = raw.replace('3.5 turbo', '3.5 TURBO'); mem.setItem(name, second); storage.read();
  assert.deepEqual(JSON.parse(storage.raw().recovery).map(r => r.raw), [raw, second]);
});
test('malformed pre-existing recovery archive is not replaced', () => {
  const s = state(); s.options = null; const { mem, storage } = stored(s); mem.setItem(name + '.recovery', '{broken');
  assert.equal(storage.read().blocked, true); assert.equal(mem.getItem(name + '.recovery'), '{broken');
});
test('primary write failure preserves both current and previous snapshots', () => {
  const s = state(), raw = JSON.stringify(s), previous = JSON.stringify({ ...s, extra: 'سابق' });
  const mem = memory([[name, raw], [name + '.previous', previous]], k => k === name), result = new C.StorageManager(mem).save({ ...s, extra: 'جديد' });
  assert.equal(result.ok, false); assert.equal(mem.getItem(name), raw); assert.equal(mem.getItem(name + '.previous'), previous);
});
test('previous snapshot quota failure does not stop saving current data or delete the old snapshot', () => {
  const s = state(), old = JSON.stringify(s), previous = JSON.stringify({ ...s, extra: 'سابق' });
  const mem = memory([[name, old], [name + '.previous', previous]], k => k.endsWith('.previous')), result = new C.StorageManager(mem).save({ ...s, extra: 'جديد' });
  assert.equal(result.ok, true); assert.match(result.warning, /اللقطة السابقة/); assert.equal(JSON.parse(mem.getItem(name)).extra, 'جديد'); assert.equal(mem.getItem(name + '.previous'), previous);
});
test('safety backup uses last valid filters while preserving pending invalid filters and original raw data', () => {
  const s = state(); s.options.accounts = 'bad account!'; s.draft.topic = 'مسودتي'; s.samples = [sample()];
  const fallback = C.normalizeOptions({ language: 'ar' }), raw = { current: '{damaged', previous: 'old', recovery: 'archive' }, backup = C.safetyBackup(s, fallback, raw);
  const restored = C.parseArchive(JSON.stringify(backup)).state;
  assert.equal(restored.options.language, 'ar'); assert.deepEqual(restored.options.accounts, []); assert.equal(restored.draft.topic, 'مسودتي'); assert.equal(restored.samples.length, 1);
  assert.equal(backup.recoveryData.pendingOptions.accounts, 'bad account!'); assert.deepEqual(backup.recoveryData.rawStorage, raw); assert.deepEqual(restored.categories, s.categories);
});
test('safety backup without recovery data remains a standard strict backup', () => {
  const s = state(), backup = C.safetyBackup(s, C.normalizeOptions()); assert.ok(!('recoveryData' in backup)); assert.deepEqual(C.parseArchive(JSON.stringify(backup)).state, s);
});
