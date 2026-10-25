import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import { PROTOCOL_V2_PROJECTION_CONTRACT, PROTOCOL_V2_VERSION, isV2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

type M1DeckId = "rumble-sfd" | "fiora-sfd";
const FIORA_WORTHY = "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f";
const DAUNTLESS_VANGUARD = "card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f";
const PUNCH_FIRST = "card.hash-8d49727ab9ae782b8a21802c9ae0b51e5d712a37a072d991629bfbf3645535b3";

const m1 = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
  readonly candidates: readonly {
    readonly id: M1DeckId;
    readonly chosenChampion: string;
    readonly recommendedCardList: readonly {
      readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
      readonly canonicalCardId: string;
      readonly name: string;
      readonly quantity: number;
      readonly cardType: string;
      readonly domains: readonly string[];
    }[];
  }[];
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
const printings = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));
const domains = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
let serial = 0;

function deck(id: M1DeckId, seat: "A" | "B"): EngineRuntimeDeck {
  const candidate = m1.candidates.find(value => value.id === id)!;
  const expand = (zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes") =>
    candidate.recommendedCardList.filter(entry => entry.zone === zone).flatMap(entry =>
      Array.from({ length: entry.quantity }, () => {
        const printed = printings.get(entry.canonicalCardId);
        if (!printed) throw new Error(`Missing M1 catalog card ${entry.canonicalCardId}`);
        const allowed = printed.domains.filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" =>
          domains.has(domain));
        return {
          id: `${seat}:${zone}:${serial++}:${entry.canonicalCardId}`,
          cardId: entry.canonicalCardId,
          canonicalCardId: entry.canonicalCardId,
          name: entry.name,
          types: [printed.cardType.toLowerCase()],
          tags: [...printed.tags],
          energy: zone === "runes" ? null : printed.energy,
          power: zone === "runes" || printed.power === null ? null : allowed,
          might: printed.might,
          domains: allowed,
        };
      }));
  const mainDeck = expand("mainDeck");
  const chosen = candidate.recommendedCardList.find(entry => entry.zone === "champion" && entry.name === candidate.chosenChampion)!;
  const chosenIndex = mainDeck.findIndex(card => card.cardId === chosen.canonicalCardId);
  if (chosenIndex >= 0) mainDeck.splice(chosenIndex, 1);
  return {
    mainDeck,
    runeDeck: expand("runes"),
    championLegend: expand("legend")[0]!,
    chosenChampion: expand("champion")[0]!,
    battlefields: expand("battlefields") as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function programs(decks: readonly EngineRuntimeDeck[]): readonly CardProgram[] {
  const entries = decks.flatMap(value => [
    ...value.mainDeck, ...value.runeDeck, value.championLegend, value.chosenChampion, ...value.battlefields,
  ]).flatMap(card => card.cardId === null || card.cardId === undefined
    ? [] : [cardProgramsById.get(card.cardId)]).filter((program): program is CardProgram => program !== undefined);
  return [...new Map(entries.map(program => [program.canonicalCardId, program])).values()];
}

function choicePrograms(): readonly CardProgram[] {
  return [FIORA_WORTHY, DAUNTLESS_VANGUARD, PUNCH_FIRST].flatMap(cardId => {
    const program = cardProgramsById.get(cardId);
    return program === undefined ? [] : [program];
  });
}

function setup(seed = "m1-choice-source-1", battlefieldChoice: readonly [number | undefined, number | undefined] = [2, 2]): EngineRuntime {
  serial = 0;
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return createEngineRuntime({
    matchId: "rift-1069-choice-source",
    roomId: "rift-1069-choice-source",
    decks,
    seed,
    firstPlayer: "A",
    battlefieldChoice,
    programs: programs(decks),
  }).start();
}

function choiceRuntime(seed = "m1-choice-557"): EngineRuntime {
  serial = 0;
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  // Match setup applies one deterministic shuffle to each deck. This seed
  // leaves Fiora, Worthy and Punch First in B's opening hand while Dauntless
  // Vanguard remains a real M1 deck card for a later draw. No card or trigger
  // is inserted after setup.
  return createEngineRuntime({
    matchId: "rift-1069-choice-source", roomId: "rift-1069-choice-source",
    decks, seed, firstPlayer: "A", battlefieldChoice: [1, 2],
    programs: choicePrograms(),
  }).start();
}

describe("RIFT-1069 V2 choice source", () => {
  it("keeps legacy projections valid and accepts only bounded chooser metadata", () => {
    const runtime = setup();
    const legacy = runtime.projectFor("A");
    expect(isV2Projection(legacy)).toBe(true);
    expect(legacy.projectionContract).toBe(PROTOCOL_V2_PROJECTION_CONTRACT);
    expect(legacy.protocolVersion).toBe(PROTOCOL_V2_VERSION);

    const choice = {
      status: "pending" as const, choiceId: "finalize:trigger:1:optional", ownerPlayerId: "A",
      stateVersion: legacy.stateVersion, kind: "optional" as const,
      prompt: "Pay 1 Order Power to ready the unit that became Mighty?",
      source: { objectId: "source-1", name: "Fiora, Worthy" },
    };
    expect(isV2Projection({ ...legacy, pendingChoice: choice })).toBe(true);
    for (const metadata of [
      { prompt: "" }, { prompt: " padded" }, { prompt: "x".repeat(513) }, { prompt: 7 },
      { source: {} }, { source: null }, { source: [] }, { source: { objectId: "" } },
      { source: { objectId: "source-1 " } }, { source: { name: "x".repeat(513) } },
      { source: { name: 7 } }, { source: { objectId: "source-1", extra: true } },
    ]) {
      expect(isV2Projection({ ...legacy, pendingChoice: { ...choice, ...metadata } }), JSON.stringify(metadata)).toBe(false);
    }
    expect(isV2Projection({ ...legacy, viewerPlayerId: "B", pendingChoice: choice })).toBe(false);
  });

  it("keeps the canonical M1 trigger bound by the existing lifecycle", () => {
    const runtime = setup();
    const internal = runtime as unknown as {
      readonly binding: { readonly registry: { inspect(cardId: string): CardProgram | undefined } };
    };
    const program = internal.binding.registry.inspect(FIORA_WORTHY);
    expect(program).toMatchObject({ canonicalCardId: FIORA_WORTHY, status: "executable", rulesetVersion: "core-1.5" });
    expect(program?.abilities[0]).toMatchObject({ kind: "triggered", trigger: { at: "might-changed" }, optional: false });
  });

  it("projects a real M1 optional Finalize source and prompt to its chooser only", () => {
    const runtime = choiceRuntime("seed-445");
    let advanceSerial = 0;
    const finishByAdvancing = (expected: "B" | "A", greatestTurn: number) => {
      for (let guard = 0; guard < 24; guard += 1) {
        const view = runtime.projectFor(null);
        if (view.activePlayerId === expected && view.phase === "main" && view.turnNumber >= greatestTurn &&
            view.chain.items.length === 0) return;
        if (view.chain.items.length > 0) {
          const actor = view.chain.priorityPlayerId ?? view.priority.playerId;
          if (actor !== null) {
            const passed = runtime.submit(actor, { type: "pass", commandId: `advance-chain:${advanceSerial++}`, stateVersion: view.stateVersion });
            expect(["accepted", "pending"], JSON.stringify(passed.receipt)).toContain(passed.receipt.status);
            continue;
          }
        }
        const ended = runtime.submit(view.activePlayerId, { type: "end-turn", commandId: `advance-turn:${advanceSerial++}`, stateVersion: view.stateVersion });
        expect(ended.receipt.status, JSON.stringify(ended.receipt)).toBe("accepted");
      }
      throw new Error(`Could not advance to ${expected}'s Main after turn ${greatestTurn}`);
    };
    const cards = (playerId: "A" | "B", name: string) =>
      runtime.projectFor(playerId).zones.flatMap(zone => zone.objects ?? []).filter(object => object.name === name);
    const submit = (playerId: "A" | "B", command: V2Command) => runtime.submit(playerId, command);
    const end = (commandId: string) => {
      const view = runtime.projectFor(null);
      const result = submit(view.activePlayerId, { type: "end-turn", commandId, stateVersion: view.stateVersion });
      expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    };
    const play = (name: string, commandId: string) => {
      const card = cards("B", name).find(object => object.zone === "hand")!;
      const result = submit("B", { type: "play", commandId, stateVersion: runtime.projectFor("B").stateVersion,
        cardObjectId: card.objectId, destination: { kind: "base", playerId: "B" } });
      expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    };
    let settleSerial = 0;
    const passUntilChoiceOrSettled = (prefix: string) => {
      for (let index = 0; index < 128; index += 1) {
        const view = runtime.projectFor(null);
        if (view.pendingChoice.status === "pending" || view.chain.items.length === 0) return;
        const actor = view.chain.priorityPlayerId ?? view.priority.playerId;
        expect(actor).not.toBeNull();
        const result = submit(actor!, { type: "pass", commandId: `${prefix}:${settleSerial++}`, stateVersion: view.stateVersion });
        expect(["accepted", "pending"], JSON.stringify(result.receipt)).toContain(result.receipt.status);
      }
      throw new Error(`Chain did not settle for ${prefix}`);
    };

    finishByAdvancing("B", 2);
    expect(cards("B", "Fiora, Worthy")).toHaveLength(1);
    expect(cards("B", "Punch First")).toHaveLength(1);
    expect(cards("B", "Dauntless Vanguard")).toHaveLength(1);
    const fundAll = (prefix: string) => {
      const runes = (runtime.projectFor("B").zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "B")?.objects ?? [])
        .filter(candidate => candidate.exhausted === false);
      for (const [index, rune] of runes.entries()) {
        const result = submit("B", { type: "rune-energy", commandId: `${prefix}:${index}`, stateVersion: runtime.projectFor("B").stateVersion,
          runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId! });
        expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
      }
      return runes;
    };
    fundAll("fiora:energy");
    play("Fiora, Worthy", "play-fiora");
    passUntilChoiceOrSettled("settle-fiora");
    finishByAdvancing("B", 4);
    let vanguardRunes = fundAll("vanguard:energy");
    if (vanguardRunes.length < 4) {
      finishByAdvancing("B", runtime.projectFor(null).turnNumber + 2);
      vanguardRunes = fundAll("vanguard:energy:next");
    }
    const powerRune = vanguardRunes.find(rune => rune.name === "Body Rune")!;
    expect(powerRune).toBeDefined();
    const powerResult = submit("B", { type: "rune-power", commandId: "vanguard:power", stateVersion: runtime.projectFor("B").stateVersion,
      runeObjectId: powerRune.objectId, zoneEntryId: powerRune.zoneEntryId! });
    expect(powerResult.receipt.status, JSON.stringify(powerResult.receipt)).toBe("accepted");
    // Fund four of the next round's Runes; their identities are verified by
    // the real V2 play options below, not synthesized into the host state.
    play("Dauntless Vanguard", "play-dauntless");
    passUntilChoiceOrSettled("settle-dauntless");
    finishByAdvancing("B", runtime.projectFor(null).turnNumber + 2);
    const punchRunes = fundAll("punch:energy");
    const bodyRune = punchRunes.find(rune => rune.name === "Body Rune")!;
    expect(bodyRune).toBeDefined();
    for (const [index, rune] of punchRunes.filter(rune => rune.name === "Body Rune" && rune !== bodyRune).slice(0, 2).entries()) {
      const result = submit("B", { type: "rune-power", commandId: `punch:power:${index}`, stateVersion: runtime.projectFor("B").stateVersion,
        runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId! });
      expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
    }
    const punch = cards("B", "Punch First").find(object => object.zone === "hand")!;
    expect(punch).toBeDefined();
    const punchPlay = runtime.projectFor("B").actionOptions.plays.find(option => option.cardObjectId === punch.objectId)!;
    const playedPunch = submit("B", { type: "play", commandId: "play-punch-first", stateVersion: runtime.projectFor("B").stateVersion,
      cardObjectId: punch.objectId, destination: punchPlay.destination });
    expect(playedPunch.receipt.status, JSON.stringify(playedPunch.receipt)).toBe("accepted");
    passUntilChoiceOrSettled("settle-punch");
    const targetChoice = runtime.projectFor("B").pendingChoice;
    expect(targetChoice).toMatchObject({ status: "pending", kind: "select-objects", ownerPlayerId: "B" });
    if (targetChoice.status !== "pending") throw new Error("Punch First target choice missing");
    expect(targetChoice.source).toMatchObject({ name: "Punch First" });
    const vanguard = cards("B", "Dauntless Vanguard").find(object => object.zone === "board")!;
    const option = targetChoice.options?.find(candidate => candidate.objectRef?.objectId === vanguard.objectId);
    expect(option).toBeDefined();
    const chosen = submit("B", { type: "choose", commandId: "choose-punch", stateVersion: runtime.projectFor("B").stateVersion,
      choiceId: targetChoice.choiceId, answer: [option!.objectRef!] });
    expect(chosen.receipt.status, JSON.stringify(chosen.receipt)).toBe("accepted");
    passUntilChoiceOrSettled("settle-punch-finalize");
    const owner = runtime.projectFor("B").pendingChoice;
    expect(owner).toMatchObject({ status: "pending", kind: "optional", ownerPlayerId: "B",
      source: { objectId: cards("B", "Fiora, Worthy").find(object => object.zone === "board")?.objectId, name: "Fiora, Worthy" },
      prompt: "Pay 1 Order Power to ready the unit that became Mighty?" });
    expect(isV2Projection(runtime.projectFor("B"))).toBe(true);
    const opponent = runtime.projectFor("A").pendingChoice;
    expect(opponent).toMatchObject({ status: "pending", kind: "optional", ownerPlayerId: "B" });
    expect(opponent).not.toHaveProperty("source");
    expect(opponent).not.toHaveProperty("prompt");
  }, 120_000);
});
