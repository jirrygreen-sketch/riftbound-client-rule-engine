import type { ActionOutcome, ChoiceRequest, GameAction, ObjectSnapshot, PlayerId, ResolveContext } from '../effects/contract.js';
import type { PipelineHost, TimingEmission } from './pipeline-types.js';
import { type TimingPointId } from './timing-points.js';
import { deriveMightChangedEmissions } from './producers/might-change.js';
import { deriveZoneChangeEmissions } from './producers/zone-change.js';
import {
  actionObjectRef,
  actionPayload,
  locationId,
  locationKind,
  objectRef,
  withActionPayload,
  type ActionPayloadContext,
} from './producers/payload.js';

/** State storage remains the caller's responsibility; this adapter owns event derivation. */
export interface ActionStatePort extends Omit<PipelineHost, 'execute'> {
  perform(action: GameAction): ActionOutcome;
  /** Optional command identity supplied by a journal or a batch coordinator. */
  actionId?: (action: GameAction) => string | undefined;
  /** Optional identity shared by all primitive actions in one submitted batch. */
  batchId?: (action: GameAction, actionId: string) => string | undefined;
  /** Optional authoritative effect controller for actions without a player field. */
  effectController?: (action: GameAction) => PlayerId | undefined;
  /** Optional rule-level cause (for example `move` versus `recall`). */
  cause?: (action: GameAction) => string | undefined;
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
    fromKind: locationKind(before.location),
    fromLocationId: locationId(before.location),
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

export function createActionPipelineHost(port: ActionStatePort): PipelineHost {
  let sequence = 0;
  let active: ActiveEffectContext | undefined;

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
      return;
    }
    // Preserve compatibility with callers that pass a checkpoint captured
    // before this adapter was enriched.
    port.restore(value);
  };

  return {
    checkpoint,
    restore,
    objects: () => port.objects(),
    context: (source, controller, at) => {
      active = { source: structuredClone(source), controller, timingPoint: at };
      return port.context(source, controller, at);
    },
    choose: <T>(request: ChoiceRequest<T>): T => port.choose(request),
    testTrigger: port.testTrigger ? (registration, event, source) => port.testTrigger!(registration, event, source) : undefined,
    execute(action) {
      const beforeList = port.objects();
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
      const context = payloadContext(actionId, batchId, active, source, player, cause, effectController);
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
              ...actionPayload(action, previous, after.get(first.ref.id) ?? first, context),
              ...actionSpecificPayload(action, previous, after.get(first.ref.id) ?? first, objects),
              ...visibility,
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
              player,
              amount: actualAmount,
              simultaneousGroup: batchId,
            }, {
              ...actionPayload(action, eventBefore, eventAfter, context),
              ...transitionPayload(action, eventBefore, eventAfter, context),
              ...actionSpecificPayload(action, eventBefore, eventAfter, eventObject === undefined ? [] : [eventObject]),
            }, { before: eventBefore, after: eventAfter });
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
