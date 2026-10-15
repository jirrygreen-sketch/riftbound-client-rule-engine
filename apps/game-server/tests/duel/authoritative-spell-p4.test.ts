import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createAuthoritativeDuelRuntimeP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";
import { spellFirstSetupDeck } from "./fixtures/spell-first-setup-deck.js";

export async function owner() {
  const cards = setupAdapterFixtureCatalog.cards.map(card => ({ ...card,
    ability: card.cardType === "Unit" ? "" : card.cardType === "Spell" ? "Draw 4." : card.ability }));
  const catalog = await loadCardCatalogRuntime({ catalog: { ...setupAdapterFixtureCatalog, cards,
    dataVersion: "2026-10-12-official-gallery",
    digest: "sha256:53b974c8472d82053bf61f6836842c8f0d62c2fafb4411fa502256912a504d10" } });
  let uid = 0;
  return createAuthoritativeDuelRuntimeP4({ catalog, matchId: "p4-authoritative-spell-fixture",
    roster: [
      { playerId: "alice", displayName: "Alice", deck: spellFirstSetupDeck },
      { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
    ], randomIndex: () => 0, uidFactory: () => `p4-authoritative-spell-${++uid}` });
}

export function packet(runtime: ReturnType<typeof createAuthoritativeDuelRuntimeP4>, actor: string,
  commandId: string, command: DuelCommandMessageV3Actions1["command"]): DuelCommandMessageV3Actions1 {
  const projection = runtime.project(actor);
  return { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
    requestId: `${commandId}-request`, commandId, expectedVersion: projection.match.stateVersion, command };
}

export function mulligan(runtime: ReturnType<typeof createAuthoritativeDuelRuntimeP4>, id: string) {
  const projection = runtime.project(null);
  if (projection.match.stage !== "setup") throw new Error("setup expected");
  const actor = projection.match.setup.currentMulliganOwner!;
  return runtime.dispatch(actor, packet(runtime, actor, id, { type: "mulligan", selectedUIDs: [] }));
}

describe("P4 authoritative Spell owner", () => {
  it("plays a genuine Draw Spell through payment, both priority passes, Chain resolution and retirement", async () => {
    const runtime = await owner();
    expect(mulligan(runtime, "spell-m-1").ack.ok).toBe(true);
    expect(mulligan(runtime, "spell-m-2").ack.ok).toBe(true);
    let before = runtime.project("alice");
    for (let turn = 0; turn < 12 && (!before.actions.some(action => action.kind === "play-card" && action.label === "施放法术")); turn++) {
      if (before.match.stage !== "playing") throw new Error("playing expected");
      const actor = before.match.frame.turnPlayerId;
      const view = runtime.project(actor);
      const end = view.actions.find(action => action.kind === "end-turn");
      if (!end || end.kind !== "end-turn") throw new Error("real End action required while locating Spell");
      expect(runtime.dispatch(actor, packet(runtime, actor, `locate-end-${turn}`, {
        type: "end-turn", windowId: end.windowId,
      })).ack.ok).toBe(true);
      before = runtime.project("alice");
    }
    if (before.match.stage !== "playing") throw new Error("playing expected");
    const energy = before.actions.find(action => action.kind === "rune-energy" && action.enabled);
    if (energy && energy.kind === "rune-energy") {
      const actor = before.match.frame.turnPlayerId;
      expect(runtime.dispatch(actor, packet(runtime, actor, "spell-energy", { type: "rune-energy", uid: energy.uid })).ack.ok).toBe(true);
      before = runtime.project("alice");
    }
    const spell = before.actions.find(action => action.kind === "play-card" && action.label === "施放法术");
    if (!spell || spell.kind !== "play-card") throw new Error("Draw Spell was not dealt into the real Hand");
    const played = runtime.dispatch("alice", { ...packet(runtime, "alice", "spell-play", {
      type: "play-card", cardUID: spell.cardUID, windowId: spell.windowId,
    }) });
    expect(played.ack.type).toBe("blocked");
    expect(played.projection.match.stage).toBe("playing");
    if (played.projection.match.stage !== "playing") throw new Error("playing expected");
    expect(played.projection.match.frame.chain.active).toBe(true);
    const payment = runtime.project("alice").actions.find(action => action.kind === "pay-pending");
    if (!payment || payment.kind !== "pay-pending") throw new Error("real Spell payment was not projected");
    const paid = runtime.dispatch("alice", packet(runtime, "alice", "spell-pay", {
      type: "pay-pending", paymentId: payment.paymentId,
    }));
    expect(paid.ack.type).toBe("request-result");
    const first = runtime.project("alice");
    const passA = first.actions.find(action => action.kind === "pass-priority");
    if (!passA || passA.kind !== "pass-priority") throw new Error("first real Chain priority was not projected");
    const firstPassed = runtime.dispatch("alice", packet(runtime, "alice", "spell-pass-a", {
      type: "pass-priority", windowId: passA.windowId,
    }));
    expect(firstPassed.ack.ok).toBe(true);
    const passB = runtime.project("bob").actions.find(action => action.kind === "pass-priority");
    if (!passB || passB.kind !== "pass-priority") throw new Error("second real Chain priority was not projected");
    const resolved = runtime.dispatch("bob", packet(runtime, "bob", "spell-pass-b", {
      type: "pass-priority", windowId: passB.windowId,
    }));
    expect(resolved.ack.ok).toBe(true);
    expect(resolved.projection.match.stage).toBe("playing");
    if (resolved.projection.match.stage !== "playing") throw new Error("playing expected");
    expect(resolved.projection.match.frame.chain).toEqual({ active: false });
    expect(resolved.projection.match.frame.pendingPayment).toBeNull();
    expect(JSON.stringify(resolved.projection)).not.toContain("private");
  }, 30_000);
});
