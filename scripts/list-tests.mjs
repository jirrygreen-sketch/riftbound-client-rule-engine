#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export async function listTests(testDirectory = "test") {
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        directory === testDirectory &&
        (entry.name === "support" || entry.name === "fixtures")
      ) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        files.push(entryPath);
      }
    }
  }

  await visit(testDirectory);
  return files.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...nodeArguments] = process.argv.slice(2);
  if (mode !== undefined && mode !== "--run") {
    throw new Error("Usage: node list-tests.mjs [--run [Node.js options]]");
  }
  const files = await listTests();
  if (files.length === 0) {
    throw new Error("No test/**/*.test.mjs files found outside test/support and test/fixtures");
  }
  if (mode === "--run") {
    const result = spawnSync(process.execPath, [...nodeArguments, "--test", ...files], {
      stdio: "inherit"
    });
    if (result.error) throw result.error;
    if (result.signal) process.kill(process.pid, result.signal);
    process.exitCode = result.status ?? 1;
  } else {
    process.stdout.write(`${files.join("\n")}\n`);
  }
}
