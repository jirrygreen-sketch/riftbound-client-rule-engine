# Riftbound Client Rule Engine

This is an unofficial fan project. The repository is a pnpm monorepo containing
a game server, a React desktop client, and shared rule, data, protocol, replay,
and judge packages.

## Current Status

Implemented:

- WebSocket game rooms and HTTP catalog, card-image, and deck-validation APIs.
- A React client with canonical card grouping, printing selection, a six-zone
  deck builder, unavailable-printing protection, preserved API
  `printingIssues`, and a full-art preview.
- A bounded Constructed check: official bans, canonical grouped copy limits,
  and zone structure. Domain Identity, Champion/Legend/Signature, and
  regional availability restrictions are not implemented.
- A persisted 1,381-record card-data snapshot with matching English and Chinese
  official gallery IDs.
- A generated deck catalog with 1,381 printings grouped into 1,080 official
  English full-name identities, including 46 cross-set identities: 1,212
  standard printings and 169 alternate printings. The 45 official ASCII `*`
  public-code suffixes are classified as alternate, and every
  `primaryPrintingId` remained stable. The persisted image cache contains all
  1,381 card images, with zero missing and zero failed entries. Display names
  are 1,355 localized Chinese names and 26 English fallbacks.
- Tauri 2 desktop-shell configuration with NSIS bundling enabled.

Verification and remaining boundaries:

- `pnpm build`, `pnpm typecheck`, and the current full `pnpm test` pass
  locally: 208 tests in total (card-data 49, desktop-client 41, game-server 48,
  integration-tests 23, card-dsl 10, judge-tools 10, replay-core 10,
  engine-core 14, protocol 3). Frozen install and audit checks also pass.
  Vitest is 5.0.3 and Vite is 7.3.7.
- The Windows installer is not verified locally because the checkout lacks
  Rust; GitHub Windows CI verification is pending.
- The complete official 1,381-card effect set is not compiled or executable.
  The only runtime rules implementation is the synthetic-demo slice.

Delivery is automated through `.github/workflows/desktop-build.yml`. The
workflow runs the full workspace build, typecheck, and test suite, then builds
the Tauri NSIS bundle and uploads matching `*-setup.exe` files as an artifact.
A successful artifact upload verifies packaging on the Windows runner, but it
does not by itself verify installation, upgrade, or rollback behavior.

Card data and playable effects are different scopes. The completed snapshot
covers identity, text, image references, and the bounded Constructed policy. It
does not compile or execute official card abilities.

Implemented multiplayer/deck surfaces are also narrower than a complete game:
the server provides in-memory WebSocket rooms, and the client provides room
connection controls and a deck builder against the persisted catalog. They are
not a complete playable Riftbound game because official card effects and the
official rules engine remain unimplemented.

## Workspace

```text
apps/
  game-server/       HTTP catalog APIs and WebSocket rooms
  desktop-client/    React + Vite UI and Tauri 2 shell
packages/
  protocol/          shared contracts and validators
  engine-core/       synthetic-demo rules engine
  card-data/         versioned card data and sync tooling
  card-dsl/          synthetic-demo DSL AST validation
  replay-core/       replay envelope validation
  judge-tools/       judge policy and decision metadata
  integration-tests/ cross-package integration tests
```

## Commands

```text
pnpm build

pnpm cards:sync
pnpm --filter @riftbound/card-data sync:cards --dry-run
pnpm --filter @riftbound/card-data sync:cards --timeout-ms 60000

pnpm --filter @riftbound/card-data sync:images --dry-run
pnpm --filter @riftbound/card-data sync:images --timeout-ms 60000

pnpm dev:server
pnpm start:server

pnpm desktop:dev
pnpm desktop:build
pnpm --filter @riftbound/desktop-client build
```

When passing options, use the package-filtered form. Do not add a separate `--`
before the option. The card sync parser tolerates one bare `--`, but the image
sync parser rejects it.

The server listens on `127.0.0.1:8787` by default. Health and catalog endpoints
are available at `/health` and `/api/cards`; WebSocket connections use `/ws`.

## Documentation

- [总方案](outputs/riftbound-client-rule-engine-plan.md)
- [开发方案](docs/development-plan.md)
- [独立客户端与服务端设计](docs/standalone-client-design.md)
- [客户端交互设计](docs/client-ux-design.md)
- [Implementation status](docs/implementation-status.md)
- [Product backlog](docs/product-backlog.md)
- [Desktop build](docs/desktop-build.md)
- [Card data package](packages/card-data/README.md)
- [Rule engine architecture](docs/rule-engine-architecture.md)
- [Card DSL](docs/card-dsl.md)
- [Judge policy](docs/judge-policy.md)
- [Test matrix](docs/test-matrix.md)
- [Sources and versions](docs/sources.md)

## License And Rights

Original architecture, interfaces, tests, and documentation are provided under
the MIT License. Riftbound, official rules, card text, card images, and related
trademarks remain the property of their respective rights holders. This project
is not affiliated with or endorsed by Riot Games.
