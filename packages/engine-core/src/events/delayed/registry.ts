import type { Instruction, ObjectSnapshot, PlayerId } from '../../effects/contract.js';
import type { TriggerSpec } from '../trigger-spec.js';
import { assertTriggerSpec } from '../trigger-spec.js';
import type { TriggerRegistration } from '../pipeline-types.js';
import type { DelayedDuration } from './duration.js';
import { delayedExpiresAt } from './duration.js';

/** A minimal pipeline-shaped surface (EventPipeline's registration operations). */
export interface DelayedTriggerSink {
  registerTrigger(registration: TriggerRegistration): void;
  unregisterTrigger(id: string): void;
}

let sequence = 0;
export function nextDelayedTriggerId(): string {
  sequence += 1;
  return `delayed:${sequence}`;
}
/** Test isolation: each engine run resets its own sequence. */
export function resetDelayedTriggerSequence(): void {
  sequence = 0;
}

/**
 * CR v1.5 391.2/393: a Delayed Trigger is registered with delayed: true, so
 * the pipeline keeps it alive after its source leaves the board and keeps the
 * registration's controller. 359.3.f.3.a: the source snapshot, controller and
 * trigger spec are locked at registration time (LKI).
 *
 * expiresAt removes the registration on its expiry timing point's wave, after
 * that wave's scan — a turn-end expiry still triggers on that turn-end and is
 * then removed.
 */
export function registerDelayedTrigger(
  sink: DelayedTriggerSink,
  registration: {
    readonly id: string;
    readonly source: ObjectSnapshot;
    readonly controller: PlayerId;
    readonly spec: TriggerSpec;
    readonly body: readonly Instruction[];
    readonly duration?: DelayedDuration;
  }
): string {
  assertTriggerSpec(registration.spec);
  const expiresAt = delayedExpiresAt(registration.duration);
  const registration_ = {
    id: registration.id,
    source: registration.source,
    controller: registration.controller,
    spec: registration.spec,
    body: registration.body,
    delayed: true as const,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
  sink.registerTrigger(registration_);
  return registration.id;
}
