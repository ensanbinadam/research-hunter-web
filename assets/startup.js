(function () {
  'use strict';
  let phase = 'starting', reviewDirty = false;

  function render() {
    const notice = document.getElementById('initFailure');
    const message = document.getElementById('startupMessage');
    const content = document.getElementById('appContent');
    if (notice) notice.hidden = phase === 'ready';
    if (content) content.inert = phase !== 'ready';
    if (message && phase === 'failed') message.textContent = 'تعذر إكمال تشغيل الصياد. أعد تحميل الصفحة، وتأكد من اكتمال ملفات الموقع. لم نُفعّل أدوات التحرير في هذه الصفحة.';
  }

  function fail() {
    if (phase === 'ready') return;
    phase = 'failed';
    render();
  }

  function beforeUnload(event) {
    event.preventDefault();
    event.returnValue = '';
  }

  function setReviewDirty(dirty) {
    const next = !!dirty;
    if (next === reviewDirty) return;
    reviewDirty = next;
    if (next) window.addEventListener('beforeunload', beforeUnload);
    else window.removeEventListener('beforeunload', beforeUnload);
  }

  window.addEventListener('error', event => {
    const source = event.target?.tagName === 'SCRIPT' ? event.target.src : event.filename;
    if (typeof source === 'string' && /\/assets\/[^/?]+\.js(?:\?|$)/u.test(source)) fail();
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    if (phase === 'starting') fail();
    else render();
  }, { once: true });

  window.HunterStartup = {
    ready() { if (phase === 'starting') { phase = 'ready'; render(); } },
    setReviewDirty
  };
})();
