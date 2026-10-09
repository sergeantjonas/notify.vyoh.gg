import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadDatabaseUrl } from '../config.js';
import { createDatabase } from './client.js';

const { db, sql } = createDatabase(loadDatabaseUrl());

await migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
});
await sql.end();

console.log('migrations applied');
