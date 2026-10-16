import type { CostSpec } from '@riftbound/card-dsl';
import type { ResolveContext } from '../effects/contract.js';
import type { DuelPowerRequirement } from './resources.js';
import {
  CostPlanError, type AppliedCostDiscount, type CostAmount, type CostComponent,
  type CostDiscount, type CostPlan, type CostPlanInput
} from './plan-types.js';
import {
  add, blocked, combineCosts, count, domains, emptyCost, freezeCost,
  identifier, invalid, orderedById, ownDomains, readCost
} from './plan-values.js';

function applyDiscount(ctx: ResolveContext, cost: CostAmount, discount: CostDiscount, applied: AppliedCostDiscount[], planId: string): CostAmount {
  if (discount.resource !== 'energy' && discount.resource !== 'power') invalid('Discounts can only reduce Energy or Power');
  const amount = count(ctx.evaluate(discount.amount), 'Discount');
  const minimum = discount.minimum === undefined ? 0 : count(ctx.evaluate(discount.minimum), 'Discount minimum');
  const selectedDomains = discount.domains === undefined ? undefined : domains(discount.domains);
  if (discount.resource === 'energy' && (selectedDomains || discount.powerOrder !== undefined)) invalid('Energy discounts cannot select Power domains or requirements');
  const before = discount.resource === 'energy' ? cost.energy : cost.power.reduce((total, requirement) => add(total, requirement.amount), 0);
  let reduction = Math.min(amount, Math.max(0, before - minimum));
  let result: CostAmount;
  if (discount.resource === 'energy') result = { ...cost, energy: before - reduction };
  else {
    const remaining = cost.power.map(requirement => requirement.amount);
    const eligible: number[] = [];
    for (const [index, requirement] of cost.power.entries()) {
      const overlap = selectedDomains?.filter(domain => requirement.allowedDomains.includes(domain));
      if (selectedDomains && overlap!.length > 0 && overlap!.length < requirement.allowedDomains.length && reduction > 0) {
        blocked('Discounting a particular domain from a multi-domain requirement needs an explicit cost-domain choice');
      }
      if (!selectedDomains || overlap!.length) eligible.push(index);
    }
    if (discount.powerOrder !== undefined) {
      if (discount.powerOrder.length !== cost.power.length || new Set(discount.powerOrder).size !== cost.power.length || discount.powerOrder.some(index => !Number.isSafeInteger(index) || index < 0 || index >= cost.power.length)) invalid('Power discount order must contain every requirement index exactly once');
      eligible.sort((first, second) => discount.powerOrder!.indexOf(first) - discount.powerOrder!.indexOf(second));
    }
    let step = 0;
    while (reduction > 0 && eligible.length) {
      let index = eligible[0]!;
      const eligibleTotal = eligible.reduce((total, candidate) => add(total, remaining[candidate]!), 0);
      const distinctRequirements = new Set(eligible.map(candidate => [...cost.power[candidate]!.allowedDomains].sort().join(':')));
      if (discount.powerOrder === undefined && reduction < eligibleTotal && distinctRequirements.size > 1) {
        index = ctx.choose<number>({ id: `${planId}:discount:${discount.id}:${discount.component ?? 'total'}:power:${step}`, type: 'mode', chooser: ctx.controller, visibility: 'public', options: [...eligible] });
        if (!eligible.includes(index)) invalid('Power discount selected an ineligible requirement');
      }
      const removed = Math.min(reduction, remaining[index]!);
      remaining[index] = remaining[index]! - removed;
      reduction -= removed;
      eligible.splice(eligible.indexOf(index), 1);
      step++;
    }
    const power = cost.power.flatMap((requirement, index) => remaining[index]! > 0 ? [{ ...requirement, amount: remaining[index]! }] : []);
    result = { ...cost, power };
  }
  const after = discount.resource === 'energy' ? result.energy : result.power.reduce((total, requirement) => add(total, requirement.amount), 0);
  applied.push({ id: discount.id, component: discount.component ?? null, resource: discount.resource, amount, minimum, before, after });
  return result;
}

export function buildCostPlan(ctx: ResolveContext, input: CostPlanInput): CostPlan {
  identifier(input.id);
  const componentIds = ['base', ...(input.optionalAdditional ?? []).map(cost => cost.id), ...(input.mandatoryAdditional ?? []).map(cost => cost.id), ...(input.increases ?? []).map(cost => cost.id)];
  orderedById(componentIds.map(id => ({ id })));
  const discounts = orderedById(input.discounts ?? [], input.discountOrder);
  for (const discount of discounts) {
    if (discount.component !== undefined && !componentIds.includes(discount.component)) invalid('Discount refers to an unknown cost component');
  }
  const applied: AppliedCostDiscount[] = [];
  const components: CostComponent[] = [];
  function addComponent(id: string, kind: string, stage: CostComponent['stage'], original: CostAmount): void {
    const cost = discounts.filter(discount => discount.component === id).reduce((value, discount) => applyDiscount(ctx, value, discount, applied, input.id), original);
    components.push({ id, stage, kind, original, cost });
  }
  let spec = input.cost;
  if (input.baseChoices !== undefined) {
    const choices = orderedById(input.baseChoices);
    if (!choices.length) invalid('Base cost choices cannot be empty');
    const choice = input.baseChoice ?? ctx.choose<string>({ id: `${input.id}:base`, type: 'mode', chooser: ctx.controller, visibility: 'public', options: choices.map(item => item.id) });
    const selected = choices.find(item => item.id === choice);
    if (!selected) invalid('Unknown base cost choice');
    spec = selected.cost;
  } else if (input.baseChoice !== undefined) invalid('Base choice supplied without cost choices');
  const base = readCost(ctx, spec, input, 'base');
  let modified = base;
  for (const modification of input.baseModifications ?? []) {
    if (modification.kind === 'alternate' || modification.kind === 'flow') {
      identifier(modification.id);
      if (modification.kind === 'flow' && (ctx.source.zone !== 'trash' || !ctx.source.types.some(type => type.toLowerCase() === 'spell'))) invalid('Flow replaces the base cost only when playing a spell from Trash');
      modified = readCost(ctx, modification.cost, input, 'base');
      if (modified === null) invalid('An alternate cost must provide an explicit payable cost');
    } else if (modification.kind === 'ignore-base') {
      if (!['energy', 'power', 'resources'].includes(modification.ignore)) invalid('Unknown base cost modification');
      modified = { ...(modified ?? emptyCost()), ...(modification.ignore !== 'power' ? { energy: 0 } : {}), ...(modification.ignore !== 'energy' ? { power: [] } : {}) };
      if (base === null && modification.ignore === 'power') modified = null;
    } else blocked('Unsupported base cost modification');
  }
  if (modified === null) throw new CostPlanError('missing-printed-cost', 'The source has no printed Energy cost; an explicit alternate cost is required');
  addComponent('base', spec.kind ?? 'explicit', 'base', modified);
  const selectedAdditional: CostPlan['selectedAdditional'][number][] = [];
  const declinedAdditional: string[] = [];
  if ((input.optionalAdditional ?? []).filter(cost => cost.kind === 'accelerate').length > 1) invalid('Multiple instances of Accelerate are redundant');
  for (const optional of input.optionalAdditional ?? []) {
    if (!['additional', 'repeat', 'accelerate'].includes(optional.kind)) blocked('Unsupported optional cost kind');
    const selected = optional.selected ?? ctx.choose<boolean>({ id: `${input.id}:optional:${optional.id}`, type: 'optional', chooser: ctx.controller, visibility: 'public' });
    if (typeof selected !== 'boolean') invalid('An optional cost can only be paid once');
    if (!selected) { declinedAdditional.push(optional.id); continue; }
    let optionalSpec = optional.cost;
    if (optional.kind === 'accelerate' && optionalSpec === undefined) {
      optionalSpec = { energy: { kind: 'constant', value: 1 }, payments: [{ kind: 'power', allowedDomains: ownDomains(input) }] };
    }
    if (!optionalSpec) invalid('An optional additional cost must specify its payments');
    const cost = readCost(ctx, optionalSpec, input, optional.id);
    if (cost === null) invalid('Additional costs must be explicit');
    selectedAdditional.push({ id: optional.id, kind: optional.kind });
    addComponent(optional.id, optional.kind, 'optional-additional', cost);
  }
  for (const [stage, values] of [['mandatory-additional', input.mandatoryAdditional ?? []], ['increase', input.increases ?? []]] as const) {
    for (const component of values) {
      const cost = readCost(ctx, component.cost, input, component.id);
      if (cost === null) invalid('Additional costs and increases must be explicit');
      addComponent(component.id, component.cost.kind ?? 'explicit', stage, cost);
    }
  }
  let total = combineCosts(components.map(component => component.cost));
  for (const discount of discounts.filter(discount => discount.component === undefined)) total = applyDiscount(ctx, total, discount, applied, input.id);
  if (input.ignoreAllCosts) total = emptyCost();
  const printed = input.printed ? { energy: input.printed.energy, power: input.printed.power } : { energy: ctx.source.energy, power: ctx.source.power };
  return freezeCost(structuredClone({
    finalized: true as const, id: input.id, player: ctx.controller, source: ctx.source.ref,
    printed, base, components, selectedAdditional, declinedAdditional,
    modifications: input.baseModifications ?? [], discounts: applied,
    stages: ['base', 'alternate', 'optional-additional', 'mandatory-additional', 'increase', 'discount', 'total'] as const,
    total
  }));
}

export function buildHiddenCostPlan(ctx: ResolveContext, input: Omit<CostPlanInput, 'cost'> & { readonly mode: 'hide' | 'play'; readonly cost?: CostSpec }): CostPlan {
  if (input.mode === 'hide') {
    return buildCostPlan(ctx, { ...input, cost: { payments: [{ kind: 'power', allowedDomains: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'] }] } });
  }
  if (input.mode !== 'play') invalid('Unknown Hidden cost mode');
  return buildCostPlan(ctx, { ...input, cost: input.cost ?? { kind: 'printed' }, baseModifications: [{ kind: 'ignore-base', ignore: 'resources' }, ...(input.baseModifications ?? [])] });
}
