(function () {
  'use strict';
  const C = window.HunterCore, $ = id => document.getElementById(id);
  const node = (tag, className, text) => { const e = document.createElement(tag); if (className) e.className = className; if (text != null) e.textContent = text; return e; };
  const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.setAttribute('aria-hidden', 'true'); svg.append(use); return svg; };
  const langLabel = lang => ({ ar: 'العربية', en: 'الإنجليزية', both: 'لغتان', mixed: 'لغتان' }[lang] || 'غير محددة');
  const storage = new C.StorageManager({ getItem: k => window.localStorage.getItem(k), setItem: (k, v) => window.localStorage.setItem(k, v) });
  const seed = window.HunterDefaults;
  const freshState = () => ({ version: 1, categories: C.clone(seed), selected: seed.slice(0, 2).map(c => c.id), exportSelected: [], options: C.normalizeOptions(), extra: '', draft: C.defaultDraft(), session: null });
  const loaded = storage.read(); let state = loaded.state || freshState(), writeBlocked = !!loaded.blocked, saveTimer, toastTimer, editingId = null, pendingConfirm = null, stagedFiles = [], importResult = null, importBusy = false;
  const xTab = new C.XTab(window.open.bind(window));
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
  function warn(message) { $('storageWarning').textContent = message; $('storageWarning').hidden = !message; }
  function saveNow() {
    clearTimeout(saveTimer);
    if (writeBlocked) { $('saveStatus').classList.add('failed'); $('saveStatus').lastElementChild.textContent = 'الحفظ متوقف · نزّل نسخة'; return false; }
    const result = storage.save(state); $('saveStatus').classList.toggle('failed', !result.ok); $('saveStatus').lastElementChild.textContent = result.ok ? 'محفوظ على الجهاز' : 'لم يُحفظ · نزّل نسخة';
    if (!result.ok) warn(result.warning); return result.ok;
  }
  function scheduleSave() { clearTimeout(saveTimer); $('saveStatus').lastElementChild.textContent = writeBlocked ? 'الحفظ متوقف' : 'جارٍ الحفظ…'; saveTimer = setTimeout(saveNow, 450); }
  function changed(message) { renderLibrary(); renderChoices(); renderOverview(); renderPlan(); scheduleSave(); if (message) toast(message); }
  function showDialog(id) { $(id).showModal(); document.body.classList.add('dialog-open'); }
  function closeDialog(id) { $(id).close(); if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open'); }
  function confirmAction(title, text, action, details = '') { $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('restoreDetails').textContent = details; $('restoreDetails').hidden = !details; pendingConfirm = action; showDialog('confirmDialog'); }
  function download(data, filename) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), url = URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000); }
  const dateStamp = () => new Date().toISOString().slice(0, 10);
  function exportBackup() { try { saveNow(); download(C.backupArchive(state), `research-hunter-web-backup-${dateStamp()}.json`); toast('أُعدّت نسخة Web كاملة للتنزيل.'); } catch (e) { toast(e.message); } }
  function exportCategories() {
    try { const archive = C.categoryArchive(state.categories, state.exportSelected); download(archive, 'research-hunter-categories.json'); toast(`أُعدّ ملف يضم ${archive.categories.length} تصنيفًا محددًا للتصدير.`); }
    catch (e) { toast(e.message); if (!state.exportSelected.length) { location.hash = 'library'; route(); $('selectAllForExport').focus(); } }
  }
  async function copy(text) {
    if (!text.trim()) return toast('لا يوجد نص لنسخه بعد.');
    try { await navigator.clipboard.writeText(text); toast('تم نسخ النص.'); }
    catch { const t = node('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); toast(ok ? 'تم نسخ النص.' : 'تعذر النسخ التلقائي. حدّد النص وانسخه يدويًا.'); }
  }
  function route() {
    const view = ['search', 'library', 'generator', 'backup'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'search';
    for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== 'view-' + view;
    for (const link of document.querySelectorAll('[data-view]')) { const active = link.dataset.view === view; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
    $('pageCrumb').textContent = { search: 'مساحة البحث', library: 'مكتبة التصنيفات', generator: 'مولّد التصنيفات', backup: 'النسخ الاحتياطي' }[view];
    document.title = $('pageCrumb').textContent + ' | الصياد الباحث Web';
  }
  function renderOverview() {
    $('statCategories').textContent = state.categories.length; $('navCount').textContent = state.categories.length;
    $('statTerms').textContent = C.unique(state.categories.flatMap(c => c.terms)).length;
    $('selectedCount').textContent = state.selected.length + ' محدد';
  }
  function filteredCategories(filter) { const k = C.key(filter); return state.categories.filter(c => C.key([c.title, c.description, ...c.terms].join(' ')).includes(k)); }
  function renderChoices() {
    const list = $('categoryChoices'); list.replaceChildren(); const visible = filteredCategories($('categoryFilter').value);
    for (const c of visible) {
      const selected = state.selected.includes(c.id), label = node('label', 'category-choice' + (selected ? ' selected' : '')), head = node('div', 'choice-head'), check = node('input'); check.type = 'checkbox'; check.checked = selected; check.setAttribute('aria-label', c.title); check.dataset.categoryId = c.id;
      head.append(node('span', 'category-symbol', c.symbol), check); const title = node('strong', '', c.title); title.dir = 'auto'; const desc = node('span', 'description', c.description); desc.dir = 'auto';
      const meta = node('span', 'choice-meta'), count = node('span'); count.append(node('i'), document.createTextNode(c.terms.length + ' عبارة')); meta.append(count, node('span', '', langLabel(c.language))); label.append(head, title, desc, meta);
      check.addEventListener('change', () => { state.selected = check.checked ? [...state.selected, c.id] : state.selected.filter(x => x !== c.id); label.classList.toggle('selected', check.checked); renderOverview(); renderPlan(); scheduleSave(); }); list.append(label);
    }
    if (!visible.length) { const empty = node('div', 'empty-state'); empty.append(node('h3', '', state.categories.length ? 'لم نجد تصنيفًا بهذا البحث' : 'ابدأ مكتبتك الأولى'), node('p', '', state.categories.length ? 'جرّب اسمًا أو عبارة أخرى.' : 'أضف تصنيفًا أو استورد ملف JSON من مكتبة التصنيفات.')); list.append(empty); }
  }
  const searchFields = { resultType: 'type', searchLanguage: 'language', batchSize: 'batchSize', since: 'since', until: 'until', account: 'account', searchExclude: 'exclude', noReplies: 'noReplies', noReposts: 'noReposts' };
  function syncSearchFields() { for (const [field, name] of Object.entries(searchFields)) { if ($(field).type === 'checkbox') $(field).checked = state.options[name]; else $(field).value = state.options[name]; } $('extraTerms').value = state.extra; }
  function planned() { const collected = C.collectTerms(state.categories, state.selected, state.extra); return { ...C.buildPlan(collected.terms, state.options), duplicates: collected.duplicates }; }
  function renderPlan() {
    try { const plan = planned(); $('planTerms').textContent = plan.terms.length; $('planBatches').textContent = plan.batches.length; $('planDuplicates').textContent = plan.duplicates; $('planError').hidden = true; $('startSearch').disabled = !plan.terms.length; }
    catch (e) { const terms = C.collectTerms(state.categories, state.selected, state.extra); $('planTerms').textContent = terms.terms.length; $('planDuplicates').textContent = terms.duplicates; $('planBatches').textContent = '—'; $('planError').textContent = e.message; $('planError').hidden = false; $('startSearch').disabled = true; }
    $('startSearch').querySelector('span').textContent = state.session ? 'بدء جولة جديدة في X' : 'بدء البحث في X'; renderSession();
  }
  function renderSession() {
    const session = state.session; $('activeSession').hidden = !session;
    $('sessionCaption').textContent = session ? 'جولتك محفوظة؛ تابع من حيث توقفت' : 'جاهز للاكتشاف؟';
    if (!session) return;
    const plan = C.buildPlan(session.terms, session.options), batch = plan.batches[session.index];
    $('roundCount').textContent = `${session.index + 1} من ${plan.batches.length}`; $('roundProgress').max = plan.batches.length; $('roundProgress').value = session.index + 1;
    $('previousBatch').disabled = session.index === 0; $('nextBatch').disabled = session.index === plan.batches.length - 1;
    $('batchTerms').replaceChildren(...batch.terms.map(t => { const e = node('bdi', 'term-chip', t); return e; })); $('queryPreview').value = batch.query; $('manualXLink').href = batch.url;
  }
  function openBatch(index) {
    if (!state.session) return;
    const plan = C.buildPlan(state.session.terms, state.session.options); if (index < 0 || index >= plan.batches.length) return;
    const ok = xTab.navigate(plan.batches[index].url); state.session.index = index; $('popupNotice').hidden = ok; renderSession(); saveNow();
    toast(ok ? `فُتحت دفعة البحث ${index + 1} من ${plan.batches.length} في X.` : 'الجولة جاهزة، لكن المتصفح لم يفتح النتائج. استخدم رابط الدفعة الظاهر.');
  }
  function startSearch() { try { const plan = planned(); if (!plan.batches.length) return toast('اختر تصنيفًا أو أضف عبارات للبحث.'); state.session = { terms: plan.terms, options: plan.options, index: 0, startedAt: new Date().toISOString() }; renderPlan(); openBatch(0); } catch (e) { toast(e.message); } }
  function renderLibrary() {
    const list = $('libraryList'); list.replaceChildren();
    for (const c of filteredCategories($('libraryFilter').value)) {
      const card = node('article', 'library-item' + (state.exportSelected.includes(c.id) ? ' export-selected' : '')), head = node('div', 'library-item-head'); head.append(node('span', 'category-symbol', c.symbol), node('span', '', c.terms.length + ' عبارة · ' + langLabel(c.language)));
      const title = node('h3', '', c.title); title.dir = 'auto'; const description = node('p', '', c.description); description.dir = 'auto'; const terms = node('div', 'preview-terms');
      terms.append(...c.terms.slice(0, 3).map(t => node('bdi', 'term-chip', t))); if (c.terms.length > 3) terms.append(node('span', '', '+' + (c.terms.length - 3)));
      const actions = node('div', 'library-item-actions'), edit = node('button', 'text-button', 'تحرير'), search = node('button', 'text-button', 'للبحث'), del = node('button', 'text-button', 'حذف');
      const exportChoice = node('label', 'library-export-choice'), check = node('input'); check.type = 'checkbox'; check.checked = state.exportSelected.includes(c.id); check.setAttribute('aria-label', 'تصدير ' + c.title); exportChoice.append(check, node('span', '', 'اختيار للتصدير'));
      check.addEventListener('change', () => { state.exportSelected = check.checked ? [...new Set([...state.exportSelected, c.id])] : state.exportSelected.filter(id => id !== c.id); card.classList.toggle('export-selected', check.checked); renderExportSelection(); scheduleSave(); });
      edit.setAttribute('aria-label', 'تحرير ' + c.title); del.setAttribute('aria-label', 'حذف ' + c.title); search.setAttribute('aria-label', 'البحث بتصنيف ' + c.title);
      edit.addEventListener('click', () => editCategory(c.id)); search.addEventListener('click', () => { if (!state.selected.includes(c.id)) state.selected.push(c.id); changed('أُضيف التصنيف إلى اختيارات البحث.'); location.hash = 'search'; });
      del.addEventListener('click', () => confirmAction('حذف التصنيف', `سيُحذف «${c.title}» من المكتبة المحلية. يمكنك تنزيل نسخة احتياطية قبل الحذف من الشريط العلوي.`, () => { state.categories = state.categories.filter(x => x.id !== c.id); state.selected = state.selected.filter(x => x !== c.id); state.exportSelected = state.exportSelected.filter(x => x !== c.id); changed('حُذف التصنيف.'); }));
      actions.append(edit, search, del); card.append(head, title, description, terms, exportChoice, actions); list.append(card);
    }
    if (!list.children.length) { const empty = node('div', 'empty-state'); empty.append(node('h3', '', state.categories.length ? 'لا توجد نتائج مطابقة' : 'مكتبتك جاهزة لبداية جديدة'), node('p', '', 'أضف تصنيفًا جديدًا أو استورد ملفاتك السابقة.')); list.append(empty); }
    $('librarySummary').textContent = `${state.categories.length} تصنيفًا · ${state.categories.reduce((s, c) => s + c.terms.length, 0)} عبارة في المكتبة`;
    renderExportSelection();
  }
  function renderExportSelection() {
    const count = state.categories.filter(c => state.exportSelected.includes(c.id)).length;
    $('exportSelectionSummary').textContent = `${count} من ${state.categories.length} محدد للتصدير`;
    $('selectAllForExport').disabled = !state.categories.length || count === state.categories.length;
    $('clearExportSelection').disabled = !count;
  }
  function editCategory(id = null) {
    editingId = id; const c = state.categories.find(c => c.id === id);
    $('categoryDialogTitle').textContent = c ? 'تحرير التصنيف' : 'تصنيف جديد'; $('editTitle').value = c?.title || ''; $('editDescription').value = c?.description || ''; $('editLanguage').value = c?.language || 'ar'; $('editSymbol').value = c?.symbol || 'ع';
    // One line per imported term preserves punctuation inside the original phrase.
    $('editTerms').value = c?.terms.join('\n') || ''; $('categoryFormError').hidden = true; showDialog('categoryDialog'); $('editTitle').focus();
  }
  $('categoryForm').addEventListener('submit', e => {
    e.preventDefault(); try {
      const original = state.categories.find(c => c.id === editingId), raw = $('editTerms').value;
      const terms = original && raw === original.terms.join('\n') ? original.terms : C.parseTerms(raw);
      const c = C.validateCategory({ id: editingId || C.id(), title: $('editTitle').value, description: $('editDescription').value.trim() || $('editTitle').value.trim(), language: $('editLanguage').value, symbol: $('editSymbol').value || 'ع', terms });
      const categories = editingId ? state.categories.map(x => x.id === editingId ? c : x) : [...state.categories, c]; state.categories = C.validateCategories(categories); closeDialog('categoryDialog'); changed('أُضيف التصنيف أو حُفظ تعديله.');
    } catch (error) { $('categoryFormError').textContent = error.message; $('categoryFormError').hidden = false; }
  });
  function renderGroups() {
    $('generatedGroups').replaceChildren();
    for (const s of C.SECTIONS) {
      const group = state.draft.groups[s.key], card = node('section', 'generated-group'), heading = node('div', 'group-heading'), label = node('label'), check = node('input'), count = node('span');
      check.type = 'checkbox'; check.checked = group.include; check.id = 'include_' + s.key; label.append(check, document.createTextNode(s.label)); count.id = 'groupCount_' + s.key; heading.append(label, count); card.append(heading);
      check.addEventListener('change', () => { group.include = check.checked; groupSummary(); scheduleSave(); });
      for (const [name, title, tag, max] of [['title', 'اسم التصنيف', 'input', 65], ['description', 'وصف مختصر', 'input', 120], ['terms', 'العبارات · سطر لكل عبارة أو فاصلة', 'textarea', 150000]]) {
        const field = node('div', 'field'), caption = node('label', '', title), input = node(tag); input.id = name + '_' + s.key; caption.htmlFor = input.id; input.value = group[name]; input.dir = 'auto'; input.maxLength = max; if (tag === 'textarea') input.rows = 5;
        input.addEventListener('input', () => { group[name] = input.value; groupSummary(); scheduleSave(); }); field.append(caption, input); card.append(field);
      }
      $('generatedGroups').append(card);
    }
    groupSummary();
  }
  function groupSummary() { let total = 0, included = 0; for (const s of C.SECTIONS) { const g = state.draft.groups[s.key], terms = C.parseTerms(g.terms); $('groupCount_' + s.key).textContent = terms.length + ' عبارة'; if (g.include && terms.length) { total += terms.length; included++; } } $('generatedSummary').textContent = `${included} مجموعات محددة · ${total} عبارة`; }
  function syncDraft() { for (const input of document.querySelectorAll('[data-draft]')) input.value = state.draft[input.dataset.draft]; renderGroups(); }
  function generatedCategories() {
    const categories = [];
    for (const s of C.SECTIONS) {
      const g = state.draft.groups[s.key], terms = C.parseTerms(g.terms); if (!g.include || !terms.length) continue;
      if (terms.some(t => s.hashtag ? !C.validHashtag(t) : t.startsWith('#'))) throw Error(`راجع مجموعة «${s.label}»: توجد عبارة في غير موضعها أو هاشتاق غير صالح.`);
      categories.push(C.validateCategory({ id: C.id(), title: g.title, description: g.description.trim() || g.title, symbol: s.symbol, language: s.language, terms }));
    }
    if (!categories.length) throw Error('أدخل عبارات في مجموعة واحدة على الأقل، واختر تضمينها.'); return categories;
  }
  function saveGenerated(goSearch) { try { const incoming = generatedCategories(), result = C.mergeCategories(state.categories, incoming); state.categories = result.categories; if (goSearch) { state.selected = incoming.map(c => state.categories.find(x => C.key(x.title) === C.key(c.title) && (!x.language || x.language === c.language))?.id).filter(Boolean); state.extra = ''; syncSearchFields(); } changed(`أُضيفت المجموعات إلى المكتبة${result.merged ? ' مع دمج المتشابه' : ''}.`); if (goSearch) location.hash = 'search'; } catch (e) { toast(e.message); } }
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
      importResult = categories; $('importPreview').textContent = `النتيجة: ${categories.length} تصنيفًا من مكتبتك و${stagedFiles.length} ملف/ملفات. دُمج ${merged} تصنيفًا، وأُزيل ${duplicates} تكرارًا، وتغيّر ${renamed} اسمًا. النسخ الكاملة تُستورد هنا كتصنيفات فقط.`; $('applyImport').disabled = false;
    } catch (e) { $('importError').textContent = e.message; $('importError').hidden = false; $('importPreview').textContent = 'تعذّر تطبيق هذا الدمج. قلّل الملفات أو اختر دمج الأسماء المتشابهة.'; }
  }
  $('importFiles').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = ''; if (stagedFiles.length + files.length > 20) return toast('اختر حتى 20 ملفًا في عملية الدمج الواحدة.');
    importBusy = true; $('importFiles').disabled = true; updateImportPreview();
    const incoming = await Promise.all(files.map(async file => { try { if (file.size > C.MAX_FILE_BYTES) throw Error('أكبر من 8 ميغابايت'); const archive = C.parseArchive(await file.text()); return { name: file.name, categories: archive.categories }; } catch (error) { return { name: file.name, error: error.message }; } }));
    stagedFiles.push(...incoming); importBusy = false; $('importFiles').disabled = false; updateImportPreview();
  });
  $('applyImport').addEventListener('click', () => { if (!importResult || importBusy) return; state.categories = C.clone(importResult); closeDialog('importDialog'); changed('أُضيفت الملفات إلى مكتبتك. لم تُعدّل الملفات الأصلية.'); });
  $('restoreFile').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (file.size > C.MAX_FILE_BYTES) throw Error('حجم النسخة أكبر من 8 ميغابايت.'); const archive = C.parseArchive(await file.text());
      if (archive.format !== 'research-hunter-web-backup') throw Error('هذا ملف تصنيفات. استخدم استيراد ودمج لإضافته، أو اختر نسخة Web كاملة.');
      confirmAction('استعادة نسخة Web كاملة', 'ستستبدل الاستعادة المكتبة والمسودة وإعدادات البحث الحالية. سنجهّز نسخة من حالتك الحالية للتنزيل قبل الاستبدال.', () => {
        download(C.backupArchive(state), `research-hunter-web-before-restore-${dateStamp()}.json`);
        if (writeBlocked) try { download(storage.raw(), 'research-hunter-web-damaged-storage.json'); } catch {}
        state = C.clone(archive.state); writeBlocked = false; warn(''); syncSearchFields(); syncDraft(); changed('استُعيدت النسخة الكاملة.'); saveNow();
      }, `${archive.categories.length} تصنيفًا · ${archive.state.session ? 'تتضمن جولة بحث محفوظة' : 'لا توجد جولة بحث'} · ${archive.state.draft.topic || 'مسودة فارغة'}`);
    } catch (error) { toast(error.message); }
  });
  for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(button.dataset.close));
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open'); });
  $('confirmAction').addEventListener('click', () => { const action = pendingConfirm; pendingConfirm = null; closeDialog('confirmDialog'); if (action) action(); });
  for (const [field, name] of Object.entries(searchFields)) $(field).addEventListener('change', () => { state.options[name] = $(field).type === 'checkbox' ? $(field).checked : name === 'batchSize' ? Number($(field).value) : $(field).value; renderPlan(); scheduleSave(); });
  // Text filters update without waiting for blur.
  for (const field of ['account', 'searchExclude']) $(field).addEventListener('input', () => { state.options[searchFields[field]] = $(field).value; renderPlan(); scheduleSave(); });
  $('extraTerms').addEventListener('input', () => { state.extra = $('extraTerms').value; renderPlan(); scheduleSave(); });
  $('categoryFilter').addEventListener('input', renderChoices); $('libraryFilter').addEventListener('input', renderLibrary);
  $('selectVisible').addEventListener('click', () => { state.selected = [...new Set([...state.selected, ...filteredCategories($('categoryFilter').value).map(c => c.id)])]; changed(); });
  $('clearSelection').addEventListener('click', () => { state.selected = []; changed(); });
  $('startSearch').addEventListener('click', startSearch); $('previousBatch').addEventListener('click', () => openBatch(state.session.index - 1)); $('nextBatch').addEventListener('click', () => openBatch(state.session.index + 1)); $('reopenBatch').addEventListener('click', () => openBatch(state.session.index)); $('copyQuery').addEventListener('click', () => copy($('queryPreview').value));
  $('addCategory').addEventListener('click', () => editCategory());
  for (const name of ['quickBackup', 'downloadBackup']) $(name).addEventListener('click', exportBackup);
  for (const name of ['exportCategories', 'backupExportCategories']) $(name).addEventListener('click', exportCategories);
  $('selectAllForExport').addEventListener('click', () => { state.exportSelected = state.categories.map(c => c.id); renderLibrary(); scheduleSave(); });
  $('clearExportSelection').addEventListener('click', () => { state.exportSelected = []; renderLibrary(); scheduleSave(); });
  for (const name of ['openImport', 'backupImportCategories']) $(name).addEventListener('click', openImport);
  $('collisionMode').addEventListener('change', updateImportPreview); $('restoreBackup').addEventListener('click', () => $('restoreFile').click());
  $('downloadPrevious').addEventListener('click', () => { try { download(C.backupArchive(storage.previous()), 'research-hunter-web-previous.json'); toast('أُعدّت اللقطة السابقة للتنزيل.'); } catch (e) { toast(e.message || 'تعذرت قراءة النسخة المحلية.'); } });
  $('downloadRaw').addEventListener('click', () => { try { download(storage.raw(), 'research-hunter-web-raw-storage.json'); toast('أُعدّت بيانات التخزين الخام للتنزيل.'); } catch { toast('الوصول إلى تخزين المتصفح غير متاح.'); } });
  for (const input of document.querySelectorAll('[data-draft]')) input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => { const name = input.dataset.draft; state.draft[name] = input.value; if (name === 'topic') for (const s of C.SECTIONS) { const old = state.draft.groups[s.key]; if (!old.title || old.title === ((input.dataset.previous || '') + ' | ' + s.suffix).slice(0, 65)) { old.title = input.value ? (input.value + ' | ' + s.suffix).slice(0, 65) : ''; $('title_' + s.key).value = old.title; } } if (name === 'topic') input.dataset.previous = input.value; scheduleSave(); });
  $('generatePrompt').addEventListener('click', () => { try { state.draft.prompt = C.makePrompt(state.draft); $('prompt').value = state.draft.prompt; scheduleSave(); toast('البرومبت جاهز. انسخه إلى أداة الذكاء التي تختارها.'); } catch (e) { toast(e.message); $('topic').focus(); } });
  $('copyPrompt').addEventListener('click', () => copy($('prompt').value));
  $('parseReply').addEventListener('click', () => {
    const parse = () => { try { const result = C.parseResponse(state.draft.reply); for (const s of C.SECTIONS) { const g = state.draft.groups[s.key]; g.terms = result.groups[s.key].join('\n'); if (!g.title) g.title = (state.draft.topic || 'تصنيف جديد') + ' | ' + s.suffix; g.title = g.title.slice(0, 65); g.include = !!result.groups[s.key].length; } renderGroups(); scheduleSave(); $('parseInfo').textContent = `وُزّعت الإجابة.${result.invalid ? ` استُبعد ${result.invalid} هاشتاق غير صالح؛ راجعه في النص الأصلي.` : ''} راجع العبارات قبل الإضافة.`; toast('وُزّعت الإجابة على المجموعات.'); } catch (e) { toast(e.message); } };
    if (C.SECTIONS.some(s => state.draft.groups[s.key].terms.trim())) confirmAction('إعادة توزيع الإجابة', 'ستُستبدل عبارات المجموعات الحالية بنص الإجابة. تبقى أسماء التصنيفات وأوصافها.', parse); else parse();
  });
  $('newDraft').addEventListener('click', () => { const reset = () => { state.draft = C.defaultDraft(); syncDraft(); $('topic').dataset.previous = ''; scheduleSave(); toast('بدأت مسودة جديدة.'); }; if (state.draft.topic || state.draft.reply || C.SECTIONS.some(s => state.draft.groups[s.key].terms)) confirmAction('مسودة جديدة', 'ستُمسح المسودة الحالية. تبقى التصنيفات المضافة في المكتبة.', reset); else reset(); });
  $('saveGenerated').addEventListener('click', () => saveGenerated(false)); $('searchGenerated').addEventListener('click', () => saveGenerated(true));
  window.addEventListener('hashchange', () => { route(); window.scrollTo({ top: 0 }); }); window.addEventListener('pagehide', saveNow); document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('storage', e => { if (e.key === storage.name) { writeBlocked = true; warn('تغيّرت المكتبة في تبويب آخر. أوقفنا الحفظ هنا لتجنّب الكتابة فوقها. نزّل نسختك الحالية، ثم أعد تحميل الصفحة.'); saveNow(); } });
  syncSearchFields(); syncDraft(); renderOverview(); renderLibrary(); renderChoices(); renderPlan(); route();
  if (loaded.warning) warn(loaded.warning); if (loaded.blocked) saveNow(); else if (!loaded.state) saveNow();
})();
