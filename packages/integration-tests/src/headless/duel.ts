import { createHash } from "node:crypto";
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import { createMatch, type Match, type MatchCard, type MatchDeck } from "../../../engine-core/dist/game/lifecycle.js";
import { projectFor, type ProjectionV2 } from "../../../engine-core/dist/projection/v2/index.js";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import { TestWorld, world } from "../../../engine-core/dist/effects/testing/test-kernel.js";
import { cardPrograms } from "../../../card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../card-dsl/dist/ir/types.js";
import { ChainContractBlockedError, type ChainDraft } from "../../../engine-core/dist/chain/engine.js";
import type { LocationRef, ObjectRef, ObjectSnapshot, PlayerId } from "../../../engine-core/dist/effects/contract.js";
import type { PipelineEvent, PipelineHost } from "../../../engine-core/dist/events/pipeline-types.js";
import type { M1PreconId } from "./decks.js";

import { TurnCombatBlockedError } from "../../../engine-core/dist/turn/flow.js";
import { CostPlanError } from "../../../engine-core/dist/cost/plan-types.js";
import { TriggerSpecValidationError } from "../../../engine-core/dist/events/trigger-spec.js";
import { TargetSelectionError } from "../../../engine-core/dist/target/target-plan.js";
import { movement, playLocations, restrictions } from "../../../engine-core/dist/layers/rules/query.js";
import {
  executeBasicRuneResourcePlan,
  planBasicRuneResourceActivation,
  type BasicRuneIdentity,
} from "../../../engine-core/dist/runes/index.js";

const { buildM1Deck, M1_DECK_IDS } = await import(new URL("./decks.ts", import.meta.url).href);

export const HEADLESS_SEEDS = Object.freeze(Array.from({ length: 20 }, (_, index) => `RIFT-345-seed-${index + 1}`));
export const HEADLESS_MATRIX_SEEDS = Object.freeze(HEADLESS_SEEDS.slice(0, 5));
export const DEFAULT_GAME_LIMIT = 100;
export const DEFAULT_TURN_LIMIT = 40;
export const DEFAULT_ACTION_LIMIT = 10_000;

export type HeadlessCommandType = "play" | "idle" | "pass" | "advance" | "move" | "rune-energy" | "combat-damage" | "concede";
export type HeadlessChoiceType = "optional" | "mode" | "number" | "select-objects" | "order";

export interface HeadlessActionCoverage {
  readonly commands: Readonly<Record<HeadlessCommandType, number>>;
  readonly choices: Readonly<Record<HeadlessChoiceType, number>>;
}

export interface HeadlessJudgeRequiredCardStat {
  readonly cardId: string;
  readonly name: string | null;
  readonly count: number;
}

export interface HeadlessDeckPair {
  readonly A: M1PreconId;
  readonly B: M1PreconId;
}

export interface HeadlessGameOptions {
  readonly maxTurns?: number;
  readonly maxActions?: number;
  readonly onJournal?: (journal: HeadlessJournal) => void;
  readonly decks?: readonly [M1PreconId, M1PreconId];
  readonly deckPair?: HeadlessDeckPair;
}

interface HeadlessNoProgressCache {
  before: string | null;
  readonly peek: (context: HeadlessContext) => string;
  readonly refresh: (context: HeadlessContext) => string;
  readonly invalidate: () => void;
}

export interface HeadlessGamesOptions extends HeadlessGameOptions {}

export interface HeadlessMatrixOptions {
  readonly games?: number;
  readonly seeds?: readonly string[];
  readonly decks?: readonly M1PreconId[];
  readonly maxTurns?: number;
  readonly maxActions?: number;
}

export interface HeadlessRegressionOptions {
  readonly maxTurns?: number;
  readonly maxActions?: number;
}

export interface HeadlessRegressionRun {
  readonly matrix: HeadlessMatrixSummary;
  readonly determinism: readonly [HeadlessStats, HeadlessStats];
  readonly blocked: HeadlessStats;
  readonly targets: HeadlessStats;
  readonly sourceTrigger: HeadlessStats;
  readonly tamper: { readonly journal: HeadlessJournal; readonly result: HeadlessStats };
  readonly aggregate: HeadlessRunSummary;
}

export interface HeadlessRegressionHarness {
  matrix(): HeadlessMatrixSummary;
  determinism(): readonly [HeadlessStats, HeadlessStats];
  blocked(): HeadlessStats;
  targets(): HeadlessStats;
  sourceTrigger(): HeadlessStats;
  tamper(): { readonly journal: HeadlessJournal; readonly result: HeadlessStats };
  aggregate(): HeadlessRunSummary;
}

/** Counts come only from committed engine events, never from bot intentions. */
export interface HeadlessBattleStats {
  readonly showdowns: number;
  readonly combats: number;
  readonly attacks: number;
  readonly defenses: number;
  readonly conquers: number;
  readonly scores: number;
  readonly points: number;
}

export interface HeadlessFailure {
  readonly name: string;
  readonly code: string;
  readonly message: string;
}

export type HeadlessCommand =
  | { readonly type: "play"; readonly player: PlayerId; readonly object: ObjectRef;
      readonly id: string; readonly location?: LocationRef }
  | { readonly type: "move"; readonly player: PlayerId; readonly object: ObjectRef; readonly to: LocationRef }
  | { readonly type: "rune-energy"; readonly player: PlayerId; readonly object: ObjectRef; readonly id: string }
  | { readonly type: "idle" | "pass"; readonly player: PlayerId }
  | { readonly type: "advance" | "combat-damage" };

export interface HeadlessJournalEntry {
  readonly command: HeadlessCommand;
  readonly failure: HeadlessFailure | null;
  /** Optional read-only observations from older and current journals remain replayable. */
  readonly trace?: HeadlessCommandTrace;
}

export interface HeadlessCommandTraceObject {
  readonly id: string;
  readonly cardId: string | null;
  readonly name: string;
  readonly controller: PlayerId;
  readonly zone: ObjectSnapshot["zone"];
  readonly location: LocationRef | null;
  readonly exhausted: boolean;
  readonly canMove: boolean;
  readonly canGank: boolean;
  readonly movementRestrictions: readonly string[];
}

export interface HeadlessBasicRuneTrace {
  readonly id: string;
  readonly name: string;
  readonly cardId: string | null;
  readonly domain: string | null;
  readonly exhausted: boolean;
}

export interface HeadlessCommandTrace {
  readonly turn: number;
  readonly turnPlayer: PlayerId;
  readonly phase: Match["flow"]["phase"];
  readonly priority: PlayerId | null;
  readonly focus: PlayerId | null;
  readonly turnState: Match["flow"]["chain"]["turnState"];
  readonly canActNormal: boolean;
  readonly candidateCounts: Readonly<Record<HeadlessCommandType, number>>;
  readonly boardUnits: readonly HeadlessCommandTraceObject[];
  readonly basicRunes: readonly HeadlessBasicRuneTrace[];
  readonly runePool: Readonly<Record<PlayerId, { readonly energy: number; readonly power: readonly string[] }>>;
  readonly candidates: readonly {
    readonly type: HeadlessCommandType;
    readonly id: string | null;
    readonly name: string | null;
    readonly object: ObjectRef;
    readonly energy: number | null;
    readonly power: readonly string[] | null;
    readonly types: readonly string[];
    readonly destination: LocationRef | null;
  }[];
  /** The public flow predicate that decides whether this Command may end Main. */
  readonly canEndTurn: boolean;
  readonly emptyRunePoolBlocked: boolean;
}

export interface HeadlessObservedActionCoverage extends HeadlessActionCoverage {
  /** Play commands whose authoritative Play action committed, including zero-cost cards. */
  readonly committedPlays: number;
  /** Play commands rejected because the locked cost was not payable. */
  readonly rejectedPlays: number;
}

export interface HeadlessStats {
  readonly seed: string;
  readonly decks: HeadlessDeckPair;
  readonly winner: PlayerId | null;
  readonly turnNumber: number;
  readonly termination: "winner" | "concede" | "blocked" | "exception" | "guard";
  readonly guardReason: "turn-limit" | "action-limit" | "no-progress" | null;
  readonly blockers: readonly HeadlessFailure[];
  readonly scores: Readonly<Record<PlayerId, number>>;
  readonly victoryScore: number;
  readonly battleStats: HeadlessBattleStats;
  readonly privacyChecks: number;
  readonly exceptions: readonly string[];
  readonly judgeRequiredRejections: number;
  readonly judgeRequiredCards: readonly string[];
  readonly judgeRequiredCardCounts: readonly HeadlessJudgeRequiredCardStat[];
  readonly judgeRequiredTop: readonly HeadlessJudgeRequiredCardStat[];
  readonly actionCoverage: HeadlessActionCoverage;
  readonly observedActions: HeadlessObservedActionCoverage;
  readonly eventCount: number;
  readonly journalDigest: string;
  readonly projectionDigests: Readonly<Record<PlayerId, string>>;
  readonly replayMatches: boolean;
  readonly privacySafe: boolean;
}

export type HeadlessTerminationClass = "natural" | "nonNatural" | "invalid";

function knownPlayerId(value: PlayerId | null): PlayerId | null {
  return value === "A" || value === "B" ? value : null;
}

/** Classify only evidence committed by the authoritative match and replay audit. */
export function headlessTerminationClass(result: HeadlessStats): HeadlessTerminationClass {
  if (!result.replayMatches || !result.privacySafe) return "invalid";
  const winner = knownPlayerId(result.winner);
  const naturalWin = result.termination === "winner" && winner !== null &&
    result.guardReason === null && result.blockers.length === 0 && result.exceptions.length === 0 &&
    result.actionCoverage.commands.concede === 0 &&
    result.scores[winner]! >= result.victoryScore &&
    result.battleStats.scores > 0 && result.battleStats.points >= result.victoryScore;
  if (naturalWin) return "natural";
  const noConcession = result.actionCoverage.commands.concede === 0;
  const unfinished = result.termination === "guard" && result.winner === null && result.guardReason !== null &&
    result.blockers.length === 0 && result.exceptions.length === 0 && noConcession;
  const blocked = result.termination === "blocked" && result.winner === null && result.guardReason === null &&
    result.blockers.length > 0 && result.exceptions.length === 0 && noConcession;
  const exception = result.termination === "exception" && result.winner === null && result.guardReason === null &&
    result.blockers.length === 0 && result.exceptions.length > 0 && noConcession;
  const concession = result.termination === "concede" && winner !== null && result.guardReason === null &&
    result.blockers.length === 0 && result.exceptions.length === 0 &&
    result.actionCoverage.commands.concede > 0 &&
    result.scores[winner]! < result.victoryScore;
  return unfinished || blocked || exception || concession ? "nonNatural" : "invalid";
}

export interface HeadlessRunSummary {
  readonly games: number;
  readonly decks: HeadlessDeckPair;
  readonly completed: number;
  readonly blocked: number;
  readonly exceptions: number;
  readonly judgeRequiredRejections: number;
  readonly judgeRequiredCards: readonly string[];
  readonly judgeRequiredCardCounts: readonly HeadlessJudgeRequiredCardStat[];
  readonly judgeRequiredTop: readonly HeadlessJudgeRequiredCardStat[];
  readonly actionCoverage: HeadlessActionCoverage;
  readonly terminationReasons: Readonly<Record<HeadlessStats["termination"], number>>;
  readonly totalTurns: number;
  readonly winners: number;
  readonly winnerRatio: number;
  readonly winsByPlayer: Readonly<Record<PlayerId, number>>;
  readonly averageTurns: number;
  readonly battleStats: HeadlessBattleStats;
  readonly blockerReasons: Readonly<Record<string, number>>;
  readonly gamesWithReplayMismatch: number;
  readonly gamesWithPrivacyLeak: number;
  readonly results: readonly HeadlessStats[];
}

export interface HeadlessMatrixPairSummary extends HeadlessRunSummary {
  readonly decks: HeadlessDeckPair;
}

export interface HeadlessMatrixSummary {
  readonly games: number;
  readonly decks: readonly M1PreconId[];
  readonly pairings: readonly HeadlessMatrixPairSummary[];
  readonly completed: number;
  readonly blocked: number;
  readonly exceptions: number;
  readonly judgeRequiredRejections: number;
  readonly judgeRequiredCards: readonly string[];
  readonly judgeRequiredCardCounts: readonly HeadlessJudgeRequiredCardStat[];
  readonly judgeRequiredTop: readonly HeadlessJudgeRequiredCardStat[];
  readonly actionCoverage: HeadlessActionCoverage;
  readonly terminationReasons: Readonly<Record<HeadlessStats["termination"], number>>;
  readonly totalTurns: number;
  readonly winners: number;
  readonly winnerRatio: number;
  readonly winsByPlayer: Readonly<Record<PlayerId, number>>;
  readonly averageTurns: number;
  readonly battleStats: HeadlessBattleStats;
  readonly blockerReasons: Readonly<Record<string, number>>;
  readonly gamesWithReplayMismatch: number;
  readonly gamesWithPrivacyLeak: number;
  readonly results: readonly HeadlessStats[];
}

interface MutableCounters {
  judgeRequiredRejections: number;
  readonly judgeRequiredCards: Map<string, { readonly name: string | null; count: number }>;
  readonly actionCoverage: {
    readonly commands: Record<HeadlessCommandType, number>;
    readonly choices: Record<HeadlessChoiceType, number>;
  };
}

interface HeadlessWorld {
  readonly kernel: TestWorld;
  readonly host: PipelineHost & { readonly player: (id: PlayerId) => ReturnType<TestWorld["player"]> };
  readonly counters: MutableCounters;
  readonly projectionInput: (match?: Match, events?: readonly unknown[]) => Parameters<typeof projectFor>[0];
  readonly invalidateProjection: () => void;
  readonly primeCheckpoint: (checkpoint: HeadlessWorldCheckpoint) => void;
  readonly invalidateCheckpoint: () => void;
}

export interface HeadlessWorldCheckpoint {
  readonly state: ReturnType<TestWorld["snapshot"]>;
  readonly links: TestWorld;
}

export interface HeadlessCheckpointManager {
  checkpoint(): HeadlessWorldCheckpoint;
  restore(checkpoint: unknown): void;
  invalidate(): void;
}

export interface HeadlessJournal {
  readonly seed: string;
  readonly decks: HeadlessDeckPair;
  readonly mulligans: readonly [readonly string[], readonly string[]];
  readonly commands: readonly HeadlessJournalEntry[];
  readonly events: readonly PipelineEvent[];
  readonly final: Readonly<Record<string, unknown>>;
  /** Digest of all replay inputs. Older journals without it remain replayable. */
  readonly integrity?: string;
}

interface FinalStateCheckpointSink {
  checkpoint?: HeadlessWorldCheckpoint;
}

type DraftableCard = ObjectSnapshot & { readonly cardId: string };

interface HeadlessContext {
  readonly state: HeadlessWorld;
  readonly decks: HeadlessDeckPair;
  readonly mulligans: readonly [readonly string[], readonly string[]];
  readonly programs: ReturnType<typeof createProgramBinding>;
  readonly basicRuneDomain: (cardId: string | null) => string | null;
  readonly basicRuneIdentity: (cardId: string) => BasicRuneIdentity | null;
  readonly m1Pair: boolean;
  readonly match: Match;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, entry: unknown) =>
    entry instanceof Map ? { map: [...entry] } : entry instanceof Set ? { set: [...entry] } : entry)).digest("hex");
}

function journalContent(journal: HeadlessJournal): Omit<HeadlessJournal, "integrity"> {
  const { integrity: _integrity, ...content } = journal;
  return content;
}

function journalHasValidIntegrity(journal: HeadlessJournal): boolean {
  return journal.integrity === undefined || digest(journalContent(journal)) === journal.integrity;
}

function replayHeadlessGame(journal: HeadlessJournal): boolean {
  try {
    if (!journalHasValidIntegrity(journal)) return false;
    const context = createHeadlessContext(journal.seed, journal.mulligans, journal.decks);
    for (const entry of journal.commands) {
      let failure: HeadlessFailure | null = null;
      try { executeCommand(context, entry.command); }
      catch (error) { failure = failureOf(error); }
      if (digest(failure) !== digest(entry.failure)) return false;
    }
    return digest(context.match.events()) === digest(journal.events) &&
      digest(finalState(context)) === digest(journal.final);
  } catch { return false; }
}

function stableSeed(seed: string): number {
  let value = 0x811c9dc5;
  for (const character of seed) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

function emptyActionCoverage(): MutableCounters["actionCoverage"] {
  return {
    commands: { play: 0, idle: 0, pass: 0, advance: 0, move: 0, "rune-energy": 0,
      "combat-damage": 0, concede: 0 },
    choices: { optional: 0, mode: 0, number: 0, "select-objects": 0, order: 0 },
  };
}

function recordCommand(counters: MutableCounters, command: HeadlessCommandType): void {
  counters.actionCoverage.commands[command] += 1;
}

function recordJudgeRequired(counters: MutableCounters, cardId: string, name?: string | null): void {
  counters.judgeRequiredRejections += 1;
  const existing = counters.judgeRequiredCards.get(cardId);
  if (existing) {
    existing.count += 1;
  } else {
    counters.judgeRequiredCards.set(cardId, { name: name ?? null, count: 1 });
  }
}

/**
 * Capture one authoritative state copy. `TestWorld.clone()` snapshots again
 * internally, so using `{ state: kernel.snapshot(), links: kernel.clone() }`
 * doubled the dominant transaction cost on every ChainEngine checkpoint.
 * The link holder only needs the linked-value map; `copyLinkedFrom` ignores
 * its state and source snapshots.
 */
export function checkpointHeadlessWorld(kernel: TestWorld): HeadlessWorldCheckpoint {
  const state = kernel.snapshot();
  const links = new TestWorld({
    state,
    sourceSnapshot: kernel.source,
    controller: kernel.controller,
    timingPoint: kernel.timingPoint,
    linked: new Map(Object.entries(kernel.linkedSnapshot())),
  });
  return { state, links };
}

export function restoreHeadlessWorld(kernel: TestWorld, checkpoint: HeadlessWorldCheckpoint): void {
  kernel.restore(checkpoint.state);
  kernel.copyLinkedFrom(checkpoint.links);
}

/**
 * A ChainEngine transaction can create nested checkpoints before its first
 * mutation. Those checkpoints observe the same state, so capture it lazily and
 * reuse it until an authoritative mutation invalidates the cache.
 */
export function createHeadlessCheckpointManager(kernel: TestWorld): HeadlessCheckpointManager {
  let cached: HeadlessWorldCheckpoint | undefined;
  return {
    checkpoint: () => cached ??= checkpointHeadlessWorld(kernel),
    restore: checkpoint => {
      restoreHeadlessWorld(kernel, checkpoint as HeadlessWorldCheckpoint);
      cached = undefined;
    },
    invalidate: () => { cached = undefined; },
  };
}

function judgeRequiredCardCounts(counters: MutableCounters): readonly HeadlessJudgeRequiredCardStat[] {
  return [...counters.judgeRequiredCards.entries()]
    .map(([cardId, value]) => ({ cardId, name: value.name, count: value.count }))
    .sort((left, right) => right.count - left.count || left.cardId.localeCompare(right.cardId));
}

function judgeRequiredCardIds(cards: readonly HeadlessJudgeRequiredCardStat[]): readonly string[] {
  return cards.map(card => card.cardId).sort();
}

function mergeActionCoverage(
  target: MutableCounters["actionCoverage"],
  source: HeadlessActionCoverage,
): void {
  for (const type of Object.keys(target.commands) as HeadlessCommandType[]) target.commands[type] += source.commands[type];
  for (const type of Object.keys(target.choices) as HeadlessChoiceType[]) target.choices[type] += source.choices[type];
}

function mergeJudgeRequiredCards(
  target: Map<string, { readonly name: string | null; count: number }>,
  source: readonly HeadlessJudgeRequiredCardStat[],
): void {
  for (const card of source) {
    const existing = target.get(card.cardId);
    if (existing) existing.count += card.count;
    else target.set(card.cardId, { name: card.name, count: card.count });
  }
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

/**
 * Guard no progress from a fresh logical engine digest. Accepted commands
 * invalidate the cached value before they can mutate authoritative state, so
 * the next read proves the resulting state; rejected commands leave it intact.
 */
function createNoProgressCache(): HeadlessNoProgressCache {
  let stateDigest: string | null = null;
  const calculate = (context: HeadlessContext): string => {
    const sink: FinalStateCheckpointSink = {};
    stateDigest = digest(finalState(context, false, sink));
    context.state.primeCheckpoint(sink.checkpoint!);
    return stateDigest;
  };
  return {
    before: null,
    peek: context => stateDigest ?? calculate(context),
    refresh: calculate,
    invalidate: () => { stateDigest = null; },
  };
}

function makeWorld(seed: string): HeadlessWorld {
  const builder = world(stableSeed(`${seed}:kernel`)).player("A").player("B");
  const kernel = builder.build();
  let objectRevision = 0;
  let cachedObjectRevision = -1;
  let cachedObjects: readonly ObjectSnapshot[] = [];
  const objects = (): readonly ObjectSnapshot[] => {
    if (cachedObjectRevision !== objectRevision) {
      cachedObjects = kernel.objects;
      cachedObjectRevision = objectRevision;
    }
    return cachedObjects;
  };
  let projectionRevision = 0;
  let projectionInputRevision = -1;
  let cachedProjectionBase: Parameters<typeof projectFor>[0] | undefined;
  const invalidateProjection = (): void => { projectionRevision += 1; };
  const projectionInput = (match?: Match, events: readonly unknown[] = kernel.events): Parameters<typeof projectFor>[0] => {
    if (projectionInputRevision !== projectionRevision || cachedProjectionBase === undefined) {
      cachedProjectionBase = projectionBaseInputForKernel(kernel, match);
      projectionInputRevision = projectionRevision;
    }
    return { ...cachedProjectionBase, stateVersion: kernel.events.length, eventSeq: kernel.events.length, events };
  };
  const counters: MutableCounters = {
    judgeRequiredRejections: 0,
    judgeRequiredCards: new Map(),
    actionCoverage: emptyActionCoverage(),
  };
  const checkpoints = createHeadlessCheckpointManager(kernel);
  let primedCheckpoint: HeadlessWorldCheckpoint | undefined;
  const checkpoint = () => {
    const primed = primedCheckpoint;
    primedCheckpoint = undefined;
    return primed ?? checkpoints.checkpoint();
  };
  const invalidateCheckpoint = () => { primedCheckpoint = undefined; checkpoints.invalidate(); };
  const choiceRandom = new BotRandom(`${seed}:choices`);
  const choose = <T>(request: Parameters<PipelineHost["choose"]>[0]): T => botChoice(choiceRandom, request, counters) as T;
  const hostBase = createActionPipelineHost({
    checkpoint,
    restore: snapshot => {
      checkpoints.restore(snapshot);
      primedCheckpoint = undefined;
      objectRevision += 1;
      invalidateProjection();
    },
    objects,
    perform: action => {
      objectRevision += 1;
      checkpoints.invalidate();
      invalidateProjection();
      return kernel.perform(action);
    },
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      choose,
      link: (key, value) => {
        checkpoints.invalidate();
        invalidateProjection();
        kernel.link(key, value);
      },
    }),
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(hostBase)), hostBase, {
    player: (id: PlayerId) => kernel.player(id),
  }) as HeadlessWorld["host"];
  return {
    kernel,
    host,
    counters,
    projectionInput,
    invalidateProjection,
    primeCheckpoint: value => { primedCheckpoint = value; checkpoints.invalidate(); },
    invalidateCheckpoint,
  };
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
  location: LocationRef | undefined,
  counters: MutableCounters,
  id: string,
): ChainDraft | null {
  const status = cardProgramStatus(source.cardId);
  if (status !== "executable") {
    if (status === "judge-required") {
      recordJudgeRequired(counters, source.cardId, source.name);
    }
    return null;
  }
  try {
    const draft = binding.describePlay({ type: "play", object: source.ref, player, ...(location ? { location } : {}) }, source);
    // ProgramBinding's process-global sequence must not make journals depend on
    // previous games. This is a command identity, with no rules or cost override.
    return { ...draft, id, ...(draft.cost ? { cost: { ...draft.cost, id: `cost:${id}` } } : {}) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/judge|required|program|battlefield location filters|no playable|unbound|unknown-program|invalid-program/i.test(message)) {
      recordJudgeRequired(counters, source.cardId, source.name);
      return null;
    }
    throw error;
  }
}

/** Audit all surfaces, including events/choices/chain, for hidden identities. */
export function headlessProjectionLeaks(projection: ProjectionV2, hiddenRefs: readonly ObjectRef[] = []): readonly string[] {
  const leaks: string[] = [];
  const hidden = new Set(hiddenRefs.map(ref => `${ref.id}:${ref.zoneEntryId}`));
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return; }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (object.visibility === "face-down") {
      if (typeof object.id !== "string" || !object.id.startsWith("hidden:")) leaks.push(`${path}.id`);
      for (const key of ["cardId", "name", "types", "tags", "keywords", "energy", "power", "might", "cost", "isToken"]) {
        if (key in object) leaks.push(`${path}.${key}`);
      }
    }
    const ref = object.ref && typeof object.ref === "object" ? object.ref as Record<string, unknown> : object;
    if (typeof ref.id === "string" && hidden.has(`${ref.id}:${ref.zoneEntryId}`)) leaks.push(`${path}.ref`);
    for (const [key, entry] of Object.entries(object)) visit(entry, `${path}.${key}`);
  };
  visit(projection, "projection");
  for (const player of Object.values(projection.players)) {
    const zones = [player.mainDeck, player.deck, player.runeDeck,
      ...(player.id !== projection.viewer ? [player.hand] : [])];
    if (zones.some(zone => zone.cards.some(card => card.visibility === "identity"))) leaks.push(`players.${player.id}.private-zone`);
  }
  return leaks;
}

function projectionBaseInputForKernel(kernel: TestWorld, match?: Match): Parameters<typeof projectFor>[0] {
  const players = ["A", "B"] as const;
  const objects = kernel.objects;
  const objectsById = new Map(objects.map(object => [object.ref.id, object]));
  return {
    phase: match?.flow.phase ?? "playing",
    turn: match?.flow.turn,
    priorityPlayerId: match?.flow.chain.priority,
    focusPlayerId: match?.flow.chain.focus,
    chain: match?.flow.chain.items.map(item => ({ id: item.id, controller: item.controller, status: item.status, source: item.source.ref, object: item.object })),
    players: players.map(id => {
      const player = kernel.player(id);
      const cards = (zone: Parameters<TestWorld["objectsInZone"]>[1]) => kernel.objectsInZone(id, zone).map(ref => {
        const object = objectsById.get(ref.id)!;
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
    objects: objects.map(object => ({
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
  };
}

function projectionForKernel(
  state: HeadlessWorld,
  viewer: PlayerId | "spectator",
  match?: Match,
  events: readonly unknown[] = state.kernel.events,
): ReturnType<typeof projectFor> {
  return projectFor(state.projectionInput(match, events), viewer);
}

function botChoice(
  random: BotRandom,
  request: Parameters<NonNullable<PipelineHost["choose"]>>[0],
  counters: MutableCounters,
): unknown {
  counters.actionCoverage.choices[request.type] += 1;
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

const DEFAULT_DECK_PAIR: HeadlessDeckPair = Object.freeze({ A: "rumble-sfd", B: "fiora-sfd" });

function deckPairFromIds(ids: readonly [M1PreconId, M1PreconId]): HeadlessDeckPair {
  if (ids[0] === ids[1]) throw new RangeError("Headless deck pair must contain two different decks");
  return { A: ids[0], B: ids[1] };
}

function createHeadlessContext(
  seed: string,
  requestedMulligans?: readonly [readonly string[], readonly string[]],
  pair: HeadlessDeckPair = DEFAULT_DECK_PAIR,
): HeadlessContext {
  const decks = [cloneDeck(buildM1Deck(pair.A, "A"), "A"), cloneDeck(buildM1Deck(pair.B, "B"), "B")] as const;
  const programs = createProgramBinding({ cardPrograms: cardPrograms as unknown as readonly CardProgram[] });
  const mulligans = requestedMulligans ?? chooseMulligans(seed, openingHandsFor(seed, decks));
  const state = makeWorld(seed);
  const match = setupMatch(seed, state, programs, decks, mulligans);
  const runeDomains = new Map<string, string>();
  const runeIdentities = new Map<string, BasicRuneIdentity>();
  for (const card of [...decks[0].runeDeck, ...decks[1].runeDeck]) {
    if (card.cardId && card.tags?.includes("Basic") && card.domains?.length === 1) {
      runeDomains.set(card.cardId, card.domains[0]!);
      const domain = card.domains[0];
      if (card.canonicalCardId && domain && ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"].includes(domain)) {
        runeIdentities.set(card.cardId, { cardId: card.cardId, canonicalCardId: card.canonicalCardId,
          domain: domain as BasicRuneIdentity["domain"] });
      }
    }
  }
  programs.attachLifecycle(match.flow.chain, (error, source) => {
    if (cardProgramStatus(source.cardId) !== "executable" || error instanceof TriggerSpecValidationError ||
      error instanceof Error && "code" in error && error.code === "judge-required") {
      recordJudgeRequired(state.counters, source.cardId ?? source.ref.id, source.name);
    }
    // Unsupported lifecycle work must block, never silently drop a trigger.
    throw error;
  });
  return { state, decks: pair, mulligans, programs,
    basicRuneDomain: cardId => cardId === null ? null : runeDomains.get(cardId) ?? null,
    basicRuneIdentity: cardId => runeIdentities.get(cardId) ?? null,
    m1Pair: pair.A === "rumble-sfd" && pair.B === "fiora-sfd" ||
      pair.A === "fiora-sfd" && pair.B === "rumble-sfd", match };
}

class HeadlessContractBlockedError extends Error {
  readonly status = "blocked";
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "HeadlessContractBlockedError"; }
}

function failureOf(error: unknown): HeadlessFailure {
  if (error instanceof TurnCombatBlockedError || error instanceof HeadlessContractBlockedError) {
    return { name: error.name, code: error.code, message: error.message };
  }
  if (error instanceof TriggerSpecValidationError) {
    return { name: error.name, code: "unsupported-trigger-spec", message: error.message };
  }
  if (error instanceof ChainContractBlockedError) {
    return { name: error.name, code: /printed Energy/i.test(error.message) ? "missing-printed-cost" : "chain-contract", message: error.message };
  }
  return { name: error instanceof Error ? error.name : "Error",
    code: error instanceof CostPlanError ? error.reason : error instanceof Error && "code" in error ? String(error.code) : "command-rejected",
    message: error instanceof Error ? error.message : String(error) };
}

function isBlocked(error: unknown): boolean {
  return error instanceof ChainContractBlockedError || error instanceof TurnCombatBlockedError || error instanceof TriggerSpecValidationError ||
    error instanceof HeadlessContractBlockedError ||
    (error instanceof Error && "code" in error && ["judge-required", "unknown-program", "invalid-program"].includes(String(error.code)));
}

function isLegalRejection(error: unknown): boolean {
  if (error instanceof CostPlanError) return error.reason === "cannot-pay-cost";
  if (error instanceof TargetSelectionError) return error.code === "no-legal-targets" || error.code === "target-tax-unpayable";
  return error instanceof Error && ["Action is not legally timed", "Action is restricted by a continuous rule",
    "Play destination is not legally allowed", "Finalize legality failed", "Illegal Standard Move"].includes(error.message);
}

function executeCommand(context: HeadlessContext, command: HeadlessCommand): void {
  const { match, state, programs } = context;
  try {
    switch (command.type) {
      case "idle": match.flow.endTurn(command.player); return;
      case "pass": match.flow.pass(command.player); return;
      case "advance": match.flow.advance(); return;
      case "combat-damage": match.flow.combat.dealDamage(); return;
      case "move":
        if (command.to.type === "base") {
          throw new HeadlessContractBlockedError("standard-move-base-destination",
            "TurnFlow.move accepts only a Battlefield id; no public atomic Standard Move command accepts a Base destination (CR 144.4.b)");
        }
        match.flow.move(command.player, command.object, command.to.id);
        return;
      case "rune-energy": {
        const source = state.kernel.objects.find(object => object.ref.id === command.object.id &&
          object.ref.zoneEntryId === command.object.zoneEntryId);
        if (!source) throw new Error("Missing owned Basic Rune source");
        const plan = planBasicRuneResourceActivation({
          chain: match.flow.chain,
          state: { objects: () => state.kernel.objects, player: id => state.kernel.player(id) },
          resolveIdentity: context.basicRuneIdentity,
          request: { actor: command.player, activationId: command.id,
            intent: { type: "rune-energy", runeObjectId: source.ref.id, zoneEntryId: source.ref.zoneEntryId },
            window: { kind: "priority" } },
        });
        executeBasicRuneResourcePlan(plan);
        return;
      }
      case "play": {
        const source = state.kernel.objects.find(object => object.ref.id === command.object.id &&
          object.ref.zoneEntryId === command.object.zoneEntryId) as DraftableCard | undefined;
        if (!source || source.zone !== "hand" || source.controller !== command.player) throw new Error("Missing owned Hand source");
        const draft = createBotDraft(programs, source, command.player, command.location, state.counters, command.id);
        if (!draft) throw new HeadlessContractBlockedError("unsupported-program", "No executable CardProgram for the requested play");
        match.flow.execute(draft);
      }
    }
  } finally {
    // Chain phase, priority and chain items can change without a kernel action.
    state.invalidateProjection();
  }
}

function executeGuardedCommand(
  context: HeadlessContext,
  command: HeadlessCommand,
  noProgress: HeadlessNoProgressCache,
): void {
  noProgress.invalidate();
  try { executeCommand(context, command); }
  finally { context.state.invalidateCheckpoint(); }
}

/** Candidates are timing/permission filtered; the public command still owns final legality and cost checks. */
function enumerateCandidates(context: HeadlessContext, sequence: number): readonly HeadlessCommand[] {
  const { match, state, programs } = context;
  const flow = match.flow;
  const chain = flow.chain;
  const player = chain.priority;
  if (!player || flow.phase !== "main") return [];
  const commands: HeadlessCommand[] = [];
  chain.layers.setObjects(state.kernel.objects);
  const objects = chain.layers.evaluateAll();
  if (!flow.combat.active && chain.turnState === "neutral-open" && chain.canAct(player, "normal")) {
    for (const object of objects) {
      if (object.controller !== player || object.zone !== "board" || !object.types.includes("unit") || object.exhausted || !object.location) continue;
      const permission = movement(chain.layers.registry, object.ref, object, player);
      if (!permission.canMove || restrictions(chain.layers.registry, "move", object.ref, object, player).length) continue;
      if (object.location.type === "battlefield") {
        commands.push({ type: "move", player, object: object.ref, to: { type: "base", player } });
      }
      if (object.location.type === "base" || permission.canGank) {
        for (const field of flow.battlefields) {
          if (object.location.type === "battlefield" && object.location.id === field.id) continue;
          commands.push({ type: "move", player, object: object.ref, to: { type: "battlefield", id: field.id } });
        }
      }
    }
  }
  for (const source of objects) {
    if (source.controller !== player || source.zone !== "hand" || !source.cardId) continue;
    // Prefer the legal default Base. A permanent may also be played to an
    // already controlled Battlefield. Entering an arbitrary enemy field is not a play permission.
    const locations: (LocationRef | undefined)[] = source.types.some(type => type === "unit" || type === "gear")
      ? [{ type: "base", player }, ...flow.battlefields.filter(field => field.controller === player)
        .map(field => ({ type: "battlefield" as const, id: field.id }))] : [undefined];
    const locationRules = playLocations(chain.layers.registry, source.ref, source, player);
    for (const location of locations) {
      if (location && locationRules.restrictions.some(rule =>
        [`no-${location.type}`, `cannot-${location.type}`, `cannot-play-${location.type}`].includes(rule.name.toLowerCase()))) continue;
      const id = `headless:${sequence}:${source.ref.id}:${source.ref.zoneEntryId}:${location?.type ?? "spell"}:${location?.type === "battlefield" ? location.id : player}`;
      const draft = createBotDraft(programs, source as DraftableCard, player, location, state.counters, id);
      if (!draft) continue;
      const reaction = draft.conditionalReaction && state.host.context(source, player, "chain-item-finalize").test(draft.conditionalReaction);
      const speed = reaction ? "reaction" : draft.speed ?? "normal";
      if (chain.canAct(player, speed, source.ref, source)) {
        commands.push({ type: "play", player, object: source.ref, id, ...(location ? { location } : {}) });
      }
    }
  }
  if (context.m1Pair && flow.phase === "main" && !flow.combat.active &&
      chain.turnState === "neutral-open" && chain.canAct(player, "reaction") && chain.canAct(player, "normal")) {
    const pool = state.kernel.player(player).energy;
    const runes = objects.filter(object => object.controller === player && object.zone === "rune-zone" &&
      !object.exhausted && object.cardId !== null && context.basicRuneIdentity(object.cardId) !== null);
    const playableUnits = commands.filter((command): command is Extract<HeadlessCommand, { type: "play" }> =>
      command.type === "play").flatMap(command => {
        const source = objects.find(object => object.ref.id === command.object.id &&
          object.ref.zoneEntryId === command.object.zoneEntryId);
        return source?.types.includes("unit") && source.energy !== null ? [{ source, energy: source.energy }] : [];
      }).sort((left, right) => left.energy - right.energy);
    const target = playableUnits.find(candidate => candidate.energy > pool && candidate.energy <= pool + runes.length &&
      candidate.source.power === null);
    if (target) {
      const energyShortfall = target.energy - pool;
      const powerShortfall = target.source.power === null ? 0 :
        typeof target.source.power === "number" ? target.source.power : target.source.power.length;
      for (const rune of runes.slice(0, energyShortfall + powerShortfall)) {
        commands.push({ type: "rune-energy", player, object: rune.ref,
          id: `headless:rune-energy:${sequence}:${rune.ref.id}:${rune.ref.zoneEntryId}:${player}` });
      }
    }
  }
  return commands;
}

function finalState(
  context: HeadlessContext,
  includeProjections = true,
  checkpointSink?: FinalStateCheckpointSink,
): Readonly<Record<string, unknown>> {
  const { match, state } = context;
  const checkpoint = checkpointHeadlessWorld(state.kernel);
  if (checkpointSink) checkpointSink.checkpoint = checkpoint;
  return {
    ...match.result(), scoreA: state.kernel.player("A").score, scoreB: state.kernel.player("B").score,
    victoryScore: match.flow.victoryScore, phase: match.flow.phase, turnPlayer: match.flow.turnPlayer,
    priority: match.flow.chain.priority, focus: match.flow.chain.focus,
    battlefields: match.flow.battlefields, combat: match.flow.combat.current,
    stateDigest: digest(checkpoint.state), linkedDigest: digest(checkpoint.links.linkedSnapshot()), chainDigest: digest(match.flow.chain.items),
    traceDigest: digest(match.flow.chain.trace),
    ...(includeProjections ? { projections: Object.fromEntries((["A", "B", "spectator"] as const)
      .map(viewer => [viewer, digest(projectionForKernel(state, viewer, match))])) } : {}),
  };
}

/** Re-execute accepted AND rejected commands, and compare the complete event stream and final state. */
export function replayHeadlessJournal(journal: HeadlessJournal): boolean {
  return replayHeadlessGame(journal);
}

function battleStats(events: readonly PipelineEvent[]): HeadlessBattleStats {
  const count = (timing: PipelineEvent["timingPoint"]) => events.filter(event => event.timingPoint === timing).length;
  return { showdowns: count("showdown-open"), combats: count("combat-start"), attacks: count("attack-declared"),
    defenses: count("defense-declared"), conquers: count("conquer"), scores: count("score"),
    points: events.filter(event => event.timingPoint === "points-gained" || event.timingPoint === "score" && event.action?.type === "score")
      .reduce((sum, event) => sum + (event.amount ?? 0), 0) };
}

function traceObject(context: HeadlessContext, object: ObjectSnapshot): HeadlessCommandTraceObject {
  const permission = movement(context.match.flow.chain.layers.registry, object.ref, object, object.controller);
  return { id: object.ref.id, cardId: object.cardId, name: object.name, controller: object.controller,
    zone: object.zone, location: object.location, exhausted: object.exhausted,
    canMove: permission.canMove, canGank: permission.canGank,
    movementRestrictions: restrictions(context.match.flow.chain.layers.registry, "move",
      object.ref, object, object.controller).flatMap(rule => rule.name === undefined ? [] : [rule.name]) };
}

function boardUnitTrace(context: HeadlessContext, player?: PlayerId): readonly HeadlessCommandTraceObject[] {
  const { match, state } = context;
  match.flow.chain.layers.setObjects(state.kernel.objects);
  return match.flow.chain.layers.evaluateAll()
    .filter(object => object.zone === "board" && object.types.includes("unit") &&
      (player === undefined || object.controller === player))
    .map(object => traceObject(context, object));
}

function commandTrace(context: HeadlessContext, candidates: readonly HeadlessCommand[]): HeadlessCommandTrace {
  const { match, state } = context;
  const counts: Record<HeadlessCommandType, number> = { play: 0, idle: 0, pass: 0, advance: 0, move: 0,
    "rune-energy": 0, "combat-damage": 0, concede: 0 };
  for (const command of candidates) counts[command.type] += 1;
  const objects = new Map(state.kernel.objects.map(object => [
    `${object.ref.id}:${object.ref.zoneEntryId}`, object]));
  return { turn: match.flow.turn, turnPlayer: match.flow.turnPlayer, phase: match.flow.phase,
    priority: match.flow.chain.priority, focus: match.flow.chain.focus,
    turnState: match.flow.chain.turnState,
    canActNormal: match.flow.chain.priority !== null && match.flow.chain.canAct(match.flow.chain.priority, "normal"),
    canEndTurn: match.flow.phase === "main" && match.flow.turnPlayer === match.flow.chain.priority &&
      match.flow.chain.items.length === 0 && !match.flow.combat.active &&
      match.flow.chain.canAct(match.flow.turnPlayer, "normal"),
    emptyRunePoolBlocked: (["A", "B"] as const).some(id => {
      const player = state.kernel.player(id);
      return player.energy !== 0 || player.power.length !== 0;
    }),
    candidateCounts: counts, boardUnits: boardUnitTrace(context),
    basicRunes: state.kernel.objects.filter(object => object.zone === "rune-zone" &&
      object.types.some(type => type.toLowerCase() === "rune")).map(object => ({ id: object.ref.id,
        name: object.name, cardId: object.cardId, domain: context.basicRuneDomain(object.cardId),
        exhausted: object.exhausted })),
    runePool: Object.fromEntries((["A", "B"] as const).map(id => [id,
      { energy: state.kernel.player(id).energy, power: [...state.kernel.player(id).power] }])),
    candidates: candidates.map(command => {
      const object = "object" in command ? objects.get(`${command.object.id}:${command.object.zoneEntryId}`) : undefined;
      return { type: command.type, id: "id" in command ? command.id : null, name: object?.name ?? null,
        object: "object" in command ? command.object : { id: "none", zoneEntryId: 0 },
        energy: object?.energy ?? null, power: object?.power === null || object?.power === undefined ? null : [...object.power],
        types: object?.types === undefined ? [] : [...object.types],
        destination: command.type === "move" ? command.to : command.type === "play" ? command.location ?? null : null };
    }) };
}

function observedActionCoverage(commands: readonly HeadlessJournalEntry[], actionCoverage: HeadlessActionCoverage): HeadlessObservedActionCoverage {
  return { ...actionCoverage,
    committedPlays: commands.filter(entry => entry.command.type === "play" && entry.failure === null).length,
    rejectedPlays: commands.filter(entry => entry.command.type === "play" &&
      entry.failure?.code === "cannot-pay-cost").length };
}

export function runHeadlessGame(seed: string, options: HeadlessGameOptions = {}): HeadlessStats {
  const maxTurns = options.maxTurns ?? DEFAULT_TURN_LIMIT;
  const maxActions = options.maxActions ?? DEFAULT_ACTION_LIMIT;
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) throw new RangeError("maxTurns must be a positive integer");
  if (!Number.isSafeInteger(maxActions) || maxActions < 1) throw new RangeError("maxActions must be a positive integer");
  const decks = options.deckPair ?? deckPairFromIds(options.decks ?? [DEFAULT_DECK_PAIR.A, DEFAULT_DECK_PAIR.B]);
  const context = createHeadlessContext(seed, undefined, decks);
  const { match, state } = context;
  const random = new BotRandom(`${seed}:bot`);
  const commands: HeadlessJournalEntry[] = [];
  const exceptions: string[] = [];
  const blockers: HeadlessFailure[] = [];
  let termination: HeadlessStats["termination"] = "guard";
  let guardReason: HeadlessStats["guardReason"] = null;
  let privacySafe = true;
  let privacyChecks = 0;
  let auditedEventCount = 0;
  const checkPrivacy = () => {
    const unauditedEvents = state.kernel.events.slice(auditedEventCount);
    const objects = state.kernel.objects;
    for (const viewer of ["A", "B", "spectator"] as const) {
      privacyChecks++;
      const hidden = objects.filter(object => object.zone === "deck" || object.zone === "rune-deck" ||
        object.zone === "hand" && object.owner !== viewer).map(object => object.ref);
      if (headlessProjectionLeaks(projectionForKernel(state, viewer, match, unauditedEvents), hidden).length) privacySafe = false;
    }
    auditedEventCount = state.kernel.events.length;
  };
  checkPrivacy();
  const rejected = new Set<string>();
  const noProgress = createNoProgressCache();
  while (!match.result().winner) {
    if (match.flow.turn > maxTurns) { guardReason = "turn-limit"; break; }
    if (commands.length >= maxActions) { guardReason = "action-limit"; break; }
    noProgress.before = noProgress.peek(context);
  const allCandidates = enumerateCandidates(context, commands.length);
    const candidates = allCandidates.filter(command => !rejected.has(commandKey(command)));
    const trace = commandTrace(context, allCandidates);
    const movements = candidates.filter(command => command.type === "move" && command.to.type === "battlefield");
    const unitPlays = candidates.filter(command => command.type === "play" && trace.boardUnits.length === 0 &&
      trace.candidates.some(candidate => candidate.type === "play" && candidate.id === command.id &&
        candidate.types.includes("unit") && candidate.power === null &&
        candidate.energy !== null && candidate.energy <= state.kernel.player(command.player).energy));
    const traceCommand = (id: string | null) => trace.candidates.find(candidate => candidate.id === id);
    const pool = state.kernel.player(match.flow.turnPlayer).energy;
    const availableHandUnits = trace.candidates.filter(candidate => candidate.type === "play" &&
      candidate.types.includes("unit") && candidate.energy !== null).length;
    const runeCount = pool > 0 || availableHandUnits > 0 ? trace.candidateCounts["rune-energy"] : 0;
    const targetUnit = candidates.filter((command): command is Extract<HeadlessCommand, { type: "play" }> =>
      command.type === "play" && trace.boardUnits.length === 0 &&
      (() => {
        const candidate = traceCommand(command.id);
        return candidate?.types.includes("unit") === true &&
          candidate.destination?.type === "base" && candidate.energy !== null &&
          candidate.energy > pool && candidate.energy <= pool + runeCount;
      })()).sort((left, right) =>
        (traceCommand(left.id)?.energy ?? Infinity) - (traceCommand(right.id)?.energy ?? Infinity))[0];
    const runeAdds = targetUnit ? candidates.filter(command => command.type === "rune-energy") : [];
    const command = runeAdds.length ? runeAdds[random.next(runeAdds.length)]! :
      targetUnit?.type === "play" && pool >= (traceCommand(targetUnit.id)?.energy ?? Infinity) ? targetUnit :
      unitPlays.length ? unitPlays[random.next(unitPlays.length)]! :
      movements.length ? movements[random.next(movements.length)]! : candidates.length
      ? candidates[random.next(candidates.length)]!
      : match.flow.chain.priority
        ? match.flow.phase === "main" && !match.flow.chain.items.length && !match.flow.combat.active &&
          match.flow.chain.canAct(match.flow.turnPlayer, "normal")
          ? { type: "idle" as const, player: match.flow.turnPlayer }
          : { type: "pass" as const, player: match.flow.chain.priority }
        : { type: "advance" as const };
    let failure: HeadlessFailure | null = null;
    let fatal = false;
    try { executeGuardedCommand(context, command, noProgress); }
    catch (error) {
      failure = failureOf(error);
      if (isBlocked(error)) { blockers.push(failure); termination = "blocked"; fatal = true; }
      else if (isLegalRejection(error)) {
        rejected.add(commandKey(command));
      } else { exceptions.push(`${failure.name}: ${failure.message}`); termination = "exception"; fatal = true; }
    }
    recordCommand(state.counters, command.type);
    commands.push({ command, failure, trace });
    checkPrivacy();
    if (fatal) break;
    if (!failure) {
      rejected.clear();
      const after = noProgress.refresh(context);
      if (after === noProgress.before) { guardReason = "no-progress"; break; }
    }
  }
  if (match.result().winner) termination = "winner";
  const events = match.events();
  const observedActions = observedActionCoverage(commands, { commands: { ...state.counters.actionCoverage.commands },
    choices: { ...state.counters.actionCoverage.choices } });
  const content: Omit<HeadlessJournal, "integrity"> = { seed, decks, mulligans: context.mulligans, commands,
    events: structuredClone(events), final: finalState(context) };
  const journal: HeadlessJournal = { ...content, integrity: digest(content) };
  options.onJournal?.(structuredClone(journal));
  const projections = { A: projectionForKernel(state, "A", match), B: projectionForKernel(state, "B", match) };
  const cards = judgeRequiredCardCounts(state.counters);
  return {
    seed, decks, ...match.result(), termination, guardReason, blockers,
    scores: { A: state.kernel.player("A").score, B: state.kernel.player("B").score },
    victoryScore: match.flow.victoryScore, battleStats: battleStats(events), privacyChecks, exceptions,
    judgeRequiredRejections: state.counters.judgeRequiredRejections,
    judgeRequiredCards: judgeRequiredCardIds(cards), judgeRequiredCardCounts: cards, judgeRequiredTop: cards.slice(0, 10),
    actionCoverage: { commands: { ...state.counters.actionCoverage.commands }, choices: { ...state.counters.actionCoverage.choices } },
    observedActions,
    eventCount: events.length, journalDigest: digest(journal),
    projectionDigests: { A: digest(projections.A), B: digest(projections.B) },
    replayMatches: replayHeadlessGame(journal), privacySafe,
  };
}

function commandKey(command: HeadlessCommand): string {
  // A failed play's new journal id must not cause an endless retry at the same state.
  return JSON.stringify(command.type === "play" ? { ...command, id: undefined } : command);
}

function aggregateHeadlessResults(
  games: number,
  decks: HeadlessDeckPair,
  results: readonly HeadlessStats[],
): HeadlessRunSummary {
  const terminationReasons = { winner: 0, concede: 0, blocked: 0, exception: 0, guard: 0 } satisfies Record<HeadlessStats["termination"], number>;
  const actionCoverage = emptyActionCoverage();
  const battleStats: { -readonly [Key in keyof HeadlessBattleStats]: number } = {
    showdowns: 0, combats: 0, attacks: 0, defenses: 0, conquers: 0, scores: 0, points: 0,
  };
  const blockerReasons: Record<string, number> = {};
  const judgeCards = new Map<string, { readonly name: string | null; count: number }>();
  for (const result of results) {
    terminationReasons[result.termination] += 1;
    mergeActionCoverage(actionCoverage, result.actionCoverage);
    for (const key of Object.keys(battleStats) as (keyof HeadlessBattleStats)[]) battleStats[key] += result.battleStats[key];
    for (const blocker of result.blockers) blockerReasons[blocker.code] = (blockerReasons[blocker.code] ?? 0) + 1;
    mergeJudgeRequiredCards(judgeCards, result.judgeRequiredCardCounts);
  }
  const judgeRequiredCardCounts = [...judgeCards.entries()]
    .map(([cardId, value]) => ({ cardId, name: value.name, count: value.count }))
    .sort((left, right) => right.count - left.count || left.cardId.localeCompare(right.cardId));
  const naturalWins = results.filter(result => headlessTerminationClass(result) === "natural");
  return {
    games,
    decks,
    completed: naturalWins.length,
    blocked: results.filter(result => result.termination === "blocked").length,
    exceptions: results.filter(result => result.exceptions.length > 0).length,
    judgeRequiredRejections: results.reduce((total, result) => total + result.judgeRequiredRejections, 0),
    judgeRequiredCards: judgeRequiredCardIds(judgeRequiredCardCounts),
    judgeRequiredCardCounts,
    judgeRequiredTop: judgeRequiredCardCounts.slice(0, 10),
    actionCoverage: {
      commands: { ...actionCoverage.commands },
      choices: { ...actionCoverage.choices },
    },
    terminationReasons,
    totalTurns: results.reduce((total, result) => total + result.turnNumber, 0),
    winners: naturalWins.length,
    winnerRatio: naturalWins.length / results.length,
    winsByPlayer: { A: naturalWins.filter(result => result.winner === "A").length,
      B: naturalWins.filter(result => result.winner === "B").length },
    averageTurns: results.reduce((total, result) => total + result.turnNumber, 0) / results.length,
    battleStats, blockerReasons,
    gamesWithReplayMismatch: results.filter(result => !result.replayMatches).length,
    gamesWithPrivacyLeak: results.filter(result => !result.privacySafe).length,
    results,
  };
}

export function runHeadlessGames(
  games = DEFAULT_GAME_LIMIT,
  seedsOrOptions: readonly string[] | HeadlessGamesOptions = HEADLESS_SEEDS,
  options: HeadlessGamesOptions = {},
): HeadlessRunSummary {
  if (!Number.isSafeInteger(games) || games < 1) throw new RangeError("games must be a positive integer");
  const seeds = Array.isArray(seedsOrOptions) ? seedsOrOptions : HEADLESS_SEEDS;
  const resolvedOptions: HeadlessGamesOptions = Array.isArray(seedsOrOptions)
    ? options
    : seedsOrOptions as HeadlessGamesOptions;
  if (seeds.length === 0) throw new RangeError("seeds must contain at least one seed");
  const decks = resolvedOptions.deckPair ?? deckPairFromIds(resolvedOptions.decks ?? [DEFAULT_DECK_PAIR.A, DEFAULT_DECK_PAIR.B]);
  const results = Array.from({ length: games }, (_, index) => {
    const seed = seeds[index % seeds.length]!;
    return runHeadlessGame(seed, { ...resolvedOptions, deckPair: decks });
  });
  return aggregateHeadlessResults(games, decks, results);
}

function pairingsFor(decks: readonly M1PreconId[]): readonly HeadlessDeckPair[] {
  const unique = [...new Set(decks)];
  if (unique.length < 2) throw new RangeError("At least two distinct decks are required");
  const pairs: HeadlessDeckPair[] = [];
  for (let left = 0; left < unique.length; left += 1) {
    for (let right = left + 1; right < unique.length; right += 1) {
      pairs.push({ A: unique[left]!, B: unique[right]! });
    }
  }
  return pairs;
}

export function runHeadlessMatrix(options: HeadlessMatrixOptions = {}): HeadlessMatrixSummary {
  const games = options.games ?? 5;
  if (!Number.isSafeInteger(games) || games < 1) throw new RangeError("games must be a positive integer");
  const seeds = options.seeds ?? HEADLESS_MATRIX_SEEDS;
  if (seeds.length === 0) throw new RangeError("seeds must contain at least one seed");
  const deckIds: readonly M1PreconId[] = options.decks ?? (M1_DECK_IDS as readonly M1PreconId[]);
  const pairings = pairingsFor(deckIds).map(pair => runHeadlessGames(games, seeds, {
    deckPair: pair,
    maxTurns: options.maxTurns ?? DEFAULT_TURN_LIMIT,
    maxActions: options.maxActions ?? DEFAULT_ACTION_LIMIT,
  }));
  const results = pairings.flatMap(pair => pair.results);
  const aggregate = aggregateHeadlessResults(results.length, { A: deckIds[0]!, B: deckIds[1]! }, results);
  return {
    games: results.length,
    decks: [...new Set(deckIds)],
    pairings,
    completed: aggregate.completed,
    blocked: aggregate.blocked,
    exceptions: aggregate.exceptions,
    judgeRequiredRejections: aggregate.judgeRequiredRejections,
    judgeRequiredCards: aggregate.judgeRequiredCards,
    judgeRequiredCardCounts: aggregate.judgeRequiredCardCounts,
    judgeRequiredTop: aggregate.judgeRequiredTop,
    actionCoverage: aggregate.actionCoverage,
    terminationReasons: aggregate.terminationReasons,
    totalTurns: aggregate.totalTurns,
    winners: aggregate.winners, winnerRatio: aggregate.winnerRatio, winsByPlayer: aggregate.winsByPlayer,
    averageTurns: aggregate.averageTurns, battleStats: aggregate.battleStats, blockerReasons: aggregate.blockerReasons,
    gamesWithReplayMismatch: aggregate.gamesWithReplayMismatch,
    gamesWithPrivacyLeak: aggregate.gamesWithPrivacyLeak,
    results,
  };
}

/**
 * Run the fixed regression cases once. The focused gate previously created the
 * same deterministic, blocked, target and aggregate games repeatedly in
 * separate tests. This shares those exact runs without reducing the matrix or
 * any tamper/replay assertion; callers still receive all original results.
 */
export function runHeadlessRegression(options: HeadlessRegressionOptions = {}): HeadlessRegressionRun {
  const shared = {
    maxTurns: options.maxTurns ?? DEFAULT_TURN_LIMIT,
    maxActions: options.maxActions ?? DEFAULT_ACTION_LIMIT,
  };
  const matrix = runHeadlessMatrix({ games: 5, decks: M1_DECK_IDS, seeds: HEADLESS_MATRIX_SEEDS, ...shared });
  const determinismFirst = runHeadlessGame(HEADLESS_SEEDS[0]!, { decks: ["vex-unl", "vi-unl"], ...shared });
  const determinismSecond = runHeadlessGame(HEADLESS_SEEDS[0]!, { decks: ["vex-unl", "vi-unl"], ...shared });
  const blocked = runHeadlessGame(HEADLESS_SEEDS[0]!, shared);
  const targets = runHeadlessGame("RIFT-739-natural-1", shared);
  const sourceTrigger = runHeadlessGame(HEADLESS_SEEDS[2]!, { decks: ["fiora-sfd", "vex-unl"], ...shared });
  let journal: HeadlessJournal | undefined;
  const tamperResult = runHeadlessGame(HEADLESS_SEEDS[0]!, { ...shared, onJournal: value => { journal = value; } });
  if (!journal) throw new Error("Headless journal callback was not invoked");
  const aggregate = runHeadlessGames(2, HEADLESS_SEEDS.slice(0, 2), shared);
  return {
    matrix,
    determinism: [determinismFirst, determinismSecond],
    blocked,
    targets,
    sourceTrigger,
    tamper: { journal, result: tamperResult },
    aggregate,
  };
}

/** Lazy, once-only access to the fixed regression cases for focused tests. */
export function createHeadlessRegressionHarness(options: HeadlessRegressionOptions = {}): HeadlessRegressionHarness {
  let shared: HeadlessRegressionRun | undefined;
  let determinism: readonly [HeadlessStats, HeadlessStats] | undefined;
  const once = (): HeadlessRegressionRun => shared ??= runHeadlessRegression(options);
  return {
    matrix: () => once().matrix,
    determinism: () => determinism ??= (() => {
      const run = once();
      return run.determinism;
    })(),
    blocked: () => once().blocked,
    targets: () => once().targets,
    sourceTrigger: () => once().sourceTrigger,
    tamper: () => once().tamper,
    aggregate: () => once().aggregate,
  };
}
