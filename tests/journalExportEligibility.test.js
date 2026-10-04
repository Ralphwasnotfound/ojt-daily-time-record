import test from 'node:test'
import assert from 'node:assert/strict'
import { canExportJournal, JOURNAL_EMPTY_ACTIVITY_MESSAGE } from '../src/services/journalReportModel.js'
import { prepareJournalExport, buildJournalPdf } from '../src/services/journalExportModel.js'
import { generateJournalPdf } from '../src/services/journalPdf.js'
import { printJournalReport } from '../src/services/journalPrint.js'
import { createJournalExportController, journalExportState } from '../src/services/journalExportController.js'
const empty = attendance => ({days:[{activities:[],sessions:attendance?[{ordinal:1}]:[]}]})
test('eligibility derives only from Activities, independent of hours, photos and attendance',()=>{
 assert.equal(canExportJournal(null),false)
 for(const attendance of [true,false])assert.equal(canExportJournal(empty(attendance)),false)
 assert.equal(canExportJournal({days:[{activities:[{description:'exact'}]}]}),true)
 assert.equal(canExportJournal({days:[{activities:[]},{activities:[{}]},{activities:[]}],student:{requiredHours:486}}),true)
 assert.equal(JOURNAL_EMPTY_ACTIVITY_MESSAGE,'No activity recorded for this day.')
})
for(const kind of ['pdf','print','docx'])test(`${kind} controller refuses zero Activities before all preparation`,async()=>{
 for(const attendance of [true,false]){
  const state=journalExportState(),r=empty(attendance);let calls=0
  const forbidden=()=>{calls++;throw Error('should not run')}
  const controller=createJournalExportController(state,{currentReport:()=>r,identity:()=> 'student',readProof:forbidden,convertImage:forbidden,validateReport:forbidden,pdf:forbidden,docx:forbidden,print:forbidden,save:forbidden})
  await controller.run(kind,true);assert.equal(calls,0);assert.equal(state.busy,false);assert.match(state.error,/at least one activity/)
 }
})
test('direct preparation PDF and Print entry points reject before resources',async()=>{
 const r=empty(true)
 await assert.rejects(prepareJournalExport(r,{}),/JOURNAL_NO_ACTIVITIES/)
 assert.throws(()=>buildJournalPdf(r),/JOURNAL_NO_ACTIVITIES/)
 await assert.rejects(generateJournalPdf(r),/JOURNAL_NO_ACTIVITIES/)
 await assert.rejects(printJournalReport(r,null,{createElement(){throw Error('should not run')}}),/JOURNAL_NO_ACTIVITIES/)
})
