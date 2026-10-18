import type { Expr, ObjectFilter, ObjectRef, PickSpec, Value } from '@riftbound/card-dsl';
import { matchesObjectPredicates } from '../effects/filters/predicates.js';
import type { ResolveContext } from '../effects/contract.js';
import { CostPlanError, type CostChoiceReceipt } from './plan-types.js';

export interface CostObjectChoice {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  readonly offered: readonly ObjectRef[];
  readonly selected: readonly ObjectRef[];
  readonly receipt: CostChoiceReceipt;
}

function fail(reason: 'invalid-cost-plan' | 'judge-required', message: string): never {
  throw new CostPlanError(reason, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRef(value: unknown): value is ObjectRef {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.zoneEntryId === 'number' && Number.isSafeInteger(value.zoneEntryId) && value.zoneEntryId >= 0;
}

function key(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function copy(ref: ObjectRef): ObjectRef {
  return { id: ref.id, zoneEntryId: ref.zoneEntryId };
}

function choiceFilter(choice: PickSpec): ObjectFilter | undefined {
  const raw = choice as unknown as Record<string, unknown>;
  const legacy: Record<string, unknown> = {};
  for (const field of [
    'type', 'types', 'zone', 'owner', 'controller', 'location', 'locationType',
    'states', 'state', 'tags', 'tag', 'keyword', 'keywords', 'hasKeyword',
    'damaged', 'buffed', 'empowered'
  ]) {
    if (raw[field] !== undefined) legacy[field] = raw[field];
  }
  const explicit = raw.filter;
  if (explicit !== undefined && (typeof explicit !== 'object' || explicit === null || Array.isArray(explicit))) {
    fail('invalid-cost-plan', `${choice.id} filter must be an object`);
  }
  if (explicit === undefined && Object.keys(legacy).length === 0) return undefined;
  return { ...legacy, ...(explicit as ObjectFilter | undefined) } as ObjectFilter;
}

function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('invalid-cost-plan', `${label} must be a nonnegative safe integer`);
  }
  return value;
}

function evaluatePlayer(ctx: ResolveContext, value: Expr | undefined): string {
  if (value === undefined) return ctx.controller;
  const evaluated = ctx.evaluate(value);
  if (typeof evaluated !== 'string' || evaluated.length === 0) {
    fail('invalid-cost-plan', 'Cost choice zoneSlice.player must evaluate to a player id');
  }
  return evaluated;
}

function linkedValues(ctx: ResolveContext, expression: PickSpec['linked'], id: string): readonly unknown[] {
  if (!expression || typeof expression !== 'object' || typeof expression.instructionId !== 'string' ||
      typeof expression.key !== 'string' || expression.key.length === 0) {
    fail('invalid-cost-plan', `${id} linked source needs an explicit result key`);
  }
  let result: Value;
  try {
    result = ctx.evaluate(expression as unknown as Expr);
  } catch (error) {
    if (error instanceof Error && /missing|unavailable/i.test(error.message)) {
      fail('invalid-cost-plan', `${id} linked result is unavailable`);
    }
    throw error;
  }
  if (!Array.isArray(result)) fail('invalid-cost-plan', `${id} linked result must be an object list`);
  return result;
}

function linkedRefs(ctx: ResolveContext, expression: PickSpec['linked'], id: string): ObjectRef[] {
  const values = linkedValues(ctx, expression, id);
  if (!values.every(isRef)) fail('invalid-cost-plan', `${id} linked result must contain object references`);
  return values.map(value => copy(value as ObjectRef));
}

function source(ctx: ResolveContext, choice: PickSpec): ObjectRef[] {
  if (choice.zoneSlice !== undefined) {
    const slice = choice.zoneSlice;
    const player = evaluatePlayer(ctx, slice.player);
    const countValue = slice.count === undefined ? undefined : count(ctx.evaluate(slice.count), 'Cost choice zoneSlice count');
    return ctx.zoneSlice(player, slice.zone, slice.from, countValue).map(object => copy(object.ref));
  }
  if (choice.linked !== undefined) {
    return linkedRefs(ctx, choice.linked, choice.id);
  }
  const filter = choiceFilter(choice);
  if (filter !== undefined) {
    // ResolveContext.query implementations vary in how much of ObjectFilter
    // they consume. Apply the shared predicate after reading the complete
    // object set so relative controller/owner selectors and richer filters are
    // evaluated with the resolving controller as their anchor.
    return ctx.query({}).filter(object => matchesObjectPredicates(
      filter, object, { controller: ctx.controller, anchor: ctx.source }
    )).map(object => copy(object.ref));
  }
  return choice.options.filter(isRef).map(ref => copy(ref as unknown as ObjectRef));
}

function selectedFromPicks(ctx: ResolveContext, id: string): ObjectRef[] | null {
  const picks = ctx.picks(id);
  if (!picks.length) return null;
  if (!picks.every(isRef)) fail('invalid-cost-plan', `${id} cost choice must contain object references`);
  return picks.map(copy);
}

export function chooseCostObjects(ctx: ResolveContext, choice: PickSpec, planId: string, kind: string, lockedReceipt?: CostChoiceReceipt): CostObjectChoice {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice) || typeof choice.id !== 'string' || !choice.id.length) {
    fail('invalid-cost-plan', 'Cost choice must have a nonempty id');
  }
  if (!Array.isArray(choice.options)) fail('invalid-cost-plan', 'Cost choice options must be an array');
  if (choice.selection !== undefined && !['one', 'any', 'all', 'up-to'].includes(choice.selection)) {
    fail('judge-required', `Unsupported cost selection mode: ${String(choice.selection)}`);
  }
  if (choice.exclude !== undefined && choice.linked === undefined) {
    fail('invalid-cost-plan', `${choice.id} exclusion requires a linked source`);
  }
  const excluded = choice.exclude === undefined ? new Set<string>() :
    new Set(linkedRefs(ctx, choice.exclude, choice.id).map(key));
  const offered: ObjectRef[] = [];
  const seen = new Set<string>();
  for (const ref of source(ctx, choice)) {
    if (excluded.has(key(ref))) continue;
    if (!ctx.object(ref) || seen.has(key(ref))) continue;
    seen.add(key(ref));
    offered.push(ref);
  }
  const selection = choice.selection ?? 'one';
  const min = count(choice.min ?? (selection === 'one' ? 1 : selection === 'all' ? offered.length : 0), 'Choice minimum');
  const requestedMax = choice.max === null || choice.max === undefined
    ? (selection === 'one' ? 1 : offered.length)
    : count(choice.max, 'Choice maximum');
  if (min > requestedMax) fail('invalid-cost-plan', 'Invalid cost choice bounds');
  const max = Math.min(requestedMax, offered.length);
  if (min > max) fail('invalid-cost-plan', 'Cost choice cannot be completed from the current zone');

  let selected = lockedReceipt === undefined ? selectedFromPicks(ctx, choice.id) : lockedReceipt.objects.map(copy);
  if (lockedReceipt !== undefined && (lockedReceipt.id !== choice.id || lockedReceipt.kind !== kind || lockedReceipt.min !== min || lockedReceipt.max !== max)) {
    fail('invalid-cost-plan', `${choice.id} Finalize lock does not match the current cost choice`);
  }
  if (selected === null) {
    if (selection === 'all') selected = offered.slice(0, max);
    else if (offered.length === 0 && min === 0) selected = [];
    else {
      const answer = ctx.choose<readonly ObjectRef[]>({
        id: `${planId}:pick:${choice.id}`,
        type: 'select-objects',
        chooser: ctx.controller,
        visibility: 'chooser-only',
        options: offered,
        min,
        max
      });
      if (!Array.isArray(answer)) fail('invalid-cost-plan', `${choice.id} choice must be an object list`);
      selected = answer.map(copy);
    }
  }
  if (selected.length < min || selected.length > max) fail('invalid-cost-plan', 'Invalid cost object selection');
  const offeredKeys = new Set(offered.map(key));
  const selectedKeys = new Set<string>();
  for (const ref of selected) {
    if (!isRef(ref) || !offeredKeys.has(key(ref)) || selectedKeys.has(key(ref))) {
      fail('invalid-cost-plan', 'Invalid cost object selection');
    }
    selectedKeys.add(key(ref));
  }
  const locked = selected.map(copy);
  const receipt: CostChoiceReceipt = {
    id: choice.id,
    kind,
    min,
    max,
    count: locked.length,
    objects: locked
  };
  if (lockedReceipt !== undefined && (receipt.count !== lockedReceipt.count || JSON.stringify(receipt.objects) !== JSON.stringify(lockedReceipt.objects))) {
    fail('invalid-cost-plan', `${choice.id} Finalize lock contains an invalid object set`);
  }
  return { id: choice.id, min, max, offered: offered.map(copy), selected: locked, receipt };
}
