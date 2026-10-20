import type { Expr, Instruction, InstructionDef, ObjectRef, ResolveContext, Value } from '../effects/contract.js';
import { runAbilityBody, type InterpreterOptions } from '../effects/interpreter.js';
import { instructionDefinitionsById } from '../effects/instructions/registry.generated.js';
import { bindOrderedPickInstructions, orderedPickResolver } from './picks/linked.js';
import { bindResolveContext } from '../events/action-adapter.js';
import { paidRepeatInstanceIds } from '../effects/instructions/effect.repeat.js';

/**
 * The current interpreter evaluates args before dispatch, while primitive v1
 * schemas validate Expr nodes and evaluate them themselves. Preserve those
 * nodes inside one literal envelope; the registered primitive still performs
 * its own schema validation and executes with the interpreter's scoped ctx.
 * This is a local runtime adapter, never a rewrite of card data or journals.
 */
function targetObjectSelector(instruction: Instruction): Expr | undefined {
  if (!GRANT_OBJECT_OPS.has(instruction.op)) return undefined;
  const raw = instruction.args as Record<string, Expr>;
  // An authored selector is authoritative. Do not manufacture a second one
  // for source/pick/choose/query forms or for multi-target instructions.
  if (SELECTOR_FIELDS.some(key => raw[key] !== undefined) || raw.appliesTo !== undefined) return undefined;
  const targets = instruction.targets ?? [];
  if (targets.length !== 1 || typeof targets[0]?.id !== 'string') return undefined;
  return { kind: 'constant', value: { kind: 'target', id: targets[0].id } as Value };
}

const constant = (value: Value): Expr => ({ kind: 'constant', value });

function paidRepeatControl(body: readonly Instruction[], instruction: Instruction, cost: unknown): Instruction | undefined {
  if (instruction.op !== 'effect.repeat' || instruction.linkedTo === undefined) return undefined;
  const paid = paidRepeatInstanceIds(cost);
  // A body that explicitly links a separate Repeat marker to an earlier
  // instruction must never execute that marker as an authored GameAction.
  // Missing cost binding, a missing linked instruction, or a missing payment
  // receipt therefore fails closed instead of falling through to the legacy
  // template (whose placeholder action may not represent the spell text).
  // Resolve always receives the frozen cost plan and receipt from the Chain.
  // A direct primitive-only invocation therefore keeps its historical template
  // behavior; the context-aware planner below fails closed before any effect
  // where a separate Repeat marker cannot be bound.
  if (paid === undefined) return undefined;
  if (paid.length === 0) {
    return {
      id: instruction.id,
      op: 'repeat',
      args: { count: constant(0), body: constant([]), reselectTargets: constant(false) },
    };
  }
  const index = body.findIndex(candidate => candidate.id === instruction.linkedTo);
  const repeated = index < 0 ? undefined : body[index];
  if (repeated === undefined || repeated === instruction || repeated.op === 'effect.repeat' || repeated.linkedTo !== undefined) {
    throw new TypeError(`${instruction.id} must link to one independent earlier instruction for paid Repeat`);
  }
  // Paid repeats are planned as fresh executions after the original body; a
  // wrapper here would create a duplicate success state and hide alternate
  // target choices. The shared planner below binds one run per paid id.
  return { id: instruction.id, op: 'sequence', args: { body: constant([]) } };
}


function prepare(body: readonly Instruction[], cost?: unknown): Instruction[] {
  return body.map(instruction => {
    const paidRepeat = paidRepeatControl(body, instruction, cost);
    if (paidRepeat !== undefined) return paidRepeat;
    if (instructionDefinitionsById.has(instruction.op)) {
      const selector = targetObjectSelector(instruction);
      if (GRANT_OBJECT_OPS.has(instruction.op) && instruction.args.appliesTo !== undefined && (instruction.targets?.length ?? 0) > 0) {
        throw new TypeError(`${instruction.op} appliesTo self cannot be combined with a TargetSpec`);
      }
      if (selector === undefined && GRANT_OBJECT_OPS.has(instruction.op) && (instruction.targets?.length ?? 0) > 1 &&
          !SELECTOR_FIELDS.some(key => instruction.args[key] !== undefined) && instruction.args.appliesTo === undefined) {
        throw new TypeError(`${instruction.op} requires one explicit object selector for multiple targets`);
      }
      const authored = instruction.args as Record<string, Expr>;
      return {
        ...instruction,
        args: {
          primitiveArgs: {
            kind: 'constant',
            value: (selector === undefined ? authored : { ...authored, objects: selector }) as unknown as Value
          }
        }
      };
    }
    const args = Object.fromEntries(Object.entries(instruction.args).map(([key, expr]) => {
      if ((expr.kind === 'constant' || expr.kind === 'literal') && key === 'body' && Array.isArray(expr.value)) return [key, { ...expr, value: prepare(expr.value as unknown as readonly Instruction[], cost) }];
      if ((expr.kind === 'constant' || expr.kind === 'literal') && key === 'modes' && Array.isArray(expr.value)) return [key, { ...expr, value: expr.value.map(mode => {
        const entry = mode as unknown as { id: string; body: readonly Instruction[] };
        return { ...entry, body: prepare(entry.body, cost) };
      }) }];
      return [key, expr];
    })) as Record<string, Expr>;
    return { ...instruction, args };
  });
}

function repeatsWholeBody(body: readonly Instruction[], cost: unknown): boolean {
  const paid = paidRepeatInstanceIds(cost);
  if (paid === undefined || paid.length === 0) return false;
  if (body.some(instruction => instruction.op === 'effect.repeat')) return false;
  // The original body already performs the first application once. Each paid
  // Repeat instance adds exactly one more application (CR 820.1.d.1/820.3).
  return true;
}

/** Reject a plan/receipt pair that claims Repeat evidence but is malformed. */
function repeatPaymentFor(body: readonly Instruction[], cost: unknown): readonly string[] | undefined {
  if (!body.some(instruction => instruction.op === 'effect.repeat') &&
      !(cost !== null && typeof cost === 'object' && Object.hasOwn(cost, 'plan'))) return undefined;
  return paidRepeatInstanceIds(cost);
}

function replaceRepeatTargets(value: unknown, targets: Readonly<Record<string, ObjectRef>>): unknown {
  if (Array.isArray(value)) return value.map(entry => replaceRepeatTargets(entry, targets));
  if (value === null || typeof value !== 'object') return value;
  const record = { ...(value as Record<string, unknown>) };
  const targetId = typeof record.id === 'string' ? record.id : undefined;
  const target = targetId === undefined ? undefined : targets[targetId];
  if (record.kind === 'target' && target !== undefined) return [{ id: target.id, zoneEntryId: target.zoneEntryId }];
  if (record.kind === 'target' && targetId !== undefined && targets[targetId] === undefined) {
    throw Object.assign(new Error(`Repeat target ${targetId} has no Finalize lock`), {
      name: 'ChainContractBlockedError', status: 'blocked' as const,
    });
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, replaceRepeatTargets(entry, targets)]));
}

function boundRepeatInstruction(
  instruction: Instruction,
  targets: Readonly<Record<string, ObjectRef>>,
  settlement: string,
  markerId: string,
  instanceId: string,
): Instruction {
  let bound = false;
  const args = Object.fromEntries(Object.entries(instruction.args).map(([key, expression]) => {
    if (key !== 'primitiveArgs') return [key, expression];
    const envelope = expression as { readonly value?: unknown };
    const raw = envelope.value !== null && typeof envelope.value === 'object' && !Array.isArray(envelope.value)
      ? envelope.value as Record<string, unknown>
      : undefined;
    if (raw === undefined) return [key, expression];
    const args = Object.fromEntries(Object.entries(raw).map(([field, entry]) => [field, replaceRepeatTargets(entry, targets)]));
    if (SETTLEMENT_OPS.has(instruction.op)) args.settlementId = { kind: 'constant', value: settlement };
    bound = true;
    return [key, { ...expression, value: args }];
  })) as Record<string, Expr>;
  return {
    ...instruction,
    id: `${markerId}:${encodeURIComponent(instanceId)}`,
    ...(bound ? { targets: [], linkedValues: undefined } : {}),
    linkedTo: undefined,
    args,
  };
}

function repeatSettlement(marker: Instruction, instanceId: string): string {
  return `${marker.id}:${encodeURIComponent(instanceId)}`;
}

const SETTLEMENT_OPS = new Set([
  'continuous.might', 'continuous.base-might', 'continuous.grant-keyword',
  'continuous.keyword', 'continuous.movement',
]);
// Only these linked instructions are transformed into paid-Repeat markers.
// Other linked instructions retain their ordinary interpreter semantics.
const REPEAT_LINK_OPS = new Set(['effect.repeat']);
// Primitive v1 distinguishes Expr fields from literal selectors/metadata. The
// card DSL wraps every top-level argument in Expr, including static metadata.
// Decode only declared literal fields; dynamic value expressions stay intact.
const LITERAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  'effect.draw': ['target', 'pick', 'choice', 'linkKey'],
  'effect.damage': ['target', 'combat', 'divide', 'source'],
  'effect.counter': ['target'],
  'effect.buff': ['mode', 'target', 'chooser', 'chooseUpTo'],
  'effect.exhaust': ['target', 'pick', 'choice', 'choose'],
  'effect.kill': ['target', 'picks', 'self', 'reason'],
  'effect.detach': ['pick'],
  'effect.play': ['target', 'pick', 'choice', 'linkKey'],
  'effect.recycle': ['target', 'from'],
  'effect.reveal': ['target', 'pick', 'choiceId'],
  // effect.shield-value's schema intentionally accepts both fields as Exprs:
  // `object` carries the symbolic selector and `linkKey` is evaluated by the
  // primitive. There are no literal fields to unwrap for this opcode.
  'effect.shield-value': [],
  'effect.stun': ['target', 'pick', 'choose'],
  'effect.zone': ['target', 'pick', 'choice'],
  'effect.repeat': ['actions', 'action', 'effect', 'choices', 'choice', 'linkKey', 'resultKey'],
  'cost.modify': [
    'id', 'source', 'cost', 'printed', 'domains', 'baseChoices', 'baseChoice',
    'baseModifications', 'optionalAdditional', 'mandatoryAdditional',
    'discountOrder', 'modifier', 'modifiers', 'ignoreAllCosts', 'linkKey'
  ],
  'continuous.might': ['target', 'pick', 'choose', 'objects', 'filter'],
  'continuous.combat': ['target', 'pick', 'choose', 'objects', 'filter'],
  'continuous.keyword': ['target', 'pick', 'choose', 'objects', 'filter'],
  'continuous.grant-keyword': ['target', 'pick', 'choose', 'filter'],
  // These three schemas accept target as an Expr and call bindTarget() during
  // execution. Their filter/literal metadata must remain Expr too so the
  // interpreter evaluates it at the documented time.
};

// These schemas accept a concrete TargetSpec id directly. Only those declared
// fields are unwrapped; filter, amount, appliesTo and scope remain Expr values
// and are evaluated by the interpreter at the documented timing.
const GRANT_OBJECT_OPS: ReadonlySet<string> = new Set([
  'continuous.grant-keyword', 'continuous.might', 'continuous.combat', 'continuous.keyword'
]);
const SELECTOR_FIELDS = ['target', 'pick', 'choose', 'objects', 'filter'] as const;
function primitiveArgs(op: string, value: unknown, definition: InstructionDef<unknown>): unknown {
  const raw = { ...(value as { primitiveArgs: Record<string, unknown> }).primitiveArgs };
  for (const key of LITERAL_FIELDS[op] ?? []) {
    const candidate = raw[key];
    if (candidate && typeof candidate === 'object' && 'kind' in candidate && (candidate.kind === 'constant' || candidate.kind === 'literal') && 'value' in candidate) raw[key] = candidate.value;
  }
  return definition.argsSchema.parse(raw);
}
const registry = new Map<string, InstructionDef<unknown>>([...instructionDefinitionsById].map(([op, definition]) => [op, {
  op,
  argsSchema: { parse: (value: unknown) => primitiveArgs(op, value, definition as InstructionDef<unknown>) },
  execute: (ctx: ResolveContext, args: unknown) => (definition as InstructionDef<unknown>).execute(ctx, args)
}]));

export function resolveChainBody(
  body: readonly Instruction[],
  context: ResolveContext,
  options: InterpreterOptions = {}
) {
  const repeatPayment = repeatPaymentFor(body, options.cost);
  const paid = repeatsWholeBody(body, options.cost);
  const preparedBody: readonly Instruction[] = paid
    ? [{
      id: '__riftbound.repeat.paid-body',
      op: 'repeat',
      args: {
        count: constant((paidRepeatInstanceIds(options.cost)?.length ?? 0) + 1),
        body: constant(body as unknown as Value),
        reselectTargets: constant(false),
      },
    }]
    : body;
  const orderedPicks = orderedPickResolver(body);
  // Continuous primitives derive their per-settlement registration id from a
  // shared settlement counter keyed by source identity (CR 478.1: layers are
  // evaluated continuously; 317.2.c: this-turn effects expire together). The
  // interpreter only persists the instruction-qualified key, so the next
  // settlement read the bare key and recomputed the same id, colliding in the
  // continuous registry. Mirror the settlement counter back under its bare key
  // so counters survive across settlements; host checkpoints still roll the
  // mirrored write back with the transaction (AwaitChoice replays recompute the
  // same id deterministically instead of resubmitting registrations).
  const settlementContext = bindResolveContext(context, {
    link: (key, value) => {
      context.link(key, value);
      const marker = key.indexOf('__continuous.settlement.');
      if (marker > 0) context.link(key.slice(marker), value);
    }
  });
  const continuationBody: Instruction[] = [];
  const runnable = prepare(preparedBody, options.cost).flatMap((instruction, index): Instruction[] => {
    const sourceInstruction = preparedBody[index];
    if (sourceInstruction?.op === 'effect.repeat' &&
        sourceInstruction.args.actions !== undefined &&
        sourceInstruction.linkedTo !== undefined &&
        preparedBody.some(candidate => candidate.id === sourceInstruction.linkedTo)) return [];
    if (sourceInstruction?.linkedTo === undefined) return [instruction];
    if (!REPEAT_LINK_OPS.has(instruction.op) || options.cost === undefined) return [instruction];
    throw new TypeError(`${sourceInstruction.id} requires the dedicated Repeat marker path`);
  });
  const continuationMarkers = preparedBody.filter(instruction =>
    instruction.op === 'effect.repeat' &&
    instruction.args.actions !== undefined &&
    instruction.linkedTo !== undefined &&
    preparedBody.some(candidate => candidate.id === instruction.linkedTo)
  );
  const marker = continuationMarkers[0];
  if (marker !== undefined && preparedBody.some(instruction => instruction.op === 'effect.repeat' && instruction !== marker)) {
    throw new TypeError('effect.repeat linked markers must be unique');
  }
  if (marker !== undefined) {
    const repeatedOriginal = preparedBody.find(instruction => instruction.id === marker.linkedTo);
    if (repeatedOriginal === undefined) throw new TypeError(`${marker.id} has no earlier linked instruction`);
    // The linked marker itself describes the reusable effect; only that
    // original effect executes now. Its one execution is the first execution,
    // so the Finalize receipt appends the remaining paid instances below.
    const index = preparedBody.indexOf(repeatedOriginal);
    const original = runnable[index];
    if (original === undefined) throw new TypeError(`${marker.id} links to an unavailable instruction`);
  }
  const execution = runAbilityBody(
    runnable,
    settlementContext,
    bindOrderedPickInstructions(registry, runnable),
    {
      ...options,
      picks: (id, pickContext, hasResult) =>
        orderedPicks?.(id, pickContext, hasResult) ?? options.picks?.(id, pickContext, hasResult)
    }
  );
  if (marker === undefined) return execution;
  const paidIds = repeatPayment ?? [];
  if (paidIds.length === 0) return execution;
  const repeatedOriginal = preparedBody.find(candidate => candidate.id === marker.linkedTo);
  if (repeatedOriginal === undefined) throw new TypeError(`${marker.id} has no earlier linked instruction`);
  for (const instanceId of paidIds) {
    const locked: Record<string, ObjectRef> = {};
    for (const spec of repeatedOriginal.targets ?? []) {
      const selected = context.targets(spec.id)[0];
      if (selected !== undefined) locked[spec.id] = selected;
    }
    continuationBody.push(boundRepeatInstruction(
      prepare([repeatedOriginal], options.cost)[0]!,
      locked,
      repeatSettlement(marker, instanceId),
      marker.id,
      instanceId,
    ));
  }
  const continuation = runAbilityBody(
    continuationBody,
    bindResolveContext(settlementContext, { linked: () => undefined }),
    bindOrderedPickInstructions(registry, continuationBody),
    options,
  );
  return {
    status: (execution.status === 'partial' || continuation.status === 'partial' ? 'partial' : 'executed') as 'executed' | 'partial',
    results: [...execution.results, ...continuation.results],
    linkedValues: { ...execution.linkedValues, ...continuation.linkedValues },
    events: [...execution.events, ...continuation.events],
  };
}
