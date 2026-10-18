import type { PickSpec } from '@riftbound/card-dsl';
import type { ChoiceRequest, Instruction, InstructionDef, ObjectRef, ResolveContext } from '../../effects/contract.js';
import type { InstructionRegistry, InterpreterOptions } from '../../effects/interpreter.js';
import { bindResolveContext } from '../../events/action-adapter.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { PickSelectionError, linkedPickExpression, queryPickCandidates, resolveNonTargetPick } from '../../target/picks/plan.js';
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
  // One resolver is constructed per Resolve attempt. Cache one answer for all
  // instruction-local contexts in that settlement so a reused pick id remains
  // one logical choice; a retry or later settlement gets a fresh resolver.
  const cache = new Map<string, readonly PickOutput[]>();
  return (id, context, hasResult) => {
    const spec = byId.get(id);
    const source = spec?.linked ?? (spec === undefined ? undefined : linkedPickExpression(spec));
    if (spec && [source, spec.exclude].some(expression => expression && !hasResult(expression.instructionId))) {
      throw new MissingInformation(`Unavailable linked pick ${id}`);
    }
    if (!spec) return undefined;
    let candidates;
    try {
      candidates = queryPickCandidates(context, spec, { phase: 'resolve' });
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
    const values = linkedValues(context, spec);
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
