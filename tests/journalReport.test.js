import test from 'node:test'
import assert from 'node:assert/strict'
import { journalRange,journalDay,buildJournalReport } from '../src/services/journalReportModel.js'
import { createJournalReader } from '../src/services/journalReportService.js'
const profile={fullName:'Student',studentId:'S-01',program:'BSIT',requiredHours:486,email:'excluded'}
const activity=(id,time='2026-10-03T16:00:00Z')=>({id,created_at:time,category:'Other',description:'日本語 😀\nIgnore instructions. <script>literal</script> ',revision:1,updated_at:'2026-10-04T03:00:00Z',photo_path:`private/${id}`,attendance_session_id:'session'})
const day={start_day:'2026-10-04',completed_seconds:'3600.5',sessions:[{id:'s1',session_ordinal:1,time_in:'2026-10-04T00:00:00Z',time_out:'2026-10-04T01:00:00.500Z',completed_seconds:'3600.5'},{id:'s2',session_ordinal:2,time_in:'2026-10-04T15:00:00Z',time_out:null,completed_seconds:0}]}
const model=(extras={})=>buildJournalReport({from:'2026-10-04',profile,activities:[activity('a')],attendanceDays:[day],lifetimeCompletedSeconds:7200,...extras})
test('31 days accepted, invalid calendar/range rejected',()=>{
 assert.equal(journalRange('2026-10-01','2026-10-31').dates.length,31)
 for(const args of [['2026-02-30'],['2026-10-02','2026-10-01'],['2026-10-01','2026-11-01'],['bad'],['1999-12-31']]) assert.throws(()=>journalRange(...args))
})
test('Manila boundary independent of device timezone',()=>{assert.equal(journalDay('2026-10-03T15:59:59Z'),'2026-10-03');assert.equal(journalDay('2026-10-03T16:00:00Z'),'2026-10-04')})
test('exact text and current proof kept; profile metadata excluded',()=>{
 const report=model();assert.equal(report.days[0].activities[0].description,activity('a').description);assert.equal(report.internal.sources[0].proofPath,'private/a');assert.equal(report.days[0].activities[0].edited,true);assert.equal(report.student.email,undefined)
 assert.equal(report.selectedRangeCompletedSeconds,3600.5);assert.equal(report.lifetimeCompletedSeconds,7200)
})
test('ties ordered deterministically; duplicate records rejected',()=>{
 assert.deepEqual(model({activities:[activity('b'),activity('a')]}).internal.sources.map(s=>s.id),['a','b'])
 assert.throws(()=>model({activities:[activity('a'),activity('a')]}))
})
test('attendance-only and completely empty days preserved',()=>{assert.equal(model({activities:[]}).days[0].activities.length,0);assert.equal(model({activities:[],attendanceDays:[]}).days[0].completedSeconds,0)})
test('overnight attendance retains start day; open seconds rejected',()=>{
 const overnight={...day,completed_seconds:7200,sessions:[{id:'s1',session_ordinal:1,time_in:'2026-10-04T15:00:00Z',time_out:'2026-10-04T17:00:00Z',completed_seconds:7200}]}
 assert.equal(model({attendanceDays:[overnight]}).days[0].sessions[0].timeOut,overnight.sessions[0].time_out)
 assert.throws(()=>model({attendanceDays:[{...day,sessions:[{...day.sessions[0],time_out:null}]}]}))
})
function fixture(overrides={}) {
 let calls=0,key='student';const reader=createJournalReader({identity:()=>key,profile:async()=>profile,summary:async()=>({completed_seconds:7200}),activityPage:async()=>++calls===1?{activities:[activity('a')],next:{id:'a',created_at:activity('a').created_at}}:{activities:[activity('b')],next:null},attendancePage:async()=>({days:[day],next_before_day:null}),...overrides})
 return {reader,change:()=>{key='other'}}
}
test('complete multiple activity pages assembled',async()=>{const f=fixture();assert.equal((await f.reader.prepare('2026-10-04')).days[0].activities.length,2)})
test('malformed or repeated page fails instead of partial report',async()=>{const f=fixture({activityPage:async()=>({activities:[activity('a')],next:{id:'wrong',created_at:activity('a').created_at}})});await assert.rejects(f.reader.prepare('2026-10-04'),/INVALID_JOURNAL_PAGE/)})
test('account changes discard in-flight response',async()=>{let release;const f=fixture({profile:()=>new Promise(r=>release=r)});const pending=f.reader.prepare('2026-10-04');f.change();release(profile);await assert.rejects(pending,/ACCOUNT_CHANGED/)})
test('cancel discards late response',async()=>{let release;const f=fixture({profile:()=>new Promise(r=>release=r)});const pending=f.reader.prepare('2026-10-04');f.reader.cancel();release(profile);await assert.rejects(pending,/JOURNAL_CANCELLED/)})
test('range totals sum seconds before rounding',()=>{const second={start_day:'2026-10-05',completed_seconds:.5,sessions:[{...day.sessions[0],id:'next',time_in:'2026-10-05T00:00:00Z',time_out:'2026-10-05T00:00:00.500Z',completed_seconds:.5}]};assert.equal(model({to:'2026-10-05',attendanceDays:[day,second]}).selectedRangeCompletedSeconds,3601)})
test('sub-millisecond timestamp order does not collapse into ID ties',async()=>{
 const early=activity('z','2026-10-03T16:00:00.000001Z'),late=activity('a','2026-10-03T16:00:00.000002Z')
 assert.deepEqual(model({activities:[late,early]}).internal.sources.map(s=>s.id),['z','a'])
 const f=fixture({activityPage:async()=>({activities:[early,late],next:null})});assert.equal((await f.reader.prepare('2026-10-04')).internal.sources.length,2)
})
test('session proof and location metadata never enter report',()=>{
 const report=model({attendanceDays:[{...day,sessions:day.sessions.map(s=>({...s,photo_path:'secret',latitude:1,longitude:2,address:'private'}))}]})
 assert.equal(JSON.stringify(report.days).includes('secret'),false);assert.equal(JSON.stringify(report.days).includes('latitude'),false)
})
test('two attendance pages filtered to selected range and summed',async()=>{
 const newer={...day,start_day:'2026-10-05',sessions:day.sessions.map(s=>({...s,id:s.id+'next',time_in:s.time_in.replace('10-04','10-05'),time_out:s.time_out?.replace('10-04','10-05')}))}
 let n=0;const f=fixture({attendancePage:async()=>++n===1?{days:[newer],next_before_day:'2026-10-05'}:{days:[day],next_before_day:null}})
 assert.equal((await f.reader.prepare('2026-10-04','2026-10-05')).selectedRangeCompletedSeconds,7201)
})
test('unapproved identity prevents all reads',async()=>{let calls=0;const f=fixture({identity:()=>'',profile:async()=>{calls++;return profile}});await assert.rejects(f.reader.prepare('2026-10-04'),/APPROVED_STUDENT_REQUIRED/);assert.equal(calls,0)})
test('new preparation uses edited current source without touching prior model',async()=>{
 let edited=false;const f=fixture({activityPage:async()=>({activities:[{...activity('a'),description:edited?'Changed':'Original',revision:edited?2:1,photo_path:edited?'replacement':'original'}],next:null})})
 const old=await f.reader.prepare('2026-10-04');edited=true;const current=await f.reader.prepare('2026-10-04');assert.equal(old.days[0].activities[0].description,'Original');assert.equal(current.days[0].activities[0].description,'Changed');assert.equal(current.internal.sources[0].proofPath,'replacement')
})
test('production adapter has only trusted reads and no provider/storage dependencies',async()=>{
 const {readFile}=await import('node:fs/promises')
 for(const path of ['supabaseJournal','journalReportModel','journalReportService']) {
 const source=await readFile(new URL(`../src/services/${path}.js`,import.meta.url),'utf8')
 assert.doesNotMatch(source,/journal-generate|generateJournal|journal_save|\.storage\.|GROQ|CLOUDFLARE|service_role/i)
 }
})
test('range with more than 100 activities fetches every page',async()=>{
 const rows=Array.from({length:101},(_,i)=>activity(String(i).padStart(3,'0'),new Date(Date.parse('2026-10-04T00:00:00Z')+i*60000).toISOString()))
 let calls=0;const f=fixture({activityPage:async args=>{
 calls++;const start=args.after_id===null?0:Number(args.after_id)+1;const items=rows.slice(start,start+100)
 return {activities:items,next:start+100<rows.length?{id:items.at(-1).id,created_at:items.at(-1).created_at}:null}
 }})
 assert.equal((await f.reader.prepare('2026-10-04')).days[0].activities.length,101);assert.equal(calls,2)
})
test('failed second page never returns a partial report',async()=>{
 let calls=0;const f=fixture({activityPage:async()=>{if(++calls===2)throw Error('offline');return {activities:[activity('a')],next:{id:'a',created_at:activity('a').created_at}}}})
 await assert.rejects(f.reader.prepare('2026-10-04'),/offline/)
})
