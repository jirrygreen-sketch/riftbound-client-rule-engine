import type { ChainDraft, ChainEngine } from '../../chain/engine.js';
import type { Instruction, ObjectRef, ObjectSnapshot, ResolveContext, Value } from '../contract.js';
import type {
  ReflexiveConditionSnapshot,
  ReflexivePendingCreation,
  ReflexivePendingRequest,
  ReflexivePendingRuntime,
  ReflexivePendingRuntimeHandle,
} from './contract.js';
import { encodeReflexiveRegistrationBody } from './body.js';

const RUNTIME_VERSION = 'riftbound.reflexive-pending.v1' as const;
const runtimes = new WeakMap<object, ReflexivePendingRuntime>();
const installations = new WeakMap<ChainEngine, ReflexivePendingRuntimeHandle>();
interface PendingRecord {
  readonly links?: Readonly<Record<string, Value>>;
  readonly snapshot: ReflexiveConditionSnapshot;
}
const pendingRecords = new Map<string, PendingRecord>();

export class ReflexivePendingError extends Error {
  readonly status = 'blocked';
  constructor(message: string) {
    super(message);
    this.name = 'ReflexivePendingError';
  }
}

function currentFinalizeItem(engine: ChainEngine): string | undefined {
  const trace = engine.trace;
  for (let index = trace.length - 1; index >= 0; index--) {
    const entry = trace[index]!;
    if (entry.step === 'finalize-start') return entry.item;
    if (entry.step === 'finalized' || entry.step === 'removed') return undefined;
  }
  return undefined;
}

function currentResolveItem(engine: ChainEngine): string | undefined {
  const trace = engine.trace;
  for (let index = trace.length - 1; index >= 0; index--) {
    const entry = trace[index]!;
    if (entry.step === 'resolve-start') return entry.item;
    if (entry.step === 'resolved' || entry.step === 'removed') return undefined;
  }
  return undefined;
}

/** Resolve the runtime installed for the exact source snapshot passed by the engine. */
export function reflexivePendingRuntimeFor(source: ObjectSnapshot): ReflexivePendingRuntime | undefined {
  return runtimes.get(source);
}

function stableSegment(value: string): string {
  return encodeURIComponent(value);
}

function draftId(engine: ChainEngine, request: ReflexivePendingRequest): string {
  const parent = currentResolveItem(engine);
  if (parent === undefined) throw new ReflexivePendingError('A Reflexive Trigger can only be created during resolution');
  const discriminator = request.linkKey ?? request.body[0]?.id ?? request.snapshot.event ?? 'always';
  return `reflexive:${parent}:${stableSegment(discriminator)}:${request.ordinal}`;
}

function createRuntime(engine: ChainEngine): ReflexivePendingRuntime {
  let active = true;
  const runtime: ReflexivePendingRuntime & { detachRuntime(): void } = {
    version: RUNTIME_VERSION,
    create(request: ReflexivePendingRequest): ReflexivePendingCreation {
      return runtime.createAll([request])[0]!;
    },
    createAll(requests: readonly ReflexivePendingRequest[]): readonly ReflexivePendingCreation[] {
      if (!active) throw new ReflexivePendingError('Reflexive Pending runtime is detached');
      const existing = new Set(engine.items.map(item => item.id));
      const ids = requests.map(request => draftId(engine, request));
      const seen = new Set<string>();
      for (const id of ids) {
        if (existing.has(id) || seen.has(id)) {
          throw new ReflexivePendingError(`Reflexive Pending identity already exists: ${id}`);
        }
        seen.add(id);
      }
      const creations: ReflexivePendingCreation[] = [];
      const drafts: ChainDraft[] = [];
      for (const [index, request] of requests.entries()) {
        const id = ids[index]!;
        const draft: ChainDraft = {
          id,
          controller: request.controller,
          source: structuredClone(request.source),
          kind: 'triggered',
          speed: 'normal',
          body: structuredClone(request.body),
          ...(request.mayAtFinalize ? { mayAtFinalize: true } : {}),
        };
        engine.enqueue(draft);
        drafts.push(draft);
        creations.push({ id });
      }
      for (const [index, request] of requests.entries()) {
        pendingRecords.set(drafts[index]!.id, {
          ...(request.linkedValues === undefined ? {} : { links: structuredClone(request.linkedValues) }),
          snapshot: structuredClone(request.snapshot),
        });
      }
      return creations;
    },
    detachRuntime(): void { active = false; },
  };
  return runtime;
}

function currentResolveEntry(engine: ChainEngine): { readonly id: string; readonly body: readonly Instruction[]; readonly targetPlans?: readonly import('../../target/target-plan.js').TargetPlan[] } | undefined {
  const id = currentResolveItem(engine);
  if (id === undefined) return undefined;
  return (engine as unknown as {
    entries: Array<{ readonly id: string; readonly body: readonly Instruction[]; readonly targetPlans?: readonly import('../../target/target-plan.js').TargetPlan[] }>;
  }).entries.find(entry => entry.id === id);
}

function bindResolveSelections(context: ResolveContext, engine: ChainEngine): ResolveContext {
  const item = currentResolveEntry(engine);
  if (item === undefined || item.targetPlans === undefined) return context;
  const selections = new Map(item.targetPlans.map(plan => [plan.requirement.id, plan.selected]));
  const bound: ResolveContext = {
    source: context.source,
    controller: context.controller,
    timingPoint: context.timingPoint,
    object: ref => context.object(ref),
    lastKnown: ref => context.lastKnown(ref),
    query: filter => context.query(filter),
    zoneSlice: (player, zone, from, count) => context.zoneSlice(player, zone, from, count),
    targets: id => {
      const selected = selections.get(id);
      return selected === undefined
        ? context.targets(id)
        : selected.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
    },
    picks: id => context.picks(id),
    player: id => context.player(id),
    evaluate: expr => context.evaluate(expr),
    test: condition => context.test(condition),
    linked: key => context.linked(key),
    history: query => context.history(query),
    choose: request => context.choose(request),
    perform: (action => (context.perform as (value: unknown) => ReturnType<ResolveContext['perform']>)(action)) as ResolveContext['perform'],
    link: (key, value) => context.link(key, value),
    addContinuous: (effect, duration) => context.addContinuous(effect, duration),
    registerDelayedTrigger: (spec, body) => context.registerDelayedTrigger(spec, body),
    ...(context.contractActions === undefined ? {} : { contractActions: context.contractActions }),
    ...(context.transaction === undefined ? {} : { transaction: context.transaction }),
    ...(context.eventObject === undefined ? {} : { eventObject: role => context.eventObject!(role) }),
  };
  Object.defineProperty(bound, 'source', { configurable: false, enumerable: true, writable: false, value: context.source });
  return bound;
}

/**
 * Attach the additive Reflexive Pending port to the existing production
 * ChainEngine without changing shared contracts.  Parent integration can
 * replace this host-context wrapper with the direct ResolveContext seam.
 */
export function installReflexivePendingRuntime(engine: ChainEngine): ReflexivePendingRuntimeHandle {
  const existing = installations.get(engine);
  if (existing !== undefined) return existing;

  const runtime = createRuntime(engine);
  const options = (engine as unknown as { options: { host: { context: ChainEngine['pipeline']['host']['context'] } } }).options;
  const host = options.host;
  const entries = (engine as unknown as { entries: Array<{ readonly id: string; readonly body: readonly Instruction[] }> }).entries;
  const encodeFinalizingEntry = (): void => {
    const itemId = currentFinalizeItem(engine);
    if (itemId === undefined) return;
    const item = entries.find(entry => entry.id === itemId);
    if (item === undefined) return;
    const body = encodeReflexiveRegistrationBody(item.body);
    if (body.some((entry, index) => entry !== item.body[index])) {
      (item as { body: readonly Instruction[] }).body = body;
    }
  };
  const original = host.context.bind(host);
  const wrapped = ((source: ObjectSnapshot, controller: string, at: Parameters<typeof original>[2]) => {
    runtimes.set(source, runtime);
    if (at === 'chain-item-finalize') encodeFinalizingEntry();
    const baseContext = original(source, controller, at);
    const context = at === 'chain-item-resolve'
      ? new Proxy(baseContext, {
          get(target, key) {
            if (key === 'source') return source;
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        })
      : baseContext;
    if (at === 'chain-item-resolve') {
      Object.defineProperty(context, 'source', {
        configurable: true,
        enumerable: true,
        value: source,
      });
    }
    if (at === 'chain-item-resolve') return bindResolveSelections(context, engine);
    const itemId = currentResolveItem(engine);
    const links = itemId === undefined ? undefined : pendingRecords.get(itemId)?.links;
    if (links === undefined) return context;
    return new Proxy(context, {
      get(target, key) {
        if (key === 'linked') return (name: string) => target.linked(name) ?? links[name];
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof host.context;
  host.context = wrapped;

  const handle: ReflexivePendingRuntimeHandle = {
    get snapshots(): readonly ReflexiveConditionSnapshot[] {
      const live = new Set(engine.items.map(item => item.id));
      for (const id of pendingRecords.keys()) if (!live.has(id)) pendingRecords.delete(id);
      return [...live].flatMap(id => {
        const snapshot = pendingRecords.get(id)?.snapshot;
        return snapshot === undefined ? [] : [structuredClone(snapshot)];
      });
    },
    detach() {
      if (host.context === wrapped) host.context = original;
      installations.delete(engine);
      (runtime as ReflexivePendingRuntime & { detachRuntime?: () => void }).detachRuntime?.();
    },
  };
  installations.set(engine, handle);
  return handle;
}

export function reflexiveLinkValue(value: Value | undefined): Value {
  return value === undefined ? null : structuredClone(value);
}

