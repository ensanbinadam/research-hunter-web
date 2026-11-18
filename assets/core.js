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
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  }
  function sourceUrl(value) {
    if (!value) return '';
    let url; try { url = new URL(value); } catch { throw Error('رابط الشاهد غير صالح.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2000) throw Error('استخدم رابط شاهد آمنًا يبدأ بـ https:// دون بيانات دخول.');
    return url.href;
  }
  function parseAccounts(value) {
    if (typeof value === 'string' && /\s+(?:OR|AND|NOT)\s+/i.test(value)) throw Error('اكتب أسماء الحسابات فقط وافصل بينها بفاصلة؛ لا تضف معاملات البحث.');
    const items = Array.isArray(value) ? value : String(value || '').split(/[\s,،;؛]+/u).filter(Boolean);
    if (items.some(item => typeof item !== 'string')) throw Error('أسماء الحسابات يجب أن تكون نصوصًا.');
    const handles = unique(items.map(item => item.trim().replace(/^@/, ''))).filter(Boolean);
    if (handles.length > 10 || handles.some(h => !/^[a-zA-Z0-9_]{1,15}$/.test(h))) throw Error('أدخل حتى 10 أسماء حسابات صحيحة، دون روابط أو أوامر بحث؛ الاسم حتى 15 حرفًا إنجليزيًا أو رقمًا أو شرطة سفلية.');
    return handles;
  }
  function normalizeAccountSources(value) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 30) throw Error('شواهد الحسابات غير صالحة.');
    const result = [];
    for (const a of value) {
      if (!a || typeof a.handle !== 'string') throw Error('بيانات الحساب غير صالحة.');
      const handle = parseAccounts([a.handle])[0]; if (!handle || result.some(x => key(x.handle) === key(handle))) continue;
      result.push({ handle, sourceUrl: sourceUrl(a.sourceUrl || ''), observedAt: validDate(a.observedAt) ? a.observedAt : '', note: String(a.note || '').slice(0, 1000) });
    }
    return result;
  }
  function normalizeReviews(value, terms) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 8000) throw Error('قائمة مراجعات المصطلحات غير صالحة.');
    const available = new Map(terms.map(t => [key(t), t])), seen = new Set(), result = [];
    for (const item of value) {
      if (!item || typeof item.term !== 'string' || !['candidate', 'reviewed', 'excluded'].includes(item.status || 'candidate')) throw Error('بيانات مراجعة المصطلح غير صالحة.');
      const k = key(item.term); if (!available.has(k) || seen.has(k)) continue;
      if (item.checkedAt && !validDate(item.checkedAt)) throw Error('تاريخ المراجعة غير صالح.');
      if (item.note != null && (typeof item.note !== 'string' || item.note.length > 1000)) throw Error('ملاحظة المراجعة يجب ألا تتجاوز 1000 حرف.');
      result.push({ term: available.get(k), status: item.status || 'candidate', sourceUrl: sourceUrl(item.sourceUrl || ''), checkedAt: item.checkedAt || '', note: item.note || '' }); seen.add(k);
    }
    return result;
  }
  function activeTerms(category) {
    const excluded = new Set((category.reviews || []).filter(r => r.status === 'excluded').map(r => key(r.term)));
    return category.terms.filter(t => !excluded.has(key(t)));
  }
  function inspectTerm(term) {
    const reasons = [];
    if (term.length > 120) reasons.push('أطول من حد التصدير للإضافة');
    if (term.startsWith('#') && !validHashtag(term)) reasons.push('صياغة هاشتاق غير صحيحة');
    if (/(?:^|\s)(?:from|to|since|until|lang|filter|is|min_faves|min_reposts):/i.test(term)) reasons.push('أمر بحث داخل عبارة؛ استخدم حقول قالب البحث');
    if (/https?:\/\//i.test(term)) reasons.push('رابط داخل عبارة؛ ضعه في حقل الشاهد');
    if (['أخبار', 'اخبار', 'تعليم', 'علوم', 'معلومات', 'news', 'education', 'information'].includes(key(term))) reasons.push('مصطلح واسع؛ راجع ملاءمته لهدفك');
    return reasons;
  }
  function qualityReport(category) {
    const reviews = new Map((category.reviews || []).map(r => [key(r.term), r]));
    const reviewed = category.terms.filter(t => reviews.get(key(t))?.status === 'reviewed').length;
    const excluded = category.terms.filter(t => reviews.get(key(t))?.status === 'excluded').length;
    return { total: category.terms.length, active: category.terms.length - excluded, reviewed, excluded, candidate: category.terms.length - excluded - reviewed, sourced: category.terms.filter(t => reviews.get(key(t))?.sourceUrl).length, alerts: category.terms.map(term => ({ term, reasons: inspectTerm(term) })).filter(item => item.reasons.length) };
  }
  function validateCategory(c) {
    if (!c || typeof c !== 'object' || typeof c.title !== 'string' || !c.title.trim() || c.title.length > 65) throw Error('اسم كل تصنيف مطلوب، وبحد أقصى 65 حرفًا.');
    if (!/^[a-z0-9-]{1,90}$/.test(c.id || '')) throw Error('معرّف التصنيف غير صالح.');
    if (!Array.isArray(c.terms) || !c.terms.length || c.terms.length > 2000 || c.terms.some(t => typeof t !== 'string' || !t.trim() || t.length > 500 || /[\r\n\u0000]/u.test(t))) throw Error('يجب أن يحتوي التصنيف من 1 إلى 2000 عبارة نصية، وبحد أقصى 500 حرف للعبارة.');
    if (c.description != null && (typeof c.description !== 'string' || c.description.length > 160)) throw Error('وصف التصنيف يجب ألا يتجاوز 160 حرفًا.');
    if (c.language != null && !['ar', 'en', 'mixed', 'both'].includes(c.language)) throw Error('لغة التصنيف غير صالحة.');
    if (c.symbol != null && (typeof c.symbol !== 'string' || c.symbol.length > 4)) throw Error('رمز التصنيف يجب ألا يتجاوز 4 أحرف.');
    const terms = unique(c.terms), reviews = normalizeReviews(c.reviews, terms);
    const accountSources = normalizeAccountSources(c.accountSources);
    return { id: c.id, title: c.title.trim(), description: c.description || c.title.trim(), symbol: c.symbol || 'ع', language: c.language === 'both' ? 'mixed' : c.language || 'mixed', terms, ...(reviews.length ? { reviews } : {}), ...(c.preset ? { preset: normalizeOptions(c.preset) } : {}), ...(accountSources.length ? { accountSources } : {}) };
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
    if (!data || !['research-hunter-categories', 'prompt-hunter-categories', 'research-hunter-web-backup', 'research-hunter-web-library'].includes(data.format)) throw Error('الملف ليس من ملفات الصياد المعتمدة.');
    const web = data.format.startsWith('research-hunter-web-');
    if (data.version !== (web ? 1 : 2)) throw Error('إصدار الملف غير مدعوم. استخدم تصنيفات الإصدار 2 أو ملفات Web الإصدار 1.');
    const categories = validateCategories(data.categories, web);
    return { format: data.format, categories, ...(data.format === 'research-hunter-web-backup' ? { state: validateState({ ...data.state, categories }) } : {}) };
  }
  function mergeCategories(base, incoming, mode = 'merge') {
    const categories = clone(validateCategories(base, true)); let merged = 0, duplicates = 0, renamed = 0;
    for (const raw of validateCategories(incoming, true)) {
      const c = clone(raw), existing = categories.find(e => key(e.title) === key(c.title) && (!e.language || !c.language || e.language === c.language));
      if (existing && mode === 'merge') {
        const all = [...existing.terms, ...c.terms]; existing.terms = unique(all); duplicates += all.length - existing.terms.length;
        const currentReviews = existing.reviews || [], reviewedKeys = new Set(currentReviews.map(r => key(r.term)));
        const reviews = [...currentReviews, ...(c.reviews || []).filter(r => !reviewedKeys.has(key(r.term)))];
        if (reviews.length) existing.reviews = normalizeReviews(reviews, existing.terms);
        if (!existing.preset && c.preset) existing.preset = clone(c.preset);
        if (c.accountSources?.length) existing.accountSources = normalizeAccountSources([...(existing.accountSources || []), ...c.accountSources].slice(0, 30));
        merged++; continue;
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
    if (String(text).length > 150000) throw Error('الإجابة طويلة جدًا؛ استخدم حتى 150 ألف حرف.');
    const jsonText = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    if (jsonText.startsWith('{')) return parseStructuredResponse(jsonText);
    const groups = Object.fromEntries(SECTIONS.map(s => [s.key, []])); let active = null, found = false, invalid = 0;
    for (const original of String(text).replace(/\r\n?/g, '\n').split('\n')) {
      const line = original.trim().replace(/^\*+|\*+$/g, '');
      if (/^```/.test(line) || !line) continue;
      const head = line.match(/^(?:#{1,6}\s*)?(?:\[)?(AR_PHRASES|AR_HASHTAGS|EN_PHRASES|EN_HASHTAGS)(?:\])?\s*[:：-]?\s*(.*)$/i);
      if (head) { active = head[1].toUpperCase(); found = true; if (head[2]) groups[active].push(head[2]); }
      else if (/^[A-Z][A-Z_]+\s*:/.test(line)) throw Error('قسم إضافي غير مدعوم في الإجابة النصية. استخدم صيغة JSON الجديدة للحسابات والشواهد، أو الأقسام الأربعة المعروفة فقط.');
      else if (active) groups[active].push(original);
    }
    if (!found) throw Error('لم نجد عناوين الأقسام. استخدم AR_PHRASES وAR_HASHTAGS وEN_PHRASES وEN_HASHTAGS، أو حرّر المجموعات يدويًا.');
    const result = Object.fromEntries(SECTIONS.map(s => [s.key, []]));
    for (const section of SECTIONS) for (const term of parseTerms(groups[section.key].join('\n'))) {
      if (term.startsWith('#') && !validHashtag(term)) { invalid++; continue; }
      result[section.language.toUpperCase() + (term.startsWith('#') ? '_HASHTAGS' : '_PHRASES')].push(term);
    }
    for (const s of SECTIONS) result[s.key] = unique(result[s.key]);
    return { groups: result, invalid, evidence: [], accounts: [], exclusions: [] };
  }
  function parseStructuredResponse(text) {
    let data; try { data = JSON.parse(text); } catch { throw Error('إجابة JSON غير صالحة. اطلب من أداة الذكاء تصحيحها دون تغيير المحتوى.'); }
    if (data.format !== 'research-hunter-draft' || data.version !== 1 || !data.groups || typeof data.groups !== 'object') throw Error('استخدم بنية research-hunter-draft الإصدار 1 كما في البرومبت.');
    const unexpected = Object.keys(data.groups).filter(name => !SECTIONS.some(s => s.key === name));
    if (unexpected.length) throw Error('مجموعات غير مدعومة في JSON: ' + unexpected.join('، ') + '. استخدم الأقسام الأربعة فقط، والحسابات والاستبعادات في حقولها المخصصة.');
    const groups = Object.fromEntries(SECTIONS.map(s => [s.key, []])), evidence = []; let invalid = 0;
    const safeSource = value => { try { return sourceUrl(value || ''); } catch { invalid++; return ''; } };
    for (const s of SECTIONS) {
      const items = data.groups[s.key] || [];
      if (!Array.isArray(items) || items.length > 2000) throw Error('كل مجموعة في الإجابة يجب أن تكون قائمة، حتى 2000 مصطلح.');
      for (const raw of items) {
        const item = typeof raw === 'string' ? { term: raw } : raw;
        if (!item || typeof item.term !== 'string' || item.term.length > 500 || /[\r\n\u0000]/u.test(item.term)) throw Error('مصطلح غير صالح في الإجابة.');
        const term = item.term.trim(); if (!term) continue;
        if (/[,،;؛]/u.test(term)) throw Error('مصطلح في JSON يحتوي فاصلة داخلية. اطلب إعادة صياغته دون فاصلة حتى لا ينقسم عند تحريره.');
        if (term.startsWith('#') && !validHashtag(term)) { invalid++; continue; }
        const section = s.language.toUpperCase() + (term.startsWith('#') ? '_HASHTAGS' : '_PHRASES'); groups[section].push(term);
        const url = safeSource(item.sourceUrl);
        if (url || item.note || item.observedAt) evidence.push({ term, status: 'candidate', sourceUrl: url, checkedAt: validDate(item.observedAt) ? item.observedAt : '', note: String(item.note || '').slice(0, 1000) });
      }
    }
    for (const s of SECTIONS) groups[s.key] = unique(groups[s.key]);
    if (!Object.values(groups).some(items => items.length)) throw Error('الإجابة لا تحتوي مصطلحات قابلة للاستخدام.');
    const accounts = [];
    if (data.accounts != null && (!Array.isArray(data.accounts) || data.accounts.length > 30)) throw Error('قائمة الحسابات المقترحة غير صالحة.');
    for (const item of data.accounts || []) {
      if (!item || typeof item.handle !== 'string') { invalid++; continue; }
      let handle; try { handle = parseAccounts([item.handle])[0]; } catch { invalid++; continue; }
      if (!handle || accounts.some(a => key(a.handle) === key(handle))) continue;
      accounts.push({ handle, sourceUrl: safeSource(item.sourceUrl), observedAt: validDate(item.observedAt) ? item.observedAt : '', note: String(item.note || '').slice(0, 1000) });
    }
    if (data.exclusions != null && (!Array.isArray(data.exclusions) || data.exclusions.some(t => typeof t !== 'string' || t.length > 120) || data.exclusions.length > 30)) throw Error('قائمة الاستبعادات المقترحة غير صالحة.');
    return { groups, evidence, accounts, exclusions: unique(data.exclusions || []), invalid };
  }
  function makePrompt(draft) {
    if (!draft.topic?.trim()) throw Error('اكتب موضوع البحث أولًا.');
    const wanted = SECTIONS.filter(s => (draft.language === 'both' || s.language === draft.language) && (draft.mode === 'both' || (draft.mode === 'hashtags') === s.hashtag));
    const example = { format: 'research-hunter-draft', version: 1, groups: Object.fromEntries(wanted.map(s => [s.key, [{ term: s.hashtag ? '#وسم_متخصص' : 'مصطلح متخصص', sourceUrl: '', observedAt: '', note: '' }]])), accounts: [], exclusions: [] };
    return [
      'أنت خبير في إعداد قوائم بحث دقيقة لمنصة X (تويتر)، ومهمتك توليد مصطلحات لأداة الصياد الباحث.',
      `الموضوع: ${draft.topic.trim()}`,
      `الهدف: ${{ posts: 'منشورات ذات صلة مباشرة', accounts: 'حسابات متخصصة تنشر بانتظام', both: 'حسابات ومنشورات متخصصة' }[draft.target] || 'منشورات متخصصة'}.`,
      `التفاصيل: ${draft.context?.trim() || 'لا توجد.'}`,
      `النطاق الجغرافي أو المهني: ${draft.scope?.trim() || 'حدده من السياق؛ لا تفترض نطاقًا غير مذكور.'}`,
      `الفترة المقصودة: ${draft.timeframe?.trim() || 'لم تُحدد؛ لا تدّعِ حداثة المعلومات دون تحقق.'}`,
      `موضوعات يجب تجنبها: ${draft.exclude?.trim() || 'لا توجد.'}`,
      `مستوى الدقة: ${{ high: 'دقيقة ومحددة؛ تجنب الكلمات العامة والملتبسة', balanced: 'متوازنة بين الدقة والشمول', wide: 'واسعة مع الالتزام بالموضوع' }[draft.precision] || 'متوازنة'}.`,
      `اقترح نحو ${Math.max(5, Math.min(100, Number(draft.count) || 20))} مصطلحًا لكل قسم، دون حشو لإكمال العدد.`, '',
      'اختبر صلة كل مصطلح بهدف البحث: تجنب الكلمات العامة والموضوعات المجاورة التي تجلب ضجيجًا. فضّل التسميات المتخصصة والاختصارات وتنويعات الكتابة المستخدمة فعلًا؛ لا تخترع تنويعات لمجرد زيادة العدد.',
      'افصل العبارات عن الوسوم. الهاشتاق يبدأ بـ # ولا يحتوي مسافات. لا تضع أوامر from: أو since: أو filter: أو روابط داخل term؛ تُبنى المرشحات في الموقع بصورة مستقلة.',
      'إذا كانت لديك قدرة بحث، ابحث عن شواهد مباشرة ذات صلة وسجّل رابط الشاهد وتاريخ الاطلاع YYYY-MM-DD في observedAt. إذا لم تبحث أو لم تجد دليلًا فاترك sourceUrl وobservedAt فارغين. لا تختلق مصدرًا أو حسابًا، ولا تدّعِ الرواج من مجرد وجود منشور واحد.',
      'الحسابات اختيارية: أضف فقط حسابًا أمكن التحقق من هويته وصلته بالموضوع، مع sourceUrl يثبت ذلك وسبب الصلة في note. لا تستخدم عدد المتابعين أو شارة التوثيق وحدهما للحكم على المصداقية. إن لم تتحقق فأعد accounts قائمة فارغة.',
      'كل عنصر في accounts يستخدم الحقول handle (اسم الحساب دون @)، sourceUrl (رابط الشاهد)، observedAt (تاريخ الاطلاع)، note (سبب الصلة). exclusions قائمة نصوص. لا تضع فاصلة داخل term الواحد لأن الفواصل تفصل المصطلحات عند تحريرها.',
      'اجعل exclusions اقتراحات لاستبعاد مصادر الضجيج فقط، دون استبعاد وجهات نظر مرتبطة بالبحث تلقائيًا. لا تكرر استبعادات تخرج الموضوع المقصود كله.',
      'أعد كائن JSON صالحًا واحدًا فقط بالبنية التالية. لا تضف مقدمات أو أقسامًا أخرى. استبدل المثال بمصطلحات فعلية، ولا تعِد الكلمات التوضيحية. جميع المصطلحات تظل مقترحات تحتاج مراجعة المستخدم مهما كانت الشواهد.',
      JSON.stringify(example, null, 2)
    ].join('\n');
  }
  function collectTerms(categories, selected, extra = '') {
    const chosen = categories.filter(c => selected.includes(c.id)), all = [...chosen.flatMap(activeTerms), ...parseTerms(extra)];
    const terms = unique(all); return { terms, duplicates: all.length - terms.length, total: all.length, excluded: chosen.reduce((sum, c) => sum + c.terms.length - activeTerms(c).length, 0) };
  }
  const literal = term => {
    const text = String(term).replace(/["“”\\\r\n\u0000-\u001f\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (!text) throw Error('توجد عبارة فارغة بعد تنظيف علامات الاستعلام.');
    return validHashtag(text) ? text : '"' + text + '"';
  };
  function normalizeOptions(options = {}) {
    if (options.accounts == null && options.account && (typeof options.account !== 'string' || !/^@?[a-zA-Z0-9_]{1,15}$/.test(options.account))) throw Error('اسم حساب X غير صالح. استخدم حقل الحسابات لإضافة عدة أسماء.');
    const accounts = parseAccounts(options.accounts ?? options.account ?? '');
    const result = { batchSize: Number(options.batchSize ?? 8), language: options.language || 'all', type: options.type || 'latest', since: options.since || '', until: options.until || '', accounts, account: accounts.length === 1 ? accounts[0] : '', exclude: options.exclude || '', required: options.required || '', match: options.match || 'exact', noReplies: !!options.noReplies, noReposts: !!options.noReposts };
    if (!Number.isInteger(result.batchSize) || result.batchSize < 1 || result.batchSize > 20) throw Error('عدد عبارات الدفعة يجب أن يكون من 1 إلى 20.');
    if (!['all', 'ar', 'en'].includes(result.language) || !['latest', 'top', 'users', 'media'].includes(result.type)) throw Error('إعدادات البحث غير صالحة.');
    for (const name of ['since', 'until']) if (result[name] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[name]) || !Number.isFinite(Date.parse(result[name])) || new Date(result[name]).toISOString().slice(0, 10) !== result[name])) throw Error('أدخل تاريخًا صحيحًا.');
    if (result.since && result.until && result.since >= result.until) throw Error('تاريخ النهاية يجب أن يأتي بعد تاريخ البداية؛ يوم النهاية غير مشمول.');
    if (typeof result.exclude !== 'string' || result.exclude.length > 1000) throw Error('قائمة الاستبعاد طويلة جدًا.');
    if (typeof result.required !== 'string' || result.required.length > 500 || !['exact', 'words'].includes(result.match)) throw Error('إعدادات مطابقة العبارات أو الكلمات المطلوبة غير صالحة.');
    return result;
  }
  function searchUrl(query, type = 'latest') {
    const params = new URLSearchParams({ q: query, src: 'typed_query' });
    if (type !== 'top') params.set('f', { latest: 'live', users: 'user', media: 'media' }[type]);
    return 'https://x.com/search?' + params.toString();
  }
  function buildPlan(terms, rawOptions = {}) {
    const options = normalizeOptions(rawOptions);
    const accountQuery = options.accounts.map(h => 'from:' + h).join(' OR ');
    const suffix = [options.language !== 'all' ? 'lang:' + options.language : '', options.accounts.length > 1 ? '(' + accountQuery + ')' : accountQuery, options.since ? 'since:' + options.since : '', options.until ? 'until:' + options.until : '', options.noReplies ? '-filter:replies' : '', options.noReposts ? '-filter:retweets' : '', ...parseTerms(options.required).map(literal), ...parseTerms(options.exclude).map(t => '-' + literal(t))].filter(Boolean).join(' ');
    const phrase = term => options.match === 'words' && !validHashtag(term) ? '(' + String(term).trim().split(/\s+/u).map(literal).join(' ') + ')' : literal(term);
    const makeQuery = batch => '(' + batch.map(phrase).join(' OR ') + ')' + (suffix ? ' ' + suffix : '');
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
  const defaultDraft = () => ({ topic: '', context: '', scope: '', timeframe: '', exclude: '', language: 'both', mode: 'both', target: 'both', precision: 'high', count: '20', prompt: '', reply: '', evidence: [], accounts: [], exclusions: [], selectedAccounts: [], useExclusions: false, groups: Object.fromEntries(SECTIONS.map(s => [s.key, { title: '', description: '', terms: '', include: true }])) });
  function validateDraft(d) {
    const base = defaultDraft(); if (!d || typeof d !== 'object') return base;
    for (const name of ['topic', 'context', 'scope', 'timeframe', 'exclude', 'language', 'mode', 'target', 'precision', 'count', 'prompt', 'reply']) if (typeof d[name] === 'string') base[name] = d[name].slice(0, name === 'reply' ? 150000 : name === 'prompt' ? 20000 : 10000);
    for (const s of SECTIONS) if (d.groups?.[s.key]) { const g = d.groups[s.key]; base.groups[s.key] = { title: typeof g.title === 'string' ? g.title.slice(0, 65) : '', description: typeof g.description === 'string' ? g.description.slice(0, 120) : '', terms: typeof g.terms === 'string' ? g.terms.slice(0, 150000) : '', include: g.include !== false }; }
    const terms = SECTIONS.flatMap(s => parseTerms(base.groups[s.key].terms));
    base.evidence = normalizeReviews(d.evidence, terms);
    base.accounts = normalizeAccountSources(d.accounts);
    base.selectedAccounts = Array.isArray(d.selectedAccounts) ? unique(d.selectedAccounts.filter(h => base.accounts.some(a => a.handle === h))).slice(0, 10) : [];
    base.exclusions = Array.isArray(d.exclusions) ? unique(d.exclusions.filter(t => typeof t === 'string' && t.length <= 120)).slice(0, 30) : [];
    base.useExclusions = !!d.useExclusions;
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
    if (state.samples != null && (!Array.isArray(state.samples) || state.samples.length > 100)) throw Error('سجل مراجعات النتائج يجب ألا يتجاوز 100 عينة.');
    const samples = Array.isArray(state.samples) ? state.samples.map(validateSample) : [];
    return { version: 1, categories, selected, exportSelected, options, extra: typeof state.extra === 'string' ? state.extra.slice(0, 150000) : '', draft: validateDraft(state.draft), session, samples };
  }
  function categoryArchive(categories, selectedIds) {
    const wanted = selectedIds === undefined ? null : new Set(selectedIds);
    const selection = wanted ? categories.filter(c => wanted.has(c.id)) : categories;
    if (wanted && !selection.length) throw Error('حدّد بعض التصنيفات أو الكل لتصدير المكتبة.');
    const valid = validateCategories(selection).map(c => {
      const terms = activeTerms(c); if (!terms.length) throw Error(`تصنيف «${c.title}» لا يحتوي عبارات فعّالة للتصدير. راجع المستبعدات أولًا.`);
      const { reviews, preset, accountSources, ...legacy } = c; return { ...legacy, terms };
    });
    if (valid.some(c => c.terms.some(t => t.length > 120))) throw Error('للتوافق مع الإضافة، اختصر العبارات التي تتجاوز 120 حرفًا قبل تصدير التصنيفات. النسخة الكاملة تحفظها دون اختصار.');
    return { format: 'research-hunter-categories', version: 2, exportedAt: new Date().toISOString(), categories: valid };
  }
  function backupArchive(state) { const valid = validateState(state), { categories, ...settings } = valid; return { format: 'research-hunter-web-backup', version: 1, exportedAt: new Date().toISOString(), categories, state: settings }; }
  function webLibraryArchive(categories, selectedIds) {
    const chosen = categories.filter(c => selectedIds.includes(c.id));
    if (!chosen.length) throw Error('حدّد بعض التصنيفات أو الكل لتصدير المكتبة.');
    return { format: 'research-hunter-web-library', version: 1, exportedAt: new Date().toISOString(), categories: validateCategories(chosen) };
  }
  function validateSample(sample) {
    if (!sample || !Number.isInteger(sample.reviewed) || sample.reviewed < 1 || sample.reviewed > 10000 || !Number.isInteger(sample.relevant) || sample.relevant < 0 || sample.relevant > sample.reviewed) throw Error('أدخل عدد المنشورات التي راجعتها وعدد الملائم منها؛ الملائم لا يتجاوز العدد الكلي للعينة.');
    if (typeof sample.label !== 'string' || !sample.label.trim() || sample.label.length > 65 || typeof sample.query !== 'string' || sample.query.length > 2000) throw Error('اسم تجربة المراجعة أو الاستعلام غير صالح.');
    if (sample.recordedAt != null && (typeof sample.recordedAt !== 'string' || !Number.isFinite(Date.parse(sample.recordedAt)))) throw Error('تاريخ سجل المراجعة غير صالح.');
    return { id: typeof sample.id === 'string' ? sample.id.slice(0, 90) : id(), label: sample.label.trim(), reviewed: sample.reviewed, relevant: sample.relevant, query: sample.query, type: ['top', 'latest', 'users', 'media'].includes(sample.type) ? sample.type : 'latest', recordedAt: sample.recordedAt ? new Date(sample.recordedAt).toISOString() : new Date().toISOString(), note: String(sample.note || '').slice(0, 1000) };
  }
  function csvCell(value) {
    let text = String(value ?? ''); if (/^[\s]*[=+\-@]/u.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function planCSV(plan) {
    return '\ufeff' + [['الدفعة', 'الاستعلام', 'الرابط', 'عدد العبارات'], ...plan.batches.map((b, i) => [i + 1, b.query, b.url, b.terms.length])].map(row => row.map(csvCell).join(',')).join('\r\n');
  }
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
  function openSearchTab(open, url) {
    if (typeof url !== 'string' || !url.startsWith('https://x.com/search?')) throw Error('رابط البحث غير صالح.');
    let ref;
    try { ref = open(url, '_blank'); } catch { return false; }
    if (!ref) return false;
    // Navigate in window.open itself. X may isolate the returned window immediately.
    // Never read or write its location, closed state, or focus after opening it.
    try { ref.opener = null; } catch { /* A severed COOP reference is already isolated. */ }
    return true;
  }
  class XTab {
    constructor(open) { this.open = open; }
    navigate(url) { return openSearchTab(this.open, url); }
  }
  class XBatchTabs {
    constructor(open) { this.open = open; this.opened = new Set(); }
    progress(urls) {
      const all = [...new Set(urls)];
      if (all.some(url => typeof url !== 'string' || !url.startsWith('https://x.com/search?'))) throw Error('رابط البحث غير صالح.');
      const pendingUrls = all.filter(url => !this.opened.has(url));
      return { total: all.length, opened: all.length - pendingUrls.length, pendingUrls };
    }
    openAll(urls) {
      const before = this.progress(urls); let openedNow = 0, blocked = false;
      // Keep every open in the original click. Timers lose browser user activation.
      for (const url of before.pendingUrls) {
        if (!openSearchTab(this.open, url)) { blocked = true; break; }
        this.opened.add(url); openedNow++;
      }
      // Count windows opened, not results loaded or read. X may sever window references.
      return { ...this.progress(urls), openedNow, blocked };
    }
  }
  return { LIMIT, MAX_FILE_BYTES, SECTIONS, key, unique, id, clone, parseTerms, validHashtag, validDate, sourceUrl, parseAccounts, normalizeAccountSources, normalizeReviews, activeTerms, inspectTerm, qualityReport, validateCategory, validateCategories, parseArchive, mergeCategories, parseResponse, makePrompt, collectTerms, literal, normalizeOptions, searchUrl, buildPlan, defaultDraft, validateState, categoryArchive, webLibraryArchive, backupArchive, validateSample, csvCell, planCSV, StorageManager, XTab, XBatchTabs };
});
