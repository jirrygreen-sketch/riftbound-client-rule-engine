import type { PipelineHost } from '../../events/pipeline-types.js';
import { bindResolveContext } from '../../events/action-adapter.js';
import { LinkedAbilityState } from './state.js';
import type { LinkedAbilityBinding, LinkedAbilityClock } from './types.js';

/**
 * Opt-in production port for the shared assembler owner. No card, registry,
 * choice, target, or action semantics are replaced by this adapter.
 */
export function createLinkedAbilityHost(
  port: PipelineHost,
  options: { readonly bindings?: readonly LinkedAbilityBinding[]; readonly clock: () => LinkedAbilityClock }
): { readonly host: PipelineHost; readonly state: LinkedAbilityState } {
  const state = new LinkedAbilityState(options.bindings);
  const checkpoints = new WeakSet<object>();
  const host: PipelineHost = {
    objects: () => port.objects(),
    choose: request => port.choose(request),
    ...(port.testTrigger ? { testTrigger: (registration, event, source) => port.testTrigger!(registration, event, source) } : {}),
    checkpoint() {
      const saved = { port: port.checkpoint(), linked: state.checkpoint() };
      checkpoints.add(saved);
      return saved;
    },
    restore(value) {
      if (value === null || typeof value !== 'object' || !checkpoints.has(value)) {
        throw new TypeError('Invalid linked ability host checkpoint');
      }
      const saved = value as { port: unknown; linked: ReturnType<LinkedAbilityState['checkpoint']> };
      port.restore(saved.port);
      state.restore(saved.linked);
    },
    execute(action) {
      const before = structuredClone(port.objects());
      const clock = { ...options.clock() };
      const execution = port.execute(action);
      state.observe(action, execution, before, port.objects(), clock);
      return execution;
    },
    context(source, controller, at) {
      const context = port.context(source, controller, at);
      const since = state.cursor;
      return bindResolveContext(context, {
        linked: key => state.read(context, key)?.map(ref => ({ id: ref.id, zoneEntryId: ref.zoneEntryId })) ?? context.linked(key),
        link(key, value) {
          state.capture(source, key, value, since);
          context.link(key, value);
        }
      });
    }
  };
  return { host, state };
}
