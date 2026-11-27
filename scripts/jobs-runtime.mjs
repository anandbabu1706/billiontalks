import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function migrate(db, relative, separator = /;\s*(?:\r?\n|$)/) {
  const sql = await readFile(new URL('../' + relative, import.meta.url), 'utf8');
  for (const statement of sql.split(separator).filter(s => s.trim())) await db.prepare(statement).run();
}
/** Programmatic config deliberately ignores wrangler files, .env, .dev.vars and user credentials.
 * Tests default to ephemeral storage; every Worker outbound fetch is denied. */
export function isolatedOptions(script, { enabled = false, port = 0 } = {}) {
  const options = convertV4MiniflareOptions({ host: '127.0.0.1', port, cf: false, workers: [{ name: 'ep04', modules: true, script, compatibilityDate: '2026-10-01',
    d1Databases: { ACCOUNT_DB: 'ep04-synthetic-identity', JOBS_DB: 'ep04-synthetic-jobs' },
    bindings: { JOBS_ENABLED: String(enabled), LIMITED_RELEASE_MEDIA_DISABLED: 'true' },
    outboundService: () => new Response('Outbound access disabled in EP-04', { status: 403 }),
  }] });
  return { ...options, telemetry: { enabled: false }, logRequests: false };
}
export async function createJobsRuntime({ enabled = false, port = 0, localState } = {}) {
  if (localState !== undefined && !/^[a-z0-9-]{1,60}$/.test(localState)) throw new Error('Invalid synthetic state name');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], loader: { '.png': 'dataurl', '.webp': 'dataurl' } });
  const options = isolatedOptions(bundle.outputFiles[0].text, { enabled, port });
  if (localState) options.resourcePersistencePath = fileURLToPath(new URL('../.jobs-synthetic/' + localState + '/', import.meta.url));
  const mf = new Miniflare(options);
  try {
    const accounts = await mf.getD1Database('ACCOUNT_DB'); const jobs = await mf.getD1Database('JOBS_DB');
    for (const [db, files, separator] of [
      [accounts, ['migrations/0001_accounts.sql','migrations/0003_account_sessions.sql'], /;\s*(?:\r?\n|$)/],
      [jobs, ['migrations/jobs/0001_foundation.sql','migrations/jobs/0002_profiles.sql','migrations/jobs/0003_companies.sql','migrations/jobs/0004_marketplace.sql','migrations/jobs/0005_recruiter_workspace.sql','migrations/jobs/0006_interviews.sql'], /-- break\s*\r?\n/],
    ]) {
      await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)').run();
      for (const file of files) {
        if (await db.prepare('SELECT name FROM local_migrations WHERE name=?').bind(file).first()) continue;
        const sql = await readFile(new URL('../' + file, import.meta.url), 'utf8');
        await db.batch([...sql.split(separator).filter(s=>s.trim()).map(s=>db.prepare(s)), db.prepare('INSERT INTO local_migrations VALUES(?)').bind(file)]);
      }
    }
    return { mf, accounts, jobs };
  } catch (error) { await mf.dispose(); throw error; }
}
export async function seedIdentity(db, id = 'synthetic_candidate', token = 's'.repeat(43)) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT OR IGNORE INTO accounts(id,full_name,email_normalized,country_code,mobile_e164,status,email_verified_at,terms_accepted_at,terms_version,created_at,updated_at)
    VALUES(?,?,?,'IN',?,'ACTIVE',? ,?,'synthetic-v1',?,?)`).bind(id, 'Synthetic User', id + '@example.invalid', '+910000' + id, now, now, now, now).run();
  await db.prepare('INSERT OR REPLACE INTO account_sessions(token_hash,account_id,created_at,expires_at,last_used_at) VALUES(?,?,?,?,?)')
    .bind(createHash('sha256').update(token).digest('hex'), id, now, new Date(Date.now() + 86400000).toISOString(), now).run();
  return token;
}
