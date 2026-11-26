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
 * All storage is ephemeral; every Worker outbound fetch is denied. */
export function isolatedOptions(script, { enabled = false, port = 0 } = {}) {
  const options = convertV4MiniflareOptions({ host: '127.0.0.1', port, cf: false, workers: [{ name: 'ep04', modules: true, script, compatibilityDate: '2026-10-01',
    d1Databases: { ACCOUNT_DB: 'ep04-synthetic-identity', JOBS_DB: 'ep04-synthetic-jobs' },
    bindings: { JOBS_ENABLED: String(enabled), LIMITED_RELEASE_MEDIA_DISABLED: 'true' },
    outboundService: () => new Response('Outbound access disabled in EP-04', { status: 403 }),
  }] });
  return { ...options, telemetry: { enabled: false }, logRequests: false };
}
export async function createJobsRuntime({ enabled = false, port = 0 } = {}) {
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], loader: { '.png': 'dataurl', '.webp': 'dataurl' } });
  const mf = new Miniflare(isolatedOptions(bundle.outputFiles[0].text, { enabled, port }));
  try {
    const accounts = await mf.getD1Database('ACCOUNT_DB'); const jobs = await mf.getD1Database('JOBS_DB');
    await migrate(accounts, 'migrations/0001_accounts.sql');
    await migrate(accounts, 'migrations/0003_account_sessions.sql');
    await migrate(jobs, 'migrations/jobs/0001_foundation.sql', /-- break\s*\r?\n/);
    return { mf, accounts, jobs };
  } catch (error) { await mf.dispose(); throw error; }
}
export async function seedIdentity(db, id = 'synthetic_candidate', token = 's'.repeat(43)) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO accounts(id,full_name,email_normalized,country_code,mobile_e164,status,email_verified_at,terms_accepted_at,terms_version,created_at,updated_at)
    VALUES(?,?,?,'IN',?,'ACTIVE',? ,?,'synthetic-v1',?,?)`).bind(id, 'Synthetic User', id + '@example.invalid', '+910000' + id, now, now, now, now).run();
  await db.prepare('INSERT INTO account_sessions(token_hash,account_id,created_at,expires_at,last_used_at) VALUES(?,?,?,?,?)')
    .bind(createHash('sha256').update(token).digest('hex'), id, now, new Date(Date.now() + 86400000).toISOString(), now).run();
  return token;
}
