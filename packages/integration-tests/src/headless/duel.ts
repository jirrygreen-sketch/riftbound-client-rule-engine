import { createHash } from "node:crypto";
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import { concede, createMatch, type Match, type MatchCard, type MatchDeck } from "../../../engine-core/dist/game/lifecycle.js";
import { projectFor } from "../../../engine-core/dist/projection/v2/index.js";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import { world, type TestWorld } from "../../../engine-core/dist/effects/testing/test-kernel.js";
import { cardPrograms } from "../../../card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../card-dsl/dist/ir/types.js";
import type { ChainDraft } from "../../../engine-core/dist/chain/engine.js";
import type { ObjectSnapshot, PlayerId } from "../../../engine-core/dist/effects/contract.js";
import type { PipelineHost } from "../../../engine-core/dist/events/pipeline-types.js";
import { buildM1Deck, type HeadlessCard } from "./decks.js";

export const HEADLESS_SEEDS = Object.freeze(Array.from({ length: 20 }, (_, index) => `RIFT-345-seed-${index + 1}`));
export const DEFAULT_GAME_LIMIT = 100;
export const DEFAULT_TURN_LIMIT = 8;

export interface HeadlessStats {
  readonly seed: string;
  readonly winner: PlayerId | null;
  readonly turnNumber: number;
  readonly termination: "winner" | "concede" | "blocked" | "exception" | "guard";
  readonly exceptions: readonly string[];
  readonly judgeRequiredRejections: number;
  readonly judgeRequiredCards: readonly string[];
  readonly eventCount: number;
  readonly journalDigest: string;
  readonly projectionDigests: Readonly<Record<PlayerId, string>>;
  readonly replayMatches: boolean;
  readonly privacySafe: boolean;
}

export interface HeadlessRunSummary {
  readonly games: number;
  readonly completed: number;
  readonly blocked: number;
  readonly exceptions: number;
  readonly judgeRequiredRejections: number;
  readonly terminationReasons: Readonly<Record<HeadlessStats["termination"], number>>;
  readonly totalTurns: number;
  readonly gamesWithReplayMismatch: number;
  readonly gamesWithPrivacyLeak: number;
  readonly results: readonly HeadlessStats[];
}

interface MutableCounters {
  judgeRequiredRejections: number;
  readonly judgeRequiredCards: Set<string>;
}

interface HeadlessWorld {
  readonly kernel: TestWorld;
  readonly host: PipelineHost & { readonly player: (id: PlayerId) => ReturnType<TestWorld["player"]> };
  readonly counters: MutableCounters;
}

interface Journal {
  readonly seed: string;
  readonly mulligans: readonly [readonly string[], readonly string[]];
  readonly commands: readonly Readonly<Record<string, unknown>>[];
  readonly events: readonly unknown[];
  readonly final: Readonly<Record<string, unknown>>;
}

interface DraftableCard extends ObjectSnapshot {
  readonly cardId: string;
}

interface HeadlessContext {
  readonly state: HeadlessWorld;
  readonly mulligans: readonly [readonly string[], readonly string[]];
  readonly programs: ReturnType<typeof createProgramBinding>;
  readonly match: Match;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableSeed(seed: string): number {
  let value = 0x811c9dc5;
  for (const character of seed) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

class SetupRandom {
  private state: number;
  constructor(seed: string) { this.state = stableSeed(seed); }
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let mixed = this.state;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x21f0aaad) >>> 0;
    mixed ^= mixed >>> 15;
    mixed = Math.imul(mixed, 0x735a2d97) >>> 0;
    mixed ^= mixed >>> 15;
    return mixed >>> 0;
  }
}

class BotRandom {
  private state: number;
  constructor(seed: string) { this.state = stableSeed(seed); }
  next(max: number): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return max <= 1 ? 0 : this.state % max;
  }
}

function makeWorld(seed: string): HeadlessWorld {
  const builder = world(stableSeed(`${seed}:kernel`)).player("A").player("B");
  const kernel = builder.build();
  const counters: MutableCounters = { judgeRequiredRejections: 0, judgeRequiredCards: new Set() };
  const choiceRandom = new BotRandom(`${seed}:choices`);
  const hostBase = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: snapshot => {
      const saved = snapshot as { readonly state: unknown; readonly links: TestWorld };
      kernel.restore(saved.state as Parameters<TestWorld["restore"]>[0]);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: <T>(request: Parameters<NonNullable<PipelineHost["choose"]>>[0]) => botChoice(choiceRandom, request) as T,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
    }),
    testTrigger: () => false,
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(hostBase)), hostBase, {
    player: (id: PlayerId) => kernel.player(id),
  }) as HeadlessWorld["host"];
  return { kernel, host, counters };
}

function cardProgramStatus(cardId: string | null): "executable" | "judge-required" | "missing" {
  if (!cardId) return "missing";
  const program = (cardPrograms as readonly { readonly canonicalCardId: string; readonly status: string }[])
    .find(candidate => candidate.canonicalCardId === cardId);
  if (!program) return "missing";
  return program.status === "executable" ? "executable" : "judge-required";
}

function createBotDraft(
  binding: ReturnType<typeof createProgramBinding>,
  source: DraftableCard,
  player: PlayerId,
  fieldId: string,
  counters: MutableCounters,
): ChainDraft | null {
  const status = cardProgramStatus(source.cardId);
  if (status !== "executable") {
    if (status === "judge-required") {
      counters.judgeRequiredRejections += 1;
      counters.judgeRequiredCards.add(source.cardId);
    }
    return null;
  }
  try {
    return binding.describePlay({ type: "play", object: source.ref, player, location: { type: "battlefield", id: fieldId } }, source);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/judge|required|program|battlefield location filters|no playable|unbound|unknown-program|invalid-program/i.test(message)) {
      counters.judgeRequiredRejections += 1;
      counters.judgeRequiredCards.add(source.cardId);
      return null;
    }
    throw error;
  }
}

function hiddenCardIds(projection: ReturnType<typeof projectFor>): readonly string[] {
  const hidden: string[] = [];
  for (const player of Object.values(projection.players)) {
    for (const zone of [player.hand, player.mainDeck, player.deck, player.runeDeck]) {
      for (const card of zone.cards) {
        if (card.visibility === "face-down" && card.cardId !== undefined) hidden.push(card.cardId);
        if (card.visibility === "face-down" && !card.id.startsWith("hidden:")) hidden.push(card.id);
      }
    }
  }
  return hidden;
}

function projectionForKernel(kernel: TestWorld, viewer: PlayerId | "spectator"): ReturnType<typeof projectFor> {
  const players = ["A", "B"] as const;
  const input = {
    stateVersion: kernel.events.length,
    eventSeq: kernel.events.length,
    phase: "playing",
    players: players.map(id => {
      const player = kernel.player(id);
      const cards = (zone: Parameters<TestWorld["objectsInZone"]>[1]) => kernel.objectsInZone(id, zone).map(ref => {
        const object = kernel.getObject(ref.id)!;
        return {
          id: object.ref.id,
          ref: object.ref,
          zone: object.zone,
          owner: object.owner,
          controller: object.controller,
          faceDown: false,
          cardId: object.cardId,
          name: object.name,
          types: object.types,
          energy: object.energy,
          might: object.might,
          power: object.power,
        };
      });
      return {
        id,
        name: id,
        energy: player.energy,
        power: player.power,
        score: player.score,
        hand: cards("hand"),
        deck: cards("deck"),
        runeDeck: cards("rune-deck"),
        trash: cards("trash"),
        board: cards("board"),
        runeZone: cards("rune-zone"),
      };
    }),
    objects: kernel.objects.map(object => ({
      id: object.ref.id,
      ref: object.ref,
      zone: object.zone,
      owner: object.owner,
      controller: object.controller,
      faceDown: false,
      cardId: object.cardId,
      name: object.name,
      types: object.types,
      energy: object.energy,
      might: object.might,
      power: object.power,
      location: object.location,
    })),
    events: kernel.events,
  };
  return projectFor(input, viewer);
}

function botChoice(random: BotRandom, request: Parameters<NonNullable<PipelineHost["choose"]>>[0]): unknown {
  if (request.type === "optional") return random.next(2) === 0;
  if (request.type === "mode") return request.options[random.next(request.options.length)];
  if (request.type === "number") return request.min + random.next(request.max - request.min + 1);
  if (request.type === "select-objects") {
    const count = Math.min(request.max, Math.max(request.min, request.min));
    return request.options.slice(0, count);
  }
  if (request.type === "order") return [...request.options];
  return undefined;
}

function cloneDeck(deck: MatchDeck, seat: "A" | "B"): MatchDeck {
  const copy = (card: MatchCard, index: number, zone: string): MatchCard => ({
    ...card,
    id: `${seat}:${zone}:${index}:${card.id}`,
  });
  return {
    mainDeck: deck.mainDeck.map((card, index) => copy(card, index, "main")),
    runeDeck: deck.runeDeck.map((card, index) => copy(card, index, "rune")),
    championLegend: copy(deck.championLegend, 0, "legend"),
    chosenChampion: copy(deck.chosenChampion, 0, "champion"),
    battlefields: deck.battlefields.map((card, index) => copy(card, index, "battlefield")) as [MatchCard, MatchCard, MatchCard],
  };
}

function openingHandsFor(seed: string, decks: readonly [MatchDeck, MatchDeck]): readonly [readonly string[], readonly string[]] {
  const random = new SetupRandom(seed);
  const hands: string[][] = [[], []];
  for (const [seat, deck] of decks.entries()) {
    for (const cards of [deck.mainDeck, deck.runeDeck]) {
      const order = Array.from({ length: cards.length }, (_, index) => index);
      for (let index = order.length - 1; index > 0; index -= 1) {
        const swap = random.next() % (index + 1);
        [order[index], order[swap]] = [order[swap]!, order[index]!];
      }
      if (cards === deck.mainDeck) hands[seat] = order.slice(0, 4).map(index => cards[index]!.cardId ?? cards[index]!.id);
    }
  }
  return [hands[0]!, hands[1]!];
}

function setupMatch(
  seed: string,
  state: HeadlessWorld,
  programs: ReturnType<typeof createProgramBinding>,
  decks: readonly [MatchDeck, MatchDeck],
  mulligans: readonly [readonly string[], readonly string[]],
): Match {
  return createMatch({
    decks,
    seed,
    firstPlayer: 0,
    battlefieldChoice: [0, 0],
    mulligans,
    host: state.host,
    victoryScore: 1,
    programs: programs as unknown as { readonly [key: string]: unknown },
  });
}

function chooseMulligans(seed: string, openingHands: readonly [readonly string[], readonly string[]]): readonly [readonly string[], readonly string[]] {
  const random = new BotRandom(`${seed}:mulligan`);
  const choose = (hand: readonly string[]): readonly string[] => {
    if (hand.length < 2 || random.next(3) === 0) return [];
    return [hand[random.next(hand.length)]!, hand[random.next(hand.length)]!].filter((card, index, all) => all.indexOf(card) === index).slice(0, 2);
  };
  return [choose(openingHands[0]), choose(openingHands[1])];
}

function createHeadlessContext(seed: string, requestedMulligans?: readonly [readonly string[], readonly string[]]): HeadlessContext {
  const decks = [cloneDeck(buildM1Deck("rumble-sfd", "A"), "A"), cloneDeck(buildM1Deck("fiora-sfd", "B"), "B")] as const;
  const programs = createProgramBinding({ cardPrograms: cardPrograms as unknown as readonly CardProgram[] });
  const mulligans = requestedMulligans ?? chooseMulligans(seed, openingHandsFor(seed, decks));
  const state = makeWorld(seed);
  const match = setupMatch(seed, state, programs, decks, mulligans);
  return { state, mulligans, programs, match };
}

function replayHeadlessJournal(seed: string, journal: Journal): boolean {
  try {
    const context = createHeadlessContext(seed, journal.mulligans);
    for (const command of journal.commands) {
      const type = command.type;
      if (type === "idle") {
        const player = String(command.player) as PlayerId;
        context.match.flow.endTurn(player);
        continue;
      }
      if (type === "play") {
        const player = String(command.player) as PlayerId;
        const ref = command.object as { readonly id: string; readonly zoneEntryId: number };
        const source = context.state.kernel.objects.find(object => object.ref.id === ref.id && object.ref.zoneEntryId === ref.zoneEntryId) as DraftableCard | undefined;
        if (!source) return false;
        const draft = createBotDraft(context.programs, source, player, context.match.setup.battlefields[0]!.id, context.state.counters);
        if (!draft) return command.accepted === false;
        try {
          context.match.flow.execute(draft);
          if (command.accepted === false) return false;
        } catch {
          if (command.accepted !== false) return false;
        }
        if (command.accepted === false) context.match.flow.endTurn(player);
        continue;
      }
      if (type === "pass") {
        const player = String(command.player) as PlayerId;
        if (context.match.flow.chain.priority !== player) return false;
        context.match.flow.pass(player);
        continue;
      }
      if (type === "advance") {
        context.match.flow.advance();
        continue;
      }
      if (type === "concede") {
        concede(context.match, String(command.player) as PlayerId);
      }
    }
    const final = journal.final;
    const result = context.match.result();
    return result.winner === final.winner && result.turnNumber === final.turnNumber &&
      context.state.kernel.player("A").score === final.scoreA &&
      context.state.kernel.player("B").score === final.scoreB;
  } catch {
    return false;
  }
}

export function runHeadlessGame(seed: string, options: { readonly maxTurns?: number } = {}): HeadlessStats {
  const maxTurns = options.maxTurns ?? DEFAULT_TURN_LIMIT;
  let context: HeadlessContext | null = null;
  const random = new BotRandom(`${seed}:bot`);
  const journalCommands: Readonly<Record<string, unknown>>[] = [];
  let match: Match | undefined;
  let state: HeadlessWorld;
  let programs: ReturnType<typeof createProgramBinding>;
  let termination: HeadlessStats["termination"] = "guard";
  const exceptions: string[] = [];
  try {
    context = createHeadlessContext(seed);
    ({ state, programs, match } = context);
    let actions = 0;
    while (!match.result().winner && match.flow.turn <= maxTurns && actions < 2) {
      const active = match.flow.turnPlayer;
      if (match.flow.phase === "main" && match.flow.chain.canAct(active, "normal")) {
        const hand = state.kernel.objects.filter(object => object.controller === active && object.zone === "hand") as DraftableCard[];
        const fieldId = match.setup.battlefields[0]!.id;
        const playable = hand
          .map(card => createBotDraft(programs, card, active, fieldId, state.counters))
          .filter((draft): draft is ChainDraft => draft !== null);
        const draft = playable[random.next(playable.length || 1)];
        if (draft) {
          let accepted = true;
          try { match.flow.execute(draft); }
          catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (/judge|required|program|battlefield location filters|no playable|unbound|unknown-program|invalid-program/i.test(message)) {
              state.counters.judgeRequiredRejections += 1;
              state.counters.judgeRequiredCards.add(draft.source.cardId ?? draft.source.ref.id);
              accepted = false;
            } else if (/blocked|combat-start|standard-move|cannot|cost|timed|target/i.test(message)) {
              accepted = false;
            } else throw error;
          }
          journalCommands.push({ type: "play", player: active, object: draft.source.ref, id: draft.id, accepted });
          if (!accepted) match.flow.endTurn(active);
          actions += 1;
        } else {
          journalCommands.push({ type: "idle", player: active });
          match.flow.endTurn(active);
          actions += 1;
        }
      } else if (match.flow.chain.priority) {
        const player = match.flow.chain.priority;
        journalCommands.push({ type: "pass", player });
        match.flow.pass(player);
        actions += 1;
      } else {
        journalCommands.push({ type: "advance" });
        match.flow.advance();
        actions += 1;
      }
    }
    if (match.result().winner) termination = "winner";
    else {
      termination = "concede";
      journalCommands.push({ type: "concede", player: match.flow.turnPlayer });
      concede(match, match.flow.turnPlayer);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    exceptions.push(message);
    termination = /blocked|combat-start|standard-move/i.test(message) ? "blocked" : "exception";
    if (!match || !state!) throw error;
  }
  if (!match || !state!) throw new Error("Headless match did not initialize");
  const result = match.result();
  const journal: Journal = {
    seed,
    mulligans: context?.mulligans ?? [[], []],
    commands: journalCommands,
    events: match.events(),
    final: { winner: result.winner, turnNumber: result.turnNumber, scoreA: state.kernel.player("A").score, scoreB: state.kernel.player("B").score },
  };
  const replayMatches = replayHeadlessJournal(seed, journal);
  const projections = {
    A: projectionForKernel(state.kernel, "A"),
    B: projectionForKernel(state.kernel, "B"),
  } as const;
  const privacySafe = hiddenCardIds(projections.A).length === 0 && hiddenCardIds(projections.B).length === 0;
  return {
    seed,
    winner: result.winner,
    turnNumber: result.turnNumber,
    termination,
    exceptions,
    judgeRequiredRejections: state.counters.judgeRequiredRejections,
    judgeRequiredCards: [...state.counters.judgeRequiredCards].sort(),
    eventCount: match.events().length,
    journalDigest: digest(journal),
    projectionDigests: { A: digest(projections.A), B: digest(projections.B) },
    replayMatches,
    privacySafe,
  };
}

export function runHeadlessGames(games = DEFAULT_GAME_LIMIT, seeds: readonly string[] = HEADLESS_SEEDS): HeadlessRunSummary {
  if (!Number.isSafeInteger(games) || games < 1) throw new RangeError("games must be a positive integer");
  const results = Array.from({ length: games }, (_, index) => {
    const seed = seeds[index % seeds.length]!;
    return runHeadlessGame(seed, { maxTurns: DEFAULT_TURN_LIMIT });
  });
  const terminationReasons = { winner: 0, concede: 0, blocked: 0, exception: 0, guard: 0 } satisfies Record<HeadlessStats["termination"], number>;
  for (const result of results) terminationReasons[result.termination] += 1;
  return {
    games,
    completed: results.filter(result => result.winner !== null).length,
    blocked: results.filter(result => result.termination === "blocked").length,
    exceptions: results.filter(result => result.exceptions.length > 0).length,
    judgeRequiredRejections: results.reduce((total, result) => total + result.judgeRequiredRejections, 0),
    terminationReasons,
    totalTurns: results.reduce((total, result) => total + result.turnNumber, 0),
    gamesWithReplayMismatch: results.filter(result => !result.replayMatches).length,
    gamesWithPrivacyLeak: results.filter(result => !result.privacySafe).length,
    results,
  };
}
