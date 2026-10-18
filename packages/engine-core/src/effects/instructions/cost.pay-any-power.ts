import type { Expr, InstructionDef, InstructionResult, ResolveContext, Schema, Value } from '../contract.js';
import { payCostPlan } from '../../cost/payment.js';
import type { CostPlan } from '../../cost/plan-types.js';
import { DUEL_DOMAINS } from '../../cost/resources.js';

export interface CostPayAnyPowerArgs {
  readonly amount?: Expr | Value;
  readonly linkKey?: Expr | Value;
  readonly prompt?: Expr | Value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function id(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function isExpr(value: unknown): value is Expr { return record(value) && typeof value.kind === 'string'; }
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

export function parseCostPayAnyPowerArgs(value: unknown): CostPayAnyPowerArgs {
  if (!record(value)) throw new TypeError('cost.pay-any-power args must be an object');
  for (const [key, entry] of Object.entries(value)) {
    if (!['amount', 'linkKey', 'prompt'].includes(key)) throw new TypeError(`Invalid cost.pay-any-power argument: ${key}`);
    if (isExpr(entry)) continue;
    if (!isValue(entry)) throw new TypeError(`Invalid cost.pay-any-power argument: ${key}`);
    if (key === 'amount' && entry !== 'any') throw new TypeError('cost.pay-any-power amount must be any');
    if ((key === 'linkKey' || key === 'prompt') && !id(entry)) throw new TypeError(`cost.pay-any-power ${key} must be a nonempty string`);
  }
  return value as unknown as CostPayAnyPowerArgs;
}

const argsSchema: Schema<CostPayAnyPowerArgs> = {
  parse: parseCostPayAnyPowerArgs,
  safeParse(value: unknown) {
    try { return { success: true, data: parseCostPayAnyPowerArgs(value) }; }
    catch (error) { return { success: false, error }; }
  }
};

function evaluate(ctx: ResolveContext, value: Expr | Value): Value { return isExpr(value) ? ctx.evaluate(value) : value as Value; }

function plan(ctx: ResolveContext, amount: number): CostPlan {
  return {
    finalized: true,
    id: `${ctx.source.ref.id}:cost-pay-any-power`,
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
    total: { energy: 0, power: amount > 0 ? [{ amount, allowedDomains: [...DUEL_DOMAINS] }] : [], xp: 0, actions: [] }
  };
}

const costPayAnyPower = {
  op: 'cost.pay-any-power',
  argsSchema,
  execute(ctx: ResolveContext, args: CostPayAnyPowerArgs): InstructionResult {
    if (args.amount !== undefined && evaluate(ctx, args.amount) !== 'any') throw new TypeError('cost.pay-any-power amount must evaluate to any');
    const linkKey = args.linkKey === undefined ? 'paidPower' : evaluate(ctx, args.linkKey);
    if (!id(linkKey)) throw new TypeError('cost.pay-any-power linkKey must be a nonempty string');
    const prompt = args.prompt === undefined ? undefined : evaluate(ctx, args.prompt);
    if (prompt !== undefined && !id(prompt)) throw new TypeError('cost.pay-any-power prompt must be a nonempty string');
    const available = ctx.player(ctx.controller).power.length;
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
        id: `${ctx.source.ref.id}:cost-pay-any-power`,
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
    const receipt = payCostPlan(ctx, plan(ctx, paid), ctx.transaction === undefined ? {} : { transaction: ctx.transaction });
    return { status: 'executed', events: [...receipt.events], linkedValues: write(paid, receipt) };
  }
} satisfies InstructionDef<CostPayAnyPowerArgs>;

export default costPayAnyPower;
