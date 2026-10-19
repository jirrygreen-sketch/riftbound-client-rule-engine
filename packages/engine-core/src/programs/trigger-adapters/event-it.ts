import type { EventObjectBinding } from '../../effects/contract.js';
import type { PipelineEvent } from '../../events/pipeline-types.js';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Freeze the event's pronoun object for the 845 event:it selector. The chain
 * bridge must pass this exact binding into ResolveContext.eventObject("it");
 * it must never look the object up again by id.
 */
export function eventItBinding(event: PipelineEvent): EventObjectBinding | null {
  const snapshot = event.object;
  if (!snapshot || !Number.isSafeInteger(event.eventId) || event.eventId <= 0) return null;
  const frozen = deepFreeze(structuredClone(snapshot));
  return deepFreeze({
    eventId: event.eventId,
    role: 'it',
    ref: { ...frozen.ref },
    snapshot: frozen
  });
}
