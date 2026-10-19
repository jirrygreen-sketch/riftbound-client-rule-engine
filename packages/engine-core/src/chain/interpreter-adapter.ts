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

function assertAuthoredSelectorScope(instruction: Instruction): void {
  const targetIds = new Set((instruction.targets ?? []).map(target => target.id));
  const pickIds = new Set((instruction.picks ?? []).map(pick => pick.id));
  const isSelectorRecord = (record: Record<string, unknown>): boolean => {
    const keys = Object.keys(record);
    return keys.length === 1 && (keys[0] === 'target' || keys[0] === 'pick');
  };
  const check = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const entry of value) check(entry); return; }
    const record = value as Record<string, unknown>;
    if (record.kind === 'target' && typeof record.id === 'string' && !targetIds.has(record.id)) {
      throw new TypeError(`Target binding ${record.id} is not declared by ${instruction.id}`);
    }
    if (record.kind === 'pick' && typeof record.id === 'string' && !pickIds.has(record.id)) {
      throw new TypeError(`Pick binding ${record.id} is not declared by ${instruction.id}`);
    }
    if (isSelectorRecord(record) && typeof record.target === 'string' && !targetIds.has(record.target)) {
      throw new TypeError(`Target binding ${record.target} is not declared by ${instruction.id}`);
    }
    if (isSelectorRecord(record) && typeof record.pick === 'string' && !pickIds.has(record.pick)) {
      throw new TypeError(`Pick binding ${record.pick} is not declared by ${instruction.id}`);
    }
    for (const child of Object.values(record)) check(child);
  };
  for (const expression of Object.values(instruction.args)) check(expression);
}

function bindBodyReferences(body: readonly Instruction[], context: ResolveContext): ResolveContext {
  const targets = new Map<string, readonly import('../effects/contract.js').ObjectRef[]>();
  const picks = new Map<string, readonly (import('../effects/contract.js').ObjectRef | string)[]>();
  for (const instruction of body) {
    for (const target of instruction.targets ?? []) targets.set(target.id, context.targets(target.id));
    for (const pick of instruction.picks ?? []) picks.set(pick.id, context.picks(pick.id));
  }
  return bindResolveContext(context, {
    targets: id => [...(targets.get(id) ?? [])],
    picks: id => picks.has(id) ? [...picks.get(id)!] : []
  });
}

function authoredLinkedIds(value: unknown, result = new Set<string>()): Set<string> {
  if (value === null || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (const entry of value) authoredLinkedIds(entry, result);
    return result;
  }
  const record = value as Record<string, unknown>;
  if (record.linked !== undefined && typeof record.linked === 'string') result.add(record.linked);
  if ((record.kind === 'linked' || record.kind === 'linked-value') && typeof record.instructionId === 'string') result.add(record.instructionId);
  for (const entry of Object.values(record)) authoredLinkedIds(entry, result);
  return result;
}

function assertLinkedProvenance(body: readonly Instruction[]): void {
  const prior = new Set<string>();
  for (const instruction of body) {
    const ids = new Set<string>();
    for (const expression of Object.values(instruction.args)) authoredLinkedIds(expression, ids);
    for (const id of ids) {
      if (!prior.has(id)) throw new TypeError(`Cross-item linked binding ${id}`);
    }
    prior.add(instruction.id);
  }
}

function sameRef(left: { id: string; zoneEntryId: number }, right: { id: string; zoneEntryId: number }): boolean {
  return left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}

/**
 * The interpreter's selector fallbacks are intentionally shared by nested
 * bodies, but a primitive must not read a target, pick, or linked value that
 * belongs to a different instruction in the same item. Validate the authored
 * references before the primitive sees the evaluated argument.
 */
function assertInstructionReferences(instruction: Instruction, body: readonly Instruction[], context: ResolveContext): void {
  const targetIds = new Set((instruction.targets ?? []).map(target => target.id));
  const pickIds = new Set((instruction.picks ?? []).map(pick => pick.id));
  const priorIds = new Set<string>();
  const instructionIds = new Set<string>();
  for (const candidate of body) {
    instructionIds.add(candidate.id);
    for (const target of candidate.targets ?? []) targetIds.add(target.id);
    for (const pick of candidate.picks ?? []) pickIds.add(pick.id);
  }
  const index = body.findIndex(candidate => candidate.id === instruction.id);
  for (let position = 0; position < (index < 0 ? body.length : index); position += 1) priorIds.add(body[position]!.id);
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry); return; }
    const record = value as Record<string, unknown>;
    if (record.kind === 'target' && typeof record.id === 'string') {
      if (!targetIds.has(record.id)) throw new TypeError(`Unknown target binding ${record.id}`);
      if (context.targets(record.id).length === 0) throw new TypeError(`Unavailable target binding ${record.id}`);
    }
    if (record.kind === 'pick' && typeof record.id === 'string') {
      if (!pickIds.has(record.id)) throw new TypeError(`Unknown pick binding ${record.id}`);
      if (context.picks(record.id).length === 0) throw new TypeError(`Unavailable pick binding ${record.id}`);
    }
    if ((record.kind === 'linked' || record.kind === 'linked-value') && typeof record.instructionId === 'string') {
      if (!instructionIds.has(record.instructionId) || !priorIds.has(record.instructionId)) {
        throw new TypeError(`Cross-item linked binding ${record.instructionId}`);
      }
      if (context.linked(record.key === undefined ? record.instructionId : `${record.instructionId}.${record.key}`) === undefined) {
        throw new TypeError(`Unavailable linked binding ${record.instructionId}`);
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  for (const expression of Object.values(instruction.args)) visit(expression);
  for (const target of instruction.targets ?? []) {
    const refs = context.targets(target.id);
    for (const ref of refs) {
      if (context.object(ref) === null) throw new TypeError(`Stale target binding ${target.id}`);
    }
  }
  for (const pick of instruction.picks ?? []) {
    for (const value of context.picks(pick.id)) {
      if (typeof value === 'object' && value !== null && 'id' in value && 'zoneEntryId' in value && context.object(value as { id: string; zoneEntryId: number }) === null) {
        throw new TypeError(`Stale pick binding ${pick.id}`);
      }
    }
  }
}

function prepare(body: readonly Instruction[]): Instruction[] {
  return body.map(instruction => {
    if (instructionDefinitionsById.has(instruction.op)) {
      assertAuthoredSelectorScope(instruction);
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
  // The Shield Value reader evaluates both fields itself. In particular,
  // `object` is an Expr whose value is a symbolic selector; unwrapping it here
  // would make the interpreter evaluate the selector twice.
  // Both fields are evaluated by the primitive itself. In particular, the
  // schema requires linkKey to remain an Expr.
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
  const orderedPicks = orderedPickResolver(body);
  assertLinkedProvenance(body);
  const scopedContext = bindBodyReferences(body, context);
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
      scopedContext.link(key, value);
      const marker = key.indexOf('__continuous.settlement.');
      if (marker > 0) scopedContext.link(key.slice(marker), value);
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
