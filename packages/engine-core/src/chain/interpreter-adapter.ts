import type { Expr, Instruction, InstructionDef, ResolveContext, Value } from '../effects/contract.js';
import { runAbilityBody, type InterpreterOptions } from '../effects/interpreter.js';
import { instructionDefinitionsById } from '../effects/instructions/registry.generated.js';

/**
 * The current interpreter evaluates args before dispatch, while primitive v1
 * schemas validate Expr nodes and evaluate them themselves. Preserve those
 * nodes inside one literal envelope; the registered primitive still performs
 * its own schema validation and executes with the interpreter's scoped ctx.
 * This is a local runtime adapter, never a rewrite of card data or journals.
 */
function prepare(body: readonly Instruction[]): Instruction[] {
  return body.map(instruction => {
    if (instructionDefinitionsById.has(instruction.op)) return {
      ...instruction, args: { primitiveArgs: { kind: 'constant', value: instruction.args as unknown as Value } }
    };
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
  'effect.damage': ['target', 'combat'],
  'effect.counter': ['target'],
  'effect.buff': ['mode', 'target', 'chooser', 'chooseUpTo'],
  'effect.exhaust': ['target', 'pick', 'choice'],
  'effect.kill': ['target', 'picks', 'self', 'reason'],
  'effect.detach': ['pick'],
  'effect.play': ['target', 'pick', 'choice', 'linkKey'],
  'effect.recycle': ['target', 'from'],
  'effect.reveal': ['target'],
  'effect.zone': ['target', 'pick', 'choice'],
  'effect.repeat': ['actions', 'action', 'effect', 'choices', 'choice', 'linkKey', 'resultKey']
};
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
  return runAbilityBody(prepare(body), context, registry, options);
}
