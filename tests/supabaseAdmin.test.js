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
      if(/\/users$/.test(specifier))return synthetic({reviewStudent:review,profileFromRow:r=>({uid:r.id,fullName:r.full_name,studentId:r.student_id,email:r.email,status:r.status,program:r.program,createdAt:r.created_at})})
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
const student={id:'student',full_name:'Real Student',student_id:'REAL-007',email:'student@example.invalid',program:'BS Information Technology',status:'approved',required_hours:486,completed_seconds:7200.75,completed_sessions:1,open_time_in:'2026-10-01T00:00:00Z',latest_category:'IT Support'}
const activity={id:'activity',student_uid:'student',full_name:student.full_name,student_id:student.student_id,category:'IT Support',description:'Real server update',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T01:00:00Z',revision:3,photo_path:'private/proof',is_in:true}
function vm(component,values={}) { const instance={...component.data?.(),...values};for(const [name,method]of Object.entries(component.methods||{}))instance[name]=method.bind(instance);return instance }

for(const variant of ['student','pending','rejected','wrong-owner','signed-out','firebase'])test(`trusted admin identity denies ${variant}`,async()=>{
  const state=auth();if(variant==='student')state.profile.role='student';if(['pending','rejected'].includes(variant))state.profile.status=variant
  if(variant==='wrong-owner')state.profile.uid='other';if(variant==='signed-out')state.user=null;if(variant==='firebase')state.provider='firebase'
  const api=await load('src/services/supabaseAdmin.js',{state});assert.equal(api.adminKey(),'');await assert.rejects(api.adminApi.dashboard(),/APPROVED_ADMIN_REQUIRED/)
})
test('admin RPC wrapper reuses client and forwards fixed read RPCs',async()=>{
  const calls=[],client={rpc(name,args){calls.push([name,args]);return {retry(value){assert.equal(value,false);return this},abortSignal(){return {data:[],error:null}}}}}
  const {adminApi}=await load('src/services/supabaseAdmin.js',{client});for(const kind of ['students','activities','attendance','revisions'])await adminApi[kind]({page_size:25})
  assert.deepEqual(calls.map(x=>x[0]),['admin_students','admin_activities','admin_attendance','admin_activity_revisions'])
})
test('service discards response after account switch',async()=>{
  const gate=defer(),state=auth(),client={rpc(){return {retry(){return this},abortSignal(){return gate.promise}}}}
  const {adminApi}=await load('src/services/supabaseAdmin.js',{state,client});const pending=adminApi.dashboard();state.user=null;gate.resolve({data:{total:99},error:null});await assert.rejects(pending,/ACCOUNT_CHANGED/)
})
test('bounded controller uses cursor, clears rows on refresh and paginates',async()=>{
  const state=adminPageState(),calls=[],controller=createAdminPage(state,async cursor=>{calls.push(cursor);return cursor?[{id:3}]:[{id:1},{id:2}]},()=> 'admin',2)
  await controller.refresh();assert.equal(state.rows.length,2);assert.equal(state.next,true);await controller.next();assert.equal(state.rows[0].id,3);assert.equal(calls[1].id,2);await controller.previous();assert.equal(state.page,0)
})
for(const event of ['stop','account change','new filter'])test(`late page cannot repopulate after ${event}`,async()=>{
  const gate=defer(),state=adminPageState();let key='admin',count=0
  const controller=createAdminPage(state,()=>++count===1?gate.promise:Promise.resolve([]),()=>key)
  const old=controller.refresh();if(event==='stop')controller.stop();if(event==='account change'){key='';await controller.refresh()}if(event==='new filter')await controller.refresh()
  gate.resolve([{id:'old'}]);await old;assert.equal(state.rows.length,0)
})
test('failed read clears data and gives recoverable error without raw detail',async()=>{
  const state=adminPageState(),controller=createAdminPage(state,async()=>{throw new Error('SQL secret')},()=> 'admin');await controller.refresh();assert.equal(state.loading,false);assert.equal(state.rows.length,0);assert.match(state.error,/Refresh|refresh/);assert.doesNotMatch(state.error,/SQL/)
})
test('loading begins before response; empty response is a real empty state',async()=>{
  const gate=defer(),state=adminPageState(),controller=createAdminPage(state,()=>gate.promise,()=> 'admin');const pending=controller.refresh();assert.equal(state.loading,true);gate.resolve([]);await pending;assert.equal(state.rows.length,0);assert.equal(state.next,false);assert.equal(state.error,'')
})
test('dashboard renders trusted counts, IN count and completed hours',async()=>{
  const html=await render('src/views/admin/AdminDashboard.vue',{result:{total:7,approved:4,pending:2,rejected:1,timed_in:3,completed_sessions:9,completed_seconds:7200.75}})
  for(const text of ['Total Students','Pending Students','Currently IN','2h 00m','Completed Sessions'])assert.match(html,new RegExp(text))
  assert.match(html,/>7</);assert.match(html,/>3</);assert.doesNotMatch(html,/Ralph|Sample|47|32 students/)
})
test('dashboard failure has no fabricated metric fallback',async()=>{const html=await render('src/views/admin/AdminDashboard.vue',{error:'Unable to load',result:null});assert.match(html,/Unable to load/);assert.doesNotMatch(html,/Completed Sessions|Total Students/)} )
test('student directory renders real profile, progress, UID link and full page',async()=>{
  const html=await render('src/components/AdminRecords.vue',{state:{...adminPageState(),rows:[student]}},{kind:'students'})
  for(const text of ['REAL-007','Real Student','student@example.invalid','2h 00m','approved','/admin/students/student','Filters search all student records'])assert.ok(html.includes(text));assert.doesNotMatch(html,/Show More/)
})
test('directory and monitor pass search/status/category/date filters to server',async()=>{
  const calls=[],client={rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){return {data:[],error:null}}}}}
  const {default:c}=await load('src/components/AdminRecords.vue',{client});const instance=vm(c,{kind:'students',search:'Real',status:'pending',attendance:'IN',category:'IT Support',studentId:null})
  await instance.load(null,25);assert.equal(calls[0][1].search,'Real');assert.equal(calls[0][1].account_status,'pending');assert.equal(calls[0][1].attendance_status,'IN')
  instance.kind='activities';instance.day='2026-10-01';await instance.load(activity,25);assert.equal(calls[1][1].before_id,'activity');assert.equal(calls[1][1].on_day,'2026-10-01')
})
test('details loads selected UUID using the bounded service',async()=>{
  const calls=[],client={rpc(name,args){calls.push(args);return {retry(){return this},abortSignal(){return {data:[student],error:null}}}}}
  const {default:m}=await load('src/services/adminSummaryMixin.js',{client});const instance=vm(m,{identity:'admin',id:'student'});await instance.refresh();assert.equal(calls[0].target_uid,'student');assert.equal(instance.result.id,'student')
})
test('details renders program and completed duration, never counts open session',async()=>{const html=await render('src/views/admin/StudentDetailsView.vue',{result:student},{id:'student'});assert.match(html,/BS Information Technology/);assert.match(html,/2h 00m/);assert.match(html,/Only completed server attendance/)} )
test('attendance component renders real timestamps and excludes open duration',async()=>{
  const html=await render('src/components/AdminRecords.vue',{state:{...adminPageState(),rows:[{id:'session',time_in:'2026-10-01T00:00:00Z',time_out:null}]}},{kind:'attendance',studentId:'student'});assert.match(html,/8:00 AM/);assert.match(html,/Not completed/)
})
test('monitor renders latest activity edit count, original/last timestamp and lazy proof action',async()=>{
  const html=await render('src/components/AdminRecords.vue',{state:{...adminPageState(),rows:[activity]}},{kind:'activities'});for(const text of ['Real server update','Edited ×3','Last edited','View Edit History','View private photo','Submitted'])assert.ok(html.includes(text));assert.doesNotMatch(html,/<img/)
})
test('audit renders chronological versions, baseline disclosure and current marker',async()=>{
  const rows=[0,1,2].map(revision=>({...activity,id:'audit'+revision,revision,current_revision:2,version_at:activity.created_at,migration_baseline:revision===0}))
  const html=await render('src/components/AdminRecords.vue',{state:{...adminPageState(),rows}},{kind:'revisions',activityId:'activity'})
  assert.ok(html.indexOf('Original')<html.indexOf('Edit #1'));assert.ok(html.indexOf('Edit #1')<html.indexOf('Edit #2'));assert.match(html,/Current/);assert.match(html,/Earlier versions were not recorded/)
})
for(const condition of ['loading','empty','error'])test(`records render ${condition} state`,async()=>{
  const state=adminPageState();if(condition==='loading')state.loading=true;if(condition==='error')state.error='Connection unavailable'
  const html=await render('src/components/AdminRecords.vue',{state},{kind:'activities'});assert.match(html,condition==='loading'?/Loading records/:condition==='empty'?/No matching records/:/Connection unavailable/)
})
test('admin private proof loads authenticated on demand, revokes on hide/account/path/unmount',async()=>{
  let downloads=0;const revoked=[],blob=new Blob(['image'],{type:'image/png'}),client={storage:{from(bucket){assert.equal(bucket,'activity-proofs');return {download(path,options,params){assert.equal(params.cache,'no-store');downloads++;return {data:blob,error:null}}}}}}
  class Image {set src(value){this.naturalWidth=1;this.naturalHeight=1;this.onload()}}
  const {default:c}=await load('src/components/AdminActivityProof.vue',{client,globals:{Image,URL:{createObjectURL:()=> 'blob:proof',revokeObjectURL:url=>revoked.push(url)}}})
  const instance=vm(c,{path:'retained/history/proof'});assert.equal(downloads,0);await instance.show();assert.equal(downloads,1);assert.equal(instance.url,'blob:proof');await instance.show();assert.equal(instance.url,'')
  await instance.show();c.watch.accountKey.call(instance);await instance.show();c.watch.path.call(instance);await instance.show();c.beforeUnmount.call(instance);assert.equal(revoked.length,8)
})
for(const decision of ['approved','rejected'])test(`review preserves ${decision} RPC and confirmation outcome`,async()=>{
  const decisions=[],client={rpc(){return {retry(){return this},abortSignal(){return {data:[],error:null}}}}}
  const {default:c}=await load('src/components/PendingRegistrations.vue',{client,review:async(...args)=>decisions.push(args)})
  const instance=vm(c,{identity:'admin',decision:{uid:'student',status:decision},$emit(){}});await instance.confirmReview();assert.equal(decisions[0][0],'student');assert.equal(decisions[0][1],decision);assert.equal(instance.busy,false);assert.match(instance.notice,decision==='approved'?/approved/:/rejected/)
})
test('Admin Profile uses trusted identity without mock fallback or editing',async()=>{const html=await render('src/views/admin/AdminProfileView.vue');assert.match(html,/Trusted Admin/);assert.match(html,/trusted@example.invalid/);assert.doesNotMatch(html,/Jamie Reyes|admin@example.com|Save Changes/)} )
test('active Admin files contain no Firebase imports, mock arrays or unbounded read loops',async()=>{
  for(const name of ['AdminDashboard','StudentsView','StudentDetailsView','ActivityMonitorView','AdminProfileView']) {const source=await readFile(`src/views/admin/${name}.vue`,'utf8');assert.doesNotMatch(source,/firebase|Firestore|sample|mock|Ralph Joseph/i)}
  const service=await readFile('src/services/supabaseAdmin.js','utf8');assert.doesNotMatch(service,/service_role|createClient|getPublicUrl|firebase/i)
})


const monitorStudent = { id:'uid-a',full_name:'Same Name',student_id:'ID-A',is_in:true,total_activities:30,total_edits:7,matching_activities:2,latest_activity_at:activity.created_at }
test('student-first monitor renders one summary per UID, distinct same names, correct all-time/matching totals and defaults collapsed',async()=>{
  const html=await render('src/components/AdminActivityStudents.vue',{category:'Other',state:{...adminPageState(),rows:[monitorStudent,{...monitorStudent,id:'uid-b',student_id:'ID-B'}]}},{viewMode:'logs'})
  assert.equal((html.match(/data-student-uid=/g)||[]).length,2)
  assert.equal((html.match(/data-student-uid="uid-a"/g)||[]).length,1)
  assert.equal((html.match(/Same Name/g)||[]).length,2)
  for(const text of ['ID-A','ID-B','Total activities · all-time','Total edits · all-time','Matching activities','>30<','>7<','>2<'])assert.ok(html.includes(text))
  assert.equal((html.match(/aria-expanded="false"/g)||[]).length,2)
  assert.doesNotMatch(html,/View private photo|View Edit History|Real server update/)
})
test('summary request forwards all server filters and stable student UID cursor without reading activities',async()=>{
  const calls=[],client={rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){return {data:[],error:null}}}}}
  const {default:c}=await load('src/components/AdminActivityStudents.vue',{client}),instance=vm(c,{search:'Same',category:'Other',attendance:'IN',day:'2026-01-02'})
  await instance.load(monitorStudent,25)
  assert.equal(calls.length,1);assert.equal(calls[0][0],'admin_activity_students')
  assert.deepEqual({...calls[0][1]},{page_size:25,after_id:'uid-a',search:'Same',category_filter:'Other',attendance_status:'IN',on_day:'2026-01-02'})
})
test('expanded history locks target UID and applicable filters while retaining bounded cursor',async()=>{
  const calls=[],client={rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){return {data:[],error:null}}}}}
  const {default:c}=await load('src/components/AdminRecords.vue',{client}),instance=vm(c,{kind:'activities',studentId:'uid-a',monitorFilters:{search:'Same',category:'Other',attendance:'OUT',day:'2026-01-02'}})
  await instance.load(activity,25)
  assert.equal(calls[0][0],'admin_activities')
  assert.equal(calls[0][1].target_uid,'uid-a');assert.equal(calls[0][1].page_size,25);assert.equal(calls[0][1].before_id,activity.id)
  assert.equal(calls[0][1].category_filter,'Other');assert.equal(calls[0][1].on_day,'2026-01-02');assert.equal(calls[0][1].attendance_status,'OUT')
})
test('student paging, refresh and filter restart collapse expanded contents',async()=>{
  const {default:c}=await load('src/components/AdminActivityStudents.vue'),instance=vm(c,{opened:'uid-a',controller:{next(){},refresh(){}}})
  instance.page('next');assert.equal(instance.opened,null);instance.toggle('uid-a');instance.refresh();assert.equal(instance.opened,null)
  instance.toggle('uid-a');instance.toggle('uid-a');assert.equal(instance.opened,null)
})
// Mount actual Options API components with a minimal Vue host (no DOM dependency).
function testRenderer() {
  const node=(type,text='')=>({type,text,children:[],parent:null,props:{}})
  const renderer=vue.createRenderer({
    createElement:type=>node(type),createText:text=>node('text',text),createComment:text=>node('comment',text),
    setText:(n,text)=>n.text=text,setElementText:(n,text)=>{n.text=text;n.children=[]},
    patchProp:(n,key,old,value)=>n.props[key]=value,
    insert(n,parent,anchor){if(n.parent){const old=n.parent.children.indexOf(n);if(old>=0)n.parent.children.splice(old,1)}n.parent=parent;const i=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(i<0?parent.children.length:i,0,n)},
    remove(n){if(n.parent){const i=n.parent.children.indexOf(n);if(i>=0)n.parent.children.splice(i,1)}n.parent=null},
    parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]||null,
  })
  return {renderer,root:node('root')}
}
function findComponent(vnode,name) {
  if(!vnode)return null
  if(vnode.component?.type.name===name)return vnode.component.proxy
  if(vnode.component){const found=findComponent(vnode.component.subTree,name);if(found)return found}
  if(Array.isArray(vnode.children))for(const child of vnode.children){const found=findComponent(child,name);if(found)return found}
  return null
}
const settle=async()=>{await new Promise(resolve=>setTimeout(resolve,10));await vue.nextTick()}
for(const ending of ['collapse','logout','unmount'])test(`mounted monitor lazily loads target activities/photos/history and cleans URLs on ${ending}`,async()=>{
  const state=vue.reactive(auth()),calls=[],revoked=[],listeners=new Set()
  const client={rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){return {data:name==='admin_activity_students'?[monitorStudent]:name==='admin_activities'?[{...activity,student_uid:'uid-a'}]:[{...activity,version_at:activity.created_at,current_revision:3}],error:null}}}},storage:{from(){return {download(){calls.push(['download']);return {data:new Blob(['x'],{type:'image/png'}),error:null}}}}}}
  class Image {set src(value){this.naturalWidth=1;this.naturalHeight=1;this.onload()}}
  const {default:component}=await load('src/components/AdminActivityStudents.vue',{state,client,virtualHost:true,globals:{Image,window:{addEventListener:(event,fn)=>listeners.add(fn),removeEventListener:(event,fn)=>listeners.delete(fn)},URL:{createObjectURL:()=> 'blob:private',revokeObjectURL:url=>revoked.push(url)}}})
  const {renderer,root}=testRenderer(),app=renderer.createApp(component)
  app.component('RouterLink',{render(){return vue.h('a',{},this.$slots.default?.())}})
  const instance=app.mount(root);await settle()
  assert.deepEqual(calls.map(c=>c[0]),['admin_activity_students'])
  instance.toggle('uid-a');await settle()
  assert.equal(calls.filter(c=>c[0]==='admin_activities').length,1);assert.equal(calls.find(c=>c[0]==='admin_activities')[1].target_uid,'uid-a')
  assert.equal(calls.filter(c=>c[0]==='download').length,0);assert.equal(calls.filter(c=>c[0]==='admin_activity_revisions').length,0)
  const proof=findComponent(instance.$.subTree,'AdminActivityProof');await proof.show();assert.equal(proof.url,'blob:private')
  assert.equal(calls.filter(c=>c[0]==='admin_activity_revisions').length,0)
  if(ending==='collapse')instance.toggle('uid-a');if(ending==='logout')state.user=null;if(ending==='unmount')app.unmount()
  await settle();assert.equal(proof.url,'');assert.equal(revoked.length,2)
  if(ending!=='unmount'){assert.equal(findComponent(instance.$.subTree,'AdminActivityProof'),null);app.unmount()}
  assert.equal(listeners.size,0)
})
test('expanded bounded Next page replaces rows instead of accumulating whole history and ignores late collapse response',async()=>{
  const state=adminPageState(),calls=[],gate=defer()
  const controller=createAdminPage(state,async cursor=>{calls.push(cursor);return cursor?gate.promise:Array.from({length:25},(_,i)=>({id:'activity-'+i,created_at:activity.created_at}))},()=> 'admin')
  await controller.refresh();assert.equal(state.rows.length,25);const next=controller.next();assert.equal(calls[1].id,'activity-24')
  controller.stop();gate.resolve([{id:'late'}]);await next;assert.equal(state.rows.length,0)
})
test('only Activity Monitor switches to student-first presentation',async()=>{
  const monitor=await readFile('src/views/admin/ActivityMonitorView.vue','utf8');assert.match(monitor,/AdminActivityStudents/)
  const dashboard=await readFile('src/views/admin/AdminDashboard.vue','utf8'),details=await readFile('src/views/admin/StudentDetailsView.vue','utf8')
  assert.match(dashboard,/<AdminRecords kind="activities" recent/);assert.match(details,/kind="activities" :student-id="id"/)
  for(const name of ['ActivityView','HistoryView','StudentDashboard'])assert.doesNotMatch(await readFile(`src/views/student/${name}.vue`,'utf8'),/AdminActivityStudents|admin_activity_students/)
})

test('Current Activities is the accessible default tab and routes are unchanged',async()=>{
  const html=await render('src/views/admin/ActivityMonitorView.vue')
  assert.match(html,/id="monitor-current-tab"[^>]*role="tab"[^>]*aria-selected="true"/)
  assert.match(html,/id="monitor-logs-tab"[^>]*role="tab"[^>]*aria-selected="false"/)
  assert.match(html,/role="tabpanel" aria-labelledby="monitor-current-tab"/)
  assert.doesNotMatch(html,/View Logs|Total edits/)
})
test('tab keyboard navigation supports arrows, Home and End with focus movement',async()=>{
  const {default:c}=await load('src/views/admin/ActivityMonitorView.vue'),focused=[]
  const instance=vm(c,{$nextTick:fn=>fn(),$refs:{currentTab:{focus:()=>focused.push('current')},logsTab:{focus:()=>focused.push('logs')}}})
  for(const [key,expected]of [['ArrowRight','logs'],['Home','current'],['End','logs'],['ArrowLeft','current']]){let prevented=false;instance.tabKey({key,preventDefault(){prevented=true}});assert.equal(instance.activeTab,expected);assert.equal(focused.at(-1),expected);assert.equal(prevented,true)}
})
test('Current student summary shows identity/status/activity total without audit or redundant timestamps',async()=>{
  const html=await render('src/components/AdminActivityStudents.vue',{state:{...adminPageState(),rows:[monitorStudent]}})
  for(const text of ['Same Name','ID-A','Total activities','View Activities','>IN<'])assert.ok(html.includes(text))
  assert.doesNotMatch(html,/Total edits|View Logs|Latest submission|Edit History/)
})
test('Current activity uses latest values and lazy proof without edit details or repeated student identity',async()=>{
  const html=await render('src/components/AdminRecords.vue',{state:{...adminPageState(),rows:[activity]}},{kind:'activities',monitorMode:'current',monitorFilters:{}})
  for(const text of ['IT Support','Real server update','Submitted','View private photo'])assert.ok(html.includes(text))
  assert.doesNotMatch(html,/Edited ×|Last edited|View Edit History|View Changes|Real Student|REAL-007|<img/)
})
test('Logs student summary is UID-based and shows totals and View Logs',async()=>{
  const html=await render('src/components/AdminActivityStudents.vue',{state:{...adminPageState(),rows:[monitorStudent,{...monitorStudent,id:'uid-b',student_id:'ID-B'}]}},{viewMode:'logs'})
  assert.equal((html.match(/data-student-uid=/g)||[]).length,2);assert.match(html,/Total edits/);assert.match(html,/>7</);assert.match(html,/View Logs/);assert.doesNotMatch(html,/Latest submission/)
})
test('Logs activity summary exposes edit information and View Changes, not eager descriptions/proofs',async()=>{
  const html=await render('src/components/AdminRecords.vue',{state:{...adminPageState(),rows:[activity,{...activity,id:'unedited',revision:0,updated_at:null}]}},{kind:'activities',monitorMode:'logs',monitorFilters:{}})
  for(const text of ['Edited ×3','Last edited','View Changes','No edits recorded.'])assert.ok(html.includes(text))
  assert.doesNotMatch(html,/Real server update|View private photo|View Edit History|First available version/)
})
test('timeline displays original/edits chronologically, marks Current and keeps photos lazy',async()=>{
  const rows=[0,1,2].map(revision=>({...activity,id:'internal-'+revision,revision,current_revision:2,version_at:activity.created_at}))
  const html=await render('src/components/AdminActivityTimeline.vue',{state:{...adminPageState(),rows}},{activityId:'activity'})
  assert.ok(html.indexOf('Original')<html.indexOf('Edit #1'));assert.ok(html.indexOf('Edit #1')<html.indexOf('Edit #2'))
  assert.match(html,/>Current</);assert.match(html,/View private photo/);assert.doesNotMatch(html,/<img|internal-0|private\/proof|revision|RPC/)
})
test('pre-S7 edited baseline is the first available version, never a fabricated original',async()=>{
  const html=await render('src/components/AdminActivityTimeline.vue',{state:{...adminPageState(),rows:[{...activity,revision:3,current_revision:3,version_at:activity.updated_at,migration_baseline:true}]}},{activityId:'activity'})
  assert.match(html,/First available version/);assert.match(html,/Edit history is available from this point./);assert.match(html,/>Current</)
  assert.doesNotMatch(html,/Original|Migration baseline|revision 0|private\/proof/)
})
test('timeline reuses bounded chronological revision cursor without new backend filter',async()=>{
  const calls=[],client={rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){return {data:[],error:null}}}}}
  const {default:c}=await load('src/components/AdminActivityTimeline.vue',{client}),instance=vm(c,{activityId:'activity'})
  await instance.load({revision:24},25);assert.equal(calls[0][0],'admin_activity_revisions')
  assert.deepEqual({...calls[0][1]},{target_activity:'activity',page_size:25,after_revision:24})
})
async function mountTabbedMonitor({activityGate=null}={}) {
  const state=vue.reactive(auth()),calls=[],revoked=[],listeners=new Set()
  let activityCalls=0
  const client={rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){
    if(name==='admin_activities' && ++activityCalls===1 && activityGate)return activityGate.promise
    return {data:name==='admin_activity_students'?[monitorStudent]:name==='admin_activities'?[{...activity,student_uid:'uid-a'}]:[{...activity,revision:3,current_revision:3,version_at:activity.updated_at,migration_baseline:true}],error:null}
  }}},storage:{from(){return {download(){calls.push(['download']);return {data:new Blob(['x'],{type:'image/png'}),error:null}}}}}}
  class Image {set src(value){this.naturalWidth=1;this.naturalHeight=1;this.onload()}}
  const {default:component}=await load('src/views/admin/ActivityMonitorView.vue',{state,client,virtualHost:true,globals:{Image,window:{addEventListener:(event,fn)=>listeners.add(fn),removeEventListener:(event,fn)=>listeners.delete(fn)},URL:{createObjectURL:()=> 'blob:tab-photo',revokeObjectURL:url=>revoked.push(url)}}})
  const {renderer,root}=testRenderer(),app=renderer.createApp(component)
  app.component('RouterLink',{render(){return vue.h('a',{},this.$slots.default?.())}})
  const instance=app.mount(root);await settle()
  return {app,instance,state,calls,revoked,listeners,find:name=>findComponent(instance.$.subTree,name)}
}
test('switching tabs destroys current photo/expanded/filter state; Logs loads changes only on explicit action',async()=>{
  const f=await mountTabbedMonitor()
  let students=f.find('AdminActivityStudents');students.search='Same';await settle();students.toggle('uid-a');await settle()
  let proof=f.find('AdminActivityProof');await proof.show();assert.equal(proof.url,'blob:tab-photo')
  assert.equal(f.calls.filter(c=>c[0]==='admin_activity_revisions').length,0)
  f.instance.activeTab='logs';await settle();assert.equal(proof.url,'');assert.equal(f.revoked.length,2)
  students=f.find('AdminActivityStudents');assert.equal(students.viewMode,'logs');assert.equal(students.search,'');assert.equal(students.opened,null)
  students.toggle('uid-a');await settle();assert.equal(f.find('AdminActivityProof'),null)
  const records=f.find('AdminRecords');assert.equal(records.monitorMode,'logs');records.opened='activity';await settle()
  assert.equal(f.calls.filter(c=>c[0]==='admin_activity_revisions').length,1);assert.equal(f.calls.filter(c=>c[0]==='download').length,1)
  proof=f.find('AdminActivityProof');await proof.show();assert.equal(f.calls.filter(c=>c[0]==='download').length,2)
  f.instance.activeTab='current';await settle();assert.equal(proof.url,'');assert.equal(f.revoked.length,4);assert.equal(f.find('AdminActivityTimeline'),null)
  f.app.unmount();assert.equal(f.listeners.size,0)
})
test('late activity response from Current cannot populate Logs after switching tabs',async()=>{
  const gate=defer(),f=await mountTabbedMonitor({activityGate:gate})
  f.find('AdminActivityStudents').toggle('uid-a');await settle();const old=f.find('AdminRecords');assert.equal(old.state.loading,true)
  f.instance.activeTab='logs';await settle();gate.resolve({data:[activity],error:null});await settle()
  assert.equal(old.state.rows.length,0);assert.equal(f.find('AdminRecords'),null);assert.equal(f.find('AdminActivityStudents').opened,null)
  f.app.unmount()
})
for(const ending of ['logout','unmount'])test(`Logs timeline and historical private proof clean up on ${ending}`,async()=>{
  const f=await mountTabbedMonitor();f.instance.activeTab='logs';await settle();f.find('AdminActivityStudents').toggle('uid-a');await settle();f.find('AdminRecords').opened='activity';await settle()
  const proof=f.find('AdminActivityProof'),timeline=f.find('AdminActivityTimeline');await proof.show()
  if(ending==='logout')f.state.user=null;else f.app.unmount()
  await settle();assert.equal(proof.url,'');assert.equal(timeline.state.rows.length,0);assert.equal(f.revoked.length,2)
  if(ending==='logout')f.app.unmount();assert.equal(f.listeners.size,0)
})
test('Logs makes submission-date and unedited inclusion semantics explicit',async()=>{
  const html=await render('src/views/admin/ActivityMonitorView.vue',{activeTab:'logs'})
  assert.match(html,/Includes unedited activities/);assert.match(html,/Date filters use the original submission date/)
  assert.match(html,/Submission date · Manila/);assert.doesNotMatch(html,/Edited only|Last edited date/)
})
