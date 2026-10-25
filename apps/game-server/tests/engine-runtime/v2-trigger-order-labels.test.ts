import { describe, expect, it } from "vitest";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
} from "../../src/engine-runtime/index.js";

const WATCHER = "rift-1056:rift-watcher";

function triggered(name: string): CardProgram {
  return {
    canonicalCardId: WATCHER,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: `${name} has a real card-played trigger.`,
    abilities: [
      { kind: "play", cost: { energy: { kind: "constant", value: 0 } }, body: [] },
      { kind: "triggered", trigger: { at: "card-played", filter: { event: "card-played" } },
        optional: false, body: [] },
    ],
  };
}

function card(id: string, name: string, types: readonly string[], extra: Record<string, unknown> = {}) {
  return { id, cardId: id, canonicalCardId: id, name, types, tags: [], energy: null, power: null, might: null, ...extra };
}

function deck(seat: "A" | "B", name = "Rift Watcher"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 20 }, (_, index) => card(
      `${seat}:watcher:${index}`, name, ["unit"],
      { cardId: WATCHER, canonicalCardId: WATCHER, domains: ["Mind"], energy: 0, might: 2 },
    )),
    runeDeck: Array.from({ length: 12 }, (_, index) => card(
      `${seat}:rune:${index}`, "Mind Rune", ["rune"],
      { domains: ["Mind"], tags: ["Basic"], energy: null },
    )),
    championLegend: card(`${seat}:legend`, "Legend", ["legend"]),
    chosenChampion: card(`${seat}:champion`, "Champion", ["champion"]),
    battlefields: [0, 1, 2].map(index => card(`${seat}:field:${index}`, `Field ${index}`, ["battlefield"])) as
      unknown as EngineRuntimeDeck["battlefields"],
  };
}

function setup(name = "Rift Watcher"): EngineRuntime {
  return createEngineRuntime({
    matchId: "RIFT-1056-trigger-labels",
    roomId: "RIFT-1056-trigger-labels",
    decks: [deck("A", name), deck("B", name)],
    seed: "RIFT-1056-trigger-labels",
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    programs: [triggered("Rift Watcher")],
  }).start();
}

function hand(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function submit(runtime: EngineRuntime, playerId: string, command: V2Command) {
  return runtime.submit(playerId, command);
}

function play(runtime: EngineRuntime, commandId: string) {
  const view = runtime.projectFor("A");
  return submit(runtime, "A", {
    type: "play", commandId, stateVersion: view.stateVersion,
    cardObjectId: hand(view, "A")[0]!.objectId, destination: { kind: "base", playerId: "A" },
  });
}

function settle(runtime: EngineRuntime, prefix: string): void {
  for (let index = 0; index < 12; index += 1) {
    const view = runtime.projectFor(null);
    if (view.chain.items.length === 0) return;
    const actor = view.chain.priorityPlayerId;
    expect(actor).not.toBeNull();
    const receipt = submit(runtime, actor!, {
      type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: view.stateVersion,
    }).receipt;
    expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
  }
  throw new Error(`the real chain did not settle for ${prefix}`);
}

function triggerOrder(view: V2Projection) {
  const pending = view.pendingChoice;
  if (pending.status !== "pending" || pending.kind !== "mode") {
    throw new Error(`Expected trigger-order mode, received ${JSON.stringify(pending)}`);
  }
  return pending;
}

describe("RIFT-1056 V2 trigger-order labels", () => {
  it("labels real registered trigger sources while preserving the exact engine ids and values", () => {
    const runtime = setup();
    const first = play(runtime, "first-watcher");
    expect(first.receipt.status, JSON.stringify(first.receipt)).toBe("accepted");
    settle(runtime, "first-watcher");
    const second = play(runtime, "second-watcher");
    expect(second.receipt.status, JSON.stringify(second.receipt)).toBe("pending");
    const pending = triggerOrder(second.projection);
    expect(pending.options).toHaveLength(2);
    expect(pending.options?.map(option => option.label).sort()).toEqual([
      "Rift Watcher (trigger 1)", "Rift Watcher (trigger 2)",
    ]);
    expect(pending.options?.every(option => option.id === option.value && option.id.startsWith("program:"))).toBe(true);
    expect(JSON.stringify(pending)).not.toContain("Hidden card");
  }, 30_000);

  it("accepts the unchanged option value after projection without changing answer semantics", () => {
    const runtime = setup();
    const first = play(runtime, "fallback-first");
    expect(first.receipt.status, JSON.stringify(first.receipt)).toBe("accepted");
    settle(runtime, "fallback-first");
    const second = play(runtime, "fallback-second");
    expect(second.receipt.status, JSON.stringify(second.receipt)).toBe("pending");
    const pending = triggerOrder(second.projection);
    expect(pending.options?.every(option => option.id === option.value)).toBe(true);
    expect(pending.options?.map(option => option.label).sort()).toEqual([
      "Rift Watcher (trigger 1)", "Rift Watcher (trigger 2)",
    ]);
    const exact = pending.options![0]!;
    const selected = submit(runtime, "A", {
      type: "choose", commandId: "choose-first-trigger", stateVersion: second.projection.stateVersion,
      choiceId: pending.choiceId, answer: exact.value!,
    });
    expect(selected.receipt.status, JSON.stringify(selected.receipt)).toBe("accepted");
    expect(selected.projection.pendingChoice).toEqual({ status: "none" });
  }, 30_000);

  it("falls back to each raw engine id when a trigger source has no readable name", () => {
    const runtime = setup("");
    expect(play(runtime, "unnamed-first").receipt.status).toBe("accepted");
    settle(runtime, "unnamed-first");
    const second = play(runtime, "unnamed-second");
    expect(second.receipt.status, JSON.stringify(second.receipt)).toBe("pending");
    const pending = triggerOrder(second.projection);
    expect(pending.options?.length).toBe(2);
    expect(pending.options?.every(option => option.label === option.id && option.id === option.value)).toBe(true);
  }, 30_000);
});
