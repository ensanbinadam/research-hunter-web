'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const C = require('../assets/core.js');

const cat = (id, title, terms, reviews = []) => C.validateCategory({ id, title, description: title, symbol: 'ع', language: 'ar', terms, reviews });
const baseState = () => C.validateState({
  version: 1,
  categories: [cat('cat-1', 'التعليم', ['التعلم النشط', 'أخبار'])],
  selected: ['cat-1'],
  exportSelected: [],
  options: C.normalizeOptions(),
  extra: '',
  draft: C.defaultDraft(),
  session: null,
  savedSessions: [],
  samples: []
});
const memory = (entries = []) => {
  const data = new Map(entries);
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};

test('saved named sessions round-trip through backup, rebuild trusted URLs, and stay backward-compatible', () => {
  const s = baseState();
  const saved = C.validateSavedSession({
    id: 'sess-1',
    name: 'جلسة تعليم العلوم',
    terms: ['التعلم النشط', 'التقويم التكويني'],
    options: { batchSize: 1, language: 'ar' },
    index: 1,
    opened: [0],
    startedAt: '2026-11-19',
    savedAt: '2026-11-19T08:00:00.000Z'
  });
  s.savedSessions = [saved];
  const backup = C.backupArchive(s);
  backup.state.savedSessions[0].url = 'javascript:alert(1)';
  const restored = C.parseArchive(JSON.stringify(backup)).state;
  assert.equal(restored.savedSessions.length, 1);
  assert.equal(restored.savedSessions[0].name, 'جلسة تعليم العلوم');
  assert.deepEqual(restored.savedSessions[0].opened, [0]);
  assert.ok(!('url' in restored.savedSessions[0]));

  // Legacy v1.2 backup without savedSessions field migrates cleanly to []
  const legacy = C.backupArchive(baseState());
  delete legacy.state.savedSessions;
  assert.deepEqual(C.parseArchive(JSON.stringify(legacy)).state.savedSessions, []);
});

test('saved sessions strictly reject invalid imports while local storage isolates damaged records', () => {
  const validOne = C.validateSavedSession({ id: 'sess-ok', name: 'جلسة سليمة', terms: ['أ', 'ب'], options: { batchSize: 1 }, index: 0 });
  assert.throws(() => C.validateSavedSessions([validOne, validOne]), /مكرر/);
  assert.throws(() => C.validateSavedSessions(Array.from({ length: 21 }, (_, i) => ({ ...validOne, id: 's-' + i }))), /20/);
  assert.throws(() => C.validateSavedSession({ ...validOne, name: '   ' }), /اسم الجلسة/);
  assert.throws(() => C.validateSavedSession({ ...validOne, index: 99 }), /موضع الجولة/);

  const badBackup = C.backupArchive(baseState());
  badBackup.state.savedSessions = [{ ...validOne, index: 55 }];
  assert.throws(() => C.parseArchive(JSON.stringify(badBackup)));

  const localBroken = { ...baseState(), savedSessions: [validOne, { id: 'sess-bad', name: 'تالف', terms: ['أ'], options: {}, index: 99 }] };
  const mem = memory([['research-hunter-web.v1', JSON.stringify(localBroken)]]);
  const read = new C.StorageManager(mem).read();
  assert.equal(read.blocked, false);
  assert.equal(read.state.savedSessions.length, 1);
  assert.equal(read.state.savedSessions[0].id, 'sess-ok');
  assert.match(read.warning, /الجلسات المحفوظة/);
});

test('bulkUpdateReviews updates target terms while preserving existing notes and evidence links', () => {
  const c = cat('bulk-1', 'مراجعة جماعية', ['التعلم النشط', 'أخبار', 'التقويم التكويني'], [
    { term: 'التعلم النشط', status: 'candidate', sourceUrl: 'https://example.org/proof', checkedAt: '', note: 'ملاحظة مهمة' },
    { term: 'التقويم التكويني', status: 'excluded', sourceUrl: '', checkedAt: '2026-11-18', note: 'سبب سابق' }
  ]);
  const res = C.bulkUpdateReviews(c, ['التعلم النشط', 'أخبار'], 'reviewed', '2026-11-19');
  assert.equal(res.updatedCount, 2);
  const r1 = res.category.reviews.find(r => r.term === 'التعلم النشط');
  assert.equal(r1.status, 'reviewed');
  assert.equal(r1.sourceUrl, 'https://example.org/proof');
  assert.equal(r1.note, 'ملاحظة مهمة');
  assert.equal(r1.checkedAt, '2026-11-19');
  // Untargeted term remains untouched
  const r3 = res.category.reviews.find(r => r.term === 'التقويم التكويني');
  assert.equal(r3.status, 'excluded');
  assert.equal(r3.note, 'سبب سابق');

  // Resetting back to candidate preserves note & evidence
  const reset = C.bulkUpdateReviews(res.category, ['التعلم النشط'], 'candidate', '');
  const r1Reset = reset.category.reviews.find(r => r.term === 'التعلم النشط');
  assert.equal(r1Reset.status, 'candidate');
  assert.equal(r1Reset.note, 'ملاحظة مهمة');
  assert.equal(r1Reset.sourceUrl, 'https://example.org/proof');
});

test('analyzeLibraryOverlap detects cross-category duplicates and prioritizes exclusion conflicts', () => {
  const c1 = cat('c-1', 'أول', ['التعلم النشط', 'أخبار', 'مفردة أ'], [{ term: 'أخبار', status: 'excluded' }]);
  const c2 = cat('c-2', 'ثان', ['التعلم النشط', 'أخبار', 'مفردة ب'], [{ term: 'التعلم النشط', status: 'reviewed' }]);
  const report = C.analyzeLibraryOverlap([c1, c2]);
  assert.equal(report.totalRawTerms, 6);
  assert.equal(report.uniqueTerms, 4);
  assert.equal(report.uniqueActiveTerms, 4);
  assert.equal(report.overlaps.length, 2);
  assert.equal(report.conflictCount, 1);
  // Conflicts are sorted first
  assert.equal(report.overlaps[0].term, 'أخبار');
  assert.equal(report.overlaps[0].conflict, true);
  assert.equal(report.overlaps[1].term, 'التعلم النشط');
  assert.equal(report.overlaps[1].conflict, false);
  assert.equal(report.alertTermsCount, 1);
});

test('summarizeSamples aggregates experiments accurately and exports safe formula-neutralized CSV', () => {
  const samples = [
    C.validateSample({ label: 'البرومبت المحسّن', reviewed: 10, relevant: 8, query: 'q1', recordedAt: '2026-11-18T10:00:00Z' }),
    C.validateSample({ label: ' البرومبت   المحسّن ', reviewed: 20, relevant: 16, query: 'q2', recordedAt: '2026-11-19T10:00:00Z' }),
    C.validateSample({ label: '=الحالي', reviewed: 10, relevant: 4, query: 'q3', recordedAt: '2026-11-17T10:00:00Z' })
  ];
  const summary = C.summarizeSamples(samples);
  assert.equal(summary.length, 2);
  assert.equal(summary[0].label, 'البرومبت المحسّن');
  assert.equal(summary[0].entries, 2);
  assert.equal(summary[0].reviewed, 30);
  assert.equal(summary[0].relevant, 24);
  assert.equal(summary[0].percentage, 80);
  assert.equal(summary[1].percentage, 40);

  const csv = C.samplesSummaryCSV(summary);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('"\'=الحالي"'));
  assert.ok(csv.includes('"80%"'));
});

test('theme manager cycles modes, resolves OS dark preference, updates meta color and survives blocked storage', () => {
  const makeEnv = (darkMatch, throwStorage = false) => {
    const store = new Map();
    const meta = { content: '#0f2a3c', setAttribute(k, v) { if (k === 'content') this.content = v; } };
    const docEl = { dataset: {} };
    const sandbox = {
      window: {
        localStorage: {
          getItem(k) { if (throwStorage) throw Error('blocked'); return store.get(k) ?? null; },
          setItem(k, v) { if (throwStorage) throw Error('blocked'); store.set(k, v); }
        },
        matchMedia: () => ({ matches: darkMatch, addEventListener() {} })
      },
      document: { documentElement: docEl, querySelector: () => meta }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/theme.js'), 'utf8'), sandbox, { filename: 'assets/theme.js' });
    return { api: sandbox.window.HunterTheme, docEl, meta, store };
  };

  const env = makeEnv(true, false);
  assert.equal(env.api.get(), 'auto');
  assert.equal(env.docEl.dataset.theme, 'dark');
  assert.equal(env.meta.content, '#091720');

  assert.equal(env.api.cycle(), 'light');
  assert.equal(env.docEl.dataset.theme, 'light');
  assert.equal(env.meta.content, '#0f2a3c');

  assert.equal(env.api.cycle(), 'dark');
  assert.equal(env.docEl.dataset.theme, 'dark');

  assert.equal(env.api.cycle(), 'auto');
  assert.equal(env.store.get('research-hunter-web.v1.theme'), 'auto');

  const blocked = makeEnv(false, true);
  assert.equal(blocked.api.get(), 'auto');
  assert.equal(blocked.api.set('dark'), 'dark');
  assert.equal(blocked.docEl.dataset.theme, 'dark');
});

test('bulk review with unsaved note uses one combined confirmation, preserves dirty state on cancel, and updates all terms on confirm', () => {
  class El {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} }; this.attributes = {}; this.hidden = false;
      this.disabled = false; this.textContent = ''; this.checked = false; this.elements = [];
      this._value = ''; this._selectedIndex = 0;
    }
    get options() { return this.children; }
    get value() { return this.tagName === 'SELECT' ? (this.children[this._selectedIndex]?.value ?? this._value) : this._value; }
    set value(v) { this._value = String(v); if (this.tagName === 'SELECT') this._selectedIndex = this.children.findIndex(o => o.value === this._value); }
    get selectedIndex() { return this._selectedIndex; }
    set selectedIndex(i) { this._selectedIndex = i; if (this.children[i]) this._value = this.children[i].value; }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    dispatch(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
    append(...nodes) { for (const n of nodes) { if (n && typeof n === 'object') { this.children.push(n); if (n.id) elements.set(n.id, n); } } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); if (this.tagName === 'SELECT') this._selectedIndex = this.children.length ? 0 : -1; }
    querySelector() { return actionsBox; }
    setAttribute(k, v) { this.attributes[k] = v; }
    removeAttribute(k) { delete this.attributes[k]; }
    after() {}
    remove() {}
  }
  const elements = new Map(), actionsBox = new El('div');
  const reg = (id, tag = 'div') => { const e = new El(tag, id); elements.set(id, e); return e; };
  for (const [id, tag] of [
    ['reviewDialog', 'dialog'], ['reviewCategory', 'select'], ['reviewStats', 'div'], ['reviewFilter', 'select'],
    ['reviewFind', 'input'], ['reviewTerm', 'select'], ['reviewAlerts', 'div'], ['termReviewForm', 'form'],
    ['reviewStatus', 'select'], ['reviewDate', 'input'], ['reviewSource', 'input'], ['reviewNote', 'textarea'],
    ['reviewError', 'p'], ['reviewDirtyBadge', 'span'], ['reviewApproveNext', 'button'], ['reviewExcludeNext', 'button'],
    ['reviewSearchX', 'button'], ['reviewSourceLink', 'a'], ['reviewPrevious', 'button'], ['reviewNext', 'button'],
    ['reviewVisibleCount', 'span'], ['bulkApproveVisible', 'button'], ['bulkExcludeAlerts', 'button'], ['bulkResetVisible', 'button'],
    ['presetFields', 'div'], ['presetCategoryName', 'p'], ['presetError', 'p'], ['presetForm', 'form'],
    ['useEditedPreset', 'button'], ['removePreset', 'button'], ['loadPreset', 'button'], ['saveCurrentPreset', 'button'],
    ['exportWebLibrary', 'button'], ['researchSearchTools', 'div'], ['exportSamples', 'button'], ['draftEvidence', 'section'],
    ['draftEvidenceBody', 'div'], ['savedPreset', 'select'], ['planReviewSummary', 'p'], ['sampleRecords', 'div'],
    ['exportSessionCsv', 'button'], ['exportSessionUrls', 'button']
  ]) reg(id, tag);
  elements.get('reviewStatus').replaceChildren(...['candidate', 'reviewed', 'excluded'].map(v => { const o = new El('option'); o.value = v; return o; }));
  elements.get('reviewFilter').replaceChildren(...['all', 'candidate', 'reviewed', 'excluded', 'hashtags', 'alerts'].map(v => { const o = new El('option'); o.value = v; return o; }));

  const downloads = [];
  const sandbox = {
    window: {},
    document: {
      body: { append(a) { a.click = () => downloads.push({ filename: a.download, url: a.href }); } },
      createTextNode: t => ({ textContent: String(t) })
    },
    URL: { createObjectURL: blob => blob, revokeObjectURL() {} },
    Blob: class FakeBlob { constructor(parts) { this.text = parts.join(''); } },
    Intl, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/research-ui.js'), 'utf8'), sandbox, { filename: 'assets/research-ui.js' });

  const state = {
    categories: [cat('ar-1', 'المشتقات العربية', ['برومبت', 'برومبتات', 'البرومبت'])],
    selected: ['ar-1'], exportSelected: [], options: C.normalizeOptions(), extra: '', draft: C.defaultDraft(), session: null, savedSessions: [], samples: []
  };
  const arSessionPlan = C.buildPlan(['برومبت', 'برومبتات'], { batchSize: 1, language: 'ar' });
  const enCurrentPlan = C.buildPlan(['Prompt'], { batchSize: 1, language: 'en' });

  const confirms = [];
  const ui = sandbox.window.HunterResearchUI({
    C, $: id => elements.get(id), node: (tag, cls, txt) => { const e = new El(tag); e.className = cls || ''; if (txt != null) e.textContent = String(txt); return e; },
    getState: () => state, getLastValidOptions: () => C.normalizeOptions(),
    savedPlan: () => arSessionPlan, planned: () => enCurrentPlan,
    changed() {}, scheduleSave() {}, toast() {}, showDialog() {}, closeDialog() {},
    confirmAction(title, msg, action) { confirms.push({ title, msg, action }); },
    xTab: { navigate: () => true }, download() {}, syncSearchFields() {}, route() {}
  });

  // Bulk review with dirty note: single confirmation, cancel preserves note + dirty badge, confirm updates all 3 terms
  ui.review('ar-1');
  elements.get('reviewNote').value = 'ملاحظة غير محفوظة';
  elements.get('reviewNote').dispatch('input');
  assert.equal(elements.get('reviewDirtyBadge').hidden, false);

  elements.get('bulkApproveVisible').dispatch('click');
  assert.equal(confirms.length, 1);
  assert.match(confirms[0].msg, /تعديلات غير محفوظة/);
  assert.match(confirms[0].msg, /3 مصطلحًا/);
  // Simulate cancel: nothing applied, dirty badge and note stay intact
  assert.equal(C.qualityReport(state.categories[0]).reviewed, 0);
  assert.equal(elements.get('reviewNote').value, 'ملاحظة غير محفوظة');
  assert.equal(elements.get('reviewDirtyBadge').hidden, false);

  // Confirm: all 3 terms become reviewed and dirty badge clears
  confirms[0].action();
  assert.equal(C.qualityReport(state.categories[0]).reviewed, 3);
  assert.equal(elements.get('reviewDirtyBadge').hidden, true);
  assert.equal(elements.get('reviewNote').value, '');

  // Session export exports resumed Arabic session (2 batches), while current selection export exports English plan (1 batch)
  elements.get('exportSessionCsv').dispatch('click');
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].filename, 'research-hunter-session-batches.csv');
  assert.ok(downloads[0].url.text.includes('برومبت'));
  assert.ok(!downloads[0].url.text.includes('Prompt'));

  const planCsvBtn = elements.get('researchSearchTools').children[1].children[0];
  planCsvBtn.dispatch('click');
  assert.equal(downloads.length, 2);
  assert.equal(downloads[1].filename, 'research-hunter-search-batches.csv');
  assert.ok(downloads[1].url.text.includes('Prompt'));
  assert.ok(!downloads[1].url.text.includes('برومبت'));
});
