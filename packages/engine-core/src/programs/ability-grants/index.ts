import type { Ability, Condition, Instruction } from '@riftbound/card-dsl';
import type { ContinuousEffectSpec, Expr, ObjectFilter, ObjectRef, ObjectSnapshot, PlayerId, ResolveContext } from '../../effects/contract.js';
import { evaluateCondition } from '../../effects/interpreter/condition.js';
import { queryObjects } from '../../effects/interpreter/selectors.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { asValue } from '../../effects/interpreter/values.js';
import { keywordDefinitionsById } from '../../effects/keywords/registry.generated.js';
import type { ContinuousEffectRegistry } from '../../layers/duration.js';
import { effectId, isDurationAlias, resolveContinuousDuration, targetFilter } from '../../layers/ops/index.js';
import { refKey, sameRef } from '../../layers/types.js';
import { translateObjectFilter } from '../filters.js';
import { expandEffectiveKeywords, type EffectiveKeywordExpansion, type KeywordChange } from '../keyword-grants.js';
import { abilitySettlementIdentity, fields, grantedAbilities, ignoredKeywords } from './instruction.js';

export interface AbilityQueryScope { readonly operation: string; readonly player: PlayerId; }
export interface AbilityGrantSource {
  readonly ref: ObjectRef;
  /** Current source used for relative filters and conditions. */
  readonly snapshot: ObjectSnapshot;
  readonly controller: PlayerId;
  /** Owner's current layer view, including copy/trait/arithmetic results. */
  readonly object: (ref: ObjectRef) => ObjectSnapshot | null;
  readonly query: (filter: ObjectFilter) => readonly ObjectSnapshot[];
}
export interface EffectiveAbilityEntry {
  /** Persistent registration identity, separate from the body's instruction ids. */
  readonly id: string;
  readonly ability: Ability;
}
export interface EffectiveAbilities extends EffectiveKeywordExpansion {
  readonly entries: readonly EffectiveAbilityEntry[];
}

function environment(context: ResolveContext) {
  return { context, host: context.source.ref, linked: (key: string) => context.linked(key),
    canLookBack: () => true, isIgnored: () => false };
}
function argument(ctx: ResolveContext, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return value;
  const kind = String(value.kind);
  if (!['constant', 'literal', 'linked', 'linked-value', 'object-property', 'object-attribute', 'count', 'arithmetic',
    'player-property', 'turn-number', 'player-turn-count', 'object-designation'].includes(kind)) return value;
  if ((kind === 'constant' || kind === 'literal') && 'value' in value) return value.value;
  return ctx.evaluate(value as Expr);
}
function sourceContext(source: AbilityGrantSource, anchor: ObjectSnapshot): ResolveContext {
  return {
    source: anchor, controller: anchor.controller, timingPoint: 'cleanup-start',
    object: source.object, lastKnown: ref => source.object(ref) ?? source.snapshot,
    query: filter => [...source.query(filter)],
    zoneSlice: () => { throw new MissingInformation('Ability grant query requires a zone slice'); },
    targets: () => [], picks: () => [], player: () => { throw new MissingInformation('Ability grant query requires a player'); },
    evaluate: () => { throw new MissingInformation('Ability grant query requires an expression evaluator'); },
    test: () => { throw new MissingInformation('Ability grant query requires a condition evaluator'); },
    linked: () => undefined, history: () => 0,
    choose: () => { throw new MissingInformation('Ability grant query cannot choose'); },
    perform: () => ({ status: 'impossible', events: [] }), link: () => {},
    addContinuous: () => { throw new MissingInformation('Ability grant query cannot mutate layers'); },
    registerDelayedTrigger: () => { throw new MissingInformation('Ability grant query cannot register triggers'); },
  };
}
function applies(condition: unknown, context: ResolveContext, target: ObjectSnapshot): boolean {
  if (condition === undefined || condition === true) return true;
  if (condition === false) return false;
  if (typeof condition === 'function') return Boolean(condition(target));
  try { return evaluateCondition(condition as Condition, environment(context)); }
  catch (error) {
    // In particular, not(unknown) must remain inactive rather than becoming true.
    if (error instanceof MissingInformation) return false;
    throw error;
  }
}
function scoped(players: unknown, controller: PlayerId, player: PlayerId): boolean {
  if (players === 'controller' || players === 'self' || players === 'you') return player === controller;
  if (players === 'opponent') return player !== controller;
  return Array.isArray(players) ? players.includes(player) : players === player;
}

/**
 * Pure ability-layer consumer for the unique program/static route. Recompute
 * from active registrations on every query: there is no second mutable ability
 * store to survive a failed transaction, a source move, or a controller change.
 * `source` and context object/query reads must be the owner's current layer view.
 * Operation-scoped ignoring never changes the object's keyword characteristics.
 */
export function resolveAbilityGrants(
  source: ObjectSnapshot,
  printed: readonly Ability[],
  registry: ContinuousEffectRegistry,
  context: (source: ObjectSnapshot) => ResolveContext,
  scope?: AbilityQueryScope,
): EffectiveAbilities {
  const declared = printed.filter(ability => ability.kind !== 'keyword');
  const keywords = [...source.keywords, ...printed.flatMap(ability => ability.kind === 'keyword'
    ? [{ id: ability.keyword, ...(ability.value === undefined ? {} : { value: ability.value }),
      ...(ability.params === undefined ? {} : { params: ability.params }) }] : [])];
  const entries: EffectiveAbilityEntry[] = declared.map((ability, index) => ({ id: `printed:${refKey(source.ref)}:${index}`, ability }));
  const changes: KeywordChange[] = [];
  const ignores = new Set<string>();
  const hostContext = context(source);
  for (const entry of registry.active(undefined, ref => ref === undefined ? null : hostContext.object(ref))) {
    if (entry.effect.layer !== 'ability') continue;
    const effect = fields(entry.effect.effect);
    if (effect.kind !== 'continuous.grant-ability' && effect.kind !== 'continuous.ignore-ability') continue;
    const origin = entry.effect.source === undefined ? source : hostContext.object(entry.effect.source);
    // Permanent resolved grants do not depend on their spell remaining in its
    // old zone. Source-relative passive filters/conditions still require it.
    // The production static binder retains authored effect.filter as well as
    // its initially resolved registration filter. Rebind those symbolic anchors
    // from the live source; resolved instruction grants only have the latter.
    const filter = effect.filter === undefined ? entry.effect.filter : translateObjectFilter(fields(effect.filter));
    const relative = Object.keys(filter).some(key =>
      ['sameLocationAs', 'differentLocationFrom', 'object', 'source', 'exclude', 'other'].includes(key)) ||
      Object.values(filter).some(value => ['self', 'controller', 'opponent', 'you'].includes(String(value)));
    const relativePlayers = effect.kind === 'continuous.ignore-ability' &&
      ['controller', 'self', 'you', 'opponent'].includes(String(effect.players));
    if (!origin && (relative || relativePlayers || effect.condition !== undefined || effect.when !== undefined)) continue;
    const anchor = origin ?? source;
    const currentContext = context(anchor);
    if (!queryObjects(translateObjectFilter(filter), environment(currentContext)).some(object => sameRef(object.ref, source.ref))) continue;
    if (!applies(effect.condition ?? effect.when, currentContext, source)) continue;
    if (effect.kind === 'continuous.ignore-ability') {
      if (scope && effect.operation === scope.operation && scoped(effect.players, anchor.controller, scope.player)) {
        for (const keyword of ignoredKeywords(effect.ignores)) ignores.add(keyword.toLowerCase());
      }
      continue;
    }
    for (const [index, ability] of grantedAbilities(effect.abilities ?? effect.ability).entries()) {
      if (ability.kind === 'keyword') changes.push({ kind: 'grant', keywords: [{ id: ability.keyword,
        ...(ability.value === undefined ? {} : { value: ability.value }),
        ...([...keywordDefinitionsById.values()].some(def => def.keyword.toLowerCase() === ability.keyword.toLowerCase() && def.stacking === 'separate')
          ? { params: { ...ability.params, instanceId: ability.params?.instanceId ?? `granted:${entry.effect.id}:${index}` } }
          : ability.params === undefined ? {} : { params: ability.params }) }] });
      else entries.push({ id: `granted:${entry.effect.id}:${index}`, ability });
    }
  }
  const expansion = expandEffectiveKeywords({ ...source, keywords }, changes);
  // Ignoring is a property of this operation's consumption, not removal of the
  // keyword from characteristics (CR 767). Expand only the active instances.
  const active = ignores.size ? expandEffectiveKeywords({ ...source,
    keywords: expansion.keywords.filter(keyword => !ignores.has(keyword.id.toLowerCase())) }) : expansion;
  entries.push(...active.entries.map(entry => ({ ...entry, id: `keyword:${refKey(source.ref)}:${entry.id}` })));
  return Object.freeze({ keywords: expansion.keywords, abilities: Object.freeze(entries.map(entry => entry.ability)),
    entries: Object.freeze(entries) });
}

/**
 * Layer-registration projection for the unique program/static route. A static
 * ability remains the sole installer; this adapter only evaluates its current
 * selector/condition against the live source and exposes one registration per
 * selected object. It neither executes nor resolves the granted ability.
 */
export function projectStaticAbilityGrant(
  source: AbilityGrantSource,
  ability: Extract<Ability, { kind: 'static' }>,
): readonly ContinuousEffectSpec[] {
  const effect = fields(ability.effect);
  if (effect.kind !== 'continuous.grant-ability' && effect.kind !== 'continuous.ignore-ability') {
    throw new TypeError('Static grant projection requires a grant/ignore effect');
  }
  const filter = translateObjectFilter(fields(effect.filter ?? {}));
  const selected = source.query(filter);
  const conditionForRegistration = ability.condition === undefined ? undefined : (object: ObjectSnapshot) => {
    const targetContext = sourceContext(source, source.snapshot);
    const environmentWithTarget = new Proxy(environment(targetContext), {
      get(target, key) { return key === 'host' ? object.ref : Reflect.get(target, key); },
    });
    try { return evaluateCondition(ability.condition!, environmentWithTarget); }
    catch (error) { if (error instanceof MissingInformation) return false; throw error; }
  };
  const identity = `${source.ref.id}:${source.ref.zoneEntryId}`;
  return Object.freeze(selected.map((object, index) => Object.freeze({
    id: `program-static-grant:${identity}:${index}`,
    layer: 'ability', source: source.ref,
    filter: { ...targetFilter({ ref: object.ref, snapshot: object }), zone: object.zone },
    effect: { ...asValue({ ...effect, filter }) as Record<string, unknown>,
      ...(conditionForRegistration === undefined ? {} : { condition: conditionForRegistration }) } as ContinuousEffectSpec['effect'],
  })));
}

/**
 * Materialize the single-instruction card shape into the same ability-layer
 * registration stream. The card program remains the installer; no second
 * resolver or state store is introduced. Activation/trigger execution belongs
 * to the program/lifecycle owners after this projection.
 */
export function projectAbilityGrantInstruction(
  source: AbilityGrantSource,
  instruction: Instruction,
): readonly ContinuousEffectSpec[] {
  if (instruction.op !== 'continuous.grant-ability' && instruction.op !== 'continuous.ignore-ability') {
    throw new TypeError('Ability projection requires a grant/ignore instruction');
  }
  const args = fields(instruction.args);
  const context = sourceContext(source, source.snapshot);
  const filter = fields(argument(context, args.filter ?? {}));
  const selected = source.query(translateObjectFilter(filter));
  const effect: Record<string, unknown> = instruction.op === 'continuous.grant-ability'
    ? { kind: instruction.op, abilities: grantedAbilities(argument(context, args.ability ?? args.abilities)) }
    : { kind: instruction.op, ignores: ignoredKeywords(argument(context, args.ignores)),
      operation: argument(context, args.operation), players: argument(context, args.players) };
  const rawDuration = argument(context, args.duration ?? 'permanent');
  if (!isDurationAlias(rawDuration)) throw new TypeError('Unknown ability grant duration');
  const duration = resolveContinuousDuration(rawDuration, source.ref);
  const settlement = abilitySettlementIdentity(context, instruction.op, instruction.id, argument(context, args.settlementId));
  return Object.freeze(selected.map((object, index) => Object.freeze({
    id: effectId(instruction.op, source.ref, { ref: object.ref, snapshot: object }, String(index),
      `${instruction.id}:${settlement}`),
    layer: 'ability', source: source.ref,
    filter: { ...targetFilter({ ref: object.ref, snapshot: object }), zone: object.zone },
    effect: asValue(effect) as ContinuousEffectSpec['effect'],
  })));
}
