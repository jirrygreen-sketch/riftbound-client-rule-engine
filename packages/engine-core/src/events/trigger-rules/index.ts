import type { ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type {
  PipelineEvent,
  TriggerRule,
  TriggerRuleContext,
  TriggerRuleMode,
} from '../pipeline-types.js';

export type TriggerRulePredicate = (context: TriggerRuleContext) => boolean;
export type TriggerRuleAmount = number | ((context: TriggerRuleContext) => number);

export interface TriggerRuleOptions {
  readonly id: string;
  readonly source?: TriggerRule['source'];
  readonly activeZones?: TriggerRule['activeZones'];
  readonly delayed?: boolean;
  readonly boundToIncarnation?: boolean;
  readonly amount?: TriggerRuleAmount;
  readonly matches: TriggerRulePredicate;
}

function create(mode: TriggerRuleMode, options: TriggerRuleOptions): TriggerRule {
  if (!options.id || options.id.trim().length === 0) throw new TypeError('Trigger rule id must be non-empty');
  if (options.amount !== undefined && typeof options.amount === 'number' && (!Number.isSafeInteger(options.amount) || options.amount < 0)) {
    throw new RangeError('Trigger rule amount must be a nonnegative safe integer');
  }
  return { ...options, mode };
}

/** Add independent trigger items during collection (383.4.g.2 style effects). */
export function additionalTriggerRule(options: TriggerRuleOptions): TriggerRule {
  return create('additional', { ...options, amount: options.amount ?? 1 });
}

/** Multiply the collected trigger count.  The amount is a positive integer. */
export function multiplyTriggerRule(options: TriggerRuleOptions): TriggerRule {
  const amount = options.amount ?? 1;
  if (typeof amount === 'number' && (!Number.isSafeInteger(amount) || amount < 1)) throw new RangeError('Trigger multiplier must be a positive safe integer');
  return create('multiply', { ...options, amount });
}

/** Suppress a trigger before it becomes a pending chain item (386.1 style). */
export function suppressTriggerRule(options: Omit<TriggerRuleOptions, 'amount'>): TriggerRule {
  return create('suppress', options);
}

export class TriggerRuleBindingError extends Error {
  readonly name = 'TriggerRuleBindingError';
  constructor(readonly code: 'invalid-rule' | 'judge-required', message: string) {
    super(message);
  }
}

type ConstantAmount = { readonly kind: 'constant'; readonly value: number };

/** The evidence-backed subset of static trigger effects accepted by the adapter. */
export interface StaticTriggerRuleEffect {
  readonly kind: 'continuous.trigger-multiplicity' | 'continuous.trigger-suppression';
  readonly mode?: 'additional' | 'multiply';
  readonly amount?: ConstantAmount | number;
  readonly appliesTo?: 'self' | Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

const STATIC_EFFECT_KEYS = new Set(['kind', 'mode', 'amount', 'appliesTo']);
const APPLIES_TO_KEYS = new Set(['keyword', 'trigger', 'controller', 'zone', 'here']);
const EVENT_ALIASES: Readonly<Record<string, string>> = {
  conquered: 'conquer',
  held: 'hold',
  scored: 'score',
  'showdown-opened': 'showdown-open',
  'showdown-closed': 'showdown-close',
  'combat-ended': 'combat-end',
  'chain-item-finalized': 'chain-item-finalize',
  'chain-item-resolved': 'chain-item-resolve',
};

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function stringList(value: unknown, field: string): readonly string[] {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.some(item => typeof item !== 'string' || item.trim().length === 0)) {
    throw new TriggerRuleBindingError('invalid-rule', `${field} must be a non-empty string or string array`);
  }
  return values as readonly string[];
}

function constantAmount(value: unknown, mode: TriggerRuleMode): number {
  const amount = typeof value === 'number' ? value : record(value)?.kind === 'constant' ? record(value)?.value : undefined;
  if (!Number.isSafeInteger(amount) || (amount as number) < (mode === 'multiply' ? 1 : 0)) {
    throw new TriggerRuleBindingError('invalid-rule', 'Static trigger rule amount must be a supported constant integer');
  }
  return amount as number;
}

function playerMatches(expected: unknown, controller: PlayerId, relative: PlayerId): boolean {
  if (expected === undefined || expected === 'any') return true;
  if (expected === 'controller' || expected === 'self') return controller === relative;
  if (expected === 'opponent') return controller !== relative;
  throw new TriggerRuleBindingError('judge-required', `Unsupported trigger rule controller selector ${JSON.stringify(expected)}`);
}

function locationKey(source: ObjectSnapshot): string | null {
  const location = source.location;
  if (location === null) return null;
  return location.type === 'base'
    ? JSON.stringify(['base', location.player])
    : JSON.stringify(['battlefield', location.id]);
}

/**
 * Convert an evidence-backed static trigger rewrite into a collection-stage
 * rule. Unknown appliesTo fields fail closed so a future card cannot gain
 * executable semantics merely by spelling them in an open-ended effect object.
 */
export function triggerRuleFromStaticEffect(
  effect: StaticTriggerRuleEffect,
  source: ObjectSnapshot,
): TriggerRule {
  const raw = effect as unknown as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(raw)) {
    if (!STATIC_EFFECT_KEYS.has(key)) {
      throw new TriggerRuleBindingError('judge-required', `Unsupported static trigger rule field ${key}`);
    }
  }
  const suppression = effect.kind === 'continuous.trigger-suppression';
  if (!suppression && effect.kind !== 'continuous.trigger-multiplicity') {
    throw new TriggerRuleBindingError('judge-required', `Unsupported static trigger rule kind ${String(effect.kind)}`);
  }
  if (!suppression && effect.mode !== 'additional' && effect.mode !== 'multiply') {
    throw new TriggerRuleBindingError('invalid-rule', 'Trigger multiplicity requires mode additional or multiply');
  }
  if (suppression && effect.mode !== undefined) {
    throw new TriggerRuleBindingError('invalid-rule', 'Trigger suppression cannot declare a multiplicity mode');
  }
  const appliesTo = effect.appliesTo;
  if (appliesTo === undefined || appliesTo === 'self') {
    return create(suppression ? 'suppress' : effect.mode!, {
      id: `static-trigger-rule:${source.ref.id}:${source.ref.zoneEntryId}:${suppression ? 'suppress' : effect.mode}`,
      source,
      activeZones: ['board'],
      ...(!suppression ? { amount: effect.mode === 'additional' && effect.amount === undefined ? 1 : constantAmount(effect.amount, effect.mode!) } : {}),
      matches: ({ registration, controller, source: triggerSource }) =>
        registration.source.ref.id === source.ref.id &&
        registration.source.ref.zoneEntryId === source.ref.zoneEntryId &&
        registration.controller === source.controller &&
        controller === source.controller,
    });
  }
  const filter = record(appliesTo);
  if (filter === null) throw new TriggerRuleBindingError('invalid-rule', 'Static trigger appliesTo must be self or an object');
  for (const key of Object.keys(filter)) {
    if (!APPLIES_TO_KEYS.has(key)) {
      throw new TriggerRuleBindingError('judge-required', `Unsupported static trigger appliesTo field ${key}`);
    }
  }
  const keywords = filter.keyword === undefined ? undefined : stringList(filter.keyword, 'appliesTo.keyword').map(value => value.toLowerCase());
  const triggers = filter.trigger === undefined ? undefined : stringList(filter.trigger, 'appliesTo.trigger').map(value => EVENT_ALIASES[value] ?? value);
  const zones = filter.zone === undefined ? undefined : stringList(filter.zone, 'appliesTo.zone');
  if (filter.here !== undefined && filter.here !== true) {
    throw new TriggerRuleBindingError('judge-required', `Unsupported static trigger appliesTo.here ${JSON.stringify(filter.here)}`);
  }
  return create(suppression ? 'suppress' : effect.mode!, {
    id: `static-trigger-rule:${source.ref.id}:${source.ref.zoneEntryId}:${suppression ? 'suppress' : effect.mode}`,
    source,
    activeZones: ['board'],
    boundToIncarnation: true,
    ...(!suppression ? { amount: effect.mode === 'additional' && effect.amount === undefined ? 1 : constantAmount(effect.amount, effect.mode!) } : {}),
    matches: ({ registration, controller, source: triggerSource, event, ruleSource }) => {
      if (!playerMatches(filter.controller, triggerSource.controller, source.controller)) return false;
      if (zones !== undefined && !zones.includes(triggerSource.zone)) return false;
      if (keywords !== undefined) {
        const ids = new Set(triggerSource.keywords.map(keyword => keyword.id.toLowerCase()));
        if (!keywords.every(keyword => ids.has(keyword))) return false;
      }
      if (triggers !== undefined) {
        const actual = EVENT_ALIASES[event.timingPoint] ?? event.timingPoint;
        if (!triggers.includes(actual)) return false;
      }
      if (filter.here === true && (ruleSource === undefined || locationKey(triggerSource) === null || locationKey(triggerSource) !== locationKey(ruleSource))) return false;
      return true;
    },
  });
}

/** Stable registry key used when a program lifecycle binds a static rewrite. */
export function triggerRuleId(source: ObjectSnapshot, ordinal = 0): string {
  return `program-trigger-rule:${source.ref.id}:${source.ref.zoneEntryId}:${ordinal}`;
}

export function bindStaticTriggerRule(
  pipeline: { registerTriggerRule(rule: TriggerRule): void; unregisterTriggerRule(id: string): void },
  effect: StaticTriggerRuleEffect,
  source: ObjectSnapshot,
  ordinal = 0,
): { readonly id: string; unbind(): void } {
  const rule = triggerRuleFromStaticEffect(effect, source);
  const id = triggerRuleId(source, ordinal);
  pipeline.registerTriggerRule({ ...rule, id });
  return { id, unbind: () => pipeline.unregisterTriggerRule(id) };
}

/**
 * Structural adapter for `createProgramBinding({ staticBinder })`. It owns a
 * rule per static ability ordinal so entry and exit bind exactly one lifecycle.
 */
export function createTriggerRuleStaticBinder(
  pipeline: { registerTriggerRule(rule: TriggerRule): void; unregisterTriggerRule(id: string): void },
) {
  const ordinals = new Map<string, number>();
  return {
    bindStatic(
      ability: { readonly effect: StaticTriggerRuleEffect },
      source: ObjectSnapshot,
    ): { unbind(): void } {
      const key = `${source.ref.id}:${source.ref.zoneEntryId}`;
      const ordinal = ordinals.get(key) ?? 0;
      ordinals.set(key, ordinal + 1);
      return bindStaticTriggerRule(pipeline, ability.effect, source, ordinal);
    },
  };
}

export function resolveRuleAmount(rule: TriggerRule, context: TriggerRuleContext): number {
  const value = typeof rule.amount === 'function' ? rule.amount(context) : rule.amount;
  if (value === undefined) return rule.mode === 'multiply' ? 1 : rule.mode === 'additional' ? 1 : 0;
  if (!Number.isSafeInteger(value) || value < 0 || (rule.mode === 'multiply' && value < 1)) {
    throw new RangeError(`Invalid trigger rule amount for ${rule.id}`);
  }
  return value;
}

/** Small pure helper useful to adapters that need to inspect an event wave. */
export function sameBatch(left: PipelineEvent, right: PipelineEvent): boolean {
  return left.batchId !== undefined && left.batchId === right.batchId;
}

