import { describe, expect, it } from "vitest";
import type { CardProgram } from "../../../card-dsl/dist/ir/types.js";
import { cardPrograms } from "../../../card-dsl/dist/cards/registry.generated.js";
import { createMatch, type MatchCard, type MatchHost, type MatchDeck } from "../../../engine-core/dist/game/lifecycle.js";
import { world } from "../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import { buildM1Deck, trustedPrintedCatalog, type HeadlessCard, type M1PreconId } from "../../src/headless/decks.js";
import {
  prioritizedHeadlessCommands,
  runHeadlessGame,
  type HeadlessCommand,
  type HeadlessCommandTrace,
  type HeadlessJournal,
} from "../../src/headless/duel.js";
import type { Domain } from "../../../engine-core/dist/effects/contract.js";

const RUMBLE_DECK = buildM1Deck("rumble-sfd", "A");
const STUPEFY = RUMBLE_DECK.mainDeck.find(card => card.name === "Stupefy")!;
const FRIGID_TOUCH = RUMBLE_DECK.mainDeck.find(card => card.name === "Frigid Touch")!;
const CONSULT_THE_PAST = RUMBLE_DECK.mainDeck.find(card => card.name === "Consult the Past")!;

function syntheticCard(id: string, canonicalCardId: string, name: string, cardType: string): HeadlessCard {
  return {
    id, cardId: canonicalCardId, canonicalCardId, name, cardType, domains: [], tags: [], types: [cardType.toLowerCase()],
    energy: null, power: null, might: null,
  };
}

function card(id: string, values: Omit<MatchCard, "id">): MatchCard {
  return { id, ...values };
}

function syntheticDeck(seat: "A" | "B"): MatchDeck {
  const spell = (name: string) => syntheticCard(`${seat}:${name}`, `synthetic:${seat}:${name}`, name, "Spell");
  return {
    mainDeck: Array.from({ length: 8 }, (_, index) => spell(`spell-${index}`)),
    runeDeck: Array.from({ length: 8 }, (_, index) => syntheticCard(`${seat}:rune-${index}`, `synthetic:${seat}:rune-${index}`, `rune-${index}`, "Rune")),
    championLegend: syntheticCard(`${seat}:legend`, `synthetic:${seat}:legend`, "legend", "Legend"),
    chosenChampion: syntheticCard(`${seat}:champion`, `synthetic:${seat}:champion`, "champion", "Unit"),
    battlefields: [
      syntheticCard(`${seat}:field-1`, `synthetic:${seat}:field-1`, "field-1", "Battlefield"),
      syntheticCard(`${seat}:field-2`, `synthetic:${seat}:field-2`, "field-2", "Battlefield"),
      syntheticCard(`${seat}:field-3`, `synthetic:${seat}:field-3`, "field-3", "Battlefield"),
    ],
  };
}

function productionSource(source: HeadlessCard): Object {
  const power: readonly Domain[] | null = source.power === null ? null :
    Array.from({ length: source.power }, () => source.domains[0] as Domain);
  return {
    cardId: source.canonicalCardId, name: source.name, types: [...(source.types ?? [])], tags: [...source.tags],
    energy: source.energy, power, might: source.might,
  };
}

function productionWorld(cards: readonly { readonly id: string; readonly source: HeadlessCard }[]) {
  const builder = world().player("A").player("B");
  for (const entry of cards) builder.hand(entry.id, productionSource(entry.source));
  const kernel = builder.build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      const checkpoint = saved as {
        readonly state: Parameters<typeof kernel.restore>[0];
        readonly links: Parameters<typeof kernel.copyLinkedFrom>[0];
      };
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: ((request: Parameters<NonNullable<ReturnType<typeof createActionPipelineHost>["choose"]>>[0]) => {
      if (request.type === "optional") return false;
      if (request.type === "select-objects") return request.options.slice(0, request.min);
      if (request.type === "mode") return request.options[0];
      if (request.type === "number") return request.min;
      return [...request.options];
    }) as NonNullable<Parameters<typeof createActionPipelineHost>[0]["choose"]>,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
  });
  const binding = createProgramBinding({
    cardPrograms: cardPrograms as unknown as readonly CardProgram[],
    printedCatalog: trustedPrintedCatalog(),
  });
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) } as MatchHost,
    decks: [syntheticDeck("A"), syntheticDeck("B")],
    programs: binding,
    seed: "RIFT-1072-production-candidate",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
  });
  binding.attachLifecycle(match.flow.chain, error => { throw error; });
  return { binding, kernel, match };
}

function traceFor(candidates: readonly Extract<HeadlessCommand, { type: "play" }>[], state: "neutral-open" | "showdown-open" | "showdown-closed",
  energy: number, player: "A" | "B"): HeadlessCommandTrace {
  return {
    turn: 1,
    turnPlayer: player,
    phase: "main",
    priority: player,
    focus: state === "neutral-open" ? null : player,
    turnState: state,
    canActNormal: state === "neutral-open",
    candidateCounts: { play: candidates.length, idle: 0, pass: 0, advance: 0, move: 0, "rune-energy": 0,
      "combat-damage": 0, concede: 0 },
    boardUnits: [],
    basicRunes: [],
    runePool: { A: { energy: player === "A" ? energy : 0, power: [] }, B: { energy: player === "B" ? energy : 0, power: [] } },
    battlefields: [],
    candidates: candidates.map(command => ({
      type: "play" as const,
      id: command.id,
      name: "candidate",
      object: command.object,
      energy: 1,
      power: null,
      types: ["spell"],
      destination: null,
    })),
    canEndTurn: false,
    emptyRunePoolBlocked: false,
  };
}

describe("RIFT-1072 headless play candidate legality", () => {
  it("uses the production CardProgram and Match host to form Stupefy's target requirement", () => {
    const { kernel, match } = productionWorld([{ id: "stupefy", source: STUPEFY as HeadlessCard }]);
    const source = kernel.getObject("stupefy");
    if (source === null) throw new Error("Stupefy source is missing");
    const draft = match.programBinding!.describePlay({ type: "play", player: "A", object: source.ref }, source);
    expect(draft.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: "debuff" })]));
    expect((draft.body[0]!.targets as readonly unknown[] | undefined)).toHaveLength(1);
    expect(source.zone).toBe("hand");
  });

  it("describes Repeat and printed costs from the production CardProgram", () => {
    const { kernel, match } = productionWorld([
      { id: "frigid", source: FRIGID_TOUCH as HeadlessCard },
      { id: "consult", source: CONSULT_THE_PAST as HeadlessCard },
    ]);
    const frigid = kernel.getObject("frigid")!;
    const consult = kernel.getObject("consult")!;
    const frigidDraft = match.programBinding!.describePlay({ type: "play", player: "A", object: frigid.ref }, frigid);
    const consultDraft = match.programBinding!.describePlay({ type: "play", player: "A", object: consult.ref }, consult);
    expect(frigidDraft.cost?.optionalAdditional).toEqual([expect.objectContaining({ kind: "repeat" })]);
    expect(consultDraft.cost?.cost).toEqual({ kind: "printed" });
    expect(kernel.getObject("frigid")?.zone).toBe("hand");
    expect(kernel.getObject("consult")?.zone).toBe("hand");
  });

  it("uses the same affordability admission for a Play while a closed Chain holds Priority", () => {
    const play: Extract<HeadlessCommand, { type: "play" }> = { type: "play", player: "B", object: { id: "spell", zoneEntryId: 1 }, id: "play:closed" };
    const trace = traceFor([play], "showdown-closed", 0, "B");
    const combat = { current: { step: "showdown" } } as Parameters<typeof prioritizedHeadlessCommands>[2];
    expect(prioritizedHeadlessCommands([play], trace, combat)).toEqual([]);
    expect(prioritizedHeadlessCommands([{ type: "pass", player: "B" }, play], trace, combat))
      .toEqual([{ type: "pass", player: "B" }]);
  });

  it("keeps the reproduced no-target journal free of target and payment rejections", () => {
    let journal: HeadlessJournal | undefined;
    const result = runHeadlessGame("RIFT-990-m1-seed-003", {
      deckPair: { A: "rumble-sfd" as M1PreconId, B: "fiora-sfd" as M1PreconId },
      maxTurns: 1,
      maxActions: 5,
      onJournal: value => { journal = value; },
    });
    expect(journal).toBeDefined();
    expect(journal!.commands[0]?.trace?.boardUnits).toEqual([]);
    expect(journal!.commands[0]?.trace?.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Stupefy" }),
    ]));
    expect(journal!.commands.filter(entry => entry.failure?.code === "no-legal-targets")).toEqual([]);
    expect(journal!.commands.filter(entry => entry.failure?.code === "cannot-pay-cost")).toEqual([]);
    expect(result.replayMatches).toBe(true);
  }, 120_000);

  it("declines Frigid Touch Repeat consistently in production candidate execution", () => {
    let journal: HeadlessJournal | undefined;
    const result = runHeadlessGame("RIFT-990-m1-seed-002", {
      deckPair: { A: "rumble-sfd" as M1PreconId, B: "fiora-sfd" as M1PreconId },
      maxTurns: 3,
      maxActions: 20,
      onJournal: value => { journal = value; },
    });
    expect(journal).toBeDefined();
    const frigidPlays = journal!.commands.filter(entry => entry.command.type === "play" &&
      entry.trace?.candidates.some(candidate => candidate.id === (entry.command as Extract<HeadlessCommand, { type: "play" }>).id &&
        candidate.name === "Frigid Touch"));
    expect(frigidPlays.length).toBeGreaterThan(0);
    expect(frigidPlays.filter(entry => entry.failure !== null)).toEqual([]);
    expect(journal!.commands.filter(entry => entry.failure?.code === "cannot-pay-cost")).toEqual([]);
    expect(result.replayMatches).toBe(true);
  }, 120_000);

});
