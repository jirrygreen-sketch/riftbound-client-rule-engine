import type { CostPayment, CostSpec } from '@riftbound/card-dsl';
import type { Domain, Expr } from '../../effects/contract.js';
import { DUEL_DOMAINS } from '../../cost/resources.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asConstantArray = (value: unknown): readonly unknown[] | undefined =>
  isRecord(value) && ['constant', 'literal'].includes(String(value.kind)) && Array.isArray(value.value) ? value.value as readonly unknown[] : undefined;

const asConstantNumber = (value: unknown): number | undefined =>
  isRecord(value) && ['constant', 'literal'].includes(String(value.kind)) && typeof value.value === 'number' ? value.value : undefined;

const asConstantRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) && ['constant', 'literal'].includes(String(value.kind)) && isRecord(value.value) ? value.value as Record<string, unknown> : undefined;

const PAYMENT_KINDS = new Set(['energy', 'power', 'xp', 'exhaust', 'discard', 'recycle', 'kill', 'reveal', 'spend-buff']);

const domainList = (value: unknown): readonly Domain[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.every(item => (DUEL_DOMAINS as readonly string[]).includes(item))
    ? value as readonly Domain[]
    : undefined;

/**
 * Translate the first cost.pay inside a leading choice.optional into the
 * registration-level CostSpec consumed by Finalize (CR 383.3.b.1).  Shapes
 * outside the evaluated constant spellings produced by the program authoring
 * pipeline are rejected so unsupported costs stay judge-required instead of
 * being approximated.
 */
export function costPayArgsToCostSpec(args: Record<string, unknown>): CostSpec | undefined {
  let energy: number | undefined;
  let xp: number | undefined;
  let power: readonly Domain[] | undefined;
  const payments: Record<string, unknown>[] = [];

  if (args.payments !== undefined) {
    const recordPayments = asConstantRecord(args.payments);
    const arrayPayments = asConstantArray(args.payments);
    if (recordPayments !== undefined) {
      for (const key of Object.keys(recordPayments)) {
      const value = recordPayments[key];
        if (key === 'energy') {
          if (typeof value !== 'number' || value < 0 || energy !== undefined) return undefined;
          energy = value;
        } else if (key === 'xp') {
          if (typeof value !== 'number' || value < 0 || xp !== undefined) return undefined;
          xp = value;
        } else if (key === 'power') {
          if (power !== undefined) return undefined;
          const domains = typeof value === 'number' ? undefined : domainList(value);
          if (domains === undefined) return undefined;
          power = domains;
        } else return undefined;
      }
    } else if (arrayPayments !== undefined) {
      for (const payment of arrayPayments) {
        if (!isRecord(payment)) return undefined;
        for (const key of Object.keys(payment)) {
          if (key !== 'kind' && !['amount', 'value', 'object', 'objects', 'choice', 'allowedDomains', 'self'].includes(key)) return undefined;
        }
        const kind = payment.kind;
        if (typeof kind !== 'string' || !PAYMENT_KINDS.has(kind)) return undefined;
        if (kind === 'energy' || kind === 'xp') {
          if (typeof payment.amount !== 'number' || payment.amount < 0) return undefined;
          if (kind === 'energy') {
            if (energy !== undefined) return undefined;
            energy = payment.amount;
          } else {
            if (xp !== undefined) return undefined;
            xp = payment.amount;
          }
        } else if (kind === 'power') {
          if (payment.choice !== undefined || payment.object !== undefined || payment.objects !== undefined) return undefined;
          const amount = typeof payment.amount === 'number' ? payment.amount : 1;
          if (typeof payment.amount !== 'number' && payment.value !== undefined) return undefined;
          if (amount < 0) return undefined;
          const domains = payment.allowedDomains === undefined ? [...DUEL_DOMAINS] : domainList(payment.allowedDomains);
          if (domains === undefined) return undefined;
          payments.push({ kind: 'power', amount: { kind: 'constant', value: amount }, allowedDomains: [...domains] });
        } else {
          payments.push(structuredClone(payment));
        }
      }
    } else return undefined;
  }

  if (args.power !== undefined) {
    const powerValue = asConstantArray(args.power) ?? args.power;
    const domains = domainList(powerValue);
    if (domains !== undefined) {
      if (power !== undefined) return undefined;
      payments.push({
        kind: 'power',
        amount: { kind: 'constant', value: 1 },
        allowedDomains: [...domains]
      });
    } else {
      const amount = asConstantNumber(powerValue);
      if (amount === undefined || amount <= 0) return undefined;
      payments.push({ kind: 'power', amount: { kind: 'constant', value: amount }, allowedDomains: [...DUEL_DOMAINS] });
    }
  }

  const spec: Record<string, unknown> = {};
  if (energy !== undefined) spec.energy = { kind: 'constant', value: energy };
  if (xp !== undefined) spec.payments = [{ kind: 'xp', amount: { kind: 'constant', value: xp } }];
  if (power !== undefined) spec.power = { kind: 'constant', value: [...power] };
  if (payments.length) spec.payments = [...(spec.payments as readonly unknown[] ?? []), ...payments];
  if (!Object.keys(spec).length) return undefined;
  return spec as unknown as CostSpec;
}
