import { describe, expect, it } from "vitest";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
  type EngineRuntimeOptions,
} from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";

function deck(seat: "A" | "B"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 32 }, (_, index) => ({
      id: `${seat}:unit:${index}`, cardId: `${seat}:unit-card`, name: `${seat} Unit`,
      types: ["unit"], energy: 0, power: null, might: 3,
    })),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:rune:${index}`, cardId: `${seat}:rune-card`, name: "Mind Rune",
      types: ["rune"], tags: ["Basic"], energy: null, power: null, domains: ["Mind"],
    })),
    championLegend: { id: `${seat}:legend`, cardId: `${seat}:legend-card`, name: "Legend", types: ["legend"] },
    chosenChampion: { id: `${seat}:champion`, cardId: `${seat}:champion-card`, name: "Champion", types: ["champion"] },
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `${seat}:field-card:${index}`,
      name: `Field ${index}`, types: ["battlefield"],
    })) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function runtimeOptions(overrides: Omit<EngineRuntimeOptions, "matchId" | "roomId" | "decks" | "seed" | "programs"> = {}): EngineRuntimeOptions {
  const decks = [deck("A"), deck("B")] as const;
  return {
    matchId: "RIFT-1014-command-rollback-perf", roomId: "RIFT-1014-command-rollback-perf",
    decks, seed: "RIFT-1014-command-rollback-perf", firstPlayer: "A",
    battlefieldChoice: [0, 0], ...overrides,
  };
}

function setup(overrides: Omit<EngineRuntimeOptions, "matchId" | "roomId" | "decks" | "seed" | "programs"> = {}): EngineRuntime {
  return createEngineRuntime(runtimeOptions(overrides)).start();
}

function endTurn(runtime: EngineRuntime, id: string): V2Projection {
  const view = runtime.projectFor(null);
  // CR v1.5 304-305: TurnFlow applies the projected Turn Player's real
  // `end-turn`; this test does not synthesize a turn or edit a cursor.
  const result = runtime.submit(view.activePlayerId, { type: "end-turn", commandId: id, stateVersion: view.stateVersion });
  expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  return result.projection;
}

function progress(runtime: EngineRuntime, turns: number): void {
  for (let index = 0; index < turns; index += 1) endTurn(runtime, `RIFT-1014-turn-${index}`);
}

describe("RIFT-1014 rejected-command rollback and host object cache", () => {
  it("rejects after a long journal without replaying or changing public state", () => {
    let restores = 0;
    const options = runtimeOptions();
    const runtime = createEngineRuntime(options).start();
    const originalRestore = runtime.restore.bind(runtime);
    runtime.restore = journal => { restores += 1; return originalRestore(journal); };
    progress(runtime, 20);
    const before = runtime.projectFor(null);
    const journalBefore = runtime.journal();
    // The projected Advance is limited to the responsible Turn Player after a
    // Combat Showdown closes. This normal Main phase therefore exercises a
    // real fail-closed rejection without any write.
    const rejected = runtime.submit("A", {
      type: "advance", commandId: "RIFT-1014-illegal-advance", stateVersion: before.stateVersion,
    });
    expect(rejected.receipt).toMatchObject({ status: "rejected", stateVersion: before.stateVersion });
    expect(rejected.projection).toEqual(runtime.projectFor(before.activePlayerId));
    expect(runtime.projectFor(null)).toEqual(before);
    expect(runtime.journal()).toEqual(journalBefore);
    expect(restores).toBe(0);
    const replayed = createEngineRuntime(options).restore(journalBefore);
    expect(replayed.projectFor(null)).toEqual(before);
    expect(replayed.journal()).toEqual(journalBefore);
    // Every accepted entry replays through the same Command path, while the
    // subsequent rejection above did not invoke restore() at all.
    expect(journalBefore.entries.length).toBeGreaterThanOrEqual(20);
    expect(Array.from({ length: journalBefore.entries.length }, (_, seq) => seq + 1)).toEqual(
      journalBefore.entries.map(entry => entry.seq),
    );
  }, 240_000);

  it("restores a mutation failure in place and retries the same command without replay", () => {
    let executions = 0;
    const runtime = setup({ afterCommandExecution: command => {
      if (command.type === "end-turn" && ++executions === 1) throw new Error("RIFT-1014 late failure");
    } });
    const before = runtime.projectFor(null);
    const journalBefore = runtime.journal();
    const command = { type: "end-turn" as const, commandId: "RIFT-1014-late-failure", stateVersion: before.stateVersion };
    const failed = runtime.submit(before.activePlayerId, command);
    expect(failed.receipt).toMatchObject({ status: "rejected", error: "RIFT-1014 late failure" });
    expect(runtime.projectFor(null)).toEqual(before);
    expect(runtime.journal()).toEqual(journalBefore);
    const retried = runtime.submit(before.activePlayerId, command);
    expect(retried.receipt.status, JSON.stringify(retried.receipt)).toBe("accepted");
    expect(executions).toBe(2);
  }, 120_000);

  it("serves one deep-frozen host object view per write generation", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
    const ref = host.addCard("A", {
      id: "A:cached", cardId: "cached", name: "Cached", types: ["unit"], tags: ["Tag"],
    }, "board");
    const first = host.objects();
    expect(host.objects()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0]!.types)).toBe(true);
    expect(() => (first[0]!.types as string[]).push("forged")).toThrow(TypeError);
    expect(host.object(ref)?.types).toEqual(["unit"]);
    expect(host.perform({ type: "exhaust", object: ref }).status).toBe("done");
    const second = host.objects();
    expect(second).not.toBe(first);
    expect(second[0]?.exhausted).toBe(true);
    const checkpoint = host.checkpoint();
    host.restore(checkpoint);
    expect(host.objects()).not.toBe(second);
  });
});
