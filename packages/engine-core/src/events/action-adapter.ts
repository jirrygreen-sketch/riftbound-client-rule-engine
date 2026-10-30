import {
  requireContractActionCapability,
  type ActionOutcome,
  type ChoiceRequest,
  type GameAction,
  type ObjectSnapshot,
  type PlayerId,
  type ResolveContext,
} from '../effects/contract.js';
import {
  PIPELINE_DEATH_BOUNDARY_VERSION,
  type ActionExecution,
  type PipelineDeathBoundaryCapability,
  type PipelineHost,
  type TimingEmission,
} from './pipeline-types.js';
import { type TimingPointId } from './timing-points.js';
import { deriveMightChangedEmissions } from './producers/might-change.js';
import { deriveZoneChangeEmissions } from './producers/zone-change.js';
import { effectActorGeneration, inReadOnlyContext, performingEffectActor } from './effect-actor.js';
import {
  actionObjectRef,
  actionPayload,
  locationId,
  locationKind,
  objectRef,
  withActionPayload,
  type ActionPayloadContext,
} from './producers/payload.js';
import {
  CONTRACT_ACTION_CAPABILITY_VERSION,
  ContractActionRollbackError,
  contractActionCompleted,
  executeContractAction,
  type ContractActionBridgePort,
  type ContractActionCapability,
  type ContractActionExecution,
} from './contract-actions/bridge.js';
export {
  CONTRACT_ACTION_CAPABILITY_VERSION,
  ContractActionRollbackError,
  contractActionReachedDestination,
  createContractActionCapability,
  executeContractAction,
  isKnownContractAction,
  killBatch,
} from './contract-actions/bridge.js';
export { requireContractActionCapability } from '../effects/contract.js';
export type {
  ContractActionBridgePort,
  ContractActionCapability,
  ContractActionExecution,
  ContractActionStep,
  ExecuteContractActionOptions,
} from './contract-actions/bridge.js';

/** State storage remains the caller's responsibility; this adapter owns event derivation. */
export interface ActionStatePort extends Omit<PipelineHost, 'execute'> {
  perform(action: GameAction): ActionOutcome;
  /** Confirmed Kill seam: callback runs after replacements, before Trash. */
  performWithDeathBoundary?(action: GameAction, boundary: (before: readonly ObjectSnapshot[]) => void): ActionOutcome;
  /** One confirmed all-Kill wave: one callback before any leaf reaches Trash. */
  performKillBatchWithDeathBoundary?(
    actions: readonly Extract<GameAction, { type: 'kill' }>[],
    batchId: string,
    boundary: (before: readonly ObjectSnapshot[]) => void,
  ): ContractActionExecution;
  /** Optional direct seam for actions outside the closed GameAction union. */
  performContract?(action: import('../effects/contract.js').ContractGameAction): ActionOutcome;
  performBatchLeaf?(action: GameAction, batchId: string): ActionOutcome;
  /** Optional command identity supplied by a journal or a batch coordinator. */
  actionId?: (action: GameAction) => string | undefined;
  /** Optional identity shared by all primitive actions in one submitted batch. */
  batchId?: (action: GameAction, actionId: string) => string | undefined;
  /** Optional authoritative effect controller for actions without a player field. */
  effectController?: (action: GameAction) => PlayerId | undefined;
  /** Optional rule-level cause (for example `move` versus `recall`). */
  cause?: (action: GameAction) => string | undefined;
}

/** Static seam until the 810-owned optional PipelineHost field is merged. */
export type ContractActionPipelineHost = PipelineHost & {
  executeContract(action: import('../effects/contract.js').ContractGameAction): ActionExecution;
};

const GAME_ACTION_TYPES = new Set<GameAction['type']>([
  'draw', 'discard', 'move-zone', 'recycle', 'banish', 'mill', 'shuffle',
  'order-top', 'return-to-hand', 'move-location', 'ready', 'exhaust', 'stun',
  'kill', 'attach', 'detach', 'take-control', 'damage', 'heal',
  'channel-rune', 'gain-energy', 'gain-power', 'pay', 'gain-xp', 'spend-xp',
  'buff', 'spend-buff', 'empower', 'disempower', 'add-counter',
  'remove-counter', 'create-token', 'copy', 'play', 'reveal', 'look',
  'show-off', 'counter', 'score', 'win',
]);

function isContractAction(action: GameAction): action is GameAction & import('../effects/contract.js').ContractGameAction {
  const type = String(action.type);
  return type === 'batch' || type === 'recall' || type === 'hide' || !GAME_ACTION_TYPES.has(action.type);
}

const ACTION_TIMINGS: Partial<Record<GameAction['type'], TimingPointId>> = {
  draw: 'card-drawn', discard: 'card-discarded', recycle: 'card-recycled', banish: 'card-banished', mill: 'card-burned',
  'move-location': 'object-moved', ready: 'object-readied', exhaust: 'object-exhausted', stun: 'unit-stunned', kill: 'object-killed',
  damage: 'damage-dealt', 'gain-xp': 'xp-gained', buff: 'buff-added', 'spend-buff': 'buff-spent', empower: 'empowered-changed', disempower: 'empowered-changed',
  reveal: 'card-revealed', look: 'cards-looked-at', 'show-off': 'objects-shown-off', attach: 'object-attached', score: 'score'
};

interface ActiveEffectContext {
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly timingPoint: TimingPointId;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function actionHint(action: GameAction, key: 'actionId' | 'batchId' | 'cause'): string | undefined {
  const value = (action as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function refKey(ref: { readonly id: string; readonly zoneEntryId: number }): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

function snapshotFor(
  ref: { readonly id: string; readonly zoneEntryId: number },
  before: ReadonlyMap<string, ObjectSnapshot>,
  after: ReadonlyMap<string, ObjectSnapshot>,
): ObjectSnapshot | undefined {
  const current = after.get(ref.id);
  if (current?.ref.zoneEntryId === ref.zoneEntryId) return current;
  const previous = before.get(ref.id);
  if (previous?.ref.zoneEntryId === ref.zoneEntryId) return previous;
  return current ?? previous;
}

function refsFromResult(value: unknown): readonly { readonly id: string; readonly zoneEntryId: number }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(objectRef).map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId }));
}

function sameLocation(left: ObjectSnapshot['location'], right: ObjectSnapshot['location']): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedIncarnation(before: ObjectSnapshot | undefined, after: ObjectSnapshot | undefined): boolean {
  return before !== undefined && after !== undefined && before.ref.zoneEntryId !== after.ref.zoneEntryId;
}

function actionHasStateTransition(
  action: GameAction,
  before: ObjectSnapshot | undefined,
  after: ObjectSnapshot | undefined,
  result: unknown,
): boolean {
  if (action.type === 'move-location') return before !== undefined && after !== undefined && !sameLocation(before.location, after.location);
  if (action.type === 'ready') return before?.zone === 'board' && before.exhausted && after?.exhausted === false;
  if (action.type === 'exhaust') return before?.zone === 'board' && before.exhausted === false && after?.exhausted === true;
  if (action.type === 'stun') return before?.stunned === false && after?.stunned === true;
  if (action.type === 'attach') return JSON.stringify(before?.attachedTo) !== JSON.stringify(after?.attachedTo);
  if (action.type === 'kill' || action.type === 'discard' || action.type === 'recycle' || action.type === 'banish') return changedIncarnation(before, after);
  if (action.type === 'damage') {
    const amount = typeof result === 'number' ? result : action.amount;
    return amount > 0 && before?.damage !== after?.damage;
  }
  if (action.type === 'buff' || action.type === 'spend-buff') return before?.buffs !== after?.buffs;
  if (action.type === 'gain-xp' || action.type === 'spend-xp' || action.type === 'score') {
    const amount = typeof result === 'number' ? result : action.amount;
    return amount > 0;
  }
  return true;
}

function changedObjects(before: readonly ObjectSnapshot[], after: readonly ObjectSnapshot[]): readonly ObjectSnapshot[] {
  const previous = new Map(before.map(object => [object.ref.id, object]));
  return after.filter(object => previous.get(object.ref.id)?.ref.zoneEntryId !== object.ref.zoneEntryId);
}

function actionObjects(
  action: GameAction,
  outcome: ActionOutcome,
  before: ReadonlyMap<string, ObjectSnapshot>,
  after: ReadonlyMap<string, ObjectSnapshot>,
): readonly ObjectSnapshot[] {
  const refs = refsFromResult(outcome.status === 'done' ? outcome.result : undefined);
  const fallback = actionObjectRef(action);
  const requested = refs.length > 0 ? refs : action.type === 'look' ? action.objects : fallback ? [fallback] : [];
  const seen = new Set<string>();
  const objects: ObjectSnapshot[] = [];
  for (const ref of requested) {
    const object = snapshotFor(ref, before, after);
    if (!object || seen.has(refKey(object.ref))) continue;
    seen.add(refKey(object.ref));
    objects.push(structuredClone(object));
  }
  return objects;
}

function transitionPayload(
  action: GameAction,
  before: ObjectSnapshot | undefined,
  after: ObjectSnapshot | undefined,
  context: ActionPayloadContext,
): Record<string, unknown> {
  if (action.type !== 'move-location' || before === undefined || after === undefined) return {};
  return {
    fromZone: locationKind(before.location) ?? before.zone,
    fromKind: locationKind(before.location),
    fromLocationId: locationId(before.location),
    toZone: locationKind(after.location) ?? after.zone,
    toKind: locationKind(after.location),
    toLocationId: locationId(after.location),
    cause: context.cause ?? 'move',
  };
}

function visibilityPayload(action: GameAction, objects: readonly ObjectSnapshot[]): Record<string, unknown> {
  if (action.type === 'look') {
    return {
      objectIds: objects.map(object => object.ref.id),
      cardIds: objects.map(object => object.cardId).filter((id): id is string => id !== null),
      visibility: action.player,
    };
  }
  if (action.type === 'reveal') {
    return {
      objectIds: objects.map(object => object.ref.id),
      cardIds: objects.map(object => object.cardId).filter((id): id is string => id !== null),
      visibility: action.viewers === undefined ? 'all' : action.viewers,
    };
  }
  if (action.type === 'show-off') return { objectIds: objects.map(object => object.ref.id) };
  return {};
}

function objectCollectionPayload(objects: readonly ObjectSnapshot[]): Record<string, unknown> {
  if (objects.length === 0) return {};
  return { objectIds: objects.map(object => object.ref.id), objectCount: objects.length };
}

function actionSpecificPayload(
  action: GameAction,
  before: ObjectSnapshot | undefined,
  after: ObjectSnapshot | undefined,
  objects: readonly ObjectSnapshot[],
): Record<string, unknown> {
  const subject = after ?? before ?? objects[0];
  switch (action.type) {
    case 'draw':
    case 'discard':
    case 'recycle':
    case 'banish':
    case 'mill':
      return {
        fromZone: before?.zone,
        ...(action.type === 'recycle' ? { toDeck: after?.zone } : {}),
      };
    case 'reveal':
      return { zone: subject?.zone, duration: 'resolution' };
    case 'look':
      return { zone: objects[0]?.zone };
    case 'damage':
      return { combat: action.combat };
    default:
      return {};
  }
}

function payloadContext(
  actionId: string,
  batchId: string,
  active: ActiveEffectContext | undefined,
  source: ObjectSnapshot | undefined,
  player: PlayerId | undefined,
  cause: string | undefined,
  effectController: PlayerId | undefined,
): ActionPayloadContext {
  return {
    actionId,
    batchId,
    effectController,
    source: active?.source ?? source,
    player,
    cause,
  };
}

function contractActionId(action: import('../effects/contract.js').ContractGameAction, sequence: number): string {
  return action.type === 'batch' && action.transactionId !== undefined
    ? action.transactionId
    : `contract:${action.type}:${sequence}`;
}

function deathEmissions(
  action: GameAction | import('../effects/contract.js').ContractGameAction,
  before: readonly ObjectSnapshot[],
  batchId: string,
  active: ActiveEffectContext | undefined,
): readonly TimingEmission[] {
  const emissions: TimingEmission[] = [];
  for (const object of before) {
    const context = payloadContext(
      batchId,
      batchId,
      active,
      active?.source ?? object,
      active?.controller ?? object.controller,
      'kill',
      active?.controller,
    );
    emissions.push(withActionPayload({
      timingPoint: 'object-killed',
      kind: 'object-killed',
      object: structuredClone(object),
      it: structuredClone(object),
      source: active?.source,
      player: active?.controller ?? object.controller,
      batchId,
      simultaneousGroup: batchId,
    }, actionPayload(action.type === 'kill' ? action : { type: 'kill', object: object.ref }, object, undefined, context), {
      before: object,
    }));
  }
  return emissions;
}

function postKillEmissions(
  beforeList: readonly ObjectSnapshot[],
  afterList: readonly ObjectSnapshot[],
  batchId: string,
  active: ActiveEffectContext | undefined,
): readonly TimingEmission[] {
  const first = beforeList[0];
  const source = active?.source ?? first;
  const player = active?.controller ?? first?.controller;
  const emissions = [...deriveZoneChangeEmissions(beforeList, afterList, {
    actionId: batchId,
    batchId,
    player,
    effectController: active?.controller,
    source,
    cause: 'kill',
    simultaneousGroup: batchId,
  })];
  emissions.push(...deriveMightChangedEmissions(beforeList, afterList, {
    actionId: batchId,
    batchId,
    player,
    effectController: active?.controller,
    source,
    cause: 'kill',
    simultaneousGroup: batchId,
  }));
  return emissions;
}

export function createActionPipelineHost(port: ActionStatePort): ContractActionPipelineHost {
  let sequence = 0;
  let active: ActiveEffectContext | undefined;
  let activeGeneration = effectActorGeneration();
  /** Use the performing Resolve's context, and drop an actor a procedure released. */
  const currentActive = () => {
    const performing = performingEffectActor();
    if (performing !== undefined) {
      if (active === undefined || active.controller !== performing.controller ||
          active.timingPoint !== performing.timingPoint || active.source.ref.id !== performing.source.ref.id ||
          active.source.ref.zoneEntryId !== performing.source.ref.zoneEntryId) {
        active = { source: structuredClone(performing.source), controller: performing.controller,
          timingPoint: performing.timingPoint };
      }
      activeGeneration = effectActorGeneration();
    } else if (active !== undefined && activeGeneration !== effectActorGeneration()) active = undefined;
  };

  const checkpoint = () => ({
    __actionAdapterCheckpoint: true,
    port: port.checkpoint(),
    sequence,
    active: active === undefined ? undefined : structuredClone(active),
  });
  const restore = (value: unknown) => {
    if (record(value) && value.__actionAdapterCheckpoint === true && 'port' in value) {
      port.restore(value.port);
      sequence = typeof value.sequence === 'number' ? value.sequence : sequence;
      active = record(value.active) && typeof value.active.controller === 'string' && typeof value.active.timingPoint === 'string'
        ? value.active as unknown as ActiveEffectContext
        : undefined;
      activeGeneration = effectActorGeneration();
      return;
    }
    // Preserve compatibility with callers that pass a checkpoint captured
    // before this adapter was enriched.
    port.restore(value);
  };

  const executeContract = (action: import('../effects/contract.js').ContractGameAction, actionId: string, batchId: string) => {
    const execution = executeContractAction(action, {
      checkpoint,
      restore,
      objects: () => port.objects(),
      perform: leaf => port.perform(leaf),
      ...(port.performContract === undefined ? {} : { performContract: leaf => port.performContract!(leaf) }),
      ...(port.performBatchLeaf === undefined ? {} : { performBatchLeaf: (leaf, batchId) => port.performBatchLeaf!(leaf, batchId) }),
    }, { transactionId: action.type === 'batch' ? action.transactionId ?? batchId : batchId });
    if (execution.outcome.status !== 'done') return { outcome: execution.outcome, emissions: [] };
    const observations = execution.steps.flatMap(step => {
      if (step.action.type !== 'recall') return [];
      const recall = step.action as Extract<import('../effects/contract.js').ContractGameAction, { type: 'recall' }>;
      if (step.outcome.events.some(event => (event as { action?: unknown }).action === 'recall')) return [];
      const object = step.after.find(candidate => candidate.ref.id === recall.object.id &&
        candidate.ref.zoneEntryId === recall.object.zoneEntryId);
      return [{
        type: 'task-resolved' as const,
        seq: 0,
        turnNumber: 1,
        activePlayerId: active?.controller ?? recall.player,
        taskId: `${actionId}:recall`,
        sourceCardId: object?.cardId ?? '',
        reason: 'recall',
        autoResolved: true as const,
        action: 'recall',
        details: {
          recall: true,
          from: step.before.find(candidate => candidate.ref.id === recall.object.id)?.location,
          to: object?.location,
        },
      } as unknown as import('@riftbound/protocol').GameEvent];
    });
    const outcome = observations.length === 0
      ? execution.outcome
      : { ...execution.outcome, events: [...execution.outcome.events, ...observations] };
    const emissions: TimingEmission[] = [];
    const allBefore = execution.steps[0]?.before ?? [];
    const allAfter = execution.steps.at(-1)?.after ?? [];
    if (execution.steps.some(step => step.action.type === 'kill')) {
      const batchContext = payloadContext(
        actionId,
        batchId,
        active,
        active?.source,
        active?.controller,
        'kill',
        active?.controller,
      );
      emissions.push(...deriveZoneChangeEmissions(allBefore, allAfter, {
        actionId,
        batchId,
        player: active?.controller,
        effectController: active?.controller,
        source: active?.source,
        cause: 'kill',
        simultaneousGroup: batchId,
      }));
      for (const step of execution.steps) {
        if (step.action.type !== 'kill') continue;
        const kill = step.action as Extract<GameAction, { type: 'kill' }>;
        const before = step.before.find(object => object.ref.id === kill.object.id && object.ref.zoneEntryId === kill.object.zoneEntryId);
        if (before === undefined) continue;
        emissions.push(withActionPayload({
          timingPoint: 'object-killed',
          kind: 'object-killed',
          object: structuredClone(before),
          it: structuredClone(before),
          source: active?.source,
          player: active?.controller ?? before.controller,
          simultaneousGroup: batchId,
        }, actionPayload(kill, before, undefined, batchContext), { before }));
      }
    }
    for (const step of execution.steps) {
      if (step.action.type !== 'move-location') continue;
      const leaf = step.action as Extract<GameAction, { type: 'move-location' }>;
      const before = step.before.find(object => object.ref.id === leaf.object.id &&
        object.ref.zoneEntryId === leaf.object.zoneEntryId);
      const after = step.after.find(object => object.ref.id === leaf.object.id &&
        object.ref.zoneEntryId === leaf.object.zoneEntryId);
      if (before === undefined || after === undefined) continue;
      const stepContext = payloadContext(
        actionId,
        batchId,
        active,
        active?.source,
        after.controller,
        'move',
        active?.controller,
      );
      const timingPoint: TimingPointId = 'object-moved';
      emissions.push(withActionPayload({
        timingPoint,
        kind: timingPoint,
        object: structuredClone(after),
        source: active?.source,
        player: active?.controller ?? before.controller,
        fromZone: locationKind(before.location) ?? before.zone,
        toZone: locationKind(after.location) ?? after.zone,
        simultaneousGroup: batchId,
      }, {
        ...objectCollectionPayload([after]),
        ...actionPayload(leaf, before, after, stepContext),
        ...transitionPayload(leaf, before, after, stepContext),
      }, { before, after, objects: [after] }));
    }
    return { outcome, emissions };
  };

  const contractActions: ContractActionCapability = {
    version: CONTRACT_ACTION_CAPABILITY_VERSION,
    perform(action) {
      const actionId = `action:${++sequence}`;
      const batchId = action.type === 'batch' ? action.transactionId ?? actionId : actionId;
      if (action.type === 'batch' && action.actions.length > 0 && action.actions.every(leaf => leaf.type === 'kill')) {
        const execution = executeContractAction(action, {
          checkpoint,
          restore,
          objects: () => port.objects(),
          perform: leaf => port.perform(leaf),
          ...(port.performBatchLeaf === undefined ? {} : { performBatchLeaf: (leaf, id) => port.performBatchLeaf!(leaf, id) }),
        }, { transactionId: batchId });
        return execution.outcome;
      }
      return executeContract(action, actionId, batchId).outcome;
    },
  };
  // Fail at host construction when the shared contract owner has not installed
  // the versioned capability this adapter exposes.
  requireContractActionCapability({ contractActions });

  const deathBoundary: PipelineDeathBoundaryCapability | undefined =
    port.performWithDeathBoundary === undefined && port.performKillBatchWithDeathBoundary === undefined
      ? undefined
      : {
          version: PIPELINE_DEATH_BOUNDARY_VERSION,
          execute(action, boundary) {
            if (action.type !== 'kill') return { outcome: { status: 'impossible', events: [] }, emissions: [] };
            currentActive();
            if (port.performWithDeathBoundary === undefined) {
              throw new Error('Confirmed Kill boundary execution is unavailable');
            }
            const beforeList = port.objects();
            const actionId = port.actionId?.(action) ?? actionHint(action, 'actionId') ?? `action:${++sequence}`;
            const batchId = port.batchId?.(action, actionId) ?? actionHint(action, 'batchId') ?? actionId;
            const outcome = port.performWithDeathBoundary(action, confirmed => {
              const emissions = deathEmissions(action, confirmed, batchId, active);
              boundary({ batchId, action, before: confirmed, emissions });
            });
            if (outcome.status !== 'done') return { outcome, emissions: [] };
            const afterList = port.objects();
            return { outcome, emissions: postKillEmissions(beforeList, afterList, batchId, active) };
          },
          executeContract(action, boundary) {
            currentActive();
            if (action.type === 'kill') return deathBoundary!.execute(action, boundary);
            if (action.type === 'batch' && action.actions.length > 0 && action.actions.every(leaf => leaf.type === 'kill')) {
              if (port.performKillBatchWithDeathBoundary === undefined) {
                throw new Error('Confirmed Kill batch boundary execution is unavailable');
              }
              const actionId = contractActionId(action, ++sequence);
              const batchId = action.transactionId ?? actionId;
              const beforeList = port.objects();
              const leaves = action.actions as readonly Extract<GameAction, { type: 'kill' }>[];
              const execution = port.performKillBatchWithDeathBoundary(leaves, batchId, confirmed => {
                const emissions = deathEmissions(action, confirmed, batchId, active);
                boundary({ batchId, action, before: confirmed, emissions });
              });
              if (execution.outcome.status !== 'done') return { outcome: execution.outcome, emissions: [] };
              const afterList = port.objects();
              return { outcome: execution.outcome, emissions: postKillEmissions(beforeList, afterList, batchId, active) };
            }
            const actionId = contractActionId(action, ++sequence);
            return executeContract(action, actionId, action.type === 'batch' ? action.transactionId ?? actionId : actionId);
          },
        };

  return {
    checkpoint,
    restore,
    objects: () => port.objects(),
    context: (source, controller, at) => {
      if (!inReadOnlyContext()) {
        active = { source: structuredClone(source), controller, timingPoint: at };
        activeGeneration = effectActorGeneration();
      }
      const context = port.context(source, controller, at);
      return new Proxy(context, {
        get(target, key) {
          if (key === 'contractActions') return contractActions;
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
    choose: <T>(request: ChoiceRequest<T>): T => port.choose(request),
    testTrigger: port.testTrigger ? (registration, event, source) => port.testTrigger!(registration, event, source) : undefined,
    ...(deathBoundary === undefined ? {} : { deathBoundary }),
    executeContract(action) {
      currentActive();
      const actionId = contractActionId(action, ++sequence);
      const batchId = action.type === 'batch' ? action.transactionId ?? actionId : actionId;
      return executeContract(action, actionId, batchId);
    },
    execute(action) {
      currentActive();
      const beforeList = port.objects();
      const contractAction = action as unknown as import('../effects/contract.js').ContractGameAction;
      const contract = isContractAction(action)
        ? (() => {
            const actionId = contractActionId(contractAction, ++sequence);
            return executeContract(contractAction, actionId, actionId);
          })()
        : undefined;
      if (contract !== undefined) return contract;
      const before = new Map(beforeList.map(object => [object.ref.id, object]));
      const hintedActionId = port.actionId?.(action) ?? actionHint(action, 'actionId');
      const actionId = hintedActionId ?? `action:${++sequence}`;
      const hintedBatchId = port.batchId?.(action, actionId) ?? actionHint(action, 'batchId');
      const batchId = hintedBatchId ?? actionId;
      const outcome = port.perform(action);
      if (outcome.status !== 'done') return { outcome, emissions: [] };

      const afterList = port.objects();
      const after = new Map(afterList.map(object => [object.ref.id, object]));
      const objectRef = actionObjectRef(action);
      const old = objectRef ? before.get(objectRef.id) : undefined;
      const next = objectRef ? after.get(objectRef.id) : undefined;
      const actionSource = 'source' in action ? before.get(action.source.id) : undefined;
      const source = active?.source ?? actionSource;
      const player = 'player' in action ? action.player : active?.controller ?? old?.controller;
      const cause = port.cause?.(action) ?? actionHint(action, 'cause') ??
        (action.type === 'move-location' ? 'move' : action.type === 'mill' ? 'burn' : action.type);
      const effectController = active?.controller ?? port.effectController?.(action);
      // A primitive such as Stun carries no player field. The affected object's
      // controller is not the player responsible for the action (CR 412.4-
      // 412.5); the captured effect actor is the only authoritative fallback.
      const responsiblePlayer = 'player' in action ? player : effectController;
      const context = payloadContext(
        actionId, batchId, active, source,
        'player' in action ? player : responsiblePlayer,
        cause, effectController,
      );
      const emissions: TimingEmission[] = [];

      emissions.push(...deriveZoneChangeEmissions(beforeList, afterList, {
        actionId,
        batchId,
        player,
        effectController,
        source,
        cause,
        simultaneousGroup: batchId,
      }));

      const objects = actionObjects(action, outcome, before, after);
      // A Stun is one committed state transition even though its GameAction has
      // no player field. The action's responsibility belongs to the effect
      // controller captured while Resolve was running (CR 412.4-.5).
      const visibility = visibilityPayload(action, objects);
      const timed = ACTION_TIMINGS[action.type];
      if (timed !== undefined) {
        const changed = changedObjects(beforeList, afterList);
        if (action.type === 'draw' || action.type === 'mill' || action.type === 'channel-rune') {
          for (const object of changed) {
            const previous = before.get(object.ref.id);
            emissions.push(withActionPayload({
              timingPoint: timed,
              kind: timed,
              object,
              source,
              player,
              amount: 1,
              simultaneousGroup: batchId,
            }, {
              ...actionPayload(action, previous, object, context),
              ...actionSpecificPayload(action, previous, object, [object]),
              ...visibility,
            }, { before: previous, after: object, objects: [object] }));
          }
        } else if (action.type === 'look' || action.type === 'reveal' || action.type === 'show-off') {
          if (objects.length > 0) {
            const first = objects[0]!;
            const previous = before.get(first.ref.id);
            emissions.push(withActionPayload({
              timingPoint: timed,
              kind: timed,
              object: first,
              source,
              player,
              simultaneousGroup: batchId,
            }, {
              ...visibility,
              ...(action.type === 'look' ? objectCollectionPayload(objects) : {}),
              ...actionPayload(action, previous, after.get(first.ref.id) ?? first, context),
              ...actionSpecificPayload(action, previous, after.get(first.ref.id) ?? first, objects),
            }, { before: previous, after: after.get(first.ref.id) ?? first, objects }));
          }
        } else if (actionHasStateTransition(action, old, next, outcome.result)) {
          const eventObject = action.type === 'kill' ? old : next ?? old;
          const eventBefore = action.type === 'damage' ? before.get(action.target.id) : old;
          const eventAfter = action.type === 'damage' ? after.get(action.target.id) : next;
          if (eventObject !== undefined || action.type === 'score' || action.type === 'gain-xp') {
            const amount = 'amount' in action ? action.amount : undefined;
            const actualAmount = typeof outcome.result === 'number' ? outcome.result : amount;
            const actionEmission = withActionPayload({
              timingPoint: timed,
              kind: timed,
              object: eventObject,
              target: action.type === 'damage' ? eventAfter : undefined,
              source,
              player: action.type === 'stun'
                ? responsiblePlayer
                : responsiblePlayer ?? eventObject?.controller,
              amount: actualAmount,
              simultaneousGroup: batchId,
            }, {
              ...actionPayload(action, eventBefore, eventAfter, context),
              ...(action.type === 'move-location'
                ? { ...objectCollectionPayload(eventAfter === undefined ? [] : [eventAfter]),
                  ...transitionPayload(action, eventBefore, eventAfter, context) }
                : {}),
              ...actionSpecificPayload(action, eventBefore, eventAfter, eventObject === undefined ? [] : [eventObject]),
            }, { before: eventBefore, after: eventAfter,
              ...(action.type === 'move-location' && eventAfter !== undefined
                ? { objects: [eventAfter] }
                : {}) });
            if (action.type === 'kill') {
              const firstEntry = emissions.findIndex(event => event.timingPoint === 'object-enters-zone');
              if (firstEntry >= 0) emissions.splice(firstEntry, 0, actionEmission);
              else emissions.push(actionEmission);
            } else {
              emissions.push(actionEmission);
            }
          }
        }
      }

      emissions.push(...deriveMightChangedEmissions(beforeList, afterList, {
        actionId,
        batchId,
        player,
        effectController,
        source,
        cause,
        simultaneousGroup: batchId,
      }));
      return { outcome, emissions };
    }
  };
}

/** Preserve prototype methods while adapting the primitive-facing surface. */
export function bindResolveContext(base: ResolveContext, overrides: Partial<ResolveContext>): ResolveContext {
  return new Proxy(base, { get(target, key) {
    if (key in overrides) return overrides[key as keyof ResolveContext];
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
