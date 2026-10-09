"""Explicit LOCAL scratch Supabase DB only. Never reset the retained local app DB.
Run after schema-only scratch setup and migration; no HTTP or credentials involved.
Fixtures remain exclusively in the named scratch database, which the operator drops.
"""
import subprocess
import uuid

CONTAINER = 'supabase_db_ojt-dtr-s1-local'
DATABASE = 'u73e_recovery_local_review'

class Connection:
    def __init__(self):
        self.proc = subprocess.Popen(
            ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', DATABASE,
             '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def query(self, sql):
        marker = 'barrier_' + uuid.uuid4().hex
        self.proc.stdin.write(sql + '\n\\echo ' + marker + '\n')
        self.proc.stdin.flush()
        result = []
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise AssertionError('Local SQL failed: ' + self.proc.stderr.read())
            if line.strip() == marker:
                return [line.strip() for line in result if line.strip()]
            result.append(line)

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=15)
        assert self.proc.returncode == 0, self.proc.stderr.read()

A = '87400000-0000-4000-8000-000000000002'
ADMIN = '87400000-0000-4000-8000-000000000001'
REQUEST = '87400000-2000-4000-8000-000000000001'
reader, writer, metadata = Connection(), Connection(), Connection()
passed = 0

def check(value, message):
    global passed
    assert value, message
    passed += 1
    print('PASS:', message)

try:
    reader.query("""
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('attendance-proofs','attendance-proofs',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
insert into auth.users(id,email) values
 ('%s','u73e-race-admin@example.invalid'),('%s','u73e-race-student@example.invalid');
insert into public.profiles(id,full_name,email,role,status,approved_at)
values('%s','Synthetic admin','u73e-race-admin@example.invalid','admin','approved',now());
insert into public.profiles(id,full_name,email,role,status,student_id,program,required_hours,approved_at,approved_by)
values('%s','Synthetic student','u73e-race-student@example.invalid','student','approved','U73E-RACE','BS Information Technology',486,now(),'%s');
""" % (ADMIN, A, ADMIN, A, ADMIN))
    for c in (reader, writer):
        c.query("set role authenticated; select set_config('request.jwt.claim.sub','%s',false);" % A)
    # The writer confirms its prepare statement finished, but keeps its transaction
    # uncommitted. No sleeps/polling: another connection reads at this exact barrier.
    writer.query('begin;')
    upload = writer.query("select upload_id from public.attendance_proof_prepare('%s','time_in');" % REQUEST)[0]
    lookup = "select public.attendance_proof_recovery_lookup('%s')->>'lookup_status';" % REQUEST
    check(reader.query(lookup) == ['not_found'], 'uncommitted prepare invisible; no retry/reset implied')
    writer.query('commit;')
    check(reader.query(lookup) == ['found'], 'same request becomes found after prepare commits')
    identity = reader.query("select public.attendance_proof_recovery_lookup('%s')->'reservation'->>'upload_id';" % REQUEST)[0]
    check(identity == upload, 'original upload identity recovered unchanged')
    status = "select public.attendance_proof_recovery_upload_status('%s','%s')->>'object_status';" % (REQUEST, upload)
    check(reader.query(status) == ['missing'], 'object absent at initial catalog snapshot')
    metadata.query("""begin;
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'attendance-proofs',photo_path,student_uid::text,'{"mimetype":"image/jpeg","size":123}'::jsonb
from private.attendance_proof_uploads where id='%s';""" % upload)
    check(reader.query(status) == ['missing'], 'uncommitted upload metadata remains missing')
    metadata.query('commit;')
    check(reader.query(status) == ['present'], 'same upload metadata becomes present after commit')
    check(reader.query("select public.attendance_proof_recovery_upload_status('%s','%s')->>'receipt_status';" % (REQUEST, upload)) == ['missing'],
          'present object does not confirm an attendance punch')
    reader.query('reset role;')
    fingerprint = """select md5(jsonb_build_array(
      (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.profiles p),
      (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from private.attendance_proof_uploads p),
      (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.attendance_sessions p),
      (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from public.attendance_proofs p),
      (select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb) from storage.objects p)
    )::text);"""
    before = reader.query(fingerprint)
    reader.query("begin read only; set local role authenticated; select set_config('request.jwt.claim.sub','%s',true);" % A)
    check(reader.query(lookup) == ['found'], 'lookup executes in actual READ ONLY transaction')
    check(reader.query(status) == ['present'], 'upload status executes in actual READ ONLY transaction')
    reader.query('commit;')
    check(reader.query(fingerprint) == before, 'all fixture rows unchanged by read-only reconciliation')
    # Commit barriers use actual local SQL, never Storage HTTP or production.
    receipt = "select public.attendance_proof_recovery_lookup('%s')->>'receipt_status';" % REQUEST
    writer.query('begin;')
    writer.query("select public.attendance_proof_finalize('%s',0,0,1);" % upload)
    reader.query("set role authenticated; select set_config('request.jwt.claim.sub','%s',false);" % A)
    check(reader.query(receipt) == ['missing'], 'uncommitted finalize does not fabricate confirmation')
    writer.query('commit;')
    check(reader.query(receipt) == ['confirmed'], 'late finalize commit replaces missing with exact confirmation')
    reader.query('begin read only;')
    check(reader.query(receipt) == ['confirmed'], 'authorized read-only snapshot before withdrawal')
    metadata.query("update public.profiles set status='rejected',approved_at=null,approved_by=null where id='%s';" % A)
    denial_sql = "do $$ begin perform public.attendance_proof_recovery_lookup('%s'); raise exception 'UNEXPECTED_AUTHORIZATION'; exception when insufficient_privilege then if sqlerrm <> 'APPROVED_STUDENT_REQUIRED' then raise; end if; end $$; select 'denied';" % REQUEST
    check(reader.query(denial_sql) == ['denied'], 'next read-only statement denies concurrently revoked owner')
    reader.query('commit;')
    print('RESULT: %s deterministic local checks passed' % passed)
finally:
    for c in (reader, writer, metadata):
        c.close()
