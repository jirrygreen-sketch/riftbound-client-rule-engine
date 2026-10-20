import { validateCardProgram, type Ability, type Condition, type Expr } from '@riftbound/card-dsl';
import type { ContinuousEffectSpec, Duration, ObjectRef, ObjectSnapshot, ResolveContext } from '../effects/contract.js';
import type { KeywordDef } from '../effects/keyword-contract.js';
import { keywordDefinitionsById } from '../effects/keywords/registry.generated.js';
import { evaluateCondition } from '../effects/interpreter/condition.js';
import { evaluateExpression } from '../effects/interpreter/expr.js';
import { queryObjects } from '../effects/interpreter/selectors.js';
import { ContinuousEffectRegistry } from '../layers/duration.js';
import { LayerEngine } from '../layers/engine.js';
import { matchesObjectFilter } from '../layers/filter.js';
import { refKey, sameRef, type LayeredObjectSnapshot, type RegisteredContinuousEffect, type TimingEvent } from '../layers/types.js';
import { ProgramBindingError } from './errors.js';
import { expandProgram } from './keywords.js';
import { translateObjectFilter } from './filters.js';

type Keyword = ObjectSnapshot['keywords'][number] & {
  readonly params?: Extract<Ability, { kind: 'keyword' }>['params'];
};
type RecordValue = Record<string, unknown>;
export interface KeywordChange {
  readonly kind: 'grant' | 'remove';
  readonly keywords: readonly Keyword[];
}
export interface EffectiveKeywordExpansion {
  readonly keywords: readonly Keyword[];
  readonly abilities: readonly Ability[];
  readonly entries: readonly { readonly id: string; readonly ability: Ability }[];
}
export interface GrantedKeywordAbilityEntry {
  readonly id: string;
  readonly ability: Ability;
}
type AppliedKeywordChanges = ReadonlyMap<string, ReadonlyMap<string, KeywordChange>>;
interface PreGrantView {
  readonly view: Map<string, LayeredObjectSnapshot>;
  readonly instances: ReadonlyMap<string, readonly Keyword[]>;
}

function blocked(message: string): never {
  throw new ProgramBindingError('judge-required', message);
}
function record(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : {};
}
function definition(id: string): KeywordDef {
  const found = [...keywordDefinitionsById.values()].find(item => item.keyword.toLowerCase() === id.toLowerCase());
  return found ?? blocked(`Keyword ${id} has no executable KeywordDef`);
}
function keywordNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) blocked('Keyword values must be non-negative safe integers');
  return value;
}

function keywordInstances(source: ObjectSnapshot, changes: readonly KeywordChange[]): Keyword[] {
  const instances = [...source.keywords];
  for (const change of changes) {
    if (change.kind === 'grant') instances.push(...change.keywords);
    else {
      const removed = new Set(change.keywords.map(keyword => keyword.id.toLowerCase()));
      for (let index = instances.length - 1; index >= 0; index--) {
        if (removed.has(instances[index]!.id.toLowerCase())) instances.splice(index, 1);
      }
    }
  }
  return instances;
}

const TOP_DECK_PICK_PLAYER = Object.freeze({ kind: 'constant' as const, value: 'A' });

/**
 * KeywordDefs own the functional ability, while the lifecycle assembler owns
 * the current controller and ordered-zone binding. Add those two runtime facts
 * to a triggered keyword's authored inspect step when it explicitly requests a
 * top-of-deck pick. The source selector remains the exact object whose keyword
 * supplied this ability.
 */
function bindKeywordLifecycle(ability: Ability): Ability {
  if (ability.kind !== 'triggered') return ability;
  return {
    ...ability,
    trigger: {
      ...ability.trigger,
      filter: ability.trigger.filter.objectId === 'self'
        ? { objectId: 'self' }
        : ability.trigger.filter,
    },
    body: ability.body.map(instruction => {
      if (instruction.op !== 'effect.inspect') return instruction;
      const args = record(instruction.args);
      const constantString = (value: unknown): string | null => {
        const expression = record(value);
        return (expression.kind === 'constant' || expression.kind === 'literal') && typeof expression.value === 'string'
          ? expression.value : null;
      };
      const picksId = constantString(args.picksSpecId);
      if (constantString(args.scope) !== 'top' || constantString(args.zone) !== 'deck' || picksId === null) return instruction;
      const picks = instruction.picks ?? [];
      return {
        ...instruction,
        args: { ...instruction.args, player: TOP_DECK_PICK_PLAYER },
        picks: picks.some(pick => pick.id === picksId) ? picks : [
          ...picks,
          {
            id: picksId,
            options: [],
            ordered: true,
            selection: 'all',
            zoneSlice: { zone: 'deck', from: 'top', count: args.amount as Expr },
          },
        ],
      };
    }),
  };
}

/** Keyword conditions read the effective host, including combatRole. */
function bindLayerCondition(condition: unknown, host?: ObjectRef): unknown {
  if (condition === undefined || typeof condition !== 'object' || condition === null) return condition;
  const value = record(condition);
  const rewrite = (item: unknown): unknown => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const expression = record(item);
    if (expression.kind === 'object-property' || expression.kind === 'object-attribute') {
      return { ...expression, object: 'self' };
    }
    return Object.fromEntries(Object.entries(expression).map(([key, child]) =>
      [key, Array.isArray(child) ? child.map(rewrite) : rewrite(child)]));
  };
  return rewrite(value);
}

/** CR 801.3, 807.2, 809.2, 810.2, 814.2: merge instances before expanding. */
export function expandEffectiveKeywords(source: ObjectSnapshot, changes: readonly KeywordChange[] = []): EffectiveKeywordExpansion {
  const instances = keywordInstances(source, changes);
  const groups = new Map<string, Keyword[]>();
  for (const keyword of instances) {
    if (keyword.value !== undefined) keywordNumber(keyword.value);
    const key = keyword.id.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), keyword]);
  }
  const keywords: Keyword[] = [];
  const entries: { id: string; ability: Ability }[] = [];
  for (const group of groups.values()) {
    const def = definition(group[0]!.id);
    if (!def.valued && group.some(keyword => keyword.value !== undefined)) {
      blocked(`Keyword ${def.keyword} does not accept a value`);
    }
    const values = def.stacking === 'sum'
      ? [def.valued ? keywordNumber(group.reduce((sum, entry) => sum + (entry.value ?? 1), 0)) : undefined]
      : def.stacking === 'single' ? [group[0]!.value] : group.map(entry => entry.value);
    for (const [index, value] of values.entries()) {
      const params = def.stacking === 'sum'
        ? group.find(keyword => keyword.params !== undefined)?.params
        : group[index]?.params;
      const keyword = Object.freeze({ id: def.keyword, ...(value === undefined ? {} : { value }),
        ...(params === undefined ? {} : { params }) });
      keywords.push(keyword);
      const instance = def.stacking === 'separate' ? params?.instanceId ?? `printed-${index}` : 'effective';
      const instanceParams = def.stacking === 'separate' && values.length > 1 && params?.instanceId === undefined
        ? { ...params, instanceId: `keyword:${def.keyword.toLowerCase()}:${source.cardId ?? source.ref.id}:${index}` } : params;
      // Share the printed-ability expander, including parameter validation and
      // legacy single-instance ids. Track each grant independently of array
      // positions so another keyword's expiry cannot rename a live trigger.
      const { expanded } = expandProgram({ canonicalCardId: source.cardId ?? source.ref.id,
        rulesetVersion: 'core-1.5', status: 'executable', sourceText: '[effective keyword expansion]', abilities: [],
      }, { ...source, keywords: [{ ...keyword, ...(instanceParams === undefined ? {} : { params: instanceParams }) }] });
      entries.push(...expanded.map((ability, ordinal) => ({
        id: `${def.keyword.toLowerCase()}:${String(instance)}:${ordinal}`,
        ability: bindKeywordLifecycle(ability),
      })));
    }
  }
  const abilities = entries.map(entry => entry.ability);
  const validation = validateCardProgram({
    canonicalCardId: source.cardId ?? source.ref.id, rulesetVersion: 'core-1.5', status: 'executable',
    sourceText: '[effective keyword expansion]', abilities,
  });
  if (!validation.ok) blocked(`Effective keyword expansion is invalid: ${JSON.stringify(validation.issues)}`);
  return { keywords: Object.freeze(keywords), abilities: Object.freeze(abilities), entries: Object.freeze(entries) };
}

export interface KeywordGrantLayerOptions {
  /** A real host context; expressions and conditions use the shared interpreter. */
  readonly context: (source: ObjectSnapshot) => ResolveContext;
  readonly registry?: ContinuousEffectRegistry;
  /**
   * Produce only the effects supplied by keyword changes. The production
   * CardProgram lifecycle already binds printed keyword expansions, so this
   * mode avoids charging or applying the same printed keyword twice.
   */
  readonly grantedOnly?: boolean;
  /** Lifecycle hook for non-static keyword abilities such as Vision. */
  readonly onKeywordAbilities?: (ref: ObjectRef, entries: readonly GrantedKeywordAbilityEntry[]) => void;
  /** Lifecycle hook for static effects expanded from keyword changes. */
  readonly onKeywordEffects?: (effects: readonly ContinuousEffectSpec[]) => void;
  /** The lifecycle consumer owns registration of the generated effects. */
  readonly deferGeneratedEffects?: boolean;
  /** Keep every printed or granted keyword-expanded lifecycle ability. */
  readonly includeAllKeywordAbilities?: boolean;
  /** Restrict generated lifecycle entries to these effective keywords. */
  readonly lifecycleKeywords?: readonly string[];
}

/**
 * Injectable through ChainEngineOptions.layers. This adapter owns keyword
 * expansion; callers must not also bind printed keyword expansions through
 * attachProgramLifecycle. The default lifecycle still needs that integration.
 * Non-static expansions fail closed until their lifecycle binding is available.
 * Tank's declaration is exposed only; its combat consumer remains
 * judge-required until combat can enforce CR 815's assignment rule.
 */
export class KeywordGrantLayerEngine extends LayerEngine {
  private readonly generated = new Set<string>();
  private view = new Map<string, LayeredObjectSnapshot>();
  private expansions = new Map<string, EffectiveKeywordExpansion>();
  private grantedAbilities = new Map<string, readonly GrantedKeywordAbilityEntry[]>();
  private readonly priorGrantedRefs = new Map<string, ObjectRef>();
  private readonly lifecycleKeywords: Set<string>;
  private refreshing = false;

  constructor(objects: readonly ObjectSnapshot[], private readonly options: KeywordGrantLayerOptions) {
    super(objects, options.registry);
    this.lifecycleKeywords = new Set(options.lifecycleKeywords?.map(keyword => keyword.toLowerCase()));
  }

  /** Current source for an exact host-bound condition. */
  private sourceSnapshot(ref: ObjectRef): ObjectSnapshot | null {
    return this.objectsView().find(object => sameRef(object.ref, ref)) ?? null;
  }

  private conditionMatches(condition: unknown, source: ObjectSnapshot, host: ObjectSnapshot = source): boolean {
    if (condition === undefined || condition === true) return true;
    if (condition === false) return false;
    if (typeof condition === 'function') return Boolean((condition as (object: ObjectSnapshot) => unknown)(source));
    const environment = this.environment(source);
    const context = new Proxy(environment.context, { get: (target, key) => {
      if (key === 'object') return (ref: ObjectRef) => sameRef(ref, host.ref) ? { ...host, designation: host.combatRole } : Reflect.get(target, key)(ref);
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    return evaluateCondition(condition as Condition, { ...environment, context, host: host.ref });
  }

  private clearGenerated(): void {
    for (const id of this.generated) this.registry.remove(id);
    this.generated.clear();
  }

  override setObjects(objects: Parameters<LayerEngine['setObjects']>[0]): void {
    this.clearGenerated();
    super.setObjects(objects);
  }
  override addContinuous(effect: ContinuousEffectSpec, duration: Duration, timestamp?: number): RegisteredContinuousEffect {
    this.clearGenerated();
    return super.addContinuous(effect, duration, timestamp);
  }
  override removeContinuous(id: string): boolean {
    this.clearGenerated();
    return super.removeContinuous(id);
  }
  override advance(event: TimingEvent): readonly string[] {
    this.clearGenerated();
    const expired = super.advance(event);
    this.refresh();
    return expired;
  }

  private environment(source: ObjectSnapshot) {
    const base = this.options.context(source);
    // KeywordDefs predate ObjectSnapshot.combatRole and spell it designation.
    const alias = (object: ObjectSnapshot) => ({ ...object, designation: object.combatRole });
    const context = new Proxy(base, { get: (target, key) => {
      if (key === 'source') return alias(source);
      if (key === 'controller') return source.controller;
      if (key === 'object') return (ref: ObjectRef) => {
        const object = this.view.get(refKey(ref));
        return object ? alias(object) : null;
      };
      if (key === 'query') return (filter: Parameters<ResolveContext['query']>[0]) => {
        return [...this.view.values()].filter(object =>
          matchesObjectFilter(filter, object, { controller: source.controller, anchor: source })).map(alias);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    return { context, host: source.ref, linked: (key: string) => context.linked(key), canLookBack: () => true, isIgnored: () => false };
  }

  private value(value: unknown, source: ObjectSnapshot): unknown {
    return typeof value === 'object' && value !== null && 'kind' in value
      ? evaluateExpression(value as Expr, this.environment(source)) : value;
  }

  /** Re-materialize the current keyword snapshot after a production registry write. */
  refreshNow(): void {
    this.refresh();
  }

  private matches(entry: RegisteredContinuousEffect, object: LayeredObjectSnapshot): boolean {
    const filter = translateObjectFilter(record(record(entry.effect.effect).filter ?? entry.effect.filter));
    const source = entry.effect.source === undefined ? object : this.view.get(refKey(entry.effect.source));
    return queryObjects(filter, this.environment(source ?? object)).some(candidate => sameRef(candidate.ref, object.ref));
  }

  private condition(effect: RecordValue, object: LayeredObjectSnapshot, source: ObjectSnapshot): boolean {
    const condition = effect.condition ?? effect.when;
    if (condition === undefined || condition === true) return true;
    if (condition === false) return false;
    if (typeof condition === 'function') return Boolean(condition(object));
    return evaluateCondition(condition as Condition, this.environment(source));
  }

  private keywordEffect(entry: RegisteredContinuousEffect): boolean {
    const effect = record(entry.effect.effect);
    return (String(effect.kind).includes('keyword') || effect.kind === 'continuous.combat') &&
      (effect.keyword !== undefined || effect.keywords !== undefined);
  }

  private changes(entries: readonly RegisteredContinuousEffect[], object: LayeredObjectSnapshot,
    beforeGrant: (id: string) => PreGrantView): ReadonlyMap<string, KeywordChange> {
    const changes = new Map<string, KeywordChange>();
    for (const entry of entries) {
      if (entry.effect.layer !== 'ability' || !this.keywordEffect(entry) || !this.matches(entry, object)) continue;
      const effect = record(entry.effect.effect);
      const companions = entries.filter(other => other.effect.layer === 'arithmetic' && other.effect.id.startsWith(entry.effect.id + ':value:'));
      const savedView = this.view;
      try {
        let subject = object;
        if (companions.length) {
          const before = beforeGrant(entry.effect.id);
          this.view = before.view;
          const key = refKey(object.ref);
          subject = { ...(before.view.get(key) ?? object), keywords: before.instances.get(key) ?? object.keywords };
        }
        const source = this.view.get(refKey(entry.effect.source ?? object.ref)) ?? subject;
        // Promotion callbacks must still see omitted printed values, while
        // Might and interpreter queries include all effects except this grant.
        if (!this.condition(effect, subject, source)) continue;
        const raw = effect.keywords ?? effect.keyword;
        const keywords = (Array.isArray(raw) ? raw : [raw]).map((item, index): Keyword => {
          const declaration = typeof item === 'string' ? { id: item, value: effect.keywordValue ?? effect.value } : record(item);
          const id = declaration.id ?? declaration.keyword;
          if (typeof id !== 'string' || !id) blocked('Keyword grant requires an id');
          // Read the companion's contribution once, not the retained base
          // value in the ability-layer registration.
          const companion = companions.find(other => other.effect.id === entry.effect.id + ':value:' + index);
          const value = this.value(companion ? record(companion.effect.effect).amount : declaration.value, source);
          return { id, ...(value === undefined ? {} : { value: keywordNumber(value) }),
            ...(declaration.params === undefined ? {} : { params: declaration.params as Keyword['params'] }) };
        });
        const kind = String(effect.kind);
        // Only a single-stacking keyword is redundant across grant sources.
        // Sum/separate instances must remain independently represented so the
        // common expansion path can aggregate or duplicate them by CR 807.2 and
        // 817.2; pruning every same-id grant silently dropped earlier values.
        const ids = new Set(keywords.filter(keyword => definition(keyword.id).stacking === 'single')
          .map(keyword => definition(keyword.id).keyword.toLowerCase()));
        for (const [id, prior] of changes) {
          const merged = prior.keywords.filter(keyword => !ids.has(definition(keyword.id).keyword.toLowerCase()));
          changes.set(id, { ...prior, keywords: merged });
        }
        changes.set(entry.effect.id, { kind: kind.includes('remove') || kind.includes('lose') ? 'remove' : 'grant', keywords });
      } finally {
        this.view = savedView;
      }
    }
    return changes;
  }

  private staticEffects(source: LayeredObjectSnapshot, expansion: EffectiveKeywordExpansion): ContinuousEffectSpec[] {
    return expansion.abilities.flatMap((ability, index) => {
      const keyword = expansion.entries[index]?.id.split(':', 1)[0];
      if (this.lifecycleKeywords.size > 0 && (keyword === undefined || !this.lifecycleKeywords.has(keyword))) return [];
      if (ability.kind !== 'static') {
        if (this.options.includeAllKeywordAbilities === true && ability.kind === 'triggered') return [];
        return blocked(`Dynamic ${ability.kind} keyword abilities need a lifecycle binder`);
      }
      const effect = record(ability.effect);
      if (!['continuous.might', 'continuous.movement', 'continuous.combat', 'continuous.timing', 'target.tax'].includes(String(effect.kind))) {
        blocked(`Keyword static ${String(effect.kind)} needs a layer adapter`);
      }
      const movement = effect.kind === 'continuous.movement' && typeof effect.permission === 'string'
        ? { permission: { routes: [effect.permission], move: effect.move, source: effect.source, destination: effect.destination }, canGank: effect.permission === 'battlefield-to-battlefield' }
        : {};
      const normalized = Object.fromEntries(Object.entries(effect).map(([key, value]) => [key, this.value(value, source)]));
      const staticCondition = (object: ObjectSnapshot) => sameRef(object.ref, source.ref);
      const authoredCondition = bindLayerCondition(ability.condition, source.ref);
      const condition = authoredCondition === undefined ? undefined : (object: ObjectSnapshot) => {
        const current = this.sourceSnapshot(source.ref);
        if (current === null || !sameRef(object.ref, source.ref)) return false;
        return this.conditionMatches(authoredCondition, current, object);
      };
      const registration: ContinuousEffectSpec = {
        id: `program-keyword:${JSON.stringify([source.ref.id, source.ref.zoneEntryId, ability.kind, effect.kind, index, expansion.entries[index]?.id ?? null])}`,
        source: source.ref,
        layer: effect.kind === 'continuous.might' ? 'arithmetic' : 'ability',
        filter: { objectId: source.ref.id, zoneEntryId: source.ref.zoneEntryId, zone: source.zone },
        effect: {
          ...normalized, ...movement, kind: String(effect.kind),
          condition: condition ?? ((object: LayeredObjectSnapshot) => sameRef(object.ref, source.ref)),
          // Movement rules consume the Static key as a separate admission
          // marker; they do not infer it from a layer's object characteristics.
          ...(effect.kind === 'continuous.movement' ? { staticCondition } : {}),
          ...(authoredCondition === undefined ? {} : { abilityCondition: authoredCondition }),
        },
      };
      if (effect.kind !== 'target.tax') return [registration];
      // target.tax is queried through the capability inventory used by Chain
      // Finalize rather than through object characteristics. Publish the same
      // expanded effect in that inventory so a granted Deflect is priced.
      const capability: ContinuousEffectSpec = {
        id: `program-keyword-capability:${JSON.stringify([source.ref.id, source.ref.zoneEntryId, ability.kind, effect.kind, index, expansion.entries[index]?.id ?? null])}`,
        source: source.ref,
        layer: 'ability',
        filter: {},
        effect: {
          kind: 'static.capability',
          capabilityKind: 'target-tax',
          ability: {
            kind: 'static',
            effect: {
              ...normalized,
              ...(typeof normalized.value === 'number'
                ? { value: { kind: 'constant', value: normalized.value } }
                : {}),
              kind: 'target.tax',
            },
            ...(ability.condition === undefined ? {} : { condition: ability.condition }),
          },
          ordinal: index,
        } as never,
      };
      return [capability];
    });
  }

  /** Publish keyword-derived static rules into an existing production registry. */
  publishStaticEffects(effects: readonly ContinuousEffectSpec[]): void {
    for (const effect of effects) {
      if (this.registry.get(effect.id) !== undefined) throw new ProgramBindingError('invalid-program', `Duplicate generated keyword effect ${effect.id}`);
      this.registry.register(effect, { type: 'permanent' });
      this.generated.add(effect.id);
    }
  }

  private registryFor(entries: readonly RegisteredContinuousEffect[]): ContinuousEffectRegistry {
    const registry = new ContinuousEffectRegistry();
    for (const entry of entries) registry.register(entry.effect, entry.duration, entry.timestamp);
    return registry;
  }

  private applyExpansions(prefix: readonly LayeredObjectSnapshot[], remaining: readonly RegisteredContinuousEffect[],
    expansions: ReadonlyMap<string, EffectiveKeywordExpansion>,
    generatedExpansions: ReadonlyMap<string, EffectiveKeywordExpansion> = expansions): ContinuousEffectSpec[] {
    const objects = prefix.map(object => ({ ...object, keywords: expansions.get(refKey(object.ref))!.keywords }));
    this.view = new Map(objects.map(object => [refKey(object.ref), object]));
    const generated = objects.flatMap(object => this.staticEffects(object, generatedExpansions.get(refKey(object.ref))!));
    const registry = this.registryFor(remaining);
    for (const effect of generated) if (registry.get(effect.id) === undefined) registry.register(effect, { type: 'permanent' });
    this.view = new Map(new LayerEngine(objects, registry).evaluateAll().map(object => [refKey(object.ref), object]));
    return generated;
  }

  private grantedExpansion(object: LayeredObjectSnapshot, changes: readonly KeywordChange[]): EffectiveKeywordExpansion {
    if (changes.some(change => change.kind === 'remove')) {
      blocked('Dynamic keyword removal needs an explicit printed-effect revocation binder');
    }
    const grants = changes.flatMap(change => change.keywords);
    if (grants.length === 0) return { keywords: [], abilities: [], entries: [] };
    const singles = new Set(grants.map(keyword => { const def = definition(keyword.id); return def.stacking === 'single' ? def.keyword.toLowerCase() : null; })
      .filter((id): id is string => id !== null));
    const unique = grants.filter((keyword, index, all) => !singles.has(definition(keyword.id).keyword.toLowerCase()) ||
      all.findIndex(candidate => candidate.id.toLowerCase() === keyword.id.toLowerCase()) === index);
    const expansion = expandEffectiveKeywords({ ...object, keywords: [] }, [{ kind: 'grant', keywords: unique }]);
    return {
      keywords: expansion.keywords,
      abilities: expansion.abilities,
      entries: expansion.entries,
    };
  }

  private reconcileGrantedAbilities(next: ReadonlyMap<string, readonly GrantedKeywordAbilityEntry[]>): void {
    if (this.options.onKeywordAbilities === undefined) return;
    const keys = new Set([...this.grantedAbilities.keys(), ...next.keys()]);
    for (const key of keys) {
      const entries = next.get(key) ?? [];
      const object = this.view.get(key);
      if (object === undefined && entries.length === 0) continue;
      const previous = this.grantedAbilities.get(key);
      if (object !== undefined) {
        const unchanged = previous !== undefined && previous.length === entries.length &&
          previous.every((entry, index) => entry.id === entries[index]?.id);
        if (!unchanged) this.options.onKeywordAbilities(object.ref, entries);
        if (entries.length !== 0) this.priorGrantedRefs.set(key, object.ref);
      } else {
        const priorRef = this.priorGrantedRefs.get(key);
        if (priorRef !== undefined) this.options.onKeywordAbilities(priorRef, []);
        this.priorGrantedRefs.delete(key);
      }
      if (entries.length === 0) this.priorGrantedRefs.delete(key);
    }
    this.grantedAbilities = new Map(next);
  }

  private preGrantView(prefix: readonly LayeredObjectSnapshot[], remaining: readonly RegisteredContinuousEffect[],
    applied: AppliedKeywordChanges, excluded: string): PreGrantView {
    const savedView = this.view;
    try {
      const instances = new Map(prefix.map(object => [refKey(object.ref), keywordInstances(object,
        [...(applied.get(refKey(object.ref)) ?? [])].filter(([id]) => id !== excluded).map(([, change]) => change))]));
      const expansions = new Map(prefix.map(object => [refKey(object.ref), expandEffectiveKeywords({
        ...object, keywords: instances.get(refKey(object.ref))!,
      })]));
      // Re-run arithmetic from the base, rather than subtracting the grant's
      // Might from the final snapshot (which fails for multiply/set effects).
      this.applyExpansions(prefix, remaining, expansions);
      return { view: this.view, instances };
    } finally {
      this.view = savedView;
    }
  }

  private refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    this.clearGenerated();
    try {
      const raw = this.objectsView();
      const entries = this.registry.active(undefined, ref => raw.find(object => sameRef(object.ref, ref)) ?? null)
        .filter(entry => !entry.effect.id.startsWith('program-keyword:'));
      const prefix = new LayerEngine(raw, this.registryFor(entries.filter(entry => ['copy', 'trait'].includes(entry.effect.layer)))).evaluateAll();
      const remaining = entries.filter(entry => !['copy', 'trait'].includes(entry.effect.layer) && !this.keywordEffect(entry));
      // Begin from current printed/copy characteristics on every query. A
      // previously granted Shield must not sustain its own Might threshold.
      const seed = new LayerEngine(prefix, this.registryFor(remaining)).evaluateAll();
      this.view = new Map(seed.map(object => [refKey(object.ref), object]));
      let previous = '';
      let applied: AppliedKeywordChanges = new Map();
      let generated: ContinuousEffectSpec[] = [];
      let granted = new Map<string, EffectiveKeywordExpansion>();
      let grantedAbilities = new Map<string, readonly GrantedKeywordAbilityEntry[]>();
      const limit = entries.length + prefix.length + 4;
      for (let pass = 0; pass < limit; pass++) {
        const changes = new Map(prefix.map(object => [refKey(object.ref), this.changes(entries,
          this.view.get(refKey(object.ref)) ?? object, id => this.preGrantView(prefix, remaining, applied, id))]));
        const expansions = new Map(prefix.map(object => {
          const keywordChanges = [...changes.get(refKey(object.ref))!.values()];
          if (this.options.grantedOnly !== true) return [refKey(object.ref), expandEffectiveKeywords(object, keywordChanges)];
          try {
            return [refKey(object.ref), expandEffectiveKeywords(object, keywordChanges)];
          } catch (error) {
            // Printed keyword expansion remains the ordinary CardProgram
            // lifecycle's responsibility in granted-only mode. An unsupported
            // printed keyword on one object must not prevent dynamic grants on
            // unrelated objects from reaching their production consumers.
            if (error instanceof ProgramBindingError && error.code === 'judge-required') {
              return [refKey(object.ref), { keywords: object.keywords, abilities: [], entries: [] }];
            }
            throw error;
          }
        }));
        granted = new Map(prefix.map(object => [refKey(object.ref), this.options.grantedOnly === true
          ? this.grantedExpansion(object, [...changes.get(refKey(object.ref))!.values()])
          : expansions.get(refKey(object.ref))!]));
        grantedAbilities = new Map([...granted].map(([key, expansion]) => [key, expansion.entries]));
        const signature = JSON.stringify([...expansions].map(([key, value]) => [key, value.keywords, [...changes.get(key)!]]));
        if (signature === previous) {
          this.expansions = expansions;
          this.options.onKeywordEffects?.(Object.freeze([...generated]));
          if (this.options.deferGeneratedEffects !== true) for (const effect of generated) {
            this.registry.register(effect, { type: 'permanent' });
            this.generated.add(effect.id);
          }
          this.reconcileGrantedAbilities(grantedAbilities);
          return;
        }
        previous = signature;
        applied = changes;
        generated = this.applyExpansions(prefix, remaining, expansions, granted);
      }
      blocked('Keyword layer dependencies did not converge; an explicit dependency adapter is required');
    } catch (error) {
      this.clearGenerated();
      this.view.clear();
      this.expansions.clear();
      this.reconcileGrantedAbilities(new Map());
      throw error;
    } finally {
      this.refreshing = false;
    }
  }

  override evaluate(ref: ObjectRef): LayeredObjectSnapshot | null {
    this.refresh();
    return this.view.get(refKey(ref)) ?? null;
  }
  override evaluateAll(): readonly LayeredObjectSnapshot[] {
    this.refresh();
    return Object.freeze([...this.view.values()]);
  }
  keywordAbilities(ref: ObjectRef): readonly Ability[] {
    this.refresh();
    return this.expansions.get(refKey(ref))?.abilities ?? [];
  }
  /** Full validated lifecycle entries, retaining each keyword instance id. */
  keywordEntries(ref: ObjectRef): readonly GrantedKeywordAbilityEntry[] {
    this.refresh();
    const entries = this.expansions.get(refKey(ref))?.entries ?? [];
    return this.lifecycleKeywords.size === 0 ? entries : entries.filter(entry =>
      this.lifecycleKeywords.has(entry.id.split(':', 1)[0]!));
  }
  /** Effective keyword instances visible to the production movement consumer. */
  keywordInstances(ref: ObjectRef): readonly Keyword[] {
    this.refresh();
    return this.expansions.get(refKey(ref))?.keywords ?? [];
  }
}
