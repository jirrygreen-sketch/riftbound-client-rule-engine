import type { ObjectRef, ResolveContext } from '../contract.js';
import type { LinkedAbilityState } from '../linked-abilities/state.js';
import type { LinkedAbilityWindow } from '../linked-abilities/types.js';
import { MissingInformation } from './values.js';

/** Return only affected objects, never recursively collect a receipt's source metadata. */
export function resolveLinkedObjects(
  key: string, context: ResolveContext, state: LinkedAbilityState, window?: LinkedAbilityWindow
): ObjectRef[] {
  const refs = state.read(context, key, window);
  if (refs === undefined) throw new MissingInformation(`Unavailable linked ability collection: ${key}`);
  return refs;
}
