const zone = 'Asia/Manila'
function manilaDay(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

// Read-only U4.4 presentation. RLS remains the authority; the local identity
// check also prevents a response from being displayed after an account change.
export function createAttendanceProofReader(client, identity, role = 'admin') {
  function owner(studentUid) {
    if (role === 'student' && (!identity() || studentUid !== identity())) throw new Error('OWN_PROOF_REQUIRED')
  }
  async function read(make, signal) {
    const key = identity()
    if (!key) throw new Error(role === 'admin' ? 'APPROVED_ADMIN_REQUIRED' : 'APPROVED_STUDENT_REQUIRED')
    if (signal?.aborted) throw new Error('CANCELLED')
    const { data, error } = await make()
    if (signal?.aborted || identity() !== key) throw new Error('ACCOUNT_CHANGED')
    if (error) throw error
    return data
  }
  return {
    async available(studentUid, sessionIds, signal) {
      owner(studentUid)
      if (!sessionIds.length) return []
      // At most 31 start-days, two sessions each. No locations/paths/images here.
      if (sessionIds.length > 62) throw new Error('INVALID_PAGE')
      return read(() => client.from('attendance_proofs').select('attendance_session_id,action_type')
        .eq('student_uid', studentUid).in('attendance_session_id', sessionIds).limit(124).abortSignal(signal), signal)
    },
    async evidence(studentUid, sessionId, action, signal) {
      owner(studentUid)
      if (!['time_in', 'time_out'].includes(action)) throw new Error('INVALID_EVIDENCE')
      const select = (table, fields) => client.from(table).select(fields).abortSignal(signal)
      const proof = await read(() => select('attendance_proofs', 'student_uid,attendance_session_id,action_type,official_punch_at,latitude,longitude,accuracy,photo_path')
        .eq('student_uid', studentUid).eq('attendance_session_id', sessionId).eq('action_type', action).maybeSingle(), signal)
      if (!proof) return null // Historical attendance may legitimately have no proof.
      const [students, session] = await Promise.all([
        role === 'admin'
          ? read(() => client.rpc('admin_students', { target_uid: studentUid, page_size: 1 }).retry(false).abortSignal(signal), signal)
          : read(() => select('profiles', 'id,full_name,student_id').eq('id', studentUid).single(), signal).then(row => [row]),
        read(() => select('attendance_sessions', 'id,student_uid,time_in,time_out').eq('id', sessionId).eq('student_uid', studentUid).single(), signal),
      ])
      const student = students?.[0]
      if (!student || student.id !== studentUid || !student.full_name || !student.student_id ||
          session?.id !== sessionId || session.student_uid !== studentUid || proof.student_uid !== studentUid ||
          proof.attendance_session_id !== sessionId || proof.action_type !== action ||
          !Number.isFinite(Date.parse(proof.official_punch_at)) || !session[action] ||
          Date.parse(proof.official_punch_at) !== Date.parse(session[action]) ||
          !Number.isFinite(proof.latitude) || Math.abs(proof.latitude) > 90 ||
          !Number.isFinite(proof.longitude) || Math.abs(proof.longitude) > 180 ||
          !Number.isFinite(proof.accuracy) || proof.accuracy < 0 || !proof.photo_path?.startsWith(`${studentUid}/${sessionId}/`)) {
        throw new Error('INVALID_EVIDENCE')
      }
      const day = manilaDay(session.time_in)
      const history = await read(() => client.rpc(role === 'admin' ? 'admin_attendance_days' : 'attendance_days', {
        ...(role === 'admin' ? { target_uid: studentUid } : {}), day_limit: 1, on_day: day,
      }).retry(false).abortSignal(signal), signal)
      // U3 derives this ordinal by (time_in, id) within the Manila Time In day.
      const ordered = history?.days?.find(row => row.start_day === day)?.sessions
      const match = ordered?.find(row => row.id === sessionId)
      if (!match || ![1, 2].includes(match.session_ordinal) || match.time_in !== session.time_in || match.time_out !== session.time_out) throw new Error('INVALID_EVIDENCE')
      return { student, proof, ordinal: match.session_ordinal }
    },
    download(path, signal) {
      return read(() => client.storage.from('attendance-proofs').download(path, {}, { signal, cache: 'no-store' }), signal)
    },
  }
}

export function formatProof(evidence) {
  const { student, proof, ordinal } = evidence
  const date = new Date(proof.official_punch_at)
  return {
    fullName: student.full_name, studentId: student.student_id,
    action: proof.action_type === 'time_in' ? 'TIME IN' : 'TIME OUT', session: `Session ${ordinal}`,
    date: new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'long', day: 'numeric', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date),
    location: `${proof.latitude.toFixed(5)}, ${proof.longitude.toFixed(5)}`, accuracy: `±${Math.round(proof.accuracy)} m`,
  }
}
