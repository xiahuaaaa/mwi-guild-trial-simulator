# Local guild API MVP

This service intentionally has no external runtime dependency: it uses Node's
`node:http` and `node:sqlite` only. It listens on `127.0.0.1` by default.

```sh
MWI_GUILD_API_ADMIN_KEY='replace-with-a-long-random-secret' \
MWI_GUILD_API_DB_PATH="$PWD/.local/guild-api.sqlite" \
node apps/api/server.mjs
```

Optional environment variables are `MWI_GUILD_API_HOST` (defaults to
`127.0.0.1`), `MWI_GUILD_API_PORT` (defaults to `8787`), and
`MWI_GUILD_API_FIXTURE_PATH`. No credential has a code default.

The administrator provisions a guild and each member token once:

```sh
curl -X PUT http://127.0.0.1:8787/api/admin/guilds/example \
  -H "X-Admin-Key: $MWI_GUILD_API_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Example Guild"}'

curl -X PUT http://127.0.0.1:8787/api/admin/guilds/example/members \
  -H "X-Admin-Key: $MWI_GUILD_API_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"memberId":"character-id","displayName":"Character","memberToken":"member-local-secret"}'
```

The exporter uploads only its whitelist-shaped `MemberSnapshotV2` JSON to
`POST /api/guilds/:guildId/members/:memberId/snapshots` with
`Authorization: Bearer <memberToken>`. The API rejects unknown and token-like
fields, requires the path identity to equal the snapshot identity, and stores
at most four member-approved loadouts. Provisioned member tokens are retained
as salted hashes, never returned by the service.

Public read endpoints are `GET /health`, `GET /api/boss-fixture/current`, and
`GET /api/plugin-versions`. Administrative endpoints require `X-Admin-Key`:

- `GET /api/guilds/:guildId/members`
- `GET /api/guilds/:guildId/qq-bindings?qqNumber=...`
- `GET /api/guilds/:guildId/assignments/formal|test`
- `POST /api/guilds/:guildId/jobs` and `GET`/`DELETE` `/jobs/:id`
- `PUT /api/admin/guilds/:guildId/qq-bindings/:qqNumber`
- `DELETE /api/admin/guilds/:guildId/qq-bindings/by-member/:memberId`
- `PUT /api/admin/guilds/:guildId/auras/:memberId`
- `PUT /api/admin/plugin-versions/:pluginId`

Until the production simulation worker is connected, jobs are explicitly
`blocked`; a `full` job returns HTTP 409 `simulation_unsupported`. The API
never returns a fabricated completed optimization result.
