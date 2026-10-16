import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import {
  createAuthoritativeDuelRuntimeP4,
  fingerprintDuelAuthoritativeRuntimePrivateP4,
} from "../../src/duel/authoritative-runtime-p4.js";
import {
  createDuelRecordedRuntimeP4,
} from "../../src/duel/command-journal-p4.js";
import {
  createPersistentDuelRuntimeP4,
  openPersistentDuelRuntimeP4,
} from "../../src/duel/persistent-command-runtime-p4.js";
import { createPrivateJournalCasStore } from "../../src/duel/private-journal-cas-store.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";
import {
  DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  isJournal,
  type DuelCommandMessageV3Actions1,
} from "@riftbound/protocol";

type Journal = {
  readonly read: (context: unknown) => unknown;
  readonly observe: (path: unknown) => void;
  readonly fork: (ownerHead?: unknown) => Journal;
  readonly observedHead: () => { readonly stateVersion: number; readonly eventSeq: number };
};

const fault = { armed: false, fired: 0, holdSources: false, published: null as Journal | null };

vi.mock("../../src/duel/operation-journal-v2.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/duel/operation-journal-v2.js")>();
  const wrap = (real: Journal, parent: Journal | null): Journal => {
    const wrapper: any = {
      read(context: unknown) { return fault.holdSources ? null : real.read(context); },
      observe(path: unknown) {
        const commits = path && typeof path === "object" && "commits" in path
          ? (path as { readonly commits?: unknown }).commits : undefined;
        if (fault.armed && Array.isArray(commits) && commits.length > 0) {
          fault.armed = false;
          fault.fired += 1;
          fault.published = parent;
          throw new Error("test-injected native journal observe failure");
        }
        return real.observe(path);
      },
      fork(ownerHead?: unknown) { return wrap(real.fork(ownerHead), wrapper); },
    };
    for (const key of ["tokenBirth", "tokenRetirement", "currentHead", "observedHead",
      "bindContext", "registerSourceWork", "registerSource", "registerRuntimeEffect", "registerEffect",
      "retireRuntimeEffect", "listCommits", "revision", "observeNativePath", "observeCommitPath"] as const) {
      wrapper[key] = (...args: unknown[]) => (real as any)[key](...args);
    }
    return wrapper;
  };
  return {
    ...actual,
    createDuelNativeOperationJournalV2: (options: unknown) =>
      wrap(actual.createDuelNativeOperationJournalV2(options), null),
  };
});

async function options(matchId: string, directory?: string) {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ...(card.cardType === "Unit" ? { energy: 1, power: null } : {}),
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell" ? "Draw 4." :
      card.cardType === "Legend" ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token." :
        card.cardType === "Battlefield" ? "You may hide an additional card here." : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery",
    digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" } });
  let uid = 0;
  return { ...(directory ? { directory } : {}), catalog, matchId, randomIndex: () => 0,
    uidFactory: () => `p4-atomicity-${++uid}`, roster: [
      { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    ] as const };
}

function packet(projection: any, actor: string, commandId: string, command: unknown,
  expectedVersion = projection.match.stateVersion): DuelCommandMessageV3Actions1 {
  return { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: `${commandId}-request`, commandId, expectedVersion,
    command: command as DuelCommandMessageV3Actions1["command"] };
}

async function mainOwner(matchId: string, startMain = true) {
  const runtime = createAuthoritativeDuelRuntimeP4(await options(matchId));
  for (let n = 0; n < 2; n++) {
    const view = runtime.project(null);
    if (view.match.stage !== "setup") throw new Error("setup expected");
    const actor = view.match.setup.currentMulliganOwner!;
    expect(runtime.dispatch(actor, packet(view, actor, `m-${n}`, { type: "mulligan", selectedUIDs: [] })).ack.ok).toBe(true);
  }
  if (startMain) {
    for (let n = 0; n < 4 && runtime.project(null).match.stage === "playing" &&
        runtime.project(null).match.frame.phase !== "main"; n++) {
      if (runtime.resumePending() === null) throw new Error("turn continuation did not remain resumable");
    }
  }
  const view = runtime.project("alice");
  if (view.match.stage !== "playing") throw new Error("playing expected");
  return { runtime, view };
}

describe("P4 journal failure atomicity", () => {
  it("fails closed after an observed-head fault and never exposes the partial successor", async () => {
    fault.armed = false; fault.fired = 0; fault.published = null;
    const { runtime, view } = await mainOwner("p4-atomicity-raw");
    const rune = view.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (!rune || rune.kind !== "rune-energy") throw new Error(`enabled rune-energy action expected: ${JSON.stringify({ frame: view.match.frame, actions: view.actions })}`);
    const beforeVersion = view.match.stateVersion;
    fault.armed = true;
    expect(() => runtime.dispatch("alice", packet(view, "alice", "faulted-rune", { type: "rune-energy", uid: rune.uid })))
      .toThrow(/failed closed/);
    expect(fault.fired).toBe(1);
    expect(fault.published).toBeTruthy();
    expect(fault.published!.observedHead().stateVersion).toBe(beforeVersion);
    expect(() => runtime.project(null)).toThrow(/failed closed/);
    expect(() => runtime.resumePending()).toThrow(/failed closed/);
    expect(() => runtime.dispatch("alice", packet(view, "alice", "after-fault", { type: "rune-energy", uid: rune.uid })))
      .toThrow(/failed closed/);
    expect(() => fingerprintDuelAuthoritativeRuntimePrivateP4(runtime)).toThrow(/failed closed/);
  }, 30_000);

  it("keeps ordinary stale-version rejection resumable", async () => {
    fault.armed = false; fault.fired = 0; fault.published = null;
    const { runtime, view } = await mainOwner("p4-atomicity-rejection");
    const rune = view.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (!rune || rune.kind !== "rune-energy") throw new Error(`enabled rune-energy action expected: ${JSON.stringify({ frame: view.match.frame, actions: view.actions })}`);
    const rejected = runtime.dispatch("alice", packet(view, "alice", "stale-rune", { type: "rune-energy", uid: rune.uid }, view.match.stateVersion - 1));
    expect(rejected.ack.type).toBe("error");
    expect(runtime.project(null).match.stateVersion).toBe(view.match.stateVersion);
    expect(runtime.dispatch("alice", packet(view, "alice", "valid-rune", { type: "rune-energy", uid: rune.uid })).ack.ok).toBe(true);
  }, 30_000);

  it("fails closed when resumePending loses its native observation", async () => {
    fault.armed = false; fault.fired = 0; fault.published = null;
    fault.holdSources = true;
    try {
      const { runtime, view } = await mainOwner("p4-atomicity-resume", false);
      if (view.match.stage !== "playing") throw new Error("playing expected");
      expect(view.match.frame.execution.status).toBe("pending");
      expect(view.match.frame.phase).not.toBe("main");
      const beforeVersion = view.match.stateVersion;
      fault.holdSources = false;
      fault.armed = true;
      expect(() => runtime.resumePending()).toThrow(/failed closed/);
      expect(fault.fired).toBe(1);
      expect(fault.published!.observedHead().stateVersion).toBe(beforeVersion);
      expect(() => runtime.project(null)).toThrow(/failed closed/);
      expect(() => runtime.resumePending()).toThrow(/failed closed/);
    } finally { fault.holdSources = false; fault.armed = false; }
  }, 30_000);

  it("does not CAS a failed proposal and reopens the protected pre-fault owner", async () => {
    fault.armed = false; fault.fired = 0; fault.published = null;
    const directory = await mkdtemp(path.join(tmpdir(), "riftbound-p4-atomicity-"));
    try {
      const opts = await options("p4-atomicity-cas", directory);
      const genesis = createDuelRecordedRuntimeP4(opts);
      expect(isJournal(genesis.archive().journal)).toBe(true);
      const baseStore = await createPrivateJournalCasStore({ directory, key: opts.matchId,
        genesisData: JSON.parse(JSON.stringify({ journal: genesis.archive().journal })) });
      const compareAndSwap = vi.fn((...args: Parameters<typeof baseStore.compareAndSwap>) => baseStore.compareAndSwap(...args));
      const store = { key: baseStore.key, keyHash: baseStore.keyHash, load: () => baseStore.load(), compareAndSwap,
        close: () => baseStore.close() };
      const runtime = await createPersistentDuelRuntimeP4({ ...opts, store });
      for (let n = 0; n < 2; n++) {
        const view = runtime.project(null);
        if (view.match.stage !== "setup") throw new Error("setup expected");
        const actor = view.match.setup.currentMulliganOwner!;
        expect((await runtime.dispatch(actor, packet(view, actor, `cas-m-${n}`, { type: "mulligan", selectedUIDs: [] }))).ack.ok).toBe(true);
      }
      const before = runtime.project(null), alice = runtime.project("alice");
      const rune = alice.actions.find(action => action.kind === "rune-energy" && action.enabled);
      if (!rune || rune.kind !== "rune-energy") throw new Error(`enabled rune-energy action expected: ${JSON.stringify({ frame: alice.match.frame, actions: alice.actions })}`);
      const calls = compareAndSwap.mock.calls.length;
      fault.armed = true;
      const result = await runtime.dispatch("alice", packet(alice, "alice", "cas-fault", { type: "rune-energy", uid: rune.uid }));
      expect(result.ack.type).toBe("error");
      expect(compareAndSwap).toHaveBeenCalledTimes(calls);
      expect(runtime.project(null)).toEqual(before);
      await runtime.close();
      const reopened = await openPersistentDuelRuntimeP4(opts);
      expect(reopened.project(null)).toEqual(before);
      await reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
