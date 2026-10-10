import { loadConfig } from './config.js';
import { createDiscordSender } from './delivery/discord.js';

// Posts one message to a source's channel, to check its webhook before any
// real alert exists:
//
//   pnpm discord:test engram
//   docker compose exec api node dist/discord-test-cli.js engram   (on the box)
//
// It says whether Discord took it and nothing else: the URL is a credential.

const name = process.argv[2];
const config = loadConfig();
const source = config.sources.find((s) => s.name === name);

if (source === undefined) {
  const known = config.sources.map((s) => s.name).join(', ') || 'none';
  console.error(`no source named ${name ?? '(none given)'}; configured: ${known}`);
  process.exit(1);
}
if (source.discordUrl === null) {
  console.error(`${source.name} has no Discord webhook set`);
  process.exit(1);
}

const result = await createDiscordSender()(source.discordUrl, {
  embeds: [
    {
      title: 'notify.vyoh.gg can reach this channel',
      description: `Alerts from ${source.name} will arrive here.`,
      timestamp: new Date().toISOString(),
    },
  ],
  allowed_mentions: { parse: [] },
});

if (result.ok) {
  console.log(`delivered to ${source.name}'s channel`);
} else {
  console.error(
    `not delivered: ${result.status === null ? 'no answer from Discord' : result.status}`,
  );
  process.exit(1);
}
