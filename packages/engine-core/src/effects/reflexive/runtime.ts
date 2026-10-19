import type { ChainDraft, ChainEngine } from '../../chain/engine.js';
import type { Instruction, ObjectSnapshot, Value } from '../contract.js';
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

function draftIds(engine: ChainEngine, requests: readonly ReflexivePendingRequest[]): readonly string[] {
  const parent = currentResolveItem(engine);
  if (parent === undefined) throw new ReflexivePendingError('A Reflexive Trigger can only be created during resolution');
  const prefixes = requests.map(request => {
    const discriminator = request.linkKey ?? request.body[0]?.id ?? request.snapshot.event ?? 'always';
    return `reflexive:${parent}:${stableSegment(discriminator)}:`;
  });
  // A resolving instruction can execute more than once (for example through a
  // real repeat). Each execution must create new Pending identities even when
  // the declaration body and its local ordinals are identical. Trace identity
  // survives the item's later removal, so a replayed execution never reuses an
  // identity that has already been observed in this chain.
  const observed = engine.trace
    .filter(entry => entry.step === 'pending' && entry.item !== undefined)
    .map(entry => entry.item!);
  return prefixes.map((prefix, index) => {
    const priorMaximum = observed.reduce((maximum, id) => {
      if (!id.startsWith(prefix)) return maximum;
      const suffix = id.slice(prefix.length);
      return /^[1-9][0-9]*$/.test(suffix) ? Math.max(maximum, Number(suffix)) : maximum;
    }, 0);
    return prefix + String(priorMaximum + requests[index]!.ordinal);
  });
}

function createRuntime(
  engine: ChainEngine,
  records: Map<string, PendingRecord>,
  finalizeRecords: Map<string, PendingRecord>,
): ReflexivePendingRuntime {
  let active = true;
  const runtime: ReflexivePendingRuntime & { detachRuntime(): void } = {
    version: RUNTIME_VERSION,
    create(request: ReflexivePendingRequest): ReflexivePendingCreation {
      return runtime.createAll([request])[0]!;
    },
    createAll(requests: readonly ReflexivePendingRequest[]): readonly ReflexivePendingCreation[] {
      if (!active) throw new ReflexivePendingError('Reflexive Pending runtime is detached');
      const existing = new Set(engine.items.map(item => item.id));
      const ids = draftIds(engine, requests);
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
        const record = {
          ...(request.linkedValues === undefined ? {} : { links: structuredClone(request.linkedValues) }),
          snapshot: structuredClone(request.snapshot),
        };
        records.set(drafts[index]!.id, record);
        finalizeRecords.set(drafts[index]!.id, record);
      }
      return creations;
    },
    detachRuntime(): void { active = false; },
  };
  return runtime;
}

/**
 * Attach the additive Reflexive Pending port to the existing production
 * ChainEngine without changing shared contracts.  Parent integration can
 * replace this host-context wrapper with the direct ResolveContext seam.
 */
export function installReflexivePendingRuntime(engine: ChainEngine): ReflexivePendingRuntimeHandle {
  const existing = installations.get(engine);
  if (existing !== undefined) return existing;

  const records = new Map<string, PendingRecord>();
  const finalizeRecords = new Map<string, PendingRecord>();
  const runtime = createRuntime(engine, records, finalizeRecords);
  const options = (engine as unknown as { options: { host: { context: ChainEngine['pipeline']['host']['context'] } } }).options;
  const host = options.host;
  const entries = (engine as unknown as { entries: Array<{ readonly id: string; readonly body: readonly Instruction[] }> }).entries;
  const encodeFinalizingEntry = (): string | undefined => {
    const itemId = currentFinalizeItem(engine);
    if (itemId === undefined) return undefined;
    const item = entries.find(entry => entry.id === itemId);
    if (item === undefined) return undefined;
    const body = encodeReflexiveRegistrationBody(item.body);
    if (body.some((entry, index) => entry !== item.body[index])) {
      (item as { body: readonly Instruction[] }).body = body;
    }
    return itemId;
  };
  const original = host.context.bind(host);
  const wrapped = ((source: ObjectSnapshot, controller: string, at: Parameters<typeof original>[2]) => {
    runtimes.set(source, runtime);
    const finalizeItem = at === 'chain-item-finalize' ? encodeFinalizingEntry() : undefined;
    const context = original(source, controller, at);
    const itemId = at === 'chain-item-resolve' ? currentResolveItem(engine) : finalizeItem;
    const links = itemId === undefined
      ? undefined
      : (at === 'chain-item-resolve' ? records : finalizeRecords).get(itemId)?.links;
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
      for (const id of records.keys()) if (!live.has(id)) {
        records.delete(id);
        finalizeRecords.delete(id);
      }
      return [...live].flatMap(id => {
        const snapshot = records.get(id)?.snapshot;
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

