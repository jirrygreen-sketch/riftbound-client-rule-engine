// Registers the engine-core source resolver for `node --test` runs.
// Wired through the package `test` script as `--import ./test/support/register.mjs`.
import { register } from 'node:module';

register('./engine-source-resolve-hook.mjs', import.meta.url);
