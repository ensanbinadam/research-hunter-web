(function () {
  'use strict';
  window.HunterResearchUI = function (hooks) {
    const { C, $, node, getState, changed, scheduleSave, toast, showDialog, closeDialog, confirmAction, xTab, download, planned, syncSearchFields, route } = hooks;
    let presetId = null;
    const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
    const button = (text, action, className = 'button ghost small') => { const b = node('button', className, text); b.type = 'button'; b.addEventListener('click', action); return b; };
    const link = (text, url) => { const a = node('a', '', text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
    function textDownload(text, filename, type) {
      const url = URL.createObjectURL(new Blob([text], { type })), a = node('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
    }
    const category = () => getState().categories.find(c => c.id === $('reviewCategory').value);
    const currentTerm = () => category()?.terms.find(t => C.key(t) === $('reviewTerm').value);
    function review(id) {
      $('reviewCategory').replaceChildren(...getState().categories.map(c => { const o = node('option', '', c.title); o.value = c.id; return o; }));
      $('reviewCategory').value = id; $('reviewFilter').value = 'all'; $('reviewFind').value = ''; renderReviewTerms(); showDialog('reviewDialog');
    }
    function renderReviewTerms(preferred) {
      const c = category(); if (!c) return;
      const report = C.qualityReport(c), reviews = new Map((c.reviews || []).map(r => [C.key(r.term), r]));
      $('reviewStats').replaceChildren(...[[report.active, 'عبارة فعّالة'], [report.reviewed, 'راجعتها ووجدتها ملائمة'], [report.excluded, 'مستبعدة'], [report.alerts.length, 'تحتاج فحصًا للصياغة']].map(([value, caption]) => { const s = node('div'); s.append(node('strong', '', value), node('span', '', caption)); return s; }));
      const oldSources = $('reviewAccountSources'); if (oldSources) oldSources.remove();
      if (c.accountSources?.length) { const details = node('details', 'account-source-details'); details.id = 'reviewAccountSources'; details.append(node('summary', '', 'شواهد الحسابات المقترحة المرفقة')); for (const a of c.accountSources) { const row = node('p'); row.append(link('@' + a.handle, 'https://x.com/' + a.handle), document.createTextNode(' · ' + a.note + (a.observedAt ? ' · ' + a.observedAt : ''))); if (a.sourceUrl) row.append(document.createTextNode(' · '), link('الشاهد المقترح', a.sourceUrl)); details.append(row); } $('reviewStats').after(details); }
      const selected = preferred || $('reviewTerm').value, filter = $('reviewFilter').value, find = C.key($('reviewFind').value);
      const terms = c.terms.filter(t => {
        const status = reviews.get(C.key(t))?.status || 'candidate';
        return C.key(t).includes(find) && (filter === 'all' || filter === status || filter === 'hashtags' && t.startsWith('#') || filter === 'alerts' && C.inspectTerm(t).length);
      });
      $('reviewTerm').replaceChildren(...terms.map(t => { const status = reviews.get(C.key(t))?.status; const o = node('option', '', (status === 'excluded' ? 'مستبعد · ' : status === 'reviewed' ? 'راجعتُه · ' : '') + t); o.value = C.key(t); o.dir = 'auto'; return o; }));
      if (terms.some(t => C.key(t) === selected)) $('reviewTerm').value = selected;
      else if (terms.length) $('reviewTerm').selectedIndex = 0;
      if (!terms.length) { const o = node('option', '', 'لا توجد مصطلحات بهذا المرشح'); o.value = ''; $('reviewTerm').append(o); }
      fillReview();
    }
    function fillReview() {
      const term = currentTerm(), c = category(), r = c?.reviews?.find(r => C.key(r.term) === C.key(term || ''));
      for (const control of $('termReviewForm').elements) control.disabled = !term;
      $('reviewStatus').value = r?.status || 'candidate'; $('reviewDate').value = r?.checkedAt || ''; $('reviewSource').value = r?.sourceUrl || ''; $('reviewNote').value = r?.note || ''; $('reviewError').hidden = true;
      const reasons = term ? C.inspectTerm(term) : [];
      $('reviewAlerts').textContent = reasons.join(' · '); $('reviewAlerts').hidden = !reasons.length;
      const index = $('reviewTerm').selectedIndex; $('reviewPrevious').disabled = !term || index < 1; $('reviewNext').disabled = !term || index >= $('reviewTerm').options.length - 1;
      syncSourceLink();
      $('reviewXLink').hidden = !term; if (term) $('reviewXLink').href = C.searchUrl('(' + C.literal(term) + ')');
    }
    function syncSourceLink() {
      try { const url = C.sourceUrl($('reviewSource').value.trim()); $('reviewSourceLink').hidden = !url; if (url) $('reviewSourceLink').href = url; }
      catch { $('reviewSourceLink').hidden = true; $('reviewSourceLink').removeAttribute('href'); }
    }
    const reviewXLink = link('رابط بحث المصطلح', 'https://x.com/search'); reviewXLink.id = 'reviewXLink'; $('termReviewForm').querySelector('.actions').append(reviewXLink);
    $('reviewCategory').addEventListener('change', () => renderReviewTerms()); $('reviewFilter').addEventListener('change', () => renderReviewTerms()); $('reviewFind').addEventListener('input', () => renderReviewTerms()); $('reviewTerm').addEventListener('change', fillReview); $('reviewSource').addEventListener('input', syncSourceLink);
    for (const [id, delta] of [['reviewPrevious', -1], ['reviewNext', 1]]) $(id).addEventListener('click', () => { const next = $('reviewTerm').selectedIndex + delta; if (next >= 0 && next < $('reviewTerm').options.length) { $('reviewTerm').selectedIndex = next; fillReview(); } });
    $('reviewSearchX').addEventListener('click', () => { const term = currentTerm(); if (term) toast(xTab.navigate(C.searchUrl('(' + C.literal(term) + ')')) ? 'فُتح بحث المصطلح للمراجعة اليدوية. احفظ حكمك بعد العودة.' : 'تعذر فتح التبويب. استخدم رابط بحث المصطلح.'); });
    $('termReviewForm').addEventListener('submit', e => {
      e.preventDefault(); const c = category(), term = currentTerm(); if (!c || !term) return;
      try {
        const status = $('reviewStatus').value, entry = { term, status, sourceUrl: $('reviewSource').value.trim(), checkedAt: $('reviewDate').value || (status === 'candidate' ? '' : today()), note: $('reviewNote').value };
        const updated = C.validateCategory({ ...c, reviews: [...(c.reviews || []).filter(r => C.key(r.term) !== C.key(term)), entry] });
        getState().categories = getState().categories.map(x => x.id === c.id ? updated : x); changed('حُفظت المراجعة؛ المستبعد لا يدخل البحث أو تصدير الإضافة.'); renderReviewTerms(C.key(term));
      } catch (error) { $('reviewError').textContent = error.message; $('reviewError').hidden = false; }
    });

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
      const options = C.normalizeOptions(c.preset || getState().options); $('presetCategoryName').textContent = c.title; $('presetError').hidden = true;
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

    const exportActions = node('div', 'actions plan-exports'), csv = button('تنزيل الدفعات CSV', () => exportPlan('csv')), urls = button('تنزيل روابط الدفعات', () => exportPlan('txt'));
    exportActions.append(csv, urls); $('researchSearchTools').append(exportActions);
    const sampleDetails = node('details', 'sample-entry'), summary = node('summary', '', 'تسجيل فائدة عينة راجعتها'), sampleForm = node('form'); sampleForm.id = 'sampleForm'; sampleDetails.append(summary, sampleForm);
    for (const [name, caption, type, max] of [['sampleLabel', 'اسم التجربة (مثل: البرومبت الحالي / المحسّن)', 'text', 65], ['sampleReviewed', 'عدد المنشورات التي راجعتها', 'number', 10000], ['sampleRelevant', 'عدد المنشورات الملائمة منها', 'number', 10000], ['sampleNote', 'ملاحظات العينة والفترة', 'text', 1000]]) {
      const field = node('div', 'field'), label = node('label', '', caption), input = node('input'); input.id = name; input.type = type; label.htmlFor = name; if (type === 'number') { input.min = name === 'sampleReviewed' ? '1' : '0'; input.max = max; input.step = '1'; } else input.maxLength = max; input.required = name !== 'sampleNote'; field.append(label, input); sampleForm.append(field);
    }
    const saveSample = node('button', 'button ghost full', 'حفظ مراجعة العينة'); saveSample.type = 'submit'; sampleForm.append(saveSample, node('p', 'micro-note', 'يُربط السجل بالدفعة الحالية. الأعداد تدخلها أنت؛ لا نقرأ نتائج X أو نحسب انتشار الوسوم.')); $('researchSearchTools').append(sampleDetails, button('سجل مراجعات النتائج', () => { renderSamples(); showDialog('samplesDialog'); }, 'text-button full'));
    function exportPlan(format) { try { const plan = planned(); if (!plan.batches.length) throw Error('اختر تصنيفات أو عبارات أولًا.'); textDownload(format === 'csv' ? C.planCSV(plan) : plan.batches.map(b => b.url).join('\r\n'), 'research-hunter-search-batches.' + format, format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8'); } catch (error) { toast(error.message); } }
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
      if (!items.length) { $('sampleRecords').append(node('p', 'body-copy', 'لم تسجّل مراجعة نتائج بعد. ابدأ البحث ثم افتح «تسجيل فائدة عينة راجعتها» في لوحة الجولة.')); return; }
      for (const sample of [...items].reverse()) {
        const row = node('article', 'sample-record'), percentage = Math.round(sample.relevant / sample.reviewed * 100); row.append(node('h3', '', sample.label), node('strong', '', `${sample.relevant} من ${sample.reviewed} ملائم · ${percentage}% من العينة المراجعة`), node('p', '', sample.note), node('small', '', new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sample.recordedAt))));
        const details = node('details'), title = node('summary', '', 'استعلام العينة'); const query = node('p', 'sample-query', sample.query); query.dir = 'ltr'; details.append(title, query, link('افتح البحث نفسه في X', C.searchUrl(sample.query, sample.type))); row.append(details, button('حذف السجل', () => confirmAction('حذف سجل مراجعة', 'سيُحذف سجل هذه العينة فقط. يمكنك تصدير السجل كاملًا أولًا.', () => { getState().samples = getState().samples.filter(s => s.id !== sample.id); scheduleSave(); renderSamples(); }), 'text-button')); $('sampleRecords').append(row);
      }
    }
    $('exportSamples').addEventListener('click', () => { const samples = getState().samples; if (!samples.length) return toast('لا توجد مراجعات للتصدير.'); const rows = [['التجربة', 'راجعت', 'ملائم', 'نسبة العينة', 'التاريخ', 'الاستعلام', 'الملاحظات'], ...samples.map(s => [s.label, s.reviewed, s.relevant, Math.round(s.relevant / s.reviewed * 100) + '%', s.recordedAt, s.query, s.note])]; textDownload('\ufeff' + rows.map(row => row.map(C.csvCell).join(',')).join('\r\n'), 'research-hunter-reviewed-samples.csv', 'text/csv;charset=utf-8'); });

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
      $('savedPreset').replaceChildren(placeholder, ...state.categories.filter(c => c.preset).map(c => { const o = node('option', '', c.title); o.value = c.id; return o; })); $('savedPreset').value = current;
      $('saveCurrentPreset').disabled = state.selected.length !== 1; $('loadPreset').disabled = !state.categories.some(c => c.preset);
      const chosen = state.categories.filter(c => state.selected.includes(c.id)), excluded = chosen.reduce((sum, c) => sum + c.terms.length - C.activeTerms(c).length, 0), alerts = chosen.flatMap(C.activeTerms).filter(t => C.inspectTerm(t).length).length;
      $('planReviewSummary').textContent = `${excluded} عبارة مستبعدة بمراجعتك${alerts ? ` · ${alerts} عبارة تستحق فحص الصياغة من المكتبة` : ''}`;
      csv.disabled = urls.disabled = !plan?.batches.length;
      sampleDetails.hidden = !state.session;
    }
    return { review, preset, refresh, renderDraftEvidence };
  };
})();
