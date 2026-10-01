import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as icons from 'lucide-vue-next'
import { renderToString } from '@vue/server-renderer'
import { adminPageState, createAdminPage } from '../src/services/adminPageController.js'
const auth = () => ({ provider:'supabase',user:{id:'admin'},profile:{uid:'admin',fullName:'Trusted Admin',email:'trusted@example.invalid',role:'admin',status:'approved'} })
const defer = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve} }
async function load(file, {state=auth(),client={},review=async()=>{},globals={},virtualHost=false}={}) {
  const context=createContext({AbortController,setTimeout,clearTimeout,URL,Blob,console,...globals}),cache=new Map()
  const synthetic=exports=>new SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v)},{context})
  async function module(filename) {
    if(cache.has(filename))return cache.get(filename)
    const pending = (async () => {
    let source=await readFile(filename,'utf8')
    if(filename.endsWith('.vue')) { const {descriptor}=parse(source);const compiled=compileTemplate({source:descriptor.template.content,filename,id:'s7-test'});assert.deepEqual(compiled.errors,[]);source=descriptor.script.content+'\n'+compiled.code }
    const m=new SourceTextModule(source,{context})
    await m.link(async specifier=>{
      if(specifier==='vue')return synthetic(virtualHost ? {...vue,vModelText:{},vModelSelect:{}} : vue)
      if(specifier==='lucide-vue-next')return synthetic(icons)
      if(/\/auth(?:\.js)?$/.test(specifier))return synthetic({authState:state})
      if(/supabase\/supabase\.js$/.test(specifier))return synthetic({supabase:client})
      if(/\/users$/.test(specifier))return synthetic({reviewStudent:review,profileFromRow:r=>({uid:r.id,fullName:r.full_name,studentId:r.student_id,email:r.email,status:r.status,program:r.program,rosterEligible:r.roster_eligible===true,createdAt:r.created_at})})
      let target=path.resolve(path.dirname(filename),specifier);if(!path.extname(target))target+='.js';return module(target)
    });return m
    })()
    cache.set(filename,pending);return pending
  }
  const root=await module(path.resolve(file));await root.evaluate()
  for(const [filename,pending]of cache)if(filename.endsWith('.vue')){const m=await pending;m.namespace.default.render=m.namespace.render}
  return root.namespace
}
async function render(file,data={},props={},options={}) {
  const {default:component}=await load(file,options),old=component.data
  const app=vue.createSSRApp({...component,data(){return {...(old?old.call(this):{}),...data}}},props)
  app.component('RouterLink',{props:['to'],render(){return vue.h('a',{href:this.to},this.$slots.default?.())}})
  return renderToString(app)
}
function vm(component,values={}) { const instance={...component.data?.(),...values};for(const [name,method]of Object.entries(component.methods||{}))instance[name]=method.bind(instance);return instance }

const file='src/components/AuthorizedStudents.vue'
const response=data=>({retry(){return this},abortSignal(){return Promise.resolve({data,error:null})}})
test('U1 forwards only explicit roster parameters through the existing client',async()=>{
  const calls=[],{adminApi}=await load('src/services/supabaseAdmin.js',{client:{rpc(name,args){calls.push([name,args]);return response([])}}})
  await adminApi.roster({page_size:25,after_student_id:'ABC',search_text:'Name'})
  await adminApi.addRoster(' abc ','Name');await adminApi.setRosterActive('ABC',false)
  assert.deepEqual(calls.map(c=>c[0]),['admin_authorized_students','admin_add_authorized_student','admin_set_authorized_student_active'])
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])),{student_id:' abc ',expected_name:'Name'})
})
for(const variant of ['student','pending','rejected','signed-out'])test(`U1 client denies ${variant} roster operations`,async()=>{
  const state=auth();if(variant==='student')state.profile.role='student';else if(variant==='signed-out')state.user=null;else state.profile.status=variant
  const {adminApi}=await load('src/services/supabaseAdmin.js',{state})
  for(const action of [()=>adminApi.roster(),()=>adminApi.addRoster('ABC'),()=>adminApi.setRosterActive('ABC',true)])await assert.rejects(action,/APPROVED_ADMIN_REQUIRED/)
})
test('U1 renders eligibility separately from trusted registration state and escapes reference names',async()=>{
  const html=await render(file,{state:{...adminPageState(),rows:[{student_id:'ABC-1',expected_name:'<script>name</script>',registered_name:'Student',is_active:false,registration_state:'approved'}]}})
  for(const text of ['Authorized Students','Student Name','Inactive','Approved','Activate','ABC-1'])assert.ok(html.includes(text))
  assert.doesNotMatch(html,/<script>name/);assert.match(html,/&lt;script&gt;/)
  assert.doesNotMatch(html,/View history|View private photo/)
})
test('U1 search and keyset pagination are server-side and search resets the cursor',async()=>{
  const calls=[],{default:c}=await load(file,{client:{rpc(name,args){calls.push(args);return response(args.after_student_id?[]:Array.from({length:25},(_,i)=>({student_id:'ID-'+i})))}}})
  const instance=vm(c,{identity:'admin'});c.mounted.call(instance);await new Promise(r=>setTimeout(r,0))
  await instance.controller.next();assert.equal(calls.at(-1).after_student_id,'ID-24')
  instance.search=' New Name ';await instance.searchRoster();assert.equal(calls.at(-1).search_text,'New Name');assert.equal(calls.at(-1).after_student_id,null)
  assert.equal(calls.at(-1).page_size,25);c.beforeUnmount.call(instance)
})
test('U1 duplicate clicks cause one mutation and preserve input on friendly failure',async()=>{
  const gate=defer();let calls=0
  const {default:c}=await load(file,{client:{rpc(){calls++;return {retry(){return this},abortSignal(){return gate.promise}}}}})
  const instance=vm(c,{identity:'admin',studentId:'ABC',expectedName:'Reference'})
  const saving=instance.addStudent();await instance.addStudent();assert.equal(calls,1);assert.equal(instance.busy,true)
  gate.resolve({error:{message:'STUDENT_ID_ALREADY_AUTHORIZED'},data:null});await saving
  assert.match(instance.error,/already on the roster/);assert.equal(instance.studentId,'ABC');assert.equal(instance.expectedName,'Reference');assert.equal(instance.busy,false)
})
for(const event of ['logout','unmount'])test(`U1 late writes and reads are ignored after ${event}`,async()=>{
  const gate=defer(),state=auth(),{default:c}=await load(file,{state,client:{rpc(){return {retry(){return this},abortSignal(){return gate.promise}}}}})
  const instance=vm(c,{identity:'admin',studentId:'ABC'});c.mounted.call(instance)
  const saving=instance.addStudent()
  if(event==='logout'){state.user=null;instance.identity='';c.watch.identity.call(instance)}else c.beforeUnmount.call(instance)
  gate.resolve({data:[],error:null});await saving;await new Promise(r=>setTimeout(r,0))
  assert.equal(instance.notice,'');assert.equal(instance.error,'');assert.equal(instance.state.rows.length,0)
})
test('U1 Admin page retains pending review and full directory',async()=>{
  const html=await render('src/views/admin/StudentsView.vue')
  for(const text of ['Authorized Students','Pending Registrations','Student Directory'])assert.ok(html.includes(text))
})

const rosterRow = { student_id:'ABC', expected_name:'Old Name', is_active:true, registration_state:'pending', verification_ready:false, registered_name:'Display Name' }
const settle = () => new Promise(resolve=>setTimeout(resolve,0))
async function rosterVm(client) {
  const {default:c}=await load(file,{client})
  const instance=vm(c,{identity:'admin',$emit(){}})
  c.mounted.call(instance);await settle()
  return {c,instance}
}
test('name Save reconciles server row, clears warning and closes editor without manual Refresh',async()=>{
  let row={...rosterRow},writes=0,reads=0
  const {c,instance}=await rosterVm({rpc(name,args){
    if(name==='admin_update_authorized_student_name'){writes++;row={...row,expected_name:args.expected_name.trim(),verification_ready:true};return response(null)}
    reads++;return response([{...row}])
  }})
  instance.editName(instance.state.rows[0]);instance.correctedName='  Lantong, Joseph A. II  '
  await instance.saveName()
  assert.equal(writes,1);assert.equal(reads,2);assert.equal(instance.state.rows[0].expected_name,'Lantong, Joseph A. II')
  assert.equal(instance.state.rows[0].verification_ready,true);assert.equal(instance.state.rows[0].registration_state,'pending');assert.equal(instance.state.rows[0].is_active,true)
  assert.equal(instance.editingId,null);assert.equal(instance.correctedName,'');assert.match(instance.notice,/saved/)
  const html=await render(file,{state:instance.state,editingId:instance.editingId})
  assert.match(html,/Lantong, Joseph A. II/);assert.doesNotMatch(html,/Name correction required|id="correct-ABC"/)
  c.beforeUnmount.call(instance)
})
test('failed name Save keeps editor and typed value; Cancel never writes',async()=>{
  let writes=0
  const {c,instance}=await rosterVm({rpc(name){if(name==='admin_update_authorized_student_name'){writes++;return {retry(){return this},abortSignal(){return {error:{message:'INVALID_ROSTER_DETAILS'},data:null}}}}return response([{...rosterRow}])}})
  instance.editName(instance.state.rows[0]);instance.correctedName='Invalid Name';await instance.saveName()
  assert.equal(instance.editingId,'ABC');assert.equal(instance.correctedName,'Invalid Name');assert.equal(instance.notice,'');assert.ok(instance.error)
  instance.cancelEdit();assert.equal(instance.editingId,null);assert.equal(instance.correctedName,'');assert.equal(writes,1);assert.equal(instance.state.rows[0].expected_name,'Old Name')
  c.beforeUnmount.call(instance)
})
test('Save waits for mutation and authoritative read, prevents duplicates and avoids card bounce',async()=>{
  const write=defer(),read=defer();let writes=0,reads=0
  const {c,instance}=await rosterVm({rpc(name){
    if(name==='admin_update_authorized_student_name'){writes++;return {retry(){return this},abortSignal(){return write.promise}}}
    return ++reads===1?response([{...rosterRow}]):{retry(){return this},abortSignal(){return read.promise}}
  }})
  instance.editName(instance.state.rows[0]);instance.correctedName='New, Name'
  const pending=instance.saveName();await instance.saveName();assert.equal(writes,1);assert.equal(instance.notice,'');assert.equal(reads,1)
  write.resolve({data:null,error:null});await settle();assert.equal(instance.notice,'');assert.equal(instance.busy,true);assert.equal(instance.editingId,'ABC');assert.equal(instance.state.rows.length,1)
  read.resolve({data:[{...rosterRow,expected_name:'New, Name',verification_ready:true}],error:null});await pending
  assert.equal(instance.busy,false);assert.equal(instance.editingId,null);assert.equal(instance.state.rows[0].expected_name,'New, Name');c.beforeUnmount.call(instance)
})
test('saved mutation with failed reconciliation keeps editor and does not announce success',async()=>{
  let reads=0
  const {c,instance}=await rosterVm({rpc(name){if(name==='admin_update_authorized_student_name')return response(null);return ++reads===1?response([{...rosterRow}]):{retry(){return this},abortSignal(){return {error:{message:'offline'},data:null}}}}})
  instance.editName(instance.state.rows[0]);instance.correctedName='New, Name';await instance.saveName()
  assert.equal(instance.editingId,'ABC');assert.equal(instance.correctedName,'New, Name');assert.equal(instance.state.rows[0].expected_name,'Old Name');assert.equal(instance.notice,'');assert.match(instance.error,/saved, but/)
  c.beforeUnmount.call(instance)
})
test('name reconciliation preserves applied search and current page cursor',async()=>{
  let edited=false;const calls=[]
  const {c,instance}=await rosterVm({rpc(name,args){if(name==='admin_update_authorized_student_name'){edited=true;return response(null)}calls.push(args);return response(args.after_student_id?[{...rosterRow,expected_name:edited?'New, Name':'Old Name'}]:Array.from({length:25},(_,i)=>({...rosterRow,student_id:'A'+i})))}})
  instance.search='Name';await instance.searchRoster();await instance.controller.next();assert.equal(instance.state.page,1)
  instance.editName(instance.state.rows[0]);instance.correctedName='New, Name';await instance.saveName()
  assert.equal(instance.state.page,1);assert.equal(instance.search,'Name');assert.equal(instance.appliedSearch,'Name');assert.equal(calls.at(-1).after_student_id,'A24');assert.equal(calls.at(-1).search_text,'Name');assert.equal(instance.state.rows[0].expected_name,'New, Name')
  c.beforeUnmount.call(instance)
})
test('older list response cannot restore old name after Save reconciliation',async()=>{
  const old=defer();let reads=0
  const {c,instance}=await rosterVm({rpc(name){if(name==='admin_update_authorized_student_name')return response(null);reads++;if(reads===2)return {retry(){return this},abortSignal(){return old.promise}};return response([{...rosterRow,expected_name:reads===1?'Old Name':'New, Name',verification_ready:reads>1}])}})
  instance.editName(instance.state.rows[0]);instance.correctedName='New, Name'
  const earlier=instance.controller.reload();await instance.saveName()
  old.resolve({data:[{...rosterRow}],error:null});await earlier
  assert.equal(instance.state.rows[0].expected_name,'New, Name');assert.equal(instance.state.rows[0].verification_ready,true);assert.equal(instance.editingId,null)
  c.beforeUnmount.call(instance)
})
test('add and activate/deactivate still reconcile trusted roster results',async()=>{
  let rows=[]
  const {c,instance}=await rosterVm({rpc(name,args){if(name==='admin_add_authorized_student'){rows=[{...rosterRow,expected_name:args.expected_name}];return response(null)}if(name==='admin_set_authorized_student_active'){rows[0]={...rows[0],is_active:args.is_active};return response(null)}return response(rows.map(r=>({...r})))}})
  instance.studentId='ABC';instance.expectedName='New, Name';await instance.addStudent();assert.equal(instance.state.rows[0].expected_name,'New, Name')
  await instance.setActive(instance.state.rows[0]);assert.equal(instance.state.rows[0].is_active,false)
  await instance.setActive(instance.state.rows[0]);assert.equal(instance.state.rows[0].is_active,true);c.beforeUnmount.call(instance)
})

test('renamed row leaves an old-name search only when the authoritative result excludes it',async()=>{
  let edited=false
  const {c,instance}=await rosterVm({rpc(name){if(name==='admin_update_authorized_student_name'){edited=true;return response(null)}return response(edited?[]:[{...rosterRow}])}})
  instance.search='Old Name';await instance.searchRoster();instance.editName(instance.state.rows[0]);instance.correctedName='New, Name';await instance.saveName()
  assert.equal(instance.appliedSearch,'Old Name');assert.equal(instance.state.rows.length,0);assert.equal(instance.editingId,null);assert.match(instance.notice,/current search/)
  c.beforeUnmount.call(instance)
})
test('logout during reconciliation cannot close or repopulate the new account UI or emit changed',async()=>{
  const gate=defer(),state=auth();let reads=0,events=0
  const {default:c}=await load(file,{state,client:{rpc(name){if(name==='admin_update_authorized_student_name')return response(null);return ++reads===1?response([{...rosterRow}]):{retry(){return this},abortSignal(){return gate.promise}}}}})
  const instance=vm(c,{identity:'admin',$emit(){events++}});c.mounted.call(instance);await settle()
  instance.editName(instance.state.rows[0]);instance.correctedName='New, Name';const pending=instance.saveName();await settle()
  state.user=null;instance.identity='';c.watch.identity.call(instance)
  gate.resolve({data:[{...rosterRow,expected_name:'New, Name'}],error:null});await pending
  assert.equal(instance.state.rows.length,0);assert.equal(instance.notice,'');assert.equal(instance.error,'');assert.equal(events,0);c.beforeUnmount.call(instance)
})

