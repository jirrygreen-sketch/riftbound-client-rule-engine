import { describe, expect, it } from "vitest";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
  type EngineRuntimeOptions,
} from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";

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

function runtimeOptions(
  overrides: Omit<EngineRuntimeOptions, "matchId" | "roomId" | "decks" | "seed"> = {},
): EngineRuntimeOptions {
  const decks = [deck("A"), deck("B")] as const;
  return {
    matchId: "RIFT-1085-perf-b-host-clone", roomId: "RIFT-1085-perf-b-host-clone",
    decks, seed: "RIFT-1085-perf-b-host-clone", firstPlayer: "A", battlefieldChoice: [0, 0],
    ...overrides,
  };
}

function setup(overrides: Omit<EngineRuntimeOptions, "matchId" | "roomId" | "decks" | "seed"> = {}): EngineRuntime {
  return createEngineRuntime(runtimeOptions(overrides)).start();
}

function endTurn(runtime: EngineRuntime, commandId: string): V2Projection {
  const view = runtime.projectFor(null);
  const result: ReturnType<EngineRuntime["submit"]> = runtime.submit(view.activePlayerId, {
    type: "end-turn", commandId, stateVersion: view.stateVersion,
  });
  expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  return result.projection;
}

describe("RIFT-1085 host checkpoint copies", () => {
  it("keeps nested checkpoint containers isolated through mutation and restore", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
    const ref = host.addCard("A", {
      id: "checkpoint-unit", cardId: "checkpoint-unit-card", name: "Checkpoint Unit",
      types: ["unit"], tags: ["First"], keywords: [{ id: "Tank" }], domains: ["Mind"],
    }, "board");
    expect(host.perform({ type: "add-counter", object: ref, counter: "charge", amount: 1 }).status).toBe("done");
    expect(host.perform({ type: "gain-power", player: "A", power: ["Mind", "universal"] }).status).toBe("done");
    expect(host.perform({ type: "reveal", object: ref, viewers: ["A"] }).status).toBe("done");
    const before = structuredClone(host.checkpoint());

    expect(host.perform({ type: "add-counter", object: ref, counter: "charge", amount: 2 }).status).toBe("done");
    expect(host.perform({ type: "gain-power", player: "A", power: ["Calm"] }).status).toBe("done");
    expect(host.perform({ type: "look", player: "B", objects: [ref] }).status).toBe("done");
    host.restore(before);

    expect(host.object(ref)).toMatchObject({ counters: { charge: 1 }, tags: ["First"] });
    expect(host.player("A").power).toEqual(["Mind", "universal"]);
    expect(host.visibility()).toEqual([expect.objectContaining({ kind: "reveal", viewers: ["A"] })]);

    const restored = host.checkpoint();
    restored.objects[0]!.counters.charge = 99;
    restored.objects[0]!.tags = ["Mutated"];
    restored.players[0]!.power.push("Chaos");
    (restored.visibility[0]!.viewers as string[]).push("B");
    expect(host.object(ref)).toMatchObject({ counters: { charge: 1 }, tags: ["First"] });
    expect(host.player("A").power).toEqual(["Mind", "universal"]);
    expect(host.visibility()[0]!.viewers).toEqual(["A"]);
    expect(host.checkpoint()).toEqual(before);
  });

  it("restores a failed command through nested checkpoints without sharing mutable state", () => {
    let executions = 0;
    const options = runtimeOptions({ afterCommandExecution: command => {
      if (command.commandId === "RIFT-1085-nested-failure" && ++executions === 1) {
        throw new Error("RIFT-1085 late failure");
      }
    } });
    const runtime = createEngineRuntime(options).start();
    for (let index = 0; index < 3; index += 1) endTurn(runtime, `RIFT-1085-before-failure-${index}`);
    const before = runtime.projectFor(null);
    const journalBefore = runtime.journal();
    const command: V2Command = {
      type: "end-turn", commandId: "RIFT-1085-nested-failure", stateVersion: before.stateVersion,
    };

    const failed = runtime.submit(before.activePlayerId, command);
    expect(failed.receipt).toMatchObject({ status: "rejected", error: "RIFT-1085 late failure" });
    expect(runtime.projectFor(null)).toEqual(before);
    expect(runtime.journal()).toEqual(journalBefore);
    const retried = runtime.submit(before.activePlayerId, command);
    expect(retried.receipt.status, JSON.stringify(retried.receipt)).toBe("accepted");
    expect(executions).toBe(2);
    expect(createEngineRuntime(options).restore(runtime.journal()).projectFor(null)).toEqual(runtime.projectFor(null));
  }, 120_000);

  it("retains complete duplicate payload validation and journal replay", () => {
    const decks = [deck("A"), deck("B")] as const;
    const options = runtimeOptions({ decks });
    const runtime = createEngineRuntime(options).start();
    const endTurnView = runtime.projectFor(null);
    const endTurnCommand = {
      type: "end-turn" as const, commandId: "RIFT-1085-complete-payload", stateVersion: endTurnView.stateVersion,
    };
    expect(runtime.submit(endTurnView.activePlayerId, endTurnCommand).receipt.status).toBe("accepted");
    const conflict = runtime.submit(endTurnView.activePlayerId, {
      ...endTurnCommand, stateVersion: endTurnCommand.stateVersion + 1,
    });
    expect(conflict.receipt.status).toBe("rejected");
    expect(runtime.journal().entries.at(-1)?.command).toEqual(endTurnCommand);

    const stale = runtime.submit(endTurnView.activePlayerId, {
      type: "end-turn", commandId: "RIFT-1085-stale", stateVersion: endTurnView.stateVersion,
    });
    expect(stale.receipt.status).toBe("rejected");
    expect(runtime.journal().entries.some(entry => entry.commandId === "RIFT-1085-stale")).toBe(false);
    expect(createEngineRuntime(options).restore(runtime.journal()).journal()).toEqual(runtime.journal());
  }, 120_000);

  it("rotates the deep-frozen object view at each write while retaining old generations", () => {
    const host = new EngineRuntimeHost({ A: "A", B: "B" }, () => { throw new Error("unexpected choice"); });
    const ref = host.addCard("A", {
      id: "view-unit", cardId: "view-unit-card", name: "View Unit", types: ["unit"], tags: ["Frozen"],
    }, "board");
    const first = host.objects();
    expect(host.objects()).toBe(first);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0]!.tags)).toBe(true);
    expect(() => (first[0]!.tags as string[]).push("Mutated")).toThrow(TypeError);

    expect(host.perform({ type: "stun", object: ref }).status).toBe("done");
    const second = host.objects();
    expect(second).not.toBe(first);
    expect(second[0]?.stunned).toBe(true);
    expect(first[0]?.stunned).toBe(false);
    expect(host.object(ref)?.stunned).toBe(true);
  });
});
