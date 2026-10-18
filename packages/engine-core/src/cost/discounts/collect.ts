import type { Ability, CostSpec } from '@riftbound/card-dsl';
import type { Domain, ObjectRef, ObjectSnapshot, ResolveContext, ZoneId } from '../../effects/contract.js';
import type { RegisteredContinuousEffect } from '../../layers/types.js';
import { isDurationActive } from '../../layers/duration.js';
import { buildCostPlan } from '../cost-plan.js';
import type { CostDiscount, CostPlan, CostPlanInput } from '../plan-types.js';
import { blocked, costInteger, costLiteral, literal, matchesCostFilter, record, sameRef, testCostCondition, turnPlays, type CostEnvironment, type FinalizedCardPlay } from './values.js';

export interface StaticCostAbility {
  readonly id: string;
  readonly source: ObjectRef;
  readonly ability: Extract<Ability, { kind: 'static' }>;
}

export interface CostDiscountSources {
  /** Include active Board abilities and the card being played's own cost abilities. */
  readonly statics?: readonly StaticCostAbility[];
  /** Use the layer registry after it has processed expiration timing points. */
  readonly continuous?: readonly RegisteredContinuousEffect[];
  readonly finalizedPlaysThisTurn?: readonly FinalizedCardPlay[];
  /** Pre-chain origin is required for fromZone conditions. */
  readonly originZone?: ZoneId;
  /** All actual targets locked by this Finalize; omission means unavailable. */
  readonly targets?: readonly ObjectRef[];
  readonly purpose?: 'play' | 'activate';
}

const DOMAINS: readonly Domain[] = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];
const KINDS = new Set(['continuous.cost-modification', 'cost.modify']);
const FIELDS = new Set(['kind', 'resource', 'amount', 'minimum', 'stage', 'appliesTo', 'filter', 'component', 'alternative', 'universal', 'domain', 'domains', 'fromZone', 'when', 'per', 'duration', 'value', 'reductions', 'history', 'grantedBy', 'window']);
const ADDITIONAL_FIELDS = new Set(['kind', 'id', 'appliesTo', 'optional', 'stage', 'payments', 'filter', 'fromZone', 'when']);
const ONE_SHOT_WINDOWS = new Set(['next-card-played-this-turn', 'next-unit-played-this-turn', 'next-spell-played-this-turn', 'next-gear-played-this-turn', 'per-turn-first-play']);

export interface CostPlanMetadata {
  readonly additional: Readonly<Record<string, { readonly sourceId: string }>>;
  readonly grantedBy: Readonly<Record<string, string>>;
}

interface CollectedCostPlanInput extends CostPlanInput {
  /** Private hand-off from collection to Finalize; ignored by buildCostPlan. */
  readonly __costDiscountMetadata?: CostPlanMetadata;
}

function freezePlan<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) freezePlan(child);
    Object.freeze(value);
  }
  return value;
}

export function decorateCostPlan(plan: CostPlan, metadata: CostPlanMetadata | undefined): CostPlan {
  if (metadata === undefined || (Object.keys(metadata.additional).length === 0 && Object.keys(metadata.grantedBy).length === 0)) return plan;
  const copy = structuredClone(plan) as unknown as {
    selectedAdditional: Array<Record<string, unknown>>;
    discounts: Array<Record<string, unknown>>;
    components: CostPlan['components'];
  };
  copy.selectedAdditional = copy.selectedAdditional.map(entry => {
    if (metadata.additional[String(entry.id)] === undefined) return entry;
    const component = copy.components.find(item => item.id === String(entry.id));
    // The component's frozen CostAmount is the exact amount that Finalize
    // committed for this optional decision. Payment later adds `paid: true`
    // without losing this quantity (356.4.f.1).
    return { ...entry, paidAmount: component?.cost };
  });
  copy.discounts = copy.discounts.map(discount => {
    const grantedBy = metadata.grantedBy[String(discount.id)];
    return grantedBy === undefined ? discount : { ...discount, grantedBy };
  });
  return freezePlan(copy) as unknown as CostPlan;
}

function windowMatches(effect: Record<string, unknown>, env: CostEnvironment, sources: CostDiscountSources): boolean {
  const duration = literal(effect.duration);
  const window = literal(effect.window) ?? (ONE_SHOT_WINDOWS.has(String(duration)) ? duration : undefined);
  if (window === undefined) return true;
  if (!ONE_SHOT_WINDOWS.has(String(window))) blocked(`Unsupported static cost window ${String(window)}`);
  if (sources.purpose === 'activate') blocked('Card-play cost windows do not cover activated abilities');
  const current = env.ctx.source;
  if (window === 'next-unit-played-this-turn' && !current.types.includes('unit')) return false;
  if (window === 'next-spell-played-this-turn' && !current.types.includes('spell')) return false;
  if (window === 'next-gear-played-this-turn' && !current.types.includes('gear')) return false;
  const previous = turnPlays(env).some(play => play.player === env.ctx.controller &&
    (window === 'next-card-played-this-turn' || window === 'per-turn-first-play' ||
      (window === 'next-unit-played-this-turn' && play.object.types.includes('unit')) ||
      (window === 'next-spell-played-this-turn' && play.object.types.includes('spell')) ||
      (window === 'next-gear-played-this-turn' && play.object.types.includes('gear'))) &&
    matchesCostFilter(effect.filter ?? {}, play.object, env));
  return !previous;
}

function scopeMatches(effect: Record<string, unknown>, env: CostEnvironment, sources: CostDiscountSources): boolean {
  const scope = literal(effect.appliesTo);
  if (sources.purpose === 'activate' && scope !== 'activated-ability-cost') return false;
  if (scope === 'self' || scope === 'source' || scope === 'self-play-cost') {
    if (!sameRef(env.source.ref, env.ctx.source.ref)) return false;
  } else if (scope === 'activated-ability-cost') {
    if (sources.purpose !== 'activate') return false;
  } else if (scope === 'spell-play-cost') {
    if (sources.purpose === 'activate' || !env.ctx.source.types.includes('spell')) return false;
  } else if (scope === 'play-cost' || scope === 'optional-additional-costs-you-pay') {
    if (sources.purpose === 'activate') return false;
    if (scope === 'optional-additional-costs-you-pay' && env.ctx.controller !== env.source.controller) return false;
  } else if (typeof scope === 'string' && ONE_SHOT_WINDOWS.has(scope)) {
    if (!windowMatches({ ...effect, window: scope }, env, sources)) return false;
  } else if (scope !== undefined) {
    const filter = { ...record(scope) };
    // "Your spells that choose me" is a relation to the locked target set.
    if (filter.object === 'self' && filter.type === 'spell') {
      if (sources.targets === undefined) blocked('Target-conditional costs require the locked Finalize target set');
      if (env.ctx.controller !== env.source.controller || !sources.targets.some(ref => sameRef(ref, env.source.ref))) return false;
      delete filter.object;
    }
    if (!matchesCostFilter(filter, env.ctx.source, env)) return false;
  }
  if (effect.filter !== undefined && !matchesCostFilter(effect.filter, env.ctx.source, env)) return false;
  if (effect.fromZone !== undefined) {
    if (sources.originZone === undefined) blocked('Cost fromZone requires the pre-chain origin zone');
    if (effect.fromZone === 'not-hand') { if (sources.originZone === 'hand') return false; }
    else if (effect.fromZone !== sources.originZone) return false;
  }
  return true;
}

function powerDomains(effect: Record<string, unknown>): readonly Domain[] | undefined {
  const domain = literal(effect.domain);
  const value = literal(effect.domains) ?? (domain === undefined || domain === 'any' ? undefined : [domain]);
  if (effect.universal !== undefined && literal(effect.universal) !== true) blocked('Unsupported universal Power modifier');
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.some(item => !DOMAINS.includes(item as Domain))) blocked('Unknown cost modification Power domain');
  if ((effect.universal === true || domain === 'any') && DOMAINS.some(item => !value.includes(item))) blocked('Universal Power cannot restrict domains');
  return [...new Set(value)] as Domain[];
}

/** Convert active declarations to existing CostPlanInput; never pays or consumes a use. */
export function collectCostModifications(ctx: ResolveContext, input: CostPlanInput, sources: CostDiscountSources = {}): CostPlanInput {
  const discounts: CostDiscount[] = [...(input.discounts ?? [])];
  const increases = [...(input.increases ?? [])];
  const seen = new Set<string>();
  const grantedBy: Record<string, string> = {};
  const additionalMetadata: Record<string, { sourceId: string }> = {};
  const optionalAdditional = [...(input.optionalAdditional ?? [])];
  const mandatoryAdditional = [...(input.mandatoryAdditional ?? [])];
  const optionalById = new Map(optionalAdditional.map(cost => [cost.id, cost]));
  const mandatoryById = new Map(mandatoryAdditional.map(cost => [cost.id, cost]));
  const staticAdditionalIds = new Set<string>();

  function validateAdditionalFields(effect: Record<string, unknown>): void {
    for (const key of Object.keys(effect)) if (!ADDITIONAL_FIELDS.has(key)) blocked(`Unsupported additional cost field ${key}`);
    if (typeof effect.id !== 'string' || !effect.id.trim()) blocked('Additional costs require a stable id');
    if (effect.optional !== true && effect.optional !== false) blocked('Additional costs require an explicit optional flag');
    const stage = literal(effect.stage);
    if (stage !== 'optional-additional' && stage !== 'mandatory-additional') blocked('Additional costs require an explicit stage');
    if ((effect.optional === true) !== (stage === 'optional-additional')) blocked('Additional cost optional flag does not match its stage');
    if (!Array.isArray(effect.payments) || effect.payments.length === 0) blocked('Additional costs require payment entries');
  }

  function registerAdditional(effect: Record<string, unknown>, sourceId: string): void {
    validateAdditionalFields(effect);
    const id = effect.id as string;
    if (staticAdditionalIds.has(id)) blocked('Additional cost sources require unique stable ids');
    staticAdditionalIds.add(id);
    const stage = literal(effect.stage);
    if (stage === 'optional-additional') {
      const existing = optionalById.get(id);
      if (existing !== undefined) {
        if (existing.selected === undefined) {
          const selected = ctx.choose<boolean>({ id: `${input.id}:optional:${id}`, type: 'optional', chooser: ctx.controller, visibility: 'public' });
          if (typeof selected !== 'boolean') blocked('An optional additional cost can only be selected once');
          const resolved = { ...existing, selected };
          const index = optionalAdditional.findIndex(cost => cost.id === id);
          if (index >= 0) optionalAdditional[index] = resolved;
          optionalById.set(id, resolved);
        }
        if (optionalById.get(id)?.selected === true) validateDynamicChoice(effect);
        additionalMetadata[id] = { sourceId };
        return;
      }
    } else {
      const existing = mandatoryById.get(id);
      if (existing !== undefined) {
        additionalMetadata[id] = { sourceId };
        return;
      }
    }
    if (stage === 'optional-additional') {
      const selected = ctx.choose<boolean>({ id: `${input.id}:optional:${id}`, type: 'optional', chooser: ctx.controller, visibility: 'public' });
      if (typeof selected !== 'boolean') blocked('An optional additional cost can only be selected once');
      if (selected) validateDynamicChoice(effect);
      const value = { id, kind: 'additional' as const, selected, cost: { kind: 'explicit' as const, payments: effect.payments as CostSpec['payments'] } };
      optionalAdditional.push(value);
      optionalById.set(id, value);
    } else {
      const value = { id, cost: { kind: 'explicit' as const, payments: effect.payments as CostSpec['payments'] } };
      mandatoryAdditional.push(value);
      mandatoryById.set(id, value);
    }
    additionalMetadata[id] = { sourceId };
  }

  function validateDynamicChoice(effect: Record<string, unknown>): void {
    for (const payment of effect.payments as readonly Record<string, unknown>[]) {
      const choice = payment?.choice;
      const choiceRecord = choice !== null && typeof choice === 'object' && !Array.isArray(choice) ? choice as Record<string, unknown> : undefined;
      const options = choiceRecord?.options;
      if (choice !== undefined && (choiceRecord === undefined || !Array.isArray(options) ||
        options.some((option: unknown) => option === null || typeof option !== 'object'))) {
        blocked('Dynamic additional-cost choices require a Finalize object-candidate adapter');
      }
    }
  }

  function additionalSelected(id: string): boolean {
    const optional = optionalById.get(id);
    if (optional !== undefined) return optional.selected === true;
    if (mandatoryById.has(id)) return true;
    blocked(`Cost discount grants unknown additional cost ${id}`);
  }

  // Static cost.additional declarations are collected before modifiers so a
  // grantedBy discount can read the player's actual optional decision.
  for (const binding of sources.statics ?? []) {
    const source = ctx.object(binding.source);
    if (source === null) continue;
    if (source.zone !== 'board' && !sameRef(source.ref, ctx.source.ref)) continue;
    const effect = record(binding.ability.effect);
    if (effect.kind !== 'cost.additional') continue;
    const env: CostEnvironment = { ctx, source, finalizedPlaysThisTurn: sources.finalizedPlaysThisTurn };
    if (!scopeMatches(effect, env, sources)) continue;
    if (binding.ability.condition !== undefined && !testCostCondition(binding.ability.condition, env)) continue;
    if (effect.when !== undefined && !testCostCondition(literal(effect.when), env)) continue;
    registerAdditional(effect, binding.id);
  }

  // Explicit caller-supplied optional entries still need to be decided before
  // collecting modifiers. Static declarations above are the only entries for
  // which this collector is allowed to ask the Finalize optional prompt.
  if (optionalAdditional.some(cost => cost.selected === undefined)) {
    blocked('Cost modifier collection requires optional additional cost decisions before collection');
  }

  function collect(id: string, raw: unknown, source: ObjectSnapshot, condition?: unknown): void {
    const effect = record(raw);
    if (!KINDS.has(String(effect.kind))) return;
    if (!id.trim() || seen.has(id)) blocked('Cost modification sources require unique stable ids');
    seen.add(id);
    const env: CostEnvironment = { ctx, source, finalizedPlaysThisTurn: sources.finalizedPlaysThisTurn };
    for (const key of Object.keys(effect)) if (!FIELDS.has(key)) blocked(`Unsupported cost modification field ${key}`);
    if (!scopeMatches(effect, env, sources)) return;
    if (condition !== undefined && !testCostCondition(condition, env)) return;
    if (effect.when !== undefined && !testCostCondition(literal(effect.when), env)) return;
    if (!windowMatches(effect, env, sources)) return;
    const duration = literal(effect.duration);
    if (duration !== undefined && duration !== 'permanent' && !ONE_SHOT_WINDOWS.has(String(duration))) blocked(`Unsupported static cost window ${String(duration)}`);
    if (effect.history !== undefined) {
      const item = record(literal(effect.history));
      if (item.scope !== 'turn' || item.action !== 'play' || item.player !== 'controller') blocked('Unsupported cost history source');
      const serialized = JSON.stringify(effect.value ?? effect.amount ?? {});
      if ((effect.value as { kind?: unknown } | undefined)?.kind !== 'arithmetic' && !serialized.includes('cards-played-this-turn')) blocked('Cost history metadata requires a cards-played-this-turn expression');
    }

    const componentScope = literal(effect.component) ?? (literal(effect.appliesTo) === 'optional-additional-costs-you-pay' ? 'optional-additional' : undefined);
    const components = componentScope === 'optional-additional'
      ? (input.optionalAdditional ?? []).filter(component => component.selected !== false).map(component => component.id) : [componentScope];
    for (const component of components) if (component !== undefined && typeof component !== 'string') blocked('Cost discount component must be an id');

    let modifiers: Record<string, unknown>[];
    if (effect.reductions !== undefined) {
      if (!Array.isArray(effect.reductions) || effect.reductions.length === 0) blocked('Cost reductions require entries');
      modifiers = effect.reductions.map(value => record(value));
    } else if (effect.value !== undefined && effect.resource === undefined) {
      const value = record(literal(effect.value));
      if (Object.keys(value).some(resource => resource !== 'energy' && resource !== 'power')) blocked('Unsupported cost.modify value');
      modifiers = Object.entries(value).map(([resource, amount]) => ({ resource, amount }));
    } else modifiers = [effect];

    for (const [modifierIndex, modifier] of modifiers.entries()) {
      if (modifier !== effect && Object.keys(modifier).some(key => !['resource', 'amount', 'domain', 'domains', 'universal', 'minimum'].includes(key))) blocked('Unsupported cost reduction entry');
      let grantedById: string | undefined;
      if (effect.grantedBy !== undefined) {
        const grant = literal(effect.grantedBy);
        if (typeof grant !== 'string' || !grant.trim()) blocked('Cost grants require a stable additional cost id');
        grantedById = grant;
        if (!additionalSelected(grant)) continue;
      }
      let amount = costInteger(modifier.amount, env, true);
      if (effect.per !== undefined) amount *= costInteger(effect.per, env);
      if (!Number.isSafeInteger(amount)) blocked('Cost modification amount overflow');
      const stage = literal(effect.stage);
      if (stage !== undefined && !['discount', 'increase', 'total-cost'].includes(String(stage))) blocked('Unsupported cost modification stage');
      const discount = stage === 'discount' || (stage !== 'increase' && amount < 0);
      if ((stage === 'increase' && amount < 0) || (stage === 'discount' && amount < 0)) blocked('Explicit cost stages require nonnegative amounts');
      if (amount === 0) continue;
      for (const component of components) {
        const modifierId = `${id}:${modifierIndex}:${component ?? 'total'}`;
        let selected = modifier;
        let selectedAmount = amount;
        if (effect.alternative !== undefined) {
          if (!discount) blocked('Alternative resources require a discount');
          const alternative = record(literal(effect.alternative));
          if (Object.keys(alternative).some(key => !['resource', 'amount', 'domain', 'domains', 'universal', 'minimum'].includes(key))) blocked('Unsupported alternative cost discount');
          const choice = ctx.choose<string>({ id: `${input.id}:modifier:${modifierId}:resource`, type: 'mode', chooser: ctx.controller, visibility: 'public', options: ['primary', 'alternative'] });
          if (choice !== 'primary' && choice !== 'alternative') blocked('Invalid alternative discount resource choice');
          if (choice === 'alternative') { selected = alternative; selectedAmount = costInteger(alternative.amount, env); }
        }
        const resource = literal(selected.resource);
        if (resource !== 'energy' && resource !== 'power') blocked('Costs can only modify Energy or Power');
        const domains = powerDomains(selected);
        if (resource === 'energy' && (domains !== undefined || selected.universal !== undefined || selected.domain !== undefined)) blocked('Energy modifiers cannot select Power domains');
        const magnitude = Math.abs(selectedAmount);
        const minimum = costInteger(selected.minimum ?? effect.minimum ?? 0, env);
        if (discount) {
          discounts.push({ id: modifierId, resource, amount: costLiteral(magnitude), ...(minimum === 0 ? {} : { minimum: costLiteral(minimum) }), ...(component === undefined ? {} : { component: component as string }), ...(domains === undefined ? {} : { domains }) });
          if (grantedById !== undefined) grantedBy[modifierId] = grantedById;
        }
        else {
          if (minimum !== 0 || component !== undefined) blocked('Cost increases cannot carry a discount minimum or component');
          increases.push({ id: modifierId, cost: resource === 'energy' ? { energy: costLiteral(magnitude) } : { payments: [{ kind: 'power', amount: costLiteral(magnitude), allowedDomains: domains ?? DOMAINS }] } });
        }
      }
    }
  }

  for (const binding of sources.statics ?? []) {
    const source = ctx.object(binding.source);
    if (source === null) continue;
    if (source.zone !== 'board' && !sameRef(source.ref, ctx.source.ref)) continue;
    collect(binding.id, binding.ability.effect, source, binding.ability.condition);
  }
  for (const entry of sources.continuous ?? []) {
    if (!KINDS.has(entry.effect.effect.kind)) continue;
    if (!isDurationActive(entry.duration, undefined, ref => ref === undefined ? null : ctx.object(ref))) continue;
    if (entry.effect.source === undefined) blocked('Continuous cost modifications require source identity');
    // A resolved temporary effect outlives its source; static sources never use LKI here.
    const source = ctx.object(entry.effect.source) ?? ctx.lastKnown(entry.effect.source);
    const env: CostEnvironment = { ctx, source, finalizedPlaysThisTurn: sources.finalizedPlaysThisTurn };
    if (!matchesCostFilter(entry.effect.filter, ctx.source, env)) continue;
    collect(entry.effect.id, entry.effect.effect, source);
  }
  const collected: CollectedCostPlanInput = {
    ...input,
    optionalAdditional,
    mandatoryAdditional,
    discounts,
    increases,
    __costDiscountMetadata: { additional: additionalMetadata, grantedBy }
  };
  return collected;
}

/** Finalize-facing entry: collect once, choose discount order, then freeze the existing CostPlan. */
export function finalizeCostPlan(ctx: ResolveContext, input: CostPlanInput, sources: CostDiscountSources = {}): CostPlan {
  const collected = collectCostModifications(ctx, input, sources) as CollectedCostPlanInput;
  const metadata = collected.__costDiscountMetadata;
  if (collected.discountOrder !== undefined) return decorateCostPlan(buildCostPlan(ctx, collected), metadata);
  const groups = new Map<string, CostDiscount[]>();
  for (const discount of collected.discounts ?? []) {
    const key = JSON.stringify([discount.component, discount.resource]);
    groups.set(key, [...(groups.get(key) ?? []), discount]);
  }
  const order: string[] = [];
  for (const group of groups.values()) {
    const remaining = [...group].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    // Per-discount minima and domain restrictions can make order observable (356.4.d/e).
    const needsChoice = group.length > 1 && group.some(discount => discount.minimum !== undefined || discount.domains !== undefined);
    while (remaining.length) {
      const id = needsChoice && remaining.length > 1 ? ctx.choose<string>({ id: `${input.id}:discount-order:${order.length}`, type: 'mode', chooser: ctx.controller, visibility: 'public', options: remaining.map(discount => discount.id) }) : remaining[0]!.id;
      const index = remaining.findIndex(discount => discount.id === id);
      if (index < 0) blocked('Invalid discount order choice');
      order.push(remaining.splice(index, 1)[0]!.id);
    }
  }
  return decorateCostPlan(buildCostPlan(ctx, { ...collected, discountOrder: order }), metadata);
}
