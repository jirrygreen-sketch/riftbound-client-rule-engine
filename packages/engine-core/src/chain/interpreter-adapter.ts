import type { Expr, Instruction, InstructionDef, ResolveContext, Value } from '../effects/contract.js';
import { runAbilityBody, type InterpreterOptions } from '../effects/interpreter.js';
import { instructionDefinitionsById } from '../effects/instructions/registry.generated.js';
import { bindOrderedPickInstructions, orderedPickResolver } from './picks/linked.js';
import { bindResolveContext } from '../events/action-adapter.js';

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

function prepare(body: readonly Instruction[]): Instruction[] {
  return body.map(instruction => {
    if (instructionDefinitionsById.has(instruction.op)) {
      const selector = targetObjectSelector(instruction);
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
      if ((expr.kind === 'constant' || expr.kind === 'literal') && key === 'body' && Array.isArray(expr.value)) return [key, { ...expr, value: prepare(expr.value as unknown as readonly Instruction[]) }];
      if ((expr.kind === 'constant' || expr.kind === 'literal') && key === 'modes' && Array.isArray(expr.value)) return [key, { ...expr, value: expr.value.map(mode => {
        const entry = mode as unknown as { id: string; body: readonly Instruction[] };
        return { ...entry, body: prepare(entry.body) };
      }) }];
      return [key, expr];
    })) as Record<string, Expr>;
    return { ...instruction, args };
  });
}
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
  // The Shield Value reader takes a symbolic object selector and its stable
  // receipt key. Both are literal metadata for the primitive schema; the
  // selector may itself contain a dynamic linked instruction reference.
  'effect.shield-value': ['object', 'linkKey'],
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
  'continuous.bonus-damage': ['target'],
  'continuous.lethal-threshold': ['target'],
  'continuous.modify-might-reduction': ['target']
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
  return runAbilityBody(
    prepare(body),
    settlementContext,
    bindOrderedPickInstructions(registry, body),
    {
      ...options,
      picks: (id, pickContext, hasResult) =>
        orderedPicks?.(id, pickContext, hasResult) ?? options.picks?.(id, pickContext, hasResult)
    }
  );
}
