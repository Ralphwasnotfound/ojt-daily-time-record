import { collection, doc, getDocFromServer, getDocsFromServer, query, where, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/firebase'
import { normalizeStudentId } from './accountPolicy'

export async function readProfile(uid) {
  const snapshot = await getDocFromServer(doc(db, 'users', uid))
  return snapshot.exists() ? snapshot.data() : null
}

export async function createStudentProfile(user, form) {
  const studentId = normalizeStudentId(form.studentId)
  const batch = writeBatch(db)
  // Reciprocal getAfter() rules require both creations together; existing IDs cannot be overwritten.
  batch.set(doc(db, 'studentIds', studentId), { uid: user.uid, createdAt: serverTimestamp() })
  batch.set(doc(db, 'users', user.uid), {
    uid: user.uid, fullName: form.fullName.trim(), studentId,
    email: user.email, role: 'student', status: 'pending',
    program: 'BS Information Technology', yearLevel: form.yearLevel,
    requiredHours: 486, createdAt: serverTimestamp(), approvedAt: null, approvedBy: null,
  })
  await batch.commit()
}

export async function listPendingStudents() {
  const result = await getDocsFromServer(query(collection(db, 'users'), where('role', '==', 'student'), where('status', '==', 'pending')))
  return result.docs.map(snapshot => snapshot.data())
}

export async function reviewStudent(uid, status, adminUid) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid review decision.')
  await runTransaction(db, async transaction => {
    const ref = doc(db, 'users', uid)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists() || snapshot.data().role !== 'student' || snapshot.data().status !== 'pending') {
      throw new Error('Registration is no longer pending.')
    }
    transaction.update(ref, status === 'approved'
      ? { status, approvedAt: serverTimestamp(), approvedBy: adminUid }
      : { status })
  })
}
