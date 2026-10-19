import type {
  Expr,
  Instruction,
  InstructionDef,
  InstructionResult,
  ResolveContext,
  Schema,
  Value,
} from '../contract.js';
import { BlockedReplacementError, type ReplacementAbilityInput } from '../../replacement/index.js';
import { bindWithDuration, replacementDuration } from './replacement.enter.js';
import { resolveLockedRefs } from '../delayed/registration.js';
import { bindResolveContext } from '../../events/action-adapter.js';
import type { ReplacementDependencies } from '../../replacement/index.js';

const REPLACEMENT_REGISTRATION_DEPENDENCIES = Symbol.for('riftbound.replacement-register.dependencies');
const dependenciesBySource = new WeakMap<object, ReplacementDependencies>();

export const REPLACEMENT_REGISTER_CAPABILITY_VERSION = 'riftbound.replacement-register.v1' as const;

/**
 * Additive seam for production hosts. The frozen ResolveContext does not carry
 * replacement dependencies, and the interpreter intentionally rebuilds a
 * plain context for every instruction. Keep this capability on the immutable
 * source snapshot so nested instruction scopes retain it.
 */
export function bindReplacementRegistrationDependencies(
  context: ResolveContext,
  dependencies: ReplacementDependencies,
): ResolveContext {
  dependenciesBySource.set(context.source, dependencies);
  const source = structuredClone(context.source);
  for (const symbol of Object.getOwnPropertySymbols(context.source)) {
    const descriptor = Object.getOwnPropertyDescriptor(context.source, symbol);
    if (descriptor !== undefined) Object.defineProperty(source, symbol, descriptor);
  }
  Object.defineProperty(source, REPLACEMENT_REGISTRATION_DEPENDENCIES, {
    configurable: false,
    enumerable: false,
    value: dependencies,
    writable: false,
  });
  return bindResolveContext(context, { source, replacement: dependencies } as Partial<ResolveContext>);
}

function dependenciesFor(context: ResolveContext): ReplacementDependencies {
  const direct = context as ResolveContext & { readonly replacement?: ReplacementDependencies };
  const source = context.source as ResolveContext['source'] & {
    readonly [REPLACEMENT_REGISTRATION_DEPENDENCIES]?: ReplacementDependencies;
  };
  const dependencies = direct.replacement ?? dependenciesBySource.get(context.source) ??
    source?.[REPLACEMENT_REGISTRATION_DEPENDENCIES];
  if (dependencies === undefined) {
    throw new BlockedReplacementError(
      'replacement.register requires replacement dependencies (host + pipeline); install the production capability',
    );
  }
  return dependencies;
}

export interface ReplacementRegisterArgs {
  readonly event: Expr | Value;
  readonly instead?: Expr | Value;
  readonly body?: Expr | Value;
  readonly duration?: Expr | Value;
  readonly window?: Expr | Value;
  readonly optional?: Expr | Value;
  readonly object?: Expr | Value;
  readonly uses?: Expr | Value;
}

const ARGUMENTS = new Set(['event', 'instead', 'body', 'duration', 'window', 'optional', 'object', 'uses']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === 'string';
}

function parseArgs(value: unknown): ReplacementRegisterArgs {
  if (!isRecord(value)) throw new TypeError('replacement.register args must be an object');
  for (const [key, expression] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Invalid replacement.register argument: ${key}`);
    if (!isExpr(expression)) throw new TypeError(`replacement.register ${key} must be an Expr`);
  }
  if (value.event === undefined) throw new TypeError('replacement.register requires event');
  if (value.instead !== undefined && value.body !== undefined) {
    throw new TypeError('replacement.register accepts instead or body, not both');
  }
  if (value.duration !== undefined && value.window !== undefined) {
    throw new TypeError('replacement.register accepts duration or window, not both');
  }
  return value as unknown as ReplacementRegisterArgs;
}

const argsSchema: Schema<ReplacementRegisterArgs> = {
  parse: parseArgs,
  safeParse(value: unknown) {
    try { return { success: true as const, data: parseArgs(value) }; }
    catch (error) { return { success: false as const, error }; }
  },
};

function evaluated(ctx: ResolveContext, value: Expr | Value | undefined): Value | undefined {
  return value === undefined ? undefined : isExpr(value) ? ctx.evaluate(value) : value;
}

function instructionBody(value: Value | undefined): readonly Instruction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(entry => isRecord(entry) &&
    typeof entry.id === 'string' && entry.id.length > 0 &&
    typeof entry.op === 'string' && entry.op.length > 0 && isRecord(entry.args))) {
    throw new BlockedReplacementError('replacement.register instead/body must be an instruction body');
  }
  return value as unknown as readonly Instruction[];
}

function constant(value: Value): Expr {
  return { kind: 'constant', value };
}

function withLockedObject(pattern: Record<string, unknown>, ref: { readonly id: string; readonly zoneEntryId: number }): Record<string, unknown> {
  const filter = isRecord(pattern.filter) ? { ...pattern.filter } : {};
  filter.objectId = ref.id;
  filter.zoneEntryId = ref.zoneEntryId;
  return { ...pattern, filter };
}

function nextRegistrationId(
  dependencies: ReplacementDependencies,
  source: { readonly id: string; readonly zoneEntryId: number },
): string {
  const checkpoint = dependencies.pipeline.checkpoint?.();
  const replacements = checkpoint !== null && typeof checkpoint === 'object'
    ? (checkpoint as { readonly replacements?: unknown }).replacements
    : undefined;
  if (!(replacements instanceof Map)) {
    throw new BlockedReplacementError(
      'replacement.register requires a pipeline checkpoint with persisted replacement identities',
    );
  }
  const base = `replacement:${source.id}:${source.zoneEntryId}:register`;
  let ordinal = 0;
  while (replacements.has(`${base}:${ordinal}`)) ordinal++;
  return `${base}:${ordinal}`;
}

/**
 * Register a delayed replacement through the public replacement binder.
 *
 * The declaration owns event matching, lifetime, optionality, an exact locked
 * incarnation, and a use limit. Production exposes replacement dependencies
 * only through the runtime extension already consumed by replacement.enter /
 * replacement.event / replacement.prevent; absent that seam this instruction
 * fails closed.
 */
const replacementRegister: InstructionDef<ReplacementRegisterArgs> = {
  op: 'replacement.register',
  argsSchema,
  execute(ctx: ResolveContext, args: ReplacementRegisterArgs): InstructionResult {
    const event = evaluated(ctx, args.event);
    if (event === undefined || !isRecord(event)) {
      throw new BlockedReplacementError('replacement.register event must be an EventPattern object');
    }
    const body = instructionBody(evaluated(ctx, args.instead ?? args.body));
    const optional = evaluated(ctx, args.optional);
    if (optional !== undefined && typeof optional !== 'boolean') {
      throw new BlockedReplacementError('replacement.register optional must be boolean');
    }
    if (args.duration === undefined && args.window === undefined) {
      throw new BlockedReplacementError('replacement.register requires a duration or window');
    }
    const duration = replacementDuration(evaluated(ctx, args.duration ?? args.window), 'replacement.register');
    if (duration === 'permanent') {
      throw new BlockedReplacementError(
        'replacement.register is a temporary-window instruction; use replacement.event for a permanent declaration',
      );
    }
    const usesValue = evaluated(ctx, args.uses);
    const uses = usesValue === undefined ? 1 : usesValue;
    if (typeof uses !== 'number' || !Number.isSafeInteger(uses) || uses < 1) {
      throw new BlockedReplacementError('replacement.register uses must be a positive safe integer');
    }
    if (duration === 'next-time-this-turn' && uses !== 1) {
      throw new BlockedReplacementError('replacement.register next-time window cannot have more than one use');
    }
    // The replacement pipeline has no persisted per-registration use count.
    // A local counter is lost across a checkpoint, so multi-use forms remain
    // fail-closed until the shared pipeline owns that state.
    if (uses !== 1) {
      throw new BlockedReplacementError(
        'replacement.register multi-use replacement needs a pipeline-persisted use counter',
      );
    }
    const object = evaluated(ctx, args.object);
    const objectRequested = object !== undefined;
    const locked = resolveLockedRefs(ctx, object);
    if (locked === null || locked.length > 1) {
      throw new BlockedReplacementError('replacement.register object must identify at most one exact incarnation');
    }
    if (objectRequested && locked.length === 0) {
      throw new BlockedReplacementError('replacement.register object did not resolve to a current incarnation');
    }
    const dependencies = dependenciesFor(ctx);
    const boundTurn = dependencies.pipeline.clock.turn;
    const id = nextRegistrationId(dependencies, ctx.source.ref);
    const pattern = locked[0] === undefined ? event : withLockedObject(event, locked[0]);
    const declaration: Instruction = {
      id: `${ctx.source.ref.id}.replacement.register`,
      op: 'replacement.event',
      args: {
        event: constant(pattern as unknown as Value),
        // One-use consumption lives on the pipeline's checkpointed
        // oncePerTurn state. The binder's local one-shot flag is not restored
        // by a Chain rollback, so this instruction deliberately uses only the
        // turn-bound lifetime and supplies the one-use limit below.
        window: constant('permanent'),
        optional: constant(optional === true),
        instead: constant(body as unknown as Value),
      },
    };
    // The binder creates its own stable base id. The public declaration id is
    // this instruction's own registration identity, so callers can cancel or
    // inspect it without conflating two declarations on the same host.
    const targetId = id;
    const ability: ReplacementAbilityInput = { replaces: {}, with: [declaration] };
    const bindingContext = bindResolveContext(ctx, { replacement: dependencies } as Partial<ResolveContext>);
    const bound = bindWithDuration(bindingContext, ability, 'this-turn', registration => {
      const matches = registration.matches.bind(registration);
      const apply = registration.apply.bind(registration);
      return {
        ...registration,
        id: targetId,
        // The pipeline's persisted oncePerTurn flag is rollback-safe. Both
        // temporary windows in this instruction allow exactly one successful
        // replacement during the registration turn.
        oncePerTurn: true,
        matches(action, original) {
          if (dependencies.pipeline.clock.turn !== boundTurn) return false;
          return matches(action, original);
        },
        apply(action, original) {
          const result = apply(action, original);
          return result;
        },
      };
    });
    return {
      status: 'executed',
      events: [],
      linkedValues: {
        replacementId: id,
        binderId: bound.id,
        duration,
        uses,
        ...(locked[0] === undefined ? {} : { object: locked[0] as unknown as Value }),
      },
    };
  },
};

export default replacementRegister;
