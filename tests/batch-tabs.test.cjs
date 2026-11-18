'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const C=require('../assets/core.js');
const urls=Array.from({length:4},(_,i)=>C.searchUrl('مصطلح '+i));
const windowRef=()=>({opener:{},location:{href:''}});

test('bulk open creates a separate isolated tab for every query in the click',()=>{
  const refs=[], calls=[];
  const tabs=new C.XBatchTabs((...args)=>{calls.push(args);const ref=windowRef();refs.push(ref);return ref;});
  const result=tabs.openAll(urls);
  assert.equal(result.opened,4); assert.equal(result.openedNow,4); assert.equal(result.blocked,false); assert.deepEqual(result.pendingUrls,[]);
  assert.deepEqual(refs.map(r=>r.location.href),urls); assert.ok(refs.every(r=>r.opener===null));
  assert.deepEqual(calls,urls.map(()=>['about:blank','_blank']));
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
test('opening errors leave the query pending and close an unusable blank tab',()=>{
  let closed=0; const tabs=new C.XBatchTabs(()=>({close(){closed++;},set opener(_){throw Error('blocked');}}));
  const r=tabs.openAll(urls); assert.equal(closed,1); assert.equal(r.blocked,true); assert.equal(r.opened,0); assert.deepEqual(r.pendingUrls,urls);
});
test('empty and duplicate requests never create unwanted extra tabs',()=>{
  let calls=0; const tabs=new C.XBatchTabs(()=>{calls++;return windowRef();});
  assert.equal(tabs.openAll([]).total,0); assert.equal(calls,0);
  assert.equal(tabs.openAll([urls[0],urls[0]]).total,1); assert.equal(calls,1);
});
test('bulk open preserves the planned filters, order and complete term coverage',()=>{
  const plan=C.buildPlan(['رياضيات ابتدائي','رياضيات متوسط','رياضيات ثانوي'],{batchSize:1,accounts:['teacher_demo'],since:'2026-09-01',exclude:'إعلان'});
  const refs=[], tabs=new C.XBatchTabs(()=>{const ref=windowRef();refs.push(ref);return ref;});
  tabs.openAll(plan.batches.map(b=>b.url));
  assert.deepEqual(refs.map(r=>new URL(r.location.href).searchParams.get('q')),plan.batches.map(b=>b.query));
  assert.ok(refs.every(r=>new URL(r.location.href).searchParams.get('q').includes('from:teacher_demo since:2026-09-01')));
  assert.deepEqual(plan.batches.flatMap(b=>b.terms),plan.terms);
});
