# Tauri 2 Desktop Shell

This directory contains the Rust entry points, Tauri configuration, capability,
and bundled icons for the Windows desktop shell. Build prerequisites, commands,
CI expectations, and verification boundaries are documented in
[`docs/desktop-build.md`](../../../docs/desktop-build.md).

The Rust toolchain is pinned by [`rust-toolchain.toml`](./rust-toolchain.toml)
to `1.90.0` (`profile = "minimal"`), matching `Cargo.toml`
(`rust-version = "1.90"`) and the pinned Windows CI step. No `targets` entry is
declared, so the pin resolves per host (Windows `x86_64-pc-windows-msvc` in CI,
`aarch64-apple-darwin` locally); the macOS target is intentionally left
unconfigured.

`@tauri-apps/cli` 2.12.2 is available through pnpm on the current macOS host,
but there is no `cargo`, `rustc`, or `rustup` on `PATH`. No Rust compilation,
`tauri dev`, `tauri build`, or installer smoke test has been run on Windows
here, and `bundle.targets` is `["nsis"]` (Windows-only), so this checkout cannot
produce a Windows installer. It therefore cannot claim that a Windows installer
has been produced.
