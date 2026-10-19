import type {
  Expr,
  InstructionDef,
  InstructionResult,
  ResolveContext,
  Schema,
} from '../contract.js';
import { registerPreparedDelayedTrigger } from '../delayed/registration.js';
import type { DelayedTriggerDeclaration } from '../delayed/types.js';

export type TriggerDelayedArgs = DelayedTriggerDeclaration;

const ARGUMENTS = new Set([
  'at', 'body', 'filter', 'eventFilter', 'duration', 'window', 'once', 'uses',
  'objects', 'count', 'referent', 'target',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExpr(value: unknown): value is Expr {
  return isRecord(value) && typeof value.kind === 'string';
}

function parseArgs(value: unknown): TriggerDelayedArgs {
  if (!isRecord(value)) throw new TypeError('trigger.delayed requires args');
  for (const [key, expression] of Object.entries(value)) {
    if (!ARGUMENTS.has(key)) throw new TypeError(`Unsupported trigger.delayed argument: ${key}`);
    if (!isExpr(expression)) throw new TypeError(`trigger.delayed ${key} must be an Expr`);
  }
  if (value.at === undefined || value.body === undefined) {
    throw new TypeError('trigger.delayed requires at and body');
  }
  if (value.filter !== undefined && value.eventFilter !== undefined) {
    throw new TypeError('trigger.delayed accepts filter or eventFilter, not both');
  }
  if (value.duration !== undefined && value.window !== undefined) {
    throw new TypeError('trigger.delayed accepts duration or window, not both');
  }
  if (value.objects !== undefined && value.target !== undefined) {
    throw new TypeError('trigger.delayed accepts objects or target, not both');
  }
  if (value.uses !== undefined && value.duration === undefined && value.window === undefined) {
    throw new TypeError('Unsupported trigger.delayed argument: uses requires duration or window');
  }
  return value as unknown as TriggerDelayedArgs;
}

const argsSchema: Schema<TriggerDelayedArgs> = {
  parse: parseArgs,
  safeParse(value: unknown) {
    try { return { success: true as const, data: parseArgs(value) }; }
    catch (error) { return { success: false as const, error }; }
  },
};

/**
 * Register a card-created delayed trigger (CR v1.5 391.2, 392, 393).
 *
 * The registration is a real mutation through ResolveContext. Every argument
 * is consumed at creation: the source/controller/filter/body are captured,
 * a count is materialized for the delayed body, and object locks become exact
 * id + zoneEntryId event filters. A future deadline or repeated use goes
 * through the versioned registration capability; without that capability it
 * fails closed. An opaque referent always fails closed because the frozen
 * context has no reliable identity binding for it.
 */
const triggerDelayed: InstructionDef<TriggerDelayedArgs> = {
  op: 'trigger.delayed',
  argsSchema,
  execute(ctx: ResolveContext, args: TriggerDelayedArgs): InstructionResult {
    const prepared = registerPreparedDelayedTrigger(ctx, args);
    return prepared.result === null
      ? { status: 'negated', reason: 'impossible', events: [] }
      : { status: 'executed', events: [] };
  },
};

export default triggerDelayed;
