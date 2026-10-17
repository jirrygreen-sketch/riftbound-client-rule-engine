import type { PickSpec } from '@riftbound/card-dsl';
import type { ChoiceRequest, Instruction, InstructionDef, ObjectRef, ResolveContext } from '../../effects/contract.js';
import type { InstructionRegistry, InterpreterOptions } from '../../effects/interpreter.js';
import { bindResolveContext } from '../../events/action-adapter.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { OrderedPickError, orderedPickSpecs } from './plan.js';

function resultRefs(context: ResolveContext, expression: PickSpec['linked'], id: string): ObjectRef[] {
  if (!expression || !expression.key) throw new OrderedPickError('a linked source needs an explicit result key');
  // Use the interpreter's instruction-scoped evaluator, including repeat scope
  // and ignored-link handling. Never read a previous item's persisted alias.
  const value = context.evaluate(expression);
  if (value === null) throw new MissingInformation(`Unavailable linked pick ${id}`);
  if (!Array.isArray(value)) throw new OrderedPickError(`${id} must link an object-reference list`);
  const refs = value.map(value => {
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.id !== 'string' || value.id.length === 0 || typeof value.zoneEntryId !== 'number' ||
      !Number.isSafeInteger(value.zoneEntryId) || value.zoneEntryId < 0) {
      throw new OrderedPickError(`${id} linked an invalid object reference`);
    }
    return { id: value.id, zoneEntryId: value.zoneEntryId };
  });
  if (new Set(refs.map(ref => JSON.stringify([ref.id, ref.zoneEntryId]))).size !== refs.length) {
    throw new OrderedPickError(`${id} linked duplicate object references`);
  }
  return refs;
}

function linkedRefs(context: ResolveContext, spec: PickSpec): ObjectRef[] {
  const refs = resultRefs(context, spec.linked, spec.id);
  const excluded = new Set(spec.exclude === undefined ? [] : resultRefs(context, spec.exclude, spec.id).map(ref => JSON.stringify([ref.id, ref.zoneEntryId])));
  return refs.filter(ref => !excluded.has(JSON.stringify([ref.id, ref.zoneEntryId])));
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
  const byId = new Map(orderedPickSpecs(body).filter(spec => spec.linked !== undefined).map(spec => [spec.id, spec]));
  return (id, context, hasResult) => {
    const spec = byId.get(id);
    if (spec && [spec.linked, spec.exclude].some(expression => expression && !hasResult(expression.instructionId))) {
      throw new MissingInformation(`Unavailable linked pick ${id}`);
    }
    return spec ? linkedRefs(context, spec) : undefined;
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
