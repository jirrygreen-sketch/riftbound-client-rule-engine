/**
 * Register a resolved cost modifier for later Finalize (CR v1.5 356.3–356.6).
 * Signed amounts infer increase/discount; explicit stage uses positive amounts.
 * [A] is any-domain Power, never an invented seventh Domain (163.2).
 * Durations use the existing layer registry; this primitive never pays a cost.
 */
import type { ContinuousEffectSpec, InstructionDef, InstructionResult, ObjectFilter, ResolveContext } from '../contract.js';
import { continuousId, isExpression } from '../../layers/rules/registration.js';
import { isDurationAlias, resolveContinuousDuration, settlementIdentity } from '../../layers/ops/index.js';
import { asValue } from '../interpreter/values.js';
import { blocked, literal, matchesCostFilter, record } from '../../cost/discounts/values.js';

export interface ContinuousCostModificationArgs {
  readonly resource: unknown;
  readonly amount: unknown;
  readonly stage?: unknown;
  readonly minimum?: unknown;
  readonly domains?: unknown;
  readonly domain?: unknown;
  readonly universal?: unknown;
  readonly appliesTo?: unknown;
  readonly filter?: unknown;
  readonly duration?: unknown;
  readonly target?: unknown;
  readonly instanceId?: unknown;
  readonly grantedBy?: unknown;
}

const KEYS = new Set(['resource', 'amount', 'stage', 'minimum', 'domains', 'domain', 'universal', 'appliesTo', 'filter', 'duration', 'target', 'instanceId', 'grantedBy']);
const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];
const ONE_SHOT_WINDOWS = new Set(['next-card-played-this-turn', 'next-unit-played-this-turn', 'next-spell-played-this-turn', 'next-gear-played-this-turn', 'per-turn-first-play']);

function parse(value: unknown): ContinuousCostModificationArgs {
  const args = record(value);
  if (args.resource === undefined || args.amount === undefined) throw new TypeError('continuous.cost-modification requires resource and amount');
  for (const [key, entry] of Object.entries(args)) {
    if (!KEYS.has(key)) throw new TypeError(`Unsupported continuous.cost-modification argument ${key}`);
    if (entry !== null && typeof entry === 'object' && 'kind' in entry && !isExpression(entry)) {
      throw new TypeError(`Invalid continuous.cost-modification expression ${key}`);
    }
    asValue(entry);
  }
  return { ...args } as unknown as ContinuousCostModificationArgs;
}

function read(ctx: ResolveContext, value: unknown): unknown {
  return isExpression(value) ? ctx.evaluate(value) : literal(value);
}

function bindFilter(ctx: ResolveContext, value: unknown): Record<string, unknown> {
  const filter = { ...record(value) };
  for (const key of ['controller', 'owner']) {
    if (['self', 'controller', 'you', 'caster'].includes(String(filter[key]))) filter[key] = ctx.controller;
    // Relative opponents are bound by the collector's source snapshot. Keep
    // them blocked here until the context exposes the game's player relation.
    if (['opponent', 'caster-opponent', 'their'].includes(String(filter[key]))) blocked('Resolved cost filters need an absolute opponent player id');
  }
  return filter;
}

function registerWithUniqueId(ctx: ResolveContext, spec: ContinuousEffectSpec, duration: Parameters<ResolveContext['addContinuous']>[1]): ContinuousEffectSpec {
  let candidate = spec;
  for (let attempt = 0; ; attempt += 1) {
    try {
      ctx.addContinuous(candidate, duration);
      return candidate;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('Continuous effect already registered:')) throw error;
      candidate = { ...spec, id: `${spec.id}:retry-${attempt + 1}` };
    }
  }
}

const definition = {
  op: 'continuous.cost-modification',
  argsSchema: { parse },
  execute(ctx: ResolveContext, args: ContinuousCostModificationArgs): InstructionResult {
    const targetId = args.target === undefined ? undefined : read(ctx, args.target);
    if (targetId !== undefined && (typeof targetId !== 'string' || !targetId.trim())) throw new TypeError('Cost modifier target must be a target spec id');
    const targets = typeof targetId === 'string' ? ctx.targets(targetId).filter(ref => ctx.object(ref) !== null) : undefined;
    if (targets?.length === 0) return { status: 'ignored', reason: 'mistargeted' };
    const resource = read(ctx, args.resource);
    if (resource !== 'energy' && resource !== 'power') blocked('Continuous cost modifiers only support Energy or Power');
    const amount = read(ctx, args.amount);
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) blocked('Continuous cost modifier amount must be a safe integer');
    const stage = args.stage === undefined ? undefined : read(ctx, args.stage);
    if (stage !== undefined && stage !== 'increase' && stage !== 'discount') blocked('Unknown continuous cost modification stage');
    if (stage !== undefined && amount < 0) blocked('Explicit cost modification stages require nonnegative amounts');
    const minimum = args.minimum === undefined ? undefined : read(ctx, args.minimum);
    if (minimum !== undefined && (typeof minimum !== 'number' || !Number.isSafeInteger(minimum) || minimum < 0)) blocked('Cost discount minimum must be a nonnegative integer');
    if ((stage === 'increase' || (stage === undefined && amount > 0)) && minimum !== undefined) blocked('A cost increase cannot have a discount minimum');
    const domains = args.domains === undefined ? undefined : read(ctx, args.domains);
    const domain = args.domain === undefined ? undefined : read(ctx, args.domain);
    const universal = args.universal === undefined ? undefined : read(ctx, args.universal);
    if (domains !== undefined && (!Array.isArray(domains) || !domains.length || domains.some(item => !DOMAINS.includes(String(item))))) blocked('Unknown Power modifier domains');
    if (domain !== undefined && domain !== 'any' && !DOMAINS.includes(String(domain))) blocked('Unknown Power modifier domain');
    if (universal !== undefined && universal !== true) blocked('Universal Power flag must be true');
    if ((universal === true || domain === 'any') && Array.isArray(domains) && DOMAINS.some(item => !domains.includes(item))) blocked('Universal Power cannot restrict domains');
    if (resource === 'energy' && (domains !== undefined || domain !== undefined || universal !== undefined)) blocked('Energy modifiers cannot select Power domains');
    const scope = args.appliesTo === undefined ? 'play-cost' : read(ctx, args.appliesTo);
    if (typeof scope === 'string' && !['play-cost', 'spell-play-cost', 'activated-ability-cost', 'self', 'source', 'self-play-cost', ...ONE_SHOT_WINDOWS].includes(scope)) blocked('Unknown continuous cost scope');
    const appliesTo = typeof scope === 'object' && scope !== null ? bindFilter(ctx, scope) : scope;
    if (typeof scope !== 'string' && (scope === null || typeof scope !== 'object' || Array.isArray(scope))) blocked('Continuous cost scope must be a supported name or object filter');
    // An explicit appliesTo object already names the affected player/object;
    // adding the default controller filter would make cross-player taxes and
    // increases impossible to reach. Keep the friendly default only when the
    // caller supplied neither scope nor filter.
    const filter = bindFilter(ctx,
      args.filter === undefined && args.appliesTo === undefined
        ? { controller: ctx.controller }
        : args.filter === undefined ? {} : read(ctx, args.filter));
    if (targets !== undefined) filter.objectRefs = targets;
    const env = { ctx, source: ctx.source };
    matchesCostFilter(filter, ctx.source, env);
    if (typeof appliesTo === 'object' && appliesTo !== null) matchesCostFilter(appliesTo, ctx.source, env);
    const durationValue = args.duration === undefined ? 'permanent' : read(ctx, args.duration);
    const window = typeof durationValue === 'string' && ONE_SHOT_WINDOWS.has(durationValue) ? durationValue : undefined;
    if (window === undefined && !isDurationAlias(durationValue)) blocked('Unknown continuous cost modification duration');
    // One-shot play windows are consumed by authoritative Finalize history,
    // so they stay registered until the turn owner records a successful play.
    const duration = window === undefined ? resolveContinuousDuration(durationValue as Parameters<typeof resolveContinuousDuration>[0], ctx.source.ref) : resolveContinuousDuration('permanent', ctx.source.ref);
    const grantedBy = args.grantedBy === undefined ? undefined : read(ctx, args.grantedBy);
    if (grantedBy !== undefined && (typeof grantedBy !== 'string' || !grantedBy.trim())) blocked('Cost modifier grantedBy must be a nonempty additional cost id');
    if (amount === 0) return { status: 'negated', reason: 'skipped', events: [] };
    const effect = {
      kind: 'continuous.cost-modification', resource, amount, appliesTo,
      ...(stage === undefined ? {} : { stage }),
      ...(minimum === undefined ? {} : { minimum }),
      ...(domains === undefined ? {} : { domains }),
      ...(domain === undefined ? {} : { domain }),
      ...(universal === undefined ? {} : { universal }),
      ...(window === undefined ? {} : { window }),
      ...(grantedBy === undefined ? {} : { grantedBy })
    };
    const instance = args.instanceId === undefined ? undefined : asValue(read(ctx, args.instanceId));
    if (instance !== undefined && (typeof instance !== 'string' || !instance.trim())) blocked('Cost modifier instanceId must be a nonempty string');
    const settlement = settlementIdentity(
      ctx.source.ref,
      'continuous.cost-modification',
      key => ctx.linked(key),
      (key, value) => ctx.link(key, value),
      instance as string | undefined,
    );
    const spec: ContinuousEffectSpec = {
      id: continuousId('continuous-cost-modification', ctx, settlement, { effect, filter, duration }),
      layer: 'arithmetic', source: ctx.source.ref, filter: asValue(filter) as ObjectFilter, effect
    };
    const registered = registerWithUniqueId(ctx, spec, duration);
    ctx.link('registered', { id: registered.id });
    return { status: 'executed', events: [] };
  }
} satisfies InstructionDef<ContinuousCostModificationArgs>;

export default definition;
