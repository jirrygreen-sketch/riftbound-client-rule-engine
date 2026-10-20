import type { Expr, InstructionDef, InstructionResult, PlayerId, ResolveContext, Value } from '../contract.js';

export interface AdditionalTurnArgs {
  readonly owner?: Expr;
  readonly after: Expr;
}

export interface TurnTaskCapability {
  readonly version: 'riftbound.turn-task.v1';
  readonly scheduleAdditionalTurn: (owner: PlayerId, sourceInstructionId: string) => void;
}

const CAPABILITY = 'turnTasks' as const;
const CONTEXT_CAPABILITIES = new WeakMap<object, TurnTaskCapability>();

/** Bind this additive capability to the live source snapshot for scoped contexts. */
export function registerTurnTaskCapability(source: object, capability: TurnTaskCapability): void {
  if (capability.version !== 'riftbound.turn-task.v1') throw new TypeError('Unsupported turn-task capability version');
  CONTEXT_CAPABILITIES.set(source, capability);
}

/** Bind the same capability to an interpreter context derived from the source. */
export function inheritTurnTaskCapability(source: object, target: object): void {
  const capability = CONTEXT_CAPABILITIES.get(source);
  if (capability !== undefined) CONTEXT_CAPABILITIES.set(target, capability);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expression(value: unknown): Expr {
  if (record(value) && typeof value.kind === 'string') return value as unknown as Expr;
  if (typeof value === 'string') return { kind: 'constant', value };
  throw new TypeError('effect.additional-turn arguments must be Expr values');
}

function parse(value: unknown): AdditionalTurnArgs {
  if (!record(value)) throw new TypeError('effect.additional-turn args must be an object');
  for (const key of Object.keys(value)) {
    if (key !== 'owner' && key !== 'after') throw new TypeError(`Invalid effect.additional-turn argument: ${key}`);
  }
  if (value.after === undefined) throw new TypeError('effect.additional-turn requires after');
  return {
    ...(value.owner === undefined ? {} : { owner: expression(value.owner) }),
    after: expression(value.after),
  };
}

function ownerOf(ctx: ResolveContext, args: AdditionalTurnArgs): PlayerId | null {
  const value: Value = args.owner === undefined ? ctx.controller : ctx.evaluate(args.owner);
  if (value === 'controller') return ctx.controller;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default {
  op: 'effect.additional-turn',
  argsSchema: { parse },
  execute(ctx, args): InstructionResult {
    const after = ctx.evaluate(args.after);
    if (after !== 'this-turn') return { status: 'negated', reason: 'impossible', events: [] };
    const owner = ownerOf(ctx, args);
    if (owner === null) return { status: 'negated', reason: 'impossible', events: [] };
    const capability = (ctx as ResolveContext & { readonly turnTasks?: TurnTaskCapability })[CAPABILITY] ??
      CONTEXT_CAPABILITIES.get(ctx.source) ?? CONTEXT_CAPABILITIES.get(ctx);
    if (capability === undefined || capability.version !== 'riftbound.turn-task.v1') {
      throw new Error('effect.additional-turn requires the turn-task capability');
    }
    const instructionId = ctx.linked('currentInstructionId');
    capability.scheduleAdditionalTurn(owner,
      typeof instructionId === 'string' && instructionId.length > 0 ? instructionId : 'effect.additional-turn');
    ctx.link('additionalTurn', { player: owner, after: 'this-turn' });
    return { status: 'executed', events: [], linkedValues: { additionalTurn: { player: owner, after: 'this-turn' } } };
  },
} satisfies InstructionDef<AdditionalTurnArgs>;
