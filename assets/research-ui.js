(function () {
  'use strict';
  window.HunterResearchUI = function (hooks) {
    const { C, $, node, getState, getLastValidOptions, savedPlan, changed, scheduleSave, toast, showDialog, closeDialog, confirmAction, xTab, download, planned, syncSearchFields, route } = hooks;
    let presetId = null, savedReviewSnapshot = null, activeCategoryId = '', activeTermKey = '', activeFilter = 'all', activeFind = '';
    const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
    const button = (text, action, className = 'button ghost small') => { const b = node('button', className, text); b.type = 'button'; b.addEventListener('click', action); return b; };
    const link = (text, url) => { const a = node('a', '', text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
    function textDownload(text, filename, type) {
      const url = URL.createObjectURL(new Blob([text], { type })), a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
    const category = () => getState().categories.find(c => c.id === $('reviewCategory').value);
    const currentTerm = () => category()?.terms.find(t => C.key(t) === $('reviewTerm').value);
    function filterTermsFor(c, filter, findText) {
      if (!c) return [];
      const reviews = new Map((c.reviews || []).map(r => [C.key(r.term), r])), find = C.key(findText);
      return c.terms.filter(t => {
        const status = reviews.get(C.key(t))?.status || 'candidate';
        return C.key(t).includes(find) && (filter === 'all' || filter === status || filter === 'hashtags' && t.startsWith('#') || filter === 'alerts' && C.inspectTerm(t).length);
      });
    }
    function isReviewDirty() {
      if (!savedReviewSnapshot) return false;
      return $('reviewStatus').value !== savedReviewSnapshot.status || $('reviewDate').value !== savedReviewSnapshot.checkedAt || $('reviewSource').value.trim() !== savedReviewSnapshot.sourceUrl || $('reviewNote').value !== savedReviewSnapshot.note;
    }
    function updateReviewDirty() { $('reviewDirtyBadge').hidden = !isReviewDirty(); }
    function guardDirty(proceed, revert = null, message = 'لديك تعديلات غير محفوظة لهذا المصطلح. هل تريد تجاهلها والانتقال؟') {
      if (!isReviewDirty()) return proceed();
      if (revert) revert();
      confirmAction('تعديلات غير محفوظة', message, () => { savedReviewSnapshot = null; updateReviewDirty(); proceed(); });
    }
    function confirmCloseReview() {
      if (!isReviewDirty()) return false;
      confirmAction('تعديلات غير محفوظة', 'لديك تعديلات غير محفوظة لهذا المصطلح. هل تريد تجاهلها وإغلاق المراجعة؟', () => { savedReviewSnapshot = null; updateReviewDirty(); closeDialog('reviewDialog', true); });
      return true;
    }
    function review(id, preferredTermKey = '') {
      const categories = getState().categories;
      if (!categories.length) return toast('لا توجد تصنيفات للمراجعة بعد.');
      const targetId = categories.some(c => c.id === id) ? id : categories[0].id;
      savedReviewSnapshot = null; updateReviewDirty();
      $('reviewCategory').replaceChildren(...categories.map(c => { const o = node('option', '', c.title); o.value = c.id; return o; }));
      $('reviewCategory').value = targetId; activeCategoryId = targetId; activeTermKey = ''; activeFilter = 'all'; activeFind = '';
      $('reviewFilter').value = 'all'; $('reviewFind').value = ''; renderReviewTerms(preferredTermKey); showDialog('reviewDialog');
    }
    function renderReviewTerms(preferred, preserveDirty = false) {
      const c = category(); if (!c) return;
      activeCategoryId = c.id; activeFilter = $('reviewFilter').value; activeFind = $('reviewFind').value;
      const report = C.qualityReport(c), reviews = new Map((c.reviews || []).map(r => [C.key(r.term), r]));
      $('reviewStats').replaceChildren(...[[report.active, 'عبارة فعّالة'], [report.reviewed, 'راجعتها ووجدتها ملائمة'], [report.excluded, 'مستبعدة'], [report.alerts.length, 'تحتاج فحصًا للصياغة']].map(([value, caption]) => { const s = node('div'); s.append(node('strong', '', value), node('span', '', caption)); return s; }));
      const oldSources = $('reviewAccountSources'); if (oldSources) oldSources.remove();
      if (c.accountSources?.length) {
        const details = node('details', 'account-source-details'); details.id = 'reviewAccountSources'; details.append(node('summary', '', 'شواهد الحسابات المقترحة المرفقة'));
        for (const a of c.accountSources) {
          const row = node('p'); row.append(link('@' + a.handle, 'https://x.com/' + a.handle));
          const metaParts = [a.note, a.observedAt].filter(Boolean);
          if (metaParts.length) row.append(document.createTextNode(' · ' + metaParts.join(' · ')));
          if (a.sourceUrl) row.append(document.createTextNode(' · '), link('الشاهد المقترح', a.sourceUrl));
          details.append(row);
        }
        $('reviewStats').after(details);
      }
      const selected = preferred !== undefined ? preferred : $('reviewTerm').value;
      const terms = filterTermsFor(c, activeFilter, activeFind);
      if ($('reviewVisibleCount')) $('reviewVisibleCount').textContent = terms.length;
      if ($('bulkApproveVisible')) $('bulkApproveVisible').disabled = !terms.length;
      if ($('bulkExcludeAlerts')) $('bulkExcludeAlerts').disabled = !terms.some(t => C.inspectTerm(t).length);
      if ($('bulkResetVisible')) $('bulkResetVisible').disabled = !terms.length;
      $('reviewTerm').replaceChildren(...terms.map(t => {
        const rev = reviews.get(C.key(t)), status = rev?.status, hasAlerts = C.inspectTerm(t).length > 0;
        const prefix = status === 'excluded' ? '✕ مستبعد · ' : status === 'reviewed' ? '✓ ملائم · ' : '• ';
        const tags = [hasAlerts ? '[تنبيه]' : '', rev?.sourceUrl ? '[شاهد]' : ''].filter(Boolean).join(' ');
        const o = node('option', '', prefix + t + (tags ? ' ' + tags : '')); o.value = C.key(t); o.dir = 'auto'; return o;
      }));
      if (selected && terms.some(t => C.key(t) === selected)) $('reviewTerm').value = selected;
      else if (terms.length) $('reviewTerm').selectedIndex = 0;
      if (!terms.length) { const o = node('option', '', 'لا توجد مصطلحات بهذا المرشح'); o.value = ''; $('reviewTerm').append(o); }
      if (preserveDirty && savedReviewSnapshot && savedReviewSnapshot.categoryId === c.id && savedReviewSnapshot.termKey === $('reviewTerm').value) {
        activeTermKey = $('reviewTerm').value;
        const index = $('reviewTerm').selectedIndex;
        $('reviewPrevious').disabled = !activeTermKey || index < 1;
        $('reviewNext').disabled = !activeTermKey || index >= $('reviewTerm').options.length - 1;
        return;
      }
      fillReview();
    }
    function fillReview() {
      const term = currentTerm(), c = category(), r = c?.reviews?.find(r => C.key(r.term) === C.key(term || ''));
      activeTermKey = $('reviewTerm').value;
      for (const control of $('termReviewForm').elements) control.disabled = !term;
      $('reviewStatus').value = r?.status || 'candidate'; $('reviewDate').value = r?.checkedAt || ''; $('reviewSource').value = r?.sourceUrl || ''; $('reviewNote').value = r?.note || ''; $('reviewError').hidden = true;
      savedReviewSnapshot = term ? { categoryId: c.id, termKey: activeTermKey, status: $('reviewStatus').value, checkedAt: $('reviewDate').value, sourceUrl: $('reviewSource').value.trim(), note: $('reviewNote').value } : null;
      updateReviewDirty();
      const reasons = term ? C.inspectTerm(term) : [];
      $('reviewAlerts').textContent = reasons.join(' · '); $('reviewAlerts').hidden = !reasons.length;
      const index = $('reviewTerm').selectedIndex; $('reviewPrevious').disabled = !term || index < 1; $('reviewNext').disabled = !term || index >= $('reviewTerm').options.length - 1;
      syncSourceLink();
      let termUrl = '';
      if (term) { try { termUrl = C.searchUrl('(' + C.literal(term) + ')'); } catch { termUrl = ''; } }
      $('reviewXLink').hidden = !termUrl; $('reviewSearchX').disabled = !termUrl;
      if (termUrl) $('reviewXLink').href = termUrl; else $('reviewXLink').removeAttribute('href');
    }
    function syncSourceLink() {
      try { const url = C.sourceUrl($('reviewSource').value.trim()); $('reviewSourceLink').hidden = !url; if (url) $('reviewSourceLink').href = url; }
      catch { $('reviewSourceLink').hidden = true; $('reviewSourceLink').removeAttribute('href'); }
    }
    function saveCurrentReview(overrideStatus = null, advanceNext = false) {
      const c = category(), term = currentTerm(); if (!c || !term) return;
      try {
        const status = overrideStatus || $('reviewStatus').value;
        const nextOption = advanceNext ? ($('reviewTerm').options[$('reviewTerm').selectedIndex + 1]?.value || '') : C.key(term);
        const entry = { term, status, sourceUrl: $('reviewSource').value.trim(), checkedAt: $('reviewDate').value || (status === 'candidate' ? '' : today()), note: $('reviewNote').value };
        const updated = C.validateCategory({ ...c, reviews: [...(c.reviews || []).filter(r => C.key(r.term) !== C.key(term)), entry] });
        getState().categories = getState().categories.map(x => x.id === c.id ? updated : x);
        savedReviewSnapshot = null; updateReviewDirty();
        const statusMsg = status === 'excluded' ? 'استُبعد المصطلح من البحث والتصدير للإضافة.' : status === 'reviewed' ? 'سُجّل المصطلح ملائمًا.' : 'حُفظت المراجعة.';
        changed(advanceNext && !nextOption ? `${statusMsg} وصلتَ إلى نهاية هذه القائمة.` : statusMsg);
        renderReviewTerms(advanceNext ? (nextOption || C.key(term)) : C.key(term));
      } catch (error) { $('reviewError').textContent = error.message; $('reviewError').hidden = false; }
    }
    const reviewXLink = link('رابط بحث المصطلح', 'https://x.com/search'); reviewXLink.id = 'reviewXLink'; $('termReviewForm').querySelector('.actions').append(reviewXLink);
    for (const id of ['reviewStatus', 'reviewDate', 'reviewSource', 'reviewNote']) $(id).addEventListener(id === 'reviewStatus' || id === 'reviewDate' ? 'change' : 'input', updateReviewDirty);
    $('reviewCategory').addEventListener('change', () => {
      const target = $('reviewCategory').value;
      if (target === activeCategoryId) return;
      guardDirty(() => { $('reviewCategory').value = target; activeCategoryId = target; renderReviewTerms(''); }, () => { $('reviewCategory').value = activeCategoryId; }, 'لديك تعديلات غير محفوظة لهذا المصطلح. هل تريد تجاهلها وتغيير التصنيف؟');
    });
    $('reviewFilter').addEventListener('change', () => {
      const target = $('reviewFilter').value;
      if (target === activeFilter) return;
      if (activeTermKey && filterTermsFor(category(), target, activeFind).some(t => C.key(t) === activeTermKey)) { activeFilter = target; renderReviewTerms(activeTermKey, true); return; }
      guardDirty(() => { $('reviewFilter').value = target; activeFilter = target; renderReviewTerms(''); }, () => { $('reviewFilter').value = activeFilter; }, 'لديك تعديلات غير محفوظة لهذا المصطلح، والمرشح الجديد سيُخفيه. هل تريد تجاهل التعديلات والمتابعة؟');
    });
    $('reviewFind').addEventListener('input', () => {
      const target = $('reviewFind').value;
      if (target === activeFind) return;
      if (activeTermKey && filterTermsFor(category(), activeFilter, target).some(t => C.key(t) === activeTermKey)) { activeFind = target; renderReviewTerms(activeTermKey, true); return; }
      guardDirty(() => { $('reviewFind').value = target; activeFind = target; renderReviewTerms(''); }, () => { $('reviewFind').value = activeFind; }, 'لديك تعديلات غير محفوظة لهذا المصطلح، والبحث الجديد سيُخفيه. هل تريد تجاهل التعديلات والمتابعة؟');
    });
    $('reviewTerm').addEventListener('change', () => {
      const target = $('reviewTerm').value;
      if (target === activeTermKey) return;
      guardDirty(() => { $('reviewTerm').value = target; fillReview(); }, () => { $('reviewTerm').value = activeTermKey; });
    });
    $('reviewDialog').addEventListener('cancel', e => { if (!isReviewDirty()) return; e.preventDefault(); confirmCloseReview(); });
    $('reviewDialog').addEventListener('close', () => { savedReviewSnapshot = null; updateReviewDirty(); });
    $('reviewSource').addEventListener('input', syncSourceLink);
    for (const [id, delta] of [['reviewPrevious', -1], ['reviewNext', 1]]) $(id).addEventListener('click', () => {
      const next = $('reviewTerm').selectedIndex + delta;
      if (next >= 0 && next < $('reviewTerm').options.length) guardDirty(() => { $('reviewTerm').selectedIndex = next; fillReview(); });
    });
    $('reviewSearchX').addEventListener('click', () => {
      const term = currentTerm(); if (!term) return;
      try { toast(xTab.navigate(C.searchUrl('(' + C.literal(term) + ')')) ? 'فُتح بحث المصطلح للمراجعة اليدوية. احفظ حكمك بعد العودة.' : 'تعذر فتح التبويب. استخدم رابط بحث المصطلح.'); }
      catch (error) { toast(error.message); }
    });
    $('termReviewForm').addEventListener('submit', e => { e.preventDefault(); saveCurrentReview(null, false); });
    $('reviewApproveNext').addEventListener('click', () => saveCurrentReview('reviewed', true));
    $('reviewExcludeNext').addEventListener('click', () => saveCurrentReview('excluded', true));
    function runBulkReview(status, onlyAlerts, title, summaryText) {
      const c = category(); if (!c) return;
      const visible = filterTermsFor(c, activeFilter, activeFind);
      const targets = onlyAlerts ? visible.filter(t => C.inspectTerm(t).length) : visible;
      if (!targets.length) return toast('لا توجد مصطلحات مطابقة لتطبيق الإجراء الجماعي.');
      const dirtyPrefix = isReviewDirty() ? 'لديك تعديلات غير محفوظة في نموذج المصطلح الحالي ستُتجاهل عند المتابعة. ' : '';
      confirmAction(title, `${dirtyPrefix}سيُطبَّق «${summaryText}» على ${targets.length} مصطلحًا ظاهرًا في القائمة الحالية مع الحفاظ على الملاحظات والشواهد المحفوظة سابقًا.`, () => {
        const result = C.bulkUpdateReviews(c, targets, status, status === 'candidate' ? '' : today());
        getState().categories = getState().categories.map(x => x.id === c.id ? result.category : x);
        savedReviewSnapshot = null; updateReviewDirty();
        changed(`حُدّث ${result.updatedCount} مصطلحًا (${summaryText}).`);
        renderReviewTerms(activeTermKey);
      });
    }
    if ($('bulkApproveVisible')) $('bulkApproveVisible').addEventListener('click', () => runBulkReview('reviewed', false, 'اعتماد القائمة الظاهرة', 'ملائم بعد مراجعتي'));
    if ($('bulkExcludeAlerts')) $('bulkExcludeAlerts').addEventListener('click', () => runBulkReview('excluded', true, 'استبعاد ذوات التنبيهات', 'مستبعد من البحث'));
    if ($('bulkResetVisible')) $('bulkResetVisible').addEventListener('click', () => runBulkReview('candidate', false, 'إعادة إلى مقترح', 'مقترح يحتاج مراجعة'));

    const presetSchema = [
      ['accounts', 'من حساب أو عدة حسابات', 'textarea'], ['exclude', 'عبارات مستبعدة', 'textarea'], ['required', 'عبارات يجب وجودها جميعًا', 'input'],
      ['language', 'لغة النتائج', [['all', 'كل اللغات'], ['ar', 'العربية'], ['en', 'الإنجليزية']]],
      ['since', 'من تاريخ', 'date'], ['until', 'إلى تاريخ (غير مشمول)', 'date'],
      ['match', 'مطابقة العبارة', [['exact', 'عبارة دقيقة بالترتيب'], ['words', 'كل كلمات العبارة بأي ترتيب']]],
      ['type', 'عرض النتائج', [['latest', 'الأحدث'], ['top', 'الأبرز'], ['users', 'الحسابات'], ['media', 'الوسائط']]],
      ['batchSize', 'عبارات في الدفعة', [['4', '4'], ['8', '8'], ['12', '12'], ['20', '20']]],
      ['noReplies', 'استبعاد الردود', 'checkbox'], ['noReposts', 'استبعاد إعادة النشر', 'checkbox']
    ];
    for (const [name, label, type] of presetSchema) {
      const field = node('div', 'field'), caption = node('label', '', label), input = node(Array.isArray(type) ? 'select' : type === 'textarea' ? 'textarea' : 'input'); input.id = 'preset_' + name; caption.htmlFor = input.id;
      if (Array.isArray(type)) for (const [value, text] of type) { const option = node('option', '', text); option.value = value; input.append(option); }
      else if (type !== 'textarea') input.type = type === 'input' ? 'text' : type;
      if (type === 'textarea') { input.rows = 2; input.maxLength = 1000; }
      if (name === 'accounts') input.dir = 'ltr'; if (name === 'required') input.maxLength = 500;
      if (type === 'checkbox') field.classList.add('preset-check'); field.append(caption, input); $('presetFields').append(field);
    }
    function preset(id) {
      const c = getState().categories.find(c => c.id === id); if (!c) return; presetId = id;
      let options;
      try { options = C.normalizeOptions(c.preset || getState().options); }
      catch { options = C.normalizeOptions(getLastValidOptions ? getLastValidOptions() : undefined); }
      $('presetCategoryName').textContent = c.title; $('presetError').hidden = true;
      for (const [name, , type] of presetSchema) { const el = $('preset_' + name); if (type === 'checkbox') el.checked = options[name]; else el.value = name === 'accounts' ? options.accounts.join(', ') : options[name]; }
      $('removePreset').disabled = !c.preset; showDialog('presetDialog');
    }
    function applyPreset(c) {
      const state = getState(); state.options = C.normalizeOptions(c.preset); state.selected = [c.id]; syncSearchFields(); changed('حُمّل قالب «' + c.title + '». راجع العبارات الإضافية قبل البدء.'); location.hash = 'search'; route();
    }
    function savePreset(use) {
      try {
        const c = getState().categories.find(c => c.id === presetId); if (!c) return;
        const raw = {}; for (const [name, , type] of presetSchema) raw[name] = type === 'checkbox' ? $('preset_' + name).checked : $('preset_' + name).value;
        const options = C.normalizeOptions(raw); C.buildPlan(['اختبار'], options);
        const updated = C.validateCategory({ ...c, preset: options }); getState().categories = getState().categories.map(x => x.id === c.id ? updated : x); closeDialog('presetDialog'); changed('حُفظ قالب البحث.'); if (use) applyPreset(updated);
      } catch (error) { $('presetError').textContent = error.message; $('presetError').hidden = false; }
    }
    $('presetForm').addEventListener('submit', e => { e.preventDefault(); savePreset(false); }); $('useEditedPreset').addEventListener('click', () => savePreset(true));
    $('removePreset').addEventListener('click', () => { const c = getState().categories.find(c => c.id === presetId); if (!c) return; confirmAction('حذف قالب البحث', 'سيُحذف قالب الإعدادات لهذا التصنيف فقط. تبقى العبارات والمراجعات.', () => { const { preset, ...rest } = c; getState().categories = getState().categories.map(x => x.id === c.id ? rest : x); closeDialog('presetDialog'); changed('حُذف القالب المحفوظ.'); }); });
    $('loadPreset').addEventListener('click', () => { const c = getState().categories.find(c => c.id === $('savedPreset').value && c.preset); if (c) applyPreset(c); else toast('اختر قالبًا محفوظًا أولًا.'); });
    $('saveCurrentPreset').addEventListener('click', () => {
      const state = getState(); if (state.selected.length !== 1) return toast('حدّد تصنيفًا واحدًا لحفظ إعداداته. يمكنك جمع تصنيفات بعد تحميل القالب.');
      try { const options = C.normalizeOptions(state.options); C.buildPlan(['اختبار'], options); state.categories = state.categories.map(c => c.id === state.selected[0] ? C.validateCategory({ ...c, preset: options }) : c); changed('حُفظت إعدادات البحث للتصنيف المحدد.'); } catch (error) { toast(error.message); }
    });
    $('exportWebLibrary').addEventListener('click', () => { try { download(C.webLibraryArchive(getState().categories, getState().exportSelected), 'research-hunter-web-library.json'); toast('أُعدّت مكتبة Web مع المراجعات والقوالب.'); } catch (error) { toast(error.message); } });

    const planExportLabel = node('p', 'micro-note export-group-label', 'تصدير دفعات الاختيارات الحالية');
    const exportActions = node('div', 'actions plan-exports'), csv = button('CSV الاختيارات الحالية', () => exportBatches(planned, 'csv', 'research-hunter-search-batches')), urls = button('روابط الاختيارات الحالية', () => exportBatches(planned, 'txt', 'research-hunter-search-batches'));
    exportActions.append(csv, urls); $('researchSearchTools').append(planExportLabel, exportActions);
    const sampleDetails = node('details', 'sample-entry'), summary = node('summary', '', 'تسجيل فائدة عينة راجعتها'), sampleForm = node('form'); sampleForm.id = 'sampleForm'; sampleDetails.append(summary, sampleForm);
    for (const [name, caption, type, max] of [['sampleLabel', 'اسم التجربة (مثل: البرومبت الحالي / المحسّن)', 'text', 65], ['sampleReviewed', 'عدد المنشورات التي راجعتها', 'number', 10000], ['sampleRelevant', 'عدد المنشورات الملائمة منها', 'number', 10000], ['sampleNote', 'ملاحظات العينة والفترة', 'text', 1000]]) {
      const field = node('div', 'field'), label = node('label', '', caption), input = node('input'); input.id = name; input.type = type; label.htmlFor = name; if (type === 'number') { input.min = name === 'sampleReviewed' ? '1' : '0'; input.max = max; input.step = '1'; } else input.maxLength = max; input.required = name !== 'sampleNote'; field.append(label, input); sampleForm.append(field);
    }
    const saveSample = node('button', 'button ghost full', 'حفظ مراجعة العينة'); saveSample.type = 'submit'; sampleForm.append(saveSample, node('p', 'micro-note', 'يُربط السجل بالدفعة الحالية. الأعداد تدخلها أنت؛ لا نقرأ نتائج X أو نحسب انتشار الوسوم.')); $('researchSearchTools').append(sampleDetails, button('سجل مراجعات النتائج', () => { renderSamples(); showDialog('samplesDialog'); }, 'text-button full'));
    function exportBatches(getPlan, format, baseName) {
      try {
        const planObj = typeof getPlan === 'function' ? getPlan() : getPlan;
        if (!planObj || !planObj.batches.length) throw Error('لا توجد دفعات جاهزة للتصدير.');
        textDownload(format === 'csv' ? C.planCSV(planObj) : planObj.batches.map(b => b.url).join('\r\n'), baseName + '.' + format, format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8');
      } catch (error) { toast(error.message); }
    }
    if ($('exportSessionCsv')) $('exportSessionCsv').addEventListener('click', () => exportBatches(savedPlan, 'csv', 'research-hunter-session-batches'));
    if ($('exportSessionUrls')) $('exportSessionUrls').addEventListener('click', () => exportBatches(savedPlan, 'txt', 'research-hunter-session-batches'));
    sampleForm.addEventListener('submit', e => {
      e.preventDefault(); const state = getState();
      try {
        if (!state.session) throw Error('ابدأ جولة بحث حتى تُربط العينة بدفعتها الحالية.');
        if (state.samples.length >= 100) throw Error('بلغ السجل 100 مراجعة. صدّره ثم احذف سجلًا قديمًا قبل إضافة آخر.');
        const plan = C.buildPlan(state.session.terms, state.session.options), batch = plan.batches[state.session.index];
        const item = C.validateSample({ label: $('sampleLabel').value, reviewed: Number($('sampleReviewed').value), relevant: Number($('sampleRelevant').value), note: $('sampleNote').value, query: batch.query, type: plan.options.type });
        state.samples.push(item); scheduleSave(); $('sampleReviewed').value = ''; $('sampleRelevant').value = ''; renderSamples(); toast('سُجلت ملاءمة العينة التي راجعتها.');
      } catch (error) { toast(error.message); }
    });
    function renderSamples() {
      const items = getState().samples; $('sampleRecords').replaceChildren();
      const summary = C.summarizeSamples(items);
      const compSection = $('sampleComparisonSection'), compRows = $('sampleComparisonRows'), labelFilter = $('sampleLabelFilter');
      if (compSection && compRows) {
        compRows.replaceChildren();
        compSection.hidden = !summary.length;
        for (const group of summary) {
          const tr = node('tr');
          const nameCell = node('th'); nameCell.scope = 'row'; nameCell.append(node('bdi', '', group.label));
          tr.append(nameCell, node('td', '', group.entries), node('td', '', group.reviewed), node('td', '', group.relevant), node('td', 'compare-pct', group.percentage + '%'));
          compRows.append(tr);
        }
      }
      let selectedLabel = '';
      if (labelFilter) {
        const prev = labelFilter.value;
        const allOpt = node('option', '', 'كل التجارب'); allOpt.value = '';
        labelFilter.replaceChildren(allOpt, ...summary.map(g => { const o = node('option', '', `${g.label} (${g.entries})`); o.value = g.key; return o; }));
        selectedLabel = summary.some(g => g.key === prev) ? prev : '';
        labelFilter.value = selectedLabel;
      }
      if ($('exportSamples')) $('exportSamples').disabled = !items.length;
      if ($('exportSamplesSummary')) $('exportSamplesSummary').disabled = !summary.length;
      if (!items.length) { $('sampleRecords').append(node('p', 'body-copy', 'لم تسجّل مراجعة نتائج بعد. ابدأ البحث ثم افتح «تسجيل فائدة عينة راجعتها» في لوحة الجولة.')); return; }
      const visibleItems = selectedLabel ? items.filter(s => C.key(s.label) === selectedLabel) : items;
      for (const sample of [...visibleItems].reverse()) {
        const row = node('article', 'sample-record'), percentage = Math.round(sample.relevant / sample.reviewed * 100); row.append(node('h3', '', sample.label), node('strong', '', `${sample.relevant} من ${sample.reviewed} ملائم · ${percentage}% من العينة المراجعة`), node('p', '', sample.note), node('small', '', new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sample.recordedAt))));
        const details = node('details'), title = node('summary', '', 'استعلام العينة'); const query = node('p', 'sample-query', sample.query); query.dir = 'ltr'; details.append(title, query, link('افتح البحث نفسه في X', C.searchUrl(sample.query, sample.type))); row.append(details, button('حذف السجل', () => confirmAction('حذف سجل مراجعة', 'سيُحذف سجل هذه العينة فقط. يمكنك تصدير السجل كاملًا أولًا.', () => { getState().samples = getState().samples.filter(s => s.id !== sample.id); scheduleSave(); renderSamples(); }), 'text-button')); $('sampleRecords').append(row);
      }
    }
    if ($('sampleLabelFilter')) $('sampleLabelFilter').addEventListener('change', renderSamples);
    $('exportSamples').addEventListener('click', () => { const samples = getState().samples; if (!samples.length) return toast('لا توجد مراجعات للتصدير.'); const rows = [['التجربة', 'راجعت', 'ملائم', 'نسبة العينة', 'التاريخ', 'الاستعلام', 'الملاحظات'], ...samples.map(s => [s.label, s.reviewed, s.relevant, Math.round(s.relevant / s.reviewed * 100) + '%', s.recordedAt, s.query, s.note])]; textDownload('\ufeff' + rows.map(row => row.map(C.csvCell).join(',')).join('\r\n'), 'research-hunter-reviewed-samples.csv', 'text/csv;charset=utf-8'); });
    if ($('exportSamplesSummary')) $('exportSamplesSummary').addEventListener('click', () => { const summary = C.summarizeSamples(getState().samples); if (!summary.length) return toast('لا توجد تجارب للتصدير.'); textDownload(C.samplesSummaryCSV(summary), 'research-hunter-experiment-comparison.csv', 'text/csv;charset=utf-8'); });

    function renderOverlap() {
      const report = C.analyzeLibraryOverlap(getState().categories);
      $('overlapStats').replaceChildren(...[
        [report.overlaps.length, 'مصطلحات متداخلة'],
        [report.conflictCount, 'تعارضات استبعاد'],
        [report.uniqueActiveTerms, 'عبارة فريدة فعّالة'],
        [report.alertTermsCount, 'عبارات بتحذيرات']
      ].map(([value, caption]) => { const s = node('div'); s.append(node('strong', '', value), node('span', '', caption)); return s; }));
      const mode = $('overlapFilter').value;
      const items = mode === 'conflicts' ? report.overlaps.filter(x => x.conflict) : report.overlaps;
      const holder = $('overlapList'); holder.replaceChildren();
      if (!items.length) {
        const empty = node('div', 'empty-state');
        empty.append(node('h3', '', mode === 'conflicts' ? 'لا توجد تعارضات استبعاد' : 'ممتاز! لا توجد مصطلحات مكررة بين تصنيفاتك'), node('p', '', mode === 'conflicts' ? 'جميع المصطلحات المشتركة متسقة في حالة الاستبعاد أو التفعيل.' : 'كل مصطلح في مكتبتك ينتمي لتصنيف واحد حاليًا.'));
        holder.append(empty);
        return;
      }
      const statusLabel = s => ({ reviewed: 'ملائم', excluded: 'مستبعد', candidate: 'مقترح' }[s] || 'مقترح');
      for (const item of items) {
        const card = node('article', 'overlap-card' + (item.conflict ? ' overlap-conflict' : ''));
        const head = node('div', 'overlap-head'), termEl = node('bdi', 'overlap-term', item.term);
        head.append(termEl);
        if (item.conflict) head.append(node('span', 'pill warning-pill', 'تعارض استبعاد'));
        else head.append(node('span', 'pill', `في ${item.categories.length} تصنيفات`));
        const list = node('div', 'overlap-cats');
        for (const catEntry of item.categories) {
          const row = node('div', 'overlap-cat-row');
          const statusBadge = node('span', 'status-tag status-' + catEntry.status, statusLabel(catEntry.status));
          const jump = button('مراجعة', () => { closeDialog('overlapDialog'); review(catEntry.id, item.key); }, 'text-button');
          jump.setAttribute('aria-label', `مراجعة ${item.term} في ${catEntry.title}`);
          row.append(node('span', 'overlap-cat-name', catEntry.title), statusBadge, jump);
          list.append(row);
        }
        card.append(head, list);
        holder.append(card);
      }
    }
    if ($('openOverlap')) $('openOverlap').addEventListener('click', () => { $('overlapFilter').value = 'all'; renderOverlap(); showDialog('overlapDialog'); });
    if ($('overlapFilter')) $('overlapFilter').addEventListener('change', renderOverlap);

    function renderDraftEvidence() {
      const d = getState().draft, holder = $('draftEvidenceBody'); holder.replaceChildren(); $('draftEvidence').hidden = !(d.evidence.length || d.accounts.length || d.exclusions.length);
      if (d.evidence.length) holder.append(node('p', 'body-copy', `${d.evidence.length} مصطلحًا له ملاحظات أو شواهد مقترحة. تُحفظ مع التصنيفات؛ راجعها من زر «إضافة ومراجعة المصطلحات».`));
      for (const account of d.accounts) {
        const row = node('div', 'account-suggestion'), label = node('label'), check = node('input'); check.type = 'checkbox'; check.checked = d.selectedAccounts.includes(account.handle); check.setAttribute('aria-label', 'استخدام الحساب ' + account.handle);
        label.append(check, node('bdi', '', '@' + account.handle)); row.append(label, link('افتح الحساب', 'https://x.com/' + account.handle));
        if (account.sourceUrl) row.append(link('الشاهد المقترح', account.sourceUrl)); else row.append(node('small', '', 'دون شاهد مرفق'));
        row.append(node('p', '', account.note || 'راجع هوية الحساب وصلته بموضوعك.'), node('small', '', account.observedAt ? 'تاريخ الشاهد المقترح: ' + account.observedAt : 'تاريخ غير مرفق'));
        check.addEventListener('change', () => { if (check.checked && d.selectedAccounts.length >= 10) { check.checked = false; return toast('يمكن اختيار حتى 10 حسابات للبحث.'); } d.selectedAccounts = check.checked ? [...d.selectedAccounts, account.handle] : d.selectedAccounts.filter(h => h !== account.handle); scheduleSave(); }); holder.append(row);
      }
      if (d.exclusions.length) { const label = node('label', 'suggested-exclusions'), check = node('input'); check.type = 'checkbox'; check.checked = d.useExclusions; check.addEventListener('change', () => { d.useExclusions = check.checked; scheduleSave(); }); label.append(check, node('span', '', 'استخدم الاستبعادات المقترحة: ' + d.exclusions.join('، '))); holder.append(label); }
      holder.append(node('p', 'micro-note', 'اختيار حساب هنا يضيفه لمرشح البحث، ولا يمنحه وصف «موثوق». عند الانتقال للبحث تبدأ بإعدادات جديدة مع الحسابات والاستبعادات التي اخترتها، وتُحفظ هذه الاختيارات في قوالب التصنيفات الجديدة.'));
    }
    function refresh(plan) {
      const state = getState(), current = $('savedPreset').value;
      const placeholder = node('option', '', 'اختر تصنيفًا له قالب محفوظ'); placeholder.value = '';
      const withPreset = state.categories.filter(c => c.preset);
      $('savedPreset').replaceChildren(placeholder, ...withPreset.map(c => { const o = node('option', '', c.title); o.value = c.id; return o; }));
      $('savedPreset').value = withPreset.some(c => c.id === current) ? current : '';
      $('saveCurrentPreset').disabled = state.selected.length !== 1; $('loadPreset').disabled = !withPreset.length;
      const chosen = state.categories.filter(c => state.selected.includes(c.id)), excluded = chosen.reduce((sum, c) => sum + c.terms.length - C.activeTerms(c).length, 0), alerts = chosen.flatMap(C.activeTerms).filter(t => C.inspectTerm(t).length).length;
      $('planReviewSummary').textContent = `${excluded} عبارة مستبعدة بمراجعتك${alerts ? ` · ${alerts} عبارة تستحق فحص الصياغة من المكتبة` : ''}`;
      csv.disabled = urls.disabled = !plan?.batches.length;
      sampleDetails.hidden = !state.session;
    }
    return { review, preset, refresh, renderDraftEvidence, confirmCloseReview };
  };
})();
