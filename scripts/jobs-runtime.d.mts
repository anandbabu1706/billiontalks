import type { Miniflare, MiniflareOptions } from 'miniflare';
import type { JobsDatabase } from '../src/jobs/contracts';
export function createJobsRuntime(options?: { enabled?: boolean; port?: number }): Promise<{ mf: Miniflare; accounts: JobsDatabase; jobs: JobsDatabase }>;
export function seedIdentity(db: JobsDatabase, id?: string, token?: string): Promise<string>;
export function migrate(db: JobsDatabase, path: string, separator?: RegExp): Promise<void>;
export function isolatedOptions(script: string, options?: { enabled?: boolean; port?: number }): MiniflareOptions;
