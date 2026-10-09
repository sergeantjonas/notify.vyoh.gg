import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(url: string) {
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  const db = drizzle(sql);
  return { db, sql };
}
