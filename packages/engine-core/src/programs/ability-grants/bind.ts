import type { Ability } from '@riftbound/card-dsl';
import type { ChainEngine } from '../../chain/engine.js';
import type { ObjectSnapshot } from '../../effects/contract.js';
import { ProgramRegistry } from '../registry.js';
import { triggerRegistrations } from '../triggers.js';
import { bindStaticAbility, bindReplacementAbility, type ProgramStaticBinder, type StaticBindingHandle } from '../statics.js';
import { ProgramBindingError } from '../errors.js';
import type { EffectiveAbilityEntry } from './index.js';

/** Install one derived entry through the existing production routes. The
 * lifecycle owner supplies its single static binder and owns this handle's
 * reconciliation/checkpoint boundary. Activated/play entries are read by their
 * existing program consumers and do not register an event listener. */
export function bindGrantedAbility(
  engine: ChainEngine, source: ObjectSnapshot, entry: EffectiveAbilityEntry, binder: ProgramStaticBinder,
): StaticBindingHandle {
  const ability: Ability = entry.ability;
  if (ability.kind === 'static' || ability.kind === 'replacement') {
    if (ability.kind === 'static' && !binder.bindStatic || ability.kind === 'replacement' && !binder.bindReplacement) {
      throw new ProgramBindingError('judge-required', `No production binder for granted ${ability.kind}`);
    }
    return ability.kind === 'static' ? bindStaticAbility(binder, ability, source) : bindReplacementAbility(binder, ability, source);
  }
  if (ability.kind !== 'triggered') throw new ProgramBindingError('unbound-ability', `${ability.kind} abilities require their program consumer`);
  const registry = new ProgramRegistry([{ canonicalCardId: source.cardId ?? source.ref.id,
    rulesetVersion: 'core-1.5', status: 'executable', sourceText: '[granted trigger]', abilities: [ability] }]);
  if (source.cardId === null) throw new ProgramBindingError('judge-required', 'Granted trigger requires an identified program host');
  const registration = triggerRegistrations(registry, source)[0]!;
  engine.pipeline.registerTrigger({ ...registration, id: entry.id });
  return { unbind: () => engine.pipeline.unregisterTrigger(entry.id) };
}
