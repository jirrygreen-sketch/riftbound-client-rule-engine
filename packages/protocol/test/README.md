# Protocol test gate

Run the protocol package gate from any directory with:

```sh
pnpm --filter @riftbound/protocol test
```

The script builds the package first, then runs the repository's recursive test
discovery helper. The helper finds every `test/**/*.test.mjs` file in a stable
path order, excluding only top-level `test/support/` and `test/fixtures/`
directories. It passes all discovered files to `node --test` in one process and
propagates failures, errors, and signals to the package command.

Add a protocol regression as a `*.test.mjs` file under `test/` or a nested test
directory such as `test/v2/`. New files are included automatically; do not add
a shell glob or package-specific test list. Files in `test/support/` and
`test/fixtures/` are shared helpers and data rather than test suites, so they
are not discovered as top-level directories.
