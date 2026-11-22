(function () {
  'use strict';
  const C = window.HunterCore, $ = id => document.getElementById(id);
  const node = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text != null) e.textContent = text; return e; };
  const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.setAttribute('aria-hidden', 'true'); svg.append(use); return svg; };
  const langLabel = lang => ({ ar: 'العربية', en: 'الإنجليزية', both: 'لغتان', mixed: 'لغتان' }[lang] || 'غير محددة');
  const storage = new C.StorageManager({ getItem: k => window.localStorage.getItem(k), setItem: (k, v) => window.localStorage.setItem(k, v) });
  const seed = window.HunterDefaults;
  const freshState = () => ({ version: 1, categories: C.clone(seed), selected: seed.slice(0, 2).map(c => c.id), exportSelected: [], options: C.normalizeOptions(), extra: '', draft: C.defaultDraft(), session: null, savedSessions: [], samples: [] });
  const loaded = storage.read(); let state = loaded.state || freshState(), writeBlocked = !!loaded.blocked, saveTimer, toastTimer, editingId = null, pendingConfirm = null, confirmToken = 0, stagedFiles = [], importResult = null, importBusy = false;
  const xTab = new C.XTab(window.open.bind(window));
  let researchUI = null, planTimer, sessionPlanSource = null, sessionPlan = null, renderedSession = null, renderedIndex = -1, renderedOpenedKey = '', resumedSessionName = '';
  let lastValidOptions = C.normalizeOptions(state.options);
  const dialogOpeners = new Map();
  function toast(message) { $('toastAnnouncement').textContent = message; $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
  function warn(message) { $('storageAnnouncement').textContent = message; $('storageWarning').textContent = message; $('storageWarning').hidden = !message; }
  function renderStorageUsage() {
    const el = $('storageUsage'); if (!el) return;
    try {
      const raw = storage.raw(), encoder = new TextEncoder();
      const bytes = [raw.current, raw.previous, raw.recovery].filter(Boolean).reduce((sum, text) => sum + encoder.encode(text).length, 0);
      const kb = (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0);
      let recoveryNote = '';
      if (raw.recovery) { try { const count = JSON.parse(raw.recovery).length; if (count) recoveryNote = ` · سجل استعادة (${count})`; } catch { recoveryNote = ' · سجل استعادة موجود'; } }
      el.textContent = `المساحة المحلية المستخدمة تقريبًا: ${kb} كيلوبايت${raw.previous ? ' (تشمل اللقطة السابقة)' : ''}${recoveryNote}`;
    } catch { el.textContent = 'تعذر قياس مساحة التخزين المحلي.'; }
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (writeBlocked) { $('saveStatus').classList.add('failed'); $('saveStatus').lastElementChild.textContent = 'الحفظ متوقف · نزّل نسخة'; return false; }
    let snapshot = state;
    try { lastValidOptions = C.normalizeOptions(state.options); } catch { snapshot = { ...state, options: lastValidOptions }; }
    const result = storage.save(snapshot); $('saveStatus').classList.toggle('failed', !result.ok); $('saveStatus').lastElementChild.textContent = result.ok ? snapshot === state ? 'محفوظ على الجهاز' : 'المكتبة محفوظة · راجع المرشحات' : 'لم يُحفظ · نزّل نسخة';
    if (result.warning) warn(result.warning); renderStorageUsage(); return result.ok;
  }
  function scheduleSave() { clearTimeout(saveTimer); $('saveStatus').lastElementChild.textContent = writeBlocked ? 'الحفظ متوقف' : 'جارٍ الحفظ…'; saveTimer = setTimeout(saveNow, 450); }
  function changed(message) { renderLibrary(); renderChoices(); renderOverview(); renderPlan(); scheduleSave(); if (message) toast(message); }
  function showDialog(id) { dialogOpeners.set(id, document.activeElement); $(id).showModal(); document.body.classList.add('dialog-open'); }
  function closeDialog(id, force = false) {
    if (!force && id === 'reviewDialog' && researchUI?.confirmCloseReview?.()) return;
    $(id).close(); if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
  }
  function confirmAction(title, text, action, details = '') { $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('restoreDetails').textContent = details; $('restoreDetails').hidden = !details; pendingConfirm = { token: ++confirmToken, action }; showDialog('confirmDialog'); }
  function download(data, filename) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000); }
  const dateStamp = () => new Date().toISOString().slice(0, 10);
  function backupForDownload() {
    let raw = null;
    try { const stored = storage.raw(); raw = writeBlocked ? stored : stored.recovery ? { recovery: stored.recovery } : null; }
    catch { if (writeBlocked) throw Error('تعذرت قراءة أصل البيانات؛ لم نستبدل المكتبة.'); }
    return C.safetyBackup(state, lastValidOptions, raw);
  }
  function exportBackup() { try { saveNow(); download(backupForDownload(), `research-hunter-web-backup-${dateStamp()}.json`); toast('أُعدّت نسخة Web كاملة للتنزيل.'); } catch (e) { toast(e.message); } }
  function exportCategories() {
    try { const archive = C.categoryArchive(state.categories, state.exportSelected); download(archive, 'research-hunter-categories.json'); toast(`أُعدّ ${archive.categories.length} تصنيفًا بعباراته الفعّالة للإضافة. استخدم تصدير Web لحفظ المراجعات والقوالب.`); }
    catch (e) { toast(e.message); if (!state.exportSelected.length) { location.hash = 'library'; route(); $('selectAllForExport').focus(); } }
  }
  async function copy(text) {
    if (!text.trim()) return toast('لا يوجد نص لنسخه بعد.');
    try { await navigator.clipboard.writeText(text); toast('تم نسخ النص.'); }
    catch { const t = node('textarea', 'clipboard-fallback'); t.value = text; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); toast(ok ? 'تم نسخ النص.' : 'تعذر النسخ التلقائي. حدّد النص وانسخه يدويًا.'); }
  }
  function route() {
    const view = ['search', 'library', 'generator', 'backup'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'search';
    for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== 'view-' + view;
    for (const link of document.querySelectorAll('[data-view]')) { const active = link.dataset.view === view; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
    $('pageCrumb').textContent = { search: 'مساحة البحث', library: 'مكتبة التصنيفات', generator: 'مولّد التصنيفات', backup: 'النسخ الاحتياطي' }[view];
    document.title = $('pageCrumb').textContent + ' | الصياد الباحث Web';
    if (view === 'backup') renderStorageUsage();
  }
  function renderOverview() {
    $('statCategories').textContent = state.categories.length; $('navCount').textContent = state.categories.length;
    $('statTerms').textContent = C.unique(state.categories.flatMap(C.activeTerms)).length;
    $('selectedCount').textContent = state.selected.length + ' محدد';
  }
  function filteredCategories(filter) { const k = C.key(filter); return state.categories.filter(c => C.key([c.title, c.description, ...c.terms].join(' ')).includes(k)); }
  function renderChoices() {
    const list = $('categoryChoices'); list.replaceChildren(); const visible = filteredCategories($('categoryFilter').value);
    for (const c of visible) {
      const selected = state.selected.includes(c.id), label = node('label', 'category-choice' + (selected ? ' selected' : '')), head = node('div', 'choice-head'), check = node('input'); check.type = 'checkbox'; check.checked = selected; check.setAttribute('aria-label', c.title); check.dataset.categoryId = c.id;
      head.append(node('span', 'category-symbol', c.symbol), check); const title = node('strong', '', c.title); title.dir = 'auto'; const desc = node('span', 'description', c.description); desc.dir = 'auto';
      const meta = node('span', 'choice-meta'), count = node('span'); count.append(node('i'), document.createTextNode(C.activeTerms(c).length + ' عبارة فعّالة')); meta.append(count, node('span', '', langLabel(c.language))); label.append(head, title, desc, meta);
      check.addEventListener('change', () => { state.selected = check.checked ? [...state.selected, c.id] : state.selected.filter(x => x !== c.id); label.classList.toggle('selected', check.checked); renderOverview(); renderPlan(); scheduleSave(); }); list.append(label);
    }
    if (!visible.length) { const empty = node('div', 'empty-state'); empty.append(node('h3', '', state.categories.length ? 'لم نجد تصنيفًا بهذا البحث' : 'ابدأ مكتبتك الأولى'), node('p', '', state.categories.length ? 'جرّب اسمًا أو عبارة أخرى.' : 'أضف تصنيفًا أو استورد ملف JSON من مكتبة التصنيفات.')); list.append(empty); }
  }
  const searchFields = { resultType: 'type', searchLanguage: 'language', batchSize: 'batchSize', since: 'since', until: 'until', account: 'accounts', searchExclude: 'exclude', requiredTerms: 'required', matchMode: 'match', noReplies: 'noReplies', noReposts: 'noReposts' };
  function syncSearchFields() { for (const [field, name] of Object.entries(searchFields)) { if ($(field).type === 'checkbox') $(field).checked = state.options[name]; else $(field).value = Array.isArray(state.options[name]) ? state.options[name].join(', ') : state.options[name]; } $('extraTerms').value = state.extra; }
  function renderFilterIndicators() {
    const activeCount = C.countActiveFilters(state.options, state.extra);
    const badge = $('activeFiltersBadge');
    badge.textContent = activeCount === 1 ? '1 مفعّل' : `${activeCount} مفعّلة`;
    badge.hidden = !activeCount;
    const isDefault = !activeCount && state.options.type === 'latest' && state.options.language === 'all' && Number(state.options.batchSize) === 8;
    $('resetFilters').disabled = isDefault;
  }
  function planned() { const collected = C.collectTerms(state.categories, state.selected, state.extra); return { ...C.buildPlan(collected.terms, state.options), duplicates: collected.duplicates }; }
  function renderPlan() {
    clearTimeout(planTimer); let plan = null;
    const listsMode = state.options.type === 'lists';
    for (const [field, name] of Object.entries(searchFields)) if (name !== 'type') $(field).disabled = listsMode;
    $('listsSearchHint').hidden = !listsMode;
    renderFilterIndicators();
    try { plan = planned(); $('planTerms').textContent = plan.terms.length; $('planBatches').textContent = plan.batches.length; $('planDuplicates').textContent = plan.duplicates; $('planError').hidden = true; $('startSearch').disabled = !plan.terms.length; }
    catch (e) { const terms = C.collectTerms(state.categories, state.selected, state.extra); $('planTerms').textContent = terms.terms.length; $('planDuplicates').textContent = terms.duplicates; $('planBatches').textContent = '—'; $('planError').textContent = e.message; $('planError').hidden = false; $('startSearch').disabled = true; }
    $('startSearch').querySelector('span').textContent = state.session ? 'تجهيز جولات جديدة' : 'تجهيز جولات البحث'; renderSession(plan); researchUI?.refresh(plan);
  }
  function schedulePlan() { clearTimeout(planTimer); renderFilterIndicators(); planTimer = setTimeout(renderPlan, 200); }
  function savedPlan() { if (sessionPlanSource !== state.session) { sessionPlan = state.session ? C.buildPlan(state.session.terms, state.session.options) : null; sessionPlanSource = state.session; } return sessionPlan; }
  function sessionOptionsSummary(opts) {
    if (opts.type === 'lists') return 'بحث عن قوائم · عبارة واحدة لكل جولة';
    const parts = [];
    if (opts.language && opts.language !== 'all') parts.push('اللغة: ' + langLabel(opts.language));
    if (opts.accounts?.length) parts.push(`${opts.accounts.length} حساب`);
    if (opts.since || opts.until) parts.push(`${opts.since || '…'} إلى ${opts.until || '…'}`);
    if (opts.match === 'words') parts.push('مطابقة الكلمات');
    if (opts.noReplies) parts.push('بلا ردود');
    if (opts.noReposts) parts.push('بلا إعادة نشر');
    return parts.join(' · ');
  }
  function renderSession(currentPlan = null) {
    const session = state.session; $('activeSession').hidden = !session;
    $('sessionCaption').textContent = session ? (resumedSessionName ? `تعمل على: ${resumedSessionName}` : 'جولتك محفوظة؛ تابع من حيث توقفت') : 'جاهز للاكتشاف؟';
    if (!session) { renderedSession = null; renderedIndex = -1; renderedOpenedKey = ''; return; }
    const plan = savedPlan();
    const filterSummary = sessionOptionsSummary(plan.options);
    $('sessionContextMeta').textContent = `${resumedSessionName ? `جلسة مستأنفة «${resumedSessionName}»` : 'الجلسة الحالية'}: ${plan.terms.length} عبارة · ${plan.batches.length} دفعات${filterSummary ? ' · ' + filterSummary : ''}`;
    const stale = !!(currentPlan && C.isSessionStale(session, currentPlan));
    $('sessionStaleNotice').hidden = !stale;
    if (stale) {
      $('sessionStaleNotice').textContent = `الجدول يعرض الجلسة ${resumedSessionName ? `المستأنفة «${resumedSessionName}»` : 'المجهّزة'} كما حُفظت (${plan.terms.length} عبارة · ${plan.batches.length} دفعات)، بينما اختياراتك الحالية أعلى الصفحة تُنتج (${currentPlan.terms.length} عبارة · ${currentPlan.batches.length} دفعات). اضغط «تجهيز جولات جديدة» لتحديث الجدول باختياراتك الحالية.`;
    }
    $('applySessionFilters').hidden = !(currentPlan && JSON.stringify(session.options) !== JSON.stringify(currentPlan.options));
    $('roundTable').classList.toggle('show-terms', $('showRoundTerms').checked);
    const openedKey = (session.opened || []).join(',');
    if (renderedSession === session) { if (renderedIndex !== session.index || renderedOpenedKey !== openedKey) renderSessionPosition(plan); return; }
    const rows = $('roundRows'); rows.replaceChildren();
    for (const [index, batch] of plan.batches.entries()) {
      const row = node('tr'), number = node('th'), content = node('td', 'round-content'), action = node('td');
      row.dataset.roundIndex = index; number.scope = 'row';
      const openedMark = node('span', 'opened-badge', 'فُتحت'); openedMark.hidden = true;
      number.append(node('bdi', 'round-number', index + 1), node('small', 'round-term-count', batch.terms.length + ' عبارة'), openedMark);
      for (const term of batch.terms) content.append(node('bdi', 'round-term', term));
      const link = node('a', 'round-open', 'فتح'); link.href = batch.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `فتح الجولة ${index + 1} في تبويب جديد`);
      // Leave native navigation and Ctrl/Meta/middle-click behavior entirely to the browser.
      link.addEventListener('click', () => selectBatch(index, true));
      link.addEventListener('auxclick', event => { if (event.button === 1) selectBatch(index, true); });
      action.append(link); row.append(number, content, action); rows.append(row);
    }
    renderedSession = session; renderSessionPosition(plan);
  }
  function renderSessionPosition(plan) {
    const session = state.session, batch = plan.batches[session.index], opened = session.opened || [], openedSet = new Set(opened);
    renderedIndex = session.index; renderedOpenedKey = opened.join(',');
    $('roundCount').textContent = `${session.index + 1} من ${plan.batches.length}`; $('roundProgress').max = plan.batches.length; $('roundProgress').value = session.index + 1;
    $('roundOpenedSummary').textContent = opened.length ? `فُتحت ${opened.length} من ${plan.batches.length} جولات` : 'لم تُفتح أي جولة بعد';
    $('clearOpenedRounds').hidden = !opened.length;
    $('previousBatch').disabled = session.index === 0; $('nextBatch').disabled = session.index === plan.batches.length - 1;
    $('batchTerms').replaceChildren(...batch.terms.map(t => { const e = node('bdi', 'term-chip', t); return e; })); $('queryPreview').value = batch.query;
    $('reopenBatch').href = batch.url;
    $('reopenBatch').setAttribute('aria-label', `فتح الجولة المحددة ${session.index + 1} في تبويب جديد`);
    for (const row of $('roundRows').children) {
      const idx = Number(row.dataset.roundIndex), current = idx === session.index, wasOpened = openedSet.has(idx);
      row.classList.toggle('current-round', current); row.classList.toggle('opened-round', wasOpened);
      const badge = row.querySelector('.opened-badge'); if (badge) badge.hidden = !wasOpened;
      const link = row.querySelector('a'); if (current) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
    }
  }
  function selectBatch(index, markOpened = false) {
    if (!state.session) return;
    const plan = savedPlan(); if (index < 0 || index >= plan.batches.length) return;
    state.session.index = index;
    if (markOpened) {
      const opened = new Set(state.session.opened || []);
      opened.add(index);
      state.session.opened = [...opened].sort((a, b) => a - b);
    }
    renderSessionPosition(plan); saveNow();
  }
  function startSearch() { try { const plan = planned(); if (!plan.batches.length) return toast('اختر تصنيفًا أو أضف عبارات للبحث.'); resumedSessionName = ''; state.session = { terms: plan.terms, options: plan.options, index: 0, startedAt: new Date().toISOString() }; renderPlan(); saveNow(); toast('الجولات جاهزة في الجدول. افتح أي جولة، أو استخدم Ctrl مع النقر لفتحها في الخلفية.'); } catch (e) { toast(e.message); } }
  function duplicateCategory(id) {
    if (state.categories.length >= C.LIMIT) return toast(`بلغت المكتبة الحد الأقصى (${C.LIMIT} تصنيفًا). احذف أو ادمج تصنيفًا أولًا.`);
    const source = state.categories.find(c => c.id === id); if (!source) return;
    const copyCat = C.clone(source); copyCat.id = C.id();
    let title = (source.title.slice(0, 58) + ' (نسخة)').slice(0, 65), n = 2;
    while (state.categories.some(c => C.key(c.title) === C.key(title))) { const tail = ` (نسخة ${n++})`; title = source.title.slice(0, 65 - tail.length) + tail; }
    copyCat.title = title;
    const idx = state.categories.findIndex(c => c.id === id);
    const next = [...state.categories]; next.splice(idx + 1, 0, C.validateCategory(copyCat));
    state.categories = C.validateCategories(next); changed(`نُسخ التصنيف باسم «${copyCat.title}».`);
  }
  function renderLibrary() {
    const list = $('libraryList'), statusFilter = $('libraryStatusFilter').value; list.replaceChildren();
    const visible = filteredCategories($('libraryFilter').value).filter(c => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'preset') return !!c.preset;
      if (statusFilter === 'exportSelected') return state.exportSelected.includes(c.id);
      const report = C.qualityReport(c);
      if (statusFilter === 'unreviewed') return report.candidate > 0;
      if (statusFilter === 'alerts') return report.alerts.length > 0;
      return true;
    });
    for (const c of visible) {
      const card = node('article', 'library-item' + (state.exportSelected.includes(c.id) ? ' export-selected' : '')), head = node('div', 'library-item-head'); head.append(node('span', 'category-symbol', c.symbol), node('span', '', C.activeTerms(c).length + ' فعّالة · ' + langLabel(c.language)));
      const title = node('h3', '', c.title); title.dir = 'auto'; const description = node('p', '', c.description); description.dir = 'auto'; const terms = node('div', 'preview-terms');
      terms.append(...c.terms.slice(0, 3).map(t => node('bdi', 'term-chip', t))); if (c.terms.length > 3) terms.append(node('span', '', '+' + (c.terms.length - 3)));
      const actions = node('div', 'library-item-actions'), edit = node('button', 'text-button', 'تحرير'), dup = node('button', 'text-button', 'نسخ'), search = node('button', 'text-button', 'للبحث'), del = node('button', 'text-button', 'حذف'), review = node('button', 'text-button', 'مراجعة'), preset = node('button', 'text-button', c.preset ? 'القالب ✓' : 'قالب بحث');
      for (const b of [review, edit, preset, dup, search, del]) b.type = 'button';
      review.setAttribute('aria-label', 'مراجعة ' + c.title); preset.setAttribute('aria-label', 'قالب بحث ' + c.title); dup.setAttribute('aria-label', 'نسخ ' + c.title);
      review.addEventListener('click', () => researchUI.review(c.id)); preset.addEventListener('click', () => researchUI.preset(c.id)); dup.addEventListener('click', () => duplicateCategory(c.id));
      const report = C.qualityReport(c), quality = node('div', 'library-quality', `${report.reviewed} راجعتُها · ${report.excluded} مستبعدة${report.alerts.length ? ` · ${report.alerts.length} تنبيهات صياغة` : ''}`);
      const exportChoice = node('label', 'library-export-choice'), check = node('input'); check.type = 'checkbox'; check.checked = state.exportSelected.includes(c.id); check.setAttribute('aria-label', 'تصدير ' + c.title); exportChoice.append(check, node('span', '', 'اختيار للتصدير'));
      check.addEventListener('change', () => { state.exportSelected = check.checked ? [...new Set([...state.exportSelected, c.id])] : state.exportSelected.filter(id => id !== c.id); card.classList.toggle('export-selected', check.checked); renderExportSelection(); scheduleSave(); });
      edit.setAttribute('aria-label', 'تحرير ' + c.title); del.setAttribute('aria-label', 'حذف ' + c.title); search.setAttribute('aria-label', 'البحث بتصنيف ' + c.title);
      edit.addEventListener('click', () => editCategory(c.id)); search.addEventListener('click', () => { if (!state.selected.includes(c.id)) state.selected.push(c.id); changed('أُضيف التصنيف إلى اختيارات البحث.'); location.hash = 'search'; });
      del.addEventListener('click', () => confirmAction('حذف التصنيف', `سيُحذف «${c.title}» من المكتبة المحلية. يمكنك تنزيل نسخة احتياطية قبل الحذف من الشريط العلوي.`, () => { state.categories = state.categories.filter(x => x.id !== c.id); state.selected = state.selected.filter(x => x !== c.id); state.exportSelected = state.exportSelected.filter(x => x !== c.id); changed('حُذف التصنيف.'); }));
      actions.append(review, edit, preset, dup, search, del); card.append(head, title, description, terms, quality, exportChoice, actions); list.append(card);
    }
    if (!list.children.length) { const empty = node('div', 'empty-state'); empty.append(node('h3', '', state.categories.length ? 'لا توجد نتائج مطابقة' : 'مكتبتك جاهزة لبداية جديدة'), node('p', '', state.categories.length ? 'جرّب تغيير البحث أو مرشح الحالة.' : 'أضف تصنيفًا جديدًا أو استورد ملفاتك السابقة.')); list.append(empty); }
    const totalTerms = state.categories.reduce((s, c) => s + c.terms.length, 0), activeCount = state.categories.reduce((s, c) => s + C.activeTerms(c).length, 0);
    $('librarySummary').textContent = `${state.categories.length} من ${C.LIMIT} تصنيفًا · ${totalTerms} عبارة (${activeCount} فعّالة)`;
    renderExportSelection();
  }
  function renderExportSelection() {
    const count = state.categories.filter(c => state.exportSelected.includes(c.id)).length;
    $('exportSelectionSummary').textContent = `${count} من ${state.categories.length} محدد للتصدير`;
    $('selectAllForExport').disabled = !state.categories.length || count === state.categories.length;
    $('clearExportSelection').disabled = !count;
  }
  function updateEditTermsStats() {
    const original = state.categories.find(c => c.id === editingId), raw = $('editTerms').value;
    const rawLines = raw.split(/[,،;؛\n\r]+/u).map(t => t.trim()).filter(Boolean).length;
    const terms = C.parseEditedTerms(raw, original?.terms || []);
    const alerts = terms.filter(t => C.inspectTerm(t).length).length;
    $('editTermsStats').textContent = terms.length ? `${terms.length} عبارة فريدة${rawLines > terms.length ? ` · أُزيل نحو ${rawLines - terms.length} تكرار` : ''}${alerts ? ` · ${alerts} تنبيه صياغة` : ''}` : 'أدخل عبارة واحدة على الأقل.';
  }
  function editCategory(id = null) {
    if (!id && state.categories.length >= C.LIMIT) return toast(`بلغت المكتبة الحد الأقصى (${C.LIMIT} تصنيفًا). احذف أو ادمج تصنيفًا قبل إضافة جديد.`);
    editingId = id; const c = state.categories.find(c => c.id === id);
    $('categoryDialogTitle').textContent = c ? 'تحرير التصنيف' : 'تصنيف جديد'; $('editTitle').value = c?.title || ''; $('editDescription').value = c?.description || ''; $('editLanguage').value = c?.language || 'ar'; $('editSymbol').value = c?.symbol || 'ع';
    // One line per imported term preserves punctuation inside the original phrase.
    $('editTerms').value = c?.terms.join('\n') || ''; $('categoryFormError').hidden = true; updateEditTermsStats(); showDialog('categoryDialog'); $('editTitle').focus();
  }
  $('editTerms').addEventListener('input', updateEditTermsStats);
  $('categoryForm').addEventListener('submit', e => {
    e.preventDefault(); try {
      const original = state.categories.find(c => c.id === editingId), raw = $('editTerms').value;
      const terms = original && raw === original.terms.join('\n') ? original.terms : C.parseEditedTerms(raw, original?.terms || []);
      const c = C.validateCategory({ ...original, id: editingId || C.id(), title: $('editTitle').value, description: $('editDescription').value.trim() || $('editTitle').value.trim(), language: $('editLanguage').value, symbol: $('editSymbol').value.trim() || 'ع', terms });
      const categories = editingId ? state.categories.map(x => x.id === editingId ? c : x) : [...state.categories, c]; state.categories = C.validateCategories(categories); closeDialog('categoryDialog'); changed('أُضيف التصنيف أو حُفظ تعديله.');
    } catch (error) { $('categoryFormError').textContent = error.message; $('categoryFormError').hidden = false; }
  });
  function updateReplyHint() {
    const text = state.draft.reply || '', trimmed = text.trim();
    $('clearReply').hidden = !text.length;
    if (!trimmed) { $('replyFormatHint').textContent = 'بانتظار لصق الإجابة'; return; }
    const looksJson = trimmed.startsWith('{') || /```(?:json)?\s*\{/i.test(trimmed) || trimmed.includes('"research-hunter-draft"');
    const looksText = /\b(?:AR_PHRASES|AR_HASHTAGS|EN_PHRASES|EN_HASHTAGS)\b/i.test(trimmed);
    const format = looksJson ? 'تم اكتشاف بنية JSON' : looksText ? 'تم اكتشاف الأقسام النصية الأربعة' : 'لم تُكتشف بنية معروفة بعد';
    $('replyFormatHint').textContent = `${format} · ${text.length.toLocaleString('en-US')} / 150,000 حرف`;
  }
  function renderGroups() {
    $('generatedGroups').replaceChildren();
    for (const s of C.SECTIONS) {
      const group = state.draft.groups[s.key], card = node('section', 'generated-group'), heading = node('div', 'group-heading'), label = node('label'), check = node('input'), count = node('span');
      check.type = 'checkbox'; check.checked = group.include; check.id = 'include_' + s.key; label.append(check, document.createTextNode(s.label)); count.id = 'groupCount_' + s.key; heading.append(label, count); card.append(heading);
      check.addEventListener('change', () => { group.include = check.checked; groupSummary(); scheduleSave(); });
      for (const [name, title, tag, max] of [['title', 'اسم التصنيف', 'input', 65], ['description', 'وصف مختصر', 'input', 160], ['terms', 'العبارات · سطر لكل عبارة أو فاصلة', 'textarea', 150000]]) {
        const field = node('div', 'field'), caption = node('label', '', title), input = node(tag); input.id = name + '_' + s.key; caption.htmlFor = input.id; input.value = group[name]; input.dir = 'auto'; input.maxLength = max; if (tag === 'textarea') input.rows = 5;
        input.addEventListener('input', () => { group[name] = input.value; groupSummary(); scheduleSave(); }); field.append(caption, input); card.append(field);
      }
      const alertBox = node('p', 'group-alerts micro-note'); alertBox.id = 'groupAlerts_' + s.key; alertBox.hidden = true; card.append(alertBox);
      $('generatedGroups').append(card);
    }
    groupSummary();
  }
  function groupSummary() {
    let total = 0, included = 0, alerts = 0;
    for (const s of C.SECTIONS) {
      const g = state.draft.groups[s.key], terms = C.parseTerms(g.terms);
      const flagged = terms.map(t => ({ term: t, reasons: C.inspectTerm(t) })).filter(x => x.reasons.length);
      $('groupCount_' + s.key).textContent = terms.length + ' عبارة' + (flagged.length ? ` · ${flagged.length} تنبيه` : '');
      const alertBox = $('groupAlerts_' + s.key);
      if (alertBox) { alertBox.hidden = !flagged.length; if (flagged.length) alertBox.textContent = 'تحتاج فحصًا: ' + flagged.slice(0, 3).map(f => `${f.term} (${f.reasons[0]})`).join(' · ') + (flagged.length > 3 ? ` (+${flagged.length - 3})` : ''); }
      if (g.include && terms.length) { total += terms.length; included++; alerts += flagged.length; }
    }
    $('generatedSummary').textContent = `${included} مجموعات محددة · ${total} عبارة${alerts ? ` · ${alerts} تحتاج فحص الصياغة` : ''}`;
  }
  function syncDraft() { for (const input of document.querySelectorAll('[data-draft]')) input.value = state.draft[input.dataset.draft]; $('topic').dataset.previous = state.draft.topic; updateReplyHint(); renderGroups(); researchUI?.renderDraftEvidence(); }
  function generatedCategories() {
    const categories = [];
    for (const s of C.SECTIONS) {
      const g = state.draft.groups[s.key], terms = C.parseTerms(g.terms); if (!g.include || !terms.length) continue;
      if (terms.some(t => s.hashtag ? !C.validHashtag(t) : t.startsWith('#'))) throw Error(`راجع مجموعة «${s.label}»: توجد عبارة في غير موضعها أو هاشتاق غير صالح.`);
      const draft = state.draft, usePreset = draft.selectedAccounts.length || draft.useExclusions && draft.exclusions.length;
      categories.push(C.validateCategory({ id: C.id(), title: g.title, description: g.description.trim() || g.title, symbol: s.symbol, language: s.language, terms, reviews: C.normalizeReviews(draft.evidence, terms), accountSources: draft.accounts.filter(a => draft.selectedAccounts.includes(a.handle)), ...(usePreset ? { preset: C.normalizeOptions({ accounts: draft.selectedAccounts, exclude: draft.useExclusions ? draft.exclusions.join('\n') : '' }) } : {}) }));
    }
    if (!categories.length) throw Error('أدخل عبارات في مجموعة واحدة على الأقل، واختر تضمينها.'); return categories;
  }
  function saveGenerated(goSearch, goReview = false) {
    try {
      const incoming = generatedCategories(), result = C.mergeCategories(state.categories, incoming); state.categories = result.categories;
      const ids = result.targetIds;
      if (goSearch) {
        const langs = new Set(incoming.map(c => c.language));
        const inferredLang = langs.size === 1 && (langs.has('ar') || langs.has('en')) ? [...langs][0] : 'all';
        state.selected = ids; state.extra = ''; state.options = C.normalizeOptions({ batchSize: state.options.batchSize, accounts: state.draft.selectedAccounts, exclude: state.draft.useExclusions ? state.draft.exclusions.join('\n') : '', language: inferredLang }); syncSearchFields();
      }
      changed(`أُضيفت المجموعات إلى المكتبة${result.merged ? ' مع دمج المتشابه' : ''}${result.renamed ? ' مع تمييز الأسماء المتشابهة' : ''}.`);
      if (goSearch) location.hash = 'search'; else if (goReview && ids.length) { location.hash = 'library'; route(); researchUI.review(ids[0]); }
    } catch (e) { toast(e.message); }
  }
  function openImport() { stagedFiles = []; importResult = null; $('importFiles').value = ''; $('collisionMode').value = 'merge'; $('importError').hidden = true; updateImportPreview(); showDialog('importDialog'); }
  function updateImportPreview() {
    $('importFileList').replaceChildren();
    for (const [i, file] of stagedFiles.entries()) { const row = node('div', 'file-row'), name = node('bdi', '', file.name + (file.error ? ' · ' + file.error : ' · ' + file.categories.length + ' تصنيفًا')), remove = node('button', '', '×'); remove.setAttribute('aria-label', 'إزالة الملف ' + file.name); remove.addEventListener('click', () => { stagedFiles.splice(i, 1); updateImportPreview(); }); row.append(name, remove); $('importFileList').append(row); }
    importResult = null; $('applyImport').disabled = true; $('importError').hidden = true;
    if (importBusy) { $('importPreview').textContent = 'جارٍ قراءة الملفات…'; return; }
    if (!stagedFiles.length) { $('importPreview').textContent = 'اختر ملفات لرؤية النتيجة. مكتبتك الحالية تبقى ضمن الدمج.'; return; }
    if (stagedFiles.some(f => f.error)) { $('importPreview').textContent = 'أزل الملفات غير الصالحة أو اختر نسخًا سليمة. لم تتغير المكتبة.'; return; }
    try {
      let categories = C.clone(state.categories), merged = 0, duplicates = 0, renamed = 0;
      for (const file of stagedFiles) { const result = C.mergeCategories(categories, file.categories, $('collisionMode').value); categories = result.categories; merged += result.merged; duplicates += result.duplicates; renamed += result.renamed; }
      importResult = categories; $('importPreview').textContent = `النتيجة: ${categories.length} تصنيفًا من مكتبتك و${stagedFiles.length} ملف/ملفات. دُمج ${merged} تصنيفًا، وأُزيل ${duplicates} تكرارًا، وتغيّر ${renamed} اسمًا. تحفظ ملفات Web المراجعات والقوالب. عند الدمج تُحفظ مراجعات وقوالب التصنيف الموجود، وتضاف بيانات المصطلحات الجديدة.`; $('applyImport').disabled = false;
    } catch (e) { $('importError').textContent = e.message; $('importError').hidden = false; $('importPreview').textContent = 'تعذّر تطبيق هذا الدمج. قلّل الملفات أو اختر دمج الأسماء المتشابهة.'; }
  }
  function renderSavedSessionsBadge() {
    const count = (state.savedSessions || []).length;
    $('savedSessionsLabel').textContent = `الجلسات المحفوظة (${count})`;
  }
  function renderSavedSessionsList() {
    const holder = $('savedSessionsList'); holder.replaceChildren();
    const list = state.savedSessions || [];
    if (!list.length) {
      const empty = node('div', 'empty-state');
      empty.append(node('h3', '', 'لا توجد جلسات محفوظة بعد'), node('p', '', 'جهّز جولات البحث ثم اضغط «حفظ هذه الجلسة بالاسم» للاحتفاظ بتقدمك وتبديل المسارات بسهولة.'));
      holder.append(empty);
      return;
    }
    const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
    for (const s of [...list].reverse()) {
      const card = node('article', 'saved-session-card'), plan = C.buildPlan(s.terms, s.options), openedCount = (s.opened || []).length;
      const head = node('div', 'saved-session-head'), title = node('h3', '', s.name); title.dir = 'auto';
      head.append(title, node('span', 'pill', `${plan.batches.length} جولات`));
      const meta = node('p', 'saved-session-meta', `المحددة: ${s.index + 1} من ${plan.batches.length} · فُتحت ${openedCount} · ${s.terms.length} عبارة`);
      const stamp = node('small', 'saved-session-date', 'حُفظت في: ' + fmt.format(new Date(s.savedAt)));
      const actions = node('div', 'actions');
      const resumeBtn = node('button', 'button primary small', 'استئناف الجلسة'); resumeBtn.type = 'button';
      resumeBtn.addEventListener('click', () => {
        resumedSessionName = s.name;
        state.session = { terms: C.clone(s.terms), options: C.clone(s.options), index: s.index, startedAt: s.startedAt || '', ...(s.opened?.length ? { opened: [...s.opened] } : {}) };
        closeDialog('sessionsDialog'); renderPlan(); saveNow();
        toast(`استُؤنفت الجلسة «${s.name}» (${plan.batches.length} دفعات). بقيت اختياراتك بالأعلى دون تغيير.`);
      });
      const updateBtn = node('button', 'button ghost small', 'تحديث بالحالية'); updateBtn.type = 'button'; updateBtn.disabled = !state.session;
      updateBtn.addEventListener('click', () => {
        if (!state.session) return;
        const updated = C.validateSavedSession({ ...C.clone(state.session), id: s.id, name: s.name, savedAt: new Date().toISOString() });
        state.savedSessions = C.validateSavedSessions(state.savedSessions.map(x => x.id === s.id ? updated : x));
        renderSavedSessionsBadge(); renderSavedSessionsList(); saveNow();
        toast(`حُدّثت الجلسة «${s.name}» بالتقدم الحالي.`);
      });
      const delBtn = node('button', 'text-button danger-text', 'حذف'); delBtn.type = 'button';
      delBtn.addEventListener('click', () => confirmAction('حذف جلسة محفوظة', `سيُحذف سجل الجلسة «${s.name}» فقط؛ تبقى تصنيفاتك في المكتبة.`, () => {
        state.savedSessions = state.savedSessions.filter(x => x.id !== s.id);
        renderSavedSessionsBadge(); renderSavedSessionsList(); saveNow(); toast('حُذفت الجلسة المحفوظة.');
      }));
      actions.append(resumeBtn, updateBtn, delBtn);
      card.append(head, meta, stamp, actions);
      holder.append(card);
    }
  }
  function openSaveSessionDialog() {
    if (!state.session) return toast('جهّز جولات البحث أولًا قبل حفظ الجلسة.');
    const chosenTitles = state.categories.filter(c => state.selected.includes(c.id)).map(c => c.title).slice(0, 2);
    const defaultName = (chosenTitles.length ? chosenTitles.join(' + ') : `جلسة ${dateStamp()}`).slice(0, 65);
    $('sessionNameInput').value = defaultName; $('saveSessionError').hidden = true;
    showDialog('saveSessionDialog'); $('sessionNameInput').focus(); $('sessionNameInput').select();
  }
  $('saveSessionForm').addEventListener('submit', e => {
    e.preventDefault();
    if (!state.session) return closeDialog('saveSessionDialog');
    try {
      const name = $('sessionNameInput').value.trim();
      const list = state.savedSessions || [];
      const existing = list.find(s => C.key(s.name) === C.key(name));
      if (!existing && list.length >= C.SAVED_SESSIONS_LIMIT) throw Error(`بلغت الحد الأقصى (${C.SAVED_SESSIONS_LIMIT} جلسة محفوظة). احذف جلسة قديمة أو استخدم اسم جلسة قائمة لتحديثها.`);
      const record = C.validateSavedSession({ ...C.clone(state.session), id: existing ? existing.id : C.id(), name, savedAt: new Date().toISOString() });
      const next = existing ? list.map(s => s.id === existing.id ? record : s) : [...list, record];
      state.savedSessions = C.validateSavedSessions(next);
      closeDialog('saveSessionDialog'); renderSavedSessionsBadge(); saveNow();
      toast(existing ? `حُدّثت الجلسة «${record.name}».` : `حُفظت الجلسة «${record.name}».`);
    } catch (error) { $('saveSessionError').textContent = error.message; $('saveSessionError').hidden = false; }
  });
  async function stageIncomingFiles(fileList) {
    if (importBusy) return toast('انتظر اكتمال قراءة الملفات الحالية، ثم أضف الملفات التالية.');
    const files = [...fileList]; if (!files.length) return;
    if (stagedFiles.length + files.length > 20) return toast('اختر حتى 20 ملفًا في عملية الدمج الواحدة.');
    importBusy = true; $('importFiles').disabled = true; updateImportPreview();
    try { stagedFiles.push(...await C.readCategoryFiles(files)); }
    catch (error) { toast('تعذر قراءة الملفات: ' + error.message); }
    finally { importBusy = false; $('importFiles').disabled = false; updateImportPreview(); }
  }
  $('importFiles').addEventListener('change', async e => { const files = [...e.target.files]; e.target.value = ''; await stageIncomingFiles(files); });
  const dropZone = $('importDropZone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer?.files?.length) await stageIncomingFiles(e.dataTransfer.files); });
  $('applyImport').addEventListener('click', () => { if (!importResult || importBusy) return; state.categories = C.clone(importResult); closeDialog('importDialog'); changed('أُضيفت الملفات إلى مكتبتك. لم تُعدّل الملفات الأصلية.'); });
  $('restoreFile').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (file.size > C.MAX_FILE_BYTES) throw Error('حجم النسخة أكبر من 8 ميغابايت.'); const archive = C.parseArchive(await file.text());
      if (archive.format !== 'research-hunter-web-backup') throw Error('هذا ملف تصنيفات. استخدم استيراد ودمج لإضافته، أو اختر نسخة Web كاملة.');
      const savedCount = (archive.state.savedSessions || []).length;
      confirmAction('استعادة نسخة Web كاملة', 'ستستبدل الاستعادة المكتبة والمسودة وإعدادات البحث الحالية. سنجهّز نسخة من حالتك الحالية للتنزيل قبل الاستبدال.', () => {
        download(backupForDownload(), `research-hunter-web-before-restore-${dateStamp()}.json`);
        resumedSessionName = '';
        state = C.clone(archive.state); lastValidOptions = C.normalizeOptions(state.options); writeBlocked = false; warn(''); syncSearchFields(); syncDraft(); renderSavedSessionsBadge(); changed('استُعيدت النسخة الكاملة.'); saveNow();
      }, `${archive.categories.length} تصنيفًا · ${archive.state.session ? 'تتضمن جولة بحث نشطة' : 'لا توجد جولة نشطة'}${savedCount ? ` · ${savedCount} جلسات محفوظة` : ''} · ${archive.state.draft.topic || 'مسودة فارغة'}`);
    } catch (error) { toast(error.message); }
  });
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
    // Only clear pendingConfirm if confirmDialog actually remains closed (not re-opened synchronously).
    if (dialog.id === 'confirmDialog' && !dialog.open) pendingConfirm = null;
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
    const opener = dialogOpeners.get(dialog.id); dialogOpeners.delete(dialog.id);
    if (opener && opener.isConnected && typeof opener.focus === 'function' && !opener.closest('[hidden]')) opener.focus();
  });
  $('confirmAction').addEventListener('click', () => { const entry = pendingConfirm; pendingConfirm = null; closeDialog('confirmDialog'); try { if (entry?.action) entry.action(); } catch (error) { toast(error.message || 'تعذر إتمام العملية. لم نتابع الاستبدال.'); } });
  for (const [field, name] of Object.entries(searchFields)) $(field).addEventListener('change', () => { state.options[name] = $(field).type === 'checkbox' ? $(field).checked : name === 'batchSize' ? Number($(field).value) : $(field).value; renderPlan(); scheduleSave(); });
  // Text filters update without waiting for blur.
  for (const field of ['account', 'searchExclude', 'requiredTerms']) $(field).addEventListener('input', () => { state.options[searchFields[field]] = $(field).value; schedulePlan(); scheduleSave(); });
  $('extraTerms').addEventListener('input', () => { state.extra = $('extraTerms').value; schedulePlan(); scheduleSave(); });
  $('resetFilters').addEventListener('click', () => { state.options = C.normalizeOptions(); state.extra = ''; lastValidOptions = C.normalizeOptions(); syncSearchFields(); renderPlan(); scheduleSave(); toast('أُعيد ضبط مرشحات البحث.'); });
  $('categoryFilter').addEventListener('input', renderChoices); $('libraryFilter').addEventListener('input', renderLibrary); $('libraryStatusFilter').addEventListener('change', renderLibrary);
  $('selectVisible').addEventListener('click', () => { state.selected = [...new Set([...state.selected, ...filteredCategories($('categoryFilter').value).map(c => c.id)])]; changed(); });
  $('clearSelection').addEventListener('click', () => { state.selected = []; changed(); });
  $('startSearch').addEventListener('click', startSearch);
  $('previousBatch').addEventListener('click', () => selectBatch(state.session.index - 1, false));
  $('nextBatch').addEventListener('click', () => selectBatch(state.session.index + 1, false));
  $('reopenBatch').addEventListener('click', () => { if (state.session) selectBatch(state.session.index, true); });
  $('reopenBatch').addEventListener('auxclick', event => { if (event.button === 1 && state.session) selectBatch(state.session.index, true); });
  $('clearOpenedRounds').addEventListener('click', () => { if (!state.session) return; delete state.session.opened; renderSessionPosition(savedPlan()); saveNow(); toast('مُسحت علامات فتح الجولات.'); });
  $('copyQuery').addEventListener('click', () => copy($('queryPreview').value));
  $('copyRoundUrl').addEventListener('click', () => { if (!state.session) return; copy(savedPlan().batches[state.session.index].url); });
  $('applySessionFilters').addEventListener('click', () => {
    if (!state.session) return;
    state.options = C.clone(state.session.options); lastValidOptions = C.normalizeOptions(state.options);
    syncSearchFields(); renderPlan(); scheduleSave(); toast('نُسخت مرشحات الجلسة إلى خيارات البحث.');
  });
  $('showRoundTerms').addEventListener('change', () => $('roundTable').classList.toggle('show-terms', $('showRoundTerms').checked));
  $('addCategory').addEventListener('click', () => editCategory());
  for (const name of ['quickBackup', 'downloadBackup']) $(name).addEventListener('click', exportBackup);
  for (const name of ['exportCategories', 'backupExportCategories']) $(name).addEventListener('click', exportCategories);
  $('selectAllForExport').addEventListener('click', () => { state.exportSelected = state.categories.map(c => c.id); renderLibrary(); scheduleSave(); });
  $('clearExportSelection').addEventListener('click', () => { state.exportSelected = []; renderLibrary(); scheduleSave(); });
  for (const name of ['openImport', 'backupImportCategories']) $(name).addEventListener('click', openImport);
  $('collisionMode').addEventListener('change', updateImportPreview); $('restoreBackup').addEventListener('click', () => $('restoreFile').click());
  $('downloadPrevious').addEventListener('click', () => { try { download(C.backupArchive(storage.previous()), 'research-hunter-web-previous.json'); toast('أُعدّت اللقطة السابقة للتنزيل.'); } catch (e) { toast(e.message || 'تعذرت قراءة النسخة المحلية.'); } });
  $('downloadRaw').addEventListener('click', () => { try { download(storage.raw(), 'research-hunter-web-raw-storage.json'); toast('أُعدّت بيانات التخزين الخام للتنزيل.'); } catch { toast('الوصول إلى تخزين المتصفح غير متاح.'); } });
  for (const input of document.querySelectorAll('[data-draft]')) input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => { const name = input.dataset.draft; state.draft[name] = input.value; if (name === 'reply') updateReplyHint(); if (name === 'topic') for (const s of C.SECTIONS) { const old = state.draft.groups[s.key]; if (!old.title || old.title === ((input.dataset.previous || '') + ' | ' + s.suffix).slice(0, 65)) { old.title = input.value ? (input.value + ' | ' + s.suffix).slice(0, 65) : ''; $('title_' + s.key).value = old.title; } } if (name === 'topic') input.dataset.previous = input.value; scheduleSave(); });
  $('clearReply').addEventListener('click', () => { state.draft.reply = ''; $('aiReply').value = ''; updateReplyHint(); scheduleSave(); $('aiReply').focus(); });
  $('generatePrompt').addEventListener('click', () => { try { state.draft.prompt = C.makePrompt(state.draft); $('prompt').value = state.draft.prompt; scheduleSave(); toast('البرومبت جاهز. انسخه إلى أداة الذكاء التي تختارها.'); } catch (e) { toast(e.message); $('topic').focus(); } });
  $('copyPrompt').addEventListener('click', () => copy($('prompt').value));
  $('parseReply').addEventListener('click', () => {
    const parse = () => { try { const result = C.parseResponse(state.draft.reply); for (const s of C.SECTIONS) { const g = state.draft.groups[s.key]; g.terms = result.groups[s.key].join('\n'); if (!g.title) g.title = (state.draft.topic || 'تصنيف جديد') + ' | ' + s.suffix; g.title = g.title.slice(0, 65); g.include = !!result.groups[s.key].length; } state.draft.evidence = result.evidence; state.draft.accounts = result.accounts; state.draft.exclusions = result.exclusions; state.draft.selectedAccounts = []; state.draft.useExclusions = false; renderGroups(); researchUI.renderDraftEvidence(); scheduleSave(); $('parseInfo').textContent = `وُزّعت الإجابة.${result.invalid ? ` تجاهلنا ${result.invalid} عنصرًا أو رابطًا غير صالح؛ راجع النص الأصلي.` : ''} الشواهد والحسابات مقترحة حتى تراجعها بنفسك.`; toast('وُزّعت الإجابة على المجموعات.'); } catch (e) { toast(e.message); } };
    if (C.SECTIONS.some(s => state.draft.groups[s.key].terms.trim())) confirmAction('إعادة توزيع الإجابة', 'ستُستبدل عبارات المجموعات الحالية بنص الإجابة. تبقى أسماء التصنيفات وأوصافها.', parse); else parse();
  });
  $('newDraft').addEventListener('click', () => { const reset = () => { state.draft = C.defaultDraft(); syncDraft(); $('topic').dataset.previous = ''; scheduleSave(); toast('بدأت مسودة جديدة.'); }; if (state.draft.topic || state.draft.reply || C.SECTIONS.some(s => state.draft.groups[s.key].terms)) confirmAction('مسودة جديدة', 'ستُمسح المسودة الحالية. تبقى التصنيفات المضافة في المكتبة.', reset); else reset(); });
  $('saveGenerated').addEventListener('click', () => saveGenerated(false)); $('searchGenerated').addEventListener('click', () => saveGenerated(true)); $('reviewGenerated').addEventListener('click', () => saveGenerated(false, true));
  const themeLabels = { auto: 'تلقائي', light: 'فاتح', dark: 'داكن' };
  function syncThemeButton() {
    if (!window.HunterTheme) return;
    const mode = window.HunterTheme.get(), effective = window.HunterTheme.resolved(mode);
    $('themeLabel').textContent = themeLabels[mode] || 'تلقائي';
    $('themeToggle').setAttribute('aria-label', `المظهر: ${themeLabels[mode]} (${effective === 'dark' ? 'داكن حاليًا' : 'فاتح حاليًا'})؛ اضغط للتبديل`);
  }
  $('themeToggle').addEventListener('click', () => {
    if (!window.HunterTheme) return;
    const next = window.HunterTheme.cycle();
    syncThemeButton();
    toast(`تم التبديل إلى المظهر: ${themeLabels[next]}.`);
  });
  window.HunterTheme?.subscribe(syncThemeButton);
  $('saveNamedSession').addEventListener('click', openSaveSessionDialog);
  $('openSavedSessions').addEventListener('click', () => { renderSavedSessionsList(); showDialog('sessionsDialog'); });
  $('openShortcuts').addEventListener('click', () => showDialog('shortcutsDialog'));
  document.addEventListener('keydown', e => {
    const anyDialog = document.querySelector('dialog[open]');
    if ($('reviewDialog').open && !$('confirmDialog').open) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('termReviewForm').requestSubmit(); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowLeft') { e.preventDefault(); if (!$('reviewNext').disabled) $('reviewNext').click(); return; }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'ArrowRight') { e.preventDefault(); if (!$('reviewPrevious').disabled) $('reviewPrevious').click(); return; }
    }
    if (anyDialog) return;
    const tag = document.activeElement?.tagName, editable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (e.altKey && !e.ctrlKey && !e.metaKey && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault(); location.hash = ['search', 'library', 'generator', 'backup'][Number(e.key) - 1]; return;
    }
    if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') { e.preventDefault(); showDialog('shortcutsDialog'); }
  });
  window.addEventListener('hashchange', () => { route(); window.scrollTo({ top: 0 }); }); window.addEventListener('pagehide', saveNow); document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('storage', e => { if (e.key === storage.name || e.key === null) { writeBlocked = true; warn('تغيّرت المكتبة في تبويب آخر. أوقفنا الحفظ هنا لتجنّب الكتابة فوقها. نزّل نسختك الحالية، ثم أعد تحميل الصفحة.'); saveNow(); } });
  researchUI = window.HunterResearchUI({ C, $, node, getState: () => state, getLastValidOptions: () => lastValidOptions, savedPlan, changed, scheduleSave, toast, showDialog, closeDialog, confirmAction, xTab, download, planned, syncSearchFields, route, onReviewDirtyChange: dirty => window.HunterStartup?.setReviewDirty(dirty) });
  syncThemeButton(); syncSearchFields(); syncDraft(); renderOverview(); renderLibrary(); renderChoices(); renderPlan(); renderSavedSessionsBadge(); renderStorageUsage(); route();
  if (loaded.warning) warn(loaded.warning); if (loaded.blocked) saveNow(); else if (!loaded.state) saveNow();
  window.HunterStartup?.ready();
})();
