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
  type DuelCommandMessageV3Actions1,
} from "@riftbound/protocol";

type Journal = {
  readonly read: (context: unknown) => unknown;
  readonly observe: (path: unknown) => void;
  readonly fork: (ownerHead?: unknown) => Journal;
  readonly observedHead: () => { readonly stateVersion: number; readonly eventSeq: number };
};

const fault = { armed: false, fired: 0, holdSources: false, observedHeadArmed: false,
  observedHeadFired: 0, bindContextArmed: false, bindContextFired: 0,
  forkArmed: false, skipForks: 0, forkFired: 0, published: null as Journal | null };

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
      fork(ownerHead?: unknown) {
        if (fault.forkArmed && fault.skipForks === 0) {
          fault.forkArmed = false; fault.forkFired += 1;
          throw new Error("test-injected source snapshot fork failure");
        }
        if (fault.forkArmed) fault.skipForks -= 1;
        return wrap(real.fork(ownerHead), wrapper);
      },
    };
      wrapper.observedHead = () => {
        if (fault.observedHeadArmed) {
          fault.observedHeadArmed = false;
          fault.observedHeadFired += 1;
          throw new Error("test-injected observed-head read failure");
        }
        return real.observedHead();
      };
      wrapper.bindContext = (...args: unknown[]) => {
        if (fault.bindContextArmed) {
          fault.bindContextArmed = false;
          fault.bindContextFired += 1;
          throw new Error("test-injected bind-context failure");
        }
        return (real as any).bindContext(...args);
      };
      for (const key of ["tokenBirth", "tokenRetirement", "currentHead",
      "readCostCensus", "registerSourceWork", "registerSource", "registerRuntimeEffect", "registerEffect",
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

describe("P4 journal read fault boundaries", () => {
  it("fails closed when native checkpoint binding fails", async () => {
    fault.armed = false; fault.fired = 0; fault.observedHeadArmed = false; fault.observedHeadFired = 0; fault.bindContextArmed = false; fault.bindContextFired = 0; fault.published = null;
    const { runtime, view } = await mainOwner("p4-atomicity-bind-context");
    const action = view.actions.find(value => value.kind === "end-turn" && value.enabled);
    if (!action || action.kind !== "end-turn") throw new Error("enabled end-turn action expected");
    fault.bindContextArmed = true;
    let error = "";
    try {
      runtime.dispatch("alice", packet(view, "alice", "bind-context-fault", {
        type: "end-turn", windowId: action.windowId }));
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    console.log(JSON.stringify({ probe: "recordHead-bindContext", command: "end-turn",
      bindContextFaultCount: fault.bindContextFired, error, ownerClosed: error.includes("failed closed") }));
    expect(fault.bindContextFired).toBe(1);
    expect(error).toMatch(/failed closed/);
    expect(() => runtime.project(null)).toThrow(/failed closed/);
  }, 30_000);

  it("fails closed when an internal journal head read throws", async () => {
    fault.armed = false; fault.fired = 0; fault.observedHeadArmed = false;
    fault.observedHeadFired = 0; fault.bindContextArmed = false; fault.bindContextFired = 0;
    const { runtime, view } = await mainOwner("p4-atomicity-observed-head-pretry");
    const action = view.actions.find(value => value.kind === "end-turn" && value.enabled);
    if (!action || action.kind !== "end-turn") throw new Error("enabled end-turn action expected");
    fault.observedHeadArmed = true;
    expect(() => runtime.dispatch("alice", packet(view, "alice", "observed-head-pretry", {
      type: "end-turn", windowId: action.windowId }))).toThrow(/failed closed/);
    expect(fault.observedHeadFired).toBe(1);
    expect(() => runtime.project(null)).toThrow(/failed closed/);
    expect(() => runtime.resumePending()).toThrow(/failed closed/);
  }, 30_000);

  it("keeps a normal missing source pending and resumes once its proof is available", async () => {
    fault.armed = false; fault.observedHeadArmed = false; fault.bindContextArmed = false;
    fault.holdSources = true;
    try {
      const { runtime, view } = await mainOwner("p4-source-missing-retry", false);
      if (view.match.stage !== "playing") throw new Error("playing expected");
      expect(view.match.frame.execution.status).toBe("pending");
      expect(() => runtime.project(null)).not.toThrow();
      fault.holdSources = false;
      expect(runtime.resumePending()?.ack.type).toBe("request-result");
      const after = runtime.project(null).match;
      if (after.stage !== "playing") throw new Error("playing expected after continuation");
      expect(after.frame.phase).toBe("main");
      expect(after.stateVersion).toBeGreaterThan(view.match.stateVersion);
    } finally { fault.holdSources = false; }
  }, 30_000);

  it("fails closed when the source snapshot fork throws after the proposal fork", async () => {
    fault.armed = false; fault.observedHeadArmed = false; fault.bindContextArmed = false;
    fault.forkArmed = false; fault.forkFired = 0;
    const { runtime, view } = await mainOwner("p4-source-snapshot-fork");
    const action = view.actions.find(value => value.kind === "end-turn" && value.enabled);
    if (!action || action.kind !== "end-turn") throw new Error("enabled end-turn action expected");
    fault.skipForks = 1; fault.forkArmed = true;
    try {
      expect(() => runtime.dispatch("alice", packet(view, "alice", "source-snapshot-fork", {
        type: "end-turn", windowId: action.windowId }))).toThrow(/failed closed/);
      expect(fault.forkFired).toBe(1);
      expect(() => runtime.project(null)).toThrow(/failed closed/);
      expect(() => runtime.resumePending()).toThrow(/failed closed/);
    } finally { fault.forkArmed = false; }
  }, 30_000);
});
