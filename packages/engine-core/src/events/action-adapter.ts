import type { ActionOutcome, ChoiceRequest, GameAction, ObjectSnapshot, ResolveContext } from '../effects/contract.js';
import type { PipelineHost, TimingEmission } from './pipeline-types.js';
import { isTimingPointId, type TimingPointId } from './timing-points.js';

/** State storage remains the caller's responsibility; this adapter owns event derivation. */
export interface ActionStatePort extends Omit<PipelineHost, 'execute'> {
  perform(action: GameAction): ActionOutcome;
}
const ACTION_TIMINGS: Partial<Record<GameAction['type'], TimingPointId>> = {
  draw: 'card-drawn', discard: 'card-discarded', recycle: 'card-recycled', banish: 'card-banished', mill: 'card-burned',
  'move-location': 'object-moved', ready: 'object-readied', exhaust: 'object-exhausted', stun: 'unit-stunned', kill: 'object-killed',
  damage: 'damage-dealt', 'gain-xp': 'xp-gained', buff: 'buff-added', 'spend-buff': 'buff-spent', empower: 'empowered-changed', disempower: 'empowered-changed',
  reveal: 'card-revealed', look: 'cards-looked-at', 'show-off': 'objects-shown-off', attach: 'object-attached', score: 'score'
};
function zoneTimings(prefix: 'object-enters-' | 'object-leaves-', object: ObjectSnapshot): TimingPointId[] {
  const names = [`${prefix}zone`, `${prefix}${object.zone}`];
  if (object.zone === 'board' && object.location) names.push(`${prefix}${object.location.type}`);
  return [...new Set(names.filter(isTimingPointId))];
}
export function createActionPipelineHost(port: ActionStatePort): PipelineHost {
  return {
    checkpoint: () => port.checkpoint(), restore: state => port.restore(state),
    objects: () => port.objects(), context: (source, controller, at) => port.context(source, controller, at),
    choose: <T>(request: ChoiceRequest<T>): T => port.choose(request),
    testTrigger: port.testTrigger ? (registration, event, source) => port.testTrigger!(registration, event, source) : undefined,
    execute(action) {
      const before = port.objects(), outcome = port.perform(action);
      if (outcome.status !== 'done') return { outcome, emissions: [] };
      const after = port.objects(), emissions: TimingEmission[] = [];
      const oldById = new Map(before.map(object => [object.ref.id, object]));
      const nextById = new Map(after.map(object => [object.ref.id, object]));
      const objectRef = 'object' in action ? action.object : 'target' in action ? action.target : undefined;
      const old = objectRef ? oldById.get(objectRef.id) : undefined;
      const next = objectRef ? nextById.get(objectRef.id) : undefined;
      const source = 'source' in action ? oldById.get(action.source.id) : undefined;
      const player = 'player' in action ? action.player : old?.controller;
      for (const previous of before) {
        const current = nextById.get(previous.ref.id);
        if (current && current.ref.zoneEntryId === previous.ref.zoneEntryId) continue;
        for (const timingPoint of zoneTimings('object-leaves-', previous)) emissions.push({ timingPoint, kind: 'object-left-zone', object: previous, source, player, fromZone: previous.zone, toZone: current?.zone, simultaneousGroup: previous.ref.id });
      }
      for (const current of after) {
        const previous = oldById.get(current.ref.id);
        if (previous && current.ref.zoneEntryId === previous.ref.zoneEntryId) continue;
        for (const timingPoint of zoneTimings('object-enters-', current)) emissions.push({ timingPoint, kind: 'object-entered-zone', object: current, source, player, fromZone: previous?.zone, toZone: current.zone, simultaneousGroup: current.ref.id });
      }
      const timingPoint = ACTION_TIMINGS[action.type];
      const amount = 'amount' in action ? action.amount : undefined;
      if (timingPoint && !(action.type === 'damage' && (typeof outcome.result === 'number' ? outcome.result : amount ?? 0) <= 0)) {
        // Initial orientation on a Chain card is entry setup, not an exhaust/ready on Board.
        if (action.type === 'draw' || action.type === 'mill' || action.type === 'channel-rune') {
          for (const object of after.filter(object => oldById.get(object.ref.id)?.ref.zoneEntryId !== object.ref.zoneEntryId)) emissions.push({ timingPoint, object, player, amount: 1, simultaneousGroup: object.ref.id });
        } else if (!((action.type === 'ready' || action.type === 'exhaust') && old?.zone !== 'board')) {
          const emission = { timingPoint, object: action.type === 'kill' ? old : next ?? old, target: action.type === 'damage' ? next : undefined, source, player, amount: typeof outcome.result === 'number' ? outcome.result : amount, simultaneousGroup: old?.ref.id };
          const entry = emissions.findIndex(event => event.timingPoint === 'object-enters-zone');
          if (action.type === 'kill' && entry >= 0) emissions.splice(entry, 0, emission);
          else emissions.push(emission);
        }
      }
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
