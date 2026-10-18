import type { Expr, InstructionDef, InstructionResult, ResolveContext, Schema, Value } from '../contract.js';
import { payCostPlan } from '../../cost/payment.js';
import { CostPlanError, type CostPlan } from '../../cost/plan-types.js';
import { DUEL_DOMAINS } from '../../cost/resources.js';

export interface CostPayAnyArgs {
  readonly resource: Expr | Value;
  readonly domain?: Expr | Value;
  readonly amount: Expr | Value;
  readonly linkKey?: Expr | Value;
  readonly prompt?: Expr | Value;
}

const KEYS = new Set(['resource', 'domain', 'amount', 'linkKey', 'prompt']);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function id(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValue(value: unknown, seen = new Set<unknown>()): value is Value {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!Array.isArray(value) && !record(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every(item => isValue(item, seen));
  seen.delete(value);
  return valid;
}

function isExpr(value: unknown): value is Expr {
  return record(value) && typeof value.kind === 'string';
}

function judgeRequired(message: string): never {
  throw new CostPlanError('judge-required', message);
}

export function parseCostPayAnyArgs(value: unknown): CostPayAnyArgs {
  if (!record(value)) throw new TypeError('cost.pay-any args must be an object');
  for (const [key, entry] of Object.entries(value)) {
    if (!KEYS.has(key)) throw new TypeError(`Invalid cost.pay-any argument: ${key}`);
    if (isExpr(entry)) continue;
    if (!isValue(entry)) throw new TypeError(`Invalid cost.pay-any argument: ${key}`);
    if (key === 'resource' && entry !== 'energy' && entry !== 'power') throw new TypeError('cost.pay-any resource must be energy or power');
    if (key === 'domain' && entry !== 'rainbow') throw new TypeError('cost.pay-any domain must be rainbow');
    if (key === 'amount' && entry !== 'any') throw new TypeError('cost.pay-any amount must be any');
    if ((key === 'linkKey' || key === 'prompt') && !id(entry)) throw new TypeError(`cost.pay-any ${key} must be a nonempty string`);
  }
  if (value.resource === undefined || value.amount === undefined) throw new TypeError('cost.pay-any requires resource and amount');
  if (value.resource === 'energy' && value.domain !== undefined) throw new TypeError('cost.pay-any energy payments have no domain parameter');
  return value as unknown as CostPayAnyArgs;
}

const argsSchema: Schema<CostPayAnyArgs> = {
  parse: parseCostPayAnyArgs,
  safeParse(value: unknown) {
    try { return { success: true, data: parseCostPayAnyArgs(value) }; }
    catch (error) { return { success: false, error }; }
  }
};

function evaluated(ctx: ResolveContext, value: Expr | Value): Value {
  return isExpr(value) ? ctx.evaluate(value) : value as Value;
}

function plan(ctx: ResolveContext, resource: 'energy' | 'power', amount: number): CostPlan {
  return {
    finalized: true,
    id: `${ctx.source.ref.id}:cost-pay-any`,
    player: ctx.controller,
    source: { ...ctx.source.ref },
    printed: { energy: null, power: null },
    base: null,
    components: [],
    selectedAdditional: [],
    declinedAdditional: [],
    modifications: [],
    discounts: [],
    stages: ['base', 'alternate', 'optional-additional', 'mandatory-additional', 'increase', 'discount', 'total'],
    total: {
      energy: resource === 'energy' ? amount : 0,
      power: resource === 'power' && amount > 0 ? [{ amount, allowedDomains: [...DUEL_DOMAINS] }] : [],
      xp: 0,
      actions: []
    }
  };
}

const costPayAny = {
  op: 'cost.pay-any',
  argsSchema,
  execute(ctx: ResolveContext, args: CostPayAnyArgs): InstructionResult {
    const resource = evaluated(ctx, args.resource);
    if (resource !== 'energy' && resource !== 'power') throw new TypeError('cost.pay-any resource must evaluate to energy or power');
    const domain = args.domain === undefined ? undefined : evaluated(ctx, args.domain);
    if (resource === 'energy' && domain !== undefined) throw new TypeError('cost.pay-any energy payments have no domain parameter');
    if (domain !== undefined && domain !== 'rainbow') throw new TypeError('cost.pay-any domain must evaluate to rainbow');
    if (resource === 'power' && domain === 'rainbow') judgeRequired('Universal Power payment requires a domainless resource contract');
    if (evaluated(ctx, args.amount) !== 'any') throw new TypeError('cost.pay-any amount must evaluate to any');
    const linkKey = args.linkKey === undefined ? 'paid' : evaluated(ctx, args.linkKey);
    if (!id(linkKey)) throw new TypeError('cost.pay-any linkKey must be a nonempty string');
    const prompt = args.prompt === undefined ? undefined : evaluated(ctx, args.prompt);
    if (prompt !== undefined && !id(prompt)) throw new TypeError('cost.pay-any prompt must be a nonempty string');
    const available = resource === 'energy' ? ctx.player(ctx.controller).energy : ctx.player(ctx.controller).power.length;
    const write = (paid: number, receipt?: unknown): Record<string, Value> => {
      const values = {
        [linkKey]: paid,
        [`${linkKey}.amount`]: paid,
        ...(receipt === undefined ? {} : { [`${linkKey}.receipt`]: receipt as Value })
      } as Record<string, Value>;
      for (const [key, value] of Object.entries(values)) ctx.link(key, value);
      return values;
    };
    let paid = 0;
    if (available > 0) {
      const answer = ctx.choose<number>({
        id: `${ctx.source.ref.id}:cost-pay-any`,
        type: 'number',
        chooser: ctx.controller,
        visibility: 'public',
        min: 0,
        max: available,
        ...(prompt === undefined ? {} : { prompt })
      });
      if (!Number.isSafeInteger(answer) || answer < 0 || answer > available) {
        return { status: 'negated', reason: 'impossible', events: [] };
      }
      paid = answer;
    }
    if (paid === 0) return { status: 'executed', events: [], linkedValues: write(0) };
    const receipt = payCostPlan(ctx, plan(ctx, resource, paid), ctx.transaction === undefined ? {} : { transaction: ctx.transaction });
    return { status: 'executed', events: [...receipt.events], linkedValues: write(paid, receipt) };
  }
} satisfies InstructionDef<CostPayAnyArgs>;

export default costPayAny;
