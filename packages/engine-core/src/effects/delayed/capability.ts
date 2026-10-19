import type { TriggerRegistration } from '../../events/pipeline-types.js';
import type {
  DelayedRegistrationCapability,
  DelayedRegistrationOptions,
  DelayedPipelineSink,
} from './types.js';
import { DELAYED_REGISTRATION_CAPABILITY } from './types.js';
import { bindResolveContext } from '../../events/action-adapter.js';
import type { ResolveContext } from '../contract.js';

const capabilitiesBySource = new WeakMap<object, DelayedRegistrationCapability>();

function bodyId(body: readonly { readonly id: string }[]): string {
  return body.map(instruction => instruction.id).join(',');
}

function cloneWithCapabilities(source: ResolveContext['source']): ResolveContext['source'] {
  const clone = structuredClone(source);
  for (const symbol of Object.getOwnPropertySymbols(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, symbol);
    if (descriptor !== undefined) Object.defineProperty(clone, symbol, descriptor);
  }
  return clone;
}

/**
 * Adapt the existing EventPipeline registration surface to the additive
 * delayed-registration capability. This is deliberately a separate adapter:
 * the frozen ResolveContext signature remains valid, while a production host
 * can install this capability without changing old contexts or journals.
 */
export function createDelayedRegistrationCapability(
  pipeline: DelayedPipelineSink,
): DelayedRegistrationCapability {
  return {
    version: 'riftbound.delayed-registration.v1',
    checkpoint() {
      if (pipeline.checkpoint === undefined) throw new TypeError('Delayed registration pipeline has no checkpoint');
      return pipeline.checkpoint();
    },
    restore(checkpoint) {
      if (pipeline.restore === undefined) throw new TypeError('Delayed registration pipeline has no restore');
      pipeline.restore(checkpoint);
    },
    register(at, body, options) {
      const source = options.source;
      if (source === undefined || options.controller === undefined) {
        throw new TypeError('Delayed registration requires captured source and controller LKI');
      }
      if (options.filter !== undefined && JSON.stringify(options.filter) !== JSON.stringify(at.filter)) {
        throw new TypeError('Delayed registration filter does not match its trigger specification');
      }
      const base = `delayed:${source.ref.id}:${source.ref.zoneEntryId}:${at.at}:${bodyId(body)}`;
      let id = base;
      let suffix = 1;
      while (pipeline.hasTriggerRegistration(id)) {
        id = `${base}:${suffix++}`;
      }
      const sourceFilter = at.filter as Readonly<Record<string, unknown>>;
      if (options.lockedRefs !== undefined && options.lockedRefs.length > 0 &&
          !('object' in sourceFilter) && typeof sourceFilter.objectId !== 'string') {
        throw new TypeError('Locked delayed registrations require an event object filter');
      }
      if (options.lockedRefs !== undefined && options.lockedRefs.length > 0 && pipeline.registerTriggerRule === undefined) {
        throw new TypeError('Locked delayed registrations require exact-incarnation trigger rules');
      }
      const registration = {
        id,
        source,
        controller: options.controller,
        spec: at as TriggerRegistration['spec'],
        body,
        delayed: true,
        ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
        ...(options.maxPerScope === undefined ? {} : { maxPerScope: options.maxPerScope }),
      } as TriggerRegistration;
      if (options.maxPerScope !== undefined && options.maxPerScope > 1 &&
          registration.spec.once === undefined) {
        throw new TypeError('Delayed repeated use requires an explicit once scope');
      }
      pipeline.registerTrigger(registration);
      const rules: string[] = [];
      try {
        if (options.expireOn !== undefined) {
          if (pipeline.registerTriggerRule === undefined) {
            throw new TypeError('Player-relative delayed windows require a trigger-rule consumer');
          }
          const ruleId = `${id}:window-expiry`;
          pipeline.registerTriggerRule({
            id: ruleId,
            mode: 'suppress',
            delayed: true,
            // The rule removes the registration on the controller's opening
            // wave. Returning false leaves this wave's already-collected hit
            // active, so "at the start of your next phase" still triggers.
            matches(context) {
              if (context.registration.id !== id ||
                  context.event.timingPoint !== options.expireOn!.timingPoint ||
                  context.event.player !== options.expireOn!.player) return false;
              pipeline.unregisterTriggerRule?.(ruleId);
              const removable = pipeline as DelayedPipelineSink & { unregisterTrigger?: (triggerId: string) => void };
              removable.unregisterTrigger?.(id);
              return false;
            },
          });
          rules.push(ruleId);
        }
        if (options.lockedRefs !== undefined && options.lockedRefs.length > 0) {
          const locked = options.lockedRefs.map(ref => `${ref.id}:${ref.zoneEntryId}`);
          pipeline.registerTriggerRule!({
            id: `${id}:locked-incarnation`,
            mode: 'suppress',
            delayed: true,
            matches(context) {
              if (context.registration.id !== id) return false;
              const candidates = [context.event.object, context.event.target, context.event.it].filter(
                (object): object is NonNullable<typeof object> => object !== undefined,
              );
              return candidates.length === 0 || !candidates.some(object => locked.includes(`${object.ref.id}:${object.ref.zoneEntryId}`));
            },
          });
          rules.push(`${id}:locked-incarnation`);
        }
      } catch (error) {
        // The trigger has already been registered. Remove every rule and the
        // trigger before a later capability check can fail, so no half-installed
        // registration survives outside the caller's transaction.
        for (const ruleId of rules.reverse()) pipeline.unregisterTriggerRule?.(ruleId);
        const removable = pipeline as DelayedPipelineSink & { unregisterTrigger?: (id: string) => void };
        removable.unregisterTrigger?.(id);
        throw error;
      }
    },
  };
}

/** Attach the capability to the source snapshot so nested interpreter scopes retain it. */
export function bindDelayedRegistrationCapability(
  context: ResolveContext,
  capability: DelayedRegistrationCapability,
): ResolveContext {
  // ChainEngine rebuilds its context around the exact source object supplied
  // to PipelineHost.context. Keep the non-journal capability reachable from
  // that object while the nested interpreter retains the symbol-bearing clone.
  if (context.source !== null && typeof context.source === 'object') {
    capabilitiesBySource.set(context.source, capability);
  }
  const source = cloneWithCapabilities(context.source);
  if (source === null || typeof source !== 'object') {
    throw new TypeError('Delayed registration capability requires a source snapshot');
  }
  Object.defineProperty(source, DELAYED_REGISTRATION_CAPABILITY, {
    configurable: false,
    enumerable: false,
    value: capability,
    writable: false,
  });
  return bindResolveContext(context, { source });
}

export function delayedRegistrationCapabilityOf(
  context: ResolveContext,
): DelayedRegistrationCapability | undefined {
  const source = context.source;
  if (source === null || typeof source !== 'object') return undefined;
  return capabilitiesBySource.get(source) ?? (source as ResolveContext['source'] & {
    readonly [DELAYED_REGISTRATION_CAPABILITY]?: DelayedRegistrationCapability;
  })[DELAYED_REGISTRATION_CAPABILITY];
}

export type { DelayedRegistrationCapability, DelayedRegistrationOptions };
export { DELAYED_REGISTRATION_CAPABILITY };
