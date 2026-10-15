// Internal staged-step duel constructor: not a public player-command, archive-restore, or
// GameDuel factory boundary. It only wires the existing duel kernels (setup, board, resources,
// scoring) into one match-state union and grants the single 'awaiting-turn-start' frame.
import {
  createDuelSetup, mulliganDuelSetup, completeDuelSetup, projectPublicDuelSetup,
  type DuelSetupSeat, type DuelSetupState, type PublicDuelSetup, type SetupCard,
} from './setup.js';
import { createDuelBoard, projectPublicDuelBoard, type DuelBoard, type PublicDuelBoard } from './battlefields.js';
import {
  createDuelResources, projectPublicDuelResources, type DuelResources, type PublicDuelResources,
} from './resources.js';
import { createDuelScoring, projectPublicDuelScoring, type DuelScoringState } from './scoring.js';
import { projectPublicDuelUnitObjects, type DuelUnitMeta, type PublicDuelUnitObject } from './unit-lifecycle.js';

export interface DuelMatchPerson {
  readonly playerId: string;
  readonly displayName: string;
}
/** Supplied by an upstream trusted catalog/deck validator, not by a player command. */
export interface DuelMatchMetadata {
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  /** Named seats in the same order as DuelSetupSeats. */
  readonly roster: readonly [DuelMatchPerson, DuelMatchPerson];
}
interface CommonMatch {
  readonly schemaVersion: 1;
  readonly rulesetId: 'riftbound-duel';
  readonly matchId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly stateVersion: number;
  readonly eventSeq: number;
  readonly roster: readonly [DuelMatchPerson, DuelMatchPerson];
  /** First player first; not necessarily the roster's seat order. */
  readonly turnOrder: readonly [string, string];
}
export interface DuelMatchSetupState extends CommonMatch {
  readonly stage: 'setup';
  readonly setup: DuelSetupState;
}
export interface DuelMatchPrivatePlayer {
  readonly playerId: string;
  readonly champion: SetupCard | null;
  readonly legend: SetupCard;
  readonly hand: readonly SetupCard[];
  readonly remainingMainDeck: readonly SetupCard[];
  /**
   * This player's own private Trash zone authority; initially empty. Cards in a Trash are Public
   * Information (CR 108.2.d) and unordered, so the public projection below exposes uid/cardId only.
   */
  readonly trash: readonly SetupCard[];
}
/** The only frame the constructor grants; an eventual trusted executor must extend this type. */
export interface DuelAwaitingTurnStart {
  readonly phase: 'awaiting-turn-start';
  readonly turnNumber: 1;
  readonly turnPlayerId: string;
  readonly priorityPlayerId: null;
  readonly focusPlayerId: null;
  readonly stateOpen: true;
  readonly pendingPayment: null;
}
export interface DuelMatchPlayingState extends CommonMatch {
  readonly stage: 'playing';
  /** Seat order, NOT turn order; owns private Main Deck/hand/trash only. */
  readonly players: readonly [DuelMatchPrivatePlayer, DuelMatchPrivatePlayer];
  /** Sole authority for unit location/controller; initially no units. */
  readonly board: DuelBoard;
  /** Sole authority for Rune Decks, runes, Gold and pools. */
  readonly resources: DuelResources;
  readonly scoring: DuelScoringState;
  /** Exact UID-to-board-unit mapping; never a second location/controller authority. */
  readonly unitMeta: Readonly<Record<string, DuelUnitMeta>>;
  /** Retired token identities remain private and cannot be reused. */
  readonly retiredUnitTokenUIDs: readonly string[];
  readonly frame: DuelAwaitingTurnStart;
}
export type DuelMatchState = DuelMatchSetupState | DuelMatchPlayingState;

interface PublicMatchCommon extends CommonMatch {}
export interface PublicDuelMatchSetup extends PublicMatchCommon {
  readonly stage: 'setup';
  readonly setup: PublicDuelSetup;
}
export interface PublicDuelMatchPlayer {
  readonly playerId: string;
  readonly champion: { readonly cardId: string } | null;
  readonly legend: { readonly cardId: string };
  readonly handCount: number;
  readonly mainDeckCount: number;
  /** Omitted for other players and spectators, NOT an empty hand. */
  readonly hand?: readonly SetupCard[];
  /** Public Information (CR 108.2.d), unordered; projected as {uid,cardId} allowlist only. */
  readonly trash: readonly SetupCard[];
}
export interface PublicDuelMatchPlaying extends PublicMatchCommon {
  readonly stage: 'playing';
  readonly players: readonly [PublicDuelMatchPlayer, PublicDuelMatchPlayer];
  /** Unit details are joined by UID from board and metadata, without another location authority. */
  readonly board: Omit<PublicDuelBoard, 'units'> & { readonly units: readonly PublicDuelUnitObject[] };
  readonly resources: PublicDuelResources;
  readonly scoring: DuelScoringState;
  readonly frame: DuelAwaitingTurnStart;
}
export type PublicDuelMatch = PublicDuelMatchSetup | PublicDuelMatchPlaying;

function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new TypeError(`Invalid duel match: ${label}`);
}
function text(raw: unknown, label: string): string {
  check(typeof raw === 'string' && raw.trim().length > 0, label);
  return raw;
}
function counter(raw: unknown, label: string): number {
  check(typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0, label);
  return raw;
}
function record(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), label);
  const prototype = Object.getPrototypeOf(raw);
  check(prototype === Object.prototype || prototype === null, `${label} prototype`);
  const actual = Reflect.ownKeys(raw);
  check(actual.length === keys.length && keys.every(key => actual.includes(key)), `${label} keys`);
  check(actual.every(key => 'value' in Object.getOwnPropertyDescriptor(raw, key)!), `${label} accessors`);
  return raw as Record<string, unknown>;
}
function roster(raw: unknown): [DuelMatchPerson, DuelMatchPerson] {
  check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype && raw.length === 2 &&
    Reflect.ownKeys(raw).length === 3, 'roster must have exactly two dense seats');
  const people = [0, 1].map(i => {
    check('value' in Object.getOwnPropertyDescriptor(raw, String(i))!, `roster[${i}] accessor`);
    const person = record(raw[i], ['playerId', 'displayName'], `roster[${i}]`);
    return { playerId: text(person.playerId, `roster[${i}].playerId`),
      displayName: text(person.displayName, `roster[${i}].displayName`) };
  }) as [DuelMatchPerson, DuelMatchPerson];
  check(people[0].playerId !== people[1].playerId, 'duplicate roster playerId');
  return people;
}
function metadata(raw: DuelMatchMetadata): DuelMatchMetadata {
  const value = record(raw, ['matchId', 'dataVersion', 'catalogDigest', 'roster'], 'metadata');
  return { matchId: text(value.matchId, 'matchId'), dataVersion: text(value.dataVersion, 'dataVersion'),
    catalogDigest: text(value.catalogDigest, 'catalogDigest'), roster: roster(value.roster) };
}
function common(source: CommonMatch, stateVersion: number, eventSeq: number): CommonMatch {
  return { schemaVersion: source.schemaVersion, rulesetId: source.rulesetId, matchId: source.matchId,
    dataVersion: source.dataVersion, catalogDigest: source.catalogDigest,
    stateVersion, eventSeq,
    roster: source.roster.map(person => ({ playerId: person.playerId, displayName: person.displayName })) as
      [DuelMatchPerson, DuelMatchPerson],
    turnOrder: [...source.turnOrder] as [string, string] };
}

/** New authoritative setup from four decks; only caller-provided RNG drives shuffle and selection. */
export function createDuelMatch(
  seats: readonly DuelSetupSeat[], supplied: DuelMatchMetadata,
  randomIndex: (exclusiveUpperBound: number) => number,
): DuelMatchState {
  const info = metadata(supplied);
  // The helper validates seats before the first RNG call; reject a roster mismatch at that
  // first boundary rather than consume any randomness for an invalid constructor input.
  check(typeof randomIndex === 'function', 'randomIndex');
  let checkedRoster = false;
  const setup = createDuelSetup(seats, bound => {
    if (!checkedRoster) {
      check(seats[0]?.playerId === info.roster[0].playerId &&
        seats[1]?.playerId === info.roster[1].playerId, 'roster/seat order mismatch');
      checkedRoster = true;
    }
    return randomIndex(bound);
  });
  check(setup.playerIds.every((id, i) => id === info.roster[i]!.playerId), 'roster/seat order mismatch');
  return { stage: 'setup', schemaVersion: 1, rulesetId: 'riftbound-duel',
    matchId: info.matchId, dataVersion: info.dataVersion, catalogDigest: info.catalogDigest,
    stateVersion: 0, eventSeq: 0, roster: info.roster,
    turnOrder: [...setup.turnOrder] as [string, string], setup };
}

/** Exactly one success per seat. Second success atomically replaces setup with the sole playing authority. */
export function resolveDuelMulligan(
  state: DuelMatchState, actor: string, selectedUIDs: readonly string[],
  randomIndex?: (exclusiveUpperBound: number) => number,
): DuelMatchState {
  check(state.stage === 'setup', 'mulligan is only allowed during setup');
  const stateVersion = counter(state.stateVersion, 'stateVersion');
  const eventSeq = counter(state.eventSeq, 'eventSeq');
  check(stateVersion < Number.MAX_SAFE_INTEGER && eventSeq < Number.MAX_SAFE_INTEGER, 'version overflow');
  check(state.setup.stage === 'mulligan', 'mulligan already finished');
  check(state.setup.playerIds.every((id, i) => id === state.roster[i]?.playerId), 'setup/roster mismatch');
  check(state.turnOrder.every((id, i) => id === state.setup.turnOrder[i]), 'turnOrder mismatch');
  const next = mulliganDuelSetup(state.setup, actor, selectedUIDs, randomIndex);
  const nextCommon = common(state, stateVersion + 1, eventSeq + 1);
  if (next.stage === 'mulligan') return { ...nextCommon, stage: 'setup', setup: next };

  // No RNG here: completeDuelSetup detaches hand/Main/Rune zones, then setup is discarded.
  const transfer = completeDuelSetup(next);
  const board = createDuelBoard(transfer.selection);
  const resources = createDuelResources({ playerIds: transfer.playerIds,
    baseLocations: board.bases.map(base => ({ playerId: base.ownerPlayerId, locationId: base.locationId })),
    runeDecks: transfer.runeDecks });
  const scoring = createDuelScoring(board);
  const privatePlayer = (player: (typeof transfer.players)[number]): DuelMatchPrivatePlayer => ({
    playerId: player.playerId, champion: { ...player.champion }, legend: { ...player.legend },
    hand: player.hand.map(card => ({ ...card })),
    remainingMainDeck: player.remainingMainDeck.map(card => ({ ...card })), trash: [],
  });
  const players: [DuelMatchPrivatePlayer, DuelMatchPrivatePlayer] = [
    privatePlayer(transfer.players[0]!), privatePlayer(transfer.players[1]!),
  ];
  return { ...nextCommon, stage: 'playing', players, board, resources, scoring, unitMeta: {},
    retiredUnitTokenUIDs: [],
    frame: { phase: 'awaiting-turn-start', turnNumber: 1, turnPlayerId: transfer.firstPlayerId,
      priorityPlayerId: null, focusPlayerId: null, stateOpen: true, pendingPayment: null } };
}

/** Viewer is an authenticated seat ID or null for a spectator; never a client-supplied snapshot. */
export function projectDuelMatch(state: DuelMatchState, viewer: string | null): PublicDuelMatch {
  check(viewer === null || state.roster.some(person => person.playerId === viewer), 'unknown viewer');
  const shared = common(state, state.stateVersion, state.eventSeq);
  if (state.stage === 'setup') {
    return { ...shared, stage: 'setup', setup: projectPublicDuelSetup(state.setup, viewer) };
  }
  const players = state.players.map((player): PublicDuelMatchPlayer => ({ playerId: player.playerId,
    champion: player.champion ? { cardId: player.champion.cardId } : null,
    legend: { cardId: player.legend.cardId },
    handCount: player.hand.length, mainDeckCount: player.remainingMainDeck.length,
    ...(viewer === player.playerId ? { hand: player.hand.map(card => ({ uid: card.uid, cardId: card.cardId })) } : {}),
    trash: player.trash.map(({ uid, cardId }) => ({ uid, cardId })) })) as
    [PublicDuelMatchPlayer, PublicDuelMatchPlayer];
  return { ...shared, stage: 'playing', players,
    board: { ...projectPublicDuelBoard(state.board),
      units: state.board.units.length ? projectPublicDuelUnitObjects(state) : [] },
    resources: projectPublicDuelResources(state.resources),
    scoring: projectPublicDuelScoring(state.scoring, state.board),
    frame: { phase: state.frame.phase, turnNumber: state.frame.turnNumber,
      turnPlayerId: state.frame.turnPlayerId, priorityPlayerId: state.frame.priorityPlayerId,
      focusPlayerId: state.frame.focusPlayerId, stateOpen: state.frame.stateOpen,
      pendingPayment: state.frame.pendingPayment } };
}
