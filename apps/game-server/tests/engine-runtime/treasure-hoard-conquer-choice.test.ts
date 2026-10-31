import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2PendingChoice, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck } from "../../src/engine-runtime/index.js";

// Official evidence used by every scenario below:
// Treasure Hoard, SFD-220/221:
// "When you conquer here, you may pay :rb_energy_1: to play a Gold gear token exhausted."
// Riftbound Core Rules v1.5, published 2026-10-09, effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// CR 383.3.a/.d: a leading "may" is decided during Finalize; one controller
// simultaneously ordering their triggered abilities chooses their Chain order.
// CR 405.1/.2: an accepted cost is paid then; declining a Triggered Ability's
// incurred cost removes it without resolution. CR 303.2.a is the turn-order
// rule when multiple players, rather than one controller, order triggers.
// canonicalCardId: card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564.
const CANONICAL = "card.hash-77763eae5320de558954776a37677e8638b6d4af73399e5a7c4f5d5321a2b564";
const PORO = "card.hash-569dc9079a6d404c0d850d27b510585b856ab3def5e1e0bbafa30a3bf9d48e82";
const GOLD = "card.hash-6249df4367d0a2e088c8eb1117ef59430f0d7dad4bf0fcf8a01d7f0415f4d511";
const TREASURE_FIELD = "token:7";

const m1 = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
  readonly candidates: readonly {
    readonly id: "rumble-sfd" | "fiora-sfd";
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

function deck(id: "rumble-sfd" | "fiora-sfd", seat: "A" | "B"): EngineRuntimeDeck {
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
          domains: allowed,
          energy: zone === "runes" ? null : printed.energy,
          power: zone === "runes" || printed.power === null ? null : allowed,
          might: printed.might,
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

function setup(seed = "RIFT-1165-auto-3"): EngineRuntime {
  serial = 0;
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return createEngineRuntime({
    matchId: `RIFT-1165:${seed}`,
    roomId: `RIFT-1165:${seed}`,
    decks,
    seed,
    firstPlayer: "A",
    battlefieldChoice: [2, 2],
    mulligans: [[], []],
    programs: programs(decks),
  }).start();
}

function setupWithEngineVersion(seed: string, engineVersion: string): EngineRuntime {
  serial = 0;
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return createEngineRuntime({
    matchId: `RIFT-1165:${seed}`,
    roomId: `RIFT-1165:${seed}`,
    decks,
    seed,
    firstPlayer: "A",
    battlefieldChoice: [2, 2],
    mulligans: [[], []],
    programs: programs(decks),
    engineVersion,
  }).start();
}

function submit(runtime: EngineRuntime, playerId: string,
  command: Omit<V2Command, "commandId" | "stateVersion">, commandId: string) {
  return runtime.submit(playerId, { ...command, commandId, stateVersion: runtime.projectFor(playerId).stateVersion } as V2Command);
}

function hand(runtime: EngineRuntime, playerId: string, cardId: string) {
  return runtime.projectFor(playerId).objects.find(object => object.zone === "hand" &&
    object.ownerPlayerId === playerId && object.cardId === cardId);
}

function readyRunes(runtime: EngineRuntime, playerId: string) {
  return runtime.projectFor(playerId).zones.find(zone => zone.zone === "rune-zone" &&
    zone.ownerPlayerId === playerId)?.objects?.filter(rune => rune.exhausted === false) ?? [];
}

function fund(runtime: EngineRuntime, count: number, prefix: string): void {
  for (const [index, rune] of readyRunes(runtime, "A").slice(0, count).entries()) {
    const receipt = submit(runtime, "A", { type: "rune-energy", runeObjectId: rune.objectId,
      zoneEntryId: rune.zoneEntryId! }, `${prefix}:rune:${index}`).receipt;
    expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
  }
}

function settleWithoutChoice(runtime: EngineRuntime, prefix: string): void {
  for (let index = 0; index < 20; index += 1) {
    const view = runtime.projectFor(null);
    if (view.pendingChoice.status === "pending" || view.chain.items.length === 0) return;
    const actor = view.chain.priorityPlayerId;
    if (actor === null) throw new Error(`Chain ${prefix} has no Priority holder`);
    const receipt = submit(runtime, actor, { type: "pass" }, `${prefix}:pass:${index}`).receipt;
    expect(receipt.status, JSON.stringify(receipt)).toBe("accepted");
  }
  throw new Error(`Chain ${prefix} did not settle`);
}

function pending(view: V2Projection): Extract<V2PendingChoice, { readonly status: "pending" }> {
  if (view.pendingChoice.status !== "pending") throw new Error(`Expected pending choice: ${JSON.stringify(view.pendingChoice)}`);
  return view.pendingChoice;
}

function reachConquer(s: EngineRuntime, { fundTreasure }: { readonly fundTreasure: boolean }): void {
  fund(s, 2, "play-poro");
  const poro = hand(s, "A", PORO)!;
  expect(poro).toBeDefined();
  expect(submit(s, "A", { type: "play", cardObjectId: poro.objectId,
    destination: { kind: "base", playerId: "A" } }, "play-poro").receipt.status).toBe("accepted");
  settleWithoutChoice(s, "play-poro");
  submit(s, "A", { type: "end-turn" }, "end-a");
  submit(s, "B", { type: "end-turn" }, "end-b");
  if (fundTreasure) fund(s, 1, "treasure-energy");
  const playedPoro = s.projectFor("A").objects.find(object => object.cardId === PORO && object.zone === "board")!;
  const moved = submit(s, "A", { type: "move", objectId: playedPoro.objectId,
    to: { zone: "battlefield", locationId: TREASURE_FIELD } }, "move-to-treasure").receipt;
  expect(moved.status, JSON.stringify(moved)).toBe("accepted");

  // A receives Showdown Focus first. B's pass finishes Focus and discovers the
  // simultaneous Treasure Hoard + Plundering Poro Conquer triggers.
  const focus = s.projectFor(null);
  expect(focus.chain.focusPlayerId).toBe("A");
  expect(submit(s, "A", { type: "pass" }, "focus-a").receipt.status).toBe("accepted");
  expect(submit(s, "B", { type: "pass" }, "focus-b").receipt.status).toBe("pending");
}

function orderTreasureFirst(s: EngineRuntime): void {
  const view = s.projectFor("A");
  const choice = pending(view);
  expect(choice).toMatchObject({ kind: "mode", ownerPlayerId: "A" });
  expect(choice.choiceId).toMatch(/^trigger:\d+:A:order:0$/u);
  expect(choice.options?.map(option => option.label).sort()).toEqual(["Plundering Poro", "Treasure Hoard"]);
  const treasure = choice.options?.find(option => option.label === "Treasure Hoard");
  expect(treasure).toBeDefined();
  expect(submit(s, "A", { type: "choose", choiceId: choice.choiceId, answer: treasure!.value! },
    "order-treasure-first").receipt.status).toBe("pending");
}

function acceptTreasure(s: EngineRuntime): void {
  const view = s.projectFor("A");
  const choice = pending(view);
  expect(choice).toMatchObject({
    kind: "optional", ownerPlayerId: "A",
    prompt: "Pay 1 energy to play a Gold gear token exhausted?",
    source: { name: "Treasure Hoard" },
  });
  expect(choice.choiceId).toMatch(/^finalize:trigger:\d+:optional$/u);
  expect(submit(s, "A", { type: "choose", choiceId: choice.choiceId, answer: true },
    "accept-treasure").receipt.status).toBe("accepted");
}

function resolveCurrentChain(s: EngineRuntime): void {
  settleWithoutChoice(s, "resolve");
  if (s.projectFor(null).chain.items.length > 0) {
    const view = s.projectFor(null);
    const actor = view.chain.priorityPlayerId;
    if (actor === null) throw new Error("Expected post-Finalize Priority");
    submit(s, actor, { type: "pass" }, "post-finalize-pass");
  }
  settleWithoutChoice(s, "post-finalize");
}

describe("RIFT-1165 Treasure Hoard Conquer choice", () => {
  it("keeps the pre-fix journal version byte-identical and free of Treasure Hoard registration", () => {
    const runtime = setupWithEngineVersion("legacy", "@riftbound/engine-core/current");
    expect(runtime.journal().header.engineVersion).toBe("@riftbound/engine-core/current");
    const raw = (runtime as unknown as {
      readonly host: { objects(): readonly { readonly cardId: string | null; readonly zone: string }[] };
      readonly match: { readonly flow: { readonly chain: { pipeline: {
        registeredTriggers(): readonly { readonly source: { readonly cardId: string | null } }[] } } } };
    });
    expect(raw.host.objects().find(object => object.cardId === CANONICAL)?.zone).toBe("battlefield");
    expect(raw.match.flow.chain.pipeline.registeredTriggers()
      .some(registration => registration.source.cardId === CANONICAL)).toBe(false);
    const restored = createEngineRuntime({
      matchId: runtime.matchId, roomId: runtime.matchId,
      decks: [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")], seed: "legacy",
      firstPlayer: "A", battlefieldChoice: [2, 2], mulligans: [[], []],
      programs: programs([deck("rumble-sfd", "A"), deck("fiora-sfd", "B")]),
      engineVersion: "@riftbound/engine-core/current",
    }).restore(runtime.journal());
    expect(restored.journal()).toEqual(runtime.journal());
  });

  it("materializes setup Battlefields in the current Board lifecycle version", () => {
    const runtime = setup();
    const raw = (runtime as unknown as {
      readonly host: { objects(): readonly {
        readonly cardId: string | null; readonly zone: string; readonly location: unknown;
      }[] };
      readonly match: { readonly flow: { readonly chain: { pipeline: {
        registeredTriggers(): readonly {
          readonly source: { readonly cardId: string | null };
          readonly mayAtFinalize?: boolean;
        }[] } } } };
    });
    const treasure = raw.host.objects().find(object => object.cardId === CANONICAL);
    expect(treasure).toMatchObject({ zone: "board", location: { type: "battlefield" } });
    expect(raw.match.flow.chain.pipeline.registeredTriggers()
      .find(registration => registration.source.cardId === CANONICAL)?.mayAtFinalize).toBe(true);
    expect(runtime.journal().header.engineVersion).toContain("RIFT-1165");
  });

  it("orders simultaneous Conquer triggers and asks the Treasure Hoard owner before paying", () => {
    const runtime = setup();
    reachConquer(runtime, { fundTreasure: true });
    orderTreasureFirst(runtime);
    expect(runtime.projectFor("A").players.find(player => player.playerId === "A")?.energy).toBe(1);
    acceptTreasure(runtime);
    expect(runtime.projectFor("A").players.find(player => player.playerId === "A")?.energy).toBe(0);
    const opponentChoice = runtime.projectFor("B").pendingChoice;
    expect(opponentChoice).toEqual({ status: "none" });

    resolveCurrentChain(runtime);
    const gold = runtime.projectFor("A").objects.find(object => object.cardId === GOLD);
    expect(gold).toMatchObject({
      zone: "board", exhausted: true, location: { kind: "base", playerId: "A" },
    });
    const restored = createEngineRuntime({
      matchId: runtime.matchId, roomId: runtime.matchId,
      decks: [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")], seed: "RIFT-1165-auto-3",
      firstPlayer: "A", battlefieldChoice: [2, 2], mulligans: [[], []],
      programs: programs([deck("rumble-sfd", "A"), deck("fiora-sfd", "B")]),
    }).restore(runtime.journal());
    expect(restored.projectFor("A")).toEqual(runtime.projectFor("A"));
  }, 180_000);

  it("declines without payment or Gold while preserving the mandatory Poro trigger", () => {
    const runtime = setup();
    reachConquer(runtime, { fundTreasure: true });
    orderTreasureFirst(runtime);
    const before = runtime.projectFor("A");
    const choice = pending(before);
    expect(submit(runtime, "A", { type: "choose", choiceId: choice.choiceId, answer: false },
      "decline-treasure").receipt.status).toBe("accepted");
    expect(runtime.projectFor("A").players.find(player => player.playerId === "A")?.energy).toBe(1);
    expect(runtime.projectFor("A").objects.some(object => object.cardId === GOLD)).toBe(false);
    resolveCurrentChain(runtime);
    expect(runtime.projectFor("A").objects.filter(object => object.cardId === GOLD)).toHaveLength(1);
    expect(runtime.projectFor("A").objects.find(object => object.cardId === GOLD)).toMatchObject({
      exhausted: true, location: { kind: "base", playerId: "A" },
    });
  }, 180_000);

  it("consumes an unpayable accepted Treasure Hoard trigger without making a free Gold", () => {
    const runtime = setup();
    reachConquer(runtime, { fundTreasure: false });
    orderTreasureFirst(runtime);
    const choice = pending(runtime.projectFor("A"));
    expect(choice.kind).toBe("optional");
    expect(runtime.projectFor("A").players.find(player => player.playerId === "A")?.energy).toBe(0);
    expect(submit(runtime, "A", { type: "choose", choiceId: choice.choiceId, answer: true },
      "accept-unpayable-treasure").receipt.status).toBe("accepted");
    resolveCurrentChain(runtime);
    const golds = runtime.projectFor("A").objects.filter(object => object.cardId === GOLD);
    expect(golds).toHaveLength(1);
    expect(golds[0]).toMatchObject({ exhausted: true, location: { kind: "base", playerId: "A" } });
    expect(runtime.projectFor("A").players.find(player => player.playerId === "A")?.energy).toBe(0);
  }, 180_000);
});
