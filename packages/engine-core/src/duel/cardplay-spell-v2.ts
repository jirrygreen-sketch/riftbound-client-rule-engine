// INTERNAL Duel V2 Spell CardPlay capability.
//
// This module is deliberately an action coordinator, not a second game state or
// command ledger.  The caller supplies the admitted canonical session, the
// source/cost providers and the parent command/receipt service.  Every effect
// is executed by the existing Core-bound executor and is attached back to the
// same native command-session lineage before the physical Spell is trashed.
import { queryDuelSourceProgramPhaseScope, type DuelOfficialProgramRegistry } from '@riftbound/card-dsl/duel';
import {
  advanceDuelCommandSessionNativeV2,
  applyDuelResourceCommandV2,
  commitDuelCommandFrameV2,
  commitDuelCommandMutationV2,
  inspectDuelNativeCommandSessionPathV2,
  issueDuelRequiredCostTaskV2,
  prepareDuelRequiredCostPaymentV2,
  type DuelCommandEnvelopeV2,
  type DuelCommandSessionV2,
  type DuelCommandOutcomeV2,
  type DuelRequiredCostAuthorityV2,
  type DuelRequiredCostTaskV2,
  type DuelSourceAttestationRequestV2,
  type DuelSourceAttestorV2,
} from './canonical-session-v2.js';
import {
  assertCurrentDuelPhysicalReferenceV2,
  moveDuelChainCardToOwnerTrashV2,
  moveDuelPhysicalCardToChainV2,
  referenceDuelPhysicalCardV2,
  inspectDuelNativeTokenHistoryV2,
  type DuelCanonicalPlayingStateV2,
} from './core-v2.js';
import {
  resolveDuelTotalCostV2,
  type DuelCostResolverAuthorityV2,
  type DuelResolvedCostV2,
} from './cost-resolver-v2.js';
import type { DuelPaymentPlan, DuelRuneCost } from './resources.js';
import {
  appendDuelChainItemV2,
  commitDuelChainResolutionV2,
  createDuelChainScopedExecutorV2,
  createDuelChainResolutionAuthorityV2,
  createDuelChainV2,
  finalizeDuelChainItemV2,
  inspectDuelChainPrivateStateV2,
  passDuelChainPriorityV2,
  queryDuelChainCommittedProofV2,
  requestDuelChainResolutionV2,
  type DuelChainCommittedReceiptV2,
  type DuelChainCommittedProofV2,
  type DuelChainExecutorV2,
  type DuelChainResolutionAuthorityV2,
  type DuelChainResolutionTicketV2,
  type DuelChainV2,
} from './chain-v2.js';
import {
  beginDuelDrawEffectV2,
  createDuelDrawEffectAuthorityV2,
  resumeDuelDrawEffectV2,
  type DuelDrawEffectAuthorityV2,
  type DuelDrawEffectCursorV2,
  type DuelDrawEffectResultV2,
  type DuelDrawEffectSourceV2,
} from './draw-effect-executor-v2.js';
import {
  beginDuelKillDamageEffectV2,
  createDuelKillDamageEffectAuthorityV2,
  resumeDuelKillDamageEffectV2,
  submitDuelKillDamageEffectChoiceV2,
  type DuelKillDamageChoiceV2,
  type DuelKillDamageEffectAuthorityV2,
  type DuelKillDamageEffectCursorV2,
  type DuelKillDamageEffectResultV2,
  type DuelKillDamageEffectSourceV2,
} from './kill-damage-effect-executor-v2.js';
import {
  beginDuelPointDamageEffectV1,
  createDuelPointDamageEffectAuthorityV1,
  resumeDuelPointDamageEffectV1,
  type DuelPointDamageEffectAuthorityV1,
  type DuelPointDamageEffectCursorV1,
} from './point-damage-effect-executor-v1.js';

export interface DuelSpellCardPlayCommandV2 {
  readonly cardUID: string;
  readonly paymentPlan?: DuelPaymentPlan;
  /** CR 355: targeted choices are fixed before paying/finalizing, including an
   * explicit empty group for an "up to" instruction. Not a resolution choice. */
  readonly targetUIDs?: readonly string[];
}
export interface DuelSpellCardPlayEnvelopeV2 {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly command: DuelSpellCardPlayCommandV2;
}

export type DuelSpellCardPlayOutcomeV2 =
  | { readonly status: 'pending'; readonly step: 'payment' | 'priority' | 'target' | 'effect';
      readonly cardUID: string; readonly taskId?: string; readonly paymentId?: string;
      readonly chain: DuelChainV2; readonly reason?: string }
  | { readonly status: 'applied'; readonly appliedVersion: number; readonly eventSeq: number;
      readonly cardUID: string; readonly effect: string; readonly changed: boolean }
  | { readonly status: 'rejected'; readonly reason: 'invalid-command' | 'command-conflict' |
      'unknown-actor' | 'stale-version' | 'invalid-phase' | 'no-permission' | 'illegal-target' }
  | { readonly status: 'blocked'; readonly reason: 'source-unproved' | 'cost-unproved' |
      'chain-unproved' | 'effect-unproved' | 'closure-unproved' | 'reentrant-command' |
      'outstanding-task-or-session' };

export interface DuelSpellCardPlayReceiptV2 {
  readonly actor: string;
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly outcome: DuelSpellCardPlayOutcomeV2;
}

/** A parent-owned command claim.  The parent implementation persists this
 * record together with resource/Unit/Turn/Move command receipts. */
export interface DuelSpellCommandClaimV2 {
  readonly actor: string;
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly expectedVersion: number;
  readonly kind: 'spell' | 'resource';
}
export type DuelSpellCommandClaimResultV2 =
  | { readonly status: 'new'; readonly claim?: unknown }
  | { readonly status: 'duplicate'; readonly outcome?: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2 }
  | { readonly status: 'conflict' }
  | { readonly status: 'blocked' };

export interface DuelSpellCommittedEffectV2 extends DuelChainCommittedReceiptV2 {
  readonly cardUID: string;
  readonly effectStatus: 'complete' | 'no-change' | 'countered';
  readonly matchId: string;
  readonly beforeStateVersion: number;
  readonly afterStateVersion: number;
}

/** Parent composition owns the cross-action command namespace and the durable
 * ticket receipt. Callbacks confirm synchronously; Promise/thenable returns
 * never confirm a receipt. No default map/true answer is supplied here. */
export interface DuelSpellCommandDispatcherV2 {
  readonly claim: (request: Readonly<DuelSpellCommandClaimV2>) => DuelSpellCommandClaimResultV2;
  readonly finish: (request: Readonly<{
    readonly claim: unknown;
    readonly outcome: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2;
    readonly persistRequired: boolean;
  }>) => void;
  readonly readCommitted: (ticket: DuelChainResolutionTicketV2) => DuelSpellCommittedEffectV2 | null;
  readonly commitEffect: (request: Readonly<{
    readonly ticket: DuelChainResolutionTicketV2;
    readonly receipt: DuelSpellCommittedEffectV2;
    readonly session: DuelCommandSessionV2;
  }>) => void;
  /** A parent-owned, idempotent native journal handoff after actual Chain commit.
   * Return undefined only after the synchronous handoff is confirmed. */
  readonly notifyCommitted?: (request: Readonly<{
    readonly ticket: DuelChainResolutionTicketV2;
    readonly proof: DuelChainCommittedProofV2;
    readonly commandSession: DuelCommandSessionV2;
    readonly chain: DuelChainV2;
    readonly cardUID: string;
    readonly cardId: string;
    readonly controller: string;
    readonly sourceEpoch: number;
  }>) => void;
}

export interface DuelSpellResolutionBindingV2 {
  readonly chainId: string;
  readonly executorId: string;
  readonly resolutionAuthority: DuelChainResolutionAuthorityV2;
}

export interface DuelSpellCostBindingV2 {
  readonly matchId: string;
  readonly stateVersion: number;
  readonly actor: string;
  readonly uid: string;
  readonly cardId: string;
  readonly sourceEpoch: number;
  readonly transactionId: string;
  readonly baseProofId: string;
  readonly coverageProofId: string;
}
export type DuelSpellCostBindingServiceV2 = (request: Readonly<DuelSpellCostBindingV2>) =>
  DuelSpellCostBindingV2 & { readonly status: 'complete' | 'unknown' };

/** Trusted, process-local request used only by the explicit Chain-first Spell
 * preparation path. The callback receives the actual post-move Core head and
 * Chain capability; it cannot be supplied by a command or wire payload. */
export interface DuelSpellChainFirstCostRequestV3 {
  readonly commandSession: DuelCommandSessionV2;
  readonly match: DuelCanonicalPlayingStateV2;
  readonly chain: DuelChainV2;
  readonly cardUID: string;
  readonly cardId: string;
  readonly controller: string;
  readonly sourceEpoch: number;
  readonly targetUIDs: readonly string[] | null;
  readonly transactionId: string;
  readonly authority: DuelCostResolverAuthorityV2;
}
export type DuelSpellChainFirstCostAuthorityV3 =
  (request: Readonly<DuelSpellChainFirstCostRequestV3>) => DuelCostResolverAuthorityV2;

/**
 * Process-local proof that a Chain-first cost callback was reached by the
 * native Spell lifecycle.  It is deliberately issued only inside this module
 * and is inspected through an opaque request identity; callers cannot mint a
 * structurally equivalent proof from a command payload.
 */
export interface DuelSpellChainFirstLifecycleProofV3 {
  readonly kind: 'duel-spell-chain-first-lifecycle-proof-v3';
  readonly request: DuelSpellChainFirstCostRequestV3;
  readonly commandSession: DuelCommandSessionV2;
  readonly match: DuelCanonicalPlayingStateV2;
  readonly chain: DuelChainV2;
  readonly chainId: string;
  readonly chainVersion: number;
  readonly chainItemId: string;
  readonly cardUID: string;
  readonly cardId: string;
  readonly controller: string;
  readonly sourceEpoch: number;
  readonly stateVersion: number;
  readonly transactionId: string;
  readonly targetUIDs: readonly string[] | null;
}

export interface DuelSpellChainFirstResolvedProofV3 {
  readonly kind: 'duel-spell-chain-first-resolved-proof-v3';
  readonly lifecycle: DuelSpellChainFirstLifecycleProofV3;
  readonly authority: DuelCostResolverAuthorityV2;
  readonly resolved: DuelResolvedCostV2;
}

export interface DuelSpellEffectClosureV2 {
  readonly draw?: {
    readonly randomIndex?: (exclusiveUpperBound: number) => number;
    readonly resolveFirstBurnout?: Parameters<typeof createDuelDrawEffectAuthorityV2>[0]['resolveFirstBurnout'];
    readonly resolveIntervention?: Parameters<typeof createDuelDrawEffectAuthorityV2>[0]['resolveIntervention'];
  };
  readonly killDamage?: {
    readonly verifyCost?: Parameters<typeof createDuelKillDamageEffectAuthorityV2>[0]['verifyCost'];
    readonly verifyChain?: Parameters<typeof createDuelKillDamageEffectAuthorityV2>[0]['verifyChain'];
    readonly resolveKill?: Parameters<typeof createDuelKillDamageEffectAuthorityV2>[0]['resolveKill'];
    readonly resolveDamage?: Parameters<typeof createDuelKillDamageEffectAuthorityV2>[0]['resolveDamage'];
  };
  readonly pointDamage?: {
    readonly verifyCost?: Parameters<typeof createDuelPointDamageEffectAuthorityV1>[0]['verifyCost'];
    readonly verifyChain?: Parameters<typeof createDuelPointDamageEffectAuthorityV1>[0]['verifyChain'];
    readonly resolveDamage?: Parameters<typeof createDuelPointDamageEffectAuthorityV1>[0]['resolveDamage'];
    readonly resolveLethal?: Parameters<typeof createDuelPointDamageEffectAuthorityV1>[0]['resolveLethal'];
  };
}

export interface DuelSpellCardPlayServicesV2 {
  readonly programs: DuelOfficialProgramRegistry;
  readonly cost: DuelCostResolverAuthorityV2;
  readonly costBinding: DuelSpellCostBindingServiceV2;
  readonly sourceAttestor: DuelSourceAttestorV2;
  readonly dispatcher: DuelSpellCommandDispatcherV2;
  readonly closure: DuelSpellEffectClosureV2;
  /** Explicit opt-in only. Omitted means the legacy V2 Hand-first path. */
  readonly cardPlayOrder?: 'hand-first-v2' | 'chain-first-v3' | 'showdown-focus-chain-first-v3';
  /** Independent source-bound Point IR; only the explicit Chain-first path admits it. */
  readonly pointDamageSpellV1?: boolean;
  /** CR 347/806/813 admission for the explicit Showdown Focus path. The
   * caller binds this to the currently active battlefield and Focus owner;
   * it is never accepted from a play command. */
  readonly showdownFocus?: {
    readonly fieldId: string;
    readonly returnFocusPlayerId: string;
  };
  /** Trusted source adapter for Chain-first cost snapshots. The returned
   * authority is still verified by the existing Cost Resolver. */
  readonly costForChain?: DuelSpellChainFirstCostAuthorityV3;
  /** Optional externally chosen chain ID. The chain itself is always created
   * with a parent-owned committed-receipt authority. */
  readonly chainId?: string;
  /** Same parent-owned entropy tape as the native owner. Never supplied by a
   * play command; required by the public replay composition when it is wired. */
  readonly identityFactory?: () => string;
}

export interface DuelSpellCardPlaySessionV2 {
  readonly commandSession: DuelCommandSessionV2;
  readonly chain: DuelChainV2;
  readonly receipts: readonly DuelSpellCardPlayReceiptV2[];
}
export interface DuelSpellCardPlayResultV2 {
  readonly session: DuelSpellCardPlaySessionV2;
  readonly outcome: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2;
  readonly duplicate: boolean;
  readonly persistRequired: boolean;
}

type EffectBond =
  | { readonly kind: 'draw'; readonly authority: DuelDrawEffectAuthorityV2; readonly cursor?: DuelDrawEffectCursorV2 }
  | { readonly kind: 'kill'; readonly authority: DuelKillDamageEffectAuthorityV2; readonly cursor?: DuelKillDamageEffectCursorV2 }
  | { readonly kind: 'point'; readonly authority: DuelPointDamageEffectAuthorityV1; readonly cursor?: DuelPointDamageEffectCursorV1 };
interface PendingCost {
  readonly actor: string;
  readonly cardUID: string;
  readonly commandId: string;
  readonly taskId: string;
  readonly paymentId: string;
  readonly authority?: DuelRequiredCostAuthorityV2;
  readonly cost: DuelRuneCost;
}
interface PendingChainFirstCost {
  readonly actor: string;
  readonly cardUID: string;
  readonly cardId: string;
  readonly commandId: string;
  readonly transactionId: string;
  readonly sourceEpoch: number;
  readonly stateVersion: number;
  readonly chainVersion: number;
  readonly taskId: string;
  readonly paymentId: string;
  readonly targets: PhysicalSpellBinding['targets'];
  readonly authority?: DuelCostResolverAuthorityV2;
  readonly resolved?: DuelResolvedCostV2;
  readonly bindingComplete?: boolean;
  readonly targetError?: boolean;
}
interface PendingEffect {
  readonly ticket: DuelChainResolutionTicketV2;
  readonly bond?: EffectBond;
  readonly cardUID: string;
  readonly effectName: string;
  readonly head: { value: DuelCanonicalPlayingStateV2 };
  readonly candidate?: { readonly session: DuelCommandSessionV2; readonly receipt: DuelSpellCommittedEffectV2;
    readonly changed: boolean };
  /** Chain/window already committed; only the parent command receipt is pending. */
  readonly closed?: { readonly chain: DuelChainV2; readonly session: DuelCommandSessionV2;
    readonly proof: DuelChainCommittedProofV2; readonly notificationAcknowledged: boolean };
}
interface PhysicalSpellBinding { readonly uid: string; readonly cardId: string; readonly controller: string;
  readonly epoch: number; readonly effectName: string; readonly claim: unknown;
  readonly targets: readonly { readonly uid: string; readonly zoneEpoch: number;
    readonly tokenBirthVersion?: number }[] | null }
interface PendingReceipt {
  readonly request: DuelSpellCommandClaimV2;
  readonly claim: unknown;
  readonly outcome: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2;
  readonly response: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2;
  readonly persistRequired: boolean;
  readonly spellReceipt?: DuelSpellCardPlayReceiptV2;
}
interface PrivateState {
  active: boolean;
  readonly guard: { busy: boolean; poisoned: boolean };
  readonly services: DuelSpellCardPlayServicesV2;
  readonly executor: DuelChainExecutorV2;
  readonly resolutionAuthority: ReturnType<typeof createDuelChainResolutionAuthorityV2>;
  readonly committed: Map<string, DuelSpellCommittedEffectV2>;
  readonly bindings: Map<string, PhysicalSpellBinding>;
  pendingCost?: PendingCost;
  pendingChainFirst?: PendingChainFirstCost;
  pendingEffect?: PendingEffect;
  pendingReceipt?: PendingReceipt;
}

const sessions = new WeakMap<object, PrivateState>();
const canonicalOwners = new WeakSet<object>();
const commandOrigins = new WeakMap<object, object>();
const chainFirstLifecycleProofs = new WeakMap<object, DuelSpellChainFirstLifecycleProofV3>();
const chainFirstResolvedProofs = new WeakMap<object, DuelSpellChainFirstResolvedProofV3>();

/** Inspect only an ordinary dense Array's own data descriptors.  This path is
 * used for process-local proof comparison, so it must not invoke user
 * toJSON/getters/iterators while checking the callback target group. */
function isFrozenDenseStringArray(value: unknown): value is readonly string[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || !Object.isFrozen(value)) return false;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !('value' in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return false;
    const length = lengthDescriptor.value as number;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return false;
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') return false;
    }
    return keys.every(key => {
      if (key === 'length') return true;
      if (typeof key !== 'string') return false;
      const index = Number(key);
      return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
    });
  } catch { return false; }
}

function sameFrozenDenseStringArray(left: unknown, right: unknown): boolean {
  if (left === null || right === null) return left === right;
  if (!isFrozenDenseStringArray(left) || !isFrozenDenseStringArray(right) || left !== right) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(left, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)) return false;
  const length = lengthDescriptor.value as number;
  for (let index = 0; index < length; index++) {
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, String(index));
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, String(index));
    if (!leftDescriptor || !rightDescriptor || !('value' in leftDescriptor) ||
        !('value' in rightDescriptor) || leftDescriptor.value !== rightDescriptor.value) return false;
  }
  return true;
}

/** Install a process-local lifecycle record for the exact callback object. */
function registerChainFirstLifecycleProof(request: DuelSpellChainFirstCostRequestV3,
  commandSession: DuelCommandSessionV2, match: DuelCanonicalPlayingStateV2,
  chain: DuelChainV2, chainItemId: string): void {
  const targetUIDs = request.targetUIDs === null ? null : request.targetUIDs;
  check(targetUIDs === null || isFrozenDenseStringArray(targetUIDs), 'Chain-first target proof requires immutable dense targets');
  const proof: DuelSpellChainFirstLifecycleProofV3 = Object.freeze({
    kind: 'duel-spell-chain-first-lifecycle-proof-v3', request, commandSession, match, chain,
    chainId: chain.chainId, chainVersion: chain.stateVersion, chainItemId,
    cardUID: request.cardUID, cardId: request.cardId, controller: request.controller,
    sourceEpoch: request.sourceEpoch, stateVersion: match.stateVersion,
    transactionId: request.transactionId,
    targetUIDs,
  });
  chainFirstLifecycleProofs.set(request as object, proof);
}

/**
 * Read-only inspection of a proof issued by the native Chain-first path.
 * Returns null for clones, wire objects, and requests from another lifecycle.
 */
export function inspectDuelSpellChainFirstLifecycleProofV3(
  request: Readonly<DuelSpellChainFirstCostRequestV3>,
): DuelSpellChainFirstLifecycleProofV3 | null {
  try {
    const proof = request && typeof request === 'object'
      ? chainFirstLifecycleProofs.get(request as object) : undefined;
    if (!proof || proof.request !== request || proof.commandSession.match !== proof.match ||
        proof.chain.chainId !== proof.chainId || proof.chain.stateVersion !== proof.chainVersion ||
        proof.stateVersion !== proof.match.stateVersion || proof.cardUID !== request.cardUID ||
        proof.cardId !== request.cardId || proof.controller !== request.controller ||
        proof.sourceEpoch !== request.sourceEpoch || proof.transactionId !== request.transactionId ||
        proof.targetUIDs !== request.targetUIDs ||
        !sameFrozenDenseStringArray(proof.targetUIDs, request.targetUIDs)) return null;
    return proof;
  } catch { return null; }
}

/** The resolver result is published only for the exact native callback object. */
export function inspectDuelSpellChainFirstResolvedProofV3(
  request: Readonly<DuelSpellChainFirstCostRequestV3>,
): DuelSpellChainFirstResolvedProofV3 | null {
  const lifecycle = inspectDuelSpellChainFirstLifecycleProofV3(request);
  const proof = lifecycle && chainFirstResolvedProofs.get(request as object);
  return proof && proof.lifecycle === lifecycle &&
    proof.lifecycle.targetUIDs === request.targetUIDs &&
    sameFrozenDenseStringArray(proof.lifecycle.targetUIDs, request.targetUIDs) ? proof : null;
}

function check(value: unknown, message: string): asserts value { if (!value) throw new TypeError(`Duel Spell CardPlay V2: ${message}`); }
function id(value: unknown, message: string): string {
  check(typeof value === 'string' && value.trim().length > 0, message); return value;
}
function version(value: unknown): number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'safe version required'); return value;
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'plain record required');
  check(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'plain record prototype');
  const keys = Reflect.ownKeys(value);
  check(keys.length >= required.length && keys.length <= required.length + optional.length,
    'record key count');
  check(keys.every(key => typeof key === 'string' && [...required, ...optional].includes(key) &&
    'value' in Object.getOwnPropertyDescriptor(value, key)!), 'record keys/accessors');
  check(required.every(key => keys.includes(key)), 'record required key');
  return value as Record<string, unknown>;
}
function parseEnvelope(raw: unknown): DuelSpellCardPlayEnvelopeV2 {
  const e = record(raw, ['commandId', 'expectedVersion', 'command']);
  const c = record(e.command, ['cardUID'], ['paymentPlan', 'targetUIDs']);
  let targetUIDs: readonly string[] | undefined;
  if (Object.hasOwn(c, 'targetUIDs')) {
    check(Array.isArray(c.targetUIDs) && Object.getPrototypeOf(c.targetUIDs) === Array.prototype &&
      c.targetUIDs.length <= 2 && Reflect.ownKeys(c.targetUIDs).length === c.targetUIDs.length + 1, 'dense finite target list');
    const chosen: string[] = [];
    for (let index = 0; index < c.targetUIDs.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(c.targetUIDs, String(index));
      check(descriptor && 'value' in descriptor, 'target accessors are not accepted');
      chosen.push(id(descriptor.value, 'target UID'));
    }
    targetUIDs = Object.freeze(chosen);
    check(new Set(targetUIDs).size === targetUIDs.length, 'duplicate target');
  }
  let paymentPlan: DuelPaymentPlan | undefined;
  if (Object.hasOwn(c, 'paymentPlan')) {
    const p = record(c.paymentPlan, ['power']);
    check(Array.isArray(p.power) && Object.getPrototypeOf(p.power) === Array.prototype &&
      Reflect.ownKeys(p.power).length === p.power.length + 1, 'dense payment plan');
    paymentPlan = { power: p.power.map(item => {
      const value = record(item, ['requirementIndex', 'from', 'amount']);
      check(Number.isSafeInteger(value.requirementIndex) && (value.requirementIndex as number) >= 0,
        'payment requirement index');
      check(typeof value.from === 'string' && ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'any'].includes(value.from),
        'payment domain');
      check(Number.isSafeInteger(value.amount) && (value.amount as number) >= 0, 'payment amount');
      return { requirementIndex: value.requirementIndex as number, from: value.from as DuelPaymentPlan['power'][number]['from'], amount: value.amount as number };
    }) };
  }
  return { commandId: id(e.commandId, 'command ID'), expectedVersion: version(e.expectedVersion),
    command: { cardUID: id(c.cardUID, 'card UID'), ...(paymentPlan ? { paymentPlan } : {}),
      ...(targetUIDs ? { targetUIDs } : {}) } };
}
function fingerprint(envelope: DuelSpellCardPlayEnvelopeV2): string {
  const plan = envelope.command.paymentPlan;
  return JSON.stringify([envelope.expectedVersion, envelope.command.cardUID,
    plan ? plan.power.map(item => [item.requirementIndex, item.from, item.amount]) : null,
    envelope.command.targetUIDs ?? null]);
}

function captureTargets(match: DuelCanonicalPlayingStateV2, actor: string,
  effect: { readonly kind: string; readonly controller?: string;
    readonly target?: { readonly kind: string; readonly controller: string; readonly location: string;
      readonly minSelections: number; readonly maxSelections: number } },
  targetUIDs: readonly string[] | undefined): PhysicalSpellBinding['targets'] {
  if (effect.kind !== 'kill-unit' && effect.kind !== 'deal-damage' && effect.kind !== 'point-damage') {
    check(targetUIDs === undefined, 'non-targeted instruction has no target choice');
    return null;
  }
  check(targetUIDs !== undefined && (effect.kind === 'deal-damage' ? targetUIDs.length <= 2 : targetUIDs.length === 1),
    'targeted instruction requires its complete target group');
  return Object.freeze(targetUIDs.map(uid => {
    const unit = match.board.units.find(value => value.objectId === uid);
    check(unit && (effect.controller !== 'enemy' || unit.controllerPlayerId !== actor), 'illegal target');
    if (effect.kind === 'point-damage') {
      check(effect.target?.kind === 'unit' && effect.target.controller === 'any' &&
        effect.target.minSelections === 1 && effect.target.maxSelections === 1, 'unproved Point target rule');
      check(effect.target.location === 'battlefield'
        ? match.board.battlefields.some(field => field.locationId === unit.locationId)
        : effect.target.location === 'any' && (match.board.bases.some(base => base.locationId === unit.locationId) ||
          match.board.battlefields.some(field => field.locationId === unit.locationId)), 'illegal Point location');
      if (match.unitMeta[uid]?.trait.kind === 'token') {
        const births = inspectDuelNativeTokenHistoryV2(match).births.filter(entry =>
          entry.kind === 'recruit' && entry.tokenUID === uid);
        check(births.length === 1 && !match.retiredUnitTokenUIDs.includes(uid), 'unproved Point token lifetime');
        return Object.freeze({ uid, zoneEpoch: -1, tokenBirthVersion: births[0]!.createdAtStateVersion });
      }
    }
    // A board-to-board move preserves this epoch; a non-board exit/return does
    // not. Token targets still need the shared token lifetime authority.
    return Object.freeze(referenceDuelPhysicalCardV2(match, uid));
  }));
}
function pointTargetCurrent(match: DuelCanonicalPlayingStateV2, binding: PhysicalSpellBinding,
  location: 'battlefield' | 'any'): boolean {
  const target = binding.targets?.[0];
  if (!target || binding.targets?.length !== 1) return false;
  if (target.tokenBirthVersion !== undefined) {
    if (match.unitMeta[target.uid]?.trait.kind !== 'token' ||
        match.retiredUnitTokenUIDs.includes(target.uid) ||
        !inspectDuelNativeTokenHistoryV2(match).births.some(entry =>
          entry.kind === 'recruit' && entry.tokenUID === target.uid &&
          entry.createdAtStateVersion === target.tokenBirthVersion)) return false;
  } else {
    try { assertCurrentDuelPhysicalReferenceV2(match, target); } catch { return false; }
  }
  const unit = match.board.units.find(value => value.objectId === target.uid);
  return !!unit && (location === 'battlefield'
    ? match.board.battlefields.some(field => field.locationId === unit.locationId)
    : match.board.bases.some(base => base.locationId === unit.locationId) ||
      match.board.battlefields.some(field => field.locationId === unit.locationId));
}
function paidPointTask(session: DuelSpellCardPlaySessionV2, pending: PendingEffect,
  binding: PhysicalSpellBinding): boolean {
  const taskId = `spell-task:${pending.ticket.itemId}`;
  const paymentId = `spell-payment:${pending.ticket.itemId}`;
  const task = session.commandSession.requiredTasks.find(entry => entry.taskId === taskId);
  const source = sourceReference(binding.cardId, binding.uid);
  return task?.status === 'completed' && task.paymentId === paymentId &&
    task.actor === binding.controller && task.matchId === session.commandSession.match.matchId &&
    task.opaqueSource.kind === source.kind && task.opaqueSource.referenceId === source.referenceId &&
    task.opaqueSource.sourceUID === source.sourceUID &&
    task.sourceBinding.matchId === task.matchId &&
    task.sourceBinding.actor === binding.controller &&
    task.sourceBinding.mode === 'current' &&
    task.sourceBinding.taskId === taskId && task.sourceBinding.paymentId === paymentId &&
    task.sourceBinding.continuationId === task.continuationId &&
    task.sourceBinding.sourceReference.kind === source.kind &&
    task.sourceBinding.sourceReference.referenceId === source.referenceId &&
    task.sourceBinding.sourceReference.sourceUID === source.sourceUID &&
    task.sourceBinding.sourceZoneEpoch === binding.epoch &&
    (session.commandSession.match as DuelCanonicalPlayingStateV2).frame.pendingPayment === null;
}
function assertCapturedTargets(match: DuelCanonicalPlayingStateV2, binding: PhysicalSpellBinding): void {
  for (const reference of binding.targets ?? []) {
    if (reference.tokenBirthVersion !== undefined) {
      check(match.unitMeta[reference.uid]?.trait.kind === 'token' &&
        !match.retiredUnitTokenUIDs.includes(reference.uid) &&
        inspectDuelNativeTokenHistoryV2(match).births.some(entry =>
          entry.kind === 'recruit' && entry.tokenUID === reference.uid &&
          entry.createdAtStateVersion === reference.tokenBirthVersion), 'chosen token lifetime changed');
    } else assertCurrentDuelPhysicalReferenceV2(match, reference);
    check(match.board.units.some(value => value.objectId === reference.uid), 'chosen target is not on Board');
  }
}

/** The admitted Chain owns the response window, while Core owns the game clock.
 * Payment windows continue to be issued only through the canonical cost ledger. */
function syncChainFrame(commandSession: DuelCommandSessionV2, chain: DuelChainV2): DuelCommandSessionV2 {
  const match = commandSession.match as DuelCanonicalPlayingStateV2;
  if (match.frame.phase === 'ended') return commandSession;
  const priorityPlayerId = chain.phase === 'resolve' || chain.phase === 'await-commit'
    ? null : chain.priorityPlayerId;
  const stateOpen = chain.stateOpen && chain.phase === 'open';
  if (match.frame.priorityPlayerId === priorityPlayerId && match.frame.stateOpen === stateOpen) return commandSession;
  return commitDuelCommandFrameV2(commandSession, { ...match.frame, priorityPlayerId, stateOpen },
    (before, proposed) => {
      check(before === match && before.frame.phase === 'main' && before.frame.pendingPayment === null &&
        proposed.phase === before.frame.phase && proposed.turnPlayerId === before.frame.turnPlayerId &&
        proposed.turnNumber === before.frame.turnNumber && proposed.focusPlayerId === before.frame.focusPlayerId,
      'Chain cannot alter turn, Focus or payment');
    }).session;
}
function claimKey(actor: string, commandId: string): string { return JSON.stringify([actor, commandId]); }
function sourceReference(cardId: string, uid: string): { readonly kind: 'card'; readonly referenceId: string; readonly sourceUID: string } {
  return Object.freeze({ kind: 'card' as const, referenceId: cardId, sourceUID: uid });
}
function sourceFor(state: DuelCanonicalPlayingStateV2, uid: string, effectId: string,
  phase: 'spell-resolution' = 'spell-resolution'): DuelDrawEffectSourceV2 & DuelKillDamageEffectSourceV2 {
  const physical = state.physicalCardsByUID[uid];
  check(physical, 'physical Spell source missing');
  const card = state.chainCards?.find(item => item.uid === uid);
  check(card, 'Spell source is not on Chain');
  const reference = sessionsSourceRegistry.get(state)?.reference(card.cardId);
  check(reference, 'Spell source program is unresolved');
  return Object.freeze({ sourceUID: uid, sourceZoneEpoch: physical.zoneEpoch,
    controllerPlayerId: card.controllerPlayerId, cardId: card.cardId, programId: reference.programId,
    dataVersion: reference.dataVersion, catalogDigest: reference.sourceCatalogDigest, effectId, phase,
    window: 'main' });
}
const sessionsSourceRegistry = new WeakMap<object, DuelOfficialProgramRegistry>();

function publish(previous: DuelSpellCardPlaySessionV2 | null, commandSession: DuelCommandSessionV2,
  chain: DuelChainV2, services: DuelSpellCardPlayServicesV2, executor: DuelChainExecutorV2,
  receipts: readonly DuelSpellCardPlayReceiptV2[], committed: Map<string, DuelSpellCommittedEffectV2>,
  resolutionAuthority: ReturnType<typeof createDuelChainResolutionAuthorityV2>,
  pendingCost?: PendingCost, pendingEffect?: PendingEffect, pendingReceipt?: PendingReceipt,
  pendingChainFirst?: PendingChainFirstCost): DuelSpellCardPlaySessionV2 {
  const session = Object.freeze({ commandSession, chain, receipts: Object.freeze([...receipts]) });
  const state: PrivateState = { active: true,
    guard: previous ? stateOf(previous).guard : { busy: false, poisoned: false }, services, executor,
    resolutionAuthority,
    bindings: previous ? stateOf(previous).bindings : new Map(),
    committed, ...(pendingCost ? { pendingCost } : {}), ...(pendingEffect ? { pendingEffect } : {}),
    ...(pendingReceipt ? { pendingReceipt } : {}), ...(pendingChainFirst ? { pendingChainFirst } : {}) };
  sessions.set(session, state);
  canonicalOwners.add(commandSession);
  sessionsSourceRegistry.set(commandSession.match as object, services.programs);
  if (previous) { const old = sessions.get(previous as object); if (old) old.active = false; }
  if (previous) commandOrigins.set(session as object, commandOrigins.get(previous as object) ?? previous as object);
  else commandOrigins.set(session as object, session as object);
  return session;
}
function output(session: DuelSpellCardPlaySessionV2, outcome: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2,
  duplicate = false, persistRequired = false): DuelSpellCardPlayResultV2 {
  return Object.freeze({ session, outcome, duplicate, persistRequired });
}
function stateOf(session: DuelSpellCardPlaySessionV2): PrivateState {
  const value = sessions.get(session as object); check(value, 'unadmitted Spell session'); return value;
}
function active(session: DuelSpellCardPlaySessionV2): PrivateState {
  const state = stateOf(session);
  if (state.guard.busy) { state.guard.poisoned = true; throw new TypeError('Duel Spell CardPlay V2: reentrant command'); }
  check(state.active, 'inactive Spell session'); return state;
}
/** Keep nested source-provider reentry from reaching a canonical successor. The
 * canonical task/payment kernels commit only after this callback returns, so the
 * poison check must happen inside the callback wrapper rather than afterward. */
function guardedSourceAttestor(state: PrivateState): DuelSourceAttestorV2 {
  return request => {
    const binding = state.services.sourceAttestor(request);
    check(!state.guard.poisoned, 'reentered Spell source attestor');
    return binding;
  };
}
/** Trusted same-process composition only. DATA copies and superseded sessions have no binding. */
export function inspectDuelSpellResolutionBindingV2(session: DuelSpellCardPlaySessionV2): DuelSpellResolutionBindingV2 {
  const state = active(session);
  return Object.freeze({ chainId: session.chain.chainId, executorId: state.executor.executorId,
    resolutionAuthority: state.resolutionAuthority });
}
/** Process-local proof for the Engagement owner. DATA copies, foreign branches,
 * unconfirmed receipts and a Chain still resolving cannot reclaim Focus. */
export function assertDuelSpellShowdownClosureV2(initial: DuelSpellCardPlaySessionV2,
  latest: DuelSpellCardPlaySessionV2, returnFocusPlayerId: string): DuelCanonicalPlayingStateV2 {
  const first = stateOf(initial), last = active(latest);
  check(commandOrigins.get(initial as object) === commandOrigins.get(latest as object) &&
    first.services.cardPlayOrder === 'showdown-focus-chain-first-v3' &&
    last.services.cardPlayOrder === 'showdown-focus-chain-first-v3' &&
    first.services.showdownFocus === last.services.showdownFocus,
  'foreign Showdown Spell branch');
  inspectDuelNativeCommandSessionPathV2(initial.commandSession, latest.commandSession);
  const chain = latest.chain, match = latest.commandSession.match as DuelCanonicalPlayingStateV2;
  check(chain.closeContext.kind === 'showdown' &&
    chain.closeContext.returnFocusPlayerId === returnFocusPlayerId &&
    chain.phase === 'open' && chain.status === 'open' && chain.items.length === 0 &&
    chain.issuedItemIds.length > 0 && !match.chainCards?.length &&
    match.frame.stateOpen && match.frame.priorityPlayerId === returnFocusPlayerId &&
    match.frame.focusPlayerId === returnFocusPlayerId &&
    !last.pendingCost && !last.pendingChainFirst && !last.pendingEffect && !last.pendingReceipt,
  'Showdown Spell Chain is not fully closed');
  check(latest.receipts.some(receipt => receipt.outcome.status === 'applied'),
    'Showdown Spell resolution receipt is missing');
  return match;
}
function sameMatch(session: DuelSpellCardPlaySessionV2, match: DuelCanonicalPlayingStateV2): void {
  check(session.commandSession.match === match, 'Spell session head mismatch');
}
function isSynchronousReceiptResult(result: unknown): boolean {
  if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return true;
  let cursor: object | null = result;
  const seen = new WeakSet<object>();
  for (let depth = 0; cursor !== null && depth < 32; depth++) {
    if (seen.has(cursor) || Object.getOwnPropertyDescriptor(cursor, 'then') !== undefined) return false;
    seen.add(cursor);
    cursor = Object.getPrototypeOf(cursor);
  }
  return cursor === null;
}
function finishClaim(state: PrivateState, claim: unknown, outcome: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2, persistRequired: boolean): boolean {
  // Failure must never make the caller fall back to an already spent branch.
  try {
    const confirmation = state.services.dispatcher.finish(Object.freeze({ claim,
      outcome: Object.freeze({ ...outcome }), persistRequired }));
    if (!isSynchronousReceiptResult(confirmation)) return false;
    // A reentrant callback may poison the guard while acknowledging an
    // already-applied resource successor. Never publish an applied outcome in
    // that case; pending payment recovery remains retryable for compatibility.
    return !(state.guard.poisoned && (state.pendingReceipt?.response.status ?? outcome.status) === 'applied');
  }
  catch { return false; }
}
function claim(state: PrivateState, request: DuelSpellCommandClaimV2): DuelSpellCommandClaimResultV2 {
  try { return state.services.dispatcher.claim(Object.freeze({ ...request })); }
  catch { return { status: 'blocked' }; }
}
function sameOutcome(left: unknown, right: unknown): boolean {
  const seenLeft = new WeakSet<object>(), seenRight = new WeakSet<object>();
  const compare = (a: unknown, b: unknown): boolean => {
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object')
      return a === b && (a === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof a));
    if (seenLeft.has(a) || seenRight.has(b)) return false;
    seenLeft.add(a); seenRight.add(b);
    const array = Array.isArray(a);
    if (array !== Array.isArray(b)) return false;
    const prototype = array ? Array.prototype : Object.prototype;
    if (![prototype, null].includes(Object.getPrototypeOf(a)) ||
        ![prototype, null].includes(Object.getPrototypeOf(b))) return false;
    const keys = Reflect.ownKeys(a), otherKeys = Reflect.ownKeys(b);
    if (keys.length !== otherKeys.length || keys.some(key => typeof key !== 'string' || !otherKeys.includes(key))) return false;
    return keys.every(key => {
      const x = Object.getOwnPropertyDescriptor(a, key), y = Object.getOwnPropertyDescriptor(b, key);
      return !!x && !!y && (array || x.enumerable) && (array || y.enumerable) &&
        'value' in x && 'value' in y && compare(x.value, y.value);
    });
  };
  try { return compare(left, right); } catch { return false; }
}
function recoverReceipt(session: DuelSpellCardPlaySessionV2, request: DuelSpellCommandClaimV2): DuelSpellCardPlayResultV2 | undefined {
  const state = stateOf(session), pending = state.pendingReceipt;
  if (!pending) return undefined;
  if (request.actor !== pending.request.actor || request.commandId !== pending.request.commandId ||
      request.kind !== pending.request.kind)
    return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
  if (request.expectedVersion !== pending.request.expectedVersion ||
      request.payloadFingerprint !== pending.request.payloadFingerprint)
    return output(session, rejectOutcome('command-conflict'));
  const claimed = claim(state, request);
  if (state.guard.poisoned && pending.response.status === 'applied')
    return output(session, { status: 'blocked', reason: 'reentrant-command' });
  if (claimed.status === 'conflict') return output(session, rejectOutcome('command-conflict'));
  if (claimed.status !== 'duplicate')
    return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
  if (claimed.outcome !== undefined) {
    const matches = sameOutcome(claimed.outcome, pending.outcome);
    if (state.guard.poisoned || !matches)
      return output(session, { status: 'blocked', reason: state.guard.poisoned ? 'reentrant-command' : 'outstanding-task-or-session' });
  }
  if (claimed.outcome === undefined && !finishClaim(state, pending.claim, pending.outcome, pending.persistRequired))
    return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
  if (state.guard.poisoned && pending.response.status === 'applied')
    return output(session, { status: 'blocked', reason: 'reentrant-command' });
  const receipts = pending.spellReceipt ? [...session.receipts, pending.spellReceipt] : session.receipts;
  const next = publish(session, session.commandSession, session.chain, state.services, state.executor,
    receipts, state.committed, state.resolutionAuthority, state.pendingCost, state.pendingEffect);
  return output(next, pending.response, true, true);
}

/** Admit exactly one action branch for an already admitted playing command session. */
export function createDuelSpellCardPlaySessionV2(commandSession: DuelCommandSessionV2,
  services: DuelSpellCardPlayServicesV2): DuelSpellCardPlaySessionV2 {
  check(services && typeof services.programs?.getProgram === 'function' && services.cost &&
    typeof services.costBinding === 'function' && typeof services.sourceAttestor === 'function' &&
    services.dispatcher && typeof services.dispatcher.claim === 'function' &&
    typeof services.dispatcher.finish === 'function' && typeof services.dispatcher.readCommitted === 'function' &&
    typeof services.dispatcher.commitEffect === 'function' && services.closure, 'all trusted services required');
  check(services.cardPlayOrder !== 'chain-first-v3' && services.cardPlayOrder !== 'showdown-focus-chain-first-v3' || typeof services.costForChain === 'function',
    'Chain-first mode requires a trusted current-head cost authority');
  check(!services.pointDamageSpellV1 || services.cardPlayOrder === 'chain-first-v3',
    'Point Spell requires explicit Chain-first mode');
  check(!canonicalOwners.has(commandSession), 'command session already has a Spell action branch');
  const match = commandSession.match as DuelCanonicalPlayingStateV2;
  const showdownFocus = services.cardPlayOrder === 'showdown-focus-chain-first-v3';
  check(commandSession.match.stage === 'playing' && commandSession.match.frame.phase === 'main' &&
    commandSession.match.frame.stateOpen && commandSession.match.frame.pendingPayment === null,
    showdownFocus ? 'Showdown Spell action requires an open state' : 'Spell action requires Main and open state');
  if (showdownFocus) {
    const focus = services.showdownFocus;
    const field = focus && match.board.battlefields.find(value => value.locationId === focus.fieldId);
    check(focus && field && (field.showdown === 'active' || field.combat === 'active') &&
      match.frame.focusPlayerId === focus.returnFocusPlayerId &&
      match.frame.priorityPlayerId === focus.returnFocusPlayerId,
    'Showdown Spell action requires the admitted Focus owner and active Showdown');
  }
  check(commandSession.requiredTasks.every(task => task.status === 'completed') &&
    commandSession.priorityPayments.every(payment => payment.status === 'completed'), 'outstanding task/session');
  commitDuelCommandMutationV2(commandSession, draft => ({ match: draft, transitions: [] }));
  check(!match.chainCards?.length, 'existing physical Chain requires the shared Chain owner');
  const players = match.roster.map(seat => seat.playerId);
  const committed = new Map<string, DuelSpellCommittedEffectV2>();
  const chainReceipt = (receipt: DuelSpellCommittedEffectV2): DuelChainCommittedReceiptV2 => ({
    status: receipt.status, idempotencyKey: receipt.idempotencyKey,
    chainId: receipt.chainId, itemId: receipt.itemId, executorId: receipt.executorId,
    ...(receipt.produced ? { produced: receipt.produced } : {}),
  });
  const resolutionAuthority = createDuelChainResolutionAuthorityV2(ticket => {
    const external = services.dispatcher.readCommitted(ticket);
    if (external === null) return null;
    const expected = committed.get(ticket.idempotencyKey);
    check(expected, 'receipt has no owned effect candidate');
    const value = record(external, ['status', 'idempotencyKey', 'chainId', 'itemId', 'executorId',
      'cardUID', 'effectStatus', 'matchId', 'beforeStateVersion', 'afterStateVersion'], ['produced']);
    for (const key of ['status', 'idempotencyKey', 'chainId', 'itemId', 'executorId',
      'cardUID', 'effectStatus', 'matchId', 'beforeStateVersion', 'afterStateVersion'] as const)
      check(value[key] === expected[key], 'external effect receipt business binding mismatch');
    check(value.produced === undefined || Array.isArray(value.produced) && value.produced.length === 0,
      'produced work requires the shared effect scheduler');
    return chainReceipt(expected);
  });
  // The closure above intentionally closes over this map; it is created before
  // any Chain transition and is never used as the parent command ledger.
  const chain = createDuelChainV2({ turnOrder: players, initialPriorityPlayerId: match.frame.priorityPlayerId ?? players[0]!,
    ...(services.chainId ? { chainId: services.chainId } : {}),
    ...(services.identityFactory !== undefined ? { identityFactory: services.identityFactory } : {}),
    closeContext: showdownFocus
      ? { kind: 'showdown', returnFocusPlayerId: services.showdownFocus!.returnFocusPlayerId }
      : { kind: 'main-phase', returnPriorityPlayerId: match.frame.priorityPlayerId ?? players[0]! }, resolutionAuthority });
  // Fresh real Chain lineage, fresh capability; replay uses the recorded DATA
  // identity without sharing the old executor or its committed proof authority.
  const executor = createDuelChainScopedExecutorV2(chain);
  return publish(null, commandSession, chain, services, executor, [], committed, resolutionAuthority);
}

function rejectOutcome(reason: Extract<DuelSpellCardPlayOutcomeV2, { status: 'rejected' }>['reason']): DuelSpellCardPlayOutcomeV2 {
  return { status: 'rejected', reason };
}

function chainFirstPendingOutcome(pending: PendingChainFirstCost, chain: DuelChainV2,
  reason?: string, taskIssued = false): DuelSpellCardPlayOutcomeV2 {
  return { status: 'pending', step: 'payment', cardUID: pending.cardUID, chain,
    ...(taskIssued ? { taskId: pending.taskId, paymentId: pending.paymentId } : {}),
    ...(reason ? { reason } : {}) };
}
function chainFirstReceiptPending(outcome: DuelSpellCardPlayOutcomeV2): DuelSpellCardPlayOutcomeV2 {
  check(outcome.status === 'pending', 'Chain-first receipt must remain pending');
  return { ...outcome, reason: 'command-receipt-unconfirmed' };
}

function assertChainFirstHead(session: DuelSpellCardPlaySessionV2,
  pending: PendingChainFirstCost): PhysicalSpellBinding {
  const match = session.commandSession.match as DuelCanonicalPlayingStateV2;
  check(match.stateVersion === pending.stateVersion, 'Chain-first Core head advanced during preparation');
  check(session.chain.stateVersion === pending.chainVersion && session.chain.items.length > 0,
    'Chain-first Chain head advanced during preparation');
  const itemId = claimKey(pending.actor, pending.commandId);
  const itemIndex = session.chain.items.findIndex(item => item.id === itemId);
  check(itemIndex === session.chain.items.length - 1, 'Chain-first bound item is not the current native head');
  const item = session.chain.items[itemIndex];
  check(item !== undefined, 'Chain-first bound item is missing');
  check(item.controllerPlayerId === pending.actor && item.status === 'pending' &&
    item.resolutionMode === 'fepr', 'Chain-first bound item drifted');
  check(session.chain.items.slice(0, itemIndex).every(prefix => prefix.status === 'finalized'),
    'Chain-first Chain prefix contains an unfinalized foreign item');
  const chainCards = match.chainCards ?? [];
  check(chainCards.length === session.chain.items.length &&
    chainCards.at(-1)?.uid === pending.cardUID,
    'Chain-first physical Chain head drifted');
  const bindings = stateOf(session).bindings;
  check(session.chain.items.every((chainItem, index) => {
    const bound = bindings.get(chainItem.id), physicalCard = chainCards[index];
    return bound !== undefined && physicalCard?.uid === bound.uid &&
      bound.controller === chainItem.controllerPlayerId;
  }), 'Chain-first physical prefix binding drifted');
  const physical = match.physicalCardsByUID[pending.cardUID];
  check(physical && physical.zoneEpoch === pending.sourceEpoch, 'Chain-first source epoch drifted');
  const binding = stateOf(session).bindings.get(claimKey(pending.actor, pending.commandId));
  check(binding && binding.uid === pending.cardUID && binding.epoch === pending.sourceEpoch,
    'Chain-first physical binding missing');
  if (pending.targetError) check(false, 'Chain-first target choice is permanently unproved');
  assertCapturedTargets(match, binding);
  return binding;
}

/** Run the Chain-first cost/binding stage. The same pending record carries the
 * actual Chain head and a successful resolved-cost proof, so retries never
 * invoke the cost resolver twice or manufacture a zero-cost task. */
function prepareChainFirstPaymentV3(session: DuelSpellCardPlaySessionV2,
  pending: PendingChainFirstCost, initial?: Readonly<{
    readonly claim: unknown; readonly request: DuelSpellCommandClaimV2;
    readonly fingerprint: string;
  }>): DuelSpellCardPlayResultV2 {
  let current = session;
  let saved = pending;
  try {
    let state = stateOf(current);
    const binding = assertChainFirstHead(current, saved);
    const match = current.commandSession.match as DuelCanonicalPlayingStateV2;
    const targets = saved.targets === null ? null :
      Object.freeze(saved.targets.map(reference => reference.uid));
    let resolved = saved.resolved;
    if (!resolved) {
      const baseAuthority = state.services.cost;
      const lifecycleRequest = Object.freeze({
        commandSession: current.commandSession,
        match,
        chain: current.chain,
        cardUID: binding.uid,
        cardId: binding.cardId,
        controller: binding.controller,
        sourceEpoch: binding.epoch,
        targetUIDs: targets,
        transactionId: saved.transactionId,
        authority: baseAuthority,
      });
      registerChainFirstLifecycleProof(lifecycleRequest, current.commandSession, match,
        current.chain, claimKey(saved.actor, saved.commandId));
      const authority = state.services.costForChain!(lifecycleRequest);
      check(authority && typeof authority === 'object', 'Chain-first cost authority required');
      resolved = resolveDuelTotalCostV2(authority, {
        transactionId: saved.transactionId, subjectId: binding.cardId, kind: 'card-play' });
      check(!state.guard.poisoned, 'reentered Chain-first cost provider');
      const lifecycle = inspectDuelSpellChainFirstLifecycleProofV3(lifecycleRequest);
      check(lifecycle, 'Chain-first lifecycle proof lost before resolution');
      chainFirstResolvedProofs.set(lifecycleRequest, Object.freeze({
        kind: 'duel-spell-chain-first-resolved-proof-v3', lifecycle, authority, resolved }));
      saved = Object.freeze({ ...saved, resolved });
      current = publish(current, current.commandSession, current.chain, state.services, state.executor,
        current.receipts, state.committed, state.resolutionAuthority, undefined, undefined, undefined, saved);
      state = stateOf(current);
    }
    if (!saved.bindingComplete) {
      const boundRequest: DuelSpellCostBindingV2 = { matchId: match.matchId,
        stateVersion: match.stateVersion, actor: binding.controller, uid: binding.uid,
        cardId: binding.cardId, sourceEpoch: binding.epoch, transactionId: saved.transactionId,
        baseProofId: resolved.baseProofId, coverageProofId: resolved.coverageProofId };
      const bound = state.services.costBinding(boundRequest);
      check(bound.status === 'complete' && Object.keys(boundRequest).every(key =>
        bound[key as keyof DuelSpellCostBindingV2] === boundRequest[key as keyof DuelSpellCostBindingV2]),
      'Chain-first cost binding');
      saved = Object.freeze({ ...saved, bindingComplete: true });
      check(!state.guard.poisoned, 'reentered Chain-first binding provider');
      current = publish(current, current.commandSession, current.chain, state.services, state.executor,
        current.receipts, state.committed, state.resolutionAuthority, undefined, undefined, undefined, saved);
      state = stateOf(current);
    }
    const task: DuelRequiredCostTaskV2 = {
      matchId: match.matchId, expectedVersion: match.stateVersion,
      taskId: saved.taskId, paymentId: saved.paymentId, actor: binding.controller,
      finalResolvedCost: resolved.finalResolvedCost,
      opaqueSource: sourceReference(binding.cardId, binding.uid),
      continuationId: `spell-cont:${claimKey(binding.controller, saved.commandId)}`,
    };
    const sourceAttestor = guardedSourceAttestor(state);
    const issued = issueDuelRequiredCostTaskV2(current.commandSession, task, sourceAttestor);
    check(!state.guard.poisoned, 'reentered Chain-first required-task provider');
    const pendingCost: PendingCost = { actor: binding.controller, cardUID: binding.uid,
      commandId: saved.commandId, taskId: task.taskId, paymentId: task.paymentId,
      authority: issued.authority, cost: resolved.finalResolvedCost };
    let issuedSession = publish(current, issued.session, current.chain, state.services, state.executor,
      current.receipts, state.committed, state.resolutionAuthority, pendingCost);
    try {
      const prepared = prepareDuelRequiredCostPaymentV2(issuedSession.commandSession,
        issued.authority, sourceAttestor);
      check(!state.guard.poisoned, 'reentered Chain-first payment provider');
      issuedSession = publish(issuedSession, prepared.session, issuedSession.chain, state.services,
        state.executor, issuedSession.receipts, state.committed, state.resolutionAuthority, pendingCost);
    } catch {
      const outcome = chainFirstPendingOutcome(saved, issuedSession.chain, 'source-proof-pending', true);
      if (!initial) return output(issuedSession, outcome, false, true);
      const stateAfter = stateOf(issuedSession);
      const spellReceipt = Object.freeze({ actor: initial.request.actor, commandId: initial.request.commandId,
        payloadFingerprint: initial.fingerprint, outcome });
      const confirmed = finishClaim(stateAfter, initial.claim, outcome, true);
      const next = publish(issuedSession, issuedSession.commandSession, issuedSession.chain,
        stateAfter.services, stateAfter.executor, confirmed ? [...issuedSession.receipts, spellReceipt] :
          issuedSession.receipts, stateAfter.committed, stateAfter.resolutionAuthority, pendingCost,
        undefined, confirmed ? undefined : { request: initial.request, claim: initial.claim,
          outcome, response: outcome, persistRequired: true, spellReceipt });
      return output(next, confirmed ? outcome : chainFirstReceiptPending(outcome), false, true);
    }
    const outcome = chainFirstPendingOutcome(saved, issuedSession.chain, undefined, true);
    if (!initial) return output(issuedSession, outcome, false, true);
    const stateAfter = stateOf(issuedSession);
    const spellReceipt = Object.freeze({ actor: initial.request.actor, commandId: initial.request.commandId,
      payloadFingerprint: initial.fingerprint, outcome });
    const confirmed = finishClaim(stateAfter, initial.claim, outcome, true);
    const next = publish(issuedSession, issuedSession.commandSession, issuedSession.chain,
      stateAfter.services, stateAfter.executor, confirmed ? [...issuedSession.receipts, spellReceipt] :
        issuedSession.receipts, stateAfter.committed, stateAfter.resolutionAuthority, pendingCost,
      undefined, confirmed ? undefined : { request: initial.request, claim: initial.claim,
        outcome, response: outcome, persistRequired: true, spellReceipt });
    return output(next, confirmed ? outcome : chainFirstReceiptPending(outcome), false, true);
  } catch {
    const state = stateOf(current);
    const outcome = chainFirstPendingOutcome(saved, current.chain, saved.targetError ?
      'target-proof-pending' : 'cost-proof-pending');
    if (!initial) return output(current, outcome, false, current !== session);
    const confirmed = finishClaim(state, initial.claim, outcome, true);
    const spellReceipt = Object.freeze({ actor: initial.request.actor, commandId: initial.request.commandId,
      payloadFingerprint: initial.fingerprint, outcome });
    const next = publish(current, current.commandSession, current.chain, state.services, state.executor,
      confirmed ? [...current.receipts, spellReceipt] : current.receipts, state.committed,
      state.resolutionAuthority, undefined, undefined, confirmed ? undefined : {
        request: initial.request, claim: initial.claim, outcome, response: outcome,
        persistRequired: true, spellReceipt }, saved);
    return output(next, confirmed ? outcome : chainFirstReceiptPending(outcome), false, true);
  }
}

function playDuelSpellCardChainFirstV3(session: DuelSpellCardPlaySessionV2, state: PrivateState,
  actor: string, envelope: DuelSpellCardPlayEnvelopeV2, fp: string, claimToken: unknown,
  effect: Parameters<typeof captureTargets>[2],
  card: { readonly uid: string; readonly cardId: string },
  reference: ReturnType<typeof referenceDuelPhysicalCardV2>): DuelSpellCardPlayResultV2 {
  const itemId = claimKey(actor, envelope.commandId);
  const chain = appendDuelChainItemV2(session.chain, { actor, expectedVersion: session.chain.stateVersion,
    item: { id: itemId, kind: `spell:${effect.kind}`, controllerPlayerId: actor, resolutionMode: 'fepr' },
    executor: state.executor });
  const moved = moveDuelPhysicalCardToChainV2(session.commandSession.match as DuelCanonicalPlayingStateV2,
    reference, actor);
  const movedSession = syncChainFrame(advanceDuelCommandSessionNativeV2(session.commandSession, moved).session, chain);
  const movedAction = publish(session, movedSession, chain, state.services, state.executor,
    session.receipts, state.committed, state.resolutionAuthority);
  const movedMatch = movedSession.match as DuelCanonicalPlayingStateV2;
  const movedRef = referenceDuelPhysicalCardV2(moved, card.uid);
  let targets: PhysicalSpellBinding['targets'] = null;
  try { targets = captureTargets(movedMatch, actor, effect, envelope.command.targetUIDs); }
  catch {
    const pending: PendingChainFirstCost = Object.freeze({ actor, cardUID: card.uid, cardId: card.cardId,
      commandId: envelope.commandId, transactionId: JSON.stringify([movedMatch.matchId,
        movedMatch.stateVersion, actor, envelope.commandId, card.uid, movedRef.zoneEpoch]),
      sourceEpoch: movedRef.zoneEpoch, stateVersion: movedMatch.stateVersion,
      chainVersion: chain.stateVersion, taskId: `spell-task:${itemId}`,
      paymentId: `spell-payment:${itemId}`, targets: null, targetError: true });
    state.bindings.set(itemId, Object.freeze({ uid: card.uid, cardId: card.cardId, controller: actor,
      epoch: movedRef.zoneEpoch, effectName: effect.kind, claim: claimToken, targets: null }));
    const request = { actor, commandId: envelope.commandId, payloadFingerprint: fp,
      expectedVersion: envelope.expectedVersion, kind: 'spell' as const };
    return prepareChainFirstPaymentV3(movedAction, pending, { claim: claimToken, request, fingerprint: fp });
  }
  const targetUIDs = targets?.map(value => value.uid) ?? null;
  const pending: PendingChainFirstCost = Object.freeze({ actor, cardUID: card.uid, cardId: card.cardId,
    commandId: envelope.commandId, transactionId: JSON.stringify([movedMatch.matchId, movedMatch.stateVersion,
      actor, envelope.commandId, card.uid, movedRef.zoneEpoch, targetUIDs]), sourceEpoch: movedRef.zoneEpoch,
    stateVersion: movedMatch.stateVersion, chainVersion: chain.stateVersion,
    taskId: `spell-task:${itemId}`, paymentId: `spell-payment:${itemId}`, targets });
  state.bindings.set(itemId, Object.freeze({ uid: card.uid, cardId: card.cardId, controller: actor,
    epoch: movedRef.zoneEpoch, effectName: effect.kind, claim: claimToken, targets }));
  const request = { actor, commandId: envelope.commandId, payloadFingerprint: fp,
    expectedVersion: envelope.expectedVersion, kind: 'spell' as const };
  return prepareChainFirstPaymentV3(movedAction, pending, { claim: claimToken, request, fingerprint: fp });
}

/** Move a genuine Spell to the Chain, append the actual FEPR item and install a
 * source-bound required-cost task/payment window. */
export function playDuelSpellCardV2(session: DuelSpellCardPlaySessionV2, actor: string,
  rawEnvelope: DuelSpellCardPlayEnvelopeV2): DuelSpellCardPlayResultV2 {
  const state = active(session);
  state.guard.busy = true; state.guard.poisoned = false;
  let claimToken: unknown;
  let ownsClaim = false;
  let progressed: { commandSession: DuelCommandSessionV2; chain: DuelChainV2; cost: PendingCost;
    fp: string } | undefined;
  try {
    let envelope: DuelSpellCardPlayEnvelopeV2;
    try { envelope = parseEnvelope(rawEnvelope); } catch { return output(session, rejectOutcome('invalid-command')); }
    const fp = fingerprint(envelope);
    const claimRequest = { actor, commandId: envelope.commandId, payloadFingerprint: fp,
      expectedVersion: envelope.expectedVersion, kind: 'spell' as const };
    const recovery = recoverReceipt(session, claimRequest);
    if (recovery) return recovery;
    const claimed = claim(state, claimRequest);
    if (claimed.status === 'duplicate') return output(session, claimed.outcome ??
      { status: 'blocked', reason: 'outstanding-task-or-session' }, true);
    if (claimed.status === 'conflict') return output(session, rejectOutcome('command-conflict'));
    if (claimed.status === 'blocked') return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    claimToken = claimed.claim ?? claimed; ownsClaim = true;
    if (state.pendingCost || state.pendingEffect || state.pendingChainFirst) {
      const outcome: DuelSpellCardPlayOutcomeV2 = { status: 'blocked', reason: 'outstanding-task-or-session' };
      finishClaim(state, claimToken, outcome, true); return output(session, outcome, false, true);
    }
    const match = session.commandSession.match as DuelCanonicalPlayingStateV2;
    if (!match.roster.some(seat => seat.playerId === actor)) {
      const outcome = rejectOutcome('unknown-actor'); finishClaim(state, claimToken, outcome, false); return output(session, outcome);
    }
    if (envelope.expectedVersion !== match.stateVersion) {
      const outcome = rejectOutcome('stale-version'); finishClaim(state, claimToken, outcome, true); return output(session, outcome, false, true);
    }
    const showdownFocus = state.services.cardPlayOrder === 'showdown-focus-chain-first-v3';
    const responseWindow = !match.frame.stateOpen && !session.chain.stateOpen && session.chain.phase === 'execute';
    if (match.frame.phase !== 'main' || (!match.frame.stateOpen && !responseWindow)) {
      const outcome = rejectOutcome('invalid-phase'); finishClaim(state, claimToken, outcome, true); return output(session, outcome, false, true);
    }
    if (match.frame.priorityPlayerId !== actor || (!responseWindow && !showdownFocus && match.frame.turnPlayerId !== actor) ||
        (showdownFocus && !responseWindow && match.frame.focusPlayerId !== actor)) {
      const outcome = rejectOutcome('no-permission'); finishClaim(state, claimToken, outcome, true); return output(session, outcome, false, true);
    }
    check(session.chain.priorityPlayerId === actor && (responseWindow || session.chain.items.length === 0),
      'another Chain item is active');
    const player = match.players.find(value => value.playerId === actor)!;
    const card = player.hand.find(value => value.uid === envelope.command.cardUID);
    check(card && player.hand.filter(value => value.uid === envelope.command.cardUID).length === 1, 'Spell UID absent from own hand');
    const physical = match.physicalCardsByUID[card.uid];
    check(physical && physical.ownerPlayerId === actor && physical.cardId === card.cardId, 'Spell physical binding');
    const reference = referenceDuelPhysicalCardV2(match, card.uid);
    assertCurrentDuelPhysicalReferenceV2(match, reference);
    const program = state.services.programs.getProgram(card.cardId);
    check(program && program.cardId === card.cardId && program.source.cardType === 'Spell' &&
      program.source.dataVersion === match.dataVersion && program.source.sourceCatalogDigest === match.catalogDigest &&
      (program.semantics.kind === 'spell-resolution' ||
        state.services.pointDamageSpellV1 === true && state.services.cardPlayOrder === 'chain-first-v3' &&
        program.semantics.kind === 'point-damage-spell-resolution' &&
        program.semantics.effects[0]?.kind === 'point-damage') &&
      program.semantics.effects.length === 1, 'resolved Spell program required');
    const local = queryDuelSourceProgramPhaseScope(state.services.programs, card.cardId, 'main',
      state.services.programs.reference(card.cardId));
    check(local.sourceProgramComplete === true, 'genuine whole Spell program required');
    if (showdownFocus && !responseWindow &&
        (program.semantics.kind !== 'spell-resolution' || program.semantics.permission !== 'reaction') &&
        !program.source.normalizedAbilityText.startsWith('[Action]')) {
      const outcome = rejectOutcome('no-permission');
      finishClaim(state, claimToken, outcome, true); return output(session, outcome, false, true);
    }
    if (responseWindow && (program.semantics.kind !== 'spell-resolution' ||
        program.semantics.permission !== 'reaction')) {
      const outcome = rejectOutcome('no-permission');
      finishClaim(state, claimToken, outcome, true); return output(session, outcome, false, true);
    }
    if (state.services.cardPlayOrder === 'chain-first-v3' || showdownFocus) {
      check(!state.pendingChainFirst, 'outstanding Chain-first preparation');
      const effect = program.semantics.effects[0];
      // Admission-only validation: reject a malformed/illegal submitted selection without
      // moving a card. No references from this read are retained as choices; the actual
      // choice binding is captured again at the post-move Chain head below.
      try { captureTargets(match, actor, effect, envelope.command.targetUIDs); }
      catch {
        const outcome = rejectOutcome('illegal-target');
        finishClaim(state, claimToken, outcome, true);
        return output(session, outcome, false, true);
      }
      return playDuelSpellCardChainFirstV3(session, state, actor, envelope, fp, claimToken,
        effect, card, reference);
    }
    const effect = program.semantics.effects[0];
    let targets: PhysicalSpellBinding['targets'];
    try { targets = captureTargets(match, actor, effect, envelope.command.targetUIDs); }
    catch {
      const outcome = rejectOutcome('illegal-target');
      finishClaim(state, claimToken, outcome, true); return output(session, outcome, false, true);
    }
    const transactionId = JSON.stringify([match.matchId, match.stateVersion, actor, envelope.commandId,
      card.uid, reference.zoneEpoch]);
    const resolved = resolveDuelTotalCostV2(state.services.cost, { transactionId, subjectId: card.cardId, kind: 'card-play' });
    const boundRequest: DuelSpellCostBindingV2 = { matchId: match.matchId, stateVersion: match.stateVersion,
      actor, uid: card.uid, cardId: card.cardId, sourceEpoch: reference.zoneEpoch, transactionId,
      baseProofId: resolved.baseProofId, coverageProofId: resolved.coverageProofId };
    const bound = state.services.costBinding(boundRequest);
    check(bound.status === 'complete' && Object.keys(boundRequest).every(key => bound[key as keyof DuelSpellCostBindingV2] === boundRequest[key as keyof DuelSpellCostBindingV2]), 'Spell cost binding');
    check(!state.guard.poisoned && match.stateVersion < Number.MAX_SAFE_INTEGER && reference.zoneEpoch < Number.MAX_SAFE_INTEGER,
      'reentered or overflowing Spell play');
    const itemId = claimKey(actor, envelope.commandId);
    const chain = appendDuelChainItemV2(session.chain, { actor, expectedVersion: session.chain.stateVersion,
      item: { id: itemId, kind: `spell:${effect.kind}`, controllerPlayerId: actor,
        resolutionMode: 'fepr' }, executor: state.executor });
    const moved = moveDuelPhysicalCardToChainV2(match, reference, actor);
    const movedSession = syncChainFrame(advanceDuelCommandSessionNativeV2(session.commandSession, moved).session, chain);
    const closedMatch = movedSession.match as DuelCanonicalPlayingStateV2;
    const movedRef = referenceDuelPhysicalCardV2(moved, card.uid);
    const opaqueSource = sourceReference(card.cardId, card.uid);
    const task: DuelRequiredCostTaskV2 = { matchId: closedMatch.matchId, expectedVersion: closedMatch.stateVersion,
      taskId: `spell-task:${itemId}`, paymentId: `spell-payment:${itemId}`,
      actor, finalResolvedCost: resolved.finalResolvedCost, opaqueSource, continuationId: `spell-cont:${itemId}` };
    const pendingCost: PendingCost = { actor, cardUID: card.uid, commandId: envelope.commandId,
      taskId: task.taskId, paymentId: task.paymentId, cost: resolved.finalResolvedCost };
    state.bindings.set(itemId, Object.freeze({ uid: card.uid, cardId: card.cardId,
      controller: actor, epoch: movedRef.zoneEpoch, effectName: effect.kind, claim: claimToken, targets }));
    progressed = { commandSession: movedSession, chain, cost: pendingCost, fp };
    const sourceAttestor = guardedSourceAttestor(state);
    const issued = issueDuelRequiredCostTaskV2(movedSession, task, sourceAttestor);
    progressed = { ...progressed, commandSession: issued.session, cost: { ...pendingCost, authority: issued.authority } };
    const prepared = prepareDuelRequiredCostPaymentV2(issued.session, issued.authority, sourceAttestor);
    check(!state.guard.poisoned, 'reentered Spell payment');
    const outcome: DuelSpellCardPlayOutcomeV2 = { status: 'pending', step: 'payment', cardUID: card.uid,
      taskId: task.taskId, paymentId: task.paymentId, chain };
    const spellReceipt = Object.freeze({ actor, commandId: envelope.commandId, payloadFingerprint: fp, outcome });
    const confirmed = finishClaim(state, claimToken, outcome, true);
    const next = publish(session, prepared.session, chain, state.services, state.executor,
      confirmed ? [...session.receipts, spellReceipt] : session.receipts, state.committed, state.resolutionAuthority,
      { ...pendingCost, authority: issued.authority }, undefined,
      confirmed ? undefined : { request: claimRequest, claim: claimToken, outcome, response: outcome,
        persistRequired: true, spellReceipt });
    if (!confirmed) return output(next, { ...outcome, reason: 'command-receipt-unconfirmed' }, false, true);
    return output(next, outcome, false, true);
  } catch {
    if (progressed) {
      const outcome: DuelSpellCardPlayOutcomeV2 = { status: 'pending', step: 'payment', cardUID: progressed.cost.cardUID,
        taskId: progressed.cost.taskId, paymentId: progressed.cost.paymentId, chain: progressed.chain, reason: 'cost-proof-pending' };
      const request = { actor, commandId: progressed.cost.commandId, payloadFingerprint: progressed.fp,
        expectedVersion: rawEnvelope.expectedVersion, kind: 'spell' as const };
      const spellReceipt = Object.freeze({ actor, commandId: progressed.cost.commandId,
        payloadFingerprint: progressed.fp, outcome });
      const confirmed = finishClaim(state, claimToken, outcome, true);
      const next = publish(session, progressed.commandSession, progressed.chain, state.services, state.executor,
        confirmed ? [...session.receipts, spellReceipt] : session.receipts,
        state.committed, state.resolutionAuthority, progressed.cost, undefined,
        confirmed ? undefined : { request, claim: claimToken, outcome, response: outcome,
          persistRequired: true, spellReceipt });
      return output(next, confirmed ? outcome : { ...outcome, reason: 'command-receipt-unconfirmed' }, false, true);
    }
    const outcome: DuelSpellCardPlayOutcomeV2 = { status: 'blocked', reason: state.guard.poisoned ? 'reentrant-command' : 'cost-unproved' };
    if (ownsClaim) finishClaim(state, claimToken, outcome, false);
    return output(session, outcome);
  } finally { state.guard.busy = false; }
}

/** Forward only the typed resource commands accepted by the canonical V2
 * resource kernel.  Main JSON/action blobs cannot enter through this API. */
export function applyDuelSpellResourceCommandV2(session: DuelSpellCardPlaySessionV2, actor: string,
  envelope: DuelCommandEnvelopeV2): DuelSpellCardPlayResultV2 {
  const state = active(session); state.guard.busy = true; state.guard.poisoned = false;
  let claimToken: unknown, ownsClaim = false;
  try {
    const parsed = record(envelope, ['commandId', 'expectedVersion', 'command']);
    id(parsed.commandId, 'resource command ID'); version(parsed.expectedVersion);
    const body = record(parsed.command, ['type'], ['uid', 'paymentId', 'plan', 'selectedUIDs']);
    check(['mulligan', 'rune-energy', 'rune-power', 'gold-power', 'pay-pending'].includes(String(body.type)), 'typed resource command required');
    if (Object.hasOwn(body, 'uid')) id(body.uid, 'resource UID');
    if (Object.hasOwn(body, 'paymentId')) id(body.paymentId, 'payment ID');
    if (Object.hasOwn(body, 'plan')) parseEnvelope({ commandId: 'plan-validation', expectedVersion: 0,
      command: { cardUID: 'plan-validation', paymentPlan: body.plan } });
    if (Object.hasOwn(body, 'selectedUIDs')) {
      check(Array.isArray(body.selectedUIDs) && Object.getPrototypeOf(body.selectedUIDs) === Array.prototype &&
        Reflect.ownKeys(body.selectedUIDs).length === body.selectedUIDs.length + 1, 'dense mulligan list');
      body.selectedUIDs.forEach(value => id(value, 'selected UID'));
    }
    check(!state.guard.poisoned, 'reentered resource input');
    const claimRequest = { actor, commandId: envelope.commandId, expectedVersion: envelope.expectedVersion,
      kind: 'resource' as const, payloadFingerprint: JSON.stringify(['resource', envelope.expectedVersion, body]) };
    const recovery = recoverReceipt(session, claimRequest);
    if (recovery) return recovery;
    if (state.pendingEffect || state.pendingChainFirst || state.pendingCost && !state.pendingCost.authority)
      return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    const claimed = claim(state, claimRequest);
    if (claimed.status === 'conflict') return output(session, rejectOutcome('command-conflict'));
    if (claimed.status === 'duplicate') return output(session, claimed.outcome ?? { status: 'blocked', reason: 'outstanding-task-or-session' }, true);
    if (claimed.status !== 'new') return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    claimToken = claimed.claim ?? claimed; ownsClaim = true;
    if (!state.services.sourceAttestor) return output(session, { status: 'blocked', reason: 'source-unproved' });
    const result = applyDuelResourceCommandV2(session.commandSession, actor, envelope,
      { sourceAttestor: guardedSourceAttestor(state) });
    const pending = state.pendingCost;
    const paymentCompleted = pending !== undefined && result.outcome.status === 'applied' &&
      result.outcome.paymentCompleted?.paymentId === pending.paymentId;
    const response: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2 = !result.persistRequired || !pending ||
      result.outcome.status !== 'applied' ? result.outcome : paymentCompleted
      ? { status: 'pending', step: 'priority', cardUID: pending.cardUID, chain: session.chain }
      : { status: 'pending', step: 'payment', cardUID: pending.cardUID, taskId: pending.taskId,
        paymentId: pending.paymentId, chain: session.chain };
    const confirmed = finishClaim(state, claimToken, result.outcome, result.persistRequired);
    if (!result.persistRequired && confirmed) return output(session, result.outcome, result.duplicate);
    const next = publish(session, result.session, session.chain, state.services, state.executor, session.receipts,
      state.committed, state.resolutionAuthority, paymentCompleted ? undefined : pending, undefined,
      confirmed ? undefined : { request: claimRequest, claim: claimToken, outcome: result.outcome,
        response, persistRequired: result.persistRequired });
    if (!confirmed) return output(next, { status: 'blocked', reason: 'outstanding-task-or-session' }, false, true);
    return output(next, response, false, true);
  } catch {
    const outcome: DuelSpellCardPlayOutcomeV2 = { status: 'blocked', reason: 'cost-unproved' };
    if (ownsClaim) finishClaim(state, claimToken, outcome, false);
    return output(session, outcome);
  }
  finally { state.guard.busy = false; }
}

function chainTransition(session: DuelSpellCardPlaySessionV2, chain: DuelChainV2): DuelSpellCardPlaySessionV2 {
  const state = stateOf(session);
  return publish(session, syncChainFrame(session.commandSession, chain), chain, state.services, state.executor, session.receipts,
    state.committed, state.resolutionAuthority, state.pendingCost);
}
export function finalizeDuelSpellCardPlayV2(session: DuelSpellCardPlaySessionV2, actor: string): DuelSpellCardPlayResultV2 {
  const state = active(session); state.guard.busy = true; state.guard.poisoned = false;
  try {
    if (state.pendingReceipt || state.pendingEffect || state.pendingChainFirst)
      return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    check(!state.pendingCost && session.commandSession.match.stage === 'playing' &&
      session.commandSession.match.frame.pendingPayment === null &&
      session.commandSession.requiredTasks.every(task => task.status === 'completed') &&
      session.commandSession.priorityPayments.every(payment => payment.status === 'completed'),
    'payment must complete before finalize');
    const pending = session.chain.items.find(item => item.status === 'pending');
    const binding = pending && state.bindings.get(pending.id);
    check(binding, 'Finalize needs the original Spell choices');
    assertCapturedTargets(session.commandSession.match as DuelCanonicalPlayingStateV2, binding);
    const chain = finalizeDuelChainItemV2(session.chain, { actor, expectedVersion: session.chain.stateVersion });
    const next = chainTransition(session, chain);
    return output(next, { status: 'pending', step: 'priority', cardUID: binding.uid, chain }, false, true);
  } catch { return output(session, { status: 'blocked', reason: 'chain-unproved' }); }
  finally { state.guard.busy = false; }
}
export function passDuelSpellPriorityV2(session: DuelSpellCardPlaySessionV2, actor: string): DuelSpellCardPlayResultV2 {
  const state = active(session); state.guard.busy = true; state.guard.poisoned = false;
  try {
    if (state.pendingReceipt || state.pendingEffect || state.pendingChainFirst)
      return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    const chain = passDuelChainPriorityV2(session.chain, { actor, expectedVersion: session.chain.stateVersion });
    const next = chainTransition(session, chain);
    return output(next, { status: 'pending', step: chain.phase === 'resolve' ? 'effect' : 'priority',
      cardUID: state.bindings.get(chain.items.at(-1)?.id ?? '')?.uid ?? '', chain }, false, true);
  } catch { return output(session, { status: 'blocked', reason: 'chain-unproved' }); }
  finally { state.guard.busy = false; }
}

function effectSource(state: PrivateState, match: DuelCanonicalPlayingStateV2, ticket: DuelChainResolutionTicketV2,
  uid: string): DuelDrawEffectSourceV2 & DuelKillDamageEffectSourceV2 {
  const source = sourceFor(match, uid, `${ticket.item.id}:effect`);
  check(source.controllerPlayerId === ticket.item.controllerPlayerId, 'effect actor binding');
  return source;
}
function retainEffect(session: DuelSpellCardPlaySessionV2, pending: PendingEffect,
  reason: string): DuelSpellCardPlayResultV2 {
  const state = stateOf(session);
  const next = publish(session, pending.closed?.session ?? pending.candidate?.session ?? session.commandSession,
    pending.closed?.chain ?? session.chain,
    state.services, state.executor, session.receipts, state.committed, state.resolutionAuthority,
    state.pendingCost, pending);
  return output(next, { status: 'pending', step: pending.effectName === 'each-player-kills-unit' && !pending.candidate ? 'target' : 'effect',
    cardUID: pending.cardUID, chain: next.chain, reason }, false, true);
}

function commitEffectCandidate(session: DuelSpellCardPlaySessionV2, pending: PendingEffect): DuelSpellCardPlayResultV2 {
  const state = stateOf(session), candidate = pending.candidate;
  check(candidate, 'owned effect candidate required');
  state.committed.set(pending.ticket.idempotencyKey, candidate.receipt); // Expected business facts only, never a committed fallback.
  let continued = pending;
  try {
    if (!continued.closed) {
      let proof = queryDuelChainCommittedProofV2(state.resolutionAuthority, pending.ticket);
      if (!proof) {
        state.services.dispatcher.commitEffect({ ticket: pending.ticket, receipt: candidate.receipt, session: candidate.session });
        proof = queryDuelChainCommittedProofV2(state.resolutionAuthority, pending.ticket);
      }
      if (!proof) return retainEffect(session, pending, 'external-receipt-pending');
      const chain = commitDuelChainResolutionV2(session.chain, { expectedVersion: session.chain.stateVersion,
        ticket: pending.ticket, proof });
      // Retain the successor immediately: a failure in frame/command receipt
      // publication must not return an already consumed Chain capability.
      continued = { ...continued, closed: { chain, session: candidate.session, proof,
        notificationAcknowledged: false } };
    }
    const closed = continued.closed!;
    const canonical = syncChainFrame(closed.session, closed.chain);
    continued = { ...continued, closed: { ...closed, session: canonical } };
    const binding = state.bindings.get(pending.ticket.itemId);
    check(binding, 'owned original claim missing');
    const canonicalClosed = continued.closed!;
    if (!canonicalClosed.notificationAcknowledged) {
      const confirmation = state.services.dispatcher.notifyCommitted?.(Object.freeze({ ticket: pending.ticket,
        proof: canonicalClosed.proof, commandSession: canonical, chain: closed.chain,
        cardUID: binding.uid, cardId: binding.cardId, controller: binding.controller,
        sourceEpoch: binding.epoch }));
      check(confirmation === undefined, 'native commit notification must confirm synchronously');
      check(!state.guard.poisoned, 'reentered native commit notification');
      continued = { ...continued, closed: { ...canonicalClosed, notificationAcknowledged: true } };
    }
    const outcome: DuelSpellCardPlayOutcomeV2 = { status: 'applied', appliedVersion: canonical.match.stateVersion,
      eventSeq: canonical.match.eventSeq, cardUID: pending.cardUID,
      effect: pending.effectName, changed: candidate.changed };
    if (!finishClaim(state, binding.claim, outcome, true)) return retainEffect(session, continued, 'command-receipt-unconfirmed');
    const next = publish(session, canonical, closed.chain, state.services, state.executor,
      session.receipts.map(receipt => claimKey(receipt.actor, receipt.commandId) === pending.ticket.itemId && receipt.actor === binding.controller
        ? Object.freeze({ ...receipt, outcome }) : receipt), state.committed, state.resolutionAuthority);
    return output(next, outcome, false, true);
  } catch { return retainEffect(session, continued, 'external-receipt-unconfirmed'); }
}

function completeEffect(session: DuelSpellCardPlaySessionV2, pending: PendingEffect,
  result: { readonly status: 'complete' | 'ended' | 'no-change' | 'countered';
    readonly state: DuelCanonicalPlayingStateV2 }): DuelSpellCardPlayResultV2 {
  const state = stateOf(session), before = session.commandSession.match;
  const withEffect = advanceDuelCommandSessionNativeV2(session.commandSession, result.state).session;
  pending.head.value = result.state;
  // Attach every actual effect commit before a fallible persistence callback.
  const trash = moveDuelChainCardToOwnerTrashV2(result.state, referenceDuelPhysicalCardV2(result.state, pending.cardUID));
  const final = advanceDuelCommandSessionNativeV2(withEffect, trash).session;
  pending.head.value = trash;
  const ticket = pending.ticket;
  const receipt: DuelSpellCommittedEffectV2 = Object.freeze({ status: 'committed', idempotencyKey: ticket.idempotencyKey,
    chainId: ticket.chainId, itemId: ticket.itemId, executorId: ticket.executorId, cardUID: pending.cardUID,
    effectStatus: result.status === 'countered' ? 'countered' : result.status === 'no-change' ? 'no-change' : 'complete',
    matchId: before.matchId,
    beforeStateVersion: before.stateVersion, afterStateVersion: final.match.stateVersion });
  const candidate = { ...pending, candidate: Object.freeze({ session: final, receipt,
    changed: result.status !== 'no-change' && result.status !== 'countered' }) };
  const next = publish(session, final, session.chain, state.services, state.executor,
    session.receipts, state.committed, state.resolutionAuthority, state.pendingCost, candidate);
  return commitEffectCandidate(next, candidate);
}

function performEffect(session: DuelSpellCardPlaySessionV2, choice?: DuelKillDamageChoiceV2): DuelSpellCardPlayResultV2 {
  const state = stateOf(session), saved = state.pendingEffect;
  check(saved, 'no pending Spell effect');
  if (saved.candidate) return commitEffectCandidate(session, saved);
  let pending = saved;
  try {
    const binding = state.bindings.get(saved.ticket.itemId);
    check(binding && binding.uid === saved.cardUID, 'Chain item has no exact physical Spell binding');
    const match = session.commandSession.match as DuelCanonicalPlayingStateV2;
    const source = effectSource(state, match, saved.ticket, binding.uid);
    check(source.cardId === binding.cardId && source.sourceZoneEpoch === binding.epoch &&
      source.controllerPlayerId === binding.controller, 'physical Spell source changed');
    let pointLocation: 'battlefield' | 'any' | undefined;
    if (binding.effectName === 'point-damage') {
      check(state.services.pointDamageSpellV1 === true && state.services.cardPlayOrder === 'chain-first-v3',
        'Point Spell opt-in missing');
      check(paidPointTask(session, saved, binding), 'Point Spell paid task missing');
      const program = state.services.programs.getProgram(binding.cardId);
      check(program?.cardId === binding.cardId && program.programId === source.programId &&
        program.source.dataVersion === source.dataVersion &&
        program.source.sourceCatalogDigest === source.catalogDigest &&
        program.semantics.kind === 'point-damage-spell-resolution' &&
        program.semantics.effects.length === 1 && program.semantics.effects[0]?.kind === 'point-damage',
      'Point Spell source program changed');
      pointLocation = program.semantics.effects[0].target.location;
      if (!pointTargetCurrent(match, binding, pointLocation)) {
        return completeEffect(session, pending, { status: 'countered', state: match });
      }
    }
    if (binding.targets !== null) {
      check(choice === undefined, 'target choice is already fixed by CardPlay');
      if (binding.effectName !== 'point-damage') assertCapturedTargets(match, binding);
    }
    let bond = saved.bond;
    let result: DuelDrawEffectResultV2 | DuelKillDamageEffectResultV2;
    let needsTargetSubmission = false;
    if (!bond) {
      if (binding.effectName === 'draw-cards') {
        check(state.services.closure.draw, 'Draw closure unavailable');
        const authority = createDuelDrawEffectAuthorityV2({ state: match, source,
          registry: state.services.programs, readHead: () => saved.head.value, ...state.services.closure.draw });
        bond = { kind: 'draw', authority };
        pending = { ...saved, bond }; state.pendingEffect = pending;
        result = beginDuelDrawEffectV2(authority);
      } else if (binding.effectName === 'point-damage') {
        check(state.services.closure.pointDamage, 'Point closure unavailable');
        const authority = createDuelPointDamageEffectAuthorityV1({ state: match, source,
          registry: state.services.programs, readHead: () => saved.head.value,
          ...state.services.closure.pointDamage,
          verifyCost: (head, effectSource) => {
            if (head !== match || !paidPointTask(session, saved, binding)) return null;
            const proof = state.services.closure.pointDamage?.verifyCost?.(head, effectSource);
            check(!state.guard.poisoned, 'reentered Point cost proof');
            return proof;
          },
          resolveDamage: request => {
            const proof = state.services.closure.pointDamage?.resolveDamage?.(request);
            check(!state.guard.poisoned, 'reentered Point damage proof');
            if (proof?.status === 'approved') {
              check(proof.resolvedMarks.every(mark => mark.responsiblePlayerId === source.controllerPlayerId),
                'Point damage player attribution changed');
            }
            return proof ?? { status: 'pending', reason: 'damage-proof-required' };
          },
          resolveLethal: request => {
            const proof = state.services.closure.pointDamage?.resolveLethal?.(request);
            check(!state.guard.poisoned, 'reentered Point lethal proof');
            return proof ?? { status: 'pending', reason: 'lethal-cleanup-proof-required' };
          },
          verifyChain: (head, effectSource, targetUIDs) => {
            if (JSON.stringify(targetUIDs) !== JSON.stringify(binding.targets?.map(reference => reference.uid)) ||
                !pointTargetCurrent(head, binding, pointLocation!)) return null;
            const proof = state.services.closure.pointDamage?.verifyChain?.(head, effectSource, targetUIDs);
            check(!state.guard.poisoned, 'reentered Point Chain proof');
            return proof ?? null;
          } });
        bond = { kind: 'point', authority };
        pending = { ...saved, bond }; state.pendingEffect = pending;
        result = beginDuelPointDamageEffectV1(authority);
        needsTargetSubmission = true;
      } else {
        check(state.services.closure.killDamage, 'Kill/Damage closure unavailable');
        const authority = createDuelKillDamageEffectAuthorityV2({ state: match, source,
          registry: state.services.programs, readHead: () => saved.head.value, ...state.services.closure.killDamage,
          verifyChain: (head, effectSource, targetUIDs) => {
            if (binding.targets !== null && JSON.stringify(targetUIDs) !==
                JSON.stringify(binding.targets.map(reference => reference.uid))) return null;
            return state.services.closure.killDamage?.verifyChain?.(head, effectSource, targetUIDs) ?? null;
          } });
        bond = { kind: 'kill', authority };
        pending = { ...saved, bond }; state.pendingEffect = pending;
        result = beginDuelKillDamageEffectV2(authority);
        needsTargetSubmission = binding.targets !== null;
      }
    } else if (bond.kind === 'draw') {
      result = bond.cursor ? resumeDuelDrawEffectV2(bond.cursor, match) : beginDuelDrawEffectV2(bond.authority);
    } else if (bond.kind === 'point') {
      check(bond.cursor && binding.targets, 'original Point cursor required');
      result = resumeDuelPointDamageEffectV1(bond.cursor, { expectedStateVersion: match.stateVersion,
        actorPlayerId: binding.controller, targetUIDs: binding.targets.map(reference => reference.uid) }, match);
    } else if (binding.targets !== null) {
      check(bond.cursor, 'original effect cursor required');
      const chosen = binding.effectName === 'kill-unit'
        ? { targetUID: binding.targets[0]!.uid }
        : { targetUIDs: binding.targets.map(reference => reference.uid) };
      result = resumeDuelKillDamageEffectV2(bond.cursor, { expectedStateVersion: match.stateVersion,
        actorPlayerId: binding.controller, ...chosen }, match);
    } else {
      if (saved.effectName === 'kill-units' && !choice) {
        result = beginDuelKillDamageEffectV2(bond.authority);
      } else {
      if (!choice || !bond.cursor) return retainEffect(session, pending, 'target-choice-pending');
      result = resumeDuelKillDamageEffectV2(bond.cursor, choice, match);
      }
    }
    if (needsTargetSubmission && result.status === 'pending' &&
        result.cursor.kind === 'duel-kill-damage-effect-cursor-v2' && binding.targets !== null) {
      const chosen = binding.effectName === 'kill-unit'
        ? { targetUID: binding.targets[0]!.uid }
        : { targetUIDs: binding.targets.map(reference => reference.uid) };
      // The executor validates the selection proof but never asks a player to
      // choose fresh targets after both priority passes.
      result = bond.kind === 'point'
        ? resumeDuelPointDamageEffectV1(result.cursor, { expectedStateVersion: match.stateVersion,
          actorPlayerId: binding.controller, ...chosen }, match)
        : resumeDuelKillDamageEffectV2(result.cursor, { expectedStateVersion: match.stateVersion,
          actorPlayerId: binding.controller, ...chosen }, match);
    }
    if (binding.effectName === 'point-damage' && result.status !== 'pending')
      check(!state.guard.poisoned, 'reentered Point closure');
    saved.head.value = result.state;
    if (result.status === 'pending') {
      const canonical = advanceDuelCommandSessionNativeV2(session.commandSession, result.state).session;
      pending = { ...pending, bond: { ...bond, cursor: result.cursor } as EffectBond };
      const next = publish(session, canonical, session.chain, state.services, state.executor,
        session.receipts, state.committed, state.resolutionAuthority, state.pendingCost, pending);
      return output(next, { status: 'pending', step: binding.effectName === 'each-player-kills-unit' ? 'target' : 'effect',
        cardUID: saved.cardUID, chain: next.chain, reason: 'effect-pending' }, false, true);
    }
    return completeEffect(session, pending, result);
  } catch { return retainEffect(session, pending, 'effect-proof-pending'); }
}

/** Lock once, then retain the exact ticket through proof/provider/storage retries. */
export function resolveDuelSpellCardPlayV2(session: DuelSpellCardPlaySessionV2,
  actor?: string): DuelSpellCardPlayResultV2 {
  const state = active(session); state.guard.busy = true; state.guard.poisoned = false;
  try {
    if (state.pendingReceipt) return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    if (state.pendingChainFirst) return output(session, { status: 'blocked', reason: 'cost-unproved' });
    if (state.pendingEffect) return performEffect(session);
    const request = requestDuelChainResolutionV2(session.chain, { expectedVersion: session.chain.stateVersion, ...(actor ? { actor } : {}) });
    const binding = state.bindings.get(request.ticket.itemId);
    check(binding, 'Chain item has no owned physical binding');
    const canonical = syncChainFrame(session.commandSession, request.chain);
    const pending: PendingEffect = { ticket: request.ticket, cardUID: binding.uid,
      effectName: binding.effectName, head: { value: canonical.match as DuelCanonicalPlayingStateV2 } };
    const next = publish(session, canonical, request.chain, state.services, state.executor,
      session.receipts, state.committed, state.resolutionAuthority, state.pendingCost, pending);
    return performEffect(next);
  } catch { return output(session, { status: 'blocked', reason: 'effect-unproved' }); }
  finally { state.guard.busy = false; }
}

export function resumeDuelSpellEffectV2(session: DuelSpellCardPlaySessionV2,
  choice?: DuelKillDamageChoiceV2): DuelSpellCardPlayResultV2 {
  const state = active(session); state.guard.busy = true; state.guard.poisoned = false;
  try {
    if (state.pendingReceipt) return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    if (!state.pendingEffect) return output(session, { status: 'blocked', reason: 'closure-unproved' });
    if (choice && state.pendingEffect && state.bindings.get(state.pendingEffect.ticket.itemId)?.targets !== null)
      return output(session, { status: 'blocked', reason: 'closure-unproved' });
    if (choice && state.pendingEffect && (choice.expectedStateVersion !== session.commandSession.match.stateVersion ||
        (state.pendingEffect.effectName === 'each-player-kills-unit'
          ? !session.commandSession.match.roster.some(seat => seat.playerId === choice.actorPlayerId)
          : choice.actorPlayerId !== state.bindings.get(state.pendingEffect.ticket.itemId)?.controller)))
      return output(session, { status: 'blocked', reason: 'closure-unproved' });
    return performEffect(session, choice);
  }
  finally { state.guard.busy = false; }
}

/** Resume only the explicit Chain-first preparation stage. A successful cost
 * resolution is cached with its proof; this API retries binding/task issuance
 * against the same physical Chain head and never chooses targets again. */
export function resumeDuelSpellChainFirstV3(session: DuelSpellCardPlaySessionV2): DuelSpellCardPlayResultV2 {
  const state = active(session); state.guard.busy = true; state.guard.poisoned = false;
  try {
    let current = session;
    if (state.pendingReceipt) {
      const recovered = recoverReceipt(session, state.pendingReceipt.request);
      if (!recovered) return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
      current = recovered.session;
      if (stateOf(current).pendingReceipt) return recovered;
    }
    const currentState = stateOf(current);
    const pending = currentState.pendingChainFirst;
    check(pending, 'no pending Chain-first preparation');
    return prepareChainFirstPaymentV3(current, pending);
  } catch {
    return output(session, { status: 'blocked', reason: 'cost-unproved' });
  } finally { state.guard.busy = false; }
}

/** Retry the protected issuance/preparation stage without moving the Spell or appending again. */
export function resumeDuelSpellPaymentV2(session: DuelSpellCardPlaySessionV2): DuelSpellCardPlayResultV2 {
  const state = active(session); state.guard.busy = true; state.guard.poisoned = false;
  let current = session;
  try {
    if (state.pendingReceipt) return output(session, { status: 'blocked', reason: 'outstanding-task-or-session' });
    if (state.pendingChainFirst) return prepareChainFirstPaymentV3(session, state.pendingChainFirst);
    const pending = state.pendingCost; check(pending, 'no pending Spell payment');
    let canonical = session.commandSession, authority = pending.authority;
    if (!authority) {
      const match = canonical.match as DuelCanonicalPlayingStateV2;
      const itemId = claimKey(pending.actor, pending.commandId);
      const binding = state.bindings.get(itemId); check(binding, 'physical payment binding missing');
      const sourceAttestor = guardedSourceAttestor(state);
      const issued = issueDuelRequiredCostTaskV2(canonical, { matchId: match.matchId, expectedVersion: match.stateVersion,
        taskId: pending.taskId, paymentId: pending.paymentId, actor: pending.actor, finalResolvedCost: pending.cost,
        opaqueSource: sourceReference(binding.cardId, binding.uid), continuationId: `spell-cont:${itemId}` }, sourceAttestor);
      canonical = issued.session; authority = issued.authority;
      current = publish(session, canonical, session.chain, state.services, state.executor,
        session.receipts, state.committed, state.resolutionAuthority, { ...pending, authority });
    }
    const saved = { ...pending, authority };
    const prepared = prepareDuelRequiredCostPaymentV2(canonical, authority, guardedSourceAttestor(state));
    const next = publish(current, prepared.session, session.chain, state.services, state.executor,
      session.receipts, state.committed, state.resolutionAuthority, saved);
    return output(next, { status: 'pending', step: 'payment', cardUID: saved.cardUID,
      taskId: saved.taskId, paymentId: saved.paymentId, chain: next.chain }, false, true);
  } catch {
    const pending = stateOf(current).pendingCost;
    return pending ? output(current, { status: 'pending', step: 'payment', cardUID: pending.cardUID,
      taskId: pending.taskId, paymentId: pending.paymentId, chain: current.chain, reason: 'source-proof-pending' }, false, current !== session)
      : output(current, { status: 'blocked', reason: 'source-unproved' });
  }
  finally { state.guard.busy = false; }
}

export function submitDuelSpellTargetV2(session: DuelSpellCardPlaySessionV2,
  choice: DuelKillDamageChoiceV2): DuelSpellCardPlayResultV2 {
  return resumeDuelSpellEffectV2(session, choice);
}

/** Private fingerprint sidecar, never a restore recipe or a public DTO. The
 * parent must additionally fingerprint its OWN dispatcher/source state; opaque
 * callbacks and native handles cannot be reconstructed from this DATA. */
export function inspectDuelSpellPrivateStateV2(session: DuelSpellCardPlaySessionV2): Readonly<{
  active: boolean; poisoned: boolean; chain: ReturnType<typeof inspectDuelChainPrivateStateV2>;
  bindings: readonly Readonly<{ itemId: string; uid: string; cardId: string; controller: string;
    epoch: number; effectName: string; claimIssued: boolean; targets: PhysicalSpellBinding['targets'] }>[];
  expectedCommittedEffects: readonly DuelSpellCommittedEffectV2[];
  pendingCost: null | Readonly<{ actor: string; cardUID: string; commandId: string; taskId: string;
    paymentId: string; cost: DuelRuneCost; authorityIssued: boolean }>;
  pendingChainFirst?: null | Readonly<{ actor: string; cardUID: string; cardId: string; commandId: string;
    transactionId: string; sourceEpoch: number; stateVersion: number; chainVersion: number;
    taskId: string; paymentId: string; targets: PhysicalSpellBinding['targets'];
    resolved: null | Readonly<{ finalResolvedCost: DuelRuneCost; baseProofId: string; coverageProofId: string }>;
    bindingComplete: boolean; targetError: boolean }>;
  pendingReceipt: null | Readonly<{ request: DuelSpellCommandClaimV2; claimIssued: boolean;
    outcome: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2;
    response: DuelSpellCardPlayOutcomeV2 | DuelCommandOutcomeV2;
    persistRequired: boolean; spellReceiptPending: boolean;
    stateVersion: number; eventSeq: number; chainVersion: number }>;
  pendingEffect: null | Readonly<{ ticketKey: string; itemId: string; cardUID: string; effectName: string;
    headVersion: number; headEventSeq: number; headIsCanonical: boolean;
    bondKind: 'draw' | 'kill' | 'point' | null; cursor: unknown; candidate: null | Readonly<{
      stateVersion: number; eventSeq: number; receipt: DuelSpellCommittedEffectV2; changed: boolean }>;
    closed: null | Readonly<{ stateVersion: number; eventSeq: number; chainVersion: number;
      proofKey: string; proofItemId: string; notificationAcknowledged: boolean }> }>;
}> {
  const state = active(session);
  const p = state.pendingEffect, c = state.pendingCost, receipt = state.pendingReceipt;
  const candidate = p?.candidate;
  const snapshot = { active: state.active, poisoned: state.guard.poisoned,
    chain: inspectDuelChainPrivateStateV2(session.chain),
    bindings: [...state.bindings].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([itemId, value]) => ({
      itemId, uid: value.uid, cardId: value.cardId, controller: value.controller,
      epoch: value.epoch, effectName: value.effectName, claimIssued: true, targets: value.targets })),
    expectedCommittedEffects: [...state.committed.values()].sort((a, b) =>
      a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0),
    pendingCost: c ? { actor: c.actor, cardUID: c.cardUID, commandId: c.commandId, taskId: c.taskId,
      paymentId: c.paymentId, cost: c.cost, authorityIssued: c.authority !== undefined } : null,
    ...(state.services.cardPlayOrder === 'chain-first-v3' || state.services.cardPlayOrder === 'showdown-focus-chain-first-v3' ? { pendingChainFirst: state.pendingChainFirst ? { actor: state.pendingChainFirst.actor,
      cardUID: state.pendingChainFirst.cardUID, cardId: state.pendingChainFirst.cardId,
      commandId: state.pendingChainFirst.commandId, transactionId: state.pendingChainFirst.transactionId,
      sourceEpoch: state.pendingChainFirst.sourceEpoch, stateVersion: state.pendingChainFirst.stateVersion,
      chainVersion: state.pendingChainFirst.chainVersion, taskId: state.pendingChainFirst.taskId,
      paymentId: state.pendingChainFirst.paymentId, targets: state.pendingChainFirst.targets,
      resolved: state.pendingChainFirst.resolved ? { finalResolvedCost: state.pendingChainFirst.resolved.finalResolvedCost,
        baseProofId: state.pendingChainFirst.resolved.baseProofId,
        coverageProofId: state.pendingChainFirst.resolved.coverageProofId } : null,
      bindingComplete: state.pendingChainFirst.bindingComplete === true,
      targetError: state.pendingChainFirst.targetError === true } : null } : {}),
    pendingReceipt: receipt ? { request: receipt.request, claimIssued: true, outcome: receipt.outcome,
      response: receipt.response, persistRequired: receipt.persistRequired,
      spellReceiptPending: receipt.spellReceipt !== undefined,
      stateVersion: session.commandSession.match.stateVersion, eventSeq: session.commandSession.match.eventSeq,
      chainVersion: session.chain.stateVersion } : null,
    pendingEffect: p ? { ticketKey: p.ticket.idempotencyKey, itemId: p.ticket.itemId,
      cardUID: p.cardUID, effectName: p.effectName, headVersion: p.head.value.stateVersion,
      headEventSeq: p.head.value.eventSeq, headIsCanonical: p.head.value === session.commandSession.match,
      bondKind: p.bond?.kind ?? null, cursor: p.bond?.cursor ?? null,
      candidate: candidate ? { stateVersion: candidate.session.match.stateVersion,
        eventSeq: candidate.session.match.eventSeq, receipt: candidate.receipt, changed: candidate.changed } : null,
      closed: p.closed ? { stateVersion: p.closed.session.match.stateVersion, eventSeq: p.closed.session.match.eventSeq,
        chainVersion: p.closed.chain.stateVersion, proofKey: p.closed.proof.idempotencyKey,
        proofItemId: p.closed.proof.itemId,
        notificationAcknowledged: p.closed.notificationAcknowledged } : null } : null };
  // Detach even frozen native cursors: equality data never carries authority.
  const detached = JSON.parse(JSON.stringify(snapshot));
  const freeze = (value: any): void => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(detached);
  return detached;
}

export const createDuelSpellPlaySessionV2 = createDuelSpellCardPlaySessionV2;
export const playDuelSpellV2 = playDuelSpellCardV2;
export const applyDuelSpellResourceV2 = applyDuelSpellResourceCommandV2;
export const finalizeDuelSpellV2 = finalizeDuelSpellCardPlayV2;
export const passDuelSpellV2 = passDuelSpellPriorityV2;
export const resolveDuelSpellV2 = resolveDuelSpellCardPlayV2;
