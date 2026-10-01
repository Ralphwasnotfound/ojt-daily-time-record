// Real local Auth/REST/Storage integration only. Never reads .env or hosted keys.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import * as activityData from '../src/services/supabaseActivityData.js'
import * as activityPhoto from '../src/services/activityPhoto.js'
import { activityEditorState, createActivityController } from '../src/services/studentActivityController.js'

function localConfig() {
  try {
    const config=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{
      encoding:'utf8',stdio:['ignore','pipe','pipe'],
    }))
    assert.equal(config.API_URL,'http://127.0.0.1:54321')
    assert.ok(config.ANON_KEY && config.SERVICE_ROLE_KEY)
    return config
  } catch { throw new Error('Local Supabase with Storage must run at 127.0.0.1:54321. No hosted fallback or credential output.') }
}
function sql(statement) {
  try {
    return execFileSync('docker',['exec','-i','supabase_db_ojt-dtr-s1-local','psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],{
      input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe'],
    }).trim()
  } catch { throw new Error('Local S5 fixture SQL failed; no credentials logged.') }
}
async function success(query) { const {data,error}=await query;assert.equal(error,null);return data }
async function failure(query,message) { const {error}=await query;assert.ok(error);if(message)assert.equal(error.message,message);return error }
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')

test('S5 local activity RPCs and private Storage lifecycle',async t=>{
  const config=localConfig()
  const client=key=>createClient(config.API_URL,key||config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const root=client(config.SERVICE_ROLE_KEY),anonymous=client(),fixtures=[],paths=new Set()
  async function fixture(label,role='student',status='approved',adminId=null) {
    const email=`s5-${randomUUID()}@example.invalid`,password=randomUUID()+'aA1!'
    const {user}=await success(root.auth.admin.createUser({email,password,email_confirm:true}))
    const entry={id:user.id,email,client:client()};fixtures.push(entry)
    sql(`insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
      values('${entry.id}','S5 ${label}','${email}',${role==='admin'?'null':`'S5-${entry.id.slice(0,8).toUpperCase()}'`},
      '${role}','${status}',${role==='admin'?'null':"'BS Information Technology'"},${role==='admin'?'null':'486'},
      ${status==='approved'?'clock_timestamp()':'null'},${adminId&&status==='approved'?`'${adminId}'`:'null'});`)
    await success(entry.client.auth.signInWithPassword({email,password}));return entry
  }
  const prepare=async(who,activityId=null,requestId=randomUUID())=>{
    const data=await success(who.client.rpc('activity_prepare',{request_id:requestId,existing_activity_id:activityId}))
    const draft=data[0];paths.add(draft.photo_path);return draft
  }
  const upload=(who,draft,body=png,type='image/png',upsert=false)=>who.client.storage.from('activity-proofs').upload(draft.photo_path,body,{contentType:type,upsert})
  const create=(who,draft,category='Other',description='Activity proof')=>who.client.rpc('activity_create',{upload_id:draft.upload_id,category,description})
  const edit=(who,activity,description='Edited',draft=null)=>who.client.rpc('activity_edit',{
    activity_id:activity.id,expected_revision:activity.revision,category:'Documentation',description,replacement_upload_id:draft?.upload_id||null,
  })
  const discard=async(who,draft)=>{
    const path=await success(who.client.rpc('activity_discard_proof',{upload_id:draft.upload_id}))
    assert.equal(path,draft.photo_path)
    await success(who.client.storage.from('activity-proofs').remove([path]))
  }
  try {
    const admin=await fixture('Admin','admin'),alice=await fixture('Alice','student','approved',admin.id),bob=await fixture('Bob','student','approved',admin.id)
    const pending=await fixture('Pending','student','pending'),rejected=await fixture('Rejected','student','rejected')
    let draft,activity,bobDraft
    await t.test('pending, rejected, admin and anonymous cannot invoke student mutation RPCs',async()=>{
      for(const who of [pending,rejected,admin]) {
        await failure(who.client.rpc('activity_prepare',{request_id:randomUUID()}),'APPROVED_STUDENT_REQUIRED')
        await failure(who.client.rpc('activity_create',{upload_id:randomUUID(),category:'Other',description:'text'}),'APPROVED_STUDENT_REQUIRED')
        await failure(who.client.rpc('activity_edit',{activity_id:randomUUID(),expected_revision:0,category:'Other',description:'text'}),'APPROVED_STUDENT_REQUIRED')
      }
      await failure(anonymous.rpc('activity_prepare',{request_id:randomUUID()}))
    })
    await t.test('preparation requires open attendance and retries preserve the server allocation',async()=>{
      await failure(alice.client.rpc('activity_prepare',{request_id:randomUUID()}),'NO_OPEN_ATTENDANCE')
      await success(alice.client.rpc('attendance_time_in'));await success(bob.client.rpc('attendance_time_in'))
      const request=randomUUID();draft=await prepare(alice,null,request)
      assert.deepEqual(await prepare(alice,null,request),draft)
      assert.equal(draft.photo_path,`${alice.id}/${draft.activity_id}/proof`)
      bobDraft=await prepare(bob)
    })
    await t.test('only reserved own paths can be uploaded; pending/rejected/admin uploads denied',async()=>{
      for(const who of [bob,pending,rejected,admin]) await failure(upload(who,draft))
      await failure(upload(alice,{...draft,photo_path:`${alice.id}/${randomUUID()}/proof`}))
      await failure(upload(alice,{...draft,photo_path:bobDraft.photo_path}))
    })
    await t.test('Storage rejects disallowed MIME and files larger than 5 MiB',async()=>{
      await failure(upload(alice,draft,Buffer.from('<svg/>'),'image/svg+xml'))
      await failure(upload(alice,draft,Buffer.from('text'),'text/plain'))
      await failure(upload(alice,draft,Buffer.alloc(5*1024*1024+1),'image/png'))
      await failure(create(alice,draft),'PROOF_REQUIRED')
    })
    await t.test('category and Unicode description checks occur on server; no proof cannot finalize',async()=>{
      await failure(create(alice,draft,'Fake'),'INVALID_CATEGORY')
      for(const text of [null,'','\u2003\u00a0','😀'.repeat(501)]) await failure(create(alice,draft,'Other',text),'INVALID_DESCRIPTION')
      await failure(create(alice,draft),'PROOF_REQUIRED')
      await failure(create(alice,bobDraft),'INVALID_UPLOAD')
    })
    await t.test('valid private upload finalizes once with server identity/time and 500 Unicode characters',async()=>{
      await success(upload(alice,draft))
      const result=await Promise.all([create(alice,draft,'Other','😀'.repeat(500)),create(alice,draft,'Other','😀'.repeat(500))])
      for(const item of result)assert.equal(item.error,null)
      activity=result[0].data;assert.equal(activity.id,result[1].data.id)
      assert.equal(activity.student_uid,alice.id);assert.equal(activity.attendance_session_id,draft.attendance_session_id)
      assert.equal(activity.photo_path,draft.photo_path);assert.equal(activity.updated_at,null);assert.equal(activity.revision,0)
      assert.equal(sql(`select count(*) from public.activities where id='${activity.id}'`),'1')
      await failure(create(alice,draft,'Other','different'),'ACTIVITY_ALREADY_EXISTS')
    })
    await t.test('photo is private; owner/admin can download attached proof, other identities cannot',async()=>{
      assert.ok((await success(alice.client.storage.from('activity-proofs').download(draft.photo_path))).size>0)
      assert.ok((await success(admin.client.storage.from('activity-proofs').download(draft.photo_path))).size>0)
      for(const who of [bob,pending,rejected])await failure(who.client.storage.from('activity-proofs').download(draft.photo_path))
      await failure(anonymous.storage.from('activity-proofs').download(draft.photo_path))
      const response=await fetch(`${config.API_URL}/storage/v1/object/public/activity-proofs/${draft.photo_path}`)
      assert.equal(response.ok,false)
    })
    await t.test('overwrite/upsert and deletion of attached proofs are denied',async()=>{
      await failure(upload(alice,draft,png,'image/png',true))
      await failure(alice.client.storage.from('activity-proofs').update(draft.photo_path,png,{contentType:'image/png'}))
      const removal=await alice.client.storage.from('activity-proofs').remove([draft.photo_path])
      assert.ok(removal.error||removal.data.length===0)
      await failure(alice.client.rpc('activity_discard_proof',{upload_id:draft.upload_id}),'PROOF_IN_USE')
      await success(alice.client.storage.from('activity-proofs').download(draft.photo_path))
    })
    await t.test('RLS reads isolated; admin reads; direct activity mutations and forged RPC authority blocked',async()=>{
      assert.equal((await success(alice.client.from('activities').select('*'))).length,1)
      assert.equal((await success(bob.client.from('activities').select('*'))).length,0)
      assert.equal((await success(admin.client.from('activities').select('*'))).length,1)
      await failure(alice.client.from('activities').insert(activity))
      await failure(alice.client.from('activities').update({created_at:'2000-01-01'}).eq('id',activity.id))
      await failure(alice.client.from('activities').delete().eq('id',activity.id))
      for(const forged of [{student_uid:bob.id},{attendance_session_id:bobDraft.attendance_session_id},{created_at:'2000-01-01'},{photo_path:bobDraft.photo_path}]) {
        await failure(alice.client.rpc('activity_create',{upload_id:draft.upload_id,category:'Other',description:'text',...forged}))
      }
    })
    await t.test('JPEG and WebP declared types accepted; history has bounded stable keyset pages',async()=>{
      // Storage checks declared MIME, not image magic bytes; this explicitly tests
      // the documented limitation. Real S6 images still need client decode checks.
      for(const type of ['image/jpeg','image/webp']) {
        const next=await prepare(alice);await success(upload(alice,next,png,type));await success(create(alice,next))
      }
      const first=await success(alice.client.rpc('activity_history',{page_size:2}))
      assert.equal(first.length,2)
      const second=await success(alice.client.rpc('activity_history',{page_size:2,before_created_at:first[1].created_at,before_id:first[1].id}))
      assert.equal(second.length,1);assert.ok(!first.some(x=>x.id===second[0].id))
      await failure(alice.client.rpc('activity_history',{page_size:101}),'INVALID_PAGE')
    })
    await t.test('Time Out during upload prevents finalization; discarded orphan can be removed safely',async()=>{
      const late=await prepare(alice);await success(upload(alice,late));await success(alice.client.rpc('attendance_time_out'))
      await failure(create(alice,late),'NO_OPEN_ATTENDANCE')
      await discard(alice,late)
      await failure(alice.client.storage.from('activity-proofs').download(late.photo_path))
      await failure(create(alice,late),'UPLOAD_EXPIRED_OR_DISCARDED')
      await failure(upload(alice,late))
    })
    await t.test('own metadata edit after Time Out preserves creation/owner/session and rejects stale/foreign edits',async()=>{
      const before=activity
      activity=await success(edit(alice,activity,' Updated résumé 日本語 '))
      assert.equal(activity.created_at,before.created_at);assert.equal(activity.student_uid,before.student_uid)
      assert.equal(activity.attendance_session_id,before.attendance_session_id);assert.equal(activity.revision,1)
      assert.ok(Date.parse(activity.updated_at)>=Date.parse(activity.created_at));assert.equal(activity.description,'Updated résumé 日本語')
      await failure(edit(alice,before),'ACTIVITY_CHANGED');await failure(edit(bob,activity),'ACTIVITY_NOT_FOUND')
      const results=await Promise.all([edit(alice,activity,'First'),edit(alice,activity,'Second')])
      assert.equal(results.filter(r=>!r.error).length,1);assert.equal(results.find(r=>r.error).error.message,'ACTIVITY_CHANGED')
      activity=results.find(r=>!r.error).data
    })
    await t.test('failed replacement retains original proof; cross-owner reservation cannot be attached',async()=>{
      const next=await prepare(alice,activity.id)
      await failure(edit(alice,activity,'No upload',next),'PROOF_REQUIRED')
      await failure(edit(alice,activity,'Cross owner',bobDraft),'INVALID_UPLOAD')
      const current=await success(alice.client.from('activities').select('*').eq('id',activity.id).single())
      assert.equal(current.photo_path,draft.photo_path)
      await success(alice.client.storage.from('activity-proofs').download(draft.photo_path))
      await discard(alice,next)
    })
    await t.test('replacement commits before old proof is retired; safe cleanup cannot remove the current proof',async()=>{
      const next=await prepare(alice,activity.id);await success(upload(alice,next))
      const before=activity;activity=await success(edit(alice,activity,'New proof',next))
      assert.equal(activity.created_at,before.created_at);assert.equal(activity.photo_path,next.photo_path)
      await success(alice.client.storage.from('activity-proofs').download(draft.photo_path))
      await failure(alice.client.rpc('activity_discard_proof',{upload_id:draft.upload_id}),'PROOF_IN_USE')
      await success(admin.client.storage.from('activity-proofs').download(draft.photo_path))
      await success(alice.client.storage.from('activity-proofs').remove([draft.photo_path]))
      await success(admin.client.storage.from('activity-proofs').download(draft.photo_path))
      await failure(alice.client.rpc('activity_discard_proof',{upload_id:next.upload_id}),'PROOF_IN_USE')
      await success(alice.client.storage.from('activity-proofs').download(next.photo_path))
    })
    await t.test('expired and stale replacement tickets cannot finalize; zero-byte proof rejected',async()=>{
      const expired=await prepare(alice,activity.id);await success(upload(alice,expired))
      sql(`update private.activity_proof_uploads set expires_at=clock_timestamp()-interval '1 second' where id='${expired.upload_id}';`)
      await failure(edit(alice,activity,'Expired',expired),'UPLOAD_EXPIRED_OR_DISCARDED');await discard(alice,expired)
      const stale=await prepare(alice,activity.id);await success(upload(alice,stale))
      activity=await success(edit(alice,activity,'Changed while uploading'))
      await failure(edit(alice,activity,'Stale upload',stale),'INVALID_UPLOAD');await discard(alice,stale)
      const empty=await prepare(alice,activity.id)
      const uploaded=await upload(alice,empty,Buffer.alloc(0))
      if(!uploaded.error)await failure(edit(alice,activity,'Empty',empty),'INVALID_PROOF')
      await discard(alice,empty)
    })
    await t.test('S6 service/controller integrates with real local S5 create, reconcile, history, private download and replacement',async()=>{
      async function frontendApi(who) {
        const module=new SourceTextModule(await readFile(new URL('../src/services/supabaseActivities.js',import.meta.url),'utf8'))
        await module.link(specifier=>{
          const values=specifier.includes('supabaseActivityData')?activityData:specifier.includes('activityPhoto')?activityPhoto:
            specifier==='./auth'?{authState:{}}:{supabase:who.client}
          return new SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value)})
        })
        await module.evaluate()
        const api=module.namespace.createActivityApi(who.client,()=>({id:who.id,approved:true}))
        const allocate=api.prepare
        api.prepare=async(...args)=>{const ticket=await allocate(...args);paths.add(ticket.photo_path);return ticket}
        return api
      }
      const api=await frontendApi(bob),state=activityEditorState()
      const controller=createActivityController(state,{api,allowed:()=>true,summary:async()=> (await success(bob.client.rpc('attendance_summary')))[0]})
      const create=api.create
      api.create=async(...args)=>{await create(...args);throw new Error('Simulated lost response after commit')}
      await controller.save({category:'Documentation',description:'S6 local frontend integration',file:new Blob([png],{type:'image/png'})})
      assert.ok(state.saved);assert.equal(state.attempt,null)
      const record=state.saved
      assert.equal((await api.history(3))[0].id,record.id)
      assert.equal((await api.download(record.photo_path)).size,png.length)
      await success(bob.client.rpc('attendance_time_out'))
      await controller.save({category:'Other',description:'S6 replacement after Time Out',file:new Blob([png],{type:'image/png'})},record)
      assert.equal(state.saved.revision,1);assert.equal(state.saved.created_at,record.created_at)
      assert.notEqual(state.saved.photo_path,record.photo_path)
    })
    await t.test('S7 Admin API reads bounded profiles, attendance, activities and immutable history through real REST',async()=>{
      const module=new SourceTextModule(await readFile(new URL('../src/services/supabaseAdmin.js',import.meta.url),'utf8'))
      await module.link(specifier=>{
        const values=specifier.includes('supabase.js')?{supabase:admin.client}:{authState:{}}
        return new SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value)})
      });await module.evaluate()
      const api=module.namespace.createAdminApi(admin.client,()=>admin.id)
      assert.equal((await api.dashboard()).total,4)
      const students=await api.students({page_size:1,search:'Bob',account_status:'approved'})
      assert.equal(students.length,1);assert.equal(students[0].id,bob.id)
      assert.ok(Number(students[0].completed_seconds)>=0)
      const rows=await api.activities({page_size:1,target_uid:bob.id})
      assert.equal(rows.length,1);assert.equal(rows[0].student_uid,bob.id)
      const history=await api.revisions({target_activity:rows[0].id,page_size:25})
      assert.equal(history.length,2);assert.deepEqual(history.map(row=>row.revision),[0,1])
      assert.equal(history[1].current_revision,1);assert.equal(history[0].migration_baseline,false)
      assert.notEqual(history[0].photo_path,history[1].photo_path)
      assert.ok((await api.download(history[0].photo_path)).size>0)
      assert.equal((await api.attendance({target_uid:bob.id,page_size:25})).length,1)
      const forbidden=module.namespace.createAdminApi(bob.client,()=>bob.id)
      await assert.rejects(forbidden.dashboard(),error=>error.message==='APPROVED_ADMIN_REQUIRED')
      const summaries=await api.activityStudents({page_size:25})
      assert.equal(new Set(summaries.map(row=>row.id)).size,summaries.length)
      assert.deepEqual(summaries.map(row=>row.id),[alice.id,bob.id].sort())
      for(const summary of summaries) {
        assert.equal(Number(summary.total_activities),Number(sql(`select count(*) from public.activities where student_uid='${summary.id}'`)))
        assert.equal(Number(summary.total_edits),Number(sql(`select sum(revision) from public.activities where student_uid='${summary.id}'`)))
        assert.equal(summary.matching_activities,summary.total_activities)
      }
      const first=await api.activityStudents({page_size:1})
      const second=await api.activityStudents({page_size:1,after_id:first[0].id})
      assert.equal(second[0].id,summaries[1].id)
      assert.equal((await api.activityStudents({search:'Bob'}))[0].id,bob.id)
      const filtered=await api.activityStudents({search:'Bob',category_filter:rows[0].category,attendance_status:'OUT'})
      assert.equal(filtered[0].matching_activities,1)
      assert.equal((await api.activityStudents({search:'Bob',on_day:'2000-01-01'})).length,0)
      for(const who of [alice,bob,pending,rejected]) await assert.rejects(
        module.namespace.createAdminApi(who.client,()=>who.id).activityStudents(),error=>error.message==='APPROVED_ADMIN_REQUIRED')
      await assert.rejects(module.namespace.createAdminApi(anonymous,()=>admin.id).activityStudents())
    })
    await t.test('U3 activities remain attached to their exact session across a two-session day',async()=>{
      const who=await fixture('U3','student','approved',admin.id)
      const first=await success(who.client.rpc('attendance_time_in'))
      const firstDraft=await prepare(who);await success(upload(who,firstDraft));const firstActivity=await success(create(who,firstDraft))
      assert.equal(firstActivity.attendance_session_id,first.id)
      const abandoned=await prepare(who);await success(upload(who,abandoned))
      await success(who.client.rpc('attendance_time_out'))
      await failure(who.client.rpc('activity_prepare',{request_id:randomUUID()}),'NO_OPEN_ATTENDANCE')
      const second=await success(who.client.rpc('attendance_time_in'))
      await failure(create(who,abandoned),'NO_OPEN_ATTENDANCE')
      const secondDraft=await prepare(who);await success(upload(who,secondDraft));const secondActivity=await success(create(who,secondDraft))
      assert.equal(secondActivity.attendance_session_id,second.id);assert.notEqual(second.id,first.id)
      await success(who.client.rpc('attendance_time_out'))
      await failure(who.client.rpc('activity_prepare',{request_id:randomUUID()}),'NO_OPEN_ATTENDANCE')
      const edited=await success(edit(who,firstActivity,'After both sessions'))
      assert.equal(edited.attendance_session_id,first.id);assert.equal(edited.created_at,firstActivity.created_at)
    })
  } finally {
    // Only paths allocated by this test and UUIDs it created; trusted LOCAL cleanup.
    if(paths.size)await success(root.storage.from('activity-proofs').remove([...paths]))
    if(fixtures.length) {
      const ids=fixtures.map(f=>`'${f.id}'`).join(',')
      sql(`begin; alter table public.activity_revisions disable trigger audit_immutable;
        delete from public.activity_revisions where student_uid in (${ids});
        alter table public.activity_revisions enable trigger audit_immutable;
        delete from public.activities where student_uid in (${ids});
        delete from private.activity_proof_uploads where student_uid in (${ids});
        delete from public.attendance_sessions where student_uid in (${ids});
        delete from public.profiles where id in (${ids}) and role='student';
        delete from public.profiles where id in (${ids}); commit;`)
      for(const f of fixtures) { await f.client.auth.signOut();await success(root.auth.admin.deleteUser(f.id)) }
    }
  }
})
