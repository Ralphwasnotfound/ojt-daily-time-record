import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import { createAttendanceCamera, checkSelfie, selfieError } from '../src/services/attendanceCapture.js'
import { getAttendanceLocation, validAttendanceLocation } from '../src/services/attendanceLocation.js'
import { attendanceProofState, createAttendanceProofController, attendanceProofError, getDeferredAttendanceProof } from '../src/services/attendanceProofController.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject} }
const photo = new Blob(['camera bytes'],{type:'image/jpeg'})
const location = { latitude:14.6,longitude:121,accuracy:12 }
const draft = { upload_id:'upload',attendance_session_id:'session',photo_path:'alice/session/upload/proof' }
const receipt = (action='time_in') => ({id:'proof',student_uid:'alice',...draft,action_type:action,official_punch_at:'2026-10-02T01:00:00Z',...location})
function fixture(action='time_in') {
 const state=attendanceProofState(),calls=[];let enabled=true
 const api={prepare:async(...args)=>{calls.push(['prepare',...args]);return draft},upload:async(...args)=>{calls.push(['upload',...args])},
 uploaded:async()=>{calls.push(['uploaded']);return true},finalize:async(...args)=>{calls.push(['finalize',...args]);return receipt(action)},
 result:async()=>{calls.push(['result']);return null},discard:async()=>{calls.push(['discard'])}}
 const options={api,owner:'alice',action,allowed:()=>enabled,uuid:()=> 'request',locate:async()=>{calls.push(['location']);return location}}
 return {state,calls,api,options,disable:()=>enabled=false,start:()=>createAttendanceProofController(state,options)}
}
function cameraFixture() {
 let stops=0;const stream={getTracks:()=>[{stop:()=>stops++}]},calls=[]
 const camera=createAttendanceCamera({getUserMedia:async c=>{calls.push(c);return stream}})
 const canvas={getContext:()=>({drawImage(){}}),toBlob:cb=>cb(photo)}
 return {camera,stream,calls,canvas,document:{createElement:()=>canvas},stops:()=>stops}
}
test('selfie capture prefers front camera, preserves dimensions and stops on successful encoding',async()=>{
 const f=cameraFixture();await f.camera.start();const blob=await f.camera.capture({videoWidth:4000,videoHeight:3000},f.document)
 assert.equal(blob,photo);assert.equal(f.canvas.width,1920);assert.equal(f.canvas.height,1440);assert.equal(f.stops(),1)
 assert.deepEqual(f.calls,[{video:{facingMode:{ideal:'user'}},audio:false}])
})
for(const failure of ['dimensions','canvas','encoding'])test(`camera stops when capture fails: ${failure}`,async()=>{
 const f=cameraFixture();await f.camera.start()
 if(failure==='canvas')f.canvas.getContext=()=>null
 if(failure==='encoding')f.canvas.toBlob=cb=>cb(null)
 await assert.rejects(f.camera.capture({videoWidth:failure==='dimensions'?0:640,videoHeight:480},f.document));assert.equal(f.stops(),1)
})
test('laptop fallback only for constraints; permission denial is not repeatedly prompted',async()=>{
 let calls=0;const f=cameraFixture();const camera=createAttendanceCamera({getUserMedia:async args=>{calls++;if(calls===1)throw {name:'OverconstrainedError'};assert.equal(args.video,true);return f.stream}})
 await camera.start();camera.stop();assert.equal(calls,2)
 calls=0;await assert.rejects(createAttendanceCamera({getUserMedia:async()=>{calls++;throw {name:'NotAllowedError'}}}).start());assert.equal(calls,1)
 assert.match(selfieError({name:'NotAllowedError'}),/permission/)
})
test('late camera grant after cancel stops immediately',async()=>{
 const f=cameraFixture(),gate=deferred();const camera=createAttendanceCamera({getUserMedia:()=>gate.promise})
 const opening=camera.start();camera.stop();gate.resolve(f.stream);assert.equal(await opening,null);assert.equal(f.stops(),1)
})
test('no camera and busy webcam produce useful errors without gallery fallback',async()=>{
 for(const [name,expected]of [['NotFoundError',/No camera/],['NotReadableError',/busy/]]){
  await assert.rejects(createAttendanceCamera({getUserMedia:async()=>{throw {name}}}).start())
  assert.match(selfieError({name}),expected)
 }
})
test('cancelled old encoding cannot stop a newly opened camera',async()=>{
 const f=cameraFixture(),gate=deferred();await f.camera.start();f.canvas.toBlob=cb=>gate.promise.then(cb)
 const capture=f.camera.capture({videoWidth:640,videoHeight:480},f.document);f.camera.stop();await f.camera.start()
 gate.resolve(photo);await assert.rejects(capture,/CAPTURE_CANCELLED/);assert.equal(f.stops(),1);f.camera.stop();assert.equal(f.stops(),2)
})
test('insecure/unsupported cameras and invalid images fail closed',async()=>{
 await assert.rejects(createAttendanceCamera({},false).start())
 for(const blob of [null,new Blob([],{type:'image/jpeg'}),new Blob(['x'],{type:'image/png'}),{type:'image/jpeg',size:5242881}])assert.throws(()=>checkSelfie(blob),/INVALID_SELFIE/)
})
test('location requires fresh finite coordinates and accepts low accuracy without geofencing',async()=>{
 const result=await getAttendanceLocation({now:()=>1000,geolocation:{getCurrentPosition(ok,fail,options){assert.equal(options.maximumAge,0);assert.equal(options.enableHighAccuracy,true);ok({timestamp:1000,coords:{...location,accuracy:10000}})}}})
 assert.equal(result.accuracy,10000);assert.ok(Object.isFrozen(result));assert.equal(validAttendanceLocation({...location,latitude:NaN}),false)
})
for(const [code,message] of [[1,'LOCATION_DENIED'],[2,'LOCATION_UNAVAILABLE'],[3,'LOCATION_TIMEOUT']])test(`location error ${code} stays explicit`,async()=>{
 await assert.rejects(getAttendanceLocation({geolocation:{getCurrentPosition(ok,fail){fail({code})}}}),new RegExp(message))
 assert.doesNotMatch(attendanceProofError(new Error(message)),/result could not be confirmed/)
})
test('unsupported, stale, invalid and timed-out location cannot succeed',async()=>{
 await assert.rejects(getAttendanceLocation({geolocation:{}}),/LOCATION_UNSUPPORTED/)
 for(const coords of [location,{...location,longitude:181}])await assert.rejects(getAttendanceLocation({now:()=>50000,geolocation:{getCurrentPosition(ok){ok({timestamp:0,coords})}}}),/INVALID_LOCATION/)
 await assert.rejects(getAttendanceLocation({timeoutMs:5,geolocation:{getCurrentPosition(){}}}),/LOCATION_TIMEOUT/)
})
test('abort ignores late geolocation callback',async()=>{
 const abort=new AbortController();let callback
 const pending=getAttendanceLocation({signal:abort.signal,geolocation:{getCurrentPosition(ok){callback=ok}}})
 abort.abort();callback({timestamp:Date.now(),coords:location});await assert.rejects(pending,/LOCATION_CANCELLED/)
})
for(const action of ['time_in','time_out'])test(`${action} submits location, prepare, immutable upload and finalize exactly once`,async()=>{
 const f=fixture(action),controller=f.start();await controller.submit(photo);await controller.submit(photo)
 assert.deepEqual(f.calls.map(c=>c[0]),['location','prepare','upload','finalize']);assert.equal(f.state.saved.action_type,action)
 assert.equal(f.calls[1][1],'request');assert.equal(f.calls[2][2],photo);assert.deepEqual(f.calls[3][2],location)
})
test('duplicate Continue shares one operation',async()=>{
 const f=fixture(),gate=deferred();f.options.locate=()=>gate.promise;const controller=f.start()
 const a=controller.submit(photo),b=controller.submit(photo);assert.equal(a,b);gate.resolve(location);await a
 assert.equal(f.calls.filter(c=>c[0]==='prepare').length,1)
})
test('location denial retries before any prepare; invalid coordinates also block prepare',async()=>{
 const f=fixture();let fail=true;f.options.locate=async()=>{if(fail)throw new Error('LOCATION_DENIED');return location}
 const controller=f.start();await controller.submit(photo);assert.equal(f.calls.length,0);assert.match(f.state.error,/permission/)
 fail=false;await controller.submit(photo);assert.ok(f.state.saved)
 const g=fixture();g.options.locate=async()=>({...location,latitude:91});await g.start().submit(photo);assert.equal(g.calls.length,0);assert.equal(g.state.attempt.location,null)
})
test('lost prepare response reuses request ID and original coordinates/selfie',async()=>{
 const f=fixture();let n=0;const prepare=f.api.prepare;f.api.prepare=async(...a)=>{const d=await prepare(...a);if(!n++)throw Error('RESULT_UNKNOWN');return d}
 const controller=f.start();await controller.submit(photo);await controller.submit(new Blob(['different'],{type:'image/jpeg'}))
 assert.deepEqual(f.calls.filter(c=>c[0]==='prepare').map(c=>c[1]),['request','request']);assert.equal(f.calls.filter(c=>c[0]==='location').length,1)
 assert.equal(f.calls.find(c=>c[0]==='upload')[2],photo);assert.ok(f.state.saved)
})
for(const exists of [true,false])test(`uncertain upload checks bytes before retry (exists=${exists})`,async()=>{
 const f=fixture();let n=0;const upload=f.api.upload;f.api.upload=async(...a)=>{await upload(...a);if(!n++)throw Error('RESULT_UNKNOWN')}
 f.api.uploaded=async()=>{f.calls.push(['uploaded']);return exists};const controller=f.start()
 await controller.submit(photo);assert.equal(f.state.unresolved,true);await controller.submit(photo)
 assert.ok(f.state.saved);assert.equal(f.calls.filter(c=>c[0]==='upload').length,exists?1:2);assert.equal(f.calls.filter(c=>c[0]==='prepare').length,1)
})
test('mismatched stored selfie is never overwritten/finalized',async()=>{
 const f=fixture();f.api.upload=async()=>{throw Error('unknown')};f.api.uploaded=async()=>{throw Error('PROOF_CONFLICT')}
 const controller=f.start();await controller.submit(photo);await controller.submit(photo);assert.equal(f.state.blocked,true)
 assert.ok(!f.calls.some(c=>c[0]==='finalize'));assert.equal(await controller.cancel(),true);assert.ok(f.calls.some(c=>c[0]==='discard'))
})
test('lost finalize response recovers receipt without new punch even if refresh fails',async()=>{
 const f=fixture();f.api.finalize=async()=>{throw Error('RESULT_UNKNOWN')};f.api.result=async()=>receipt();f.options.refresh=async()=>{throw Error('offline')}
 await f.start().submit(photo);assert.ok(f.state.saved);assert.equal(f.state.attempt,null)
})
test('unconfirmed finalize keeps ID/coordinates and retries exact request only',async()=>{
 const f=fixture();let n=0;const finalize=f.api.finalize;f.api.finalize=async(...args)=>{const r=await finalize(...args);if(!n++)throw Error('RESULT_UNKNOWN');return r}
 const controller=f.start();await controller.submit(photo);assert.equal(f.state.unresolved,true);await controller.submit(photo)
 const writes=f.calls.filter(c=>c[0]==='finalize');assert.equal(writes.length,2);assert.equal(writes[0][1],writes[1][1]);assert.equal(writes[0][2],writes[1][2]);assert.ok(f.state.saved)
})
test('cancel waits for pending prepare and discards without upload/finalize',async()=>{
 const f=fixture(),gate=deferred();f.api.prepare=()=>gate.promise;const controller=f.start();const submit=controller.submit(photo);await tick()
 const cancel=controller.cancel();gate.resolve(draft);await submit;assert.equal(await cancel,true);assert.deepEqual(f.calls.map(c=>c[0]),['location','discard'])
})
test('cancel after unknown finalize recovers committed receipt and never deletes attached proof',async()=>{
 const f=fixture();f.api.finalize=async()=>{throw Error('unknown')};const controller=f.start();await controller.submit(photo)
 f.api.result=async()=>receipt();assert.equal(await controller.cancel(),true);assert.ok(f.state.saved);assert.ok(!f.calls.some(c=>c[0]==='discard'))
})
test('receipt conflict blocks retry but safe cancel accepts server result without deleting it',async()=>{
 const f=fixture();f.api.finalize=async()=>({...receipt(),accuracy:13});f.api.result=async()=>({...receipt(),accuracy:13})
 const controller=f.start();await controller.submit(photo);assert.equal(f.state.blocked,true);assert.equal(await controller.cancel(),true)
 assert.equal(f.state.saved.accuracy,13);assert.ok(!f.calls.some(c=>c[0]==='discard'))
})
test('discard racing finalization recovers PROOF_IN_USE receipt',async()=>{
 const f=fixture();f.api.upload=async()=>{throw Error('unknown')};f.api.discard=async()=>{throw Error('PROOF_IN_USE')};f.api.result=async()=>receipt()
 const controller=f.start();await controller.submit(photo);assert.equal(await controller.cancel(),true);assert.ok(f.state.saved)
})
test('failed cancellation retains attempt and can retry safely',async()=>{
 const f=fixture();f.api.upload=async()=>{throw Error('unknown')};const controller=f.start();await controller.submit(photo)
 f.api.discard=async()=>{throw Error('offline')};assert.equal(await controller.cancel(),false);assert.ok(f.state.attempt)
 f.api.discard=async()=>{};assert.equal(await controller.cancel(),true);assert.equal(f.state.attempt,null)
})
test('unmount waits for late upload then discards; never finalizes',async()=>{
 const f=fixture(),gate=deferred();f.api.upload=()=>gate.promise;const controller=f.start();const pending=controller.submit(photo);await tick()
 controller.stop();gate.resolve();await pending;await tick();assert.deepEqual(f.state,attendanceProofState());assert.ok(f.calls.some(c=>c[0]==='discard'));assert.ok(!f.calls.some(c=>c[0]==='finalize'))
})
test('account change drops late work and does not clean up using another account',async()=>{
 const f=fixture(),gate=deferred();f.api.prepare=()=>gate.promise;const controller=f.start();const pending=controller.submit(photo);await tick()
 f.disable();controller.stop();gate.resolve(draft);await pending;await tick();assert.ok(!f.calls.some(c=>['upload','finalize','discard'].includes(c[0])))
})
test('foreign receipt is rejected and raw errors are not shown',async()=>{
 const f=fixture();f.api.finalize=async()=>({...receipt(),student_uid:'bob'});await f.start().submit(photo)
 assert.equal(f.state.saved,null);assert.doesNotMatch(f.state.error,/INVALID_RECEIPT/);assert.doesNotMatch(attendanceProofError(new Error('secret detail')),/secret/)
})
for(const message of ['ATTENDANCE_STATE_CHANGED','UPLOAD_EXPIRED_OR_DISCARDED','ALREADY_TIMED_IN','NO_OPEN_ATTENDANCE','DAILY_ATTENDANCE_LIMIT_REACHED','APPROVED_STUDENT_REQUIRED'])test(`${message} stops submission with friendly feedback`,async()=>{
 const f=fixture();f.api.prepare=async()=>{throw Error(message)};const controller=f.start();await controller.submit(photo)
 assert.equal(f.state.blocked,true);assert.equal(f.state.saved,null);assert.ok(!f.calls.some(c=>c[0]==='upload'));assert.doesNotMatch(f.state.error,new RegExp(message))
})

function synthetic(values){return new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)})}
async function loadApi(){
 const module=new SourceTextModule(await readFile(new URL('../src/services/supabaseAttendanceProofs.js',import.meta.url),'utf8'))
 await module.link(s=>synthetic(s.includes('supabase/supabase')?{supabase:null}:s==='./auth'?{authState:{}}:s.includes('Capture')?{checkSelfie}:s.includes('Location')?{validAttendanceLocation}:{trackAttendanceWrite:fn=>fn()}));await module.evaluate();return module.namespace.createAttendanceProofApi
}
const createApi=await loadApi()
test('API uses exact reserved path, immutable upload, minimal finalize args and discard before delete',async()=>{
 const calls=[];const client={rpc(name,args){calls.push([name,args]);return {retry(flag){assert.equal(flag,false);return this},abortSignal(){return Promise.resolve({data:name.endsWith('prepare')?[draft]:name.endsWith('discard')?draft.photo_path:receipt(),error:null})}}},storage:{from(bucket){assert.equal(bucket,'attendance-proofs');return {upload:async(...args)=>{calls.push(['upload',...args]);return {data:{},error:null}},remove:async paths=>{calls.push(['remove',paths]);return {data:[],error:null}}}}}}
 const api=createApi(client,()=>({id:'alice',approved:true}));await api.prepare('request','time_in');await api.upload(draft,photo);await api.finalize(draft,location);await api.discard(draft)
 assert.deepEqual(calls[1],['upload',draft.photo_path,photo,{contentType:'image/jpeg',upsert:false}]);assert.deepEqual(calls[2],['attendance_proof_finalize',{upload_id:'upload',...location}])
 assert.deepEqual(calls.slice(-2).map(c=>c[0]),['attendance_proof_discard','remove']);assert.throws(()=>api.upload({...draft,photo_path:'other'},photo),/INVALID_UPLOAD/)
})
test('API checks stored bytes and never deletes if discard is refused',async()=>{
 let stored=photo,removed=false;const client={rpc(){return {retry(){return this},abortSignal(){return {error:new Error('PROOF_IN_USE')}}}},storage:{from(){return {download:async()=>({data:stored,error:null}),remove:async()=>{removed=true}}}}}
 const api=createApi(client,()=>({id:'alice',approved:true}));assert.equal(await api.uploaded(draft,photo),true)
 stored=new Blob(['different']);await assert.rejects(api.uploaded(draft,photo),/PROOF_CONFLICT/);await assert.rejects(api.discard(draft),/PROOF_IN_USE/);assert.equal(removed,false)
})
test('API bounds unknown network results and rejects late identity changes',async()=>{
 const gate=deferred();let id='alice';const client={rpc(){return {retry(){return this},abortSignal(){return gate.promise}}}}
 const api=createApi(client,()=>({id,approved:true}),5);await assert.rejects(api.prepare('r','time_in'),/RESULT_UNKNOWN/)
 const other=createApi(client,()=>({id,approved:true}));const pending=other.prepare('r','time_in');id='bob';gate.resolve({data:[draft],error:null});await assert.rejects(pending,/AUTHENTICATION_REQUIRED/)
})
test('API rejects non-approved and missing accounts before any network request',async()=>{
 for(const account of [{id:'alice',approved:false},{id:null,approved:false}]){
  const api=createApi({rpc(){assert.fail('unauthorized network request')}},()=>account)
  await assert.rejects(api.prepare('r','time_in'),/APPROVED_STUDENT_REQUIRED|AUTHENTICATION_REQUIRED/)
 }
})

const source=await readFile(new URL('../src/components/AttendanceVerification.vue',import.meta.url),'utf8')
const {descriptor}=parse(source);const componentModule=new SourceTextModule(descriptor.script.content)
await componentModule.link(s=>synthetic(s==='lucide-vue-next'?{Camera:{},X:{},RotateCcw:{},MapPin:{}}:s.includes('Capture')?{createAttendanceCamera,selfieError}:s.includes('Proofs')?{attendanceProofApi:()=>({})}:{attendanceProofState,createAttendanceProofController}));await componentModule.evaluate()
const component=componentModule.namespace.default
function view(){const vm={...component.data(),...component.methods,$refs:{video:{srcObject:null},dialog:{close(){}}},$emit(){},$nextTick:async()=>{},eligible:true};for(const key of Object.keys(component.methods))vm[key]=vm[key].bind(vm);return vm}
test('component Retry reaches a new native geolocation request and retains the denied attempt',async()=>{
 const f=fixture(),vm=view();let requests=0,success
 const geolocation={getCurrentPosition(ok,fail){requests++;if(requests===1)fail({code:1});else success=ok}}
 f.options.locate=options=>getAttendanceLocation({...options,geolocation})
 vm.flow=f.state;vm.controller=f.start();vm.blob=photo;vm.preview='blob:retained'
 await vm.submit();assert.equal(requests,1);assert.equal(f.calls.length,0);assert.equal(vm.blob,photo);assert.equal(vm.preview,'blob:retained')
 const attempt=f.state.attempt;assert.equal(attempt.location,null);assert.equal(attempt.draft,null)
 const retry=vm.submit();assert.equal(requests,2);assert.equal(f.state.error,'');assert.equal(f.state.busy,true);assert.match(f.state.phase,/Getting your location/)
 await vm.submit();assert.equal(requests,2);assert.equal(f.state.attempt,attempt)
 success({timestamp:Date.now(),coords:location});await retry
 assert.ok(f.state.saved);assert.deepEqual(f.calls.map(c=>c[0]),['prepare','upload','finalize']);assert.equal(f.calls[0][1],attempt.requestId)
})
test('denied permission later granted retries native geolocation and succeeds with the same selfie and request ID',async()=>{
 const f=fixture();let permission='denied',requests=0,queries=0
 const permissions={query:async args=>{assert.deepEqual(args,{name:'geolocation'});queries++;return {state:permission}}}
 const geolocation={getCurrentPosition(ok,fail){requests++;if(permission==='denied')fail({code:1});else ok({timestamp:Date.now(),coords:location})}}
 f.options.locate=options=>getAttendanceLocation({...options,permissions,geolocation})
 const controller=f.start();await controller.submit(photo)
 const attempt=f.state.attempt;assert.match(f.state.error,/still reported as blocked/);assert.equal(attempt.blob,photo);assert.equal(f.calls.length,0)
 permission='granted';await controller.submit(photo)
 assert.equal(requests,2);assert.equal(queries,1);assert.ok(f.state.saved);assert.equal(f.calls[0][1],attempt.requestId);assert.equal(f.calls[1][2],photo)
})
test('repeated denial refreshes permission diagnostics and provides persistent attempt/reload guidance',async()=>{
 const f=fixture();let permission='denied',requests=0,queries=0
 f.options.locate=options=>getAttendanceLocation({...options,geolocation:{getCurrentPosition(ok,fail){requests++;fail({code:1})}},permissions:{query:async()=>{queries++;return {state:permission}}}})
 const controller=f.start();await controller.submit(photo);assert.match(f.state.error,/Location attempt 1:/);assert.match(f.state.error,/still reported as blocked/)
 permission='granted';await controller.submit(photo)
 assert.match(f.state.error,/Location attempt 2:/);assert.match(f.state.error,/reports Location is allowed/);assert.match(f.state.error,/device location services/);assert.match(f.state.error,/try cancelling.*reloading/)
 assert.equal(requests,2);assert.equal(queries,2);assert.equal(f.calls.length,0);assert.equal(f.state.attempt.blob,photo);assert.equal(f.state.busy,false)
})
for(const permissions of [undefined,{query:async()=>{throw Error('unsupported')}}])test(`Permissions API ${permissions?'rejects':'absent'} still permits native retry`,async()=>{
 const f=fixture();let requests=0
 f.options.locate=options=>getAttendanceLocation({...options,permissions,geolocation:{getCurrentPosition(ok,fail){if(++requests===1)fail({code:1});else ok({timestamp:Date.now(),coords:location})}}})
 const controller=f.start();await controller.submit(photo);assert.match(f.state.error,/browser or device/);await controller.submit(photo);assert.equal(requests,2);assert.ok(f.state.saved)
})
test('hanging Permissions query is bounded and does not replace native denial with timeout',async()=>{
 await assert.rejects(getAttendanceLocation({timeoutMs:10,geolocation:{getCurrentPosition(ok,fail){fail({code:1})}},permissions:{query:()=>new Promise(()=>{})}}),error=>error.message==='LOCATION_DENIED'&&error.permissionState==='unknown')
})
test('a new unavailable error replaces denial and does not retain old reload/permission advice',async()=>{
 const f=fixture();let code=1
 f.options.locate=options=>getAttendanceLocation({...options,geolocation:{getCurrentPosition(ok,fail){fail({code})}},permissions:{query:async()=>({state:'granted'})}})
 const controller=f.start();await controller.submit(photo);code=2;await controller.submit(photo)
 assert.match(f.state.error,/Location attempt 2:.*unavailable/);assert.doesNotMatch(f.state.error,/denied|reloading|reports Location/);assert.equal(f.calls.length,0)
})
test('Cancel after denial clears retained selfie/attempt without reserving or punching',async()=>{
 const f=fixture(),vm=view();f.options.locate=options=>getAttendanceLocation({...options,geolocation:{getCurrentPosition(ok,fail){fail({code:1})}}})
 vm.flow=f.state;vm.controller=f.start();vm.blob=photo;vm.preview=URL.createObjectURL(photo)
 await vm.submit();assert.equal(vm.blob,photo);await vm.cancel()
 assert.equal(vm.blob,null);assert.equal(vm.preview,'');assert.equal(f.state.attempt,null);assert.equal(f.calls.length,0)
})
test('Cancel during optional permission diagnosis ignores its late result',async()=>{
 const f=fixture(),gate=deferred();f.options.locate=options=>getAttendanceLocation({...options,geolocation:{getCurrentPosition(ok,fail){fail({code:1})}},permissions:{query:()=>gate.promise}})
 const controller=f.start(),pending=controller.submit(photo);await tick();assert.equal(await controller.cancel(),true);await pending
 gate.resolve({state:'denied'});await tick();assert.equal(f.state.error,'');assert.equal(f.state.attempt,null);assert.equal(f.calls.length,0)
})
test('retry control remains visible but disabled and aria-busy during location acquisition',()=>{
 assert.match(source,/:disabled="flow.busy \|\| flow.cancelling" :aria-busy="flow.busy \|\| flow.cancelling"/)
 assert.match(source,/Verification in progress/);assert.doesNotMatch(source,/v-if="!flow.busy && !flow.cancelling && !flow.blocked"/)
})
test('unknown finalization plus stalled summary refresh releases Retry/Cancel locks',async()=>{
 const f=fixture();f.api.finalize=async()=>{throw Error('RESULT_UNKNOWN')};f.api.result=async()=>{throw Error('offline')}
 f.options.refresh=()=>new Promise(()=>{})
 const controller=f.start();let timer
 try{await Promise.race([controller.submit(photo),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('modal lock retained by summary refresh')),500)})])}finally{clearTimeout(timer)}
 assert.equal(f.state.busy,false);assert.equal(f.state.cancelling,false);assert.equal(f.state.unresolved,true)
 const attempt=f.state.attempt;await controller.submit(photo);assert.equal(f.state.attempt,attempt);assert.equal(f.state.busy,false)
 assert.equal(await controller.cancel(),false);assert.equal(f.state.cancelling,false);assert.equal(f.state.cancelFailed,true)
 f.api.result=async()=>receipt();assert.equal(await controller.cancel(),true);assert.ok(f.state.saved)
})
test('exact trapped-modal case offers safe escape, drops media and restores committed result without a punch',async()=>{
 const f=fixture(),vm=view();f.api.finalize=async()=>{throw Error('RESULT_UNKNOWN')};f.api.result=async()=>{throw Error('offline')}
 vm.flow=f.state;vm.controller=f.start();vm.blob=photo;vm.preview=URL.createObjectURL(photo)
 const events=[];vm.$emit=(...args)=>events.push(args)
 await vm.submit();await vm.cancel();assert.equal(events.length,0);assert.equal(f.state.cancelFailed,true);assert.equal(f.state.busy,false);assert.equal(f.state.cancelling,false)
 const requestId=f.state.attempt.requestId;vm.closeForNow();assert.deepEqual(events,[['deferred']]);assert.equal(vm.blob,null);assert.equal(vm.preview,'')
 const checkpoint=getDeferredAttendanceProof('alice');assert.equal(checkpoint.attempt.requestId,requestId);assert.equal(checkpoint.action,'time_in')
 assert.equal('blob' in checkpoint.attempt,false);assert.equal('location' in checkpoint.attempt,false);assert.equal(checkpoint.attempt.draft.upload_id,draft.upload_id)
 vm.controller.stop();assert.ok(getDeferredAttendanceProof('alice'))
 const restored=attendanceProofState();restored.attempt={...checkpoint.attempt};restored.recoveryOnly=true
 f.api.result=async()=>receipt();const controller=createAttendanceProofController(restored,f.options)
 const calls=f.calls.length;await controller.submit(photo);assert.equal(f.calls.length,calls)
 assert.equal(await controller.cancel(),true);assert.ok(restored.saved);assert.equal(getDeferredAttendanceProof('alice'),null);assert.ok(!f.calls.some(c=>c[0]==='discard'))
})
test('deferred unknown prepare preserves request ID, isolates accounts and safely discards without finalizing',async()=>{
 const f=fixture();let offline=true,prepares=0
 f.api.prepare=async(id)=>{assert.equal(id,'request');prepares++;if(offline)throw Error('offline');return draft}
 const controller=f.start();await controller.submit(photo);assert.equal(await controller.cancel(),false);assert.equal(controller.defer(),true)
 const checkpoint=getDeferredAttendanceProof('alice');assert.equal(checkpoint.attempt.draft,null);assert.equal(getDeferredAttendanceProof('bob'),null)
 const state=attendanceProofState();state.attempt={...checkpoint.attempt};state.recoveryOnly=true;offline=false
 const recovery=createAttendanceProofController(state,f.options);assert.equal(await recovery.cancel(),true)
 assert.equal(prepares,3);assert.deepEqual(f.calls.map(c=>c[0]),['location','discard']);assert.equal(getDeferredAttendanceProof('alice'),null)
})
test('Close for now cannot abandon an in-flight atomic request',async()=>{
 const f=fixture(),gate=deferred();f.api.finalize=()=>gate.promise
 const controller=f.start();const running=controller.submit(photo);await tick()
 assert.equal(controller.defer(),false);assert.equal(getDeferredAttendanceProof('alice'),null)
 gate.resolve(receipt());await running;assert.ok(f.state.saved);assert.equal(controller.defer(),false)
})
test('once cancellation starts, failed cleanup cannot be retried as finalization',async()=>{
 const f=fixture();f.api.upload=async()=>{throw Error('unknown')};f.api.discard=async()=>{throw Error('offline')}
 const controller=f.start();await controller.submit(photo);assert.equal(await controller.cancel(),false)
 const attempt=f.state.attempt,calls=f.calls.length;await controller.submit(photo);assert.equal(f.calls.length,calls);assert.equal(f.state.attempt,attempt)
 f.api.discard=async()=>{};assert.equal(await controller.cancel(),true)
})
test('selfie dialog compiles, uses native modal, touch sizing and no file/gallery input',()=>{
 assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:'AttendanceVerification.vue',id:'test'}).errors,[])
 assert.doesNotMatch(source,/type=["']file|accept=|<script setup|console\./);assert.match(source,/showModal/);assert.match(source,/max-h-\[90dvh\]/);assert.match(source,/min-h-12/)
})
test('preview Retake and unmount revoke object URLs and stop camera/controller',()=>{
 const vm=view();let camera=0,controller=0;vm.camera={stop(){camera++}};vm.controller={stop(){controller++}}
 const old=URL.revokeObjectURL,revoked=[];URL.revokeObjectURL=url=>revoked.push(url)
 const oldDocument=globalThis.document,oldWindow=globalThis.window
 globalThis.document={removeEventListener(){}};globalThis.window={removeEventListener(){}}
 try{vm.preview='blob:first';vm.blob=photo;vm.startCamera=()=>{camera++};vm.retake();assert.equal(vm.blob,null);assert.deepEqual(revoked,['blob:first'])
 vm.preview='blob:second';component.beforeUnmount.call(vm);assert.deepEqual(revoked,['blob:first','blob:second']);assert.equal(controller,1);assert.equal(camera,2);assert.equal(vm.alive,false)
 }finally{URL.revokeObjectURL=old;globalThis.document=oldDocument;globalThis.window=oldWindow}
})
test('capture -> preview retains selfie; Cancel releases it and camera',async()=>{
 const vm=view();vm.ready=true;let stopped=0,closed=0;vm.camera={capture:async()=>photo,stop(){stopped++}};vm.controller={cancel:async()=>true}
 vm.$emit=name=>{if(name==='close')closed++};await vm.capture();assert.equal(vm.step,'preview');assert.equal(vm.blob,photo);assert.match(vm.preview,/^blob:/)
 await vm.cancel();assert.equal(vm.preview,'');assert.equal(vm.blob,null);assert.equal(stopped,1);assert.equal(closed,1)
})
test('background pauses camera and capture failure allows a clean retry',async()=>{
 const vm=view();let stopped=0;vm.ready=true;vm.camera={stop(){stopped++},capture:async()=>{throw Error('bad frame')}}
 await vm.capture();assert.equal(vm.ready,false);assert.equal(vm.blob,null);assert.ok(vm.error)
 const old=globalThis.document;globalThis.document={hidden:true}
 try{vm.visibilityChanged();assert.equal(stopped,1);assert.match(vm.error,/background/)}finally{globalThis.document=old}
})
test('camera startup connects and plays webcam stream; late component grant is stopped',async()=>{
 const vm=view();let played=0,stopped=0;const stream={getTracks:()=>[{stop(){stopped++}}]}
 vm.$refs.video.play=async()=>{played++};vm.camera={stop(){},start:async()=>stream};await vm.startCamera()
 assert.equal(vm.$refs.video.srcObject,stream);assert.equal(vm.ready,true);assert.equal(played,1)
 const gate=deferred();vm.camera.start=()=>gate.promise;const pending=vm.startCamera();await tick();vm.alive=false;vm.stopCamera();gate.resolve(stream);await pending
 assert.equal(stopped,1);assert.equal(vm.ready,false)
})
test('pagehide releases camera, preview and pending controller state',()=>{
 const vm=view();let stops=0,closed=0;vm.camera={stop(){stops++}};vm.controller={stop(){stops++}};vm.preview=URL.createObjectURL(photo);vm.blob=photo;vm.$emit=()=>closed++
 vm.pageHidden();assert.equal(stops,2);assert.equal(vm.preview,'');assert.equal(vm.blob,null);assert.equal(closed,1)
})
