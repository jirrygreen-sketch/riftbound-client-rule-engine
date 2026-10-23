import type { Instruction } from '@riftbound/card-dsl';
import type { ChainDraft, ChainEngine } from '../chain/engine.js';
import type {
  Domain,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  PlayerSnapshot,
  PowerPaymentSource,
} from '../effects/contract.js';

export const BASIC_RUNE_RESOURCE_PLAN_CONTRACT = 'riftbound.engine.basic-rune-resource-plan.v1' as const;
export const BASIC_RUNE_RESOURCE_RECEIPT_CONTRACT = 'riftbound.engine.basic-rune-resource-receipt.v1' as const;

export type BasicRuneResourceKind = 'energy' | 'power';

/** The six rule-defined Basic Rune Domains (CR v1.5 164.1). */
export const BASIC_RUNE_DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] as const;

/**
 * Trusted catalog metadata for one Basic Rune printing. The resolver must
 * derive this from the authenticated catalog, never from `ObjectSnapshot.power`
 * (a cost field), a Legend, a card name, or the requested resource kind.
 */
export interface BasicRuneIdentity {
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly domain: Domain;
}

export type BasicRuneIdentityResolver = (cardId: string) => BasicRuneIdentity | null | undefined;

/** Authoritative read-only state supplied by the Chain host owner. */
export interface BasicRuneResourceState {
  objects(): readonly ObjectSnapshot[];
  player(playerId: PlayerId): PlayerSnapshot;
}

export type BasicRuneResourceWindow =
  /** A Reaction Add activation at a legal Priority/Focus point. */
  | { readonly kind: 'priority' }
  /** The Pay Costs step, entered only through ChainEngine.activateAddDuringPayment. */
  | { readonly kind: 'payment' };

export interface BasicRuneResourceIntent {
  readonly type: 'rune-energy' | 'rune-power';
  readonly runeObjectId: string;
  readonly zoneEntryId: number;
}

export interface BasicRuneResourcePlanRequest {
  readonly actor: PlayerId;
  /** Stable caller/command identity; the same value is the Chain item id. */
  readonly activationId: string;
  readonly intent: BasicRuneResourceIntent;
  readonly window: BasicRuneResourceWindow;
}

export interface BasicRuneResourcePlanSource {
  readonly objectId: string;
  readonly zoneEntryId: number;
  readonly cardId: string;
  readonly canonicalCardId: string;
  readonly domain: Domain;
  readonly printedEnergy: null;
  readonly printedPower: null;
}

/** Immutable, reviewable activation plan. Execution is bound by a private WeakMap. */
export interface BasicRuneResourcePlan {
  readonly contract: typeof BASIC_RUNE_RESOURCE_PLAN_CONTRACT;
  readonly activationId: string;
  readonly actor: PlayerId;
  readonly resource: BasicRuneResourceKind;
  readonly window: BasicRuneResourceWindow;
  readonly rune: BasicRuneResourcePlanSource;
  readonly draft: ChainDraft;
}

export interface BasicRuneResourceReceipt {
  readonly contract: typeof BASIC_RUNE_RESOURCE_RECEIPT_CONTRACT;
  readonly activationId: string;
  readonly actor: PlayerId;
  readonly resource: BasicRuneResourceKind;
  readonly energyAdded: number;
  readonly powerAdded: readonly Domain[];
  readonly runeBefore: ObjectRef;
  readonly runeAfter: ObjectRef;
  readonly runeZoneAfter: 'rune-zone' | 'rune-deck';
}

export type BasicRuneResourceErrorCode =
  | 'invalid-request'
  | 'unknown-rune-object'
  | 'stale-incarnation'
  | 'not-rune'
  | 'not-in-rune-zone'
  | 'untrusted-rune'
  | 'wrong-controller'
  | 'exhausted-rune'
  | 'illegal-window'
  | 'domain-changed'
  | 'invalid-plan'
  | 'plan-consumed'
  | 'resource-mismatch';

export class BasicRuneResourceError extends Error {
  constructor(readonly code: BasicRuneResourceErrorCode, message: string) {
    super(message);
    this.name = 'BasicRuneResourceError';
  }
}

interface PlanBinding {
  readonly chain: ChainEngine;
  readonly state: BasicRuneResourceState;
  readonly resolveIdentity: BasicRuneIdentityResolver;
  readonly request: BasicRuneResourcePlanRequest;
  consumed: boolean;
}

const PLAN_BINDINGS = new WeakMap<BasicRuneResourcePlan, PlanBinding>();

function fail(code: BasicRuneResourceErrorCode, message: string): never {
  throw new BasicRuneResourceError(code, message);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && (BASIC_RUNE_DOMAINS as readonly string[]).includes(value);
}

function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function validateRequest(request: BasicRuneResourcePlanRequest): void {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    fail('invalid-request', 'Rune activation request must be an object');
  }
  if (!text(request.actor) || !text(request.activationId)) {
    fail('invalid-request', 'Rune activation requires an actor and activationId');
  }
  const intent = request.intent;
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent) ||
      (intent.type !== 'rune-energy' && intent.type !== 'rune-power') ||
      !text(intent.runeObjectId) || !count(intent.zoneEntryId)) {
    fail('invalid-request', 'Rune activation intent must name one exact Rune incarnation');
  }
  if (request.window === null || typeof request.window !== 'object' ||
      (request.window.kind !== 'priority' && request.window.kind !== 'payment')) {
    fail('invalid-request', 'Rune activation window must be priority or payment');
  }
}

function currentRune(state: BasicRuneResourceState, intent: BasicRuneResourceIntent): ObjectSnapshot {
  const matches = state.objects().filter(object => object.ref.id === intent.runeObjectId);
  const exact = matches.find(object => object.ref.zoneEntryId === intent.zoneEntryId);
  if (exact === undefined) {
    if (matches.length > 0) fail('stale-incarnation', `Rune ${intent.runeObjectId}:${intent.zoneEntryId} is no longer current`);
    fail('unknown-rune-object', `Rune ${intent.runeObjectId} does not exist`);
  }
  if (!exact.types.some(type => type.toLowerCase() === 'rune')) {
    fail('not-rune', `Object ${refKey(exact.ref)} is not a Rune`);
  }
  if (exact.zone !== 'rune-zone') {
    fail('not-in-rune-zone', `Rune ${refKey(exact.ref)} is not in the Rune Zone`);
  }
  return exact;
}

function trustedIdentity(
  source: ObjectSnapshot,
  resolveIdentity: BasicRuneIdentityResolver,
  frozen?: Pick<BasicRuneIdentity, 'cardId' | 'canonicalCardId' | 'domain'>,
): BasicRuneIdentity {
  if (!text(source.cardId) || !source.tags.includes('Basic') ||
      source.energy !== null || source.power !== null) {
    fail('untrusted-rune', `Rune ${refKey(source.ref)} lacks exact Basic Rune printed metadata`);
  }
  let identity: BasicRuneIdentity | null | undefined;
  try {
    identity = resolveIdentity(source.cardId);
  } catch (error) {
    fail('untrusted-rune', `Rune identity resolver failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (identity === null || identity === undefined || identity.cardId !== source.cardId ||
      !text(identity.canonicalCardId) || !isDomain(identity.domain)) {
    fail('untrusted-rune', `Card ${source.cardId} is not a trusted Basic Rune printing`);
  }
  if (frozen !== undefined &&
      (identity.cardId !== frozen.cardId || identity.canonicalCardId !== frozen.canonicalCardId ||
       identity.domain !== frozen.domain)) {
    fail('domain-changed', `Trusted identity for Rune ${refKey(source.ref)} changed after planning`);
  }
  return identity;
}

function resourceKind(intent: BasicRuneResourceIntent): BasicRuneResourceKind {
  return intent.type === 'rune-energy' ? 'energy' : 'power';
}

function draftFor(
  request: BasicRuneResourcePlanRequest,
  source: ObjectSnapshot,
  identity: BasicRuneIdentity,
): ChainDraft {
  const resource = resourceKind(request.intent);
  const add: Instruction = {
    id: `${request.activationId}:add`,
    op: 'effect.resources',
    args: resource === 'energy'
      ? { energy: { kind: 'constant', value: 1 } }
      : { power: { kind: 'constant', value: [identity.domain] } },
  };
  return {
    id: request.activationId,
    controller: request.actor,
    source,
    kind: 'add',
    speed: 'reaction',
    body: [add],
    cost: {
      id: `cost:${request.activationId}`,
      cost: {
        payments: [{ kind: resource === 'energy' ? 'exhaust' : 'recycle', object: source.ref }],
      },
    },
  };
}

function assertStillLegal(binding: PlanBinding, plan: BasicRuneResourcePlan): ObjectSnapshot {
  const source = currentRune(binding.state, binding.request.intent);
  trustedIdentity(source, binding.resolveIdentity, plan.rune);
  if (source.controller !== plan.actor) {
    fail('wrong-controller', `Rune ${refKey(source.ref)} is not controlled by ${plan.actor}`);
  }
  if (plan.resource === 'energy' && source.exhausted) {
    fail('exhausted-rune', `Energy activation requires ready Rune ${refKey(source.ref)}`);
  }
  if (plan.window.kind === 'priority' &&
      !binding.chain.canAct(plan.actor, 'reaction', source.ref, source)) {
    fail('illegal-window', `Rune ${refKey(source.ref)} has no legal Reaction Priority/Focus window`);
  }
  return source;
}

function addedPower(before: readonly PowerPaymentSource[], after: readonly PowerPaymentSource[]): Domain[] {
  const remaining = [...before];
  const added: Domain[] = [];
  for (const source of after) {
    const index = remaining.indexOf(source);
    if (index >= 0) {
      remaining.splice(index, 1);
      continue;
    }
    if (!BASIC_RUNE_DOMAINS.includes(source as Domain)) {
      fail('resource-mismatch', `Basic Rune activation produced unsupported Power source ${String(source)}`);
    }
    added.push(source as Domain);
  }
  return added;
}

/**
 * Build an immutable Basic Rune resource plan from trusted catalog identity and
 * live Chain state. Priority legality is checked now; payment-window legality
 * is enforced by ChainEngine.activateAddDuringPayment at execution time.
 */
export function planBasicRuneResourceActivation(input: {
  readonly chain: ChainEngine;
  readonly state: BasicRuneResourceState;
  readonly resolveIdentity: BasicRuneIdentityResolver;
  readonly request: BasicRuneResourcePlanRequest;
}): BasicRuneResourcePlan {
  validateRequest(input.request);
  const source = currentRune(input.state, input.request.intent);
  const identity = trustedIdentity(source, input.resolveIdentity);
  if (source.controller !== input.request.actor) {
    fail('wrong-controller', `Rune ${refKey(source.ref)} is controlled by ${source.controller}, not ${input.request.actor}`);
  }
  if (input.request.intent.type === 'rune-energy' && source.exhausted) {
    fail('exhausted-rune', `Energy activation requires ready Rune ${refKey(source.ref)}`);
  }
  if (input.request.window.kind === 'priority' &&
      !input.chain.canAct(input.request.actor, 'reaction', source.ref, source)) {
    fail('illegal-window', `Rune ${refKey(source.ref)} has no legal Reaction Priority/Focus window`);
  }

  const draft = freezeDeep(draftFor(input.request, source, identity));
  const plan = freezeDeep({
    contract: BASIC_RUNE_RESOURCE_PLAN_CONTRACT,
    activationId: input.request.activationId,
    actor: input.request.actor,
    resource: resourceKind(input.request.intent),
    window: input.request.window,
    rune: {
      objectId: source.ref.id,
      zoneEntryId: source.ref.zoneEntryId,
      cardId: identity.cardId,
      canonicalCardId: identity.canonicalCardId,
      domain: identity.domain,
      printedEnergy: null,
      printedPower: null,
    },
    draft,
  }) satisfies BasicRuneResourcePlan;
  PLAN_BINDINGS.set(plan, {
    chain: input.chain,
    state: input.state,
    resolveIdentity: input.resolveIdentity,
    request: freezeDeep(structuredClone(input.request)),
    consumed: false,
  });
  return plan;
}

/**
 * Execute exactly one planned activation through the Chain/cost/action path.
 * No resource balance is written here. The Chain Finalize owns cost payment;
 * the registered `effect.resources` primitive owns the Add action.
 */
export function executeBasicRuneResourcePlan(plan: BasicRuneResourcePlan): BasicRuneResourceReceipt {
  const binding = PLAN_BINDINGS.get(plan);
  if (binding === undefined) fail('invalid-plan', 'Rune activation plan was not produced by this module');
  if (binding.consumed) fail('plan-consumed', `Rune activation ${plan.activationId} was already consumed`);

  assertStillLegal(binding, plan);
  const beforePlayer = binding.state.player(plan.actor);
  if (plan.window.kind === 'payment') binding.chain.activateAddDuringPayment(plan.draft);
  else binding.chain.execute(plan.draft);
  binding.consumed = true;

  const afterPlayer = binding.state.player(plan.actor);
  const energyAdded = afterPlayer.energy - beforePlayer.energy;
  const powerAdded = addedPower(beforePlayer.power, afterPlayer.power);
  const afterRune = binding.state.objects().find(object => object.ref.id === plan.rune.objectId);
  const expectedZone = plan.resource === 'energy' ? 'rune-zone' : 'rune-deck';
  const expectedZoneEntryId = plan.resource === 'energy'
    ? plan.rune.zoneEntryId
    : plan.rune.zoneEntryId + 1;
  const exactDelta = plan.resource === 'energy'
    ? energyAdded === 1 && powerAdded.length === 0
    : energyAdded === 0 && powerAdded.length === 1 && powerAdded[0] === plan.rune.domain;
  if (!exactDelta || afterRune === undefined || afterRune.zone !== expectedZone ||
      afterRune.ref.zoneEntryId !== expectedZoneEntryId) {
    fail('resource-mismatch', `Rune activation ${plan.activationId} did not produce its exact once-only resource and Rune transition`);
  }
  return freezeDeep({
    contract: BASIC_RUNE_RESOURCE_RECEIPT_CONTRACT,
    activationId: plan.activationId,
    actor: plan.actor,
    resource: plan.resource,
    energyAdded,
    powerAdded,
    runeBefore: { id: plan.rune.objectId, zoneEntryId: plan.rune.zoneEntryId },
    runeAfter: structuredClone(afterRune.ref),
    runeZoneAfter: expectedZone,
  });
}
