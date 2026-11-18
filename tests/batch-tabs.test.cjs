'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const C=require('../assets/core.js');
const urls=Array.from({length:4},(_,i)=>C.searchUrl('مصطلح '+i));
const windowRef=()=>({opener:{},get location(){throw Error('unsafe navigation');},focus(){throw Error('isolated');}});

test('bulk open creates a separate isolated tab for every query in the click',()=>{
  const refs=[], calls=[];
  const tabs=new C.XBatchTabs((...args)=>{calls.push(args);const ref=windowRef();refs.push(ref);return ref;});
  const result=tabs.openAll(urls);
  assert.equal(result.opened,4); assert.equal(result.openedNow,4); assert.equal(result.blocked,false); assert.deepEqual(result.pendingUrls,[]);
  assert.ok(refs.every(r=>r.opener===null));
  assert.deepEqual(calls,urls.map(url=>[url,'_blank']));
});
test('blocked opening stops immediately and retry opens only the remaining queries',()=>{
  let allowed=1, calls=0;
  const tabs=new C.XBatchTabs(()=>{calls++;return allowed-->0?windowRef():null;});
  const first=tabs.openAll(urls); assert.equal(first.opened,1); assert.equal(first.blocked,true); assert.equal(calls,2); assert.deepEqual(first.pendingUrls,urls.slice(1));
  allowed=3; const retry=tabs.openAll(urls); assert.equal(retry.openedNow,3); assert.equal(retry.opened,4); assert.equal(calls,5);
  tabs.openAll(urls); assert.equal(calls,5);
});
test('COOP closure or a closed opened tab does not trigger duplicate bulk openings',()=>{
  const refs=[]; const tabs=new C.XBatchTabs(()=>{const ref=windowRef();refs.push(ref);return ref;});
  tabs.openAll(urls); for(const ref of refs)ref.closed=true;
  assert.equal(tabs.openAll(urls).openedNow,0); assert.equal(refs.length,4);
});
test('a manual remaining link updates progress for subsequent bulk retry',()=>{
  let allowed=false; const tabs=new C.XBatchTabs(()=>allowed?windowRef():null);
  tabs.openAll(urls); allowed=true; tabs.openAll([urls[2]]);
  assert.deepEqual(tabs.progress(urls).pendingUrls,[urls[0],urls[1],urls[3]]);
  assert.equal(tabs.openAll(urls).openedNow,3);
});
test('invalid links reject the entire bulk request before opening any window',()=>{
  let calls=0; const tabs=new C.XBatchTabs(()=>{calls++;return windowRef();});
  for(const url of ['javascript:alert(1)','https://x.com.evil.test/search?q=x',null])assert.throws(()=>tabs.openAll([...urls,url]));
  assert.equal(calls,0);
});
test('an actual open exception leaves queries pending without creating blank placeholders',()=>{
  const calls=[],tabs=new C.XBatchTabs((url)=>{calls.push(url);throw Error('blocked');});
  const r=tabs.openAll(urls); assert.deepEqual(calls,[urls[0]]); assert.equal(r.blocked,true); assert.equal(r.opened,0); assert.deepEqual(r.pendingUrls,urls);
});
test('empty and duplicate requests never create unwanted extra tabs',()=>{
  let calls=0; const tabs=new C.XBatchTabs(()=>{calls++;return windowRef();});
  assert.equal(tabs.openAll([]).total,0); assert.equal(calls,0);
  assert.equal(tabs.openAll([urls[0],urls[0]]).total,1); assert.equal(calls,1);
});
test('bulk open preserves the planned filters, order and complete term coverage',()=>{
  const plan=C.buildPlan(['رياضيات ابتدائي','رياضيات متوسط','رياضيات ثانوي'],{batchSize:1,accounts:['teacher_demo'],since:'2026-09-01',exclude:'إعلان'});
  const opened=[], tabs=new C.XBatchTabs(url=>{opened.push(url);return windowRef();});
  tabs.openAll(plan.batches.map(b=>b.url));
  assert.deepEqual(opened.map(url=>new URL(url).searchParams.get('q')),plan.batches.map(b=>b.query));
  assert.ok(opened.every(url=>new URL(url).searchParams.get('q').includes('from:teacher_demo since:2026-09-01')));
  assert.deepEqual(plan.batches.flatMap(b=>b.terms),plan.terms);
});

test('immediate COOP isolation cannot turn already opened bulk results into a popup failure',()=>{
  const calls=[],tabs=new C.XBatchTabs(url=>{calls.push(url);return {set opener(_){throw Error('COOP');},get location(){throw Error('cross-origin');},get closed(){throw Error('cross-origin');}};});
  const r=tabs.openAll(urls); assert.deepEqual(calls,urls);assert.equal(r.opened,4);assert.equal(r.blocked,false);
  assert.equal(tabs.openAll(urls).openedNow,0);assert.equal(calls.length,4);
});
