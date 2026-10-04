import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as icons from 'lucide-vue-next'
import * as page from '../src/services/journalPageController.js'
import * as dates from '../src/services/supabaseActivityData.js'
import * as attendance from '../src/services/supabaseAttendancePresentation.js'
import * as model from '../src/services/journalReportModel.js'
const filename='src/views/student/JournalView.vue'
const source=await readFile(filename,'utf8')
const {descriptor}=parse(source)
const compiled=compileTemplate({source:descriptor.template.content,filename,id:'journal-test'})
assert.deepEqual(compiled.errors,[])
const root=new SourceTextModule(descriptor.script.content+'\n'+compiled.code)
let readerCreations=0
function synthetic(values){return new SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v)})}
await root.link(specifier=>{
 if(specifier.endsWith('JournalActivityProof.vue'))return synthetic({default:{props:['path'],setup(props){return ()=>vue.h('p',props.path?'View proof photo':'No proof photo available.')}}})
 if(specifier.endsWith('journalExportController.js'))return synthetic({journalExportState:()=>({busy:false,progress:'',error:'',notice:''})})
 if(specifier.endsWith('journalExport.js'))return synthetic({createStudentJournalExporter:()=>({run(){},cancel(){}})})
 if(specifier==='vue')return synthetic(vue)
 if(specifier==='lucide-vue-next')return synthetic(icons)
 if(specifier.endsWith('supabaseJournal.js'))return synthetic({createStudentJournalReader:()=>{readerCreations++;return {prepare:async()=>report(),cancel(){}}}})
 if(specifier.endsWith('journalPageController.js'))return synthetic(page)
 if(specifier.endsWith('supabaseActivities.js'))return synthetic({activityAccountKey:()=> 'student',approvedActivityStudent:()=>true})
 if(specifier.endsWith('supabaseActivityData.js'))return synthetic(dates)
 if(specifier.endsWith('supabaseAttendancePresentation.js'))return synthetic(attendance)
 if(specifier.endsWith('journalReportModel.js'))return synthetic(model)
 throw Error(specifier)
})
await root.evaluate();const component=root.namespace.default;component.render=root.namespace.render
const activity={sourceIndex:0,createdAt:'2026-10-04T00:15:00Z',category:'IT Support',description:'日本語 😀\n<script>alert("x")</script> Exact CASE.',edited:true}
function report(){return {student:{fullName:'Test Student',studentId:'TEST-1',program:'BSIT',requiredHours:486},range:{from:'2026-10-04',to:'2026-10-04'},days:[{date:'2026-10-04',activities:[activity],sessions:[{ordinal:1,timeIn:'2026-10-04T00:00:00Z',timeOut:'2026-10-04T01:00:00Z'},{ordinal:2,timeIn:'2026-10-04T15:00:00Z',timeOut:null}],completedSeconds:3600}],selectedRangeCompletedSeconds:3600,lifetimeCompletedSeconds:7200,internal:{sources:[{id:'PRIVATE-UUID',revision:9,proofPath:'PRIVATE-PATH',attendanceSessionId:'PRIVATE-SESSION'}]}}}
async function render(overrides={}){return renderToString(vue.createSSRApp({...component,data(){return {journal:{...page.journalPageState('2026-10-03T16:00:00Z'),...overrides},controller:null,exportState:{busy:false,progress:'',error:'',notice:''},includePhotos:true,emptyActivityMessage:model.JOURNAL_EMPTY_ACTIVITY_MESSAGE}}}))}
test('default Manila day at UTC boundary',()=>assert.equal(page.journalPageState('2026-10-03T16:00:00Z').from,'2026-10-04'))
test('Daily ignores hidden end selection',()=>assert.equal(page.journalSelectionError({...page.journalPageState(),from:'2026-10-04',to:'bad'}),''))
test('range validates 31 days, missing/reversed/oversized/invalid dates',()=>{
 const s={mode:'range',from:'2026-10-01',to:'2026-10-31'};assert.equal(page.journalSelectionError(s),'')
 assert.match(page.journalSelectionError({...s,to:''}),/Choose/);assert.match(page.journalSelectionError({...s,to:'2026-09-30'}),/on or after/)
 assert.match(page.journalSelectionError({...s,to:'2026-11-01'}),/31/);assert.match(page.journalSelectionError({...s,from:'2026-02-30'}),/valid/)
})
test('Daily and range pass correct service selection',async()=>{
 const s=page.journalPageState();s.from='2026-10-01';s.to='2026-10-31';let args
 const c=page.createJournalPageController(s,{cancel(){},async prepare(...values){args=values;return report()}},()=>true)
 await c.load();assert.deepEqual(args,['2026-10-01','2026-10-01']);s.mode='range';await c.load();assert.deepEqual(args,['2026-10-01','2026-10-31'])
})
test('invalid range does not call service',async()=>{const s={...page.journalPageState(),mode:'range',from:'2026-10-01',to:'2026-11-01'};let calls=0;await page.createJournalPageController(s,{cancel(){},prepare(){calls++}},()=>true).load();assert.equal(calls,0);assert.match(s.error,/31/)})
test('plain escaped Unicode text and line breaks; no internal identifiers',async()=>{
 const html=await render({report:report()});assert.ok(html.includes('日本語 😀\n&lt;script&gt;'));assert.ok(html.includes('Exact CASE.'));assert.ok(html.includes('whitespace-pre-wrap'))
 assert.doesNotMatch(html,/PRIVATE-PATH|PRIVATE-UUID|PRIVATE-SESSION|<script>/)
})
test('official time, category and edited indicator',async()=>{const html=await render({report:report()});assert.match(html,/8:15 AM/);assert.match(html,/IT Support/);assert.match(html,/Edited/)})
test('Session 1/2 and authoritative totals with open Time Out',async()=>{const html=await render({report:report()});assert.match(html,/Session 1/);assert.match(html,/Session 2/);assert.match(html,/Ongoing/);assert.match(html,/1h 00m/);assert.match(html,/2h 00m/)})
test('overnight Time Out displays next date',async()=>{const r=report();r.days[0].sessions[1].timeOut='2026-10-04T17:00:00Z';const html=await render({report:r});assert.match(html,/October 5, 2026/);assert.match(html,/1:00 AM/)})
test('attendance-only day retains sessions without inventing activity',async()=>{const r=report();r.days[0].activities=[];const html=await render({report:r});assert.match(html,/No activity recorded for this day/);assert.match(html,/Session 1/);assert.doesNotMatch(html,/Exact CASE/)})
test('empty Daily is clean status',async()=>{const r=report();r.days[0].activities=[];r.days[0].sessions=[];assert.match(await render({report:r}),/No activity recorded for this day\./)})
test('range shows separate selected and lifetime totals; empty days compact',async()=>{
 const r=report();r.range.to='2026-10-06';r.days.push({date:'2026-10-05',activities:[],sessions:[]},{date:'2026-10-06',activities:[],sessions:[]})
 const html=await render({mode:'range',report:r});assert.match(html,/Selected Range Completed Hours/);assert.match(html,/Total Completed OJT Hours · All dates/);assert.equal((html.match(/No activity recorded for this day\./g)||[]).length,2);assert.equal((html.match(/<article /g)||[]).length,3)
})
test('days and activities rendered in report chronology',async()=>{const r=report();r.range.to='2026-10-05';r.days[0].activities.push({...activity,sourceIndex:1,description:'Second task'});r.days.push({date:'2026-10-05',activities:[{...activity,description:'Later day'}],sessions:[],completedSeconds:0});const html=await render({report:r});assert.ok(html.indexOf('Exact CASE.')<html.indexOf('Second task'));assert.ok(html.indexOf('Second task')<html.indexOf('Later day'))})
test('loading and recoverable error accessible',async()=>{assert.match(await render({loading:true}),/role="status"/);assert.match(await render({error:'Could not load'}),/role="alert"/);assert.match(await render({loading:true}),/disabled/)})
test('proof viewer stays on-demand at initial render; AI button disabled without handler',async()=>{
 const html=await render({report:report()});assert.match(html,/View proof photo/);assert.doesNotMatch(html,/<img|blob:|signedUrl/)
 assert.match(html,/<button[^>]*disabled[^>]*>Generate AI Journal · Coming Soon<\/button>/);assert.doesNotMatch(source,/v-html|\.storage|\.functions|fetch\(|createObjectURL|PrivateActivityProof|@click[^\n]*Generate AI/)
 assert.equal(readerCreations,0) // SSR preview itself starts no requests.
})
test('new selection clears pending response',async()=>{let resolve;const s=page.journalPageState();const c=page.createJournalPageController(s,{cancel(){},prepare:()=>new Promise(r=>resolve=r)},()=>true);const pending=c.load();assert.equal(s.loading,true);c.clear();resolve(report());await pending;assert.equal(s.report,null);assert.equal(s.loading,false)})
test('newer load wins over older completion',async()=>{const gates=[];const s=page.journalPageState();const c=page.createJournalPageController(s,{cancel(){},prepare:()=>new Promise(r=>gates.push(r))},()=>true);const old=c.load();const current=c.load();const newer=report();newer.student.fullName='New';gates[1](newer);await current;gates[0](report());await old;assert.equal(s.report.student.fullName,'New')})
test('network errors sanitized; access revocation suppresses late result',async()=>{const s=page.journalPageState();await page.createJournalPageController(s,{cancel(){},async prepare(){throw Error('RAW SECRET')}},()=>true).load();assert.match(s.error,/connection/);assert.doesNotMatch(s.error,/RAW/);let allowed=true,resolve;const c=page.createJournalPageController(s,{cancel(){},prepare:()=>new Promise(r=>resolve=r)},()=>allowed);const pending=c.load();allowed=false;resolve(report());await pending;assert.equal(s.report,null)})
test('route and navigation reuse guarded Student layout and icon registry',async()=>{
 const router=await readFile('src/router/index.js','utf8'),layout=await readFile('src/layouts/StudentLayout.vue','utf8'),workspace=await readFile('src/components/WorkspaceLayout.vue','utf8')
 assert.match(router,/path: 'journal', name: 'student-journal', component: JournalView/);assert.match(router,/requiresAuth: true, role: 'student'/)
 assert.match(layout,/"to": "\/student\/journal"/);assert.match(layout,/"label": "Journal"/);assert.match(layout,/"icon": "BookOpen"/);assert.match(workspace,/BookOpen/)
})
test('Activity guidance and confidentiality preserve 500-character validation',async()=>{const editor=await readFile('src/components/ActivityEditor.vue','utf8');assert.match(editor,/exactly as recorded in your OJT Journal/);assert.match(editor,/Do not include passwords, credentials, personal information, or confidential company information/);assert.match(editor,/Example: Installed Windows 10/);assert.match(editor,/500 characters/);assert.match(editor,/-privacy/);assert.doesNotMatch(source,/pdfmake|html2canvas|generateJournal|journal-generate|Groq|Cloudflare/i)})

test('Daily and range Activity scopes show PDF Print and default photo option',async()=>{for(const mode of ['daily','range']){const html=await render({mode,report:report()});assert.match(html,/Download PDF/);assert.match(html,/Download Word/);assert.match(html,/>Print</);assert.match(html,/Include Activity Photos/);assert.match(html,/checked/)}})
test('zero-Activity Daily and ranges hide all export controls but retain dates and attendance',async()=>{for(const mode of ['daily','range'])for(const attendance of [true,false]){const r=report();r.days[0].activities=[];if(!attendance)r.days[0].sessions=[];if(mode==='range'){r.range.to='2026-10-05';r.days.push({date:'2026-10-05',activities:[],sessions:[],completedSeconds:0})}const html=await render({mode,report:r});assert.doesNotMatch(html,/Download PDF|Download Word|>Print<|Include Activity Photos|Journal export/);assert.match(html,/No activity recorded for this day\./);if(attendance)assert.match(html,/Session 1/);assert.match(html,/October 4, 2026/)}})

test('Complete scope hides dates, displays period/hours/count and proof remains on demand',async()=>{const r=report();r.range={from:'2026-08-03',to:'2026-10-05',scope:'complete'};r.selectedRangeCompletedSeconds=501*3600+16*60;r.lifetimeCompletedSeconds=r.selectedRangeCompletedSeconds;r.days.push({date:'2026-10-05',activities:[],sessions:[],completedSeconds:0});const html=await render({mode:'complete',report:r});assert.match(html,/Complete OJT/);assert.doesNotMatch(html,/type="date"/);assert.match(html,/Complete OJT Period/);assert.match(html,/August 3, 2026/);assert.match(html,/Completed OJT Hours/);assert.match(html,/501h 16m/);assert.match(html,/486 hours/);assert.match(html,/Total Activities recorded: 1/);assert.match(html,/No activity recorded for this day\./);assert.match(html,/View proof photo/);assert.doesNotMatch(html,/<img|blob:|PRIVATE-PATH/);assert.match(html,/Download PDF/);assert.match(html,/Download Word/);assert.match(html,/>Print</)})
test('Complete no records displays no invented period and no export controls',async()=>{const r=report();r.range={from:null,to:null,scope:'complete'};r.days=[];r.selectedRangeCompletedSeconds=0;r.lifetimeCompletedSeconds=0;const html=await render({mode:'complete',report:r});assert.match(html,/No recorded OJT period yet/);assert.match(html,/Total Activities recorded: 0/);assert.doesNotMatch(html,/Download PDF|Download Word|>Print</)})
