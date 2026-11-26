import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createJobsRuntime, seedIdentity, isolatedOptions } from '../scripts/jobs-runtime.mjs';
import { Miniflare } from 'miniflare';
import { PostingQuota, istDate, vacancyFingerprint, type PostingAction } from '../src/jobs/quota';
import { DAY, type JobsDatabase } from '../src/jobs/contracts';
import { requireAssigned, requireCompany, requirePrivacyOperator } from '../src/jobs/permissions';
import { JobsPrivacy, projectProfile, projectApplication, retentionDefaults } from '../src/jobs/privacy';
import { handleJobs } from '../src/jobs/api';

describe('EP-04 real local D1 foundation (synthetic only)', () => {
  let runtime: Awaited<ReturnType<typeof createJobsRuntime>>;
  let db: JobsDatabase; let now: number; let quota: PostingQuota;
  const actor = { subject: 'recruiter' }; const owner = { subject: 'candidate' }; const admin = { subject: 'admin' };
  const epoch = Date.parse('2026-11-27T12:00:00Z');
  const vacancy = (name: string) => ({ position: name, location: 'Chennai', department: 'Engineering', arrangement: 'Full time' });
  const action = (id: string, operation: PostingAction['operation'] = 'CREATE', revision = 0): PostingAction => ({ company: 'company_a', listing: id, key: `${operation}_${id}_${revision}`, operation, revision, vacancy: vacancy(id) });
  const sql = (query: string, ...values: unknown[]) => db.prepare(query).bind(...values).run();
  const count = async (table: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  beforeAll(async () => { runtime = await createJobsRuntime({ enabled: true }); db = runtime.jobs; await seedIdentity(runtime.accounts); }, 60000);
  afterAll(async () => { await runtime?.mf.dispose(); });
  beforeEach(async () => {
    for (const table of ['retention_exceptions', 'retained_records', 'deletion_ledger', 'privacy_audit', 'assignments', 'posting_actions', 'listings', 'platform_roles', 'memberships', 'jobs_users']) await sql(`DELETE FROM ${table}`);
    await sql('UPDATE restore_gate SET ready=1');
    now = epoch; quota = new PostingQuota(db, () => now);
    for (const subject of ['recruiter', 'candidate', 'admin', 'other', 'synthetic_candidate']) await sql('INSERT INTO jobs_users(subject,eligible,attested_at) VALUES(?,1,?)', subject, now);
    await sql("INSERT INTO memberships VALUES('company_a','recruiter','RECRUITER',NULL),('company_a','admin','COMPANY_ADMIN',NULL),('company_b','other','RECRUITER',NULL)");
    await sql("INSERT INTO platform_roles VALUES('admin','PRIVACY_OPERATOR',NULL)");
  });
  it('executes D1 atomic batch rollback and rejects conventional BEGIN', async () => {
    await expect(db.batch([db.prepare("INSERT INTO listings VALUES('x','x','x','ACTIVE',1,1)"), db.prepare("INSERT INTO listings VALUES('x','x','x','ACTIVE',1,1)")])).rejects.toThrow();
    expect(await count('listings')).toBe(0);
    await expect(db.prepare('BEGIN TRANSACTION').run()).rejects.toThrow();
  });
  it('admits exactly ten of 25 concurrent company requests across recruiters', async () => {
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => quota.apply(i % 2 ? admin : actor, action(`job${i}`))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(10);
    expect(await count('posting_actions')).toBe(10); expect(await count('listings')).toBe(10);
  });
  it('returns one stable result for concurrent retries without double spending', async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => quota.apply(actor, action('same'))));
    expect(new Set(results.map(r => JSON.stringify(r))).size).toBe(1);
    expect(await count('posting_actions')).toBe(1);
    await expect(quota.apply(actor, { ...action('same'), vacancy: vacancy('changed') })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
  it('resets at fixed IST midnight using the server clock', async () => {
    now = Date.parse('2026-11-27T18:29:59.999Z');
    expect(istDate(now)).toBe('2026-11-27');
    for (let i = 0; i < 10; i++) await quota.apply(actor, action(`before${i}`));
    await expect(quota.apply(actor, action('eleventh'))).rejects.toMatchObject({ code: 'daily_limit' });
    now++; expect(istDate(now)).toBe('2026-11-28');
    await quota.apply(actor, action('after'));
    const days = await db.prepare('SELECT DISTINCT quota_day FROM posting_actions ORDER BY quota_day').all<{ quota_day: string }>();
    expect(days.results.map(r => r.quota_day)).toEqual(['2026-11-27', '2026-11-28']);
  });
  it('allows slot 30 but rejects slot 31 concurrently and frees closed slots', async () => {
    for (let day = 0; day < 3; day++) { now = epoch + day * DAY; for (let i = 0; i < (day === 2 ? 9 : 10); i++) await quota.apply(actor, action(`j${day}_${i}`)); }
    now += DAY;
    const outcomes = await Promise.allSettled([quota.apply(actor, action('slot30')), quota.apply(actor, action('slot31'))]);
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await quota.apply(actor, action('j0_0', 'CLOSE', 1));
    await quota.apply(actor, action('replacement'));
    expect(await count('listings')).toBe(31);
  });
  it('counts active by expiry without requiring cleanup', async () => {
    for (let day = 0; day < 3; day++) { now = epoch + day * DAY; for (let i = 0; i < 10; i++) await quota.apply(actor, action(`j${day}_${i}`)); }
    now = epoch + 30 * DAY; await quota.apply(actor, action('fresh')); expect(await count('listings')).toBe(31);
  });
  it('normalizes exact duplicate vacancies, rolls back failures and preserves quota on archive', async () => {
    await quota.apply(actor, action('one'));
    await expect(quota.apply(actor, { ...action('two'), vacancy: { ...vacancy(' ONE '), location: ' CHENNAI ' } })).rejects.toMatchObject({ code: 'duplicate' });
    expect(await count('posting_actions')).toBe(1);
    await quota.apply(actor, action('one', 'ARCHIVE', 1));
    await quota.apply(actor, { ...action('two'), vacancy: vacancy('one') });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM posting_actions WHERE operation='CREATE'").first<{ n: number }>())?.n).toBe(2);
  });
  it('enforces final seven days and adds active renewals to prior expiry', async () => {
    const created = await quota.apply(actor, action('renew'));
    now = epoch + 23 * DAY - 1;
    await expect(quota.apply(actor, action('renew', 'RENEW', 1))).rejects.toMatchObject({ code: 'conflict' });
    now++; const renewed = await quota.apply(actor, action('renew', 'RENEW', 1));
    expect(renewed.expiresAt).toBe(created.expiresAt + 30 * DAY); expect(await count('posting_actions')).toBe(2);
  });
  it('renews expired and reopens closed listings from action time', async () => {
    await quota.apply(actor, action('expired')); now += 31 * DAY;
    expect((await quota.apply(actor, action('expired', 'RENEW', 1))).expiresAt).toBe(now + 30 * DAY);
    await quota.apply(actor, action('expired', 'CLOSE', 2)); now += DAY;
    expect((await quota.apply(actor, action('expired', 'REOPEN', 3))).expiresAt).toBe(now + 30 * DAY);
  });
  it('permits only one concurrent lifecycle transition at the expected revision', async () => {
    await quota.apply(actor, action('race')); now += 24 * DAY;
    const results = await Promise.allSettled(['a', 'b', 'c'].map(key => quota.apply(actor, { ...action('race', 'RENEW', 1), key })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(await count('posting_actions')).toBe(2);
  });
  it('edits without spending posting allowances and rejects stale revisions', async () => {
    await quota.apply(actor, action('edit'));
    await quota.apply(actor, { ...action('edit', 'EDIT', 1), vacancy: vacancy('updated') });
    await expect(quota.apply(actor, { ...action('edit', 'EDIT', 1), key: 'stale' })).rejects.toMatchObject({ code: 'conflict' });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM posting_actions WHERE operation IN ('CREATE','RENEW','REOPEN')").first<{ n: number }>())?.n).toBe(1);
  });
  it('denies foreign companies, revoked membership and Jobs closure, including retries', async () => {
    await expect(quota.apply({ subject: 'other' }, action('foreign'))).rejects.toMatchObject({ status: 403 });
    await quota.apply(actor, action('existing'));
    await sql("UPDATE memberships SET revoked_at=? WHERE subject='recruiter'", now);
    await expect(quota.apply(actor, action('existing'))).rejects.toMatchObject({ status: 403 });
    await new JobsPrivacy(db, () => now).close(admin);
    await expect(quota.apply(admin, action('closed'))).rejects.toMatchObject({ status: 403 });
  });
  it('requires explicit assignment; company and platform admins have no applicant bypass', async () => {
    await quota.apply(actor, action('assigned'));
    await expect(requireAssigned(db, admin, 'company_a', 'assigned')).rejects.toMatchObject({ status: 403 });
    await expect(requireCompany(db, actor, 'company_a', true)).rejects.toMatchObject({ status: 403 });
    await expect(requirePrivacyOperator(db, actor)).rejects.toMatchObject({ status: 403 });
    await sql("INSERT INTO assignments VALUES('company_a','assigned','recruiter')");
    await expect(requireAssigned(db, actor, 'company_a', 'assigned')).resolves.toBeUndefined();
    await expect(requireAssigned(db, { subject: 'other' }, 'company_a', 'assigned')).rejects.toMatchObject({ status: 403 });
  });
  it('defaults private and separates public projection, sensitive fields and indexing', async () => {
    const fields = { name: 'Synthetic', email: 'private@example.invalid', salary: 100, currentEmployer: 'Private Co', skills: ['TS'] };
    const selected = ['name', 'skills', 'email', 'salary'];
    expect(await projectProfile(db, owner.subject, actor, fields, selected)).toEqual({});
    await sql("UPDATE jobs_users SET visibility='PUBLIC' WHERE subject='candidate'");
    expect(await projectProfile(db, owner.subject, null, fields, selected)).toEqual({ name: 'Synthetic', skills: ['TS'] });
    expect(await projectProfile(db, owner.subject, null, fields, selected, true)).toEqual({});
    await sql("UPDATE jobs_users SET indexing=1 WHERE subject='candidate'");
    expect(await projectProfile(db, owner.subject, null, fields, selected, true)).toEqual({ name: 'Synthetic', skills: ['TS'] });
    await sql("UPDATE jobs_users SET visibility='PRIVATE' WHERE subject='candidate'");
    expect(await projectProfile(db, owner.subject, null, fields, selected, true)).toEqual({});
  });
  it('discloses submitted fields only to candidate or assigned team, excluding unrelated private data', async () => {
    await quota.apply(actor, action('submitted'));
    await sql("INSERT INTO assignments VALUES('company_a','submitted','recruiter')");
    const snapshot = { candidate: 'candidate', company: 'company_a', listing: 'submitted', restricted: false, fields: { email: 'synthetic@example.invalid', salary: 10, savedJobs: ['private'], interviews: ['private'] } };
    expect(await projectApplication(db, actor, snapshot)).toEqual({ email: 'synthetic@example.invalid', salary: 10 });
    await expect(projectApplication(db, admin, snapshot)).rejects.toMatchObject({ status: 403 });
    await expect(projectApplication(db, { subject: 'other' }, snapshot)).rejects.toMatchObject({ status: 403 });
    await expect(projectApplication(db, owner, { ...snapshot, restricted: true })).rejects.toMatchObject({ status: 403 });
    await sql("UPDATE memberships SET revoked_at=1 WHERE subject='recruiter'");
    await expect(projectApplication(db, actor, snapshot)).rejects.toMatchObject({ status: 403 });
  });
  it('atomically checks current membership even when a caller bypasses the service precheck', async () => {
    await sql("UPDATE memberships SET revoked_at=1 WHERE subject='recruiter'");
    await expect(sql("INSERT INTO posting_actions(company,actor,request_key,payload,listing,operation,fingerprint,expected_revision,at) VALUES('company_a','recruiter','bypass','x','bypass','CREATE','x',0,?)", now)).rejects.toThrow('jobs_forbidden');
    expect(await count('posting_actions')).toBe(0); expect(await count('listings')).toBe(0);
  });
  it('blocks Worker egress at the runtime and has no production or staging bindings', async () => {
    const isolated = new Miniflare(isolatedOptions("export default { fetch() { return fetch('https://production.example.invalid/'); } }"));
    try {
      const response = await isolated.dispatchFetch('http://localhost/');
      expect(response.status).toBe(403); expect(await response.text()).toBe('Outbound access disabled in EP-04');
    } finally { await isolated.dispose(); }
    const disabled = await createJobsRuntime();
    try {
      expect((await disabled.mf.dispatchFetch('http://localhost/jobs')).status).toBe(404);
      expect((await disabled.mf.dispatchFetch('http://localhost/api/jobs/v1/foundation')).status).toBe(404);
    } finally { await disabled.mf.dispose(); }
  }, 30000);
  it('revalidates recruiter discovery permission and hides restricted profiles even from owner', async () => {
    await sql("UPDATE jobs_users SET visibility='RECRUITERS_ONLY' WHERE subject='candidate'");
    expect(await projectProfile(db, 'candidate', actor, { name: 'N' }, ['name'])).toEqual({ name: 'N' });
    await sql("UPDATE memberships SET revoked_at=1 WHERE subject='recruiter'");
    expect(await projectProfile(db, 'candidate', actor, { name: 'N' }, ['name'])).toEqual({});
    await sql("UPDATE jobs_users SET restricted=1 WHERE subject='candidate'");
    expect(await projectProfile(db, 'candidate', owner, { name: 'N' }, ['name'])).toEqual({});
  });
  it.each(Object.entries(retentionDefaults))('purges %s only at its configured day boundary', async (kind, days) => {
    await sql('INSERT INTO retained_records VALUES(?,?,?, ?,0,?)', 'r', 'candidate', kind, epoch, 'synthetic');
    const privacy = new JobsPrivacy(db, () => now);
    now = epoch + days * DAY - 1; await privacy.purge(admin); expect(await count('retained_records')).toBe(1);
    now++; await privacy.purge(admin); expect(await count('retained_records')).toBe(0); expect(await count('deletion_ledger')).toBe(1);
  });
  it('keeps held/restricted records inaccessible and rejects unauthorized deletion', async () => {
    await sql("INSERT INTO retained_records VALUES('held','candidate','CLOSURE',0,0,'synthetic')");
    const privacy = new JobsPrivacy(db, () => now);
    await expect(privacy.purge(actor)).rejects.toMatchObject({ status: 403 });
    await privacy.restrict(admin, 'held', true, null, 'LEGAL_HOLD');
    await privacy.purge(admin); expect(await count('retained_records')).toBe(1);
    expect(await privacy.readOwn(owner, 'held')).toBeNull();
    expect(await privacy.readOwn(actor, 'held')).toBeNull();
    await privacy.restrict(admin, 'held', false, now + DAY, 'STATUTORY_RETENTION');
    await privacy.purge(admin); expect(await count('retained_records')).toBe(1);
    now += DAY; await privacy.purge(admin); expect(await count('retained_records')).toBe(0);
  });
  it('replays independently preserved deletions before reopening a restored database', async () => {
    const privacy = new JobsPrivacy(db, () => now);
    const ledger = [{ record: 'restored', subject: 'candidate', at: now - DAY }];
    await expect(privacy.replayDeletionLedger(admin, ledger)).rejects.toMatchObject({ code: 'restore_gate_required' });
    await sql('UPDATE restore_gate SET ready=0');
    await sql("INSERT INTO retained_records VALUES('restored','candidate','APPLICATION',?,0,'synthetic')", now);
    await expect(privacy.readOwn(owner, 'restored')).rejects.toMatchObject({ code: 'restore_pending' });
    await privacy.replayDeletionLedger(admin, ledger);
    expect(await count('retained_records')).toBe(0); expect(await privacy.readOwn(owner, 'restored')).toBeNull();
  });
  it('closes only Jobs and preserves shared identity sessions', async () => {
    await new JobsPrivacy(db, () => now).close({ subject: 'synthetic_candidate' });
    expect((await runtime.accounts.prepare("SELECT status FROM accounts WHERE id='synthetic_candidate'").first<{ status: string }>())?.status).toBe('ACTIVE');
    expect((await runtime.accounts.prepare("SELECT revoked_at FROM account_sessions WHERE account_id='synthetic_candidate'").first<{ revoked_at: string | null }>())?.revoked_at).toBeNull();
    const response = await runtime.mf.dispatchFetch('http://localhost/api/jobs/v1/foundation', { headers: { Cookie: 'bt_account_session=' + 's'.repeat(43) } });
    expect(response.status).toBe(403);
  });
  it('keeps Jobs disabled by default without touching authentication or data', async () => {
    const response = await handleJobs(new Request('http://localhost/jobs'), false, undefined, async () => { throw new Error('must not run'); });
    expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('private, no-store');
    const source = readFileSync('src/index.ts', 'utf8'); expect(source).toContain('env.JOBS_ENABLED === "true"');
    const local = readFileSync('scripts/jobs-runtime.mjs', 'utf8'); expect(local).toContain('enabled = false');
  });
  it('uses actual account sessions and rejects revoked, expired and suspended accounts', async () => {
    const fetch = () => runtime.mf.dispatchFetch('http://localhost/api/jobs/v1/foundation', { headers: { Cookie: 'bt_account_session=' + 's'.repeat(43) } });
    expect((await fetch()).status).toBe(200);
    await runtime.accounts.prepare("UPDATE account_sessions SET revoked_at='2026-01-01'").run(); expect((await fetch()).status).toBe(401);
    await runtime.accounts.prepare("UPDATE account_sessions SET revoked_at=NULL,expires_at='2000-01-01'").run(); expect((await fetch()).status).toBe(401);
    await runtime.accounts.prepare("UPDATE account_sessions SET expires_at='2099-01-01'").run();
    await runtime.accounts.prepare("UPDATE accounts SET status='SUSPENDED'").run(); expect((await fetch()).status).toBe(401);
    await runtime.accounts.prepare("UPDATE accounts SET status='ACTIVE',email_verified_at=NULL").run(); expect((await fetch()).status).toBe(401);
    await runtime.accounts.prepare("UPDATE accounts SET email_verified_at='2026-01-01'").run();
    expect((await runtime.mf.dispatchFetch('http://localhost/jobs')).status).toBe(401);
  });
  const post = (body: unknown, extra: Record<string, string> = {}) => new Request('http://localhost/api/jobs/v1/eligibility', { method: 'POST', headers: { Origin: 'http://localhost', 'X-Jobs-Request': '1', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  it('enforces 18+ without collecting DOB or identity numbers and blocks self-reactivation', async () => {
    const identity = async () => ({ subject: 'new_user' });
    expect((await handleJobs(post({ over18: false }), true, db, identity)).status).toBe(403);
    expect((await handleJobs(post({ over18: true }), true, db, identity)).status).toBe(403);
    expect((await handleJobs(post({ over18: true, birthDate: '1990-01-01' }), true, db, identity)).status).toBe(400);
    expect((await handleJobs(post({ over18: true }), true, db, async () => ({ subject: 'adult' }))).status).toBe(200);
    expect(await db.prepare("SELECT visibility,indexing FROM jobs_users WHERE subject='adult'").first()).toEqual({ visibility: 'PRIVATE', indexing: 0 });
  });
  it('rejects cross-origin and missing CSRF headers, malformed/oversized bodies; never leaks errors', async () => {
    const attacks: Record<string, string>[] = [{ Origin: 'https://evil.invalid' }, { 'X-Jobs-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }];
    for (const headers of attacks) expect((await handleJobs(post({ over18: true }, headers), true, db, async () => owner)).status).toBe(403);
    expect((await handleJobs(post({ over18: 'yes' }), true, db, async () => owner)).status).toBe(400);
    expect((await handleJobs(post({ over18: true, padding: 'x'.repeat(300) }), true, db, async () => owner)).status).toBe(413);
    const response = await handleJobs(new Request('http://localhost/jobs'), true, db, async () => { throw new Error('private secret'); });
    expect(await response.text()).not.toContain('private secret'); expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
  it('uses strict validation and parameterized values against injection', async () => {
    await expect(quota.apply(actor, { ...action('safe'), company: "x'; DROP TABLE listings;--" })).rejects.toMatchObject({ status: 400 });
    await quota.apply(actor, { ...action('safe'), vacancy: vacancy("O'Brien; DROP TABLE listings;") });
    expect(await count('listings')).toBe(1); expect(() => vacancyFingerprint(undefined)).toThrow();
  });
  it('has no Jobs imports of Meetings, shared data or privileged bindings; local runtime denies egress', () => {
    for (const file of readdirSync('src/jobs').filter(f => f.endsWith('.ts'))) {
      const source = readFileSync('src/jobs/' + file, 'utf8');
      expect(source).not.toMatch(/from\s+["']\.\.\//);
      expect(source).not.toMatch(/\b(ACCOUNT_DB|MEETING_STORE|SESSION_STORE|RECORDINGS_BUCKET|REALTIME_SFU_BEARER_TOKEN)\b/);
      expect(source).not.toMatch(/console\.(log|error|warn)/);
    }
    const local = readFileSync('scripts/jobs-runtime.mjs', 'utf8');
    expect(local).toContain("outboundService: () => new Response('Outbound access disabled");
    expect(local).not.toMatch(/process\.env|remote:\s*true|persist:\s*true/);
  });
});
