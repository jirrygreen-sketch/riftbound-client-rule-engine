#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { execFileSync } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_22 = /^22\.(1[2-9]|[2-9]\d)\./u;
const REQUIRED_NODE_24 = /^24\./u;
const REQUIRED_NODE_26_PLUS = /^(2[6-9]|[3-9]\d)\./u;
const REQUIRED_PNPM = "11.9.0";
const LEGACY_DATA_VERSION = "2026-10-12-official-gallery";
const DEFAULTS = Object.freeze({
  cardServerPort: 8787,
  serverPort: 8787,
  clientA: 5173,
  clientB: 5174
});

function usage() {
  return [
    "Usage: node scripts/beta/check-m1-beta.mjs [options]",
    "",
    "Options:",
    "  --card-server-port <port> catalog source port (default: 8787)",
    "  --server-port <port>  game-server and health port (default: 8787)",
    "  --client-a-port <port> first Vite port (default: 5173)",
    "  --client-b-port <port> second Vite port (default: 5174)",
    "  --require-free         fail if any checked port is already in use",
    "  --help                 show this help"
  ].join("\n");
}

function parsePort(name, raw) {
  if (!/^\d+$/u.test(raw ?? "")) throw new Error(`${name} must be an integer port`);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return port;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, requireFree: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true, options };
    if (argument === "--require-free") {
      options.requireFree = true;
      continue;
    }
    const value = argv[index + 1];
    if (argument === "--card-server-port") options.cardServerPort = parsePort(argument, value);
    else if (argument === "--server-port") options.serverPort = parsePort(argument, value);
    else if (argument === "--client-a-port") options.clientA = parsePort(argument, value);
    else if (argument === "--client-b-port") options.clientB = parsePort(argument, value);
    else throw new Error(`Unknown argument: ${argument}`);
    index += 1;
  }
  if (new Set([options.serverPort, options.clientA, options.clientB]).size !== 3) {
    throw new Error("game-server and client ports must be distinct");
  }
  return { help: false, options };
}

function nodeVersionSupported(version) {
  return REQUIRED_NODE_22.test(version) || REQUIRED_NODE_24.test(version) || REQUIRED_NODE_26_PLUS.test(version);
}

async function fileIsReadable(file) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) return { ok: false, reason: "missing or empty" };
    await access(file, fsConstants.R_OK);
    return { ok: true, bytes: info.size };
  } catch {
    return { ok: false, reason: "missing or unreadable" };
  }
}

async function validateCatalog(root) {
  const file = path.join(root, "packages/card-data/data/deck-catalog.json");
  const readable = await fileIsReadable(file);
  if (!readable.ok) return { ok: false, reason: `${readable.reason}: ${file}` };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.cards) || parsed.cards.length === 0) {
      return { ok: false, reason: "invalid deck catalog shape" };
    }
    const warning = parsed.dataVersion === LEGACY_DATA_VERSION
      ? "legacy local catalog snapshot; sync current official data before beta sign-off"
      : null;
    return { ok: true, bytes: readable.bytes, cards: parsed.cards.length,
      dataVersion: parsed.dataVersion, digest: parsed.digest, warning };
  } catch (error) {
    return { ok: false, reason: `invalid deck catalog JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function sameCatalog(left, right) {
  return left.dataVersion === right.dataVersion && left.digest === right.digest && left.cards === right.cards;
}

async function validateServedCatalog(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cards`, { signal: controller.signal });
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
    const parsed = await response.json();
    if (!Array.isArray(parsed?.cards) || parsed.cards.length === 0) return { ok: false, reason: "invalid catalog response" };
    return { ok: true, dataVersion: parsed.dataVersion, digest: parsed.digest, cards: parsed.cards.length };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function validateClientPage(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    const body = response.ok ? await response.text() : "";
    return { ok: response.ok && body.includes('id="root"'), status: response.status };
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function validatePlan(root) {
  const file = path.join(root, "docs/plans/m1-decks.json");
  const readable = await fileIsReadable(file);
  if (!readable.ok) return { ok: false, reason: `${readable.reason}: ${file}` };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    const ids = Array.isArray(parsed.candidates) ? parsed.candidates.map(candidate => candidate.id) : [];
    const missing = ["rumble-sfd", "fiora-sfd"].filter(id => !ids.includes(id));
    if (missing.length > 0) return { ok: false, reason: `missing preset plans: ${missing.join(", ")}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `invalid M1 plan JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function validateImageManifest(root) {
  const file = path.join(root, "packages/card-data/data/images-manifest.json");
  const readable = await fileIsReadable(file);
  if (!readable.ok) return { ok: false, optional: true, reason: `optional image manifest ${readable.reason}: ${file}` };
  return { ok: true, optional: true, bytes: readable.bytes };
}

function probePort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = inUse => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(600, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function probeHealth(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!response.ok) return { running: true, healthy: false, reason: `HTTP ${response.status}` };
    const payload = await response.json();
    return { running: true, healthy: payload?.status === "ok", reason: payload?.status === "ok" ? "ok" : "unexpected health payload" };
  } catch (error) {
    return { running: false, healthy: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function marker(ok) {
  return ok ? "PASS" : "FAIL";
}

function checkRuntime() {
  const node = process.versions.node;
  let pnpm = process.env.npm_config_user_agent?.match(/pnpm\/([^\s]+)/u)?.[1] ?? "unknown";
  if (pnpm === "unknown") {
    try {
      pnpm = execFileSync("pnpm", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch { /* reported below */ }
  }
  return { node, nodeOk: nodeVersionSupported(node), pnpm, pnpmOk: pnpm === REQUIRED_PNPM };
}

function checkGit(root) {
  const git = args => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  }).trim();
  try {
    const head = git(["rev-parse", "--short=12", "HEAD"]);
    let integration;
    try {
      integration = git(["rev-parse", "--short=12", "integration"]);
    } catch {
      return { revisions: false, head, integration: "missing", behind: 0 };
    }
    const behind = Number(git(["rev-list", "--count", `HEAD..${integration}`]) || "0");
    return { revisions: true, head, integration, behind };
  } catch {
    return { revisions: false, head: "unknown", integration: "unknown", behind: 0 };
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const { help, options } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(usage());
    return;
  }

  const runtime = checkRuntime();
  console.log(`${marker(runtime.nodeOk)} Node ${runtime.node} (requires ^22.12.0, ^24.x, or >=26)`);
  console.log(`${marker(runtime.pnpmOk)} pnpm ${runtime.pnpm} (requires ${REQUIRED_PNPM}; invoke through pnpm exec if this line fails)`);

  const git = checkGit(root);
  console.log(`${marker(git.revisions)} integration ${git.integration}`);
  console.log(`${marker(git.behind === 0)} checkout ${git.head}${git.behind ? ` (${git.behind} commit(s) behind integration)` : " (includes merge base)"}`);
  if (git.behind > 0) process.exitCode = 1;

  const catalog = await validateCatalog(root);
  console.log(`${marker(catalog.ok)} catalog ${catalog.ok ? `${catalog.cards} printings, ${catalog.dataVersion}` : catalog.reason}`);
  if (catalog.warning) console.log(`WARN catalog ${catalog.warning}`);
  if (!catalog.ok) {
    console.log("       Run: pnpm cards:sync && pnpm --filter @riftbound/card-data build:catalog");
  }
  const plan = await validatePlan(root);
  console.log(`${marker(plan.ok)} M1 plans ${plan.ok ? "rumble-sfd, fiora-sfd" : plan.reason}`);
  const images = await validateImageManifest(root);
  console.log(`${images.ok ? "INFO" : "WARN"} images ${images.ok ? "manifest present" : images.reason}`);

  const storageDirectory = path.resolve(process.env.RIFTBOUND_STORAGE_DIRECTORY ?? path.join(root, ".riftbound/m1-beta/rooms"));
  try {
    const info = await stat(storageDirectory);
    if (!info.isDirectory()) throw new Error("not a directory");
    await access(storageDirectory, fsConstants.W_OK);
    console.log(`PASS room storage writable: ${storageDirectory}`);
  } catch {
    if (process.env.RIFTBOUND_STORAGE_DIRECTORY === undefined) {
      console.log(`INFO room storage will be created by the launcher: ${storageDirectory}`);
    } else {
      console.log(`FAIL room storage is not writable: ${storageDirectory}`);
      process.exitCode = 1;
    }
  }

  if (options.cardServerPort !== options.serverPort) {
    const served = await validateServedCatalog(options.cardServerPort);
    const matches = served.ok && catalog.ok && sameCatalog(catalog, served);
    console.log(`${marker(matches)} catalog source :${options.cardServerPort} ${matches
      ? "serves the checked local catalog"
      : `must match local ${catalog.dataVersion ?? "<unknown>"}; ${served.ok ? "different catalog" : served.reason}`}`);
    // A distinct source is part of the run contract; an unavailable or
    // different source cannot satisfy startup.
    if (!matches) process.exitCode = 1;
  }

  const ports = [
    ["catalog source", options.cardServerPort],
    ["game server", options.serverPort],
    ["client A", options.clientA],
    ["client B", options.clientB]
  ];
  let portsOk = true;
  for (const [label, port] of ports) {
    const occupied = await probePort(port);
    if ((label === "catalog source" || label === "game server") && occupied && !options.requireFree) {
      const health = await probeHealth(port);
      portsOk &&= health.healthy;
      console.log(`${marker(health.healthy)} ${label} :${port} ${health.healthy ? "already running and healthy" : `occupied; health ${health.reason}`}`);
    } else {
      portsOk &&= !occupied;
      if (label.startsWith("client") && occupied && !options.requireFree) {
        const page = await validateClientPage(port);
        portsOk &&= page.ok;
        console.log(`${marker(page.ok)} ${label} :${port} ${page.ok ? "already serving the desktop client" : `occupied; page ${page.status}`}`);
      } else {
        console.log(`${marker(!occupied)} ${label} :${port} ${occupied ? "already in use" : "available"}`);
      }
    }
  }

  if (!runtime.nodeOk || !runtime.pnpmOk || !git.revisions || !catalog.ok || !plan.ok || !portsOk) process.exitCode = 1;
}

main().catch(error => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
