import { validateCardProgram, type Ability } from '@riftbound/card-dsl';
import type { ContinuousEffectSpec, Expr, InstructionResult, ObjectFilter, ObjectRef, ResolveContext, Schema, Value } from '../../effects/contract.js';
import { effectId, isDurationAlias, resolveContinuousDuration, targetFilter } from '../../layers/ops/index.js';
import { sameRef } from '../../layers/types.js';
import { asValue } from '../../effects/interpreter/values.js';

type Fields = Record<string, unknown>;
type Operation = 'continuous.grant-ability' | 'continuous.ignore-ability';
export type AbilityInstructionArgs = Readonly<Fields>;
export const fields = (value: unknown): Fields => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Expected an object');
  return value as Fields;
};
const id = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const ref = (value: unknown): value is ObjectRef => {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Fields;
  return id(item.id) && Number.isSafeInteger(item.zoneEntryId) && (item.zoneEntryId as number) >= 0;
};
const expression = (value: unknown): value is Expr => typeof value === 'object' && value !== null && 'kind' in value &&
  ['constant', 'literal', 'linked', 'linked-value', 'object-property', 'object-attribute', 'count', 'arithmetic',
    'player-property', 'turn-number', 'player-turn-count', 'object-designation'].includes(String(value.kind));
export function evaluate(ctx: ResolveContext, value: unknown): unknown {
  return expression(value) ? ctx.evaluate(value) : value;
}

/**
 * Replay-stable identity for one instruction resolution. The interpreter's
 * link writes are path-qualified, while settlementIdentity's read helper only
 * sees unqualified links. Use the instruction path as the fallback instead of
 * a process-global counter: repeated resolution paths remain independently
 * addressable and rollback restores their sequence naturally.
 */
export function abilitySettlementIdentity(
  ctx: ResolveContext, op: Operation, instructionId: string, requested: unknown, target?: ObjectRef,
): string {
  if (requested !== undefined) {
    if (!id(requested)) throw new TypeError('settlementId must be a non-empty string');
    return requested;
  }
  const scoped = ctx.linked('__settlement') ?? ctx.linked('settlement') ?? ctx.linked('__continuous.settlement');
  if (typeof scoped === 'string' && id(scoped) && scoped !== String(ctx.linked('__settlement'))) return scoped;
  return `${op}:${instructionId}${target === undefined ? '' : `:${target.id}:${target.zoneEntryId}`}`;
}

/** Keep complete typed IR, including nested costs, targets, and unknown opcodes.
 * Structural validation never promotes an unsupported opcode to executable. */
export function grantedAbilities(value: unknown): readonly Ability[] {
  const abilities = Array.isArray(value) ? value : [value];
  if (!abilities.length) throw new TypeError('An ability grant must not be empty');
  const validation = validateCardProgram({ canonicalCardId: 'ability-grant', rulesetVersion: 'core-1.5',
    status: 'executable', sourceText: '[granted ability]', abilities });
  if (!validation.ok) throw new TypeError(`Invalid granted ability: ${JSON.stringify(validation.issues)}`);
  return validation.value.abilities;
}

export function ignoredKeywords(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.length || !value.every(id)) throw new TypeError('ignores requires keyword ids');
  return value;
}

export function abilityArgsSchema(op: Operation): Schema<AbilityInstructionArgs> {
  const parse = (value: unknown): AbilityInstructionArgs => {
    const args = fields(value);
    const allowed = ['target', 'pick', 'objects', 'filter', 'choose', 'duration', 'linkKey', 'settlementId',
      ...(op === 'continuous.grant-ability' ? ['ability', 'abilities'] : ['ignores', 'operation', 'players'])];
    for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new TypeError(`Unknown ${op} argument: ${key}`);
    if (['target', 'pick', 'objects', 'filter', 'choose'].filter(key => args[key] !== undefined).length > 1) {
      throw new TypeError(`${op} accepts one object selector`);
    }
    if (op === 'continuous.grant-ability') {
      if ((args.ability === undefined) === (args.abilities === undefined)) throw new TypeError('Supply ability or abilities');
      const body = args.ability ?? args.abilities;
      if (!expression(body)) grantedAbilities(body);
    } else {
      for (const key of ['ignores', 'operation', 'players']) if (args[key] === undefined) throw new TypeError(`Missing ${key}`);
      if (!expression(args.ignores)) ignoredKeywords(args.ignores);
    }
    return args;
  };
  return { parse, safeParse(value) {
    try { return { success: true, data: parse(value) }; }
    catch (error) { return { success: false, error }; }
  } };
}

function currentRefs(ctx: ResolveContext, refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  return refs.filter(item => {
    if (!ref(item)) throw new TypeError('Invalid ability target reference');
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    const object = ctx.object(item);
    return object !== null && sameRef(object.ref, item) && (object.zone === 'board' || object.zone === 'rune-zone');
  });
}

function selection(ctx: ResolveContext, args: AbilityInstructionArgs): readonly ObjectRef[] | 'impossible' {
  if (args.target !== undefined || args.pick !== undefined) {
    const target = evaluate(ctx, args.target ?? args.pick);
    if (!id(target)) throw new TypeError('target/pick requires an id');
    return currentRefs(ctx, args.target !== undefined ? ctx.targets(target) : ctx.picks(target).filter(ref));
  }
  if (args.filter !== undefined || args.choose !== undefined) {
    const choose = args.choose === undefined ? undefined : fields(evaluate(ctx, args.choose));
    const filter = fields(evaluate(ctx, choose?.filter ?? args.filter ?? {})) as ObjectFilter;
    const options = currentRefs(ctx, ctx.query(filter).map(object => object.ref))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.zoneEntryId - b.zoneEntryId);
    if (!choose) return options;
    if (Object.keys(choose).some(key => !['id', 'filter', 'min', 'max', 'chooser', 'visibility', 'prompt'].includes(key))) {
      throw new TypeError('Unknown ability choice field');
    }
    const max = choose.max ?? 1, min = choose.min ?? max;
    if (!id(choose.id) || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) ||
      (min as number) < 0 || (max as number) < (min as number)) throw new TypeError('Invalid ability choice bounds');
    if (choose.chooser !== undefined && !id(choose.chooser) || choose.prompt !== undefined && !id(choose.prompt)) {
      throw new TypeError('Invalid ability choice metadata');
    }
    const visibility = choose.visibility ?? 'public';
    if (visibility !== 'public' && visibility !== 'chooser-only' && !(Array.isArray(visibility) && visibility.length && visibility.every(id))) {
      throw new TypeError('Invalid ability choice visibility');
    }
    if (!options.length && (min as number) > 0) return 'impossible';
    const upper = Math.min(max as number, options.length), lower = Math.min(min as number, upper);
    if (!upper) return [];
    const answer = ctx.choose<readonly ObjectRef[]>({ id: choose.id, type: 'select-objects',
      chooser: (choose.chooser ?? ctx.controller) as string, visibility, options, min: lower, max: upper,
      ...(choose.prompt === undefined ? {} : { prompt: choose.prompt as string }) });
    if (!Array.isArray(answer) || answer.length < lower || answer.length > upper ||
      answer.some((item, index) => !ref(item) || !options.some(option => sameRef(item, option)) ||
        answer.slice(0, index).some(other => sameRef(item, other)))) throw new TypeError('Invalid ability choice answer');
    return answer;
  }
  if (args.objects === undefined) return currentRefs(ctx, [ctx.source.ref]);
  const objects = evaluate(ctx, args.objects);
  if (Array.isArray(objects)) return currentRefs(ctx, objects as ObjectRef[]);
  if (ref(objects)) return currentRefs(ctx, [objects]);
  const descriptor = fields(objects);
  const keys = descriptor.kind === 'source' ? ['kind'] : descriptor.kind === 'target' || descriptor.kind === 'pick'
    ? ['kind', 'id'] : descriptor.kind === 'query' ? ['kind', 'filter']
      : descriptor.kind === 'choose' ? ['kind', 'id', 'filter', 'min', 'max', 'chooser', 'visibility', 'prompt'] : [];
  if (!keys.length || Object.keys(descriptor).some(key => !keys.includes(key))) throw new TypeError('Unknown ability object selection field');
  switch (descriptor.kind) {
    case 'source': return currentRefs(ctx, [ctx.source.ref]);
    case 'target': return selection(ctx, { target: descriptor.id });
    case 'pick': return selection(ctx, { pick: descriptor.id });
    case 'query': return selection(ctx, { filter: descriptor.filter });
    case 'choose': {
      const { kind: _kind, ...choose } = descriptor;
      return selection(ctx, { choose });
    }
    default: throw new TypeError('Unknown ability object selection');
  }
}

/** Only records layer registrations; ChainEngine owns execution and rollback. */
export function executeAbilityInstruction(op: Operation, ctx: ResolveContext, args: AbilityInstructionArgs): InstructionResult {
  const duration = evaluate(ctx, args.duration ?? 'permanent');
  if (!isDurationAlias(duration)) throw new TypeError('Unknown ability grant duration');
  const linkKey = evaluate(ctx, args.linkKey ?? (op === 'continuous.grant-ability' ? 'granted' : 'ignored'));
  const requested = args.settlementId === undefined ? undefined : evaluate(ctx, args.settlementId);
  if (!id(linkKey) || requested !== undefined && !id(requested)) throw new TypeError('Invalid ability registration id');
  let effect: Fields;
  if (op === 'continuous.grant-ability') {
    effect = { kind: op, abilities: asValue(grantedAbilities(evaluate(ctx, args.ability ?? args.abilities))) };
  } else {
    const operation = evaluate(ctx, args.operation), players = evaluate(ctx, args.players);
    if (!id(operation) || !(id(players) || Array.isArray(players) && players.length && players.every(id))) {
      throw new TypeError('Ignoring an ability requires an operation and players');
    }
    // A resolved "you" effect refers to the resolving controller even after
    // the spell leaves its zone. Passive scopes are kept symbolic by the
    // static binder and follow their live source instead.
    const resolvedPlayers = ['controller', 'self', 'you'].includes(String(players)) ? [ctx.controller] : players;
    effect = { kind: op, ignores: ignoredKeywords(evaluate(ctx, args.ignores)), operation, players: resolvedPlayers };
  }
  const refs = selection(ctx, args);
  if (refs !== 'impossible' && !refs.length && args.filter === undefined && args.choose === undefined) {
    return { status: 'ignored', reason: 'mistargeted' };
  }
  const objects: Value[] = [];
  if (refs !== 'impossible') for (const [index, object] of refs.entries()) {
    const snapshot = ctx.object(object);
    if (!snapshot) continue;
    const target = { ref: object, snapshot };
    const settlement = abilitySettlementIdentity(ctx, op, String(args.instructionId ?? linkKey), requested, object);
    ctx.addContinuous({ id: effectId(op, ctx.source.ref, target, String(index), settlement), layer: 'ability',
      source: ctx.source.ref, filter: { ...targetFilter(target), zone: snapshot.zone },
      effect: asValue(effect) as ContinuousEffectSpec['effect'] }, resolveContinuousDuration(duration, ctx.source.ref));
    objects.push({ id: object.id, zoneEntryId: object.zoneEntryId });
  }
  const linkedValues = { [linkKey]: { count: objects.length, objects }, [`${linkKey}.count`]: objects.length, [`${linkKey}.objects`]: objects };
  for (const [key, value] of Object.entries(linkedValues)) ctx.link(key, value);
  if (refs === 'impossible') return { status: 'negated', reason: 'impossible', events: [] };
  if (!objects.length) return { status: 'negated', reason: 'skipped', events: [] };
  return { status: 'executed', events: [], linkedValues };
}
