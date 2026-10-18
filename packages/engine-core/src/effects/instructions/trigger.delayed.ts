import type {
  Expr, Instruction, InstructionResult, ObjectFilter, ObjectSelector, ResolveContext, TriggerSpec,
} from '../contract.js';
import { isTimingPointId } from '../../events/timing-points.js';
import { assertTriggerSpec } from '../../events/trigger-spec.js';
import { delayedDuration, DELAYED_EXPIRES_AT } from '../../events/delayed/duration.js';

/** Parsed trigger.delayed argument shapes (all Expr, evaluated at registration). */
export interface TriggerDelayedArgs {
  readonly at?: Expr;
  readonly body?: Expr;
  readonly filter?: Expr;
  readonly eventFilter?: Expr;
  readonly duration?: Expr;
  readonly window?: Expr;
  readonly once?: Expr;
  readonly objects?: Expr;
  readonly count?: Expr;
  readonly uses?: Expr;
  readonly referent?: Expr;
  readonly target?: Expr;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isExpr(value: unknown, active = new Set<object>()): value is Expr {
  if (!isRecord(value) || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  switch (value.kind) {
    case 'constant': case 'literal': valid = Object.hasOwn(value, 'value'); break;
    case 'object-property': case 'object-attribute':
      valid = isSelector(value.object) && isId(value.property ?? value.attribute); break;
    case 'linked': case 'linked-value':
      valid = isId(value.instructionId); break;
    case 'count': valid = true; break;
    case 'arithmetic':
      valid = Array.isArray(value.operands) && value.operands.length > 0 &&
        value.operands.every((operand: unknown) => isExpr(operand, active));
      break;
    default: valid = false;
  }
  active.delete(value);
  return valid;
}
function isSelector(value: unknown): value is ObjectSelector {
  if (value === 'self' || value === 'source') return true;
  return isRecord(value) && [ 'target', 'pick', 'linked' ].some(key => Object.hasOwn(value, key) && isId(value[key]));
}

function parseArgs(value: unknown): TriggerDelayedArgs {
  if (!isRecord(value)) throw new TypeError('trigger.delayed requires args');
  const allowed = [ 'at', 'body', 'filter', 'eventFilter', 'duration', 'window', 'once', 'objects', 'count', 'uses', 'referent', 'target' ];
  for (const [key, expression] of Object.entries(value)) {
    if (!allowed.includes(key) || !isExpr(expression)) {
      throw new TypeError('Invalid trigger.delayed argument: ' + key);
    }
  }
  if (value.at === undefined || value.body === undefined) {
    throw new TypeError('trigger.delayed requires at and body');
  }
  return { ...value } as unknown as TriggerDelayedArgs;
}

/** The card IR's TriggerOnce vocabulary (contract 3.1). */
const ONCE_SCOPES = [ 'per-turn', 'per-combat', 'per-chain', 'per-game' ] as const;
type OnceScope = (typeof ONCE_SCOPES)[number];

/**
 * CR v1.5 391.2/393: a Delayed Trigger is created by the resolving ability,
 * not a card's own triggered ability. Registration goes through the frozen
 * registerDelayedTrigger(at, body) contract into the pipeline's delayed mode,
 * which keeps the trigger alive after its source leaves the board and keeps
 * the registration's controller. 359.3.f.3.a: the trigger condition is
 * referenced at creation, so at/filter/once values are evaluated here and
 * stored on the registration (LKI).
 *
 * The frozen registration contract cannot carry a window. For the same
 * reason, this instruction cannot safely register a windowed ability through
 * the production bridge: doing so would leave it active after its expiry.
 * Windowed registrations therefore remain fail-closed until the bridge can
 * carry `expiresAt`; the helper lifecycle in events/delayed is already ready
 * for that adapter change.
 */
export default {
  op: 'trigger.delayed',
  argsSchema: { parse: parseArgs },
  execute: (ctx: ResolveContext, args: TriggerDelayedArgs): InstructionResult => {
    const at = ctx.evaluate(args.at!);
    const body = ctx.evaluate(args.body!);
    if (!isTimingPointId(at)) {
      return { status: 'negated', reason: 'impossible', events: [] };
    }
    if (!Array.isArray(body) || !body.every(isInstruction)) {
      return { status: 'negated', reason: 'impossible', events: [] };
    }
    let filter: ObjectFilter | undefined;
    if (args.filter !== undefined) {
      const value = ctx.evaluate(args.filter);
      if (!isRecord(value)) return { status: 'negated', reason: 'impossible', events: [] };
      filter = normalizeFilter(value);
    } else if (args.eventFilter !== undefined) {
      const value = ctx.evaluate(args.eventFilter);
      if (isTimingPointId(value)) {
        filter = { objectId: value };
      } else if (isRecord(value)) {
        filter = normalizeFilter(value);
      } else {
        return { status: 'negated', reason: 'impossible', events: [] };
      }
    } else {
      filter = {};
    }
    let once: OnceScope | undefined;
    if (args.once !== undefined) {
      const value = ctx.evaluate(args.once);
      if (typeof value !== 'string' || !ONCE_SCOPES.includes(value as OnceScope)) {
        return { status: 'negated', reason: 'impossible', events: [] };
      }
      once = value as OnceScope;
    }
    const hasWindow = args.duration !== undefined || args.window !== undefined;
    const duration = hasWindow ? delayedDuration(ctx.evaluate((args.duration ?? args.window)!)) : undefined;
    if (hasWindow) {
      if (duration === undefined) {
        return { status: 'negated', reason: 'impossible', events: [] };
      }
      // 359.3.e.16 rejects a duration that has already ended. For a future
      // window, the production registration still needs expiresAt to stop at
      // the end of that window. ResolveContext cannot pass expiresAt, so a
      // successful registration here would invent an unbounded ability.
      if (duration.kind === 'this-turn' && isTimingPointPassed(ctx.timingPoint, DELAYED_EXPIRES_AT)) {
        return { status: 'negated', reason: 'impossible', events: [] };
      }
      return { status: 'negated', reason: 'impossible', events: [] };
    }
    const spec = assertDelayedSpec({ at, filter: filter!, ...(once ? { once } : {}) });
    if (spec === null) return { status: 'negated', reason: 'impossible', events: [] };
    ctx.registerDelayedTrigger(spec, body as readonly Instruction[]);
    ctx.link('registered', { at, filter: filter!, ...(once ? { once } : {}), registeredAt: ctx.timingPoint });
    return { status: 'executed', events: [] };
  },
} as const;

function isInstruction(value: unknown): value is Instruction {
  return isRecord(value) && typeof value.op === 'string' && typeof value.id === 'string';
}

/** Card filters spell the ability controller as "controller"; the pipeline does not. */
function normalizeFilter(value: Record<string, unknown>): ObjectFilter {
  const output: Record<string, unknown> = { ...value };
  for (const key of [ 'controller', 'owner' ]) {
    if (output[key] === 'controller') output[key] = 'self';
  }
  return output as ObjectFilter;
}

/** validateTriggerSpec, mapped to the instruction's negated result. */
function assertDelayedSpec(spec: TriggerSpec): TriggerSpec | null {
  try {
    assertTriggerSpec(spec);
    return spec;
  } catch {
    return null;
  }
}

/**
 * CR 359.3.e.16's example: registering during the Ending Phase (after the
 * "end of this turn" timing has begun) does not generate the ability. The
 * production turn sequence orders [main-start, main-end, turn-end, ...]; a
 * registration at or after the expiry point is too late.
 */
const TIMING_ORDER = [ 'turn-start', 'awaken-start', 'awaken-end', 'beginning-start', 'beginning-end', 'channel-start', 'channel-end', 'draw-start', 'draw-end', 'main-start', 'main-end', 'turn-end', 'cleanup-start', 'cleanup-end' ] as const;
function isTimingPointPassed(current: string, expiry: string): boolean {
  return TIMING_ORDER.indexOf(current as never) >= TIMING_ORDER.indexOf(expiry as never);
}
