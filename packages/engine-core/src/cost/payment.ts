import type { ResolveContext } from '../effects/contract.js';
import { DUEL_DOMAINS } from './resources.js';
import {
  prepareResourcePayment, resourcePoolFromDomains,
  type ResourcePool, type ResourcePayment, type ResourcePaymentOptions
} from './resource-provenance.js';
import {
  CostPlanError, type CostPaymentOptions, type CostPaymentReceipt, type CostPlan,
  type PreparedCostAction, type PreparedCostPayment
} from './plan-types.js';
import { count, freezeCost, invalid, orderedById } from './plan-values.js';

function cannotPay(message: string, action?: PreparedCostAction): never {
  throw new CostPlanError('cannot-pay-cost', message, action);
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

function checkAction(ctx: ResolveContext, payment: PreparedCostAction): void {
  const action = payment.action;
  if (action.type === 'pay') return;
  if (action.type === 'spend-xp') {
    if (ctx.player(ctx.controller).xp < action.amount) cannotPay('Insufficient XP', payment);
    return;
  }
  if (!('object' in action)) invalid('Unsupported nonstandard payment action');
  const object = ctx.object(action.object);
  if (!object) cannotPay('A payment reference is no longer in its selected zone', payment);
  if (action.type === 'discard' || action.type === 'reveal') {
    if (object.owner !== ctx.controller || object.zone !== 'hand') cannotPay('A hand cost requires a card in the paying player’s hand', payment);
  } else if (action.type === 'exhaust') {
    if (object.controller !== ctx.controller || !['board', 'rune-zone'].includes(object.zone) || object.exhausted) cannotPay('An exhaust cost requires a ready controlled object on the Board', payment);
  } else if (action.type === 'recycle') {
    if (object.owner !== ctx.controller || !(object.zone === 'trash' || object.zone === 'rune-zone' && object.types.some(type => type.toLowerCase() === 'rune'))) cannotPay('A recycle cost requires an owned card in Trash or a Rune in the Rune Zone', payment);
  } else if (action.type === 'banish') {
    if (object.owner !== ctx.controller || object.zone === 'banishment') cannotPay('A banish cost requires an owned object outside Banishment', payment);
  } else if (action.type === 'disempower') {
    if (object.controller !== ctx.controller || !['board', 'rune-zone'].includes(object.zone)) cannotPay('A disempower cost requires a controlled object on the Board', payment);
    const empowered = (object as typeof object & { readonly empowered?: unknown }).empowered;
    if (typeof empowered !== 'number' && typeof empowered !== 'boolean') {
      throw new CostPlanError('judge-required', 'Disempower payment requires an authoritative Empowered state', payment);
    }
    const active = typeof empowered === 'number' ? Number.isSafeInteger(empowered) && empowered > 0 : empowered;
    if (!active) cannotPay('A disempower cost requires an Empowered object', payment);
  } else if (action.type === 'kill') {
    if (object.controller !== ctx.controller || object.zone !== 'board') cannotPay('A kill cost requires a controlled permanent on the Board', payment);
  } else if (action.type === 'spend-buff') {
    if (object.controller !== ctx.controller || object.zone !== 'board' || object.buffs < action.amount) cannotPay('Insufficient Buffs', payment);
  } else invalid('Unsupported nonstandard payment action');
}

export function prepareCostPayment(ctx: ResolveContext, plan: CostPlan, options: CostPaymentOptions = {}): PreparedCostPayment {
  if (plan.finalized !== true || plan.player !== ctx.controller || plan.source.id !== ctx.source.ref.id || plan.source.zoneEntryId !== ctx.source.ref.zoneEntryId) invalid('Payment must use this source and controller’s finalized cost plan');
  const player = ctx.player(plan.player);
  for (const domain of player.power) {
    if (!DUEL_DOMAINS.includes(domain)) invalid('Invalid Power domain in player snapshot');
  }
  const energy = count(player.energy, 'Player Energy');
  let power;
  try {
    const pool = resourcePoolFromDomains(energy, player.power);
    power = prepareCostPlanResourcePayment(pool, plan, { power: options.power }).power;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    cannotPay(error.message);
  }
  const paidPower = power.power.flatMap(allocation => {
    if (allocation.from === 'any') invalid('ResolveContext cannot represent a domainless Power resource');
    return Array.from({ length: allocation.amount }, () => allocation.from as typeof DUEL_DOMAINS[number]);
  });
  const standard: PreparedCostAction = { id: `${plan.id}:resources`, action: { type: 'pay', player: plan.player, plan: { finalized: true, energy: plan.total.energy, power: paidPower } } };
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
    checkAction(ctx, payment);
    const outcome = ctx.perform(payment.action);
    if (outcome.status !== 'done' && outcome.status !== 'replaced') {
      throw new CostPlanError('cannot-pay-cost', `Payment action ${payment.id} was ${outcome.status}; abort the Finalize transaction`, payment, outcome);
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
