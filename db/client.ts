import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { dbUrl } from '@/lib/config';
let _sql: NeonQueryFunction<false, false> | null = null;
export function db(): NeonQueryFunction<false, false> {
  if (!_sql) _sql = neon(dbUrl());
  return _sql;
}
