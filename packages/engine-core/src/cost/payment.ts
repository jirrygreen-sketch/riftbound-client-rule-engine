import type { GameAction, ResolveContext } from '../effects/contract.js';
import { DUEL_DOMAINS, type DuelPowerSource } from './resources.js';
import {
  prepareResourcePayment,
  type ResourcePool, type ResourcePayment, type ResourcePaymentOptions
} from './resource-provenance.js';
import {
  CostPlanError, type CostPaymentOptions, type CostPaymentReceipt, type CostPlan,
  type PreparedCostAction, type PreparedCostPayment
} from './plan-types.js';
import { count, freezeCost, invalid, orderedById } from './plan-values.js';
import { disempowerTransition, tryReadEmpowered } from '../zones/empower-state.js';

function cannotPay(message: string, action?: PreparedCostAction): never {
  throw new CostPlanError('cannot-pay-cost', message, action);
}

function universal(value: unknown): boolean {
  return value === 'any' || value === 'universal' || value === 'universal-power';
}

function assertResourcePaymentConsumed(
  before: ReturnType<ResolveContext['player']>,
  after: ReturnType<ResolveContext['player']>,
  action: Extract<GameAction, { type: 'pay' }>,
  payment: PreparedCostAction,
): void {
  const counts = (values: readonly unknown[]): { named: Map<string, number>; universal: number } => {
    const named = new Map<string, number>();
    let wild = 0;
    for (const value of values) {
      if (universal(value)) wild++;
      else named.set(String(value), (named.get(String(value)) ?? 0) + 1);
    }
    return { named, universal: wild };
  };
  const expected = counts(before.power as readonly unknown[]);
  for (const domain of action.plan.power ?? []) expected.named.set(domain, (expected.named.get(domain) ?? 0) - 1);
  expected.universal -= action.plan.universalPower ?? 0;
  if (expected.universal < 0 || [...expected.named.values()].some(amount => amount < 0)) {
    cannotPay('Resource payment plan exceeds the paying player’s snapshot', payment);
  }
  const actual = counts(after.power as readonly unknown[]);
  const same =
    after.energy === before.energy - (action.plan.energy ?? 0) &&
    actual.universal === expected.universal &&
    [...expected.named].every(([domain, amount]) => (actual.named.get(domain) ?? 0) === amount);
  if (!same) cannotPay('The paying host did not consume the prepared Power resources', payment);
}

/**
 * Allocate the resource portion of a locked CostPlan against a provenance-aware
 * inventory. The host owns that inventory and must consume these exact lots in
 * its Finalize transaction together with the plan's nonstandard costs.
 * This is read-only: it does not route a Universal/limited lot to a legacy host
 * whose PlayerSnapshot/gain-power/pay contracts cannot preserve it.
 */
export function prepareCostPlanResourcePayment(
  pool: ResourcePool, plan: Pick<CostPlan, 'total'>, options: ResourcePaymentOptions = {}
): ResourcePayment {
  return prepareResourcePayment(pool, { energy: plan.total.energy, power: plan.total.power }, options);
}

function objectLabel(ref: { readonly id: string; readonly zoneEntryId: number }): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

/**
 * A finalized plan is bound to one physical incarnation. Never recover it by
 * card id: a later zone entry is a different object for cost purposes. LKI is
 * usable only when the context itself still names that exact source and no
 * later incarnation currently exists.
 */
function assertSourceIncarnation(ctx: ResolveContext, plan: CostPlan): void {
  if (plan.source.id !== ctx.source.ref.id) {
    invalid(`Payment source ${objectLabel(plan.source)} does not match the resolving source ${objectLabel(ctx.source.ref)}`);
  }
  const exact = ctx.object(plan.source);
  if (exact) {
    if (exact.controller !== plan.player && exact.controller !== ctx.source.controller) {
      invalid(`Locked cost source ${objectLabel(plan.source)} is no longer controlled by the paying player`);
    }
    return;
  }
  // A play's plan is built from the pre-entry snapshot, but the Chain item
  // itself carries the just-created Chain incarnation. Bind that one transition
  // by the Chain source ref; any later Resolve or second entry fails closed.
  if (ctx.timingPoint === 'chain-item-finalize') {
    const current = ctx.query({}).find(object => object.ref.id === ctx.source.ref.id);
    if (current?.zone === 'chain' && current.controller === ctx.source.controller) return;
  }
  const replacement = ctx.query({}).find(object => object.ref.id === plan.source.id);
  if (replacement) {
    cannotPay(`Locked cost source ${objectLabel(plan.source)} is no longer its Finalize incarnation; current source is ${objectLabel(replacement.ref)}`);
  }
  const sameSource = plan.source.zoneEntryId === ctx.source.ref.zoneEntryId;
  if (!sameSource) {
    cannotPay(`Locked cost source ${objectLabel(plan.source)} no longer exists and is not this ability's last-known source`);
  }
}

function actionObject(ctx: ResolveContext, payment: PreparedCostAction, ref: { readonly id: string; readonly zoneEntryId: number }) {
  const exact = ctx.object(ref);
  if (exact) return exact;
  const replacement = ctx.query({}).find(object => object.ref.id === ref.id);
  if (replacement) {
    cannotPay(`Locked cost object ${objectLabel(ref)} is no longer its Finalize incarnation; current object is ${objectLabel(replacement.ref)}`, payment);
  }
  cannotPay(`Locked cost object ${objectLabel(ref)} no longer exists in the current state`, payment);
}

function checkAction(ctx: ResolveContext, payment: PreparedCostAction): void {
  const action = payment.action;
  if (action.type === 'pay') return;
  if (action.type === 'spend-xp') {
    if (ctx.player(ctx.controller).xp < action.amount) cannotPay('Insufficient XP', payment);
    return;
  }
  if (!('object' in action)) invalid('Unsupported nonstandard payment action');
  const object = actionObject(ctx, payment, action.object);
  if (action.type === 'discard' || action.type === 'reveal') {
    if (object.owner !== ctx.controller || object.zone !== 'hand') cannotPay('A hand cost requires a card in the paying player’s hand', payment);
  } else if (action.type === 'exhaust') {
    if (object.controller !== ctx.controller || !['board', 'rune-zone'].includes(object.zone) || object.exhausted) cannotPay('An exhaust cost requires a ready controlled object on the Board', payment);
  } else if (action.type === 'recycle') {
    const allowed = object.owner === ctx.controller && object.zone === 'trash' ||
      object.controller === ctx.controller && object.zone === 'board' ||
      object.owner === ctx.controller && object.zone === 'rune-zone' && object.types.some(type => type.toLowerCase() === 'rune');
    if (!allowed) cannotPay('A recycle cost requires a friendly Board object, an owned card in Trash, or an owned Rune in the Rune Zone', payment);
  } else if (action.type === 'banish') {
    // Banish itself has no ownership predicate (CR 428.1/428.5). The cost's
    // authored selector decides the zone/type set; the paying ability must
    // still act on an object its current controller is directed to banish.
    if (object.controller !== ctx.controller || object.zone === 'banishment') cannotPay('A banish cost requires an object controlled by the paying player outside Banishment', payment);
  } else if (action.type === 'disempower') {
    if (object.controller !== ctx.controller || !['board', 'rune-zone'].includes(object.zone)) cannotPay('A disempower cost requires a controlled object on the Board', payment);
    const empowered = tryReadEmpowered(object);
    if (empowered === null) {
      throw new CostPlanError('judge-required', 'Disempower payment requires an authoritative Empowered state in ObjectSnapshot', payment);
    }
    if (empowered === 0) cannotPay('A disempower cost requires an Empowered object', payment);
    if (!disempowerTransition(empowered).changed) cannotPay('A disempower cost can remove exactly one Empowered status', payment);
  } else if (action.type === 'kill') {
    if (object.controller !== ctx.controller || object.zone !== 'board') cannotPay('A kill cost requires a controlled permanent on the Board', payment);
  } else if (action.type === 'spend-buff') {
    if (object.controller !== ctx.controller || object.zone !== 'board' || object.buffs < action.amount) cannotPay('Insufficient Buffs', payment);
  } else invalid('Unsupported nonstandard payment action');
}

export function prepareCostPayment(ctx: ResolveContext, plan: CostPlan, options: CostPaymentOptions = {}): PreparedCostPayment {
  const chainFinalize = ctx.timingPoint === 'chain-item-finalize';
  if (plan.finalized !== true || plan.player !== ctx.controller || plan.source.id !== ctx.source.ref.id || (!chainFinalize && plan.source.zoneEntryId !== ctx.source.ref.zoneEntryId)) invalid('Payment must use this source and controller’s finalized cost plan');
  assertSourceIncarnation(ctx, plan);
  const player = ctx.player(plan.player);
  const energy = count(player.energy, 'Player Energy');
  const inventory: { readonly id: string; readonly resource: 'energy' | DuelPowerSource; readonly amount: number }[] = [
    { id: 'energy', resource: 'energy', amount: energy },
  ];
  const amounts = new Map<DuelPowerSource, number>();
  for (const value of player.power as readonly unknown[]) {
    const source = universal(value)
      ? 'any'
      : DUEL_DOMAINS.includes(value as typeof DUEL_DOMAINS[number])
        ? value as typeof DUEL_DOMAINS[number]
        : null;
    if (source === null) invalid('Invalid Power domain in player snapshot');
    amounts.set(source, (amounts.get(source) ?? 0) + 1);
  }
  for (const [source, amount] of amounts) inventory.push({ id: `power:${source}`, resource: source, amount });
  let power;
  const pool = { sources: inventory };
  try {
    power = prepareCostPlanResourcePayment(pool, plan, { power: options.power }).power;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    cannotPay(error.message);
  }
  const paidPower = power.power.flatMap(allocation => {
    if (allocation.from === 'any') return [];
    return Array.from({ length: allocation.amount }, () => allocation.from as typeof DUEL_DOMAINS[number]);
  });
  const universalPower = power.power.reduce((total, allocation) => total + (allocation.from === 'any' ? allocation.amount : 0), 0);
  const preparedPowerSources = power.power.map(allocation => ({ source: allocation.from as DuelPowerSource, amount: allocation.amount }));
  const standard: PreparedCostAction = { id: `${plan.id}:resources`, action: { type: 'pay', player: plan.player, plan: {
    finalized: true,
    energy: plan.total.energy,
    power: paidPower,
    ...(universalPower ? { universalPower } : {}),
    ...(power.power.some(allocation => allocation.from === 'any') ? { powerSources: preparedPowerSources } : {}),
  } } };
  const nonstandard: PreparedCostAction[] = plan.total.actions.map(cost => ({ id: cost.id, action: cost.action }));
  if (plan.total.xp) nonstandard.push({ id: `${plan.id}:xp`, action: { type: 'spend-xp', player: plan.player, amount: plan.total.xp } });
  const ordered = orderedById(nonstandard, options.nonstandardOrder);
  for (const action of ordered) checkAction(ctx, action);
  return freezeCost({ planId: plan.id, player: plan.player, power, actions: [standard, ...ordered] });
}

/**
 * Check a locked plan against the current resource/object snapshot without
 * performing any action.  Finalize owners can use this to answer the common
 * "can I pay this?" branch without catching an exception after a partial
 * payment.  Only an actual payment failure is converted to `payable: false`;
 * malformed plans and unsupported semantics still surface as plan errors.
 */
export function assessCostPayment(ctx: ResolveContext, plan: CostPlan, options: CostPaymentOptions = {}) {
  try {
    return { payable: true as const, prepared: prepareCostPayment(ctx, plan, options) };
  } catch (error) {
    if (error instanceof CostPlanError && error.reason === 'cannot-pay-cost') {
      return { payable: false as const, error };
    }
    throw error;
  }
}

export function canPayCostPlan(ctx: ResolveContext, plan: CostPlan, options: CostPaymentOptions = {}): boolean {
  return assessCostPayment(ctx, plan, options).payable;
}

function payCostPlanNow(ctx: ResolveContext, plan: CostPlan, options: CostPaymentOptions): CostPaymentReceipt {
  const prepared = prepareCostPayment(ctx, plan, options);
  const actions: CostPaymentReceipt['actions'][number][] = [];
  const events: CostPaymentReceipt['events'][number][] = [];
  for (const payment of prepared.actions) {
    const paymentObject = payment.action.type !== 'pay' && payment.action.type !== 'spend-xp' && 'object' in payment.action
      ? payment.action.object
      : null;
    const consumedSource = paymentObject !== null && paymentObject.id === plan.source.id &&
      paymentObject.zoneEntryId === plan.source.zoneEntryId &&
      actions.some(action => action.status === 'done' && 'object' in action.action &&
        action.action.object.id === paymentObject.id && action.action.object.zoneEntryId === paymentObject.zoneEntryId);
    // A prior action or host hook may have replaced an incarnation. The one
    // exception is another action on the same locked source already consumed
    // by this plan (Gold's Exhaust then Kill this); that identity is not stale.
    if (!consumedSource) assertSourceIncarnation(ctx, plan);
    checkAction(ctx, payment);
    const resourceBefore = payment.action.type === 'pay' ? ctx.player(payment.action.player) : null;
    const outcome = ctx.perform(payment.action);
    if (outcome.status !== 'done' && outcome.status !== 'replaced') {
      throw new CostPlanError('cannot-pay-cost', `Payment action ${payment.id} was ${outcome.status}; abort the Finalize transaction`, payment, outcome);
    }
    if (payment.action.type === 'pay' && resourceBefore !== null) {
      assertResourcePaymentConsumed(resourceBefore, ctx.player(payment.action.player), payment.action, payment);
    }
    events.push(...outcome.events);
    actions.push({ ...payment, status: outcome.status });
  }
  return freezeCost(structuredClone({
    planId: plan.id,
    player: plan.player,
    paid: true as const,
    total: plan.total,
    power: prepared.power,
    additional: plan.selectedAdditional.map(cost => ({ ...cost, paid: true as const })),
    ...(plan.total.choices?.length ? { choices: plan.total.choices } : {}),
    actions,
    events
  }));
}

/**
 * Pay a finalized plan.  The optional transaction callback is deliberately
 * caller-owned: it must include the context, event/trigger queues and any
 * chain state that Finalize mutates.  Without it this function keeps the
 * historical direct-context behavior for callers that already provide their
 * own outer transaction.
 */
export function payCostPlan(ctx: ResolveContext, plan: CostPlan, options: CostPaymentOptions = {}): CostPaymentReceipt {
  const { transaction, ...paymentOptions } = options;
  const run = () => payCostPlanNow(ctx, plan, paymentOptions);
  return transaction ? transaction(run) : run();
}
