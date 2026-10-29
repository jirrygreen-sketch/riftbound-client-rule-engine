import type { Ability, CardProgram } from '@riftbound/card-dsl';
import type { ChainEngine, ChainDraft } from '../chain/engine.js';
import type { GameAction, ObjectSnapshot, PlayerId, ResolveContext } from '../effects/contract.js';
import type { DuelPrintedCostCatalogCard } from '../cost/printed-costs.js';
import { bindPrintedCatalogCapability, catalogProjectionFor, type EffectPlayPrintedCatalog, type EffectPlayPrintedProjection } from '../effects/play/catalog.js';
import { ProgramRegistry, type ProgramSource } from './registry.js';
import { describePlay as describePlayDraft } from './play.js';
import { activationAbilities as listActivationAbilities, describeActivate as describeActivateDraft } from './activate.js';
import {
  activatedAddAbilities as listActivatedAddAbilities,
  describeAddActivation,
  type AddActivation,
  type ActivatedAddAbility,
} from './add.js';
import { ProgramBindingError } from './errors.js';
import { registerProgramTriggers as registerTriggers, unregisterProgramTriggers as unregisterTriggers } from './triggers.js';
import { attachProgramLifecycle, type ProgramLifecycleHandle } from './lifecycle.js';
import { currentReflexivePendingRuntime, installReflexivePendingRuntime } from '../effects/reflexive/runtime.js';
import type { ReflexivePendingRuntimeHandle } from '../effects/reflexive/contract.js';

/**
 * Lifecycle handles on one Chain share a single Reflexive Pending runtime
 * (RIFT-1140). The last lifecycle handle that leased it removes it; a runtime
 * the caller installed is never leased, so no lifecycle handle removes it.
 */
const reflexiveLeases = new WeakMap<ChainEngine, { readonly runtime: ReflexivePendingRuntimeHandle; count: number }>();

function leaseReflexiveRuntime(engine: ChainEngine): () => void {
  let lease = reflexiveLeases.get(engine);
  if (lease !== undefined && currentReflexivePendingRuntime(engine) !== lease.runtime) {
    // The leased runtime was detached elsewhere; earlier handles release a stale lease.
    reflexiveLeases.delete(engine);
    lease = undefined;
  }
  if (lease === undefined) {
    if (currentReflexivePendingRuntime(engine) !== undefined) return () => undefined;
    lease = { runtime: installReflexivePendingRuntime(engine), count: 0 };
    reflexiveLeases.set(engine, lease);
  }
  const held = lease;
  held.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.count -= 1;
    if (held.count > 0) return;
    if (reflexiveLeases.get(engine) === held) reflexiveLeases.delete(engine);
    held.runtime.detach();
  };
}
import { bindReplacementAbility, bindStaticAbility, type ProgramStaticBinder, noopStaticBinder, type StaticBindingHandle } from './statics.js';
import { expandProgram } from './keywords.js';

export interface ProgramBinding {
  readonly registry: ProgramRegistry;
  readonly describePlay: (action: Extract<GameAction, { type: 'play' }>, source: ObjectSnapshot) => ChainDraft;
  readonly describeActivate: (source: ObjectSnapshot, controller: PlayerId, abilityIndex?: number) => ChainDraft;
  readonly activationAbilities: (source: ObjectSnapshot) => readonly Extract<Ability, { kind: 'activated' }>[];
  readonly activatedAddAbilities: (source: ObjectSnapshot) => readonly ActivatedAddAbility[];
  readonly describeAddActivation: (source: ObjectSnapshot, controller: PlayerId, abilityIndex?: number) => AddActivation;
  readonly registerProgramTriggers: (engine: ChainEngine, source: ObjectSnapshot) => readonly string[];
  readonly unregisterProgramTriggers: (engine: ChainEngine, ids: readonly string[]) => void;
  readonly bindStatic: (ability: Extract<Ability, { kind: 'static' }>, source: ObjectSnapshot) => StaticBindingHandle;
  readonly bindReplacement: (ability: Extract<Ability, { kind: 'replacement' }>, source: ObjectSnapshot) => StaticBindingHandle;
  readonly attachLifecycle: (engine: ChainEngine, onError?: (error: unknown, source: ObjectSnapshot) => void) => ProgramLifecycleHandle;
  readonly inspect: (source: ObjectSnapshot) => { readonly program?: CardProgram; readonly abilities: readonly Ability[] };
  /** Trusted server catalog lookup keyed by canonical id for effect Play. */
  readonly printedCatalog: (canonicalCardId: string) => EffectPlayPrintedProjection | undefined;
}

export interface ProgramPrintedCatalogCard extends DuelPrintedCostCatalogCard {
  readonly canonicalCardId: string;
}

type ProgramPrintedCatalogSource = readonly ProgramPrintedCatalogCard[] | ReadonlyMap<string, ProgramPrintedCatalogCard>;

function indexPrintedCatalog(source: ProgramPrintedCatalogSource | undefined): ReadonlyMap<string, EffectPlayPrintedProjection> {
  const listed = source instanceof Map
    ? [...source.entries()]
    : ((source ?? []) as readonly unknown[]).map(card => {
      const item = card !== null && typeof card === 'object' && !Array.isArray(card)
        ? card as Record<string, unknown>
        : null;
      return [typeof item?.canonicalCardId === 'string' ? item.canonicalCardId : '<invalid>', item] as const;
    });
  const rows = listed as readonly (readonly [string, ProgramPrintedCatalogCard])[];
  const result = new Map<string, EffectPlayPrintedProjection>();
  for (const [key, raw] of rows) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ProgramBindingError('invalid-program', `Printed catalog row ${key} must be an object`);
    }
    if (raw.canonicalCardId !== key) throw new ProgramBindingError('invalid-program', `Printed catalog key ${key} does not match canonicalCardId ${raw.canonicalCardId}`);
    const projection = catalogProjectionFor(raw);
    if (projection === undefined) throw new ProgramBindingError('invalid-program', `Invalid printed catalog row ${key}`);
    if (result.has(key)) throw new ProgramBindingError('invalid-program', `Duplicate printed catalog row ${key}`);
    result.set(key, Object.freeze({ ...projection, domains: Object.freeze([...projection.domains]) }));
  }
  return result;
}

function installPrintedCatalog(engine: ChainEngine, lookup: EffectPlayPrintedCatalog): () => void {
  type Describable = ProgramBinding['describePlay'] & { readonly printedCatalog?: EffectPlayPrintedCatalog };
  const options = (engine as unknown as { options: { describePlay?: Describable } }).options;
  const describePlay = options.describePlay;
  if (describePlay !== undefined) {
    Object.defineProperty(describePlay, 'printedCatalog', { configurable: true, value: lookup, writable: true });
  }
  type ContextFn = (
    item: ChainDraft,
    at?: 'chain-item-finalize' | 'chain-item-resolve',
    targetPlans?: readonly unknown[],
    choicePlan?: unknown,
    repeatExecution?: number,
  ) => ResolveContext;
  const target = engine as unknown as { context: ContextFn };
  const original = target.context;
  const previous = original.bind(engine);
  const wrapped: ContextFn = (item, at, targetPlans, choicePlan, repeatExecution) => {
    const context = previous(item, at, targetPlans, choicePlan, repeatExecution);
    const capability = context.contractActions;
    if (capability === undefined) return context;
    bindPrintedCatalogCapability(capability, lookup);
    return new Proxy(context, {
      get: (target, key) => {
        if (key === 'contractActions') return capability;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as ResolveContext;
  };
  target.context = wrapped;
  return () => {
    if (describePlay !== undefined && describePlay.printedCatalog === lookup) {
      delete (describePlay as { printedCatalog?: EffectPlayPrintedCatalog }).printedCatalog;
    }
    if (target.context === wrapped) target.context = original;
  };
}

function isDirectAddAbility(record: ActivatedAddAbility): boolean {
  const body = record.ability.body;
  const instruction = body[0];
  return body.length === 1 && instruction?.op === 'effect.resources';
}

function hasVerifiedDefaultAddShape(record: ActivatedAddAbility): boolean {
  const body = record.ability.body;
  const instruction = body[0];
  const args = instruction?.args as Readonly<Record<string, { readonly kind?: string; readonly value?: unknown }>> | undefined;
  if (instruction === undefined || !isDirectAddAbility(record) || instruction.condition !== undefined ||
      instruction.targets !== undefined || instruction.picks !== undefined || instruction.locations !== undefined ||
      args === undefined || !(args.energy !== undefined || args.power !== undefined) || args.player !== undefined ||
      !Object.keys(args).every(key => ['energy', 'power', 'linkKey'].includes(key)) ||
      (args.energy === undefined && args.power === undefined)) return false;
  if (args.energy !== undefined &&
      (args.energy.kind !== 'constant' || typeof args.energy.value !== 'number' || !Number.isSafeInteger(args.energy.value) || args.energy.value < 0)) return false;
  if (args.power !== undefined &&
      (args.power.kind !== 'constant' || !Array.isArray(args.power.value) ||
       !args.power.value.every(source => ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'universal'].includes(String(source))) ||
       args.power.value.includes('universal') && args.power.value.length !== 1)) return false;
  if (args.linkKey !== undefined && (args.linkKey.kind !== 'constant' || typeof args.linkKey.value !== 'string' || args.linkKey.value.length === 0)) return false;
  return instruction !== undefined &&
    record.resourceInstructionIds.length === 1 && record.resourceInstructionIds[0] === instruction.id &&
    record.ability.restriction === undefined;
}

function directAddAbilities(registry: ProgramRegistry, source: ObjectSnapshot): readonly ActivatedAddAbility[] {
  return Object.freeze(listActivatedAddAbilities(registry, source).filter(isDirectAddAbility));
}

export function createProgramBinding(options: {
  cardPrograms: ProgramSource;
  printedCatalog?: ProgramPrintedCatalogSource;
  staticBinder?: ProgramStaticBinder;
}): ProgramBinding {
  const registry = new ProgramRegistry(options.cardPrograms);
  const printedCosts = indexPrintedCatalog(options.printedCatalog);
  const binder = options.staticBinder;
  const lookup = (canonicalCardId: string) => printedCosts.get(canonicalCardId);
  return {
    registry,
    describePlay: (action, source) => describePlayDraft(registry, action, source),
    describeActivate: (source, controller, abilityIndex = 0) => {
      const add = listActivatedAddAbilities(registry, source).find(ability => ability.abilityIndex === abilityIndex);
      if (add === undefined) return describeActivateDraft(registry, source, controller, abilityIndex);
      if (!hasVerifiedDefaultAddShape(add)) {
        throw new ProgramBindingError(
          'judge-required',
          `Activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id} has an unverified Add shape`,
        );
      }
      return describeAddActivation(registry, source, controller, abilityIndex).draft;
    },
    activationAbilities: source => listActivationAbilities(registry, source),
    activatedAddAbilities: source => directAddAbilities(registry, source),
    describeAddActivation: (source, controller, abilityIndex = 0) => {
      const add = listActivatedAddAbilities(registry, source).find(ability => ability.abilityIndex === abilityIndex);
      if (add === undefined || !isDirectAddAbility(add) || !hasVerifiedDefaultAddShape(add)) {
        throw new ProgramBindingError(
          'judge-required',
          `Activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id} has an unverified Add shape`,
        );
      }
      return describeAddActivation(registry, source, controller, abilityIndex);
    },
    registerProgramTriggers: (engine, source) => registerTriggers(registry, engine, source),
    unregisterProgramTriggers: unregisterTriggers,
    bindStatic: (ability, source) => bindStaticAbility(binder ?? noopStaticBinder, ability, source),
    bindReplacement: (ability, source) => bindReplacementAbility(binder ?? noopStaticBinder, ability, source),
    attachLifecycle: (engine, onError) => {
      const detachCatalog = installPrintedCatalog(engine, lookup);
      const lifecycle = attachProgramLifecycle(engine, registry, binder, onError);
      // Reflexive Pending (RIFT-1140) is part of the default production assembly.
      const releaseReflexive = leaseReflexiveRuntime(engine);
      let detached = false;
      return {
        detach() {
          if (detached) return;
          detached = true;
          releaseReflexive();
          lifecycle.detach();
          detachCatalog();
        },
      };
    },
    printedCatalog: lookup,
    inspect: source => {
      const program = registry.inspect(source.cardId);
      if (!program) return { abilities: [] };
      return { program, abilities: expandProgram(program, source).abilities };
    }
  };
}

export * from './errors.js';
export * from './registry.js';
export * from './filters.js';
export * from './keywords.js';
export * from './play.js';
export * from './activate.js';
export * from './add.js';
export * from './triggers.js';
export * from './statics.js';
export * from './lifecycle.js';

/** Public contract aliases used by coordinator-owned program registration. */
export type { KeywordDef, KeywordExpansionInput, KeywordParameterMap, KeywordStacking } from '../effects/keyword-contract.js';
