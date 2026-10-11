# Desktop Build

Last reviewed: 2026-10-11

The desktop client is a React + Vite application wrapped by Tauri 2. Windows
NSIS bundling is enabled in configuration, but this checkout cannot currently
compile or verify the installer because the local Rust toolchain is missing.

## Current State

Implemented:

- `apps/desktop-client/src-tauri` contains the Rust entry points, capability,
  build script, and Tauri configuration.
- `bundle.active` is `true` and `bundle.targets` is `["nsis"]`.
- The bundle references Windows PNG icons and `icon.ico`; the icon files exist.
- `@tauri-apps/cli` is declared by `@riftbound/desktop-client`.
- Root aliases provide `desktop:dev` and `desktop:build`.
- `beforeDevCommand` runs the desktop-client Vite script, and both agree on
  `127.0.0.1:5173`. Vite uses `--strictPort`, so an occupied port fails instead
  of silently selecting another frontend.
- The CSPs include the Tauri IPC endpoints, configurable HTTP/HTTPS catalog
  addresses, HTTP/HTTPS card images, and user-selected `ws:`/`wss:` game
  servers. No filesystem or shell plugin permissions are granted.

Not verified:

- `cargo` and `rustc` are not available on the current machine.
- `rustup` is not available on the current machine.
- `apps/desktop-client/src-tauri/Cargo.lock` has not been generated.
- `cargo check`, `tauri dev`, `tauri build`, and installer smoke testing have not
  been run here.
- `@tauri-apps/cli` 2.12.2 is available through pnpm, and its version and help
  output were checked. This does not substitute for a Rust build or installer
  smoke test.

Therefore, the active bundle configuration is not evidence that a Windows
installer has been produced.

## Static Verification

The following checks were run on this Windows machine:

- `tauri --version` reports `tauri-cli 2.12.2`.
- `tauri info` parses the Tauri configuration and reports:
  - WebView2 Runtime is installed.
  - Visual Studio 2019 and 2022 MSVC build tools are visible.
  - `rustc`, `cargo`, and `rustup` are unavailable.
  - The active bundle type is bundle, the frontend dist is `../dist`, and the
    dev URL is `http://127.0.0.1:5173/`.
- `tauri.conf.json` and `capabilities/default.json` parse as valid JSON.
- The configured icons exist. PNG dimensions are 32x32, 128x128, 256x256, and
  512x512; the source PNG is 1024x1024. `icon.ico` contains 16, 24, 32, 48,
  64, and 256-pixel 32-bit entries.
- `desktop:build` reaches the Rust toolchain check and fails at
  `cargo metadata` because `cargo` is not installed. It does not produce an
  NSIS installer.

The production and development CSPs intentionally allow arbitrary
`http:`, `https:`, `ws:`, and `wss:` connections because both the card catalog
and game server addresses are user-configurable in the client. This is a broad
network policy, not an accidental wildcard. No Tauri filesystem, shell, or
other plugin permissions are granted by the default capability.

## Commands

From the repository root:

```text
pnpm desktop:dev
pnpm desktop:build
pnpm --filter @riftbound/desktop-client build
```

`desktop:dev` and `desktop:build` require Rust and the MSVC toolchain. The
filtered build command checks TypeScript and creates the Vite frontend bundle,
but does not compile Rust or produce an installer.

The desktop client deliberately pins Vite to `127.0.0.1:5173` with
`--strictPort`. If that port is already occupied, `desktop:dev` must fail;
do not repoint it to another running Vite project or allow Vite to choose a
different port.

Expected NSIS output after a successful build:

```text
apps/desktop-client/src-tauri/target/release/bundle/nsis/*-setup.exe
```

## Windows Prerequisites

1. Rust stable with the `x86_64-pc-windows-msvc` target; `Cargo.toml` requires
   Rust 1.90 or newer.
2. Microsoft C++ Build Tools with Desktop development with C++ and the Windows
   10/11 SDK.
3. WebView2 Runtime, normally preinstalled on supported Windows systems.
4. Node.js `^22.12.0`, `^24.0.0`, or `>=26.0.0`, plus pnpm 11.9.0.
5. Network access for the first Rust crate and NSIS tooling download.

The first successful Rust build should generate `Cargo.lock`. Treat an installer
as verified only after `desktop:build` succeeds and the generated NSIS setup
binary installs and launches on a clean Windows environment.
