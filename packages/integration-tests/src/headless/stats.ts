import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import type { HeadlessCommand, HeadlessDeckPair, HeadlessJournal, HeadlessStats } from "./duel.js";
import type { M1PreconId } from "./decks.js";

const { replayHeadlessJournal, runHeadlessGame } = await import(
  new URL("./duel.ts", import.meta.url).href,
) as typeof import("./duel.ts");

export const M1_STATS_GAMES = 100;
export const M1_STATS_GAMES_PER_SIDE = 50;
export const M1_STATS_DEFAULT_WALL_MS = 15 * 60_000;
export const M1_STATS_DEFAULT_MAX_TURNS = 40;
export const M1_STATS_DEFAULT_MAX_COMMANDS = 10_000;

export type M1StatsOutcome = "natural-win" | "blocked" | "exception" | "timeout" |
  "command-limit" | "turn-limit" | "no-progress" | "replay-mismatch";
export type M1StatsOrientation = "rumble-a" | "fiora-a";
export type M1CommandTimingSource = "journal" | "unavailable" | "none";

export interface M1StatsCase {
  readonly index: number;
  readonly seed: string;
  readonly orientation: M1StatsOrientation;
  readonly decks: Readonly<{ A: M1PreconId; B: M1PreconId }>;
}

export interface M1CommandTiming {
  readonly index: number;
  readonly indexInJournal: number;
  readonly type: HeadlessCommand["type"];
  readonly player: string | null;
  readonly elapsedMs: number;
}

export interface M1DurationDistribution {
  readonly count: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface M1CardActivity {
  readonly cardId: string;
  readonly name: string;
  readonly drawn: number;
  readonly played: number;
  readonly triggered: number;
  readonly judgeRequired: number;
}

export interface M1UnhandledChoice {
  readonly index: number;
  readonly type: string;
  readonly player: string | null;
  readonly message: string;
}

export interface M1FailureDetail {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly stack: string | null;
}

export interface M1FailureRecord {
  readonly caseIndex: number;
  readonly seed: string;
  readonly orientation: M1StatsOrientation;
  readonly outcome: M1StatsOutcome;
  readonly termination: HeadlessStats["termination"] | "timeout";
  readonly guardReason: HeadlessStats["guardReason"];
  readonly blockers: readonly HeadlessStats["blockers"][number][];
  readonly exceptions: readonly string[];
  readonly unhandledChoices: readonly M1UnhandledChoice[];
  readonly error: M1FailureDetail | null;
  readonly journalPath: string | null;
  readonly lastCommands: readonly HeadlessCommand[];
}

export interface M1FailureCategory {
  readonly outcome: M1StatsOutcome;
  readonly reason: string;
  readonly count: number;
  readonly seeds: readonly string[];
}

export interface M1CommandFailureCategory {
  /** Candidate object identity; the CommandTrace does not carry a separate canonical id. */
  readonly objectId: string | null;
  readonly name: string | null;
  readonly code: string;
  readonly message: string;
  readonly count: number;
  readonly seeds: readonly string[];
}

export interface M1StalledCardCandidate {
  readonly objectId: string | null;
  readonly name: string;
  readonly count: number;
  readonly seeds: readonly string[];
}

export interface M1GameStats {
  readonly caseIndex: number;
  readonly seed: string;
  readonly orientation: M1StatsOrientation;
  readonly decks: readonly [M1PreconId, M1PreconId];
  readonly outcome: M1StatsOutcome;
  readonly termination: HeadlessStats["termination"] | "timeout";
  readonly guardReason: HeadlessStats["guardReason"];
  readonly winner: HeadlessStats["winner"];
  readonly turns: number | null;
  readonly commands: number | null;
  readonly eventCount: number;
  readonly elapsedMs: number;
  readonly score: HeadlessStats["scores"] | null;
  readonly victoryScore: number | null;
  readonly battleStats: HeadlessStats["battleStats"] | null;
  readonly commandTimings: readonly M1CommandTiming[];
  readonly commandDuration: M1DurationDistribution;
  readonly commandTimingSource: M1CommandTimingSource;
  readonly cards: readonly M1CardActivity[];
  readonly judgeRequiredCards: readonly M1CardActivity[];
  readonly unhandledChoices: readonly M1UnhandledChoice[];
  readonly exceptions: readonly string[];
  readonly blockers: HeadlessStats["blockers"];
  readonly replayChecked: boolean;
  readonly replayMatches: boolean | null;
  readonly privacySafe: boolean | null;
  readonly journalDigest: string | null;
  readonly journalPath: string | null;
  readonly lastCommands: readonly HeadlessCommand[];
  readonly error: M1FailureDetail | null;
}

export interface M1StatsSummary {
  readonly games: number;
  readonly scope: { readonly games: number; readonly perSide: number; readonly pair: HeadlessDeckPair };
  readonly cases: readonly M1StatsCase[];
  readonly outcomes: Readonly<Record<M1StatsOutcome, number>>;
  readonly terminationReasons: Readonly<Record<HeadlessStats["termination"] | "timeout", number>>;
  readonly guardReasons: Readonly<Record<NonNullable<HeadlessStats["guardReason"]>, number>>;
  readonly orientations: Readonly<Record<M1StatsOrientation, number>>;
  readonly totalTurns: number | null;
  readonly averageTurns: number | null;
  readonly totalCommands: number | null;
  readonly totalEvents: number;
  readonly battleStats: HeadlessStats["battleStats"];
  readonly wallMs: number;
  readonly gameWallMs: M1DurationDistribution;
  readonly commandMs: M1DurationDistribution;
  readonly commandTimingGames: number;
  readonly commandTimingUnavailableGames: number;
  readonly noCommandGames: number;
  readonly commandTimingNote: string | null;
  readonly cards: readonly M1CardActivity[];
  readonly judgeRequiredCards: readonly M1CardActivity[];
  readonly unhandledChoices: number;
  readonly judgeRequiredRejections: number;
  readonly matchesWithCommands: number;
  readonly replayChecks: number;
  readonly replayMismatches: number;
  readonly failures: readonly M1FailureRecord[];
  readonly failureCategories: readonly M1FailureCategory[];
  readonly commandFailureCategories: readonly M1CommandFailureCategory[];
  readonly stalledCandidates: readonly M1StalledCardCandidate[];
  readonly results: readonly M1GameStats[];
}

export interface M1WorkerMessage {
  readonly ok: boolean;
  readonly stats?: HeadlessStats;
  readonly journal?: HeadlessJournal;
  readonly replayMatches?: boolean;
  readonly error?: Partial<M1FailureDetail>;
}

export interface M1RunOptions {
  readonly games?: number;
  readonly wallTimeoutMs?: number;
  readonly maxTurns?: number;
  readonly maxCommands?: number;
  readonly maxConcurrency?: number;
  readonly journalDirectory?: string;
  readonly workerUrl?: URL;
  readonly onResult?: (result: M1GameStats) => void;
}

export interface M1RunnerInput {
  readonly testCase: M1StatsCase;
  readonly maxTurns: number;
  readonly maxCommands: number;
  readonly onJournal: (journal: HeadlessJournal) => void;
}

export interface M1RunContext {
  readonly wallTimeoutMs: number;
  readonly maxTurns: number;
  readonly maxCommands: number;
  readonly workerUrl: URL;
  readonly journalDirectory: string | null;
  readonly onResult?: (result: M1GameStats) => void;
}

const PAIR = Object.freeze({ A: "rumble-sfd", B: "fiora-sfd" } as const);

export function m1StatsCases(count = M1_STATS_GAMES): readonly M1StatsCase[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("game count must be a positive integer");
  const rumbleCount = Math.ceil(count / 2);
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    index,
    seed: `RIFT-990-m1-seed-${String(index + 1).padStart(3, "0")}`,
    orientation: index < rumbleCount ? "rumble-a" as const : "fiora-a" as const,
    decks: Object.freeze(index < rumbleCount
      ? { A: PAIR.A, B: PAIR.B }
      : { A: PAIR.B, B: PAIR.A }),
  })));
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function nonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Only exact journal samples qualify as command timings. */
export function commandTimings(journal: HeadlessJournal): readonly M1CommandTiming[] {
  const raw = (journal as unknown as { readonly timing?: { readonly commandMs?: readonly unknown[] } }).timing?.commandMs;
  if (raw === undefined || raw.length !== journal.commands.length) return Object.freeze([]);
  const samples = raw.map(sample => nonNegative(typeof sample === "number" ? sample :
    sample !== null && typeof sample === "object" && !Array.isArray(sample)
      ? (sample as { readonly elapsedMs?: unknown }).elapsedMs : undefined));
  if (samples.some(sample => sample === null)) return Object.freeze([]);
  return Object.freeze(journal.commands.map((entry, index) => Object.freeze({ index,
    indexInJournal: index, type: entry.command.type,
    player: "player" in entry.command ? entry.command.player : null, elapsedMs: samples[index]! })));
}

export function commandTimingSource(journal: HeadlessJournal): M1CommandTimingSource {
  if (journal.commands.length === 0) return "none";
  return commandTimings(journal).length === journal.commands.length ? "journal" : "unavailable";
}

export function durationDistribution(samples: readonly number[]): M1DurationDistribution {
  if (samples.length === 0) return Object.freeze({ count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 });
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
  return Object.freeze({ count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: sorted.at(-1)! });
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>> : null;
}

function cardActivity(journal: HeadlessJournal, stats: HeadlessStats): readonly M1CardActivity[] {
  const values = new Map<string, { cardId: string; name: string; drawn: number;
    played: number; triggered: number; judgeRequired: number }>();
  const ensure = (id: string, name?: unknown) => {
    let card = values.get(id);
    if (card === undefined) {
      card = { cardId: id, name: typeof name === "string" ? name : id, drawn: 0,
        played: 0, triggered: 0, judgeRequired: 0 };
      values.set(id, card);
    }
    return card;
  };
  for (const event of journal.events) {
    const object = asRecord(event.object);
    const id = typeof object?.cardId === "string" ? object.cardId : null;
    if (id === null) continue;
    if (event.timingPoint === "card-drawn") ensure(id, object?.name).drawn += 1;
    if (event.timingPoint === "card-played") ensure(id, object?.name).played += 1;
    const details = asRecord(event.details);
    if (event.timingPoint === "chain-item-pending" && typeof details?.item === "string" &&
        details.item.startsWith("trigger:")) ensure(id, object?.name).triggered += 1;
  }
  for (const card of stats.judgeRequiredCardCounts) ensure(card.cardId, card.name).judgeRequired += card.count;
  return Object.freeze([...values.values()].sort((left, right) => right.played - left.played ||
    right.triggered - left.triggered || right.judgeRequired - left.judgeRequired ||
    right.drawn - left.drawn || left.cardId.localeCompare(right.cardId)).map(card => Object.freeze(card)));
}

export function unhandledChoices(stats: HeadlessStats | null): readonly M1UnhandledChoice[] {
  return Object.freeze((stats?.exceptions ?? []).flatMap((message, index) =>
    /AwaitChoice|choice-continuation|unhandled choice/i.test(message)
      ? [Object.freeze({ index, type: "AwaitChoice", player: null, message })] : []));
}

export function classifyGame(stats: HeadlessStats, independentlyReplayed: boolean): M1StatsOutcome {
  if (!stats.replayMatches || !independentlyReplayed) return "replay-mismatch";
  if (stats.termination === "blocked") return "blocked";
  if (stats.termination === "exception") return "exception";
  if (stats.termination === "guard" && stats.guardReason === "action-limit") return "command-limit";
  if (stats.termination === "guard" && stats.guardReason === "turn-limit") return "turn-limit";
  if (stats.termination === "guard" && stats.guardReason === "no-progress") return "no-progress";
  if (stats.termination === "winner" && stats.guardReason === null && stats.blockers.length === 0 &&
      stats.exceptions.length === 0 && stats.actionCoverage.commands.concede === 0 && stats.winner !== null &&
      stats.scores[stats.winner]! >= stats.victoryScore && stats.battleStats.scores > 0 &&
      stats.battleStats.points >= stats.victoryScore) return "natural-win";
  return "exception";
}

function resultFromJournal(testCase: M1StatsCase, stats: HeadlessStats, journal: HeadlessJournal,
  replayed: boolean, elapsedMs: number, cards = cardActivity(journal, stats)): M1GameStats {
  const timings = commandTimings(journal);
  return Object.freeze({ caseIndex: testCase.index, seed: testCase.seed, orientation: testCase.orientation,
    decks: [testCase.decks.A, testCase.decks.B] as const, outcome: classifyGame(stats, replayed),
    termination: stats.termination, guardReason: stats.guardReason, winner: stats.winner,
    turns: stats.turnNumber, commands: journal.commands.length, eventCount: stats.eventCount, elapsedMs,
    score: stats.scores, victoryScore: stats.victoryScore, battleStats: stats.battleStats,
    commandTimings: timings, commandDuration: durationDistribution(timings.map(sample => sample.elapsedMs)),
    commandTimingSource: timings.length === journal.commands.length ? "journal" : "unavailable",
    cards, judgeRequiredCards: cards.filter(card => card.judgeRequired > 0), unhandledChoices: unhandledChoices(stats),
    exceptions: Object.freeze([...stats.exceptions]), blockers: Object.freeze([...stats.blockers]),
    replayChecked: true, replayMatches: stats.replayMatches && replayed, privacySafe: stats.privacySafe,
    journalDigest: stats.journalDigest, journalPath: null,
    lastCommands: Object.freeze(journal.commands.slice(-5).map(entry => entry.command)), error: null });
}

function noResult(testCase: M1StatsCase, elapsedMs: number, outcome: "timeout" | "exception", error: unknown): M1GameStats {
  const detail: M1FailureDetail = { name: error instanceof Error ? error.name : "Error",
    code: error !== null && typeof error === "object" && "code" in error ? String(error.code) : "worker-error",
    message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null };
  return Object.freeze({ caseIndex: testCase.index, seed: testCase.seed, orientation: testCase.orientation,
    decks: [testCase.decks.A, testCase.decks.B] as const, outcome, termination: outcome,
    guardReason: null, winner: null, turns: null, commands: null, eventCount: 0, elapsedMs,
    score: null, victoryScore: null, battleStats: null, commandTimings: Object.freeze([]),
    commandDuration: durationDistribution([]), commandTimingSource: "none", cards: Object.freeze([]),
    judgeRequiredCards: Object.freeze([]), unhandledChoices: Object.freeze([]), blockers: Object.freeze([]),
    exceptions: Object.freeze([]), replayChecked: false, replayMatches: null, privacySafe: null,
    journalDigest: null, journalPath: null, lastCommands: Object.freeze([]), error: Object.freeze(detail) });
}

export async function runM1StatsCases(cases: readonly M1StatsCase[], options: {
  readonly maxTurns: number;
  readonly maxCommands: number;
  readonly runner: (input: M1RunnerInput) => HeadlessStats;
  readonly replay: (journal: HeadlessJournal) => boolean;
}): Promise<M1StatsSummary> {
  const results: M1GameStats[] = [];
  for (const testCase of cases) {
    const startedAt = performance.now();
    let journal: HeadlessJournal | undefined;
    try {
      const stats = options.runner({ testCase, maxTurns: options.maxTurns, maxCommands: options.maxCommands,
        onJournal: value => { journal = value; } });
      if (journal === undefined) throw new Error("Headless journal callback was not invoked");
      results.push(resultFromJournal(testCase, stats, journal, options.replay(journal),
        Math.max(0, performance.now() - startedAt)));
    } catch (error) {
      results.push(noResult(testCase, Math.max(0, performance.now() - startedAt), "exception", error));
    }
  }
  return summarizeM1Games(cases, results, results.reduce((sum, result) => sum + result.elapsedMs, 0));
}

function failure(game: M1GameStats): M1FailureRecord | null {
  return game.outcome === "natural-win" ? null : Object.freeze({ caseIndex: game.caseIndex, seed: game.seed,
    orientation: game.orientation, outcome: game.outcome, termination: game.termination,
    guardReason: game.guardReason, blockers: game.blockers, exceptions: game.exceptions,
    unhandledChoices: game.unhandledChoices, error: game.error, journalPath: game.journalPath,
    lastCommands: game.lastCommands });
}

function failureCategories(failures: readonly M1FailureRecord[]): readonly M1FailureCategory[] {
  const groups = new Map<string, { outcome: M1StatsOutcome; reason: string; seeds: string[] }>();
  for (const failure of failures) {
    const reason = failure.outcome === "replay-mismatch" ? "independent journal replay disagreed" :
      failure.outcome === "timeout" ? (failure.error?.message ?? "wall-clock timeout") :
      failure.outcome === "no-progress" ? "no progress after a command" :
      failure.outcome === "command-limit" ? "headless action limit reached" :
      failure.outcome === "turn-limit" ? "headless turn limit reached" :
      failure.outcome === "blocked" ? (failure.blockers[0]?.message ?? "blocked") :
      failure.exceptions[0] ?? failure.error?.message ?? "exception";
    const key = `${failure.outcome}:${reason}`;
    const group = groups.get(key) ?? { outcome: failure.outcome, reason, seeds: [] };
    group.seeds.push(failure.seed); groups.set(key, group);
  }
  return Object.freeze([...groups.values()].sort((left, right) => right.seeds.length - left.seeds.length ||
    left.outcome.localeCompare(right.outcome)).map(group => Object.freeze({ ...group,
    count: group.seeds.length, seeds: Object.freeze(group.seeds) })));
}

function commandFailureCategories(results: readonly M1GameStats[], journals: ReadonlyMap<number, HeadlessJournal>):
readonly M1CommandFailureCategory[] {
  const groups = new Map<string, { objectId: string | null; name: string | null; code: string;
    message: string; count: number; seeds: string[] }>();
  for (const result of results) {
    const journal = journals.get(result.caseIndex);
    if (journal === undefined) continue;
    for (const entry of journal.commands) {
      if (entry.failure === null) continue;
      const command = entry.command;
      const candidate = command.type === "play" ? entry.trace?.candidates.find(value => value.id === command.id) : undefined;
      const key = `${candidate?.name ?? ""}|${entry.failure.code}|${entry.failure.message}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = { objectId: candidate?.object.id ?? null, name: candidate?.name ?? null, code: entry.failure.code,
          message: entry.failure.message, count: 0, seeds: [] };
        groups.set(key, group);
      }
      group.count += 1;
      if (!group.seeds.includes(result.seed)) group.seeds.push(result.seed);
    }
  }
  return Object.freeze([...groups.values()].sort((left, right) => right.count - left.count ||
    (left.name ?? "").localeCompare(right.name ?? "") || left.code.localeCompare(right.code)).map(group =>
    Object.freeze({ ...group, seeds: Object.freeze(group.seeds) })));
}

function stalledCardCandidates(results: readonly M1GameStats[], journals: ReadonlyMap<number, HeadlessJournal>):
readonly M1StalledCardCandidate[] {
  const names = new Map<string, { objectId: string | null; name: string; count: number; seeds: string[] }>();
  for (const result of results) {
    if (!["no-progress", "replay-mismatch"].includes(result.outcome)) continue;
    const journal = journals.get(result.caseIndex);
    const candidate = journal?.commands.at(-1)?.failure ? undefined : journal?.commands.at(-1)?.trace?.candidates[0];
    if (candidate === undefined || candidate.name === null) continue;
    let entry = names.get(candidate.name);
    if (entry === undefined) {
      entry = { objectId: candidate.object.id, name: candidate.name, count: 0, seeds: [] };
      names.set(candidate.name, entry);
    }
    entry.count += 1;
    if (!entry.seeds.includes(result.seed)) entry.seeds.push(result.seed);
  }
  return Object.freeze([...names.values()].sort((left, right) => right.count - left.count ||
    left.name.localeCompare(right.name)).map(value => Object.freeze({ ...value, seeds: Object.freeze(value.seeds) })));
}

function mergeCards(target: Map<string, { cardId: string; name: string; drawn: number;
  played: number; triggered: number; judgeRequired: number }>, source: readonly M1CardActivity[]): void {
  for (const card of source) {
    const current = target.get(card.cardId);
    if (current === undefined) target.set(card.cardId, { ...card });
    else { current.drawn += card.drawn; current.played += card.played;
      current.triggered += card.triggered; current.judgeRequired += card.judgeRequired; }
  }
}

function cardList(cards: ReadonlyMap<string, M1CardActivity>): readonly M1CardActivity[] {
  return Object.freeze([...cards.values()].sort((left, right) => right.played - left.played ||
    right.triggered - left.triggered || right.judgeRequired - left.judgeRequired ||
    right.drawn - left.drawn || left.cardId.localeCompare(right.cardId)).map(card => Object.freeze(card)));
}

export function summarizeM1Games(cases: readonly M1StatsCase[], results: readonly M1GameStats[], wallMs: number): M1StatsSummary {
  return summarizeM1GamesWithJournals(cases, results, wallMs, new Map());
}

export function summarizeM1GamesWithJournals(cases: readonly M1StatsCase[], results: readonly M1GameStats[], wallMs: number,
  journals: ReadonlyMap<number, HeadlessJournal>): M1StatsSummary {
  const outcomes: Record<M1StatsOutcome, number> = { "natural-win": 0, blocked: 0, exception: 0,
    timeout: 0, "command-limit": 0, "turn-limit": 0, "no-progress": 0, "replay-mismatch": 0 };
  const terminationReasons: Record<HeadlessStats["termination"] | "timeout", number> =
    { winner: 0, concede: 0, blocked: 0, exception: 0, guard: 0, timeout: 0 };
  const guardReasons: Record<NonNullable<HeadlessStats["guardReason"]>, number> =
    { "turn-limit": 0, "action-limit": 0, "no-progress": 0 };
  const orientations: Record<M1StatsOrientation, number> = { "rumble-a": 0, "fiora-a": 0 };
  const failures: M1FailureRecord[] = [];
  const cards = new Map<string, M1CardActivity>();
  const judges = new Map<string, M1CardActivity>();
  const battleStats: { -readonly [Key in keyof HeadlessStats["battleStats"]]: number } =
    { showdowns: 0, combats: 0, attacks: 0, defenses: 0, conquers: 0, scores: 0, points: 0 };
  for (const result of results) {
    outcomes[result.outcome] += 1; terminationReasons[result.termination] += 1;
    orientations[result.orientation] += 1;
    if (result.guardReason !== null) guardReasons[result.guardReason] += 1;
    if (result.battleStats !== null) for (const key of Object.keys(battleStats) as (keyof typeof battleStats)[]) {
      battleStats[key] += result.battleStats[key];
    }
    mergeCards(cards, result.cards); mergeCards(judges, result.judgeRequiredCards);
    const failed = failure(result); if (failed !== null) failures.push(failed);
  }
  const completeTurns = results.every(result => result.turns !== null);
  const completeCommands = results.every(result => result.commands !== null);
  const totalTurns = completeTurns ? results.reduce((sum, result) => sum + result.turns!, 0) : null;
  const totalCommands = completeCommands ? results.reduce((sum, result) => sum + result.commands!, 0) : null;
  const commands = results.flatMap(result => result.commandTimings.map(sample => sample.elapsedMs));
  return Object.freeze({ games: results.length, scope: { games: results.length,
    perSide: Math.ceil(results.length / 2), pair: { A: PAIR.A, B: PAIR.B } as HeadlessDeckPair },
    cases, outcomes, terminationReasons, guardReasons, orientations,
    totalTurns, averageTurns: totalTurns === null ? null : totalTurns / results.length, totalCommands,
    totalEvents: results.reduce((sum, result) => sum + result.eventCount, 0), battleStats, wallMs,
    gameWallMs: durationDistribution(results.map(result => result.elapsedMs)), commandMs: durationDistribution(commands),
    commandTimingGames: results.filter(result => result.commandTimingSource === "journal").length,
    commandTimingUnavailableGames: results.filter(result => result.commandTimingSource === "unavailable").length,
    noCommandGames: results.filter(result => result.commandTimingSource === "none").length,
    commandTimingNote: results.some(result => result.commandTimingSource === "unavailable")
      ? "Current HeadlessJournal has no per-command duration samples" : null,
    cards: cardList(cards), judgeRequiredCards: cardList(judges),
    unhandledChoices: results.reduce((sum, result) => sum + result.unhandledChoices.length, 0),
    judgeRequiredRejections: [...judges.values()].reduce((sum, card) => sum + card.judgeRequired, 0),
    matchesWithCommands: results.filter(result => (result.commands ?? 0) > 0).length,
    replayChecks: results.filter(result => result.replayChecked).length, replayMismatches: outcomes["replay-mismatch"],
    failures: Object.freeze(failures), failureCategories: failureCategories(failures),
    commandFailureCategories: commandFailureCategories(results, journals),
    stalledCandidates: stalledCardCandidates(results, journals), results: Object.freeze(results) });
}

function timeoutError(milliseconds: number): Error {
  const error = new Error(`Game exceeded wall-clock limit of ${milliseconds}ms`);
  error.name = "TimeoutError";
  return error;
}

async function writeJournal(directory: string | null, game: M1GameStats, journal: HeadlessJournal): Promise<string | null> {
  if (directory === null) return null;
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
  const path = `${directory}/${String(game.caseIndex + 1).padStart(3, "0")}-${game.seed}.journal.json`;
  await writeFile(path, `${JSON.stringify(journal)}\n`);
  return path;
}

export async function runIsolatedM1Game(testCase: M1StatsCase, context: M1RunContext): Promise<M1GameStats> {
  const startedAt = performance.now();
  const worker = new Worker(context.workerUrl, { workerData: { kind: "game", testCase,
    maxTurns: context.maxTurns, maxCommands: context.maxCommands } });
  let timer: NodeJS.Timeout | undefined;
  try {
    const message = await Promise.race([
      new Promise<M1WorkerMessage>((resolve, reject) => {
        worker.once("message", (value: unknown) => resolve(value as M1WorkerMessage));
        worker.once("error", reject);
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError(context.wallTimeoutMs)), context.wallTimeoutMs);
        timer.unref?.();
      }),
    ]);
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    if (!message.ok || message.stats === undefined || message.journal === undefined ||
        typeof message.replayMatches !== "boolean") {
      const remote = message.error;
      const error = Object.assign(new Error(remote?.message ?? "Game worker failed"), {
        name: remote?.name ?? "GameWorkerError", code: remote?.code ?? "worker-error",
      });
      const result = noResult(testCase, elapsedMs, "exception", error);
      const detailed = Object.freeze({ ...result, error: Object.freeze({ ...result.error!,
        stack: remote?.stack ?? result.error!.stack }) });
      context.onResult?.(detailed); return detailed;
    }
    const stats = message.stats;
    const draft = resultFromJournal(testCase, stats, message.journal, message.replayMatches, elapsedMs);
    const journalPath = await writeJournal(context.journalDirectory, draft, message.journal);
    const result = Object.freeze({ ...draft, journalPath });
    context.onResult?.(result); return result;
  } catch (error) {
    const outcome = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "exception";
    const result = noResult(testCase, Math.max(0, performance.now() - startedAt), outcome, error);
    context.onResult?.(result); return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await worker.terminate();
  }
}

export async function runM1HundredGameStats(options: M1RunOptions = {}): Promise<M1StatsSummary> {
  const cases = m1StatsCases(options.games ?? M1_STATS_GAMES);
  const context: M1RunContext = Object.freeze({
    wallTimeoutMs: positiveInteger("wallTimeoutMs", options.wallTimeoutMs ?? M1_STATS_DEFAULT_WALL_MS),
    maxTurns: positiveInteger("maxTurns", options.maxTurns ?? M1_STATS_DEFAULT_MAX_TURNS),
    maxCommands: positiveInteger("maxCommands", options.maxCommands ?? M1_STATS_DEFAULT_MAX_COMMANDS),
    workerUrl: options.workerUrl ?? new URL("../../scripts/m1-hundred-games.mjs", import.meta.url),
    journalDirectory: options.journalDirectory ?? null,
    ...(options.onResult === undefined ? {} : { onResult: options.onResult }),
  });
  const concurrency = positiveInteger("maxConcurrency", options.maxConcurrency ?? 1);
  const slots: (M1GameStats | undefined)[] = Array.from({ length: cases.length });
  const journals = new Map<number, HeadlessJournal>();
  let next = 0;
  const startedAt = performance.now();
  const consume = async (): Promise<void> => {
    while (next < cases.length) {
      const testCase = cases[next++]!;
      slots[testCase.index] = await runIsolatedM1Game(testCase, context);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, () => consume()));
  const results = slots.flatMap(result => result === undefined ? [] : [result]);
  if (options.journalDirectory !== undefined) {
    const { readFile } = await import("node:fs/promises");
    for (const result of results) {
      if (result.journalPath === null) continue;
      journals.set(result.caseIndex, JSON.parse(await readFile(result.journalPath, "utf8")) as HeadlessJournal);
    }
  }
  return summarizeM1GamesWithJournals(cases, results, Math.max(0, performance.now() - startedAt), journals);
}

export function m1StatsMarkdown(summary: M1StatsSummary): string {
  const categories = summary.failureCategories.map(category =>
    `| ${category.outcome} | ${category.reason.replaceAll("|", "\\|")} | ${category.count} | ${category.seeds.join(", ")} |`);
  const games = summary.results.map(result =>
    `| ${result.caseIndex + 1} | ${result.seed} | ${result.orientation} | ${result.outcome} | ${result.turns ?? "n/a"} | ${result.commands ?? "n/a"} | ${Math.round(result.elapsedMs)} | ${result.replayMatches ?? "not-run"} |`);
  const cards = summary.cards.map(card =>
    `| ${card.name} | ${card.cardId} | ${card.drawn} | ${card.played} | ${card.triggered} | ${card.judgeRequired} |`);
  const commandFailures = summary.commandFailureCategories.map(category =>
    `| ${category.name ?? "-"} | ${category.objectId ?? "-"} | ${category.code} | ${category.message.replaceAll("|", "\\|")} | ${category.count} | ${category.seeds.join(", ")} |`);
  const stalled = summary.stalledCandidates.map(candidate =>
    `| ${candidate.name} | ${candidate.objectId ?? "-"} | ${candidate.count} | ${candidate.seeds.join(", ")} |`);
  return ["# RIFT-990 summary", "", "## Aggregate", "", `- outcomes: ${JSON.stringify(summary.outcomes)}`,
    `- guard reasons: ${JSON.stringify(summary.guardReasons)}`, `- replay checks: ${summary.replayChecks}`,
    `- replay mismatches: ${summary.replayMismatches}`, `- total game wall ms: ${Math.round(summary.wallMs)}`,
    `- game wall distribution: ${JSON.stringify(summary.gameWallMs)}`,
    `- command timing: ${JSON.stringify(summary.commandMs)}; journal=${summary.commandTimingGames}, unavailable=${summary.commandTimingUnavailableGames}, none=${summary.noCommandGames}`,
    "", "## Failure categories", "", "| outcome | reason | count | seeds |", "|---|---|---:|---|",
    ...(categories.length ? categories : ["| none | none | 0 | |"]), "", "## Per game", "",
    "| # | seed | A | outcome | turns | commands | elapsed ms | replay |", "|---:|---|---|---|---:|---:|---:|---|", ...games,
    "", "## Command rejections", "", "| card | canonical id | code | message | count | seeds |",
    "|---|---|---|---|---:|---|", ...(commandFailures.length ? commandFailures : ["| none | | | | 0 | |"]),
    "", "## Last stalled candidate", "", "| card | identity | count | seeds |", "|---|---|---:|---|",
    ...(stalled.length ? stalled : ["| none | | 0 | |"]),
    "", "## Card activity", "", "| card | canonical id | drawn | played | triggered | judge-required |",
    "|---|---|---:|---:|---:|---:|", ...(cards.length ? cards : ["| none | | 0 | 0 | 0 | 0 |"])].join("\n");
}
