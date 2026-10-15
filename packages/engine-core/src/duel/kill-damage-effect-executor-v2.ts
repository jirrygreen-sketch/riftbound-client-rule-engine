// INTERNAL V2 executor for the four source-bound Kill/Damage IR variants.
//
// This file is deliberately an adapter.  It does not interpret card text, invent
// Might/thresholds, or run Chain/Cost/Replacement rules.  Those decisions cross
// trusted service boundaries supplied by the effect scheduler.  The unit kernel
// owns snapshots, damage marks and board/trash/token transitions; Core owns the
// one outer stateVersion/eventSeq allocation.
import {
  assertAdmittedDuelMatchV2,
  inspectDuelNativeOriginV2,
  assertCurrentDuelPhysicalReferenceV2,
  commitDuelPlayingMutationV2,
  enumerateDuelObjectsV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import {
  commitApprovedDuelUnitKills,
  planDuelUnitKills,
  recordResolvedDuelDamage,
  type ApprovedDuelKillPlan,
  type DuelDamageMark,
  type DuelKillNotice,
  type DuelKillPlan,
  type DuelUnitLifecycleState,
} from './unit-lifecycle.js';
import type { DuelPhysicalZoneTransition } from './permanent-state.js';
import {
  queryDuelSourceProgramPhaseScope,
} from '@riftbound/card-dsl/duel';
import type {
  DuelOfficialProgram,
  DuelOfficialProgramReference,
  DuelOfficialProgramRegistry,
} from '@riftbound/card-dsl/duel';

export type DuelKillUnitEffectV2 =
  | { readonly kind: 'kill-unit'; readonly controller: 'any' | 'enemy'; readonly selection: 'target' }
  | { readonly kind: 'kill-units'; readonly controller: 'any'; readonly selection: 'all' }
  | { readonly kind: 'each-player-kills-unit'; readonly selection: 'each-player-choice' };
export interface DuelDealDamageEffectV2 {
  readonly kind: 'deal-damage'; readonly amount: 6; readonly distribution: 'each';
  readonly targets: { readonly kind: 'unit'; readonly controller: 'any';
    readonly minSelections: 0; readonly maxSelections: 2 };
}
export interface DuelPointDamageEffectV1 {
  readonly kind: 'point-damage';
  readonly amount: 2 | 3 | 6 | 8;
  readonly target: {
    readonly kind: 'unit';
    readonly controller: 'any';
    readonly location: 'battlefield' | 'any';
    readonly minSelections: 1;
    readonly maxSelections: 1;
  };
}
export type DuelKillDamageEffect = DuelKillUnitEffectV2 | DuelDealDamageEffectV2 | DuelPointDamageEffectV1;
export type DuelKillDamagePhaseV2 = 'spell-resolution' | 'trigger';

/** The source tuple is supplied by the trusted effect scheduler, never by a command client. */
export interface DuelKillDamageEffectSourceV2 {
  readonly sourceUID: string;
  readonly sourceZoneEpoch: number;
  readonly controllerPlayerId: string;
  readonly cardId: string;
  readonly programId: string;
  readonly dataVersion: string;
  readonly catalogDigest: string;
  readonly effectId: string;
  readonly phase: DuelKillDamagePhaseV2;
  /** Current phase containing the pending Chain item or trigger. */
  readonly window: string;
}

/** Cost and Chain are separate authorities.  The executor only consumes their proofs. */
export interface DuelKillDamageAuthorityProofV2 {
  readonly status: 'approved';
  readonly proofId: string;
  readonly selectionTiming?: 'finalization' | 'resolution';
}
export interface DuelKillDamageProofRequestV2 {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly source: DuelKillDamageEffectSourceV2;
  readonly targetUIDs: readonly string[];
  readonly amount: number;
}
export interface DuelKillProofRequestV2 {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly source: DuelKillDamageEffectSourceV2;
  readonly plan: DuelKillPlan;
  readonly responsiblePlayerIds: Readonly<Record<string, string>>;
}
export interface DuelLethalProofRequestV2 extends DuelKillProofRequestV2 {
  /** The admitted head before damage. This is never a provisional mark state. */
  readonly state: DuelCanonicalPlayingStateV2;
  /** A process-local, read-only description of the proposed damage result. */
  readonly proposedDamage: DuelDamageProposalV2;
}
/**
 * A point-damage proposal deliberately has no canonical-state field. The
 * executor creates it after the trusted damage resolver returns and binds it
 * to the current admitted head and the immutable mark/plan identities.
 */
export interface DuelDamageProposalV2 {
  readonly kind: 'duel-damage-proposal-v2';
  readonly baseStateVersion: number;
  readonly resultStateVersion: number;
  readonly marks: readonly DuelResolvedDamageMarkV2[];
  readonly plan: DuelKillPlan;
}
export interface DuelLethalCandidateProofV2 {
  readonly kind: 'duel-lethal-candidate-proof-v2';
  readonly proposal: DuelDamageProposalV2;
  readonly candidates: readonly {
    readonly unitUID: string;
    readonly currentMight: number;
    readonly lethalDamageThreshold: number;
    readonly totalDamage: number;
  }[];
  readonly evaluatorProofId: string;
}
export type DuelKillDamageCostVerifierV2 =
  (state: DuelCanonicalPlayingStateV2, source: DuelKillDamageEffectSourceV2) =>
    DuelKillDamageAuthorityProofV2 | null | undefined;
export type DuelKillDamageChainVerifierV2 =
  (state: DuelCanonicalPlayingStateV2, source: DuelKillDamageEffectSourceV2,
    targetUIDs: readonly string[]) =>
    DuelKillDamageAuthorityProofV2 | null | undefined;
export type DuelKillResolverV2 = (request: DuelKillProofRequestV2) =>
  | { readonly status: 'approved'; readonly approvedUnitUIDs: readonly string[]; readonly proofId: string;
      readonly targetLegality: 'approved'; readonly deathknell: 'resolved';
      readonly replacements: 'resolved' }
  | { readonly status: 'pending'; readonly reason?: string };
export type DuelLethalResolverV2 = (request: DuelLethalProofRequestV2) =>
  | { readonly status: 'approved'; readonly approvedUnitUIDs: readonly string[]; readonly proofId: string;
      readonly targetLegality: 'approved'; readonly deathknell: 'resolved';
      readonly replacements: 'resolved'; readonly proposal: DuelDamageProposalV2;
      readonly lethalProof: DuelLethalCandidateProofV2 }
  | { readonly status: 'pending'; readonly reason?: string };
export interface DuelResolvedDamageMarkV2 {
  readonly uid: string;
  readonly amount: number;
  readonly responsiblePlayerId: string;
  readonly sourceObjectIds: readonly string[];
}
export type DuelDamageResolverV2 = (request: DuelKillDamageProofRequestV2) =>
  | { readonly status: 'approved'; readonly resolvedMarks: readonly DuelResolvedDamageMarkV2[];
      readonly proofId: string;
      readonly targetLegality: 'approved'; readonly preventionReplacement: 'resolved';
      readonly attribution: 'approved'; readonly requiredCleanup: 'scheduled' }
  | { readonly status: 'pending'; readonly reason?: string };

export interface DuelKillDamageEffectAuthorityOptionsV2 {
  readonly state: DuelCanonicalPlayingStateV2;
  readonly source: DuelKillDamageEffectSourceV2;
  readonly registry: DuelOfficialProgramRegistry;
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  readonly verifyCost?: DuelKillDamageCostVerifierV2;
  readonly verifyChain?: DuelKillDamageChainVerifierV2;
  readonly resolveKill?: DuelKillResolverV2;
  /** Optional point-damage lethal/cleanup closure. Old Kill/Damage callers do not use it. */
  readonly resolveLethal?: DuelLethalResolverV2;
  readonly resolveDamage?: DuelDamageResolverV2;
}

export interface DuelKillDamageEffectAuthorityV2 { readonly kind: 'duel-kill-damage-effect-authority-v2' }
export interface DuelKillDamageEffectCursorV2 {
  readonly kind: 'duel-kill-damage-effect-cursor-v2';
  readonly matchId: string;
  readonly effectId: string;
  readonly expectedStateVersion: number;
  readonly requiredChoice: 'none' | 'target' | 'each-player' | 'damage-targets';
}
export interface DuelKillDamageChoiceV2 {
  readonly expectedStateVersion: number;
  readonly actorPlayerId: string;
  readonly targetUID?: string;
  readonly targetUIDs?: readonly string[];
}
export interface DuelKillDamagePendingV2 {
  readonly status: 'pending';
  readonly state: DuelCanonicalPlayingStateV2;
  readonly cursor: DuelKillDamageEffectCursorV2;
  readonly reason: string;
}
export interface DuelKillDamageNoChangeV2 {
  readonly status: 'no-change';
  readonly state: DuelCanonicalPlayingStateV2;
  readonly effectId: string;
  readonly plan: readonly string[];
}
export interface DuelKillDamageCompleteV2 {
  readonly status: 'complete';
  readonly state: DuelCanonicalPlayingStateV2;
  readonly effectId: string;
  readonly changed: boolean;
  readonly targetUIDs: readonly string[];
  readonly notices: readonly DuelKillNotice[];
  readonly attribution: readonly { readonly targetUID: string; readonly responsiblePlayerId: string;
    readonly sourceObjectIds: readonly string[] }[];
}
export type DuelKillDamageEffectResultV2 =
  | DuelKillDamagePendingV2 | DuelKillDamageNoChangeV2 | DuelKillDamageCompleteV2;

export type DuelKillDamageBlockCodeV2 =
  | 'invalid-authority' | 'invalid-source' | 'source-program-mismatch' | 'source-not-live'
  | 'stale-head' | 'stale-version' | 'duplicate-effect-id' | 'in-use' | 'invalid-choice'
  | 'illegal-target' | 'unknown-effect' | 'internal-error';
export class DuelKillDamageEffectBlockedErrorV2 extends TypeError {
  constructor(readonly code: DuelKillDamageBlockCodeV2) {
    super(`Duel Kill/Damage effect blocked [${code}]`);
    this.name = 'DuelKillDamageEffectBlockedErrorV2';
  }
}

interface Bond {
  readonly authority: DuelKillDamageEffectAuthorityV2;
  readonly inputState: DuelCanonicalPlayingStateV2;
  readonly source: DuelKillDamageEffectSourceV2;
  readonly effect: DuelKillDamageEffect;
  readonly readHead: () => DuelCanonicalPlayingStateV2;
  readonly verifyCost?: DuelKillDamageCostVerifierV2;
  readonly verifyChain?: DuelKillDamageChainVerifierV2;
  readonly resolveKill?: DuelKillResolverV2;
  readonly resolveLethal?: DuelLethalResolverV2;
  readonly resolveDamage?: DuelDamageResolverV2;
  busy: boolean;
  consumed: boolean;
  cursor?: DuelKillDamageEffectCursorV2;
  readonly eachPlayerChoices: Map<string, string>;
  readonly reservation: { busy: boolean; consumed: boolean };
}
const bonds = new WeakMap<object, Bond>();
const cursors = new WeakMap<object, Bond>();
const reservations = new WeakMap<object, Map<string, { busy: boolean; consumed: boolean }>>();
const creationBusy = new WeakSet<object>();
const damageProposals = new WeakSet<object>();

function block(code: DuelKillDamageBlockCodeV2): never { throw new DuelKillDamageEffectBlockedErrorV2(code); }
function check(value: unknown, code: DuelKillDamageBlockCodeV2): asserts value {
  if (!value) block(code);
}
function id(value: unknown): string {
  check(typeof value === 'string' && value.trim().length > 0, 'invalid-source');
  return value;
}
function epoch(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'invalid-source');
  return value;
}
function immutableSource(raw: DuelKillDamageEffectSourceV2): DuelKillDamageEffectSourceV2 {
  try {
    const source = {
      sourceUID: id(raw?.sourceUID), sourceZoneEpoch: epoch(raw?.sourceZoneEpoch),
      controllerPlayerId: id(raw?.controllerPlayerId), cardId: id(raw?.cardId),
      programId: id(raw?.programId), dataVersion: id(raw?.dataVersion),
      catalogDigest: id(raw?.catalogDigest), effectId: id(raw?.effectId),
      phase: raw?.phase, window: id(raw?.window),
    } as DuelKillDamageEffectSourceV2;
    check(source.phase === 'spell-resolution' || source.phase === 'trigger', 'invalid-source');
    return Object.freeze(source);
  } catch (error) {
    if (error instanceof DuelKillDamageEffectBlockedErrorV2) throw error;
    block('invalid-source');
  }
}
function sameReference(ref: DuelOfficialProgramReference, source: DuelKillDamageEffectSourceV2): boolean {
  return ref.cardId === source.cardId && ref.programId === source.programId &&
    ref.dataVersion === source.dataVersion && ref.sourceCatalogDigest === source.catalogDigest;
}
function resolveEffect(registry: DuelOfficialProgramRegistry,
  source: DuelKillDamageEffectSourceV2): DuelKillDamageEffect {
  try {
    check(registry !== null && typeof registry === 'object' &&
      typeof registry.reference === 'function' && typeof registry.resolve === 'function' &&
      typeof registry.sourceProgramPhaseScope === 'function', 'source-program-mismatch');
    const reference = registry.reference(source.cardId);
    check(reference !== undefined && sameReference(reference, source), 'source-program-mismatch');
    const scope = queryDuelSourceProgramPhaseScope(registry, source.cardId,
      { phase: source.window as never, mode: 'runtime-subevents' }, reference);
    check(scope.sourceProgramComplete === true && scope.reference !== null &&
      sameReference(scope.reference, source), 'source-program-mismatch');
    const resolved = registry.resolve(reference);
    check(resolved.status === 'resolved' && resolved.program !== null,
      'unknown-effect');
    const program = resolved.program as DuelOfficialProgram;
    check(program.programId === source.programId && program.cardId === source.cardId &&
      program.source.dataVersion === source.dataVersion &&
      program.source.sourceCatalogDigest === source.catalogDigest, 'source-program-mismatch');
    const semantics = program.semantics;
    if (source.phase === 'spell-resolution') {
      check((semantics.kind === 'spell-resolution' || semantics.kind === 'point-damage-spell-resolution') &&
        semantics.effects.length === 1, 'unknown-effect');
    } else {
      check(semantics.kind === 'trigger' && semantics.effects.length === 1, 'unknown-effect');
    }
    const effect = semantics.effects[0] as unknown as { readonly kind: string };
    check(effect.kind === 'kill-unit' || effect.kind === 'kill-units' ||
      effect.kind === 'each-player-kills-unit' || effect.kind === 'deal-damage' ||
      effect.kind === 'point-damage', 'unknown-effect');
    const expectedEvent = source.phase === 'trigger' ?
      (semantics.kind === 'trigger' ? semantics.event : '') : 'spell-resolution';
    const expectedHandler = source.phase === 'trigger' ?
      `trigger.${expectedEvent}` : `spell-resolution.${effect.kind}`;
    check(scope.runtimeSubevents.some(entry => entry.event === expectedEvent &&
      entry.handlers.includes(expectedHandler)) ||
      scope.handlers.includes(expectedHandler), 'source-program-mismatch');
    return effect as DuelKillDamageEffect;
  } catch (error) {
    if (error instanceof DuelKillDamageEffectBlockedErrorV2) throw error;
    block('source-program-mismatch');
  }
}
function sourceCard(state: DuelCanonicalPlayingStateV2, source: DuelKillDamageEffectSourceV2): void {
  check(state.dataVersion === source.dataVersion && state.catalogDigest === source.catalogDigest,
    'source-program-mismatch');
  check(state.roster.some(seat => seat.playerId === source.controllerPlayerId), 'source-not-live');
  const original = state.physicalCardsByUID[source.sourceUID];
  check(original !== undefined && original.cardId === source.cardId, 'source-not-live');
  const live = enumerateDuelObjectsV2(state).find(item => item.uid === source.sourceUID);
  check(live !== undefined, 'source-not-live');
  if (live.controllerPlayerId !== null) check(live.controllerPlayerId === source.controllerPlayerId, 'source-not-live');
  else check(original.ownerPlayerId === source.controllerPlayerId, 'source-not-live');
  try {
    assertCurrentDuelPhysicalReferenceV2(state, { uid: source.sourceUID, zoneEpoch: source.sourceZoneEpoch });
  } catch { block('source-not-live'); }
}
function current(bond: Bond, expectedStateVersion: number): DuelCanonicalPlayingStateV2 {
  check(!bond.consumed, 'in-use');
  check(Number.isSafeInteger(expectedStateVersion) && expectedStateVersion === bond.inputState.stateVersion,
    'stale-version');
  let head: DuelCanonicalPlayingStateV2;
  try { head = bond.readHead(); } catch { block('stale-head'); }
  check(head === bond.inputState, 'stale-head');
  sourceCard(head, bond.source);
  return head;
}
function isCurrentHead(bond: Bond, state: DuelCanonicalPlayingStateV2): boolean {
  try { return bond.readHead() === state; } catch { return false; }
}
function freezeKillPlan(plan: DuelKillPlan): DuelKillPlan {
  for (const snapshot of plan.snapshots) {
    for (const mark of snapshot.damageMarks) {
      Object.freeze(mark.sourceObjectIds);
      Object.freeze(mark);
    }
    Object.freeze(snapshot.damageMarks);
    if (snapshot.trait.kind === 'token') Object.freeze(snapshot.trait.tags);
    Object.freeze(snapshot.trait);
    Object.freeze(snapshot);
  }
  Object.freeze(plan.snapshots);
  return Object.freeze(plan);
}
function makeDamageProposal(state: DuelCanonicalPlayingStateV2,
  marks: readonly { readonly uid: string; readonly mark: DuelDamageMark }[],
  plan: DuelKillPlan): DuelDamageProposalV2 {
  const proposedMarks = Object.freeze(marks.map(({ uid, mark }) => Object.freeze({
    uid, amount: mark.amount, responsiblePlayerId: mark.responsiblePlayerId,
    sourceObjectIds: Object.freeze([...mark.sourceObjectIds]),
  })));
  const proposal = Object.freeze({ kind: 'duel-damage-proposal-v2' as const,
    baseStateVersion: state.stateVersion, resultStateVersion: state.stateVersion + 1,
    marks: proposedMarks, plan });
  damageProposals.add(proposal);
  return proposal;
}
function arrayOfIds(raw: unknown): readonly string[] {
  try {
    check(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype, 'invalid-choice');
    const keys = Reflect.ownKeys(raw);
    check(keys.length === raw.length + 1 && keys.includes('length'), 'invalid-choice');
    const ids: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const d = Object.getOwnPropertyDescriptor(raw, String(i));
      check(d !== undefined && 'value' in d, 'invalid-choice');
      ids.push(id(d.value));
    }
    return Object.freeze(ids);
  } catch (error) {
    if (error instanceof DuelKillDamageEffectBlockedErrorV2) throw error;
    block('invalid-choice');
  }
}
function oneId(raw: unknown): string {
  check(typeof raw === 'string' && raw.trim().length > 0, 'invalid-choice');
  return raw;
}
function requiredChoice(effect: DuelKillDamageEffect): DuelKillDamageEffectCursorV2['requiredChoice'] {
  return effect.kind === 'kill-unit' ? 'target' :
    effect.kind === 'each-player-kills-unit' ? 'each-player' :
      effect.kind === 'kill-units' ? 'none' : 'damage-targets';
}
function pending(bond: Bond, reason: string): DuelKillDamagePendingV2 {
  const cursor = Object.freeze({ kind: 'duel-kill-damage-effect-cursor-v2' as const,
    matchId: bond.inputState.matchId, effectId: bond.source.effectId,
    expectedStateVersion: bond.inputState.stateVersion, requiredChoice: requiredChoice(bond.effect) });
  bond.cursor = cursor;
  cursors.set(cursor, bond);
  return Object.freeze({ status: 'pending' as const, state: bond.inputState, cursor, reason });
}
function proofOk(proof: DuelKillDamageAuthorityProofV2 | null | undefined): boolean {
  return proof?.status === 'approved' && typeof proof.proofId === 'string' && proof.proofId.length > 0;
}
function verifyOuterAuthorities(bond: Bond, state: DuelCanonicalPlayingStateV2,
  ids: readonly string[]): string | null {
  if (!bond.verifyCost) return 'cost-proof-required';
  let cost: DuelKillDamageAuthorityProofV2 | null | undefined;
  try { cost = bond.verifyCost(state, bond.source); } catch { return 'cost-proof-required'; }
  if (!proofOk(cost)) return 'cost-proof-required';
  let chain: DuelKillDamageAuthorityProofV2 | null | undefined;
  try { chain = bond.verifyChain?.(state, bond.source, ids); } catch { return 'chain-proof-required'; }
  if (!proofOk(chain)) return 'chain-proof-required';
  if (bond.effect.kind === 'each-player-kills-unit' && chain?.selectionTiming !== 'resolution') {
    return 'resolution-choice-proof-required';
  }
  if ((bond.effect.kind === 'kill-unit' || bond.effect.kind === 'deal-damage' || bond.effect.kind === 'point-damage') &&
      chain?.selectionTiming !== 'finalization') return 'finalization-target-proof-required';
  return null;
}
function allBoardUnitIds(state: DuelCanonicalPlayingStateV2): readonly string[] {
  return Object.freeze(state.board.units.map(unit => unit.objectId));
}
function ownersFor(state: DuelCanonicalPlayingStateV2, ids: readonly string[]): Readonly<Record<string, string>> {
  const out: Record<string, string> = Object.create(null);
  for (const uid of ids) out[uid] = state.board.units.find(unit => unit.objectId === uid)!.controllerPlayerId;
  return Object.freeze(out);
}
function responsibleFor(state: DuelCanonicalPlayingStateV2, ids: readonly string[],
  bond: Bond): Readonly<Record<string, string>> {
  if (bond.effect.kind === 'each-player-kills-unit') return ownersFor(state, ids);
  return Object.freeze(Object.fromEntries(ids.map(uid => [uid, bond.source.controllerPlayerId])));
}
function targetIds(bond: Bond, state: DuelCanonicalPlayingStateV2,
  choice: DuelKillDamageChoiceV2 | null): readonly string[] {
  const effect = bond.effect;
  if (effect.kind === 'kill-units') return allBoardUnitIds(state);
  if (effect.kind === 'kill-unit') {
    check(choice !== null, 'invalid-choice');
    const target = oneId(choice.targetUID);
    const unit = state.board.units.find(item => item.objectId === target);
    check(unit !== undefined && (effect.controller === 'any' || unit.controllerPlayerId !== bond.source.controllerPlayerId),
      'illegal-target');
    return Object.freeze([target]);
  }
  if (effect.kind === 'each-player-kills-unit') {
    const ids: string[] = [];
    for (const seat of state.roster) {
      const target = bond.eachPlayerChoices.get(seat.playerId);
      check(target !== undefined, 'invalid-choice');
      const unit = state.board.units.find(item => item.objectId === target);
      check(unit !== undefined && unit.controllerPlayerId === seat.playerId, 'illegal-target');
      ids.push(target);
    }
    check(new Set(ids).size === ids.length, 'illegal-target');
    return Object.freeze(ids);
  }
  check(choice !== null, 'invalid-choice');
  if (effect.kind === 'point-damage') {
    const ids = choice.targetUID === undefined
      ? arrayOfIds(choice.targetUIDs)
      : Object.freeze([oneId(choice.targetUID)]);
    check(ids.length === 1 && new Set(ids).size === 1, 'illegal-target');
    const unit = state.board.units.find(item => item.objectId === ids[0]);
    check(unit !== undefined, 'illegal-target');
    if (effect.target.location === 'battlefield') {
      check(state.board.battlefields.some(field => field.locationId === unit.locationId), 'illegal-target');
    } else {
      check(state.board.bases.some(base => base.locationId === unit.locationId) ||
        state.board.battlefields.some(field => field.locationId === unit.locationId), 'illegal-target');
    }
    return ids;
  }
  const ids = arrayOfIds(choice.targetUIDs);
  check(ids.length <= 2 && new Set(ids).size === ids.length, 'illegal-target');
  for (const uid of ids) check(state.board.units.some(unit => unit.objectId === uid), 'illegal-target');
  return ids;
}
function markTargets(state: DuelCanonicalPlayingStateV2,
  marks: readonly { readonly uid: string; readonly mark: DuelDamageMark }[]):
  DuelCanonicalPlayingStateV2 {
  let next = state as unknown as DuelUnitLifecycleState;
  for (const entry of marks) next = recordResolvedDuelDamage(next, entry.uid, entry.mark);
  // The lifecycle kernel validates and performs each mark.  Damage to a group is
  // nevertheless one game action, so normalize its helper clock before Core allocates.
  return { ...next, stateVersion: state.stateVersion + 1 } as unknown as DuelCanonicalPlayingStateV2;
}
function resolvedMarks(state: DuelCanonicalPlayingStateV2, ids: readonly string[],
  source: DuelKillDamageEffectSourceV2, raw: readonly DuelResolvedDamageMarkV2[],
  exactSourceIds = false):
  readonly { readonly uid: string; readonly mark: DuelDamageMark }[] {
  check(Array.isArray(raw), 'internal-error');
  const marks = raw.map(entry => {
    check(entry !== null && typeof entry === 'object' && ids.includes(entry.uid), 'illegal-target');
    check(Number.isSafeInteger(entry.amount) && entry.amount > 0, 'internal-error');
    check(state.roster.some(seat => seat.playerId === entry.responsiblePlayerId), 'internal-error');
    const sources = arrayOfIds(entry.sourceObjectIds);
    check(sources.includes(source.sourceUID), 'internal-error');
    if (exactSourceIds) {
      check(entry.responsiblePlayerId === source.controllerPlayerId, 'internal-error');
      check(sources.every(sourceId => sourceId === source.sourceUID || sourceId === source.effectId),
        'internal-error');
    }
    return Object.freeze({ uid: entry.uid, mark: Object.freeze({ amount: entry.amount,
      responsiblePlayerId: entry.responsiblePlayerId, sourceObjectIds: sources }) });
  });
  check(new Set(marks.map(entry => entry.uid)).size === marks.length, 'illegal-target');
  return Object.freeze(marks);
}
function killTargets(state: DuelCanonicalPlayingStateV2, ids: readonly string[], bond: Bond):
  { readonly state: DuelCanonicalPlayingStateV2; readonly notices: readonly DuelKillNotice[];
    readonly approvedUIDs: readonly string[]; readonly transitions: readonly DuelPhysicalZoneTransition[] } {
  const plan = planDuelUnitKills(state as unknown as DuelUnitLifecycleState, ids, 'active');
  const responsible = responsibleFor(state, ids, bond);
  if (!bond.resolveKill) throw new PendingResolution('kill-proof-required');
  let approval: ReturnType<NonNullable<Bond['resolveKill']>>;
  try {
    approval = bond.resolveKill({ state, source: bond.source, plan, responsiblePlayerIds: responsible });
  } catch {
    throw new PendingResolution('kill-proof-pending');
  }
  if (approval === null || typeof approval !== 'object') throw new PendingResolution('kill-proof-required');
  if (approval.status !== 'approved') throw new PendingResolution(approval.reason ?? 'kill-proof-pending');
  if (approval.targetLegality !== 'approved' || approval.deathknell !== 'resolved' ||
      approval.replacements !== 'resolved') throw new PendingResolution('kill-closure-proof-required');
  check(typeof approval.proofId === 'string' && approval.proofId.length > 0, 'internal-error');
  const selected = arrayOfIds(approval.approvedUnitUIDs);
  check(selected.every(uid => ids.includes(uid)), 'illegal-target');
  const approved: ApprovedDuelKillPlan = { plan, approvedUnitUIDs: selected };
  const result = commitApprovedDuelUnitKills(state as unknown as DuelUnitLifecycleState, approved);
  const transitions: DuelPhysicalZoneTransition[] = [];
  for (const uid of selected) {
    const snapshot = plan.snapshots.find(item => item.objectId === uid)!;
    if (snapshot.trait.kind === 'card') transitions.push({ uid,
      from: { kind: state.board.bases.some(base => base.locationId === snapshot.locationId)
        ? 'board-base' : 'board-battlefield', locationId: snapshot.locationId },
      to: { kind: 'trash', zonePlayerId: snapshot.ownerPlayerId } });
  }
  return { state: { ...result.state, stateVersion: state.stateVersion + (selected.length ? 1 : 0) } as unknown as DuelCanonicalPlayingStateV2,
    notices: result.notices, approvedUIDs: selected, transitions };
}
class PendingResolution extends Error { constructor(readonly reason: string) { super(reason); } }

/** A resolved empty effect is terminal too. Bind it to the still-current head before
 * consuming its reservation, so a stale callback cannot publish a successful no-op. */
function noChange(bond: Bond, state: DuelCanonicalPlayingStateV2,
  ids: readonly string[]): DuelKillDamageNoChangeV2 {
  check(isCurrentHead(bond, state), 'stale-head');
  bond.consumed = true;
  bond.reservation.consumed = true;
  if (bond.cursor) cursors.delete(bond.cursor);
  return Object.freeze({ status: 'no-change', state, effectId: bond.source.effectId, plan: ids });
}

function execute(bond: Bond, state: DuelCanonicalPlayingStateV2,
  choice: DuelKillDamageChoiceV2 | null): DuelKillDamageEffectResultV2 {
  const ids = targetIds(bond, state, choice);
  const outerReason = verifyOuterAuthorities(bond, state, ids);
  if (outerReason) return pending(bond, outerReason);
  check(bond.readHead() === state, 'stale-head');
  if (bond.effect.kind === 'deal-damage' || bond.effect.kind === 'point-damage') {
    if (!bond.resolveDamage) return pending(bond, 'damage-proof-required');
    const amount = bond.effect.kind === 'deal-damage' ? 6 : bond.effect.amount;
    let proof: ReturnType<NonNullable<Bond['resolveDamage']>>;
    try {
      proof = bond.resolveDamage({ state, source: bond.source, targetUIDs: ids, amount });
    } catch {
      return pending(bond, 'damage-proof-pending');
    }
    if (proof === null || typeof proof !== 'object') return pending(bond, 'damage-proof-required');
    if (proof.status !== 'approved') return pending(bond, proof.reason ?? 'damage-proof-pending');
    if (proof.targetLegality !== 'approved' || proof.preventionReplacement !== 'resolved' ||
        proof.attribution !== 'approved' || proof.requiredCleanup !== 'scheduled') {
      return pending(bond, 'damage-closure-proof-required');
    }
    check(typeof proof.proofId === 'string' && proof.proofId.length > 0, 'internal-error');
    const marks = resolvedMarks(state, ids, bond.source, proof.resolvedMarks,
      bond.effect.kind === 'point-damage');
    if (marks.length === 0) return noChange(bond, state, ids);
    check(isCurrentHead(bond, state), 'stale-head');
    let next = markTargets(state, marks);
    let lethalNotices: readonly DuelKillNotice[] = [];
    let lethalTransitions: readonly DuelPhysicalZoneTransition[] = [];
    if (bond.effect.kind === 'point-damage' && !bond.resolveLethal) {
      return pending(bond, 'lethal-cleanup-proof-required');
    }
    if (bond.effect.kind === 'point-damage' && bond.resolveLethal) {
      const plan = freezeKillPlan(planDuelUnitKills(next as unknown as DuelUnitLifecycleState, ids, 'passive'));
      const proposedDamage = makeDamageProposal(state, marks, plan);
      let approval: ReturnType<NonNullable<Bond['resolveLethal']>>;
      try {
        approval = bond.resolveLethal({ state, source: bond.source, plan, proposedDamage,
          responsiblePlayerIds: responsibleFor(state, ids, bond) });
      } catch {
        return pending(bond, 'lethal-cleanup-pending');
      }
      if (approval === null || typeof approval !== 'object') {
        return pending(bond, 'lethal-cleanup-proof-required');
      }
      if (approval.status !== 'approved') return pending(bond, approval.reason ?? 'lethal-cleanup-pending');
      if (approval.targetLegality !== 'approved' || approval.deathknell !== 'resolved' ||
          approval.replacements !== 'resolved') return pending(bond, 'lethal-cleanup-closure-required');
      const selected = arrayOfIds(approval.approvedUnitUIDs);
      check(selected.every(uid => ids.includes(uid)), 'illegal-target');
      check(approval.proposal === proposedDamage && damageProposals.has(approval.proposal), 'internal-error');
      const candidateProof = approval.lethalProof;
      check(candidateProof !== null && typeof candidateProof === 'object' &&
        candidateProof.kind === 'duel-lethal-candidate-proof-v2' &&
        candidateProof.proposal === proposedDamage &&
        typeof candidateProof.evaluatorProofId === 'string' && candidateProof.evaluatorProofId.length > 0,
      'internal-error');
      check(Array.isArray(candidateProof.candidates) &&
        Object.getPrototypeOf(candidateProof.candidates) === Array.prototype &&
        Reflect.ownKeys(candidateProof.candidates).length === candidateProof.candidates.length + 1,
      'internal-error');
      for (let index = 0; index < candidateProof.candidates.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(candidateProof.candidates, String(index));
        check(descriptor !== undefined && 'value' in descriptor, 'internal-error');
      }
      const candidates = candidateProof.candidates.map(candidate => {
        check(candidate !== null && typeof candidate === 'object', 'internal-error');
        check(typeof candidate.unitUID === 'string' && candidate.unitUID.length > 0 &&
          ids.includes(candidate.unitUID), 'illegal-target');
        check(Number.isSafeInteger(candidate.currentMight), 'internal-error');
        check(Number.isSafeInteger(candidate.lethalDamageThreshold) && candidate.lethalDamageThreshold >= 0,
          'internal-error');
        check(Number.isSafeInteger(candidate.totalDamage) && candidate.totalDamage > 0 &&
          candidate.totalDamage >= candidate.lethalDamageThreshold, 'internal-error');
        const snapshot = plan.snapshots.find(item => item.objectId === candidate.unitUID);
        check(snapshot !== undefined && snapshot.totalDamage === candidate.totalDamage, 'internal-error');
        return candidate.unitUID;
      });
      check(new Set(candidates).size === candidates.length, 'illegal-target');
      check(new Set(selected).size === selected.length, 'illegal-target');
      check(selected.every(uid => candidates.includes(uid)), 'illegal-target');
      if (selected.some(uid => next.unitMeta[uid]?.trait.kind === 'token')) {
        return pending(bond, 'token-lethal-core-api-required');
      }
      if (selected.length > 0) {
        const killed = commitApprovedDuelUnitKills(next as unknown as DuelUnitLifecycleState,
          { plan, approvedUnitUIDs: selected });
        next = { ...killed.state, stateVersion: state.stateVersion + 1 } as unknown as DuelCanonicalPlayingStateV2;
        lethalNotices = killed.notices;
        lethalTransitions = selected.flatMap(uid => {
          const snapshot = plan.snapshots.find(item => item.objectId === uid)!;
          return snapshot.trait.kind === 'card' ? [{ uid,
            from: { kind: state.board.bases.some(base => base.locationId === snapshot.locationId)
              ? 'board-base' as const : 'board-battlefield' as const, locationId: snapshot.locationId },
            to: { kind: 'trash' as const, zonePlayerId: snapshot.ownerPlayerId },
          }] : [];
        });
      }
    }
    const attribution = marks.map(entry => ({ targetUID: entry.uid,
      responsiblePlayerId: entry.mark.responsiblePlayerId,
      sourceObjectIds: entry.mark.sourceObjectIds }));
    check(isCurrentHead(bond, state), 'stale-head');
    const committed = commitDuelPlayingMutationV2(state, draft => ({
      match: { ...draft, board: next.board, players: next.players, unitMeta: next.unitMeta,
        retiredUnitTokenUIDs: next.retiredUnitTokenUIDs }, transitions: lethalTransitions,
    }));
    bond.consumed = true;
    bond.reservation.consumed = true;
    return Object.freeze({ status: 'complete', state: committed, effectId: bond.source.effectId, changed: true,
      targetUIDs: marks.map(entry => entry.uid),
      notices: lethalNotices, attribution });
  }
  if (ids.length === 0) return noChange(bond, state, ids);
  if (ids.some(uid => state.unitMeta[uid]?.trait.kind === 'token')) {
    return pending(bond, 'multi-token-kill-core-api-required');
  }
  try {
    const killed = killTargets(state, ids, bond);
    if (killed.approvedUIDs.length === 0) return noChange(bond, state, ids);
    check(isCurrentHead(bond, state), 'stale-head');
    const next = commitDuelPlayingMutationV2(state, draft => ({
      match: { ...draft, board: killed.state.board, players: killed.state.players,
        unitMeta: killed.state.unitMeta, retiredUnitTokenUIDs: killed.state.retiredUnitTokenUIDs },
      transitions: killed.transitions,
    }));
    bond.consumed = true;
    bond.reservation.consumed = true;
    const responsible = responsibleFor(state, ids, bond);
    const attribution = killed.approvedUIDs.map(uid => ({ targetUID: uid,
      responsiblePlayerId: responsible[uid]!,
      sourceObjectIds: [bond.source.sourceUID, bond.source.effectId] }));
    return Object.freeze({ status: 'complete', state: next, effectId: bond.source.effectId,
      changed: killed.notices.length > 0, targetUIDs: ids, notices: killed.notices, attribution });
  } catch (error) {
    if (error instanceof PendingResolution) return pending(bond, error.reason);
    throw error;
  }
}

/** Issue an authority only for a genuine registry program and the current admitted head. */
export function createDuelKillDamageEffectAuthorityV2(
  options: DuelKillDamageEffectAuthorityOptionsV2,
): DuelKillDamageEffectAuthorityV2 {
  const state = options?.state;
  assertAdmittedDuelMatchV2(state);
  check(state.stage === 'playing' && typeof options.readHead === 'function', 'invalid-authority');
  check(!creationBusy.has(state), 'in-use');
  creationBusy.add(state);
  try {
  const source = immutableSource(options.source);
  let head: DuelCanonicalPlayingStateV2;
  try { head = options.readHead(); } catch { block('stale-head'); }
  check(head === state, 'stale-head');
  sourceCard(state, source);
  const effect = resolveEffect(options.registry, source);
  const origin = inspectDuelNativeOriginV2(state);
  let registry = reservations.get(origin);
  if (!registry) { registry = new Map(); reservations.set(origin, registry); }
  const key = source.effectId;
  const prior = registry.get(key);
  check(!prior, 'duplicate-effect-id');
  const reservation = { busy: true, consumed: false };
  registry.set(key, reservation);
  try {
    const authority = Object.freeze({ kind: 'duel-kill-damage-effect-authority-v2' as const });
    const bond: Bond = { authority, inputState: state, source, effect, readHead: options.readHead,
      verifyCost: options.verifyCost, verifyChain: options.verifyChain, resolveKill: options.resolveKill,
      resolveLethal: options.resolveLethal, resolveDamage: options.resolveDamage, busy: false, consumed: false,
      eachPlayerChoices: new Map(), reservation };
    bonds.set(authority, bond);
    reservation.busy = false;
    return authority;
  } catch (error) {
    registry.delete(key);
    throw error;
  }
  } finally { creationBusy.delete(state); }
}

/** Begin an effect.  Targeted variants return a cursor; all/no-target variants resolve immediately. */
export function beginDuelKillDamageEffectV2(
  authority: DuelKillDamageEffectAuthorityV2,
): DuelKillDamageEffectResultV2 {
  const bond = authority && typeof authority === 'object' ? bonds.get(authority) : undefined;
  check(bond !== undefined, 'invalid-authority');
  check(!bond.busy, 'in-use');
  bond.busy = true;
  try {
    const state = current(bond, bond.inputState.stateVersion);
    if (bond.effect.kind !== 'kill-units') return pending(bond, 'choice-required');
    return execute(bond, state, null);
  } finally { bond.busy = false; }
}

/** Submit a real player choice through the original opaque cursor/authority. */
export function submitDuelKillDamageEffectChoiceV2(
  authority: DuelKillDamageEffectAuthorityV2,
  choice: DuelKillDamageChoiceV2,
): DuelKillDamageEffectResultV2 {
  const bond = authority && typeof authority === 'object' ? bonds.get(authority) : undefined;
  check(bond !== undefined, 'invalid-authority');
  check(!bond.busy, 'in-use');
  bond.busy = true;
  try {
    check(choice !== null && typeof choice === 'object', 'invalid-choice');
    const expected = choice.expectedStateVersion;
    const state = current(bond, expected);
    if (bond.effect.kind === 'each-player-kills-unit') {
      const actor = oneId(choice.actorPlayerId);
      check(state.roster.some(seat => seat.playerId === actor) &&
        !bond.eachPlayerChoices.has(actor), 'invalid-choice');
      const target = oneId(choice.targetUID);
      check(state.board.units.some(unit => unit.objectId === target &&
        unit.controllerPlayerId === actor), 'illegal-target');
      check(bond.readHead() === state, 'stale-head');
      bond.eachPlayerChoices.set(actor, target);
      if (bond.eachPlayerChoices.size < state.roster.length) return pending(bond, 'other-player-choice-required');
    } else {
      check(choice.actorPlayerId === bond.source.controllerPlayerId, 'invalid-choice');
    }
    return execute(bond, state, choice);
  } finally { bond.busy = false; }
}

/** Resume through a process-local cursor.  A detached/serialized cursor has no authority. */
export function resumeDuelKillDamageEffectV2(
  cursor: DuelKillDamageEffectCursorV2,
  choice: DuelKillDamageChoiceV2,
  state: DuelCanonicalPlayingStateV2,
): DuelKillDamageEffectResultV2 {
  const bond = cursor && typeof cursor === 'object' ? cursors.get(cursor) : undefined;
  check(bond !== undefined && bond.cursor === cursor, 'invalid-authority');
  check(state === bond.inputState, 'stale-head');
  return submitDuelKillDamageEffectChoiceV2(bond.authority, choice);
}

export const resolveDuelKillDamageEffectV2 = submitDuelKillDamageEffectChoiceV2;
