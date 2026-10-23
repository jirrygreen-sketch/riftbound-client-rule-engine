import type { Ability, CardProgram, Condition, CostSpec, Instruction, PlayAbility, Requirement, Restriction } from '@riftbound/card-dsl';
import type { ChainDraft } from '../chain/engine.js';
import type { GameAction, ObjectSnapshot } from '../effects/contract.js';
import { findHiddenCard, playedFromHidden } from '../zones/hidden/index.js';
import { getTokenDefinition } from '../effects/tokens/definitions.js';
import { ProgramBindingError, judgeRequired } from './errors.js';
import { bindProgramCost } from './cost-adapters/index.js';
import { translateInstructionTargets } from './filters.js';
import { abilitySpeed, expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';

export { translateCost } from './cost-adapters/index.js';

const CONDITION_KINDS = new Set(['always', 'never', 'compare', 'all', 'any', 'not', 'expression']);
type PlaySpeed = Exclude<ChainDraft['speed'], undefined>;
const PLAY_SPEED_RANK: Readonly<Record<PlaySpeed, number>> = { normal: 0, action: 1, reaction: 2 };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Speed keywords may expand to a source-bound `continuous.timing` permission
 * instead of leaving a literal keyword on the card. Quick-Draw is the first
 * production example (CR 819.1.b/819.1.c): its Reaction permission covers
 * playing the Gear and is likewise carried by the attach trigger. Only the
 * play permission on this exact source can affect describePlay's draft speed.
 */
function grantedPlaySpeed(abilities: readonly Ability[], canonicalCardId: string): PlaySpeed | undefined {
  let granted: PlaySpeed | undefined;
  for (const ability of abilities) {
    if (ability.kind !== 'static' || ability.effect.kind !== 'continuous.timing') continue;
    const effect = ability.effect as unknown as Readonly<Record<string, unknown>>;
    if (effect.permissions !== undefined &&
        (!Array.isArray(effect.permissions) || !effect.permissions.every(permission => typeof permission === 'string'))) {
      throw new ProgramBindingError('judge-required', `Play timing for ${canonicalCardId} has a malformed permissions list`);
    }
    if (!Array.isArray(effect.permissions) || !effect.permissions.includes('play')) continue;
    if (effect.scope !== 'source') continue;
    if (!isRecord(effect.source) || effect.source.canonicalCardId !== canonicalCardId) continue;

    const value = effect.value;
    if (!isRecord(value) || !['constant', 'literal'].includes(String(value.kind)) || typeof value.value !== 'string') {
      throw new ProgramBindingError('judge-required', `Play timing for ${canonicalCardId} must be a constant speed`);
    }
    const speed = value.value.toLowerCase();
    if (!Object.hasOwn(PLAY_SPEED_RANK, speed)) {
      throw new ProgramBindingError('judge-required', `Play timing for ${canonicalCardId} has unknown speed ${value.value}`);
    }
    const normalized = speed as PlaySpeed;
    if (granted === undefined || PLAY_SPEED_RANK[normalized] > PLAY_SPEED_RANK[granted]) granted = normalized;
  }
  return granted;
}

export function translateLegalityCondition(rule: Requirement | Restriction, id: string, label: 'requirement' | 'restriction'): Condition {
  if (rule.condition !== undefined) {
    if (rule.value !== undefined) judgeRequired(`${label} ${id} combines condition and value without an adapter`);
    return rule.condition;
  }
  if (CONDITION_KINDS.has(rule.kind) && rule.value === undefined) return rule as unknown as Condition;
  judgeRequired(`${label} ${id} kind ${rule.kind} needs a rules adapter`);
}

export function translateRequirements(requirements: readonly Requirement[] | undefined, id: string): readonly Condition[] | undefined {
  if (!requirements?.length) return undefined;
  return requirements.map(requirement => translateLegalityCondition(requirement, id, 'requirement'));
}

export function translateRestriction(restriction: Restriction | undefined, id: string): readonly Condition[] | undefined {
  if (!restriction) return undefined;
  return [translateLegalityCondition(restriction, id, 'restriction')];
}

function cardKind(source: ObjectSnapshot): ChainDraft['kind'] {
  const types = source.types.map(type => type.toLowerCase());
  const kind = (['spell', 'unit', 'gear'] as const).find(type => types.includes(type));
  if (!kind) throw new ProgramBindingError('invalid-program', `Card ${source.ref.id} has no playable spell/unit/gear type`);
  return kind;
}

function validateSurface(body: readonly Instruction[]): void {
  const visit = (instructions: readonly Instruction[], nested = false) => {
    for (const instruction of instructions) {
      if (nested && instruction.targets?.length) judgeRequired('Nested instruction targets require a target lifecycle adapter');
      if (instruction.op === 'choice.mode') judgeRequired('Mode choices require a Finalize/Resolve choice-plan adapter');
      for (const expression of Object.values(instruction.args ?? {})) {
        if (expression && typeof expression === 'object' && ['constant', 'literal'].includes((expression as any).kind)) {
          const value = (expression as any).value;
          if (Array.isArray(value)) visit(value as Instruction[], true);
          if (value && typeof value === 'object' && Array.isArray(value.body)) visit(value.body as Instruction[], true);
        }
      }
    }
  };
  visit(body);
}

function constantExpressionValue(expression: Instruction['args'][string] | undefined): unknown {
  return expression !== undefined && (expression.kind === 'constant' || expression.kind === 'literal')
    ? expression.value : undefined;
}

/** CR 811.1.d.5 changes a destination only for a Unit that is actually Played. */
function tokenPlayUsesHiddenBattlefield(args: Instruction['args']): boolean {
  const mode = constantExpressionValue(args.mode);
  if (mode === undefined) {
    if (args.mode !== undefined) judgeRequired('A dynamic effect.token mode requires Hidden battlefield adjudication');
    return false;
  }
  if (mode !== 'play') return false;
  const tokenId = constantExpressionValue(args.token);
  const definition = typeof tokenId === 'string' ? getTokenDefinition(tokenId) : undefined;
  if (definition?.abilityBinding === 'blocked') {
    judgeRequired(`Hidden token ${tokenId} has no executable program adapter`);
  }
  if (definition === undefined) {
    judgeRequired(`Hidden token ${String(tokenId ?? '<dynamic>')} has no adjudicated definition`);
  }
  const types = definition.spec.types.map(type => type.toLowerCase());
  if (types.includes('unit')) return true;
  if (!types.includes('gear')) return false;
  const deploy = definition.spec.keywords?.some(keyword => keyword.id.toLowerCase() === 'deploy') === true;
  if (deploy) return true;
  // Preserve the previous fail-closed boundary for an incomplete instruction;
  // an authored non-Deploy Gear destination (such as Wages of Pain's Base)
  // remains unchanged instead of being adjudicated as a battlefield Play.
  if (!['location', 'locations', 'target', 'pick'].some(key => Object.hasOwn(args, key))) {
    judgeRequired(`Hidden Gear token ${tokenId} has no explicit Play destination`);
  }
  return false;
}

function exactObjectFilterType(filter: object, expected: 'unit' | 'gear'): boolean {
  const raw = filter as Readonly<Record<string, unknown>>;
  const types = raw.types ?? raw.type;
  return types === expected || Array.isArray(types) && types.length === 1 && types[0] === expected;
}

/**
 * CR 811.1.d.5 also applies when an effect Play is statically known to select
 * a Unit. Picks/targets are the public object-selection forms this binder can
 * prove before runtime; all other forms remain fail-closed.
 */
function effectPlayUsesHiddenBattlefield(instruction: Instruction): boolean {
  for (const key of ['target', 'pick'] as const) {
    const sourceId = constantExpressionValue(instruction.args[key]);
    if (typeof sourceId !== 'string') continue;
    const selections = key === 'target' ? instruction.targets : instruction.picks;
    const selected = selections?.find(candidate => candidate.id === sourceId);
    if (selected === undefined) continue;
    if (selected.filter === undefined) {
      judgeRequired(`Hidden effect.play ${sourceId} does not identify a Unit`);
    }
    if (exactObjectFilterType(selected.filter, 'unit')) return true;
    if (exactObjectFilterType(selected.filter, 'gear')) return false;
    judgeRequired(`Hidden effect.play ${sourceId} does not identify a Unit`);
  }
  if (instruction.args.target !== undefined || instruction.args.pick !== undefined || instruction.args.object !== undefined) {
    judgeRequired('Hidden effect.play requires a statically identifiable Unit selection');
  }
  return false;
}

/**
 * CR 811.1.d restricts target-bearing choices to the Hidden Battlefield. CR
 * 811.1.d.5 limits the Play destination override to Units (plus the existing
 * Deploy-Gear path); other instructions keep their authored behavior (811.2).
 */
function scopeHiddenBody(instructions: readonly Instruction[], battlefieldId: string,
  nested = false): readonly Instruction[] {
  const location = { type: 'battlefield' as const, id: battlefieldId };
  return instructions.map(instruction => {
    if (nested && instruction.targets?.length) {
      judgeRequired('Nested instruction targets require a target lifecycle adapter');
    }
    const args = Object.fromEntries(Object.entries(instruction.args ?? {}).map(([key, expression]) => {
      if (expression.kind !== 'constant' && expression.kind !== 'literal') return [key, expression];
      if (key === 'modes' && Array.isArray(expression.value) && expression.value.every(mode =>
        isRecord(mode) && Array.isArray(mode.body))) {
        return [key, { ...expression, value: expression.value.map(mode => ({ ...mode,
          body: scopeHiddenBody((mode as { readonly body: Instruction[] }).body, battlefieldId, true) })) }];
      }
      if (Array.isArray(expression.value) && isInstructionArray(expression.value)) {
        return [key, { ...expression, value: scopeHiddenBody(expression.value, battlefieldId, true) }];
      }
      if (isRecord(expression.value) && Array.isArray(expression.value.body)) {
        return [key, { ...expression, value: { ...expression.value,
          body: scopeHiddenBody(expression.value.body as Instruction[], battlefieldId, true) } }];
      }
      return [key, expression];
    }));
    if (instruction.op === 'effect.token' && tokenPlayUsesHiddenBattlefield(args)) {
      delete args.location;
      delete args.locations;
      delete args.target;
      delete args.pick;
      delete args.choiceId;
      args.location = { kind: 'constant', value: location };
    }
    if (instruction.op === 'effect.play' && effectPlayUsesHiddenBattlefield(instruction)) {
      args.location = { kind: 'constant', value: location };
    }
    return {
      ...instruction,
      args,
      ...(instruction.targets === undefined ? {} : {
        targets: instruction.targets.map(requirement => {
          if (!canScopeHiddenTarget(requirement) || explicitTargetLocationRestriction(requirement.filter)) {
            return requirement;
          }
          const filterLocation = (requirement.filter as Readonly<Record<string, unknown>>).location;
          const genericFilterLocation = filterLocation === 'battlefield' ||
            isRecord(filterLocation) && filterLocation.type === 'battlefield' && filterLocation.id === undefined;
          return {
            ...requirement,
            ...(genericFilterLocation ? { filter: { ...requirement.filter, location } } : {}),
            location,
          };
        }),
      }),
    };
  });
}

function isInstructionArray(value: readonly unknown[]): value is readonly Instruction[] {
  return value.every(item => isRecord(item) && typeof item.id === 'string' && typeof item.op === 'string' &&
    isRecord(item.args));
}

function explicitTargetLocationRestriction(filter: object): boolean {
  const value = filter as Readonly<Record<string, unknown>>;
  const location = value.location;
  const genericLocation = location === 'battlefield' ||
    isRecord(location) && location.type === 'battlefield' && location.id === undefined;
  return location !== undefined && !genericLocation || value.locationRelation !== undefined ||
    value.differentLocationFrom !== undefined ||
    isRecord(value.relation) && value.relation.relation === 'different-location';
}

function canScopeHiddenTarget(requirement: { readonly location?: unknown }): boolean {
  const location = requirement.location;
  return location === undefined || location === 'battlefield' ||
    isRecord(location) && location.type === 'battlefield' && location.id === undefined;
}

function repeatAdditionalCost(cost: CostSpec | undefined): CostSpec | undefined {
  if (cost === undefined) return undefined;
  const raw = cost as CostSpec & { readonly costs?: readonly Readonly<Record<string, unknown>>[] };
  const kind = raw.kind?.replace(/^cost\./, '');
  if (!['additional', 'additional-cost'].includes(kind ?? '') && raw.costs === undefined && raw.keyword !== 'repeat') return undefined;
  const cleanPayment = (payment: unknown): unknown => {
    if (payment === null || typeof payment !== 'object' || Array.isArray(payment)) return payment;
    const { choice: _choice, ...rest } = payment as Readonly<Record<string, unknown>>;
    return rest;
  };
  // The binder uses the authored discriminator to select the additional-cost
  // branch, then normalizes the resulting plan component to kind=repeat.
  const clean: Record<string, unknown> = { ...structuredClone(raw), kind: raw.kind ?? 'additional', keyword: 'repeat', optional: true };
  delete clean.stage;
  if (Array.isArray(clean.payments)) clean.payments = clean.payments.map(cleanPayment);
  if (Array.isArray(clean.costs)) {
    clean.costs = clean.costs.map(entry => {
      const nested = { ...structuredClone(entry), keyword: 'repeat', optional: true };
      delete nested.stage;
      if (Array.isArray(nested.payments)) nested.payments = nested.payments.map(cleanPayment);
      return nested;
    });
  }
  return clean as unknown as CostSpec;
}

function hasRepeatDeclaration(program: CardProgram, source: ObjectSnapshot): boolean {
  return /\[repeat\]/i.test(program.sourceText) || source.keywords.some(keyword => keyword.id.toLowerCase().replace(/[\s_-]+/g, '') === 'repeat');
}

const SELF_COST_KINDS = new Set(['continuous.cost-modification', 'cost.modify']);
const hiddenPlayDrafts = new WeakMap<object, readonly Extract<Ability, { kind: 'static' }>[]>();
let activeHiddenSource: { hidden(): import('../zones/hidden/index.js').HiddenState } | undefined;

/** Scope Hidden context across the two-argument ProgramBinding adapter. */
export function withHiddenSource<T>(source: { hidden(): import('../zones/hidden/index.js').HiddenState } | undefined,
  run: () => T): T {
  const previous = activeHiddenSource;
  activeHiddenSource = source;
  try { return run(); } finally { activeHiddenSource = previous; }
}

/** Trusted metadata produced from the same expansion that authors Hide. */
export function describeDraftHasHiddenPermission(draft: ChainDraft): boolean {
  return hiddenPlayDrafts.has(draft);
}

/** The exact unconditional Hidden capabilities already expanded for this draft. */
export function describeDraftHiddenAbilities(draft: ChainDraft): readonly Extract<Ability, { kind: 'static' }>[] {
  return hiddenPlayDrafts.get(draft) ?? [];
}

export function describePlay(
  registry: ProgramRegistry,
  action: Extract<GameAction, { type: 'play' }>,
  source: ObjectSnapshot,
  hiddenSource?: { hidden(): import('../zones/hidden/index.js').HiddenState },
): ChainDraft {
  const program = registry.get(source.cardId);
  const kind = cardKind(source);
  const expanded = expandProgram(program, source);
  const hiddenAbilities = expanded.abilities.filter((ability): ability is Extract<Ability, { kind: 'static' }> =>
    ability.kind === 'static' && ability.effect.kind === 'cost.hidden' && ability.condition === undefined);
  if (expanded.abilities.some(ability => ability.kind === 'static' && ability.effect.kind === 'cost.hidden' &&
      ability.condition !== undefined)) {
    judgeRequired('Conditional Hidden permission requires authoritative condition evaluation');
  }
  const ability = expanded.abilities.find((candidate): candidate is PlayAbility => candidate.kind === 'play');
  const intrinsicSpeed = abilitySpeed(expanded.abilities, source);
  const grantedSpeed = grantedPlaySpeed(expanded.abilities, program.canonicalCardId);
  let speed = grantedSpeed !== undefined && PLAY_SPEED_RANK[grantedSpeed] > PLAY_SPEED_RANK[intrinsicSpeed]
    ? grantedSpeed : intrinsicSpeed;
  const translatedBody = translateInstructionTargets(ability?.body ?? []) as readonly Instruction[];
  validateSurface(translatedBody);
  const hiddenState = (hiddenSource ?? activeHiddenSource)?.hidden();
  const retained = hiddenState === undefined ? null : playedFromHidden(hiddenState, source.ref);
  const concealed = hiddenState === undefined ? null : findHiddenCard(hiddenState, source.ref);
  const hidden = retained ?? (concealed === null ? null : {
    battlefieldId: concealed.battlefieldId,
    playedToBattlefieldId: kind === 'spell' ? null : concealed.battlefieldId,
    targetScope: { battlefieldId: concealed.battlefieldId },
  });
  if (retained === null && concealed !== null) {
    return {
      id: `hidden-play:${source.ref.id}:${source.ref.zoneEntryId}:${action.player}:${++playSequence}`,
      controller: action.player,
      source,
      kind,
      speed: 'reaction',
      body: scopeHiddenBody(translatedBody, concealed.battlefieldId),
      ...(action.location === undefined ? {} : { location: action.location }),
      cost: (() => {
        const hiddenCost = bindProgramCost({ program, source, mode: 'play', id: `hidden-cost:${source.ref.id}:${source.ref.zoneEntryId}:${action.player}`, ability, abilities: expanded.abilities });
        return { id: `cost:hidden-play:${source.ref.id}:${source.ref.zoneEntryId}`, cost: hiddenCost?.plan.cost ?? { kind: 'printed' as const },
          ...(hiddenCost?.plan ?? {}),
          baseModifications: [{ kind: 'ignore-base' as const, ignore: 'resources' as const },
            ...(hiddenCost?.plan.baseModifications ?? [])] };
      })(),
      targets: scopeHiddenBody(translatedBody, concealed.battlefieldId)
        .flatMap(instruction => (instruction.targets ?? []).map(requirement => ({ requirement }))),
    };
  }
  if (hidden !== null && (hidden.battlefieldId === '' ||
      (kind !== 'spell' && hidden.playedToBattlefieldId === null))) {
    throw new ProgramBindingError('invalid-program', `Hidden play for ${source.ref.id} has invalid battlefield provenance`);
  }
  if (hidden !== null && (kind === 'unit' || kind === 'gear') &&
      (action.location?.type !== 'battlefield' || action.location.id !== hidden.playedToBattlefieldId)) {
    throw new ProgramBindingError('judge-required', `A Hidden permanent must be played to its source Battlefield`);
  }
  const scopeBattlefield = hidden === null ? undefined : hidden.targetScope.battlefieldId;
  if (hidden !== null) speed = 'reaction';
  const id = `play:${source.ref.id}:${source.ref.zoneEntryId}:${action.player}:${++playSequence}`;
  const requirements = translateRequirements(ability?.requirements, program.canonicalCardId);
  const restrictions = translateRestriction(ability?.restriction, program.canonicalCardId);
  const repeatCost = hasRepeatDeclaration(program, source) ? repeatAdditionalCost(ability?.cost) : undefined;
  const costAbility = repeatCost === undefined ? ability : { ...ability!, cost: repeatCost };
  // The normalized component carries keyword: 'repeat', so the cost binder
  // takes its optionality from CR 820.1.b rather than from reminder prose.
  const cost = bindProgramCost({ program, source, mode: 'play', id, ability: costAbility, abilities: expanded.abilities });
  const body = scopeBattlefield === undefined ? translatedBody : scopeHiddenBody(translatedBody, scopeBattlefield);
  // A card's own "this costs ... less/more" static functions while it is
  // being played (CR 356); Board-bound statics reach Finalize separately.
  const costStatics = expanded.abilities.flatMap((candidate, index) =>
    candidate.kind === 'static' && SELF_COST_KINDS.has(String((candidate.effect as { kind?: unknown }).kind))
      ? [{ id: `program-self-cost:${source.ref.id}:${source.ref.zoneEntryId}:${index}`, source: source.ref, ability: candidate }]
      : []);
  const draft: ChainDraft = {
    id,
    controller: action.player,
    source,
    kind,
    speed,
    body,
    ...(cost ? { cost: { id: `cost:${id}`, ...cost.plan, ...(hidden === null ? {} : {
      baseModifications: [{ kind: 'ignore-base' as const, ignore: 'resources' as const }, ...(cost.plan.baseModifications ?? [])],
    }) } } : {}),
    ...(costStatics.length ? { costStatics } : {}),
    ...(requirements ? { requirements } : {}),
    ...(restrictions ? { restrictions } : {}),
    ...(action.location ? { location: action.location } : {})
  };
  if (hiddenAbilities.length > 0) hiddenPlayDrafts.set(draft, Object.freeze(hiddenAbilities));
  return draft;
}
let playSequence = 0;
