# Tauri 2 Desktop Shell

This directory contains the Rust entry points, Tauri configuration, capability,
and bundled icons for the Windows desktop shell. Build prerequisites, commands,
CI expectations, and verification boundaries are documented in
[`docs/desktop-build.md`](../../../docs/desktop-build.md).

The current machine has `@tauri-apps/cli` available through pnpm, but no
`cargo`, `rustc`, or `rustup`. No Rust compilation, `tauri dev`, `tauri build`,
or installer smoke test has been run here. The checkout therefore cannot claim
that a Windows installer has been produced.
