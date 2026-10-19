import type { ChainDraft, ChainEngine } from '../../chain/engine.js';
import type { Instruction, ObjectRef, ObjectSnapshot, Value } from '../contract.js';
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

/**
 * Parent Finalize must not see the Reflexive declaration as its own nested
 * target.  The resolver still receives the original instruction expression,
 * so only the declaration body's shape is rebased in the runtime copy.
 */
function withoutReflexiveDeclarations(body: readonly Instruction[]): readonly Instruction[] {
  return body.filter(instruction => instruction.op !== 'trigger.reflexive');
}

function draftId(engine: ChainEngine, request: ReflexivePendingRequest): string {
  const parent = currentResolveItem(engine);
  if (parent === undefined) throw new ReflexivePendingError('A Reflexive Trigger can only be created during resolution');
  const discriminator = request.linkKey ?? request.body[0]?.id ?? request.snapshot.event ?? 'always';
  return `reflexive:${parent}:${stableSegment(discriminator)}:${request.ordinal}`;
}

function createRuntime(engine: ChainEngine, snapshots: ReflexiveConditionSnapshot[]): ReflexivePendingRuntime {
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
      snapshots.push(structuredClone(request.snapshot));
        creations.push({ id });
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

  const snapshots: ReflexiveConditionSnapshot[] = [];
  const runtime = createRuntime(engine, snapshots);
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
    return original(source, controller, at);
  }) as typeof host.context;
  host.context = wrapped;

  const handle: ReflexivePendingRuntimeHandle = {
    get snapshots(): readonly ReflexiveConditionSnapshot[] {
      return snapshots.map(snapshot => structuredClone(snapshot));
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
