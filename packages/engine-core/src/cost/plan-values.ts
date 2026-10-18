import type { CostPayment, CostSpec, PickSpec } from '@riftbound/card-dsl';
import type { Domain, ObjectRef, ResolveContext, Value } from '../effects/contract.js';
import { bindDuelPrintedCost } from './printed-costs.js';
import { DUEL_DOMAINS, type DuelPowerRequirement } from './resources.js';
import { CostPlanError, type CostAmount, type CostChoiceLock, type CostChoiceLocks, type CostPlanInput, type NonstandardCostAction } from './plan-types.js';
import { chooseCostObjects } from './plan-choices.js';

export function invalid(message: string): never {
  throw new CostPlanError('invalid-cost-plan', message);
}

export function blocked(message: string): never {
  throw new CostPlanError('judge-required', message);
}

export function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a nonnegative safe integer`);
  return value;
}

export function add(first: number, second: number): number {
  return count(first + second, 'Cost total');
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length) invalid('Cost IDs must be nonempty strings');
  return value;
}

export function domains(value: unknown): Domain[] {
  if (!Array.isArray(value) || !value.length || value.some(item => !DUEL_DOMAINS.includes(item)) || new Set(value).size !== value.length) invalid('Expected unique cost domains');
  return [...value];
}

export function emptyCost(): CostAmount {
  return { energy: 0, power: [], xp: 0, actions: [] };
}

export function freezeCost<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeCost(child);
    Object.freeze(value);
  }
  return value;
}

export function ownDomains(input: CostPlanInput): readonly Domain[] {
  if (input.domains !== undefined) return input.domains.length ? domains(input.domains) : [...DUEL_DOMAINS];
  if (input.printed) {
    const binding = bindDuelPrintedCost({ ...input.printed, cardType: 'Spell', energy: 0, power: 1 });
    if (binding.kind === 'numeric') return binding.cost.power[0]!.allowedDomains;
  }
  return blocked('Numeric [C] costs require the source domains; supply domains (an empty list means domainless)');
}

function powerValue(value: Value, input: CostPlanInput): DuelPowerRequirement[] {
  if (typeof value === 'number') {
    const amount = count(value, 'Power');
    return amount ? [{ amount, allowedDomains: ownDomains(input) }] : [];
  }
  if (!Array.isArray(value)) return invalid('Power must evaluate to an amount or a domain list');
  const universal = value.some(item => item === 'any' || item === 'universal' || item === 'universal-power' || item === 'rainbow');
  if (universal) {
    if (value.some(item => !DUEL_DOMAINS.includes(item))) return invalid('Expected unique cost domains');
    return blocked('Universal Power requires a domainless resource contract');
  }
  return value.map(item => ({ amount: 1, allowedDomains: domains([item]) }));
}

function paymentDomains(value: unknown): Domain[] {
  if (Array.isArray(value) && value.some(item => item === 'any' || item === 'universal' || item === 'universal-power' || item === 'rainbow')) {
    if (value.some(item => !DUEL_DOMAINS.includes(item))) return invalid('Expected unique cost domains');
    return blocked('Universal Power requires a domainless resource contract');
  }
  return domains(value);
}

function reference(value: unknown, ctx: ResolveContext): ObjectRef {
  if (value === 'self') return { ...ctx.source.ref };
  if (!value || typeof value !== 'object' || !('id' in value) || !('zoneEntryId' in value)) return invalid('Cost requires an exact object reference');
  const object = value as ObjectRef;
  identifier(object.id);
  count(object.zoneEntryId, 'zoneEntryId');
  return { id: object.id, zoneEntryId: object.zoneEntryId };
}

function lockedChoice(input: CostPlanInput, choiceId: string, kind: string): CostChoiceLock | undefined {
  const locks = input.costChoices?.locks ?? [];
  const matches = locks.filter(lock => lock.choiceId === choiceId);
  if (matches.length > 1) invalid(`Cost choice ${choiceId} has duplicate Finalize locks`);
  const lock = matches[0];
  if (lock !== undefined && (lock.planId !== input.id || lock.kind !== kind || lock.receipt.id !== choiceId)) {
    invalid(`Cost choice ${choiceId} has a mismatched Finalize lock`);
  }
  return lock;
}

function paymentObjects(ctx: ResolveContext, payment: CostPayment, input: CostPlanInput, kind: string): { refs: ObjectRef[]; choice?: ReturnType<typeof chooseCostObjects>['receipt'] } {
  if (payment.choice !== undefined) {
    const lock = lockedChoice(input, payment.choice.id, kind);
    const selected = chooseCostObjects(ctx, payment.choice, input.id, kind, lock?.receipt);
    return { refs: [...selected.selected], choice: selected.receipt };
  }
  if (payment.objects !== undefined) {
    if (!Array.isArray(payment.objects)) invalid('Cost objects must be an array');
    return { refs: payment.objects.map(item => reference(item, ctx)) };
  }
  return { refs: [reference(payment.object ?? 'self', ctx)] };
}

export function readCost(ctx: ResolveContext, spec: CostSpec, input: CostPlanInput, componentId: string): CostAmount | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) invalid('Expected a CostSpec');
  const known = ['kind', 'payments', 'energy', 'power', 'discard'];
  for (const key of Object.keys(spec)) if (!known.includes(key)) blocked(`Unsupported CostSpec field: ${key}`);
  if (spec.payments !== undefined && !Array.isArray(spec.payments)) invalid('Cost payments must be an array');
  if (spec.discard !== undefined && (!spec.discard || typeof spec.discard !== 'object' || Array.isArray(spec.discard))) invalid('Cost discard must be a PickSpec');
  if (spec.kind === 'printed') {
    if (Object.keys(spec).some(key => key !== 'kind')) invalid('Printed costs cannot contain explicit payment components');
    if (input.printed) {
      const binding = bindDuelPrintedCost(input.printed);
      if (binding.kind !== 'numeric') {
        if (binding.reason === 'unsupported-card-type') blocked('The catalog card has no normal play cost');
        return null;
      }
      return { ...emptyCost(), energy: binding.cost.energy, power: binding.cost.power };
    }
    if (ctx.source.energy === null) return null;
    return { ...emptyCost(), energy: count(ctx.source.energy, 'Printed Energy'), power: ctx.source.power === null ? [] : powerValue(ctx.source.power, input) };
  }
  if (spec.kind !== undefined && !['activated', 'explicit'].includes(spec.kind)) blocked(`Unsupported cost kind: ${spec.kind}`);
  let energy = spec.energy === undefined ? 0 : count(ctx.evaluate(spec.energy), 'Energy');
  let power = spec.power === undefined ? [] : powerValue(ctx.evaluate(spec.power), input);
  let xp = 0;
  const actions: CostAmount['actions'][number][] = [];
  const choices: NonNullable<CostAmount['choices']>[number][] = [];
  const payments = [...(spec.payments ?? []), ...(spec.discard ? [{ kind: 'discard', choice: spec.discard }] : [])];
  for (const [index, payment] of payments.entries()) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment) || typeof payment.kind !== 'string' || !payment.kind.length) invalid('Each cost payment must have a nonempty kind');
    const kind = payment.kind.startsWith('cost.') ? payment.kind.slice(5) : payment.kind;
    const supported = ['kind', 'amount', 'value', 'choice', 'object', 'objects', 'allowedDomains'];
    for (const key of Object.keys(payment)) if (!supported.includes(key)) blocked(`Unsupported payment field: ${key}`);
    if (payment.amount !== undefined && payment.value !== undefined) invalid('Specify either amount or value');
    const expression = payment.amount ?? payment.value;
    if (kind === 'energy' || kind === 'xp') {
      if (payment.choice !== undefined || payment.object !== undefined || payment.objects !== undefined || payment.allowedDomains !== undefined) invalid('A scalar resource cost cannot contain object choices or Power domains');
      const amount = count(expression === undefined ? 1 : ctx.evaluate(expression), kind);
      if (kind === 'energy') energy = add(energy, amount);
      else xp = add(xp, amount);
    } else if (kind === 'power') {
      if (payment.choice !== undefined || payment.object !== undefined || payment.objects !== undefined) invalid('A Power cost cannot contain object choices');
      if (payment.universal === true || payment.source === 'universal' || payment.source === 'universal-power' || payment.source === 'any') {
        blocked('Universal Power requires a domainless resource contract');
      }
      const amount = count(expression === undefined ? 1 : ctx.evaluate(expression), 'Power');
      if (amount) power = [...power, { amount, allowedDomains: payment.allowedDomains === undefined ? ownDomains(input) : paymentDomains(payment.allowedDomains) }];
    } else if (['exhaust', 'discard', 'recycle', 'kill', 'banish', 'disempower', 'reveal', 'spend-buff'].includes(kind)) {
      if (payment.allowedDomains !== undefined) invalid('A nonstandard cost cannot select Power domains');
      if ([payment.choice, payment.object, payment.objects].filter(value => value !== undefined).length > 1) invalid('A nonstandard cost must use exactly one object selection form');
      if (input.ignoreAllCosts) continue;
      const selected = paymentObjects(ctx, payment, input, kind);
      const objects = selected.refs;
      const identities = objects.map(object => `${object.id}:${object.zoneEntryId}`);
      if (new Set(identities).size !== identities.length) invalid('The same object cannot be selected twice for one cost');
      const amount = expression === undefined ? undefined : count(ctx.evaluate(expression), 'Nonstandard cost amount');
      if (kind !== 'spend-buff' && amount !== undefined && amount !== objects.length) invalid('Every object in a nonstandard cost must be selected');
      for (const [objectIndex, object] of objects.entries()) {
        const action: NonstandardCostAction = kind === 'reveal'
          ? { type: 'reveal', object }
          : kind === 'spend-buff' ? { type: 'spend-buff', object, amount: amount ?? 1 }
          : { type: kind as 'exhaust' | 'discard' | 'recycle' | 'kill' | 'banish' | 'disempower', object };
        actions.push({ id: `${componentId}:payment:${index}:${objectIndex}`, componentId, action, ...(selected.choice ? { choiceId: selected.choice.id } : {}) });
      }
      if (selected.choice) {
        choices.push(selected.choice);
      }
    } else blocked(`Unsupported payment kind: ${payment.kind}`);
  }
  return { energy, power, xp, actions, ...(choices.length ? { choices } : {}) };
}

export function combineCosts(costs: readonly CostAmount[]): CostAmount {
  return costs.reduce((total, cost) => {
    const choices = [...(total.choices ?? []), ...(cost.choices ?? [])];
    return {
      energy: add(total.energy, cost.energy),
      power: [...total.power, ...cost.power],
      xp: add(total.xp, cost.xp),
      actions: [...total.actions, ...cost.actions],
      ...(choices.length ? { choices } : {})
    };
  }, emptyCost());
}

/** Stable public API consumed by the Chain Finalize owner (RIFT-835). */
export function finalizeCostChoiceLock(
  ctx: ResolveContext,
  choice: PickSpec,
  planId: string,
  kind: string
): CostChoiceLock {
  const selected = chooseCostObjects(ctx, choice, planId, kind);
  return freezeCost({ planId, choiceId: choice.id, kind, receipt: selected.receipt });
}

export function costChoiceLocks(locks: readonly CostChoiceLock[]): CostChoiceLocks {
  const ids = locks.map(lock => `${lock.planId}:${lock.choiceId}`);
  if (new Set(ids).size !== ids.length) invalid('Finalize cost choice locks must be unique');
  return freezeCost({ locks: structuredClone(locks) });
}

export function orderedById<T extends { readonly id: string }>(values: readonly T[], order?: readonly string[]): T[] {
  const ids = values.map(value => identifier(value.id));
  if (new Set(ids).size !== ids.length) invalid('Duplicate cost IDs');
  if (order === undefined) return [...values];
  if (order.length !== ids.length || new Set(order).size !== order.length || order.some(id => typeof id !== 'string' || !ids.includes(id))) invalid('Cost order must contain each ID exactly once');
  return order.map(id => {
    const value = values.find(item => item.id === id);
    if (!value) invalid('Cost order refers to an unknown ID');
    return value;
  });
}
