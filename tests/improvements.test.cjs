'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const C = require('../assets/core.js');

const cat = (id = 'c-1', title = 'بحث', terms = ['البحث العلمي'], language = 'ar') => ({ id, title, description: title, symbol: 'ع', language, terms });
const memory = (entries = []) => {
  const data = new Map(entries);
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};

test('mergeCategories returns exact targetIds across merges, renames and duplicate incoming titles', () => {
  const base = [cat('en-1', 'AI Research', ['prompt'], 'en'), cat('ar-1', 'علوم', ['فيزياء'], 'ar')];
  const incoming = [
    cat('inc-1', 'AI Research', ['ذكاء'], 'ar'),
    cat('inc-2', 'علوم', ['كيمياء'], 'ar'),
    cat('inc-3', 'علوم', ['أحياء'], 'ar')
  ];
  const result = C.mergeCategories(base, incoming);
  assert.equal(result.renamed, 1);
  assert.equal(result.merged, 2);
  assert.equal(result.targetIds.length, 2);
  const renamed = result.categories.find(c => c.title === 'AI Research (2)');
  assert.ok(renamed);
  assert.deepEqual(result.targetIds, [renamed.id, 'ar-1']);
});

test('parseEditedTerms preserves unchanged comma-containing phrases while parsing new input', () => {
  const original = ['science, technology', 'A; B'];
  const edited = C.parseEditedTerms('science, technology\nA; B\nبحث جديد، عبارة ثانية\nscience, technology', original);
  assert.deepEqual(edited, ['science, technology', 'A; B', 'بحث جديد', 'عبارة ثانية']);
});

test('parseTerms strips Arabic-Indic spaced list markers while keeping numeric decimals', () => {
  assert.deepEqual(C.parseTerms('١. فكرة أولى\n٢) فكرة ثانية\n٣.٥ تيربو'), ['فكرة أولى', 'فكرة ثانية', '٣.٥ تيربو']);
});

test('words match mode cleans isolated quotes/backslashes and avoids redundant single-word parens', () => {
  const plan = C.buildPlan(['تعلم " نشط', 'بحث \\ علمي', 'مفردة', '#وسم'], { match: 'words' });
  const q = plan.batches[0].query;
  assert.ok(q.includes('("تعلم" "نشط")'));
  assert.ok(q.includes('("بحث" "علمي")'));
  assert.ok(q.includes('"مفردة"'));
  assert.ok(!q.includes('("مفردة")'));
  assert.ok(q.includes('#وسم'));
});

test('parseResponse extracts JSON wrapped in LLM prose while staying strict on invalid JSON', () => {
  const payload = JSON.stringify({ format: 'research-hunter-draft', version: 1, groups: { AR_PHRASES: [{ term: 'التعلم النشط', sourceUrl: '', observedAt: 'invalid-date', note: '' }] }, accounts: [], exclusions: [] });
  const wrappedFenced = 'إليك المصطلحات المطلوبة:\n```json\n' + payload + '\n```\nأتمنى لك بحثًا موفقًا.';
  const r1 = C.parseResponse(wrappedFenced);
  assert.deepEqual(r1.groups.AR_PHRASES, ['التعلم النشط']);
  assert.equal(r1.evidence.length, 0);
  assert.equal(r1.invalid, 1);

  const wrappedRaw = 'النتيجة:\n' + payload + '\nملاحظة ختامية.';
  const r2 = C.parseResponse(wrappedRaw);
  assert.deepEqual(r2.groups.AR_PHRASES, ['التعلم النشط']);

  assert.throws(() => C.parseResponse('إليك النتيجة:\n```json\n{"format": broken}\n```'));
});

test('validateCategory trims whitespace-only symbol and description to safe defaults', () => {
  const c = C.validateCategory({ id: 'trim-1', title: '  التعليم  ', description: '   ', symbol: '   ', language: 'ar', terms: ['التعلم النشط'] });
  assert.equal(c.title, 'التعليم');
  assert.equal(c.description, 'التعليم');
  assert.equal(c.symbol, 'ع');
});

test('validateDraft supports full 160-character group descriptions matching category limit', () => {
  const longDesc = 'و'.repeat(160);
  const state = C.validateState({
    version: 1,
    categories: [cat()],
    selected: ['c-1'],
    exportSelected: [],
    options: C.normalizeOptions(),
    extra: '',
    draft: { ...C.defaultDraft(), groups: { ...C.defaultDraft().groups, AR_PHRASES: { title: 'بحث', description: longDesc, terms: 'علم', include: true } } },
    session: null,
    samples: []
  });
  assert.equal(state.draft.groups.AR_PHRASES.description.length, 160);
});

test('session opened rounds validate strictly on import and isolate safely on local repair', () => {
  const validState = C.validateState({
    version: 1,
    categories: [cat()],
    selected: ['c-1'],
    exportSelected: [],
    options: C.normalizeOptions(),
    extra: '',
    draft: C.defaultDraft(),
    session: { terms: ['أ', 'ب', 'ج'], options: C.normalizeOptions({ batchSize: 1 }), index: 1, opened: [2, 0, 2], startedAt: '2026-11-19' },
    samples: []
  });
  assert.deepEqual(validState.session.opened, [0, 2]);
  const roundTripped = C.parseArchive(JSON.stringify(C.backupArchive(validState))).state;
  assert.deepEqual(roundTripped.session.opened, [0, 2]);

  const badImport = C.backupArchive(validState);
  badImport.state.session.opened = [99];
  assert.throws(() => C.parseArchive(JSON.stringify(badImport)), /المفتوحة/);

  const mem = memory([['research-hunter-web.v1', JSON.stringify({ ...validState, session: { ...validState.session, opened: ['bad'] } })]]);
  const repaired = new C.StorageManager(mem).read();
  assert.equal(repaired.blocked, false);
  assert.equal(repaired.state.session.index, 1);
  assert.ok(!('opened' in repaired.state.session));
  assert.match(repaired.warning, /علامات فتح الجولات/);
});

test('inspectTerm flags handles, extended X operators, single-char terms and empty-after-clean terms', () => {
  assert.ok(C.inspectTerm('@researcher').some(r => r.includes('حساب')));
  assert.ok(C.inspectTerm('بحث min_replies:5').some(r => r.includes('أمر بحث')));
  assert.ok(C.inspectTerm('بحث url:example.com').some(r => r.includes('أمر بحث')));
  assert.ok(C.inspectTerm('ع').some(r => r.includes('حرف واحد')));
  assert.ok(C.inspectTerm('""').some(r => r.includes('علامات التنصيص')));
});

test('countActiveFilters and isSessionStale accurately track search filter state and staleness', () => {
  assert.equal(C.countActiveFilters(C.normalizeOptions(), ''), 0);
  assert.equal(C.countActiveFilters({ since: '2026-01-01', accounts: 'demo_user', noReplies: true, match: 'words' }, 'إضافي'), 5);

  const planA = C.buildPlan(['أ', 'ب'], { batchSize: 1, language: 'ar' });
  const session = { terms: planA.terms, options: planA.options, index: 0, startedAt: '2026-11-19' };
  assert.equal(C.isSessionStale(session, planA), false);

  const planDifferentTerms = C.buildPlan(['أ', 'ج'], { batchSize: 1, language: 'ar' });
  assert.equal(C.isSessionStale(session, planDifferentTerms), true);

  const planDifferentOpts = C.buildPlan(['أ', 'ب'], { batchSize: 1, language: 'en' });
  assert.equal(C.isSessionStale(session, planDifferentOpts), true);
});

test('review dialog dirty guard protects unsaved notes across category switch, search, filter, term change and close', () => {
  class El {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} }; this.attributes = {}; this.hidden = false;
      this.disabled = false; this.textContent = ''; this.checked = false; this.elements = [];
      this._value = ''; this._selectedIndex = 0;
    }
    get options() { return this.children; }
    get value() { return this.tagName === 'SELECT' ? (this.children[this._selectedIndex]?.value ?? this._value) : this._value; }
    set value(v) {
      this._value = String(v);
      if (this.tagName === 'SELECT') {
        const idx = this.children.findIndex(o => o.value === this._value);
        this._selectedIndex = idx;
      }
    }
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
    ['presetFields', 'div'], ['presetCategoryName', 'p'], ['presetError', 'p'], ['presetForm', 'form'],
    ['useEditedPreset', 'button'], ['removePreset', 'button'], ['loadPreset', 'button'], ['saveCurrentPreset', 'button'],
    ['exportWebLibrary', 'button'], ['researchSearchTools', 'div'], ['exportSamples', 'button'], ['draftEvidence', 'section'],
    ['draftEvidenceBody', 'div'], ['savedPreset', 'select'], ['planReviewSummary', 'p'], ['sampleRecords', 'div']
  ]) reg(id, tag);
  elements.get('reviewStatus').replaceChildren(...['candidate', 'reviewed', 'excluded'].map(v => { const o = new El('option'); o.value = v; return o; }));
  elements.get('reviewFilter').replaceChildren(...['all', 'candidate', 'reviewed', 'excluded', 'hashtags', 'alerts'].map(v => { const o = new El('option'); o.value = v; return o; }));

  const sandbox = {
    window: {},
    document: { createTextNode: t => ({ textContent: String(t) }) },
    URL, Blob, Intl, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/research-ui.js'), 'utf8'), sandbox, { filename: 'assets/research-ui.js' });

  const state = {
    categories: [
      cat('cat-a', 'تصنيف أ', ['برومبت', 'هندسة البرومبت']),
      cat('cat-b', 'تصنيف ب', ['البحث العلمي'])
    ],
    selected: ['cat-a'], exportSelected: [], options: C.normalizeOptions(), extra: '', draft: C.defaultDraft(), session: null, samples: []
  };
  let pendingConfirm = null, confirmCalls = 0, closedForce = null, pageExitGuard = false;
  const ui = sandbox.window.HunterResearchUI({
    C, $: id => elements.get(id), node: (tag, cls, txt) => { const e = new El(tag); e.className = cls || ''; if (txt != null) e.textContent = String(txt); return e; },
    getState: () => state, getLastValidOptions: () => C.normalizeOptions(), changed() {}, scheduleSave() {}, toast() {},
    showDialog() {}, closeDialog(id, force) { closedForce = [id, !!force]; }, onReviewDirtyChange(dirty) { pageExitGuard = dirty; },
    confirmAction(_title, _msg, action) { confirmCalls++; pendingConfirm = action; },
    xTab: { navigate: () => true }, download() {}, planned: () => ({ batches: [] }), syncSearchFields() {}, route() {}
  });

  ui.review('cat-a');
  const note = elements.get('reviewNote'), badge = elements.get('reviewDirtyBadge');
  assert.equal(badge.hidden, true);

  // Type an unsaved note
  note.value = 'ملاحظة مهمة لم تُحفظ';
  note.dispatch('input');
  assert.equal(badge.hidden, false);
  assert.equal(pageExitGuard, true);

  // 1) Category switch while dirty MUST revert and ask confirmation
  elements.get('reviewCategory').value = 'cat-b';
  elements.get('reviewCategory').dispatch('change');
  assert.equal(confirmCalls, 1);
  assert.equal(elements.get('reviewCategory').value, 'cat-a');
  assert.equal(note.value, 'ملاحظة مهمة لم تُحفظ');
  assert.equal(pageExitGuard, true);

  // 2) Typing in search that STILL matches current term keeps note without popping dialog
  elements.get('reviewFind').value = 'بروم';
  elements.get('reviewFind').dispatch('input');
  assert.equal(confirmCalls, 1);
  assert.equal(note.value, 'ملاحظة مهمة لم تُحفظ');
  assert.equal(badge.hidden, false);

  // 3) Typing in search that HIDES current term MUST revert search, keep note, and ask confirmation
  elements.get('reviewFind').value = 'غير_موجود';
  elements.get('reviewFind').dispatch('input');
  assert.equal(confirmCalls, 2);
  assert.equal(elements.get('reviewFind').value, 'بروم');
  assert.equal(note.value, 'ملاحظة مهمة لم تُحفظ');

  // 4) Switching filter to 'candidate' (keeps current term) preserves note without dialog
  elements.get('reviewFilter').value = 'candidate';
  elements.get('reviewFilter').dispatch('change');
  assert.equal(confirmCalls, 2);
  assert.equal(note.value, 'ملاحظة مهمة لم تُحفظ');

  // 5) Switching filter to 'excluded' (hides current term) MUST revert filter, keep note, and ask confirmation
  elements.get('reviewFilter').value = 'excluded';
  elements.get('reviewFilter').dispatch('change');
  assert.equal(confirmCalls, 3);
  assert.equal(elements.get('reviewFilter').value, 'candidate');
  assert.equal(note.value, 'ملاحظة مهمة لم تُحفظ');

  // 6) Closing via X or Escape while dirty asks confirmation; confirming closes with force=true
  let prevented = false;
  elements.get('reviewDialog').dispatch('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(confirmCalls, 4);
  pendingConfirm();
  assert.deepEqual(closedForce, ['reviewDialog', true]);
  assert.equal(badge.hidden, true);
  assert.equal(pageExitGuard, false);

  // 7) Confirming a category switch applies the target category cleanly
  ui.review('cat-a');
  note.value = 'ملاحظة أخرى'; note.dispatch('input');
  elements.get('reviewCategory').value = 'cat-b';
  elements.get('reviewCategory').dispatch('change');
  assert.equal(confirmCalls, 5);
  pendingConfirm();
  assert.equal(elements.get('reviewCategory').value, 'cat-b');
  assert.equal(note.value, '');
  assert.equal(badge.hidden, true);
  assert.equal(pageExitGuard, false);
});
