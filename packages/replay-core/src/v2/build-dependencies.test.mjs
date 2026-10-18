import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("dependency builds include the journal protocol and replay engine", () => {
  const projects = JSON.parse(execFileSync("pnpm", [
    "--filter", "@riftbound/replay-core...", "list", "--depth", "-1", "--json",
  ], {
    cwd: new URL("../../", import.meta.url),
    encoding: "utf8",
  }));
  const selected = new Set(projects.map(project => project.name));

  for (const dependency of ["@riftbound/protocol", "@riftbound/engine-core"]) {
    assert.ok(selected.has(dependency), `${dependency} must build before replay-core`);
  }
});
