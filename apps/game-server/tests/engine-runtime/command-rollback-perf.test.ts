import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
  type EngineRuntimeOptions,
} from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import type { M1PreconId } from "../../../../packages/integration-tests/src/headless/decks.js";

interface M1Card {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly quantity: number;
}

function deck(id: M1PreconId, seat: "A" | "B"): EngineRuntimeDeck {
  const m1 = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
    readonly candidates: readonly { readonly id: string; readonly recommendedCardList: readonly M1Card[] }[];
  };
  const catalog = JSON.parse(readFileSync(new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8")) as {
    readonly cards: readonly {
      readonly canonicalCardId: string;
      readonly name: string;
      readonly cardType: string;
      readonly domains: readonly string[];
      readonly tags: readonly string[];
      readonly energy: number | null;
      readonly power: number | null;
      readonly might: number | null;
    }[];
  };
  const candidate = m1.candidates.find(value => value.id === id)!;
  const printings = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));
  const validDomains = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
  const expand = (zone: M1Card["zone"]) => candidate.recommendedCardList
    .filter(entry => entry.zone === zone)
    .flatMap(entry => Array.from({ length: entry.quantity }, (_, index) => {
      const printed = printings.get(entry.canonicalCardId);
      if (!printed) throw new Error(`Missing M1 catalog card ${entry.canonicalCardId}`);
      const domains = printed.domains.filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" =>
        validDomains.has(domain));
      return {
        id: `${seat}:${zone}:${index}:${printed.canonicalCardId}`,
        cardId: printed.canonicalCardId,
        name: printed.name,
        types: [printed.cardType.toLowerCase()],
        tags: [...printed.tags],
        energy: zone === "runes" ? null : printed.energy,
        power: zone === "runes" || printed.power === null ? null : domains,
        might: printed.might,
        domains,
      };
    }));
  return {
    mainDeck: expand("mainDeck"),
    runeDeck: expand("runes"),
    championLegend: expand("legend")[0]!,
    chosenChampion: expand("champion")[0]!,
    battlefields: expand("battlefields") as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function programs(decks: readonly EngineRuntimeDeck[]): readonly CardProgram[] {
  const entries = decks.flatMap(value => [...value.mainDeck, ...value.runeDeck,
    value.championLegend, value.chosenChampion, ...value.battlefields]).flatMap(card => {
    const program = card.cardId === null || card.cardId === undefined ? undefined : cardProgramsById.get(card.cardId);
    return program === undefined ? [] : [program as unknown as CardProgram];
  });
  return [...new Map(entries.map(program => [program.canonicalCardId, program])).values()];
}

function runtimeOptions(overrides: Omit<EngineRuntimeOptions, "matchId" | "roomId" | "decks" | "seed" | "programs"> = {}): EngineRuntimeOptions {
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return {
    matchId: "RIFT-1014-command-rollback-perf", roomId: "RIFT-1014-command-rollback-perf",
    decks, seed: "RIFT-1014-command-rollback-perf", firstPlayer: "A",
    battlefieldChoice: [0, 0], programs: programs(decks), ...overrides,
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
  it("rejects after a long match without replaying the journal or changing public state", () => {
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
    expect(journalBefore.entries.length).toBeGreaterThanOrEqual(20);
    expect(restores).toBe(0);
    const replayed = createEngineRuntime(options).restore(journalBefore);
    expect(replayed.projectFor(null)).toEqual(before);
    expect(replayed.journal()).toEqual(journalBefore);
  }, 120_000);

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
