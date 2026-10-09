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
pnpm dev                 # the API on http://localhost:2013, rebuilt on save
```

`pnpm verify:cc` typechecks, lints and tests.

## Design

The reasoning lives in [docs/working-notes/](docs/working-notes/), starting at
[notify-hub.md](docs/working-notes/notify-hub.md). The contract every sender
posts to is shared across projects, in commonplace's `notify-hub.md`.
