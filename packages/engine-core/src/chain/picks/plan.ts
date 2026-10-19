import type { Instruction, PickSpec, PickZoneSlice } from '@riftbound/card-dsl';
import type { ObjectRef, ResolveContext } from '../../effects/contract.js';
import { linkedPickExpression } from '../../target/picks/plan.js';

/** Internal chain data, never a public projection of a secret zone. */
export interface OrderedPickPlan {
  readonly id: string;
  readonly refs: readonly ObjectRef[];
}

export class OrderedPickError extends Error {
  readonly status = 'blocked';
  constructor(message: string) { super(`Ordered pick: ${message}`); this.name = 'OrderedPickError'; }
}

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

function linkedSource(spec: PickSpec): PickSpec['linked'] | undefined {
  return spec.linked ?? linkedPickExpression(spec);
}

function sourceCount(spec: PickSpec): number {
  return Number(spec.zoneSlice !== undefined) + Number(spec.linked !== undefined) +
    Number(linkedPickExpression(spec) !== undefined);
}

function isLinkedOptionsCompatibility(spec: PickSpec): boolean {
  return linkedPickExpression(spec) !== undefined && spec.ordered === undefined;
}

/**
 * A pick id is one logical Resolve binding even when later instructions repeat
 * its declaration so their selectors can resolve it. Repeated declarations may
 * omit restrictions, but they may never widen a restriction or change source.
 */
function mergeDeclarations(previous: PickSpec, next: PickSpec): PickSpec {
  const previousLinked = linkedSource(previous);
  const nextLinked = linkedSource(next);
  if (!sameJson(previous.zoneSlice, next.zoneSlice) || !sameJson(previousLinked, nextLinked) ||
      !sameJson(previous.exclude, next.exclude)) {
    throw new OrderedPickError(`conflicting declarations for pick id ${previous.id}`);
  }
  if (previous.filter !== undefined && next.filter !== undefined && !sameJson(previous.filter, next.filter)) {
    throw new OrderedPickError(`conflicting filters for pick id ${previous.id}`);
  }
  if (previous.selection !== undefined && next.selection !== undefined && previous.selection !== next.selection) {
    throw new OrderedPickError(`conflicting selection modes for pick id ${previous.id}`);
  }
  const min = previous.min === undefined ? next.min : next.min === undefined ? previous.min : Math.max(previous.min, next.min);
  const finiteMax = (value: number | null | undefined): number => value === null || value === undefined ? Number.POSITIVE_INFINITY : value;
  const maxValue = Math.min(finiteMax(previous.max), finiteMax(next.max));
  const max = Number.isFinite(maxValue) ? maxValue : previous.max === null || next.max === null ? null : undefined;
  if (min !== undefined && max !== null && max !== undefined && min > max) {
    throw new OrderedPickError(`conflicting bounds for pick id ${previous.id}`);
  }
  const filter = previous.filter ?? next.filter;
  const selection = previous.selection ?? next.selection;
  return Object.freeze({
    ...previous,
    ...(filter === undefined ? {} : { filter }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(selection === undefined ? {} : { selection })
  });
}

/** Explicit sources are bindings, not player decisions or target requirements. */
function checkSource(spec: PickSpec): void {
  if ((!isLinkedOptionsCompatibility(spec) && spec.ordered !== true) || !Array.isArray(spec.options) ||
      (!isLinkedOptionsCompatibility(spec) && spec.options.length) || sourceCount(spec) !== 1) {
    throw new OrderedPickError(`${spec.id} requires exactly one ordered source and options: []`);
  }
  if (own(spec, 'zoneSlice') &&
      (spec.selection !== 'all' || ['filter', 'min', 'max'].some(key => own(spec, key)))) {
    throw new OrderedPickError(`${spec.id} zoneSlice requires selection: all and no filter or bounds`);
  }
  if (spec.exclude !== undefined && spec.linked === undefined) throw new OrderedPickError('an exclusion requires a linked source');
}

/** Traverse actual control bodies only; ordinary argument data cannot declare picks. */
export function pickSpecs(body: readonly Instruction[]): PickSpec[] {
  const result: PickSpec[] = [], byId = new Map<string, number>();
  function visit(instructions: readonly Instruction[], repeated = false): void {
    for (const instruction of instructions) {
      for (const spec of instruction.picks ?? []) {
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) {
          throw new OrderedPickError('every PickSpec needs a non-empty id');
        }
        // Keep explicit source validation on the runtime path as well as the
        // IR validator. A zoneSlice/linked source without its ordered marker
        // must fail closed; silently omitting it would turn a malformed pick
        // into an empty binding.
        if (spec.zoneSlice !== undefined || spec.linked !== undefined || linkedPickExpression(spec) !== undefined) {
          if ((spec.zoneSlice !== undefined || spec.linked !== undefined) && spec.ordered !== true) {
            throw new OrderedPickError(`${spec.id} requires ordered: true for an explicit source`);
          }
          checkSource(spec);
        }
        if (repeated && spec.zoneSlice) throw new OrderedPickError('a repeated zone slice needs an iteration-specific Finalize lifecycle');
        const existing = byId.get(spec.id);
        if (existing === undefined) {
          byId.set(spec.id, result.length);
          result.push(spec);
        } else {
          result[existing] = mergeDeclarations(result[existing]!, spec);
        }
      }
      const expression = instruction.args.body;
      if (['sequence', 'repeat', 'choice.optional'].includes(instruction.op) && expression &&
        (expression.kind === 'constant' || expression.kind === 'literal') && Array.isArray(expression.value)) {
        visit(expression.value as unknown as readonly Instruction[], repeated || instruction.op === 'repeat');
      }
      // Mode bodies are control bodies just like sequence/optional bodies.
      // Inspect only the declared `modes` field so arbitrary argument data
      // cannot smuggle a PickSpec into the lifecycle walk.
      const modes = instruction.args.modes;
      if (instruction.op === 'choice.mode' && modes &&
        (modes.kind === 'constant' || modes.kind === 'literal') && Array.isArray(modes.value)) {
        for (const mode of modes.value) {
          if (!mode || typeof mode !== 'object' || Array.isArray(mode)) continue;
          const modeBody = (mode as { readonly body?: unknown }).body;
          if (Array.isArray(modeBody)) {
            visit(modeBody as unknown as readonly Instruction[], repeated);
            continue;
          }
          if (!modeBody || typeof modeBody !== 'object') continue;
          const body = modeBody as { readonly kind?: unknown; readonly value?: unknown };
          if ((body.kind === 'constant' || body.kind === 'literal') && Array.isArray(body.value)) {
            visit(body.value as unknown as readonly Instruction[], repeated);
          }
        }
      }
    }
  }
  visit(body);
  return result;
}

/** The explicit ordered subset retained for the Finalize source lifecycle. */
export function orderedPickSpecs(body: readonly Instruction[]): PickSpec[] {
  return pickSpecs(body).filter(spec => spec.ordered === true).map(spec => {
    checkSource(spec);
    return spec;
  });
}

function checkFinalizeInput(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if ('kind' in value && (value.kind === 'linked' || value.kind === 'linked-value') ||
    ['target', 'pick', 'linked'].some(key => own(value, key))) {
    throw new OrderedPickError('zone slices cannot depend on Resolve-time results or selections');
  }
  for (const item of Object.values(value)) checkFinalizeInput(item, seen);
}

function lockSlice(context: ResolveContext, id: string, slice: PickZoneSlice): OrderedPickPlan {
  if (!slice || !['hand', 'deck', 'rune-deck', 'trash', 'banishment', 'board', 'rune-zone', 'chain'].includes(slice.zone) ||
    !['top', 'bottom'].includes(slice.from) || Object.keys(slice).some(key => !['player', 'zone', 'from', 'count'].includes(key))) {
    throw new OrderedPickError(`invalid zone slice for ${id}`);
  }
  checkFinalizeInput(slice);
  const player = slice.player === undefined ? context.controller : context.evaluate(slice.player);
  if (typeof player !== 'string' || !player.length) throw new OrderedPickError('zone slice player must be a PlayerId');
  const count = slice.count === undefined ? undefined : context.evaluate(slice.count);
  if (count !== undefined && (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) {
    throw new OrderedPickError('zone slice count must be a nonnegative safe integer');
  }
  // zoneSlice is the sole ordering authority. Never sort or fill from query().
  const refs = context.zoneSlice(player, slice.zone, slice.from, count as number | undefined).map(object => {
    if (object.owner !== player || object.zone !== slice.zone || context.object(object.ref) === null) {
      throw new OrderedPickError('zoneSlice returned an object outside the requested zone');
    }
    return Object.freeze({ id: object.ref.id, zoneEntryId: object.ref.zoneEntryId });
  });
  if (new Set(refs.map(ref => JSON.stringify([ref.id, ref.zoneEntryId]))).size !== refs.length) {
    throw new OrderedPickError('zoneSlice returned duplicate identities');
  }
  return Object.freeze({ id, refs: Object.freeze(refs) });
}

/** Snapshot references only: no look/reveal, choose, targeting, or game action. */
export function finalizeOrderedPickPlans(context: ResolveContext, body: readonly Instruction[]): OrderedPickPlan[] {
  return orderedPickSpecs(body).flatMap(spec => own(spec, 'zoneSlice') ? [lockSlice(context, spec.id, spec.zoneSlice!)] : []);
}

/**
 * CR 124: keep the exact zone incarnation. A shuffle/reorder does not retarget a
 * locked binding; leaving and returning does not rebind it by card id. Retain
 * unavailable refs too, so each unchanged primitive can report its own actual
 * action result (055, 359.3.e.6/.11, 432.1.c), without target-trigger semantics.
 */
export function lockedOrderedPicks(plans: readonly OrderedPickPlan[], id: string): ObjectRef[] | undefined {
  return plans.find(plan => plan.id === id)?.refs.map(ref => ({ ...ref }));
}
