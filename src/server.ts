import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createDiscordSender } from './delivery/discord.js';
import { startDelivery } from './delivery/drain.js';

const config = loadConfig();
const { db, sql: connection } = createDatabase(config.DATABASE_URL);

const app = buildApp({ config, db });

// Started here rather than in buildApp, so a test that builds the app never
// sends anything to Discord.
const stopDelivery = startDelivery({
  db,
  sources: config.sources,
  send: createDiscordSender(),
  log: app.log,
});
app.log.info(
  {
    sources: config.sources.map((source) => source.name),
    // Accepted and held until a webhook is set; worth seeing at every boot.
    withoutWebhook: config.sources.filter((s) => s.discordUrl === null).map((s) => s.name),
  },
  'delivery started',
);

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  // First, and awaited: a send in flight is recorded before the database
  // closes, or it would go out again after the restart.
  await stopDelivery();
  await app.close();
  await connection.end();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
