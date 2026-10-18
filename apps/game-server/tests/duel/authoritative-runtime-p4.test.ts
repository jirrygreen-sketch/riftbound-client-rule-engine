import { describe, expect, it } from "vitest";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createAuthoritativeDuelRuntimeP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, isDuelProjectionV3Actions1,
  type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";

async function owner(journal = false) {
  const catalog = await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog });
  let uid = 0, reads = 0;
  const runtime = createAuthoritativeDuelRuntimeP4({ catalog, matchId: "p4-unresolved-fixture",
    roster: [
      { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    ], randomIndex: () => 0, uidFactory: () => `p4-fixture-${++uid}`,
    ...(journal ? { globalJournal: { read: () => { reads++; return null; }, tokenBirth: () => null } } : {}) });
  return { runtime, reads: () => reads };
}

async function completeSourceOwner() {
  // Controlled complete-text programs exercise the real production journal composition.
  // They do not represent the official abilities of these fixture printings.
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell" ? "Draw 4." :
      card.cardType === "Legend" ? ":rb_energy_1:, :rb_exhaust:: Play a 1 :rb_might: Recruit unit token." :
        card.cardType === "Battlefield" ? "When you hold here, draw 1." : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery",
    digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" } });
  let uid = 0;
  return createAuthoritativeDuelRuntimeP4({ catalog, matchId: "p4-complete-source-controlled-fixture",
    roster: [
      { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    ], randomIndex: () => 0, uidFactory: () => `p4-controlled-${++uid}` });
}
function mulligan(runtime: Awaited<ReturnType<typeof owner>>["runtime"], commandId: string) {
  const projection = runtime.project(null);
  if (projection.match.stage !== "setup") throw Error("expected actual setup");
  const actor = projection.match.setup.currentMulliganOwner!;
  const packet: DuelCommandMessageV3Actions1 = { type: "duel-command",
    commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, requestId: `request-${commandId}`,
    commandId, expectedVersion: projection.match.stateVersion,
    command: { type: "mulligan", selectedUIDs: [] } };
  return { actor, packet, result: runtime.dispatch(actor, packet) };
}

describe("P4 owner unresolved production boundary", () => {
  // Full-suite load pushes the two-turn native-journal trace past the 10s
  // default; keep every assertion and give the runner clock 300s, matching
  // the other genuine two-turn P4 flows.
  it("uses the owned native journal and actual turn kernel for two consecutive Main turns", async () => {
    const runtime = await completeSourceOwner();
    mulligan(runtime, "m-1");
    expect(mulligan(runtime, "m-2").result.ack.ok).toBe(true);
    const first = runtime.project("alice");
    expect(first.match.stage).toBe("playing");
    if (first.match.stage !== "playing") throw Error("playing expected");
    expect(first.match.frame.phase).toBe("main");
    expect(first.match.frame.execution.status).toBe("ready");
    expect(first.match.resources.bases[0]!.baseRunes).toHaveLength(2);
    const end = first.actions.find(action => action.kind === "end-turn");
    if (!end || end.kind !== "end-turn") throw Error("real End action expected");
    expect(end.enabled).toBe(true);
    const packet: DuelCommandMessageV3Actions1 = { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: "end-request", commandId: "end-first-turn", expectedVersion: first.match.stateVersion,
      command: { type: "end-turn", windowId: end.windowId } };
    expect(runtime.dispatch("alice", packet).ack.ok).toBe(true);
    const second = runtime.project("bob");
    if (second.match.stage !== "playing") throw Error("playing expected");
    expect(second.match.frame.turnNumber).toBe(2);
    expect(second.match.frame.phase).toBe("main");
    expect(second.match.frame.execution.status).toBe("ready");
    expect(second.match.resources.bases[1]!.baseRunes).toHaveLength(3);
    const duplicate = runtime.dispatch("alice", packet);
    expect(duplicate.ack.duplicate).toBe(true);
    expect(runtime.project("bob").match).toEqual(second.match);
    expect(isDuelProjectionV3Actions1(second)).toBe(true);
  }, 300_000);
  it("publishes valid setup and playing P4 frames, keeps missing journal pending and hides private facts", async () => {
    const { runtime } = await owner();
    expect(isDuelProjectionV3Actions1(runtime.project("alice"))).toBe(true);
    expect(mulligan(runtime, "m-1").result.ack.ok).toBe(true);
    expect(mulligan(runtime, "m-2").result.ack.ok).toBe(true);
    for (const viewer of [null, "alice", "bob"]) {
      const projected = runtime.project(viewer);
      expect(isDuelProjectionV3Actions1(projected)).toBe(true);
      expect(projected.match.stage).toBe("playing");
      if (projected.match.stage !== "playing") throw Error("playing expected");
      expect(projected.match.frame.phase).toBe("awaiting-turn-start");
      expect(projected.match.frame.execution.status).toBe("pending");
      expect(projected.match.frame.chain).toEqual({ active: false });
      expect(projected.actions.every(action => !action.enabled)).toBe(true);
      const text = JSON.stringify(projected);
      for (const privateKey of ["physicalCardsByUID", "provenance", "tokenHistory", "sourceProofId", "requiredTasks", "receipts"])
        expect(text).not.toContain(`"${privateKey}"`);
    }
    expect(runtime.resumePending()?.ack.pending).toBe(true);
  });

  it("initializes the actual Unit/turn branch after two mulligans and retries its real pending continuation", async () => {
    const { runtime, reads } = await owner(true);
    mulligan(runtime, "m-1");
    const second = mulligan(runtime, "m-2");
    const before = runtime.project(null);
    expect(reads()).toBeGreaterThan(0);
    expect(second.result.ack.ok).toBe(true);
    const resumed = runtime.resumePending();
    expect(resumed?.ack.pending).toBe(true);
    expect(resumed?.projection.match).toEqual(before.match);
    const duplicate = runtime.dispatch(second.actor, second.packet);
    expect(duplicate.ack.ok).toBe(true);
    expect(duplicate.ack.duplicate).toBe(true);
    expect(duplicate.projection.match).toEqual(before.match);
  });

  it("does not let an external request reserve a generated turn command ID", async () => {
    const { runtime } = await owner();
    const before = runtime.project(null);
    if (before.match.stage !== "setup") throw Error("setup expected");
    const rejected = runtime.dispatch(before.match.setup.currentMulliganOwner!, {
      type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
      requestId: "reserved-request", commandId: "__p4-internal:start-turn:2", expectedVersion: 0,
      command: { type: "mulligan", selectedUIDs: [] },
    });
    expect(rejected.ack.type).toBe("error");
    expect(rejected.ack.message).toContain("保留");
    expect(runtime.project(null).match).toEqual(before.match);
    expect(mulligan(runtime, "m-normal").result.ack.ok).toBe(true);
  }, 300_000);
});
