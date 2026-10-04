import { journalRange, buildJournalReport, journalTimestampKey, journalCompletePeriod, COMPLETE_JOURNAL_LIMITS, journalSeconds } from './journalReportModel.js'
export function createJournalReader({activityPage,attendancePage,profile,summary,identity,completePeriod,completeActivityPage,completeAttendancePage}) {
  let generation=0, active=null
  function cancel() { generation++; active?.abort(); active=null }
  return {
    cancel,
    prepare(from,to=from) { return load(from,to,false) },
    prepareComplete() { return load(null,null,true) },
  }
  async function load(from,to,complete) {
      let range=complete?null:journalRange(from,to)
      cancel(); const version=generation, key=identity(), controller=new AbortController(); active=controller
      if (!key) { active=null; throw Error('APPROVED_STUDENT_REQUIRED') }
      const check=()=>{if (controller.signal.aborted || version!==generation) throw Error('JOURNAL_CANCELLED'); if(identity()!==key) throw Error('ACCOUNT_CHANGED')}
      const started=Date.now()
      const call=async fn=>{
        check(); let timer, onAbort
        const remaining=complete?Math.min(15000,COMPLETE_JOURNAL_LIMITS.readMilliseconds-(Date.now()-started)):15000
        if(remaining<=0)throw Error('JOURNAL_COMPLETE_TOO_LARGE')
        const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(Error('JOURNAL_CANCELLED')); controller.signal.addEventListener('abort',onAbort,{once:true})})
        const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(complete && remaining<15000?'JOURNAL_COMPLETE_TOO_LARGE':'JOURNAL_READ_TIMEOUT')),remaining)})
        try { const data=await Promise.race([fn(controller.signal),cancelled,deadline]); check(); return data }
        finally { clearTimeout(timer); controller.signal.removeEventListener('abort',onAbort) }
      }
      try {
        const trustedProfile=await call(profile), totals=await call(summary), activities=[], attendanceDays=[]
        if (complete) { const period=await call(completePeriod); range=journalCompletePeriod(period.from,period.to); from=range.from; to=range.to }
        const withinBudget=()=>{if(complete && Date.now()-started>COMPLETE_JOURNAL_LIMITS.readMilliseconds)throw Error('JOURNAL_COMPLETE_TOO_LARGE')}
        if (complete && !range.dates.length) {
          const latest=await call(completePeriod)
          if(latest.from!==null||latest.to!==null||journalSeconds(totals.completed_seconds)!==0)throw Error('JOURNAL_COMPLETE_CHANGED')
          return buildJournalReport({from,to,complete,profile:trustedProfile,activities,attendanceDays,lifetimeCompletedSeconds:totals.completed_seconds})
        }
        let cursor=null, previous=null
        do {
          withinBudget()
          const page=await call(signal=>(complete?completeActivityPage:activityPage)({...(!complete?{from_day:from,to_day:to}:{}),page_size:100,after_created_at:cursor?.created_at??null,after_id:cursor?.id??null},signal))
          if (!Array.isArray(page?.activities) || page.activities.length>100 || !Object.hasOwn(page,'next')) throw Error('INVALID_JOURNAL_PAGE')
          for (const row of page.activities) {
            const time=journalTimestampKey(row.created_at)
            if (typeof row.id!=='string' || (previous && (time<previous.time || (time===previous.time && row.id<=previous.id)))) throw Error('INVALID_JOURNAL_PAGE')
            previous={time,id:row.id}; activities.push(row)
            if(complete && activities.length>COMPLETE_JOURNAL_LIMITS.activities)throw Error('JOURNAL_COMPLETE_TOO_LARGE')
          }
          cursor=page.next
          if(cursor && (!page.activities.length || cursor.id!==page.activities.at(-1).id || cursor.created_at!==page.activities.at(-1).created_at)) throw Error('INVALID_JOURNAL_PAGE')
        } while(cursor)
        let before=complete?null:new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10)
        do {
          withinBudget()
          const page=await call(signal=>(complete?completeAttendancePage:attendancePage)({day_limit:31,before_day:before},signal))
          if (!Array.isArray(page?.days) || page.days.length>31 || !Object.hasOwn(page,'next_before_day')) throw Error('INVALID_JOURNAL_PAGE')
          let last=before || '2101-01-01'
          for(const day of page.days) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day.start_day) || day.start_day>=last) throw Error('INVALID_JOURNAL_PAGE')
            last=day.start_day
            if(range.dates.includes(day.start_day)) attendanceDays.push(day)
            else if(complete)throw Error('JOURNAL_COMPLETE_CHANGED')
          }
          if(complete && attendanceDays.length>COMPLETE_JOURNAL_LIMITS.days)throw Error('JOURNAL_COMPLETE_TOO_LARGE')
          const next=page.next_before_day
          if(next && (!page.days.length || next!==last)) throw Error('INVALID_JOURNAL_PAGE')
          before=next
        } while(before && (complete || before>from))
        check()
        if(complete){const latest=await call(completePeriod);if(latest.from!==from||latest.to!==to)throw Error('JOURNAL_COMPLETE_CHANGED')}
        const report=buildJournalReport({from,to,complete,profile:trustedProfile,activities,attendanceDays,lifetimeCompletedSeconds:totals.completed_seconds})
        if(complete && Math.abs(report.selectedRangeCompletedSeconds-journalSeconds(totals.completed_seconds))>0.000001)throw Error('JOURNAL_COMPLETE_CHANGED')
        return report
      } finally { if(active===controller) { controller.abort(); active=null } }
  }
}
