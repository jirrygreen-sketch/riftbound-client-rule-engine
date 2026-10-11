# Release checklist

This checklist defines the commands and data expectations that must pass from a
clean checkout. The official card snapshot and image cache are intentionally
excluded from Git:

- `packages/card-data/data/catalog.json`
- `packages/card-data/data/deck-catalog.json`
- `packages/card-data/data/images-manifest.json`
- `packages/card-data/data/images/`

No release build, package artifact, or CI cache may depend on those local files.
The desktop client bundles only its own `dist` output and the Tauri executable;
it does not bundle `@riftbound/card-data` or `@riftbound/game-server`.

## Clean checkout

Run all of these from a fresh clone or a clean CI runner:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm desktop:build
```

The build step must run before typecheck. Workspace packages expose their
TypeScript declarations from `dist`, so checking first on a fresh checkout makes
`@riftbound/engine-core` fail while trying to resolve `@riftbound/protocol`.

On a Windows runner with Rust MSVC installed, verify that `pnpm desktop:build`
creates one NSIS artifact:

```text
apps/desktop-client/src-tauri/target/release/bundle/nsis/*-setup.exe
```

The CI workflow intentionally checks that none of the ignored local card-data
files or images is present before building.

The local release workstation does not have Rust or Cargo installed. The NSIS
bundle therefore remains pending verification on the GitHub Windows runner.

A clean checkout intentionally has no production `Cargo.lock` for the Tauri
shell. The first successful Rust build generates it; commit that lockfile only
after the build and installer smoke test pass.

## Full test gate

The recursive `pnpm test` is the release test gate. All suites run from
synthetic fixtures and must remain clean-checkout safe. If a suite starts
requiring the local official catalog, image cache, or another generated file,
fix that suite instead of adding generated card data to Git or narrowing the
release gate to selected packages.

## Card data sync

If official card data is needed for manual server verification, generate it
locally and keep it out of the release artifact:

```powershell
pnpm cards:sync
pnpm cards:images
pnpm cards:catalog
```

After synchronization, run the server-specific verification separately:

```powershell
pnpm test:server
pnpm typecheck:server
```

Do not commit, upload, cache, or bundle the generated local data. A missing
local `deck-catalog.json` is expected in a clean checkout and is not a reason
to add real card images to source control.
