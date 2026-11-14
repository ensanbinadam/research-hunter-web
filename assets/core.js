(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HunterCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMIT = 50, MAX_FILE_BYTES = 8 * 1024 * 1024;
  const SECTIONS = [
    { key: 'AR_PHRASES', label: 'عبارات عربية', suffix: 'عربي | عبارات', language: 'ar', symbol: 'ع', hashtag: false },
    { key: 'AR_HASHTAGS', label: 'هاشتاقات عربية', suffix: 'عربي | هاشتاقات', language: 'ar', symbol: '#', hashtag: true },
    { key: 'EN_PHRASES', label: 'عبارات إنجليزية', suffix: 'إنجليزي | عبارات', language: 'en', symbol: 'EN', hashtag: false },
    { key: 'EN_HASHTAGS', label: 'هاشتاقات إنجليزية', suffix: 'إنجليزي | هاشتاقات', language: 'en', symbol: '#', hashtag: true }
  ];
  const key = value => String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const unique = values => { const seen = new Set(); return values.filter(t => { const k = key(t); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
  const id = () => 'custom-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const clone = value => JSON.parse(JSON.stringify(value));
  function parseTerms(value) {
    return unique(String(value).replace(/\\(?=[#,،])/g, '').split(/[,،;؛\n\r]+/u).map(t => t.replace(/^\s*(?:[-•*]\s+|\d+[.)]\s*)/u, '').trim().replace(/^["“”`]+|["“”`]+$/gu, '').trim()).filter(Boolean));
  }
  const validHashtag = t => /^#(?=[\p{L}\p{N}_]*\p{L})[\p{L}\p{N}_]+$/u.test(t);
  function validateCategory(c) {
    if (!c || typeof c !== 'object' || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 65) throw Error('اسم كل تصنيف مطلوب، وبحد أقصى 65 حرفًا.');
    if (!/^[a-z0-9-]{1,90}$/.test(c.id || '')) throw Error('معرّف التصنيف غير صالح.');
    if (!Array.isArray(c.terms) || !c.terms.length || c.terms.length > 2000 || c.terms.some(t => typeof t !== 'string' || !t.trim() || t.length > 500 || /[\r\n\u0000]/u.test(t))) throw Error('يجب أن يحتوي التصنيف من 1 إلى 2000 عبارة نصية، وبحد أقصى 500 حرف للعبارة.');
    if (c.description != null && (typeof c.description !== 'string' || c.description.length > 160)) throw Error('وصف التصنيف يجب ألا يتجاوز 160 حرفًا.');
    if (c.language != null && !['ar', 'en', 'mixed', 'both'].includes(c.language)) throw Error('لغة التصنيف غير صالحة.');
    if (c.symbol != null && (typeof c.symbol !== 'string' || c.symbol.length > 4)) throw Error('رمز التصنيف يجب ألا يتجاوز 4 أحرف.');
    return { id: c.id, title: c.title.trim(), description: c.description || c.title.trim(), symbol: c.symbol || 'ع', language: c.language === 'both' ? 'mixed' : c.language || 'mixed', terms: unique(c.terms) };
  }
  function validateCategories(categories, allowEmpty = false) {
    if (!Array.isArray(categories) || categories.length > LIMIT || (!allowEmpty && !categories.length)) throw Error('المكتبة تدعم من 1 إلى 50 تصنيفًا.');
    const result = categories.map(validateCategory);
    if (new Set(result.map(c => c.id)).size !== result.length) throw Error('يوجد معرّف تصنيف مكرر داخل الملف.');
    return result;
  }
  function parseArchive(text) {
    if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw Error('حجم الملف أكبر من 8 ميغابايت.');
    let data; try { data = JSON.parse(text); } catch { throw Error('ملف JSON تالف أو غير صالح.'); }
    if (!data || !['research-hunter-categories', 'prompt-hunter-categories', 'research-hunter-web-backup'].includes(data.format)) throw Error('الملف ليس من ملفات الصياد المعتمدة.');
    if (data.format === 'research-hunter-web-backup' ? data.version !== 1 : data.version !== 2) throw Error('إصدار الملف غير مدعوم. استخدم تصنيفات الإصدار 2 أو نسخة Web الإصدار 1.');
    const categories = validateCategories(data.categories, data.format === 'research-hunter-web-backup');
    return { format: data.format, categories, ...(data.format === 'research-hunter-web-backup' ? { state: validateState({ ...data.state, categories }) } : {}) };
  }
  function mergeCategories(base, incoming, mode = 'merge') {
    const categories = clone(validateCategories(base, true)); let merged = 0, duplicates = 0, renamed = 0;
    for (const raw of validateCategories(incoming, true)) {
      const c = clone(raw), existing = categories.find(e => key(e.title) === key(c.title) && (!e.language || !c.language || e.language === c.language));
      if (existing && mode === 'merge') {
        const all = [...existing.terms, ...c.terms]; existing.terms = unique(all); duplicates += all.length - existing.terms.length; merged++; continue;
      }
      const original = c.title; let n = 2;
      while (categories.some(e => key(e.title) === key(c.title))) { const tail = ` (${n++})`; c.title = original.slice(0, 65 - tail.length) + tail; }
      if (c.title !== original) renamed++;
      while (categories.some(e => e.id === c.id)) c.id = id();
      categories.push(c);
    }
    return { categories: validateCategories(categories, true), merged, duplicates, renamed };
  }
  function parseResponse(text) {
    const groups = Object.fromEntries(SECTIONS.map(s => [s.key, []])); let active = null, found = false, invalid = 0;
    for (const original of String(text).replace(/\r\n?/g, '\n').split('\n')) {
      const line = original.trim().replace(/^\*+|\*+$/g, '');
      if (/^```/.test(line) || !line) continue;
      const head = line.match(/^(?:#{1,6}\s*)?(?:\[)?(AR_PHRASES|AR_HASHTAGS|EN_PHRASES|EN_HASHTAGS)(?:\])?\s*[:：-]?\s*(.*)$/i);
      if (head) { active = head[1].toUpperCase(); found = true; if (head[2]) groups[active].push(head[2]); }
      else if (active) groups[active].push(original);
    }
    if (!found) throw Error('لم نجد عناوين الأقسام. استخدم AR_PHRASES وAR_HASHTAGS وEN_PHRASES وEN_HASHTAGS، أو حرّر المجموعات يدويًا.');
    const result = Object.fromEntries(SECTIONS.map(s => [s.key, []]));
    for (const section of SECTIONS) for (const term of parseTerms(groups[section.key].join('\n'))) {
      if (term.startsWith('#') && !validHashtag(term)) { invalid++; continue; }
      result[section.language.toUpperCase() + (term.startsWith('#') ? '_HASHTAGS' : '_PHRASES')].push(term);
    }
    for (const s of SECTIONS) result[s.key] = unique(result[s.key]);
    return { groups: result, invalid };
  }
  function makePrompt(draft) {
    if (!draft.topic?.trim()) throw Error('اكتب موضوع البحث أولًا.');
    const wanted = SECTIONS.filter(s => (draft.language === 'both' || s.language === draft.language) && (draft.mode === 'both' || (draft.mode === 'hashtags') === s.hashtag));
    return [
      'أنت خبير في إعداد قوائم بحث دقيقة لمنصة X (تويتر)، ومهمتك توليد مصطلحات لأداة الصياد الباحث.',
      `الموضوع: ${draft.topic.trim()}`,
      `الهدف: ${{ posts: 'منشورات ذات صلة مباشرة', accounts: 'حسابات متخصصة تنشر بانتظام', both: 'حسابات ومنشورات متخصصة' }[draft.target] || 'منشورات متخصصة'}.`,
      `التفاصيل: ${draft.context?.trim() || 'لا توجد.'}`,
      `موضوعات يجب تجنبها: ${draft.exclude?.trim() || 'لا توجد.'}`,
      `مستوى الدقة: ${{ high: 'دقيقة ومحددة؛ تجنب الكلمات العامة والملتبسة', balanced: 'متوازنة بين الدقة والشمول', wide: 'واسعة مع الالتزام بالموضوع' }[draft.precision] || 'متوازنة'}.`,
      `اقترح نحو ${Math.max(5, Math.min(100, Number(draft.count) || 20))} مصطلحًا لكل قسم، دون حشو لإكمال العدد.`, '',
      'تجنب التكرار. استخدم عبارات واضحة ووسومًا متصلة تبدأ بـ # ولا تحتوي مسافات. لا تدّعِ أن وسمًا متداول أو متحقق منه دون بحث فعلي.',
      'اكتب عناوين الأقسام التالية كما هي، كل عنوان في سطر مستقل. ضع المصطلحات تحته مفصولة بفاصلة إنجليزية أو بسطر جديد، دون تعداد أو مقدمة أو جداول. لا تضع فاصلة داخل المصطلح الواحد.', '',
      ...wanted.flatMap(s => [s.key + ':', '(قائمة المصطلحات)', ''])
    ].join('\n');
  }
  function collectTerms(categories, selected, extra = '') {
    const all = [...categories.filter(c => selected.includes(c.id)).flatMap(c => c.terms), ...parseTerms(extra)];
    const terms = unique(all); return { terms, duplicates: all.length - terms.length, total: all.length };
  }
  const literal = term => {
    const text = String(term).replace(/["“”\\\r\n\u0000-\u001f\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (!text) throw Error('توجد عبارة فارغة بعد تنظيف علامات الاستعلام.');
    return validHashtag(text) ? text : '"' + text + '"';
  };
  function normalizeOptions(options = {}) {
    const result = { batchSize: Number(options.batchSize ?? 8), language: options.language || 'all', type: options.type || 'latest', since: options.since || '', until: options.until || '', account: (options.account || '').replace(/^@/, ''), exclude: options.exclude || '', noReplies: !!options.noReplies, noReposts: !!options.noReposts };
    if (!Number.isInteger(result.batchSize) || result.batchSize < 1 || result.batchSize > 20) throw Error('عدد عبارات الدفعة يجب أن يكون من 1 إلى 20.');
    if (!['all', 'ar', 'en'].includes(result.language) || !['latest', 'top', 'users', 'media'].includes(result.type)) throw Error('إعدادات البحث غير صالحة.');
    for (const name of ['since', 'until']) if (result[name] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[name]) || !Number.isFinite(Date.parse(result[name])) || new Date(result[name]).toISOString().slice(0, 10) !== result[name])) throw Error('أدخل تاريخًا صحيحًا.');
    if (result.since && result.until && result.since >= result.until) throw Error('تاريخ النهاية يجب أن يأتي بعد تاريخ البداية؛ يوم النهاية غير مشمول.');
    if (result.account && !/^[a-zA-Z0-9_]{1,15}$/.test(result.account)) throw Error('اسم حساب X يجب أن يحتوي أحرفًا إنجليزية أو أرقامًا أو شرطة سفلية، بحد أقصى 15 حرفًا.');
    if (typeof result.exclude !== 'string' || result.exclude.length > 1000) throw Error('قائمة الاستبعاد طويلة جدًا.');
    return result;
  }
  function searchUrl(query, type = 'latest') {
    const params = new URLSearchParams({ q: query, src: 'typed_query' });
    if (type !== 'top') params.set('f', { latest: 'live', users: 'user', media: 'media' }[type]);
    return 'https://x.com/search?' + params.toString();
  }
  function buildPlan(terms, rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const suffix = [options.language !== 'all' ? 'lang:' + options.language : '', options.account ? 'from:' + options.account : '', options.since ? 'since:' + options.since : '', options.until ? 'until:' + options.until : '', options.noReplies ? '-filter:replies' : '', options.noReposts ? '-filter:retweets' : '', ...parseTerms(options.exclude).map(t => '-' + literal(t))].filter(Boolean).join(' ');
    const makeQuery = batch => '(' + batch.map(literal).join(' OR ') + ')' + (suffix ? ' ' + suffix : '');
    const batches = []; let current = [];
    for (const term of unique(terms)) {
      const next = [...current, term], query = makeQuery(next);
      if (next.length > options.batchSize || query.length > 380 || searchUrl(query, options.type).length > 3500) {
        if (current.length) batches.push(current);
        current = [term];
        const single = makeQuery(current);
        if (single.length > 380 || searchUrl(single, options.type).length > 3500) throw Error('إحدى العبارات مع مرشحات البحث أطول من حد الدفعة. اختصرها أو قلّل الاستبعادات. لم تُحذف أي عبارة.');
      } else current = next;
    }
    if (current.length) batches.push(current);
    return { options, terms: unique(terms), batches: batches.map(batch => ({ terms: batch, query: makeQuery(batch), url: searchUrl(makeQuery(batch), options.type) })) };
  }
  const defaultDraft = () => ({ topic: '', context: '', exclude: '', language: 'both', mode: 'both', target: 'both', precision: 'high', count: '20', prompt: '', reply: '', groups: Object.fromEntries(SECTIONS.map(s => [s.key, { title: '', description: '', terms: '', include: true }])) });
  function validateDraft(d) {
    const base = defaultDraft(); if (!d || typeof d !== 'object') return base;
    for (const name of ['topic', 'context', 'exclude', 'language', 'mode', 'target', 'precision', 'count', 'prompt', 'reply']) if (typeof d[name] === 'string') base[name] = d[name].slice(0, name === 'reply' ? 150000 : name === 'prompt' ? 20000 : 10000);
    for (const s of SECTIONS) if (d.groups?.[s.key]) { const g = d.groups[s.key]; base.groups[s.key] = { title: typeof g.title === 'string' ? g.title.slice(0, 65) : '', description: typeof g.description === 'string' ? g.description.slice(0, 120) : '', terms: typeof g.terms === 'string' ? g.terms.slice(0, 150000) : '', include: g.include !== false }; }
    return base;
  }
  function validateState(state) {
    if (!state || typeof state !== 'object' || state.version !== 1) throw Error('نسخة بيانات Web غير مدعومة.');
    const categories = validateCategories(state.categories, true), ids = new Set(categories.map(c => c.id));
    const selected = Array.isArray(state.selected) ? [...new Set(state.selected.filter(x => ids.has(x)))] : [];
    const exportSelected = Array.isArray(state.exportSelected) ? [...new Set(state.exportSelected.filter(x => ids.has(x)))] : [];
    const options = normalizeOptions(state.options); let session = null;
    if (state.session) {
      if (!Array.isArray(state.session.terms) || state.session.terms.length > 100000 || state.session.terms.some(t => typeof t !== 'string' || t.length > 500)) throw Error('جولة البحث المحفوظة غير صالحة.');
      const plan = buildPlan(state.session.terms, state.session.options);
      if (!Number.isInteger(state.session.index) || state.session.index < 0 || state.session.index >= plan.batches.length) throw Error('موضع الجولة المحفوظة غير صالح.');
      session = { terms: plan.terms, options: plan.options, index: state.session.index, startedAt: typeof state.session.startedAt === 'string' ? state.session.startedAt : '' };
    }
    return { version: 1, categories, selected, exportSelected, options, extra: typeof state.extra === 'string' ? state.extra.slice(0, 150000) : '', draft: validateDraft(state.draft), session };
  }
  function categoryArchive(categories, selectedIds) {
    const wanted = selectedIds === undefined ? null : new Set(selectedIds);
    const selection = wanted ? categories.filter(c => wanted.has(c.id)) : categories;
    if (wanted && !selection.length) throw Error('حدّد بعض التصنيفات أو الكل لتصدير المكتبة.');
    const valid = validateCategories(selection);
    if (valid.some(c => c.terms.some(t => t.length > 120))) throw Error('للتوافق مع الإضافة، اختصر العبارات التي تتجاوز 120 حرفًا قبل تصدير التصنيفات. النسخة الكاملة تحفظها دون اختصار.');
    return { format: 'research-hunter-categories', version: 2, exportedAt: new Date().toISOString(), categories: valid };
  }
  function backupArchive(state) { const valid = validateState(state), { categories, ...settings } = valid; return { format: 'research-hunter-web-backup', version: 1, exportedAt: new Date().toISOString(), categories, state: settings }; }
  class StorageManager {
    constructor(storage, name = 'research-hunter-web.v1') { this.storage = storage; this.name = name; }
    read() {
      let primary, backup;
      try { primary = this.storage.getItem(this.name); backup = this.storage.getItem(this.name + '.previous'); }
      catch { return { state: null, warning: 'التخزين المحلي غير متاح. ستبقى التغييرات لهذه الجلسة؛ نزّل نسخة احتياطية.' }; }
      if (!primary && !backup) return { state: null, warning: '' };
      for (const [text, recovered] of [[primary, false], [backup, true]]) if (text) try { return { state: validateState(JSON.parse(text)), recovered, warning: recovered ? 'استُعيدت آخر نسخة سليمة بعد تعذر قراءة النسخة الحالية. نزّل نسخة احتياطية.' : '' }; } catch { /* Try the previous valid snapshot without overwriting damaged input. */ }
      return { state: null, blocked: true, warning: 'تعذرت قراءة البيانات المحفوظة. لن نستبدلها تلقائيًا. نزّل البيانات الخام للاستعادة أو استورد نسخة سليمة.' };
    }
    save(state) {
      try {
        const serialized = JSON.stringify(validateState(state));
        const old = this.storage.getItem(this.name);
        if (old === serialized) return { ok: true };
        if (old) try { validateState(JSON.parse(old)); this.storage.setItem(this.name + '.previous', old); } catch (e) { if (e?.name === 'QuotaExceededError') throw e; }
        this.storage.setItem(this.name, serialized); return { ok: true };
      } catch { return { ok: false, warning: 'تعذر حفظ التغييرات على هذا الجهاز. نزّل نسخة احتياطية قبل إغلاق الصفحة.' }; }
    }
    previous() { const value = this.storage.getItem(this.name + '.previous'); if (!value) throw Error('لا توجد نسخة محلية سابقة بعد.'); return validateState(JSON.parse(value)); }
    raw() { return { current: this.storage.getItem(this.name), previous: this.storage.getItem(this.name + '.previous') }; }
  }
  class XTab {
    constructor(open) { this.open = open; this.ref = null; }
    navigate(url) {
      if (!url.startsWith('https://x.com/search?')) throw Error('رابط البحث غير صالح.');
      try {
        if (this.ref && !this.ref.closed) { this.ref.location.href = url; this.ref.focus(); return true; }
      } catch { this.ref = null; }
      try {
        this.ref = this.open('about:blank', 'research-hunter-x');
        if (!this.ref) return false;
        this.ref.opener = null; this.ref.location.href = url; this.ref.focus(); return true;
      } catch { this.ref = null; return false; }
    }
  }
  return { LIMIT, MAX_FILE_BYTES, SECTIONS, key, unique, id, clone, parseTerms, validHashtag, validateCategory, validateCategories, parseArchive, mergeCategories, parseResponse, makePrompt, collectTerms, literal, normalizeOptions, searchUrl, buildPlan, defaultDraft, validateState, categoryArchive, backupArchive, StorageManager, XTab };
});
