import type { PickSpec } from '@riftbound/card-dsl';
import type { ChoiceRequest, Instruction, InstructionDef, ObjectRef, ResolveContext, Value } from '../../effects/contract.js';
import type { InstructionRegistry, InterpreterOptions } from '../../effects/interpreter.js';
import { bindResolveContext } from '../../events/action-adapter.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { PickSelectionError, linkedPickExpression, queryPickCandidates, receiptObjectValues, resolveNonTargetPick, validateDeferredPickPreselection, validatePickPreselection, validateStandalonePreselection, type PickCandidateSet } from '../../target/picks/plan.js';
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
  const deferred = new Set<string>();
  const collectDeferred = (instructions: readonly Instruction[]): void => {
    for (const instruction of instructions) {
      if (instruction.op === 'effect.play' && 'choice' in instruction.args) {
        for (const spec of instruction.picks ?? []) deferred.add(spec.id);
      }
      const expression = instruction.args.body;
      if (expression && (expression.kind === 'constant' || expression.kind === 'literal') && Array.isArray(expression.value)) {
        collectDeferred(expression.value as unknown as readonly Instruction[]);
      }
    }
  };
  collectDeferred(body);
  const byId = new Map(pickSpecs(body)
    .filter(spec => spec.linked !== undefined || linkedPickExpression(spec) !== undefined || spec.filter !== undefined)
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
    const spec = byId.get(id);
    if (!spec) return undefined;
    const source = spec.linked ?? linkedPickExpression(spec);
    const sourceAvailable = source !== undefined && hasResult(source.instructionId);
    if (spec.linked !== undefined && source !== undefined && !sourceAvailable) {
      throw new MissingInformation(`Unavailable linked pick ${id}`);
    }
    if (spec.exclude !== undefined && !hasResult(spec.exclude.instructionId)) {
      throw new MissingInformation(`Unavailable linked exclusion ${id}`);
    }
    // The original options-only linked spelling is a Resolve source even when
    // its producer is still in a nested scope. It is not a standalone pick: a
    // host answer must still be checked against that exact receipt. Only a pick
    // with no declared linked source uses the standalone compatibility path.
    const noSource = source === undefined;
    let candidates: PickCandidateSet;
    try {
      candidates = source !== undefined && !sourceAvailable
        ? Object.freeze({ offered: Object.freeze([]), invalid: Object.freeze([]), phase: 'resolve' as const })
        : queryPickCandidates(context, spec, { phase: 'resolve' });
    } catch (error) {
      if (error instanceof PickSelectionError && error.code === 'missing-result') {
        throw new MissingInformation(error.message);
      }
      throw error;
    }
    const cacheKey = JSON.stringify({
      id,
      controller: context.controller,
      source,
      sourceAvailable,
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
    let values: PickOutput[];
    if (supplied.length > 0) {
      const selected = deferred.has(id)
        ? validateDeferredPickPreselection(context, spec, candidates, supplied as never)
        : noSource
          ? validateStandalonePreselection(context, spec, supplied as never)
          : validatePickPreselection(context, spec, candidates, { selected: supplied as never });
      values = selected.map(value => isObjectRef(value) ? { id: value.id, zoneEntryId: value.zoneEntryId } : String(value));
    } else if (source !== undefined && !sourceAvailable) {
      throw new MissingInformation(`Unavailable linked pick ${id}`);
    } else if (source !== undefined && candidates.offered.length === 0) {
      let receipt: Value | undefined;
      try {
        receipt = context.evaluate(source as never);
      } catch (error) {
        if (!(error instanceof MissingInformation)) throw error;
      }
      // A filter may legitimately remove every live receipt member. Do not
      // turn that empty offered set back into the original receipt: only exact
      // departed incarnations are retained so the consuming primitive can
      // report its own stale/ignored outcome.
      const stale = receiptObjectValues(receipt).filter(ref => context.object(ref) === null);
      values = stale.length > 0 ? stale.map(ref => ({ ...ref })) : linkedValues(context, spec);
    } else {
      values = linkedValues(context, spec);
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
