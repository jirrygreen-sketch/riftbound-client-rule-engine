import type { Ability, Condition } from '@riftbound/card-dsl';
import type { ObjectSnapshot, PlayerId, ResolveContext } from '../../effects/contract.js';
import { evaluateCondition } from '../../effects/interpreter/condition.js';
import { queryObjects } from '../../effects/interpreter/selectors.js';
import { MissingInformation } from '../../effects/interpreter/values.js';
import { keywordDefinitionsById } from '../../effects/keywords/registry.generated.js';
import type { ContinuousEffectRegistry } from '../../layers/duration.js';
import { refKey, sameRef } from '../../layers/types.js';
import { translateObjectFilter } from '../filters.js';
import { expandEffectiveKeywords, type EffectiveKeywordExpansion, type KeywordChange } from '../keyword-grants.js';
import { fields, grantedAbilities, ignoredKeywords } from './instruction.js';

export interface AbilityQueryScope { readonly operation: string; readonly player: PlayerId; }
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
