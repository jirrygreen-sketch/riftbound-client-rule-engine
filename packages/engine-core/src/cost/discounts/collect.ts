import type { Ability } from '@riftbound/card-dsl';
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
const FIELDS = new Set(['kind', 'resource', 'amount', 'minimum', 'stage', 'appliesTo', 'filter', 'component', 'alternative', 'universal', 'domain', 'domains', 'fromZone', 'when', 'per', 'duration', 'value', 'reductions', 'history']);

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
  if ((input.optionalAdditional ?? []).some(cost => cost.selected === undefined)) {
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
    const duration = literal(effect.duration);
    if (duration === 'per-turn-first-play') {
      if (sources.purpose === 'activate') blocked('First-play cost windows do not cover activated abilities');
      const previous = turnPlays(env).some(play => play.player === ctx.controller &&
        matchesCostFilter(effect.filter ?? {}, play.object, env));
      if (previous) return;
    } else if (duration !== undefined && duration !== 'permanent') blocked(`Unsupported static cost window ${String(duration)}`);
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
        if (discount) discounts.push({ id: modifierId, resource, amount: costLiteral(magnitude), ...(minimum === 0 ? {} : { minimum: costLiteral(minimum) }), ...(component === undefined ? {} : { component: component as string }), ...(domains === undefined ? {} : { domains }) });
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
  return { ...input, discounts, increases };
}

/** Finalize-facing entry: collect once, choose discount order, then freeze the existing CostPlan. */
export function finalizeCostPlan(ctx: ResolveContext, input: CostPlanInput, sources: CostDiscountSources = {}): CostPlan {
  const collected = collectCostModifications(ctx, input, sources);
  if (collected.discountOrder !== undefined) return buildCostPlan(ctx, collected);
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
  return buildCostPlan(ctx, { ...collected, discountOrder: order });
}
