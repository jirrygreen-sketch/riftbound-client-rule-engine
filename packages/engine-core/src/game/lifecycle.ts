/**
 * RIFT-262: Match lifecycle over the batch 4/5 rules layer.
 *
 * Match state stays with the host created by the caller; this module only
 * issues primitive actions and structural rules tasks through the same
 * TurnFlow / ChainEngine / EventPipeline path that production uses.
 */
import type { ActionOutcome, Domain, GameAction, ObjectRef, PlayerId, PlayerSnapshot, ZoneId } from '../effects/contract.js';
import type { PipelineHost, PipelineEvent } from '../events/pipeline-types.js';
import { createProgramBinding, type ProgramBinding, type ProgramSource } from '../programs/index.js';
import { TurnFlow } from '../turn/flow.js';

export interface MatchCard {
  readonly id: string;
  readonly cardId?: string | null;
  readonly canonicalCardId?: string | null;
  readonly name?: string;
  /** The source catalog's card type (for example `Unit` or `Spell`). */
  readonly cardType?: string;
  readonly types?: readonly string[];
  /** Printed tags and deck-building Domains from the trusted card catalog. */
  readonly tags?: readonly string[];
  readonly domains?: readonly string[];
  /** Printed characteristics. `null` means that the characteristic is absent. */
  readonly energy?: number | null;
  /** Headless/catalog cards use a numeric amount; runtime adapters may already
   * provide the ObjectSnapshot Domain list. */
  readonly power?: number | readonly Domain[] | null;
  readonly might?: number | null;
}

export interface MatchDeck {
  readonly mainDeck: readonly MatchCard[];
  readonly runeDeck: readonly MatchCard[];
  readonly championLegend: MatchCard;
  readonly chosenChampion: MatchCard;
  readonly battlefields: readonly [MatchCard, MatchCard, MatchCard];
}

export type MatchHost = PipelineHost & {
  readonly player: (id: PlayerId) => PlayerSnapshot;
};

/** Existing callers supply a trusted registry source or a live ProgramBinding. */
export type MatchPrograms = ProgramBinding | ProgramSource | { readonly [key: string]: unknown };

/** Trusted catalog data installed for each supplied CardProgram. */
export interface MatchProgramCard {
  readonly canonicalCardId: string;
  readonly cardId?: string | null;
  readonly name?: string;
  readonly cardType?: string;
  readonly types?: readonly string[];
  readonly tags?: readonly string[];
  readonly domains?: readonly string[];
  readonly energy?: number | null;
  readonly power?: number | readonly Domain[] | null;
  readonly might?: number | null;
}

export type MatchRulesetVersion = 'core-1.5';

export interface MatchOptions {
  readonly decks: readonly [MatchDeck, MatchDeck];
  readonly seed?: number | string;
  readonly rulesetVersion?: MatchRulesetVersion;
  readonly battlefieldChoice?: readonly [number | undefined, number | undefined];
  readonly firstPlayer?: 0 | 1;
  readonly mulligans?: readonly [readonly string[], readonly string[]];
  readonly victoryScore?: number;
  readonly battlefieldControllers?: readonly [PlayerId | null, PlayerId | null];
  readonly programs?: MatchPrograms;
  /** Catalog projection used to reconcile the deck's printed data before setup. */
  readonly catalog?: readonly MatchProgramCard[];
  readonly host: MatchHost;
}

export interface MatchBattlefield {
  readonly id: string;
  readonly cardId: string | null;
  readonly controller: PlayerId | null;
  readonly contestedBy: PlayerId | null;
  readonly staged: 'none' | 'showdown' | 'combat';
}

export interface MatchSetupReport {
  readonly legendZone: Readonly<Record<PlayerId, readonly string[]>>;
  readonly championZone: Readonly<Record<PlayerId, readonly string[]>>;
  readonly battlefields: readonly MatchBattlefield[];
  readonly removedBattlefields: Readonly<Record<PlayerId, readonly string[]>>;
  readonly hands: Readonly<Record<PlayerId, readonly string[]>>;
  readonly openingHands: Readonly<Record<PlayerId, readonly string[]>>;
  readonly mainDeckCount: Readonly<Record<PlayerId, number>>;
  readonly runeDeckCount: Readonly<Record<PlayerId, number>>;
  readonly mulligans: Readonly<Record<PlayerId, readonly string[]>>;
  readonly burnOuts: Readonly<Record<PlayerId, number>>;
}

export interface MatchResult {
  readonly winner: PlayerId | null;
  readonly turnNumber: number;
}

/** The deterministic seed is a setup fact, so the match exposes what was used. */
export interface MatchSeedReport {
  readonly source: 'given' | 'generated';
  readonly value: number;
  readonly logged: string;
}

export interface Match {
  readonly rulesetVersion: MatchRulesetVersion;
  readonly seed: number;
  readonly seedSource: 'given' | 'generated';
  readonly seedReport: MatchSeedReport;
  readonly turnOrder: readonly [PlayerId, PlayerId];
  readonly firstPlayer: PlayerId;
  readonly setup: MatchSetupReport;
  readonly flow: TurnFlow;
  readonly programs?: MatchPrograms;
  /** Registry installed on this match's real Chain when MatchPrograms was supplied. */
  readonly programBinding?: ProgramBinding;
  readonly result: () => MatchResult;
  readonly events: () => readonly PipelineEvent[];
}

function isProgramBinding(value: unknown): value is ProgramBinding {
  const candidate = value as Partial<ProgramBinding>;
  return candidate.registry !== undefined && typeof candidate.describePlay === 'function' &&
    typeof candidate.attachLifecycle === 'function';
}

function programSource(value: MatchPrograms): ProgramSource {
  if (isProgramBinding(value)) throw new TypeError('A ProgramBinding cannot be treated as a card source');
  if (Array.isArray(value) || value instanceof Map) return value as ProgramSource;
  if (!('programs' in value) || value.programs === undefined) {
    throw new TypeError('MatchPrograms must be a ProgramBinding or CardProgram source');
  }
  if (!Array.isArray(value.programs) && !(value.programs instanceof Map)) {
    throw new TypeError('MatchPrograms.programs must be a CardProgram array or map');
  }
  return value.programs as ProgramSource;
}

const idempotentBindings = new WeakSet<ProgramBinding>();

/** One binding may be attached by both Match and its existing state owner. */
function makeProgramLifecycleIdempotent(binding: ProgramBinding): void {
  if (idempotentBindings.has(binding)) return;
  const handles = new WeakMap<object, {
    readonly handle: ReturnType<ProgramBinding['attachLifecycle']>;
    count: number;
  }>();
  const original = binding.attachLifecycle.bind(binding);
  Object.defineProperty(binding, 'attachLifecycle', {
    configurable: false,
    enumerable: true,
    value: (engine: Match['flow']['chain'], onError?: Parameters<ProgramBinding['attachLifecycle']>[1]) => {
      let entry = handles.get(engine);
      if (entry === undefined) {
        entry = { handle: original(engine, onError), count: 0 };
        handles.set(engine, entry);
      }
      const attached = entry;
      attached.count++;
      let active = true;
      return {
        detach() {
          if (!active) return;
          active = false;
          attached.count--;
          if (attached.count === 0 && handles.get(engine) === attached) {
            handles.delete(engine);
            attached.handle.detach();
          }
        },
      };
    },
    writable: false,
  });
  idempotentBindings.add(binding);
}

/** Wins that arrive outside TurnFlow's score cleanup (concede, contract gap). */
const matchEndings = new WeakMap<Match, { winner: PlayerId | null }>();

function matchWinner(match: Match): PlayerId | null {
  return match.flow.winner ?? matchEndings.get(match)?.winner ?? null;
}

function matchSeedLog(seed: number, source: 'given' | 'generated'): string {
  return 'match seed ' + seed + ' (' + source + ')';
}

const RULESET_VERSION: MatchRulesetVersion = 'core-1.5';
const DEFAULT_VICTORY_SCORE = 8;
const OPENING_HAND_SIZE = 4;
const MULLIGAN_LIMIT = 2;
const DECK_ZONES = ['deck', 'rune-deck'] as const;

type DeckZone = (typeof DECK_ZONES)[number];

/** SplitMix32; every match decision consumes one 32-bit draw from the match seed. */
class MatchRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
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
  get value(): number {
    return this.state;
  }
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function shuffleOrder(count: number, random: MatchRandom): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = random.next() % (index + 1);
    const held = order[index]!;
    order[index] = order[swap]!;
    order[swap] = held;
  }
  return order;
}

function deckIds(zone: DeckZone, host: MatchHost, player: PlayerId): string[] {
  return host.objects()
    .filter(object => object.owner === player && object.zone === zone)
    .map(object => object.ref.id);
}

function createToken(
  host: MatchHost,
  player: PlayerId,
  token: ReturnType<typeof tokenCard>,
  destination: 'chain' | 'legend' = 'chain',
): string {
  const outcome = execute(host, destination === 'legend'
    ? { type: 'create-token', player, token, to: 'legend' }
    : { type: 'create-token', player, token, to: 'chain' });
  const created = outcome.status === 'done' && 'result' in outcome ? outcome.result as { id: string } | undefined : undefined;
  if (!created || typeof created.id !== 'string') {
    throw new Error('Match setup token was not created');
  }
  return created.id;
}

function handIds(host: MatchHost, player: PlayerId): string[] {
  return host.objects()
    .filter(object => object.owner === player && object.zone === 'hand')
    .map(object => object.ref.id);
}

function zoneCardIds(host: MatchHost, player: PlayerId, zone: ZoneId): string[] {
  return host.objects()
    .filter(object => object.owner === player && object.zone === zone)
    .map(object => object.ref.id);
}

function requireRef(host: MatchHost, id: string): ObjectRef {
  const found = host.objects().find(object => object.ref.id === id);
  if (!found) throw new Error('Match setup cannot find card ' + id);
  return { id: found.ref.id, zoneEntryId: found.ref.zoneEntryId };
}

function execute(host: MatchHost, action: GameAction): ActionOutcome {
  const outcome = host.execute(action);
  if (outcome.outcome.status !== 'done') {
    throw new Error('Match setup action failed: ' + action.type + ' (' + outcome.outcome.status + ')');
  }
  return outcome.outcome;
}

function normalizedDomains(card: MatchCard): readonly Domain[] {
  const valid = new Set<Domain>(['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order']);
  const normalized: Domain[] = [];
  for (const [index, domain] of (card.domains ?? []).entries()) {
    if (!valid.has(domain as Domain)) {
      throw new TypeError(`Match card ${card.id} has an invalid Domain at index ${index}`);
    }
    if (!normalized.includes(domain as Domain)) normalized.push(domain as Domain);
  }
  return normalized;
}

/**
 * ObjectSnapshot stores the source's Power Domains, while the catalog stores a
 * separate numeric Power amount. Keep the Domain set unique here so programs
 * that derive an ability's own Domains do not receive duplicate values. The
 * cost planner's exact numeric printed amount must come from its catalog
 * projection (`CostPlanInput.printed`); that scalar is not part of the
 * ObjectSnapshot contract.
 */
function objectPower(card: MatchCard): readonly Domain[] | null {
  const printedPower = card.power;
  if (printedPower === undefined || printedPower === null) return null;
  if (Array.isArray(printedPower)) {
    const types = (card.types ?? []).map(type => type.toLowerCase());
    if (card.energy === null && types.length > 0 && types.every(type => !['unit', 'gear', 'spell'].includes(type))) return null;
    return normalizedDomains({ ...card, domains: printedPower, power: null });
  }
  if (typeof printedPower !== 'number' || !Number.isSafeInteger(printedPower) || printedPower < 0) {
    throw new TypeError(`Match card ${card.id} has an invalid printed Power value`);
  }
  const domains = normalizedDomains(card);
  if (printedPower === 0) return [];
  if (domains.length === 0) {
    // The object contract cannot carry a scalar amount and an [A] marker at
    // once. The six-domain set is the contract's any-Domain carrier; exact
    // numeric payment remains with the catalog-bound printed-cost adapter.
    return ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];
  }
  return domains;
}

function tokenCard(card: MatchCard, types: readonly string[], championLegend = false) {
  const normalizedTypes = types.map(type => type.trim().toLowerCase());
  if (normalizedTypes.includes('legend') || normalizedTypes.includes('champion')) {
    return {
      cardId: card.canonicalCardId ?? card.cardId ?? null,
      name: card.name ?? card.id,
      types: [...types],
      tags: [...(card.tags ?? [])],
      might: null,
      energy: null,
      power: null,
      ...(championLegend ? { championLegend: true as const } : {}),
    };
  }
  return {
    // The source catalog's printing id may differ from the canonical card id.
    // Programs and identity checks are keyed by the canonical id; the setup
    // report retains the printing id separately for presentation.
    cardId: card.canonicalCardId ?? card.cardId ?? null,
    name: card.name ?? card.id,
    types: [...types],
    tags: [...(card.tags ?? [])],
    might: card.might ?? null,
    energy: card.energy ?? null,
    power: objectPower(card),
  };
}

function pickBattlefields(
  deck: MatchDeck,
  player: PlayerId,
  host: MatchHost,
  report: {
    battlefields: MatchBattlefield[];
    removedBattlefields: Record<PlayerId, string[]>;
  },
  chosen: number | undefined,
  random: MatchRandom,
): void {
  if (deck.battlefields.length !== 3) {
    throw new TypeError('Each seat supplies exactly three battlefields (CR 487.5)');
  }
  const pick = chosen ?? Math.floor(random.next() / 2 ** 32 * 3);
  if (!Number.isInteger(pick) || pick < 0 || pick > 2) {
    throw new RangeError('battlefieldChoice must be 0, 1 or 2');
  }
  for (const [index, card] of deck.battlefields.entries()) {
    const id = createToken(host, player, tokenCard(card, ['battlefield']));
    if (index === pick) {
      // CR 133.6.a.1 / 170.2.b / 199.1 / 440.2.b.5 / 487.5: the selected
      // Battlefield starts on the Board at its own Location. create-token must
      // produce the object identity first, so this is the same real token
      // incarnation moved immediately to its self-location rather than a
      // second registration or a synthetic object written by test code.
      execute(host, {
        type: 'move-zone',
        object: requireRef(host, id),
        to: 'battlefield',
        location: { type: 'battlefield', id },
      });
      report.battlefields.push({ id, cardId: card.cardId ?? null, controller: null, contestedBy: null, staged: 'none' });
    }
    else report.removedBattlefields[player]!.push(card.cardId ?? card.id);
  }
}

function createDeckCards(deck: MatchDeck, player: PlayerId, zone: DeckZone, host: MatchHost): void {
  const cards = zone === 'deck' ? deck.mainDeck : deck.runeDeck;
  const destination = zone === 'deck' ? 'deck-bottom' : 'rune-deck';
  for (const card of cards) {
    const fallbackTypes = zone === 'deck' ? ['unit'] : ['rune'];
    const cardTypes = card.types?.length ? card.types : card.cardType ? [card.cardType.toLowerCase()] : fallbackTypes;
    const id = createToken(host, player, tokenCard(card, cardTypes));
    // create-token cannot target deck zones, so each card is created on the
    // Chain and immediately moved into its shuffled starting zone (CR 114).
    execute(host, { type: 'move-zone', object: requireRef(host, id), to: destination });
  }
}

function normalizedProgramType(card: MatchProgramCard): readonly string[] | undefined {
  const explicit = card.types?.map(type => type.trim().toLowerCase()).filter(type => type.length > 0);
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const type = card.cardType?.trim().toLowerCase();
  return type === undefined || type.length === 0 ? undefined : [type];
}

/**
 * Reconcile each deck printing with trusted catalog rows before any setup
 * token is created. A printing and canonical identity may intentionally
 * differ; neither is guessed, and missing rows fail before state mutation.
 */
export function synchronizeMatchDecks(
  decks: readonly [MatchDeck, MatchDeck],
  catalog: readonly MatchProgramCard[],
): readonly [MatchDeck, MatchDeck] {
  const rows = new Map<string, readonly MatchProgramCard[]>();
  for (const [index, card] of catalog.entries()) {
    if (!card || typeof card.canonicalCardId !== 'string' || card.canonicalCardId.length === 0) {
      throw new TypeError(`Match catalog row ${index} has no canonicalCardId`);
    }
    const existing = rows.get(card.canonicalCardId) ?? [];
    if (!existing.some(row => JSON.stringify(row) === JSON.stringify(card))) {
      rows.set(card.canonicalCardId, [...existing, card]);
    }
  }
  const reconcile = (card: MatchCard): MatchCard => {
    const canonicalCardId = card.canonicalCardId ?? card.cardId;
    if (canonicalCardId === undefined || canonicalCardId === null || canonicalCardId.length === 0) return card;
    const candidates = rows.get(canonicalCardId) ?? rows.get(card.id) ?? [];
    if (candidates.length === 0) throw new TypeError(`Match catalog is missing ${canonicalCardId}`);
    const byPrintingId = candidates.filter(candidate => candidate.cardId === card.id);
    const byCatalogPrinting = candidates.filter(candidate => candidate.cardId === card.cardId);
    const trusted = byPrintingId.length === 1
      ? byPrintingId[0]
      : byCatalogPrinting.length === 1
        ? byCatalogPrinting[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
    if (trusted === undefined) throw new TypeError(`Match catalog identity ${canonicalCardId} is ambiguous for ${card.id}`);
    const types = normalizedProgramType(trusted) ?? card.types;
    return {
      ...card,
      canonicalCardId,
      ...(trusted.name === undefined ? {} : { name: trusted.name }),
      ...(trusted.cardType === undefined ? {} : { cardType: trusted.cardType }),
      ...(types === undefined ? {} : { types }),
      ...(trusted.tags === undefined ? {} : { tags: [...trusted.tags] }),
      ...(trusted.domains === undefined ? {} : { domains: [...trusted.domains] }),
      ...(trusted.energy === undefined ? {} : { energy: trusted.energy }),
      ...(trusted.power === undefined ? {} : { power: Array.isArray(trusted.power) ? [...trusted.power] as Domain[] : trusted.power }),
      ...(trusted.might === undefined ? {} : { might: trusted.might }),
    };
  };
  const deck = (value: MatchDeck): MatchDeck => ({
    mainDeck: value.mainDeck.map(reconcile),
    runeDeck: value.runeDeck.map(reconcile),
    championLegend: reconcile(value.championLegend),
    chosenChampion: reconcile(value.chosenChampion),
    battlefields: value.battlefields.map(reconcile) as unknown as MatchDeck['battlefields'],
  });
  return [deck(decks[0]), deck(decks[1])];
}

function shuffleWithSeed(zone: DeckZone, player: PlayerId, host: MatchHost, random: MatchRandom): void {
  const ids = deckIds(zone, host, player);
  const order = shuffleOrder(ids.length, random);
  execute(host, {
    type: 'order-top',
    player,
    objects: order.map(index => requireRef(host, ids[index]!)),
    zone,
  });
}

function applyMulligan(
  player: PlayerId,
  requested: readonly string[] | undefined,
  host: MatchHost,
  report: { mulligans: Record<PlayerId, string[]>; burnOuts: Record<PlayerId, number> },
): void {
  const chosen = requested ?? [];
  if (chosen.length > MULLIGAN_LIMIT) {
    throw new RangeError('A player mulligans at most two cards (CR 117.1)');
  }
  const hand = zoneCardIds(host, player, 'hand');
  const resolvedIds: string[] = [];
  for (const cardId of chosen) {
    const objects = host.objects();
    const match = hand.find(id => objects.find(candidate => candidate.ref.id === id)?.cardId === cardId);
    if (!match) throw new RangeError('Mulligan cards must be in that player\'s hand');
    resolvedIds.push(match);
  }
  if (new Set(resolvedIds).size !== resolvedIds.length) {
    throw new RangeError('Mulligan cards must be distinct');
  }
  report.mulligans[player] = [...chosen];
  if (chosen.length === 0) return;
  // CR 117.1: the set-aside cards stay in the Chain Zone while replacements
  // are drawn, so a Burn Out recycles only the Trash (CR 432.2.b) and never
  // pulls the player's own pending mulligan cards back before CR 117.3.
  for (const id of resolvedIds) execute(host, { type: 'move-zone', object: requireRef(host, id), to: 'chain' });
  let remaining = chosen.length;
  let guard = 0;
  while (remaining > 0) {
    if (++guard > 16) throw new Error('Mulligan Burn Out did not converge [pre-check]');
    const before = host.player(player).deckCount;
    const drawn = Math.min(remaining, before);
    if (drawn > 0) {
      execute(host, { type: 'draw', player, amount: drawn });
      remaining -= drawn;
    }
    if (remaining > 0) {
      const trashIds = zoneCardIds(host, player, 'trash').filter(id => !resolvedIds.includes(id));
      if (drawn === 0 && trashIds.length === 0) {
        // CR 432.3: a repeated Burn Out with an empty deck and empty trash
        // keeps awarding the opponent a point until the player wins by score.
        const opponent = player === 'A' ? 'B' : 'A';
        execute(host, { type: 'score', player: opponent, amount: 1 });
        report.burnOuts[player] = (report.burnOuts[player] ?? 0) + 1;
        continue;
      }
      for (const id of trashIds) execute(host, { type: 'recycle', object: requireRef(host, id) });
      const opponent = player === 'A' ? 'B' : 'A';
      execute(host, { type: 'score', player: opponent, amount: 1 });
      report.burnOuts[player] = (report.burnOuts[player] ?? 0) + 1;
    }
  }
  // Re-resolve refs: moving to Trash bumped each card's zoneEntryId.
  for (const id of resolvedIds) execute(host, { type: 'recycle', object: requireRef(host, id) });
}

export function createMatch(options: MatchOptions): Match {
  const version = options.rulesetVersion ?? RULESET_VERSION;
  if (version !== RULESET_VERSION) {
    throw new TypeError('Unsupported ruleset version: ' + String(options.rulesetVersion));
  }
  const host = options.host;
  if (!host || typeof host.execute !== 'function' || typeof host.player !== 'function') {
    throw new TypeError('createMatch requires a match host with execute and player reads');
  }
  if (options.decks.length !== 2) {
    throw new TypeError('createMatch requires exactly two decks');
  }
  const [deckA, deckB] = options.catalog === undefined
    ? options.decks
    : synchronizeMatchDecks(options.decks, options.catalog);
  // Validation happens before setup writes any object or resource state. The
  // concrete registry then drives both direct Play commands and effect.Play.
  const providedBinding = options.programs !== undefined && isProgramBinding(options.programs)
    ? options.programs
    : undefined;
  const programBinding = options.programs === undefined
    ? undefined
    : providedBinding ?? createProgramBinding({ cardPrograms: programSource(options.programs) });
  if (programBinding !== undefined) makeProgramLifecycleIdempotent(programBinding);
  const random = new MatchRandom(
    typeof options.seed === 'string' ? hashSeed(options.seed) :
      typeof options.seed === 'number' ? Math.trunc(options.seed) >>> 0 :
        (Date.now() >>> 0),
  );
  const seedSource: Match['seedSource'] = options.seed === undefined ? 'generated' : 'given';
  const seed = typeof options.seed === 'string' ? hashSeed(options.seed) :
    typeof options.seed === 'number' ? Math.trunc(options.seed) >>> 0 :
      random.value;
  const firstIndex = options.firstPlayer ?? (random.next() < 2 ** 31 ? 0 : 1);
  const turnOrder: [PlayerId, PlayerId] = firstIndex === 0 ? ['A', 'B'] : ['B', 'A'];
  const report = {
    legendZone: { A: [], B: [] } as Record<PlayerId, string[]>,
    championZone: { A: [], B: [] } as Record<PlayerId, string[]>,
    battlefields: [] as MatchBattlefield[],
    removedBattlefields: { A: [], B: [] } as Record<PlayerId, string[]>,
    hands: { A: [], B: [] } as Record<PlayerId, string[]>,
    openingHands: { A: [], B: [] } as Record<PlayerId, string[]>,
    mainDeckCount: { A: 0, B: 0 } as Record<PlayerId, number>,
    runeDeckCount: { A: 0, B: 0 } as Record<PlayerId, number>,
    mulligans: { A: [], B: [] } as Record<PlayerId, string[]>,
    burnOuts: { A: 0, B: 0 } as Record<PlayerId, number>,
  };
  // CR 107.4 / 111: the Champion Legend is established in its public Legend
  // Zone for the whole game (174.2.b); CR 112 keeps the Chosen Champion in the
  // existing Champion placement path.
  for (const seat of [{ id: 'A', deck: deckA! }, { id: 'B', deck: deckB! }] as const) {
    createToken(host, seat.id, tokenCard(seat.deck.championLegend, ['legend'], true), 'legend');
    report.legendZone[seat.id] = [seat.deck.championLegend.cardId ?? seat.deck.championLegend.id];
    createToken(host, seat.id, tokenCard(seat.deck.chosenChampion, ['champion']));
    report.championZone[seat.id] = [seat.deck.chosenChampion.cardId ?? seat.deck.chosenChampion.id];
  }
  // CR 113/487.5: three set aside, one enters the Battlefield Zone, two removed.
  const choices = options.battlefieldChoice;
  pickBattlefields(deckA!, 'A', host, report, choices?.[0], random);
  pickBattlefields(deckB!, 'B', host, report, choices?.[1], random);
  if (options.battlefieldControllers !== undefined) {
    if (options.battlefieldControllers.length !== report.battlefields.length) {
      throw new TypeError('battlefieldControllers must match the selected Battlefields');
    }
    for (const [index, controller] of options.battlefieldControllers.entries()) {
      if (controller !== null && !turnOrder.includes(controller)) {
        throw new TypeError('battlefieldControllers requires known players');
      }
      Object.assign(report.battlefields[index]!, { controller });
    }
  }
  // CR 114: create into zones, then shuffle each deck separately from the match seed.
  for (const seat of [{ id: 'A', deck: deckA! }, { id: 'B', deck: deckB! }] as const) {
    for (const zone of DECK_ZONES) {
      createDeckCards(seat.deck, seat.id, zone, host);
      shuffleWithSeed(zone, seat.id, host, random);
    }
  }
  for (const seat of [{ id: 'A', deck: deckA! }, { id: 'B', deck: deckB! }] as const) {
    report.mainDeckCount[seat.id] = host.player(seat.id).deckCount;
    report.runeDeckCount[seat.id] = host.player(seat.id).runeDeckCount;
  }
  // CR 116: opening hands.
  for (const seat of [{ id: 'A', deck: deckA! }, { id: 'B', deck: deckB! }] as const) {
    execute(host, { type: 'draw', player: seat.id, amount: OPENING_HAND_SIZE });
    report.openingHands[seat.id] = zoneCardIds(host, seat.id, 'hand').map(id => {
      const object = host.objects().find(candidate => candidate.ref.id === id);
      return object?.cardId ?? id;
    });
  }
  // CR 117: mulligans in turn order; the input deck order stays seat order.
  const seatsInTurnOrder = firstIndex === 0
    ? [{ id: 'A', index: 0 }, { id: 'B', index: 1 }] as const
    : [{ id: 'B', index: 1 }, { id: 'A', index: 0 }] as const;
  for (const seat of seatsInTurnOrder) {
    try {
      applyMulligan(seat.id, options.mulligans?.[seat.index], host, report);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Mulligan Burn Out did not converge')) {
        throw new Error(error.message + ' [seat=' + seat.id + ' deck=' + host.player(seat.id).deckCount + ' hand=' + handIds(host, seat.id).length + ' trash=' + zoneCardIds(host, seat.id, 'trash').length + ' scoreA=' + host.player('A').score + ' scoreB=' + host.player('B').score + ']');
      }
      throw error;
    }
  }
  for (const seat of [{ id: 'A', deck: deckA! }, { id: 'B', deck: deckB! }] as const) {
    report.hands[seat.id] = handIds(host, seat.id);
  }
  const flow = new TurnFlow({
    host,
    player: id => host.player(id),
    turnOrder,
    battlefields: report.battlefields,
    victoryScore: options.victoryScore ?? DEFAULT_VICTORY_SCORE,
    ...(programBinding === undefined ? {} : { describePlay: programBinding.describePlay }),
  });
  flow.start();
  flow.chain.initializeBattlefieldControl(report.battlefields);
  for (const field of flow.battlefields) {
    const reported = report.battlefields.find(value => value.id === field.id);
    if (reported) {
      Object.assign(reported, {
        controller: field.controller,
        contestedBy: field.contestedBy,
        staged: field.staged,
      });
    }
  }
  for (const seat of [{ id: 'A', deck: deckA! }, { id: 'B', deck: deckB! }] as const) {
    report.hands[seat.id] = zoneCardIds(host, seat.id, 'hand').map(id => {
      const object = host.objects().find(candidate => candidate.ref.id === id);
      return object?.cardId ?? id;
    });
  }
  const match: Match = {
    rulesetVersion: RULESET_VERSION,
    seed,
    seedSource,
    seedReport: {
      source: seedSource,
      value: seed,
      logged: matchSeedLog(seed, seedSource),
    },
    turnOrder,
    firstPlayer: turnOrder[0],
    setup: report,
    flow,
    programs: options.programs,
    ...(programBinding === undefined ? {} : { programBinding }),
    result: () => ({ winner: matchWinner(match), turnNumber: flow.turn }),
    events: () => flow.chain.pipeline.events,
  };
  matchEndings.set(match, { winner: null });
  void seedSource;
  return match;
}

/** CR 650-651.1: a remaining 1v1 player wins when the other player concedes. */
export function concede(match: Match, player: PlayerId): void {
  const ended = matchEndings.get(match);
  if (match.flow.winner || ended?.winner) throw new Error('Game is already over');
  const opponent = match.turnOrder.find(id => id !== player);
  if (!opponent) throw new Error('Unknown player: ' + player);
  const outcome = match.flow.chain.commit({ type: 'win', player: opponent });
  if (outcome.status !== 'done') throw new Error('Concede failed: ' + outcome.status);
  if (outcome.result !== opponent) throw new Error('Concede did not produce a winner');
  if (ended) ended.winner = opponent;
}
