import type { CostPayment, CostSpec, PickSpec } from '@riftbound/card-dsl';
import type { Domain, ObjectRef, ResolveContext, Value } from '../effects/contract.js';
import { bindDuelPrintedCost } from './printed-costs.js';
import { DUEL_DOMAINS, type DuelPowerRequirement } from './resources.js';
import { CostPlanError, type CostAmount, type CostPlanInput, type NonstandardCostAction } from './plan-types.js';

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
  return value.map(item => ({ amount: 1, allowedDomains: domains([item]) }));
}

function reference(value: unknown, ctx: ResolveContext): ObjectRef {
  if (value === 'self') return { ...ctx.source.ref };
  if (!value || typeof value !== 'object' || !('id' in value) || !('zoneEntryId' in value)) return invalid('Cost requires an exact object reference');
  const object = value as ObjectRef;
  identifier(object.id);
  count(object.zoneEntryId, 'zoneEntryId');
  return { id: object.id, zoneEntryId: object.zoneEntryId };
}

function choiceObjects(ctx: ResolveContext, choice: PickSpec, planId: string): ObjectRef[] {
  identifier(choice.id);
  const options = choice.options.map(option => reference(option, ctx));
  if (choice.selection !== undefined && !['one', 'any', 'all', 'up-to'].includes(choice.selection)) blocked('Unsupported cost selection mode');
  const minimum = count(choice.min ?? (choice.selection === 'all' ? options.length : choice.selection === 'up-to' || choice.selection === 'any' ? 0 : 1), 'Choice minimum');
  const maximum = count(choice.max === null ? options.length : choice.max ?? (choice.selection === 'all' || choice.selection === 'any' ? options.length : 1), 'Choice maximum');
  if (minimum > maximum || maximum > options.length) invalid('Invalid cost choice bounds');
  const picks = ctx.picks(choice.id);
  const selected: unknown = picks.length ? picks : ctx.choose<readonly ObjectRef[]>({
    id: `${planId}:pick:${choice.id}`, type: 'select-objects', chooser: ctx.controller,
    visibility: 'chooser-only', options, min: minimum, max: maximum
  });
  if (!Array.isArray(selected)) invalid('Cost choice must be an object list');
  const refs = selected.map(item => reference(item, ctx));
  const keys = refs.map(ref => `${ref.id}:${ref.zoneEntryId}`);
  if (refs.length < minimum || refs.length > maximum || new Set(keys).size !== keys.length || refs.some(ref => !options.some(option => option.id === ref.id && option.zoneEntryId === ref.zoneEntryId))) invalid('Invalid cost object selection');
  return refs;
}

function paymentObjects(ctx: ResolveContext, payment: CostPayment, input: CostPlanInput): ObjectRef[] {
  if (payment.choice !== undefined) return choiceObjects(ctx, payment.choice, input.id);
  if (payment.objects !== undefined) {
    if (!Array.isArray(payment.objects)) invalid('Cost objects must be an array');
    return payment.objects.map(item => reference(item, ctx));
  }
  return [reference(payment.object ?? 'self', ctx)];
}

export function readCost(ctx: ResolveContext, spec: CostSpec, input: CostPlanInput, componentId: string): CostAmount | null {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) invalid('Expected a CostSpec');
  const known = ['kind', 'payments', 'energy', 'power', 'discard'];
  for (const key of Object.keys(spec)) if (!known.includes(key)) blocked(`Unsupported CostSpec field: ${key}`);
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
  const payments = [...(spec.payments ?? []), ...(spec.discard ? [{ kind: 'discard', choice: spec.discard }] : [])];
  for (const [index, payment] of payments.entries()) {
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
      const amount = count(expression === undefined ? 1 : ctx.evaluate(expression), 'Power');
      if (amount) power = [...power, { amount, allowedDomains: payment.allowedDomains === undefined ? ownDomains(input) : domains(payment.allowedDomains) }];
    } else if (['exhaust', 'discard', 'recycle', 'kill', 'reveal', 'spend-buff'].includes(kind)) {
      if (payment.allowedDomains !== undefined) invalid('A nonstandard cost cannot select Power domains');
      if ([payment.choice, payment.object, payment.objects].filter(value => value !== undefined).length > 1) invalid('A nonstandard cost must use exactly one object selection form');
      if (input.ignoreAllCosts) continue;
      const objects = paymentObjects(ctx, payment, input);
      const identities = objects.map(object => `${object.id}:${object.zoneEntryId}`);
      if (new Set(identities).size !== identities.length) invalid('The same object cannot be selected twice for one cost');
      const amount = expression === undefined ? undefined : count(ctx.evaluate(expression), 'Nonstandard cost amount');
      if (kind !== 'spend-buff' && amount !== undefined && amount !== objects.length) invalid('Every object in a nonstandard cost must be selected');
      for (const [objectIndex, object] of objects.entries()) {
        const action: NonstandardCostAction = kind === 'reveal'
          ? { type: 'reveal', object }
          : kind === 'spend-buff' ? { type: 'spend-buff', object, amount: amount ?? 1 }
          : { type: kind as 'exhaust' | 'discard' | 'recycle' | 'kill', object };
        actions.push({ id: `${componentId}:payment:${index}:${objectIndex}`, componentId, action });
      }
    } else blocked(`Unsupported payment kind: ${payment.kind}`);
  }
  return { energy, power, xp, actions };
}

export function combineCosts(costs: readonly CostAmount[]): CostAmount {
  return costs.reduce((total, cost) => ({ energy: add(total.energy, cost.energy), power: [...total.power, ...cost.power], xp: add(total.xp, cost.xp), actions: [...total.actions, ...cost.actions] }), emptyCost());
}

export function orderedById<T extends { readonly id: string }>(values: readonly T[], order?: readonly string[]): T[] {
  const ids = values.map(value => identifier(value.id));
  if (new Set(ids).size !== ids.length) invalid('Duplicate cost IDs');
  if (order === undefined) return [...values];
  if (order.length !== ids.length || new Set(order).size !== order.length || order.some(id => !ids.includes(id))) invalid('Cost order must contain each ID exactly once');
  return order.map(id => values.find(value => value.id === id)!);
}
