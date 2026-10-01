import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
const module = new SourceTextModule(await readFile(new URL('../src/services/adminAttendanceSignals.js',import.meta.url),'utf8'))
await module.link(name => {
  const exports = name.includes('supabaseAdmin') ? {adminKey:()=>''} : {supabase:null}
  return new SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value)})
})
await module.evaluate()
const {createAttendanceSignals}=module.namespace
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function fixture() {
  let key='admin',removed=0
  const channels=[]
  const client={channel(){const channel={handlers:[],on(type,filter,fn){this.handlers.push({filter,fn});return this},subscribe(fn){this.status=fn;return this}};channels.push(channel);return channel},removeChannel(){removed++}}
  const signals=createAttendanceSignals(client,()=>key,5,15)
  return {signals,channels,setKey:value=>key=value,removed:()=>removed}
}
test('one Admin channel, INSERT/UPDATE signals coalesce; payload never supplies state',async()=>{
  const f=fixture();let reads=0
  f.signals.register((...args)=>{assert.equal(args.length,0);reads++})
  f.signals.start();f.signals.start();assert.equal(f.channels.length,1)
  const c=f.channels[0];assert.deepEqual(c.handlers.map(h=>h.filter.event),['INSERT','UPDATE'])
  c.status('SUBSCRIBED');for(let i=0;i<10;i++)c.handlers[i%2].fn({new:{completed_seconds:999999}})
  await sleep(30);assert.equal(reads,1);c.status('SUBSCRIBED');await sleep(30);assert.equal(reads,2);f.signals.stop()
})
test('event during active read produces one follow-up and unregistered datasets stay quiet',async()=>{
  const f=fixture();let reads=0,resolve
  const gate=new Promise(r=>resolve=r),unregister=f.signals.register(async()=>{reads++;if(reads===1)await gate})
  f.signals.start();f.signals.signal();await sleep(25)
  for(let i=0;i<5;i++)f.signals.signal();await sleep(25);assert.equal(reads,1)
  resolve();await sleep(15);assert.equal(reads,2);unregister();f.signals.signal();await sleep(25);assert.equal(reads,2);f.signals.stop()
})
test('logout, role/account change and teardown remove channels and ignore old generations',async()=>{
  const f=fixture();let reads=0;f.signals.register(()=>reads++);f.signals.start();const old=f.channels[0]
  f.setKey('');f.signals.start();assert.equal(f.removed(),1);old.handlers[0].fn();await sleep(25);assert.equal(reads,0)
  f.setKey('other-admin');f.signals.start();old.status('SUBSCRIBED');await sleep(25);assert.equal(reads,0)
  f.signals.signal();f.signals.stop();await sleep(25);assert.equal(reads,0);assert.equal(f.removed(),2)
})
test('no channel without approved identity; socket failure does not call reads or throw',()=>{
  const f=fixture();f.setKey('');f.signals.start();assert.equal(f.channels.length,0)
  const s=createAttendanceSignals({channel(){throw Error('offline')}},()=> 'admin');assert.doesNotThrow(()=>s.start());s.stop()
})

test('a new account signal waits for an old in-flight read then reconciles the current account',async()=>{
 const f=fixture();let count=0,resolve;const gate=new Promise(r=>resolve=r)
 f.signals.register(async()=>{count++;if(count===1)await gate});f.signals.start();f.signals.signal();await sleep(25)
 f.setKey('new-admin');f.signals.start();f.channels.at(-1).status('SUBSCRIBED');await sleep(25);assert.equal(count,1)
 resolve();await sleep(20);assert.equal(count,2);f.signals.stop()
})
test('continuous signals have a maximum delay and authorization error envelopes are ignored',async()=>{
 const f=fixture();let reads=0;f.signals.register(()=>reads++);f.signals.start()
 f.channels[0].handlers[0].fn({errors:['Error 401: Unauthorized']});await sleep(20);assert.equal(reads,0)
 const interval=setInterval(()=>f.signals.signal(),2);await sleep(45);clearInterval(interval);assert.ok(reads>=1);f.signals.stop()
})
