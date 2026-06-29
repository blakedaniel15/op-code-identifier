import { db } from '@/db/client';
import { adminSecret } from '@/lib/config';
import { runMigration, migrationStatements } from '@/db/migrate';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  const { secret } = await req.json().catch(() => ({ secret: '' }));
  if (!secret || secret !== adminSecret()) return new Response('forbidden', { status: 403 });
  await runMigration(db());
  return Response.json({ ok: true, tables: migrationStatements().length });
}
