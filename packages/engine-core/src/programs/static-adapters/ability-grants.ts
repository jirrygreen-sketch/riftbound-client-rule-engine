import type { Ability } from '@riftbound/card-dsl';
import type { ChainEngine } from '../../chain/engine.js';
import type { ObjectSnapshot } from '../../effects/contract.js';
import { effectCondition, layerSpec, normalizeStaticFilter, record } from './model.js';

type StaticAbility = Extract<Ability, { kind: 'static' }>;

/**
 * Project 809's authored grant/ignore declaration through its existing
 * installer API. The projection selects current recipients; this adapter owns
 * the source-relative condition and layer lifetime.
 */
export function registerAbilityGrant(
  engine: ChainEngine,
  ability: StaticAbility,
  source: ObjectSnapshot,
  id: string,
): { readonly unbind: () => void } {
  const effect = record(ability.effect);
  if (effect.kind !== 'continuous.grant-ability' && effect.kind !== 'continuous.ignore-ability') {
    throw new TypeError('Ability-grant adapter requires a grant or ignore effect');
  }
  const filter = normalizeStaticFilter(effect.filter);
  const condition = effectCondition(engine, ability, source, filter);
  const currentCondition = ability.condition === undefined ? undefined : (object: ObjectSnapshot): boolean => {
    const live = engine.pipeline.host.objects().find(candidate => candidate.ref.id === source.ref.id && candidate.cardId === source.cardId);
    if (live === undefined || !effectCondition(engine, ability, live, filter)?.(object)) return false;
    return true;
  };
  const { duration } = layerSpec(engine, ability, source, id, 'ability', filter, {
    ...effect,
    filter,
    ...(condition === undefined ? {} : { staticCondition: currentCondition ?? condition }),
  });
  engine.layers.addContinuous({
    id,
    layer: 'ability',
    source: source.ref,
    filter: {},
    effect: {
      ...effect,
      filter,
      ...(condition === undefined ? {} : { staticCondition: currentCondition ?? condition }),
    } as never,
  }, duration);
  return { unbind: () => { engine.layers.removeContinuous(id); } };
}

