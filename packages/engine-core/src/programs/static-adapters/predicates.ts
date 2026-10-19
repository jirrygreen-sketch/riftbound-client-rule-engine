import type { Ability } from '@riftbound/card-dsl';
import type { ChainEngine } from '../../chain/engine.js';
import type { ObjectSnapshot } from '../../effects/contract.js';
import { evaluateExpression } from '../../effects/interpreter/expr.js';
import { readHistoryQuery } from '../../effects/interpreter/history.js';
import { compareValues, MissingInformation } from '../../effects/interpreter/values.js';
import { abilityEnvironment, liveSource, record } from './model.js';

export type StaticPredicateAbility = Extract<Ability, { kind: 'static' }>;

export function evaluateStaticPredicate(engine: ChainEngine, source: ObjectSnapshot, ability: StaticPredicateAbility): boolean {
  const current = liveSource(engine, source.ref);
  if (current === null) return false;
  const effect = record(ability.effect);
  const environment = abilityEnvironment(engine, current);
  if (effect.kind === 'condition.value') {
    if (effect.predicate !== 'is-mighty') throw new MissingInformation(`Unsupported static value predicate ${String(effect.predicate)}`);
    const snapshot = current.zone === 'board' ? engine.layers.snapshot(current.ref) : (engine.layers.snapshot(current.ref) ?? current);
    const printed = record((snapshot as unknown as Record<string, unknown> | null)?.printed);
    const might = current.zone === 'board' ? snapshot?.might ?? null : typeof printed.might === 'number' ? printed.might : current.might;
    const threshold = effect.threshold === undefined ? 5 : evaluateExpression(effect.threshold as never, environment);
    if (typeof might !== 'number' || typeof threshold !== 'number') return false;
    return compareValues(might, String(effect.operator ?? 'gte') as never, threshold);
  }
  if (effect.kind === 'condition.predicate') {
    if (effect.query === 'controller-xp') {
      const threshold = evaluateExpression(effect.threshold as never, environment);
      const player = environment.context.player(current.controller);
      if (typeof threshold !== 'number') return false;
      return compareValues(player.xp, String(effect.operator ?? 'gte') as never, threshold);
    }
    const history = effect.history;
    if (history !== undefined) {
      const count = environment.context.history(readHistoryQuery(history, environment.context));
      const right = effect.right ?? 1;
      return compareValues(count, String(effect.operator ?? 'gte') as never, right as never);
    }
    throw new MissingInformation(`Unsupported static predicate ${String(effect.predicate ?? effect.query ?? '<missing>')}`);
  }
  throw new MissingInformation(`Unsupported static predicate kind ${String(effect.kind)}`);
}

