type Env = Record<string, string | undefined>;
export function resolveDbUrl(env: Env): string {
  if (env.VERCEL_ENV === 'preview' && env.PREVIEW_DATABASE_URL) return env.PREVIEW_DATABASE_URL;
  const url = env.DATABASE_URL ?? env.POSTGRES_URL ?? env.POSTGRES_URL_NON_POOLING
    ?? env.DATABASE_URL_UNPOOLED ?? env.POSTGRES_URL_NO_SSL;
  if (!url) throw new Error('No database URL configured (set DATABASE_URL / POSTGRES_URL / PREVIEW_DATABASE_URL).');
  return url;
}
export function dbUrl(): string { return resolveDbUrl(process.env as Env); }
export function adminSecret(): string { return process.env.ADMIN_SECRET ?? ''; }
