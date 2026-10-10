# notify.vyoh.gg

One place that delivers every project's alerts to Discord.

Each project decides for itself what is worth saying — only Engram knows which
shows are followed, only vyoh.gg knows the wishlist — and posts it here. The hub
does what is the same everywhere: it keeps the Discord webhook URLs, delivers a
message once however often it is posted, collapses a burst into one message,
and gives each project its own channel.

It runs as a tenant on the shared VPS, so it cannot report the box itself being
down; that alert comes from healthchecks.io instead.

## Running it

```sh
cp .env.example .env
docker compose up -d     # Postgres on 127.0.0.1:55433
pnpm install
pnpm db:migrate
pnpm dev                 # the API on http://localhost:2013, rebuilt on save
```

A project posts with its own secret, set as `SOURCE_<NAME>_SECRET`:

```sh
curl -X POST http://localhost:2013/messages \
  -H "authorization: Bearer $SOURCE_ENGRAM_SECRET" \
  -H 'content-type: application/json' \
  -d '{"key":"ready@show:tvdb:452595/s01e0004","title":"S01E04 is ready"}'
```

and it reaches Discord within about a minute and a quarter, once the source
has been quiet long enough for a burst to go out as one post. To check a
source's webhook before any real alert exists:

```sh
pnpm discord:test engram
```

`pnpm verify:cc` typechecks, lints and tests.

## Design

The reasoning lives in [docs/working-notes/](docs/working-notes/), starting at
[notify-hub.md](docs/working-notes/notify-hub.md). The contract every sender
posts to is shared across projects, in commonplace's `notify-hub.md`.
