import type { PickSpec } from '@riftbound/card-dsl';
import type { ChoiceRequest, Instruction, InstructionDef, ObjectRef, ResolveContext } from '../../effects/contract.js';
import type { InstructionRegistry, InterpreterOptions } from '../../effects/interpreter.js';
import { bindResolveContext } from '../../events/action-adapter.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { PickSelectionError, linkedPickExpression, queryPickCandidates, receiptObjectValues, resolveNonTargetPick, validatePickPreselection, validateStandalonePreselection } from '../../target/picks/plan.js';
import { OrderedPickError, orderedPickSpecs, pickSpecs } from './plan.js';

function isObjectRef(value: unknown): value is ObjectRef {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { zoneEntryId?: unknown }).zoneEntryId === 'number' &&
    Number.isSafeInteger((value as { zoneEntryId: number }).zoneEntryId) &&
    (value as { zoneEntryId: number }).zoneEntryId >= 0;
}

type PickOutput = ObjectRef | string;

function linkedValues(context: ResolveContext, spec: PickSpec): PickOutput[] {
  try {
    const result = resolveNonTargetPick(context, spec, { phase: 'resolve' });
    return result.selected.map(value => {
      if (isObjectRef(value)) return { id: value.id, zoneEntryId: value.zoneEntryId };
      if (typeof value === 'string') return value;
      throw new OrderedPickError(`${spec.id} must resolve object references or player values`);
    });
  } catch (error) {
    if (error instanceof PickSelectionError && error.code === 'missing-result') {
      throw new MissingInformation(error.message);
    }
    throw error;
  }
}

function choose<T>(context: ResolveContext, request: ChoiceRequest<T>): T {
  const answer = context.choose(request);
  if (request.type === 'order') {
    const key = (ref: ObjectRef) => JSON.stringify([ref.id, ref.zoneEntryId]);
    const expected = new Set(request.options.map(key));
    if (!Array.isArray(answer) || answer.length !== request.options.length || expected.size !== answer.length ||
      answer.some(ref => !ref || typeof ref !== 'object' || !expected.delete(key(ref)))) {
      throw new OrderedPickError('order answer must be an exact permutation of the live references');
    }
  }
  return answer;
}

/** Bridge actual inspect/reveal/choice.order results to the primitive pick APIs. */
export function orderedPickResolver(body: readonly Instruction[]): InterpreterOptions['picks'] {
  const byId = new Map(pickSpecs(body)
    .filter(spec => spec.linked !== undefined || linkedPickExpression(spec) !== undefined || spec.filter !== undefined)
    .map(spec => [spec.id, spec]));
  const standalone = new Map(pickSpecs(body)
    .filter(spec => spec.filter !== undefined)
    .map(spec => [spec.id, spec]));
  // One resolver is constructed per Resolve attempt. Cache one answer for all
  // instruction-local contexts in that settlement so a reused pick id remains
  // one logical choice; a retry or later settlement gets a fresh resolver.
  const cache = new Map<string, readonly PickOutput[]>();
  const active = new Set<string>();
  return (id, context, hasResult) => {
    // The interpreter falls back to the host's picks() when this callback
    // returns undefined. Use that explicit reentry seam to read a host-supplied
    // answer without recursively invoking this resolver.
    if (active.has(id)) return undefined;
    let spec = byId.get(id);
    if (!spec) spec = standalone.get(id);
    const source = spec?.linked ?? (spec === undefined ? undefined : linkedPickExpression(spec)) ??
      (spec !== undefined && Array.isArray(spec.options) && spec.options.length === 1 &&
        spec.options[0] !== null && typeof spec.options[0] === 'object' && !Array.isArray(spec.options[0]) &&
        (spec.options[0] as Record<string, unknown>).kind === 'linked-value'
        ? spec.options[0] as PickSpec['linked'] : undefined);
    if (spec && spec.linked !== undefined && [source, spec.exclude]
      .some(expression => expression && !hasResult(expression.instructionId))) {
      throw new MissingInformation(`Unavailable linked pick ${id}`);
    }
    if (!spec) return undefined;
    let candidates;
    try {
            candidates = standalone.has(id) && spec.filter !== undefined
        ? Object.freeze({ offered: Object.freeze([]), invalid: Object.freeze([]), phase: 'resolve' as const })
        : queryPickCandidates(context, spec, { phase: 'resolve' });
    } catch (error) {
      if (error instanceof PickSelectionError && error.code === 'missing-result') {
        throw new MissingInformation(error.message);
      }
      throw error;
    }
    if (source !== undefined && candidates.offered.length === 0) {
      let receipt: Value | undefined;
      try {
        receipt = context.evaluate(source as never);
      } catch (error) {
        if (!(error instanceof MissingInformation)) throw error;
      }
      const stale = receiptObjectValues(receipt);
      if (stale.length > 0) {
        const values = stale.map(ref => ({ ...ref }));
        cache.set(JSON.stringify({ id, source, stale }), Object.freeze(values));
        return values.map(ref => ({ ...ref }));
      }
    }
    const cacheKey = JSON.stringify({
      id,
      controller: context.controller,
      source,
      exclude: spec.exclude,
      filter: spec.filter,
      min: spec.min,
      max: spec.max,
      selection: spec.selection,
      offered: candidates.offered,
      invalid: candidates.invalid
    });
    const cached = cache.get(cacheKey);
    if (cached) return cached.map(value => typeof value === 'string' ? value : { ...value });
    let supplied: readonly unknown[] = [];
    active.add(id);
    try {
      supplied = context.picks(id);
    } finally {
      active.delete(id);
    }
    if (standalone.has(id) && supplied.length > 0) {
      const values = validateStandalonePreselection(context, spec, supplied as never)
        .map(value => isObjectRef(value) ? { id: value.id, zoneEntryId: value.zoneEntryId } : String(value));
      cache.set(cacheKey, Object.freeze(values.map(value => typeof value === 'string' ? value : Object.freeze({ ...value }))));
      return values.map(value => typeof value === 'string' ? value : { ...value });
    }
    let values: PickOutput[];
    if (supplied.length > 0 && standalone.has(id)) {
      const selected = validateStandalonePreselection(context, spec, supplied as never);
      values = selected.map(value => isObjectRef(value) ? { id: value.id, zoneEntryId: value.zoneEntryId } : String(value));
    } else if (supplied.length > 0) {
      const selected = validatePickPreselection(context, spec, candidates, { selected: supplied as never });
      values = selected.map(value => isObjectRef(value) ? { id: value.id, zoneEntryId: value.zoneEntryId } : String(value));
    } else {
      const staleReceipt = [source, spec.exclude]
        .filter((expression): expression is NonNullable<typeof expression> => expression !== undefined)
        .flatMap(expression => receiptObjectValues(context.evaluate(expression as never)));
      const stale = staleReceipt.filter(ref => !candidates.offered.some(value =>
        isObjectRef(value) && value.id === ref.id && value.zoneEntryId === ref.zoneEntryId));
      if (stale.length > 0 && candidates.offered.length === 0) values = stale.map(ref => ({ ...ref }));
      else values = linkedValues(context, spec);
    }
    cache.set(cacheKey, Object.freeze(values.map(value => typeof value === 'string' ? value : Object.freeze({ ...value }))));
    return values.map(value => typeof value === 'string' ? value : { ...value });
  };
}

/** Check permutations before an existing primitive can apply a fallback order. */
export function bindOrderedPickInstructions(registry: InstructionRegistry, body: readonly Instruction[]): InstructionRegistry {
  const specs = orderedPickSpecs(body);
  if (!specs.length) return registry;
  return new Map([...registry].map(([op, definition]): [string, InstructionDef<unknown>] => [op, {
    ...definition,
    execute(context, args) {
      return definition.execute(bindResolveContext(context, {
        choose: request => choose(context, request)
      }), args);
    }
  }]));
}
