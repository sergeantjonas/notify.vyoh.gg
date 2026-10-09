# Notify hub

**Status:** Building — scoped 2026-10-09. Chunk 1, the scaffold, landed the
same day.

Engram decides when a followed show's new episode is ready, and vyoh.gg will
decide when a wishlist game drops in price. Delivering either is the same
problem: a Discord webhook URL to keep secret, a message that must not arrive
twice, a burst that should arrive as one. This service solves it once, for
every project.

The contract senders post to, and the rule for what earns an alert at all, are
shared across projects and live in commonplace's `notify-hub.md`. This note is
the implementation.

## Settled

- **2026-10-09 — Built before any sender delivers.** Engram had a Discord
  sender half-planned inside it; the owner chose the hub first, so nothing is
  built only to be replaced. Engram's alerts wait in its `alert` table until
  chunk 5.
- **2026-10-09 — A tenant of its own on the shared box**, at
  `notify.vyoh.gg`, rather than a route inside an existing app: a route in
  Engram would tie vyoh.gg's alerts to Engram's uptime. Senders reach it over
  its public URL, since containers on the box do not share a network.
- **2026-10-09 — Engram's stack.** TypeScript, Fastify, Drizzle and zod, with
  Postgres in its own compose stack, per the box's one-cluster-per-project
  rule. NestJS weighed and not taken: one route and a delivery loop do not
  need its modules. Dependencies pinned to the exact versions Engram's
  lockfile resolved.
- **2026-10-09 — It cannot report the box being down.** Nothing on the box
  can. The status page's alerts go through healthchecks.io for that reason,
  not through here.

## What it does

- **Delivers a `(source, key)` once.** A repeat post is a no-op, so senders
  retry freely and scheduled checks re-send on every run.
- **Holds every Discord webhook URL**, one per source, so each project has its
  own channel and none holds a URL. A URL is a credential and never reaches a
  log.
- **Collapses bursts.** Messages from one source arriving close together go
  out as one.
- **Records what it delivered**, so "did it tell me?" has an answer.

## Chunk 1 · The scaffold

Landed 2026-10-09: pnpm, TypeScript at Engram's strictness, Biome, Vitest, the
`:cc` scripts, `buildApp` with injected dependencies, `/health` and `/ready`,
the error handler that never echoes, Postgres on `127.0.0.1:55433` for
development, and the supply-chain posture — install scripts denied by
default, AI-config paths force-tracked.

## Chunk 2 · Accepting messages

`POST /messages`, authenticated per source, and a `message` table unique on
`(source, key)`. To settle here:

- **How a source is named.** The lean is that the secret names it — a bearer
  token maps to one source — so the body carries no `source` a leaked secret
  could forge another project's name into.
- **How sources are configured.** One secret and one Discord URL per source,
  from the environment.
- **What a message may carry**: title, body, url, and limits that keep a
  message inside what Discord will take.

## Chunk 3 · Delivering

A loop in the process that sends what is undelivered, collapsing a source's
burst once it has been quiet for a short window, marking each message
delivered after Discord accepts it, and leaving it for the next pass when
Discord refuses or rate-limits. A test command posts one message to check a
URL before any real alert exists.

## Chunk 4 · Deploying

An image built in CI and pulled on the box, the compose stack, a loopback
port asked of the box, the nginx vhost and certificate for `notify.vyoh.gg`,
DNS, and `/srv/notify/.env` by hand. Whether its data earns a backup is
decided here: it is a delivery log, not a record.

## Chunk 5 · Engram sends

Engram drains its `alert` table to `POST /messages`, which is chunk 5 of
Engram's `episode-alerts.md`.
