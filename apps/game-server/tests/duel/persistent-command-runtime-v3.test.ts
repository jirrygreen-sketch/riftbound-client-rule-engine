import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DuelCatalogCardTypeV2 } from "@riftbound/engine-core/duel";
import { loadCardCatalogRuntime, type CardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createPersistentDuelCommandRuntimeV3,
  openPersistentDuelCommandRuntimeV3,
  type PersistentDuelCommandRuntimeV3Options,
} from "../../src/duel/persistent-command-runtime-v3.js";
import { openPrivateJournalCasStore } from "../../src/duel/private-journal-cas-store.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const imagesDirectory = fileURLToPath(new URL("./fixtures/", import.meta.url));
const testRoot = process.env.RIFTBOUND_PERSISTENT_ADAPTER_TEST_TMP ?? tmpdir();
const roster = [
  { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
  { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
] as const;
const fixtureDeck = setupAdapterFixtureDecks.a.submission;
const champions = new Set([fixtureDeck.champion![0]!.cardId]);
const legends = new Set([fixtureDeck.legend![0]!.cardId]);
const runes = new Set(fixtureDeck.runes!.map((entry) => entry.cardId));
const fields = new Set(fixtureDeck.battlefields!.map((entry) => entry.cardId));
function trustedCardType(cardId: string): DuelCatalogCardTypeV2 {
  if (champions.has(cardId)) return "Champion";
  if (legends.has(cardId)) return "Legend";
  if (runes.has(cardId)) return "Rune";
  if (fields.has(cardId)) return "Battlefield";
  return "Gear";
}

let catalogPromise: Promise<CardCatalogRuntime> | undefined;
function catalog(): Promise<CardCatalogRuntime> {
  catalogPromise ??= loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog, imagesDirectory });
  return catalogPromise;
}

async function options(directory: string, matchId = "persistent-v3-test"): Promise<PersistentDuelCommandRuntimeV3Options> {
  let uid = 0;
  return { catalog: await catalog(), trustedRoster: roster, matchId, directory,
    trustedCardType, randomIndex: () => 0, uidFactory: () => `persistent-v3-${++uid}` };
}

async function testDirectory(): Promise<string> {
  await mkdir(testRoot, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(testRoot, "riftbound-persistent-v3-"));
  await chmod(directory, 0o700);
  return directory;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

async function rewriteHead(directory: string, mutate: (data: Record<string, any>) => void): Promise<void> {
  const keyHash = createHash("sha256").update("duel-v3:persistent-v3-test").digest("hex");
  const headPath = join(directory, keyHash, "head.json");
  const blob = JSON.parse(await readFile(headPath, "utf8")) as Record<string, any>;
  mutate(blob.data);
  const digest = createHash("sha256").update(canonicalJson(blob.data), "utf8").digest("hex");
  blob.payloadDigest = digest;
  const receipts = blob.receipts as Array<Record<string, any>>;
  const last = receipts[receipts.length - 1];
  if (last) {
    last.data = blob.data;
    last.payloadDigest = digest;
  }
  await writeFile(headPath, `${JSON.stringify(blob)}\n`, { mode: 0o600 });
}

function command(requestId: string, commandId: string, expectedVersion: number, selectedUIDs: readonly string[] = []) {
  return { type: "duel-command" as const, requestId, commandId, expectedVersion,
    command: { type: "mulligan" as const, selectedUIDs } };
}

describe("persistent P3 command runtime", () => {
  it("keeps the durable write ID in the authenticated actor namespace", async () => {
    const directory = await testDirectory();
    try {
      const base = await options(directory);
      const runtime = await createPersistentDuelCommandRuntimeV3(base);
      const first = await runtime.execute("alice", command("a-first", "shared-id", 0));
      const second = await runtime.execute("bob", command("b-first", "shared-id", 1));
      expect(first.outbound.type).toBe("request-result");
      expect(second.outbound.type).toBe("request-result");
      expect(runtime.stage).toBe("playing");
      expect(runtime.stateVersion).toBe(2);
      await runtime.close();
      const reopened = await openPersistentDuelCommandRuntimeV3(base);
      try {
        const duplicate = await reopened.execute("alice", command("a-retry", "shared-id", 0));
        expect(duplicate.outbound).toMatchObject({ type: "request-result", appliedVersion: 1, duplicate: true });
        const other = await reopened.execute("bob", command("b-retry", "shared-id", 1));
        expect(other.outbound).toMatchObject({ type: "request-result", appliedVersion: 2, duplicate: true });
        expect(reopened.stateVersion).toBe(2);
      } finally { await reopened.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("does save-before-ACK, keeps duplicate receipts and rejects body conflicts", async () => {
    const directory = await testDirectory();
    try {
      const runtime = await createPersistentDuelCommandRuntimeV3(await options(directory));
      expect(runtime.project("alice").projectionSchema).toBe("riftbound-duel-v3");
      const first = await runtime.execute("alice", command("r1", "m1", runtime.stateVersion));
      expect(first.committed).toBe(true);
      expect(first.outbound).toMatchObject({ type: "request-result", ok: true, duplicate: false });
      const duplicate = await runtime.execute("alice", command("r2", "m1", 0));
      expect(duplicate.duplicate).toBe(true);
      expect(duplicate.committed).toBe(false);
      const conflict = await runtime.execute("alice", command("r3", "m1", 0, ["different-body"]));
      expect(conflict.outbound).toMatchObject({ type: "error", code: "command-rejected" });
      expect(conflict.committed).toBe(false);
      await runtime.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("replays the protected journal after restart and reaches playing through two mulligans", async () => {
    const directory = await testDirectory();
    try {
      const base = await options(directory);
      const runtime = await createPersistentDuelCommandRuntimeV3(base);
      await runtime.execute("alice", command("r1", "m1", runtime.stateVersion));
      await runtime.execute("bob", command("r2", "m2", runtime.stateVersion));
      expect(runtime.stage).toBe("playing");
      const duplicate = await runtime.execute("alice", command("r3", "m1", 0));
      expect(duplicate.outbound).toMatchObject({ type: "request-result", appliedVersion: 1, eventSeq: 1, duplicate: true });
      const before = runtime.project(null);
      await runtime.close();
      const reopened = await openPersistentDuelCommandRuntimeV3(base);
      expect(reopened.stage).toBe("playing");
      expect(reopened.project(null)).toEqual(before);
      expect(JSON.stringify(reopened.project(null))).not.toContain("journal");
      await reopened.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects trusted catalog drift and non-P3 profile at the admission boundary", async () => {
    const directory = await testDirectory();
    try {
      const base = await options(directory);
      const runtime = await createPersistentDuelCommandRuntimeV3(base);
      await runtime.close();
      const drift = { ...await catalog(), publicCatalog: { ...(await catalog()).publicCatalog,
        cards: [...(await catalog()).publicCatalog.cards].reverse() } };
      await expect(openPersistentDuelCommandRuntimeV3({ ...base, catalog: drift })).rejects.toThrow();
      await expect(openPersistentDuelCommandRuntimeV3({ ...base, selectedProjectionProfile: "P4" as never })).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("does not ACK an injected CAS failure and recovers from the protected head", async () => {
    const directory = await testDirectory();
    try {
      const base = await options(directory);
      const first = await createPersistentDuelCommandRuntimeV3(base);
      await first.close();
      const durable = await openPrivateJournalCasStore({ directory, key: "duel-v3:persistent-v3-test" });
      let fail = true;
      const failingStore = {
        key: durable.key, keyHash: durable.keyHash,
        load: () => durable.load(),
        compareAndSwap: async (...args: Parameters<typeof durable.compareAndSwap>) => {
          if (fail) throw new Error("injected after-rename fsync failure");
          return durable.compareAndSwap(...args);
        },
        close: () => durable.close(),
      };
      const runtime = await openPersistentDuelCommandRuntimeV3({ ...base, store: failingStore });
      await expect(runtime.execute("alice", command("r1", "m1", runtime.stateVersion))).rejects.toThrow(/durable command commit failed/);
      expect(runtime.stateVersion).toBe(0);
      fail = false;
      const retried = await runtime.execute("alice", command("r1", "m1", runtime.stateVersion));
      expect(retried.outbound).toMatchObject({ type: "request-result", ok: true });
      await runtime.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects a roster value tamper even when the ordinary CAS digest is recomputed", async () => {
    const directory = await testDirectory();
    try {
      const base = await options(directory);
      const runtime = await createPersistentDuelCommandRuntimeV3(base);
      await runtime.execute("alice", command("r1", "m1", runtime.stateVersion));
      await runtime.close();
      await rewriteHead(directory, data => {
        data.journal.creation.roster[0].displayName = "Mallory";
      });
      await expect(openPersistentDuelCommandRuntimeV3(base)).rejects.toThrow(/does not match trusted roster/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reopens after legal roster object-key reordering without changing candidate values", async () => {
    const directory = await testDirectory();
    try {
      const base = await options(directory);
      const runtime = await createPersistentDuelCommandRuntimeV3(base);
      await runtime.execute("alice", command("r1", "m1", runtime.stateVersion));
      await runtime.close();
      await rewriteHead(directory, data => {
        data.journal.creation.roster = data.journal.creation.roster.map((seat: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(seat).reverse()));
      });
      const reopened = await openPersistentDuelCommandRuntimeV3(base);
      expect(reopened.stateVersion).toBe(1);
      expect(reopened.project(null).projectionSchema).toBe("riftbound-duel-v3");
      await reopened.close();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
