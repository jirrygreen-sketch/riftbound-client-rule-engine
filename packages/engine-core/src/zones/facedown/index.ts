import type { Ability } from '@riftbound/card-dsl';
import type { ObjectRef, ObjectSnapshot, PlayerId, ResolveContext, ZoneId } from '../../effects/contract.js';
import { buildHiddenCostPlan } from '../../cost/kinds/hidden.js';
import { prepareCostPayment } from '../../cost/payment.js';
import type { CostPlanInput } from '../../cost/plan-types.js';
import type { ContinuousEffectRegistry } from '../../layers/duration.js';
import { canAct, restrictions } from '../../layers/rules/query.js';
import { sameRef } from '../../layers/types.js';
import { projectFor } from '../../projection/v2/project-for.js';
import type { ProjectionObjectInput, ProjectionViewer } from '../../projection/v2/types.js';

/** Trusted source data; Champion is absent from the shared primitive ZoneId. */
export type HideSource = Omit<ObjectSnapshot, 'zone'> & { readonly zone: ZoneId | 'champion' };
type Front = Pick<ObjectSnapshot, 'cardId' | 'name' | 'types' | 'tags' | 'keywords' | 'might' | 'energy' | 'power'>;

/** Private front-side data is deliberately not an executable ObjectSnapshot. */
export interface FacedownEntry {
  readonly ref: ObjectRef;
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  readonly front: Front;
  readonly hiddenOnTurn: number;
}

/** Battlefield control stays in the authoritative battlefield snapshot. */
export interface FacedownZone {
  readonly battlefieldId: string;
  readonly cards: readonly FacedownEntry[];
}

export interface FacedownTiming {
  /** Global turn ordinal, not a player's personal turn count. */
  readonly turn: number;
  readonly actor: PlayerId;
  readonly turnPlayer: PlayerId;
  readonly priorityHolder: PlayerId | null;
  readonly stateOpen: boolean;
  readonly showdown: boolean;
  readonly focusHolder?: PlayerId | null;
}

export class FacedownError extends Error {
  constructor(readonly reason: 'illegal-hide' | 'zone-full' | 'illegal-play' | 'stale-reference' | 'invalid-state' | 'judge-required', message: string) {
    super(message);
    this.name = 'FacedownError';
  }
}

function check(condition: unknown, reason: FacedownError['reason'], message: string): asserts condition {
  if (!condition) throw new FacedownError(reason, message);
}

function ordinal(value: number): void {
  check(Number.isSafeInteger(value) && value >= 0, 'invalid-state', 'Turn must be a nonnegative safe integer');
}

function nextRef(ref: ObjectRef): ObjectRef {
  check(typeof ref.id === 'string' && ref.id.length > 0 && Number.isSafeInteger(ref.zoneEntryId) && ref.zoneEntryId >= 0 && ref.zoneEntryId < Number.MAX_SAFE_INTEGER,
    'invalid-state', 'Invalid or exhausted zone-entry identity');
  return { id: ref.id, zoneEntryId: ref.zoneEntryId + 1 };
}

function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}

function fieldFor(zone: FacedownZone, battlefield: ObjectSnapshot): void {
  check(battlefield.ref.id === zone.battlefieldId && battlefield.zone === 'board' &&
    battlefield.types.some(type => type.toLowerCase() === 'battlefield') && !battlefield.faceDown,
  'invalid-state', 'Expected this zone\'s authoritative battlefield');
}

function find(zone: FacedownZone, ref: ObjectRef): FacedownEntry {
  const entry = zone.cards.find(card => sameRef(card.ref, ref));
  check(entry, 'stale-reference', 'Card is no longer in this facedown zone');
  return entry;
}

function uniqueRefs(refs: readonly ObjectRef[]): boolean {
  return new Set(refs.map(ref => JSON.stringify([ref.id, ref.zoneEntryId]))).size === refs.length;
}

export function createFacedownZone(battlefieldId: string): FacedownZone {
  check(typeof battlefieldId === 'string' && battlefieldId.trim().length > 0, 'invalid-state', 'A battlefield id is required');
  return frozen({ battlefieldId, cards: [] });
}

/** CR 107.3.b: default one; the named registrations express additional slots. */
export function facedownCapacity(zone: FacedownZone, battlefield: ObjectSnapshot, registry?: ContinuousEffectRegistry): number {
  fieldFor(zone, battlefield);
  let maximum = 1;
  for (const rule of registry ? restrictions(registry, 'hide', battlefield.ref, battlefield, battlefield.controller) : []) {
    if (rule.name !== 'facedown-zone-maximum-occupancy') continue;
    check(typeof rule.amount === 'number' && Number.isSafeInteger(rule.amount), 'judge-required', 'Facedown capacity requires a resolved integer adjustment');
    maximum += rule.amount;
    check(Number.isSafeInteger(maximum), 'invalid-state', 'Facedown capacity overflow');
  }
  return Math.max(0, maximum);
}

export interface HideOptions {
  /** Expanded, authoritative abilities, never client supplied flags. */
  readonly abilities?: readonly Ability[];
  readonly registry?: ContinuousEffectRegistry;
}

/** CR 422 / 811: a transition plan, not a payment or a Play action. */
export function planHide(zone: FacedownZone, source: HideSource, battlefield: ObjectSnapshot, timing: FacedownTiming, options: HideOptions = {}) {
  ordinal(timing.turn);
  fieldFor(zone, battlefield);
  check(timing.turnPlayer === timing.actor && timing.priorityHolder === timing.actor && timing.stateOpen &&
    (!timing.showdown || timing.focusHolder === timing.actor), 'illegal-hide', 'Hide requires Priority in an Open State on your turn');
  check(source.owner === timing.actor && source.controller === timing.actor && battlefield.controller === timing.actor,
    'illegal-hide', 'Hide requires an owned card and a controlled battlefield');
  check((source.zone === 'hand' || source.zone === 'champion') && !source.faceDown && !source.isToken && source.cardId !== null,
    'illegal-hide', 'Hide requires a card in Hand or the Champion Zone');
  check(source.types.some(type => ['spell', 'unit', 'gear'].includes(type.toLowerCase())), 'illegal-hide', 'Only Spells, Units and Gear have Hidden permission');
  const hidden = source.keywords.some(keyword => keyword.id.toLowerCase() === 'hidden') ||
    options.abilities?.some(ability => ability.kind === 'static' && ability.condition === undefined && ability.effect.kind === 'cost.hidden');
  check(hidden || !options.abilities?.some(ability => ability.kind === 'static' && ability.condition !== undefined && ability.effect.kind === 'cost.hidden'),
    'judge-required', 'Conditional Hidden permission requires upstream condition evaluation');
  check(hidden, 'illegal-hide', 'The card has no Hidden permission');
  check(!zone.cards.some(card => card.ref.id === source.ref.id), 'invalid-state', 'Duplicate physical card in facedown zone');
  check(zone.cards.every(card => card.controller === battlefield.controller), 'illegal-hide', 'Control-loss Cleanup must run before hiding another card');
  check(zone.cards.length < facedownCapacity(zone, battlefield, options.registry), 'zone-full', 'The facedown zone is full');
  const front: Front = structuredClone({ cardId: source.cardId, name: source.name, types: source.types, tags: source.tags,
    keywords: source.keywords, might: source.might, energy: source.energy, power: source.power });
  const entry: FacedownEntry = { ref: nextRef(source.ref), owner: source.owner, controller: timing.actor, front, hiddenOnTurn: timing.turn };
  return frozen({ kind: 'hide' as const, from: { ...source.ref }, entry,
    zone: { battlefieldId: zone.battlefieldId, cards: [...structuredClone(zone.cards), entry] }, opensChain: false as const });
}

/** Read-only cost/kinds bridge. The outer executor must pay and apply atomically. */
export function prepareHide(ctx: ResolveContext, zone: FacedownZone, battlefield: ObjectSnapshot, timing: FacedownTiming, id: string, options: HideOptions = {}) {
  check(ctx.controller === timing.actor, 'illegal-hide', 'Cost controller differs from the hiding player');
  const source = ctx.object(ctx.source.ref);
  check(source, 'stale-reference', 'The hiding source has left its zone');
  const transition = planHide(zone, source, battlefield, timing, options);
  const cost = buildHiddenCostPlan(ctx, { id, mode: 'hide', domains: [] });
  const payment = prepareCostPayment(ctx, cost);
  return frozen({ transition, cost, payment });
}

export interface HiddenPlayOptions {
  /** A different destination requires an explicit rules permission upstream. */
  readonly location?: ObjectSnapshot['location'];
  /** Full legal choices for each target, after its explicit printed restrictions. */
  readonly targets?: readonly {
    readonly id: string;
    readonly min: number;
    readonly max: number;
    readonly options: readonly ObjectSnapshot[];
    readonly chosen: readonly ObjectRef[];
  }[];
}

/** CR 811.1.d.4: an empty local board does not waive the targeting restriction. */
export function hiddenTargetOptions(battlefieldId: string, options: readonly ObjectSnapshot[]): readonly ObjectSnapshot[] {
  return structuredClone(options.filter(object => object.zone === 'board' && !object.faceDown &&
    object.location?.type === 'battlefield' && object.location.id === battlefieldId));
}

/** No chain is executed here; the returned card is the proposed Pending identity. */
export function planHiddenPlay(zone: FacedownZone, ref: ObjectRef, battlefield: ObjectSnapshot, timing: FacedownTiming, options: HiddenPlayOptions = {}) {
  ordinal(timing.turn);
  fieldFor(zone, battlefield);
  const entry = find(zone, ref);
  check(entry.controller === timing.actor && battlefield.controller === timing.actor, 'illegal-play', 'Hidden play requires the card and battlefield to remain controlled');
  check(timing.turn > entry.hiddenOnTurn, 'illegal-play', 'Hidden play unlocks beginning on the next turn');
  check(canAct({ player: timing.actor, speed: 'reaction', showdown: timing.showdown, closedState: !timing.stateOpen,
    turnPlayer: timing.turnPlayer, priorityHolder: timing.priorityHolder, focusHolder: timing.focusHolder }),
  'illegal-play', 'Reaction timing does not permit this play');
  const permanent = entry.front.types.some(type => ['unit', 'gear'].includes(type.toLowerCase()));
  const location = { type: 'battlefield' as const, id: zone.battlefieldId };
  check(options.location === undefined || options.location?.type === 'battlefield' && options.location.id === zone.battlefieldId,
    'illegal-play', 'A Hidden permanent must be played to its originating battlefield');
  for (const target of options.targets ?? []) {
    check(Number.isSafeInteger(target.min) && target.min >= 0 && Number.isSafeInteger(target.max) && target.max >= target.min,
      'invalid-state', 'Invalid target bounds');
    const legal = hiddenTargetOptions(zone.battlefieldId, target.options);
    check(target.chosen.length >= target.min && target.chosen.length <= target.max && uniqueRefs(target.chosen) &&
      target.chosen.every(chosen => legal.some(object => sameRef(object.ref, chosen))), 'illegal-play', `Illegal Hidden target selection: ${target.id}`);
  }
  const card: ProjectionObjectInput = { ...structuredClone(entry.front), ref: nextRef(entry.ref), owner: entry.owner,
    controller: entry.controller, zone: 'chain', faceDown: false, reaction: true,
    keywords: [...structuredClone(entry.front.keywords).filter(keyword => keyword.id.toLowerCase() !== 'reaction'), { id: 'reaction' }],
    location: permanent ? location : null };
  return frozen({ kind: 'play-from-facedown' as const, from: { ...entry.ref }, card,
    zone: { battlefieldId: zone.battlefieldId, cards: structuredClone(zone.cards.filter(item => !sameRef(item.ref, ref))) },
    speed: 'reaction' as const, location: permanent ? location : undefined, opensChain: true as const,
    /** CR 422.4: publish the front before committing a zone change. */
    reveal: { ref: { ...entry.ref }, ...structuredClone(entry.front) } });
}

/** Called with the actual Pending source context by the Chain/Finalize owner. */
export function buildFacedownPlayCost(ctx: ResolveContext, plan: ReturnType<typeof planHiddenPlay>, input: Omit<CostPlanInput, 'cost'> & { readonly cost?: CostPlanInput['cost'] }) {
  check(sameRef(ctx.source.ref, plan.card.ref) && ctx.controller === plan.card.controller && ctx.source.zone === 'chain' &&
    ctx.object(ctx.source.ref)?.zone === 'chain', 'stale-reference', 'Hidden play costs require the Pending source identity');
  return buildHiddenCostPlan(ctx, { ...input, mode: 'play' });
}

/** CR 107.3.b.2 / 323.6.a: controller selects overflow; exits reveal to everyone. */
export function planFacedownCleanup(zone: FacedownZone, battlefield: ObjectSnapshot, options: {
  readonly registry?: ContinuousEffectRegistry;
  readonly discard?: readonly ObjectRef[];
  readonly chooser?: PlayerId;
} = {}) {
  fieldFor(zone, battlefield);
  const lost = zone.cards.filter(entry => entry.controller !== battlefield.controller);
  const remaining = zone.cards.filter(entry => entry.controller === battlefield.controller);
  const excess = Math.max(0, remaining.length - facedownCapacity(zone, battlefield, options.registry));
  const chosen = options.discard ?? [];
  check(chosen.length === excess && uniqueRefs(chosen) &&
    chosen.every(ref => remaining.some(entry => sameRef(entry.ref, ref))), 'invalid-state', 'Choose exactly the overflow cards for Trash');
  check(excess === 0 || options.chooser === battlefield.controller, 'invalid-state', 'Only the zone controller chooses overflow');
  const removed = [...lost, ...remaining.filter(entry => chosen.some(ref => sameRef(ref, entry.ref)))];
  return frozen({ zone: { battlefieldId: zone.battlefieldId,
    cards: structuredClone(remaining.filter(entry => !chosen.some(ref => sameRef(ref, entry.ref)))) },
  exits: removed.map(entry => ({ from: { ...entry.ref }, ref: nextRef(entry.ref), zone: 'trash' as const, owner: entry.owner,
    reveal: { ref: { ...entry.ref }, ...structuredClone(entry.front) } })) });
}

/** Adapter for the existing projector; front-side fields must never be serialized raw. */
export function facedownProjectionObjects(zone: FacedownZone, turn: number): readonly ProjectionObjectInput[] {
  ordinal(turn);
  return zone.cards.map(entry => ({ ...structuredClone(entry.front), ref: { ...entry.ref }, owner: entry.owner, controller: entry.controller,
    zone: 'facedown', location: { type: 'battlefield', id: zone.battlefieldId }, faceDown: true,
    hiddenOnTurn: entry.hiddenOnTurn, reaction: turn > entry.hiddenOnTurn }));
}

/** A zone-only view: noncontrollers see the count, without even opaque card refs. */
export function projectFacedownZone(zone: FacedownZone, viewer: ProjectionViewer, turn: number) {
  const objects = facedownProjectionObjects(zone, turn);
  const ids = [...new Set(zone.cards.flatMap(entry => [entry.owner, entry.controller]))];
  if (ids.length === 0) return { battlefieldId: zone.battlefieldId, count: 0, cards: [] };
  if (viewer !== null && viewer !== 'spectator' && viewer !== 'replay' && !ids.includes(viewer)) ids.push(viewer);
  const projection = projectFor({ players: ids.map(id => ({ id, facedown: objects.filter(object => object.controller === id) })), objects }, viewer);
  return { battlefieldId: zone.battlefieldId, count: zone.cards.length,
    cards: projection.objects.filter(object => object.visibility === 'identity') };
}

/** CR 422.4 also requires all remaining facedown cards to be revealed at game end. */
export function facedownReveals(zone: FacedownZone) {
  return zone.cards.map(entry => ({ ref: { ...entry.ref }, ...structuredClone(entry.front) }));
}
