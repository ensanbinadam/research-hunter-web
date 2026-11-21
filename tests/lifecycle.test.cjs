'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../assets/core.js');

function startupEnv(withDOM = true) {
  const listeners = new Map(), docListeners = new Map();
  const notice = { hidden: false }, message = { textContent: 'يجري تجهيز التطبيق' }, content = { inert: true };
  const elements = new Map();
  function mount() { elements.set('initFailure', notice); elements.set('startupMessage', message); elements.set('appContent', content); }
  if (withDOM) mount();
  const window = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }
  };
  const document = { getElementById: id => elements.get(id), addEventListener: (type, fn) => docListeners.set(type, fn) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/startup.js'), 'utf8'), { window, document });
  return { api: window.HunterStartup, notice, message, content, listeners, mount, loaded: () => docListeners.get('DOMContentLoaded')(), error: event => { for (const fn of listeners.get('error') || []) fn(event); } };
}

test('successful startup enables the app only after ready and ignores later runtime errors', () => {
  const env = startupEnv();
  assert.equal(env.content.inert, true);
  env.api.ready(); env.loaded();
  assert.equal(env.notice.hidden, true); assert.equal(env.content.inert, false);
  env.error({ filename: 'https://example.org/assets/app.js' });
  assert.equal(env.content.inert, false);
});

test('missing app completion keeps a visible explanation and disables partial editing', () => {
  const env = startupEnv(); env.loaded();
  assert.equal(env.notice.hidden, false); assert.equal(env.content.inert, true);
  assert.match(env.message.textContent, /تعذر إكمال تشغيل/);
});

test('script load and initialization errors survive early DOM timing and cannot be cleared by late ready', () => {
  for (const event of [{ target: { tagName: 'SCRIPT', src: 'https://example.org/assets/core.js?v=1.3.2' } }, { filename: 'https://example.org/assets/app.js?v=1.3.2' }]) {
    const env = startupEnv(false); env.error(event); env.mount(); env.api.ready(); env.loaded();
    assert.equal(env.notice.hidden, false); assert.equal(env.content.inert, true);
    assert.match(env.message.textContent, /تعذر/);
  }
});

test('an unrelated resource failure does not prevent a successful startup', () => {
  const env = startupEnv(); env.error({ target: { tagName: 'IMG', src: 'https://example.org/assets/logo.svg' } });
  env.api.ready(); env.loaded(); assert.equal(env.notice.hidden, true);
});

test('page-exit warning exists only while a review is dirty and uses the native browser confirmation contract', () => {
  const env = startupEnv();
  assert.equal(env.listeners.get('beforeunload')?.size || 0, 0);
  env.api.setReviewDirty(true); env.api.setReviewDirty(true);
  assert.equal(env.listeners.get('beforeunload').size, 1);
  let prevented = false;
  const event = { preventDefault() { prevented = true; }, returnValue: 'unchanged' };
  for (const listener of env.listeners.get('beforeunload')) listener(event);
  assert.equal(prevented, true); assert.equal(event.returnValue, '');
  env.api.setReviewDirty(false);
  assert.equal(env.listeners.get('beforeunload').size, 0);
});

const archive = title => JSON.stringify({ format: 'research-hunter-categories', version: 2, categories: [{ id: 'test-one', title, language: 'ar', terms: ['عبارة متخصصة'] }] });
test('sequential local imports preserve order, isolate a bad file, and reject oversized files before reading', async () => {
  let oversizedRead = false;
  const files = [
    { name: 'first.json', size: 120, text: async () => archive('أول') },
    { name: 'broken.json', size: 8, text: async () => '{bad' },
    { name: 'large.json', size: C.MAX_FILE_BYTES + 1, text: async () => { oversizedRead = true; return ''; } },
    { name: 'last.json', size: 120, text: async () => archive('أخير') }
  ];
  const result = await C.readCategoryFiles(files);
  assert.deepEqual(result.map(x => x.name), files.map(x => x.name));
  assert.equal(result[0].categories[0].title, 'أول'); assert.match(result[1].error, /JSON/);
  assert.match(result[2].error, /8/); assert.equal(oversizedRead, false);
  assert.equal(result[3].categories[0].title, 'أخير');
});

test('import yields to the event loop and never starts the second file while the first is pending', async () => {
  const events = [];
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const firstStarted = new Promise(resolve => { started = resolve; });
  setTimeout(() => events.push('yielded'), 0);
  const reading = C.readCategoryFiles([
    { name: 'one.json', size: 120, text: async () => { events.push('first'); started(); await gate; return archive('واحد'); } },
    { name: 'two.json', size: 120, text: async () => { events.push('second'); return archive('اثنان'); } }
  ]);
  await firstStarted;
  assert.deepEqual(events, ['yielded', 'first']);
  release(); const result = await reading;
  assert.deepEqual(events, ['yielded', 'first', 'second']); assert.equal(result.length, 2);
});

test('an oversized import queue is refused before any file is read', async () => {
  let reads = 0;
  await assert.rejects(C.readCategoryFiles(Array.from({ length: 21 }, () => ({ name: 'x.json', text: async () => { reads++; } }))), /20/);
  assert.equal(reads, 0);
});
