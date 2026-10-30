/**
 * RIFT-1156: the action adapter attributes actions and their events to the
 * controller of the effect whose Resolve performs them, falling back to the
 * affected object's controller. Two kinds of host access must not leave a
 * stale effect actor behind:
 * - rule reads (static and trigger conditions, layer filters, keyword-grant
 *   sweeps) build ResolveContexts but perform nothing, so they never become
 *   the actor;
 * - a turn-based action or a Standard Move is performed by the game's
 *   procedures or by the moving player, so the previously resolved effect is
 *   released first.
 * While a Resolve performs an action through its own ResolveContext, that
 * context is the actor.
 * Otherwise an event's player depends on which context happened to be built
 * last, which also changes with how often rules are read.
 */
import type { ObjectSnapshot, PlayerId } from '../effects/contract.js';
import type { TimingPointId } from './timing-points.js';

export interface EffectActor {
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly timingPoint: TimingPointId;
}

let readDepth = 0;
const performing: EffectActor[] = [];
let releases = 0;

/** Build and use ResolveContexts for a read that performs no action. */
export function readOnlyContext<T>(read: () => T): T {
  readDepth++;
  try { return read(); } finally { readDepth--; }
}

export function inReadOnlyContext(): boolean {
  return readDepth > 0;
}

/** Run actions that an effect performs through its own ResolveContext. */
export function performingEffect<T>(actor: EffectActor, perform: () => T): T {
  performing.push(actor);
  try { return perform(); } finally { performing.pop(); }
}

/** The ResolveContext whose Resolve is performing the current action. */
export function performingEffectActor(): EffectActor | undefined {
  return performing.at(-1);
}

/** A procedure outside every performing Resolve has no effect actor. */
export function releaseEffectActor(): void {
  if (performing.length === 0) releases++;
}

/** Changes whenever the current effect actor has been released. */
export function effectActorGeneration(): number {
  return releases;
}
