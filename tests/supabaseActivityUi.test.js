import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { parse } from '@vue/compiler-sfc'
import * as icons from 'lucide-vue-next'
import * as data from '../src/services/supabaseActivityData.js'
import * as photo from '../src/services/activityPhoto.js'
import { activityEditorState, createActivityController, activityFeedState, createActivityFeed } from '../src/services/studentActivityController.js'

const file = new Blob(['image bytes'], { type: 'image/png' })
const base = { id: 'activity', student_uid: 'alice', attendance_session_id: 'session', category: 'Other', description: 'Original',
  photo_path: 'alice/activity/proof', created_at: '2026-09-30T00:00:00Z', updated_at: null, revision: 0 }
const draft = { upload_id: 'upload', activity_id: 'activity', photo_path: 'alice/activity/proof' }
const form = () => ({ category: 'Documentation', description: ' New update ', file })
function defer() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function fixture() {
  const state = activityEditorState(), calls = []
  let stored = null, eligible = true, allocations = 0
  const api = {
    async prepare(id, existing) { calls.push(['prepare',id,existing]); return {...draft, photo_path: existing ? 'alice/activity/replacement/proof' : draft.photo_path} },
    async upload(ticket, blob) { calls.push(['upload',ticket,blob]) },
    async create(ticket, content) { calls.push(['create',ticket,content]); stored={...base,...content}; return stored },
    async edit(record, content, ticket) { calls.push(['edit',record,content,ticket]); stored={...record,...content,revision:record.revision+1,updated_at:'2026-09-30T02:00:00Z',photo_path:ticket?.photo_path || record.photo_path};return stored },
    async details() { calls.push(['details']);return stored },
    async proofMatches() { calls.push(['proof']);return true },
    async discard(ticket) { calls.push(['discard',ticket]) },
  }
  const summary=async()=>{calls.push(['summary']);return {open_session_id:'session'}}
  const options={api,summary,allowed:()=>eligible,uuid:()=>`request-${++allocations}`}
  const controller=createActivityController(state,options)
  return {state,api,calls,controller,options,stored:value=>{stored=value},deny:()=>{eligible=false},allocations:()=>allocations}
}

test('approved timed-in student follows prepare/upload/create with only content',async()=>{
  const f=fixture();await f.controller.save(form())
  assert.deepEqual(f.calls.map(c=>c[0]),['summary','prepare','upload','create'])
  assert.equal(f.state.saved.created_at,base.created_at);assert.equal(f.state.attempt,null);assert.equal(f.state.notice,'Activity submitted.')
  assert.deepEqual(f.calls.at(-1)[2],{category:'Documentation',description:'New update'})
})
test('closed attendance blocks creation; clearing the failed attempt allocates no upload',async()=>{
  const f=fixture();f.options.summary=async()=>({open_session_id:null})
  const controller=createActivityController(f.state,f.options);await controller.save(form())
  assert.match(f.state.error,/Time In/);assert.equal(f.calls.length,0)
  assert.equal(await controller.clear(),true);assert.equal(f.calls.length,0)
})
test('pending/rejected/nonstudent eligibility prevents every activity operation',async()=>{
  for(const status of ['pending','rejected','admin']) {
    const f=fixture();f.deny();await f.controller.save(form());assert.equal(f.calls.length,0,status)
  }
})
test('category whitelist matches all eight approved values',()=>{
  assert.equal(data.ACTIVITY_CATEGORIES.length,8)
  for(const category of data.ACTIVITY_CATEGORIES)assert.equal(data.activityContent(category,'text').category,category)
  assert.throws(()=>data.activityContent('Programming','text'),/INVALID_CATEGORY/)
})
for(const description of ['', ' \t\u2003\u00a0 ', null, '😀'.repeat(501), 'bad\u0000text']) {
  test(`invalid description rejected (${description === null ? 'null' : String(description).length} code units)`,()=>{
    assert.throws(()=>data.activityContent('Other',description),/INVALID_DESCRIPTION/)
  })
}
test('500 Unicode characters accepted despite 1000 UTF16 code units, with trim',()=>{
  assert.equal(data.characterCount(data.activityContent('Other','  '+'😀'.repeat(500)+'  ').description),500)
})
for(const type of data.PHOTO_TYPES) test(`${type} is accepted and decoded; temporary validation URL revoked`,async()=>{
  const events=[]
  const platform={URL:{createObjectURL(){events.push('create');return 'blob:test'},revokeObjectURL(){events.push('revoke')}},
    Image:class {naturalWidth=1;naturalHeight=1;set src(_){queueMicrotask(()=>this.onload())}}}
  await photo.validatePhoto(new Blob(['image'],{type}),platform)
  assert.deepEqual(events,['create','revoke'])
})
test('unsupported MIME, empty and oversized image rejected before decoding',()=>{
  assert.throws(()=>photo.checkPhoto(new Blob(['x'],{type:'image/svg+xml'})),/INVALID_PROOF/)
  assert.throws(()=>photo.checkPhoto(new Blob([],{type:'image/png'})),/INVALID_PROOF/)
  assert.throws(()=>photo.checkPhoto({type:'image/png',size:5*1024*1024+1}),/PHOTO_TOO_LARGE/)
})
test('corrupt image decode fails and revokes its URL',async()=>{
  let revoked=0
  await assert.rejects(photo.validatePhoto(file,{URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked++},Image:class{set src(_){queueMicrotask(()=>this.onerror())}}}),/PHOTO_DECODE_FAILED/)
  assert.equal(revoked,1)
})
test('duplicate Submit cannot launch parallel work or generate another request ID',async()=>{
  const f=fixture(),gate=defer();f.api.upload=()=>gate.promise
  const first=f.controller.save(form());await new Promise(r=>setImmediate(r))
  await f.controller.save(form());assert.equal(f.allocations(),1);assert.equal(f.state.busy,true);assert.equal(f.state.saved,null)
  gate.resolve();await first;assert.equal(f.calls.filter(c=>c[0]==='prepare').length,1)
})
test('prepare failure retains same request and immutable intended content on deliberate retry',async()=>{
  const f=fixture(),prepare=f.api.prepare;let fail=true
  f.api.prepare=async(...args)=>{if(fail){fail=false;throw new Error('network')}return prepare(...args)}
  await f.controller.save(form());assert.equal(f.state.attempt.requestId,'request-1');assert.equal(f.state.saved,null)
  await f.controller.save({...form(),description:'do not replace frozen content'})
  assert.equal(f.allocations(),1);assert.equal(f.state.saved.description,'New update')
})
test('lost upload response reconciles exact bytes, then deliberate retry skips reupload',async()=>{
  const f=fixture();let uploads=0;f.api.upload=async()=>{uploads++;throw new Error('network')}
  await f.controller.save(form());assert.equal(f.state.attempt.uploaded,true);assert.equal(f.state.saved,null)
  await f.controller.save(form());assert.equal(uploads,1);assert.ok(f.state.saved)
})
test('uncertain upload/read failure keeps retry blocked until reconciliation',async()=>{
  const f=fixture();f.api.upload=async()=>{throw new Error('network')};f.api.proofMatches=async()=>{throw new Error('network')}
  await f.controller.save(form());assert.equal(f.state.unresolved,true)
  const count=f.calls.length;await f.controller.save(form());assert.equal(f.calls.slice(count).some(c=>c[0]==='create'),false)
})
test('known create rejection remains friendly and keeps draft for safe cleanup',async()=>{
  const f=fixture();f.api.create=async()=>{throw new Error('NO_OPEN_ATTENDANCE')}
  await f.controller.save(form());assert.match(f.state.error,/Time In/);assert.ok(f.state.attempt);assert.equal(f.state.saved,null)
  assert.equal(await f.controller.clear(),true);assert.equal(f.calls.at(-1)[0],'discard')
})
test('lost committed create response reconciles by server ID without a duplicate',async()=>{
  const f=fixture(),create=f.api.create
  f.api.create=async(...args)=>{await create(...args);throw new Error('network')}
  await f.controller.save(form());assert.ok(f.state.saved);assert.equal(f.state.attempt,null)
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);assert.equal(f.calls.filter(c=>c[0]==='discard').length,0)
})
test('unknown uncommitted create is retried only deliberately with same reservation',async()=>{
  const f=fixture(),create=f.api.create;let first=true
  f.api.create=async(...args)=>{if(first){first=false;throw new Error('network')}return create(...args)}
  await f.controller.save(form());assert.equal(f.state.saved,null)
  await f.controller.save(form());assert.ok(f.state.saved);assert.equal(f.allocations(),1)
  assert.equal(f.calls.filter(c=>c[0]==='prepare').length,1)
})
test('metadata-only edit after Time Out never checks attendance or uploads and preserves authority',async()=>{
  const f=fixture();f.stored(base);await f.controller.save({...form(),file:null},base)
  assert.deepEqual(f.calls.map(c=>c[0]),['edit']);assert.equal(f.state.saved.created_at,base.created_at)
  assert.equal(f.state.saved.student_uid,base.student_uid);assert.equal(f.state.saved.attendance_session_id,base.attendance_session_id)
})
test('replacement uses new reservation bound to existing activity',async()=>{
  const f=fixture();f.stored(base);await f.controller.save(form(),base)
  assert.deepEqual(f.calls.map(c=>c[0]),['prepare','upload','edit'])
  assert.equal(f.calls[0][2],base.id);assert.equal(f.state.saved.photo_path,'alice/activity/replacement/proof')
  assert.equal(f.calls.some(c=>c[0]==='discard'),false)
})
test('failed replacement preserves old server proof and cleans new proof only through discard',async()=>{
  const f=fixture();f.stored(base);f.api.edit=async()=>{throw new Error('INVALID_PROOF')}
  await f.controller.save(form(),base);assert.equal(f.state.saved,null)
  assert.equal((await f.api.details()).photo_path,base.photo_path)
  await f.controller.clear();assert.equal(f.calls.at(-1)[0],'discard');assert.notEqual(f.calls.at(-1)[1].photo_path,base.photo_path)
})
test('lost committed edit reconciles original revision and intended content',async()=>{
  const f=fixture(),edit=f.api.edit;f.stored(base);f.api.edit=async(...args)=>{await edit(...args);throw new Error('network')}
  await f.controller.save({...form(),file:null},base);assert.equal(f.state.saved.revision,1)
  assert.equal(f.calls.filter(c=>c[0]==='edit').length,1)
})
test('ACTIVITY_CHANGED loads latest row and does not overwrite it',async()=>{
  const f=fixture(),current={...base,revision:2,description:'Someone else saved'};f.stored(current)
  f.api.edit=async()=>{throw new Error('ACTIVITY_CHANGED')}
  await f.controller.save({...form(),file:null},base)
  assert.deepEqual(f.state.conflict,current);assert.match(f.state.error,/changed elsewhere/);assert.equal(f.state.saved,null)
})
test('uncertain mutation cleanup first reads server; read failure never discards proof',async()=>{
  const f=fixture();f.api.create=async()=>{throw new Error('network')};f.api.details=async()=>{throw new Error('network')}
  await f.controller.save(form());assert.equal(await f.controller.clear(),false)
  assert.equal(f.calls.some(c=>c[0]==='discard'),false)
})
test('account change/unmount prevents late responses and further operations',async()=>{
  const f=fixture(),gate=defer();f.api.prepare=()=>gate.promise
  const pending=f.controller.save(form());await new Promise(r=>setImmediate(r))
  f.controller.stop();f.deny();gate.resolve(draft);await pending
  assert.equal(f.state.saved,null);assert.equal(f.state.attempt,null);assert.equal(f.calls.some(c=>c[0]==='upload'),false)
})
test('history uses bounded pages/cursors and does not append unbounded records',async()=>{
  const state=activityFeedState(),calls=[]
  const pages=[[{...base,id:'a'},{...base,id:'b'}],[{...base,id:'c'}]]
  const controller=createActivityFeed(state,{history:async(size,cursor)=>{calls.push([size,cursor]);return pages[cursor?1:0]}},2)
  await controller.refresh();await controller.next();assert.equal(state.records.length,1);assert.equal(state.records[0].id,'c')
  assert.equal(calls[1][1].id,'b');assert.equal(state.next,false)
  await controller.previous();assert.equal(state.page,0);assert.equal(state.records.length,2)
})
test('dashboard requests only three latest records from the same feed',async()=>{
  const state=activityFeedState(),sizes=[]
  await createActivityFeed(state,{history:async size=>{sizes.push(size);return [base]}},3).refresh()
  assert.deepEqual(sizes,[3]);assert.equal(state.records[0].id,base.id)
})
test('stale history response after account change is discarded',async()=>{
  const state=activityFeedState(),gate=defer(),controller=createActivityFeed(state,{history:()=>gate.promise})
  const pending=controller.refresh();controller.stop();gate.resolve([base]);await pending;assert.deepEqual(state.records,[])
})
test('history errors preserve pagination position and show recoverable feedback',async()=>{
  const state=activityFeedState(),controller=createActivityFeed(state,{history:async()=>{throw new Error('internal SQL detail')}})
  await controller.refresh();assert.equal(state.busy,false);assert.doesNotMatch(state.error,/SQL/)
})
test('camera starts only on request with video/no audio, and stops on cancel',async()=>{
  let calls=0,stops=0
  const camera=photo.createActivityCamera({async getUserMedia(options){calls++;assert.equal(options.audio,false);return {getTracks:()=>[{stop:()=>stops++}]}}})
  assert.equal(calls,0);await camera.start();camera.stop();assert.equal(stops,1)
})
test('camera released if permission result arrives after component close',async()=>{
  const gate=defer();let stops=0
  const camera=photo.createActivityCamera({getUserMedia:()=>gate.promise})
  const starting=camera.start();camera.stop();gate.resolve({getTracks:()=>[{stop:()=>stops++}]})
  assert.equal(await starting,null);assert.equal(stops,1)
})
test('camera capture stops tracks and produces the same uploadable Blob as gallery',async()=>{
  let stops=0;const camera=photo.createActivityCamera({getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})})
  await camera.start()
  const blob=await camera.capture({videoWidth:2560,videoHeight:1920},{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob(callback,type){callback(new Blob(['image'],{type}))}})})
  assert.equal(blob.type,'image/jpeg');assert.equal(stops,1)
  const f=fixture();await f.controller.save({...form(),file:blob});assert.equal(f.calls.find(c=>c[0]==='upload')[2],blob)
})
for (const stage of ['dimensions', 'canvas', 'draw', 'encoding']) test(`camera tracks stop when capture fails at ${stage}`, async () => {
  let stops = 0
  const camera = photo.createActivityCamera({ getUserMedia: async () => ({ getTracks: () => [{ stop: () => stops++ }] }) })
  await camera.start()
  const video = { videoWidth: stage === 'dimensions' ? 0 : 640, videoHeight: 480 }
  const documentObject = { createElement() {
    if (stage === 'canvas') throw new Error('canvas failed')
    return { getContext: () => ({ drawImage() { if (stage === 'draw') throw new Error('draw failed') } }), toBlob(callback) { callback(null) } }
  } }
  await assert.rejects(camera.capture(video, documentObject))
  assert.equal(stops, 1)
  camera.stop()
  assert.equal(stops, 1)
})
for(const name of ['NotAllowedError','NotFoundError','SecurityError']) test(`camera ${name} maps friendly message`,async()=>{
  const camera=photo.createActivityCamera({getUserMedia:async()=>{throw {name}}})
  await assert.rejects(camera.start(),error=>error.name===name)
  assert.match(photo.cameraError({name}),/camera|Camera/)
})
test('unsupported or insecure camera fails without requesting media',async()=>{
  await assert.rejects(photo.createActivityCamera(null).start(),/CAMERA_UNAVAILABLE/)
  await assert.rejects(photo.createActivityCamera({getUserMedia:()=>assert.fail()},false).start(),/CAMERA_UNAVAILABLE/)
})
test('all expected S5 errors are friendly and unknown details are hidden',()=>{
  for(const message of ['AUTHENTICATION_REQUIRED','APPROVED_STUDENT_REQUIRED','NO_OPEN_ATTENDANCE','INVALID_CATEGORY','INVALID_DESCRIPTION','INVALID_UPLOAD','PROOF_REQUIRED','INVALID_PROOF','UPLOAD_EXPIRED_OR_DISCARDED','ACTIVITY_ALREADY_EXISTS','ACTIVITY_NOT_FOUND','ACTIVITY_CHANGED','PROOF_IN_USE','REQUEST_CONFLICT','INVALID_PAGE']) {
    assert.notEqual(data.activityError({message}),message);assert.doesNotMatch(data.activityError({message}),/result could not be confirmed/)
  }
  assert.doesNotMatch(data.activityError(new Error('private backend detail')),/private backend/)
})

async function loadModule(path, imports, globals) {
  let source=await readFile(new URL(path,import.meta.url),'utf8')
  if(path.endsWith('.vue'))source=parse(source).descriptor.script.content
  const context=globals?createContext({URL,Blob,AbortController,setTimeout,clearTimeout,...globals}):undefined
  const module=new SourceTextModule(source,{context})
  await module.link(specifier=>{
    const values=imports[specifier] || (specifier==='lucide-vue-next'?icons:{default:{}})
    return new SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value)},{context})
  });await module.evaluate();return module.namespace
}
test('API wrapper uses exact S5 RPC arguments, authenticated download, and authorized discard order',async()=>{
  const calls=[],rpcQuery=value=>({retry(enabled){assert.equal(enabled,false);return this},abortSignal(){return Promise.resolve({data:value,error:null})}})
  const storage={upload(path,blob,options){calls.push(['upload',path,options]);return {data:{},error:null}},
    download(path,options,parameters){calls.push(['download',path,parameters]);return {data:file,error:null}},
    remove(paths){calls.push(['remove',paths]);return {data:[],error:null}}}
  const client={rpc(name,args){calls.push([name,args]);return rpcQuery(name==='activity_prepare'?[draft]:name==='activity_discard_proof'?draft.photo_path:base)},storage:{from(bucket){assert.equal(bucket,'activity-proofs');return storage}}}
  const module=await loadModule('../src/services/supabaseActivities.js',{
    '../supabase/supabase.js':{supabase:client},'./auth':{authState:{}},'./supabaseActivityData.js':data,'./activityPhoto.js':photo,
  })
  const api=module.createActivityApi(client,()=>({id:'alice',approved:true}))
  await api.prepare('request');await api.upload(draft,file);await api.create(draft,{...form(),student_uid:'forged',created_at:'forged'});await api.edit(base,form());await api.download(draft.photo_path);await api.discard(draft)
  assert.deepEqual(Object.keys(calls.find(c=>c[0]==='activity_create')[1]).sort(),['category','description','upload_id'])
  assert.deepEqual(Object.keys(calls.find(c=>c[0]==='activity_edit')[1]).sort(),['activity_id','category','description','expected_revision','replacement_upload_id'])
  assert.equal(calls.find(c=>c[0]==='upload')[2].upsert,false)
  assert.equal(calls.find(c=>c[0]==='download')[2].cache,'no-store')
  assert.deepEqual(calls.slice(-2).map(c=>c[0]),['activity_discard_proof','remove'])
})
test('private proof component downloads on demand and revokes URL on hide/path/account/unmount',async()=>{
  let downloaded=0;const revoked=[]
  const {default:component}=await loadModule('../src/components/PrivateActivityProof.vue',{
    '../services/supabaseActivities.js':{activityApi:{download:async()=>{downloaded++;return file}},activityAccountKey:()=> 'alice'},
    '../services/activityPhoto.js':{validatePhoto:async x=>x},
  },{URL:{createObjectURL:()=> 'blob:private',revokeObjectURL:url=>revoked.push(url)}})
  const vm={...component.data(),path:draft.photo_path};for(const [key,method]of Object.entries(component.methods))vm[key]=method.bind(vm)
  assert.equal(downloaded,0);await vm.show();assert.equal(vm.url,'blob:private');await vm.show();assert.deepEqual(revoked,['blob:private'])
  await vm.show();component.watch.path.call(vm);await vm.show();component.watch.accountKey.call(vm);await vm.show();component.beforeUnmount.call(vm)
  assert.equal(revoked.length,4)
})
test('camera component stops media on close, backgrounding and unmount', async () => {
  let stops = 0, closed = 0, removed = 0
  const { default: component } = await loadModule('../src/components/ActivityCamera.vue', {
    '../services/activityPhoto.js': photo,
  }, { document: { hidden: true, removeEventListener() { removed++ } } })
  const vm = { ...component.data(), camera: { stop() { stops++ } }, $emit() { closed++ }, $refs: { dialog: { close() {} } } }
  for (const [key, method] of Object.entries(component.methods)) vm[key] = method.bind(vm)
  vm.close(); vm.visibilityChanged(); component.beforeUnmount.call(vm)
  assert.equal(stops, 3); assert.equal(closed, 2); assert.equal(removed, 1); assert.equal(vm.alive, false)
})

test('successful create resets editor form only after server confirmation',async()=>{
  const {default:component}=await loadModule('../src/components/ActivityEditor.vue',{
    '../services/supabaseActivities.js':{activityApi:{},activityAccountKey:()=> 'alice',approvedActivityStudent:()=>true},
    '../services/supabaseAttendance.js':{getAttendanceSummary:async()=>({})},
    '../services/studentActivityController.js':{activityEditorState,createActivityController},
    '../services/supabaseActivityData.js':data,
  })
  const vm={form:form(),editor:activityEditorState(),$emit(){}};component.methods.confirmed.call(vm);assert.equal(vm.form.file,file)
  vm.editor.saved=base;component.methods.confirmed.call(vm);assert.equal(vm.form.file,null);assert.equal(vm.form.description,'')
})
test('student view integration is bounded/real, preserves S4, and removes debug global',async()=>{
  const [dashboard,history,activity,client,feed]=await Promise.all(['src/views/student/StudentDashboard.vue','src/views/student/HistoryView.vue','src/views/student/ActivityView.vue','src/supabase/supabase.js','src/components/ActivityFeed.vue'].map(p=>readFile(p,'utf8')))
  assert.match(dashboard,/<ActivityFeed recent/);assert.match(history,/<ActivityFeed/)
  for(const source of [dashboard,history,activity]){assert.match(source,/studentAttendanceMixin/);assert.doesNotMatch(source,/sample|mock|previewSubmit|firebase/i)}
  assert.doesNotMatch(client,/__supabase/);assert.match(feed,/this.recent \? 3 : 25/);assert.match(feed,/Date on this page/)
})
