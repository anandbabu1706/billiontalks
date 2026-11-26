import { createJobsRuntime, seedIdentity } from './jobs-runtime.mjs';
if (process.argv.slice(2).some(arg => arg !== '--enable-jobs')) throw new Error('Only --enable-jobs is supported; remote configuration is prohibited.');
const { mf, accounts } = await createJobsRuntime({ enabled: process.argv.includes('--enable-jobs'), port: 8794 });
await seedIdentity(accounts);
console.log('Synthetic-only local environment:', String(await mf.ready));
console.log('Jobs enabled:', process.argv.includes('--enable-jobs'));
console.log('Use the documented synthetic session cookie; no email or external service is enabled.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await mf.dispose(); process.exit(0); });
