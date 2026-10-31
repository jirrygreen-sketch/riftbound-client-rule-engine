import type { ActivatedAbility, CardProgram, Condition, Instruction, Restriction } from '@riftbound/card-dsl';
import type { ChainDraft, ChainEngine } from '../chain/engine.js';
import type { ObjectSnapshot, PlayerId } from '../effects/contract.js';
import goldTokenProgram from '../../../card-dsl/dist/cards/sfd/gold.js';
import { assessCostPayment } from '../cost/payment.js';
import { finalizeCostPlan, type CostDiscountSources } from '../cost/discounts/index.js';
import { queryTargetCandidates, type TargetRequirement } from '../target/target-plan.js';
import { restrictions as ruleRestrictions } from '../layers/rules/query.js';
import { staticCostSources } from './static-adapters/capabilities.js';
import { ProgramBindingError, judgeRequired } from './errors.js';
import { translateInstructionTargets } from './filters.js';
import { expandProgram } from './keywords.js';
import { ProgramRegistry } from './registry.js';
import { bindProgramCost } from './cost-adapters/index.js';
import { translateRestriction } from './play.js';

function activationList(registry: ProgramRegistry, source: ObjectSnapshot): ActivatedAbility[] {
  const program = activationProgram(registry, source);
  const expanded = expandProgram(program, source);
  return expanded.abilities.filter((ability): ability is ActivatedAbility => ability.kind === 'activated');
}

function translateActivationRestriction(
  restriction: Restriction | undefined,
  source: ObjectSnapshot,
  controller: PlayerId,
  id: string,
): readonly Condition[] | undefined {
  if (!restriction) return undefined;
  if (restriction.kind === 'use-only-while-source-at-battlefield' || restriction.kind === 'use-only-while-at-battlefield') {
    if (restriction.condition !== undefined || restriction.value !== undefined) {
      judgeRequired(`Activation restriction ${id} combines a location restriction with another rule`);
    }
    if (source.location?.type !== 'battlefield') return [{ kind: 'never' }];
    // CR 377.2.b requires the condition to hold when the ability is used.
    // Chain re-evaluates this condition against the current Board at Finalize,
    // before payment. Require the exact source incarnation to remain on the
    // Board under the activator, then negate a live query for that source at
    // the activator's Base. A Board object is at its Base or a Battlefield
    // (CR 107.1.c / 146.1), so the latter distinguishes Battlefield from Base.
    // The queries are live rather than always/never snapshots, and the
    // zone-entry identity prevents a later incarnation from satisfying this
    // activation's restriction.
    return [{
      kind: 'all',
      conditions: [
        {
          kind: 'compare',
          left: {
            kind: 'count',
            subject: 'objects',
            filter: {
              objectId: source.ref.id,
              zoneEntryId: source.ref.zoneEntryId,
              zone: 'board',
              controller,
            },
          },
          operator: 'gte',
          right: { kind: 'constant', value: 1 },
        },
        {
          kind: 'not',
          condition: {
            kind: 'compare',
            left: {
              kind: 'count',
              subject: 'objects',
              filter: {
                objectId: source.ref.id,
                zoneEntryId: source.ref.zoneEntryId,
                zone: 'board',
                location: { type: 'base', player: controller },
              },
            },
            operator: 'gte',
            right: { kind: 'constant', value: 1 },
          },
        },
      ],
    }];
  }
  return translateRestriction(restriction, id);
}

export function activationAbilities(registry: ProgramRegistry, source: ObjectSnapshot): readonly ActivatedAbility[] {
  return activationList(registry, source);
}

/** Runtime-created Gold has no deck row; resolve its authored canonical program. */
function activationProgram(registry: ProgramRegistry, source: ObjectSnapshot): CardProgram {
  if (source.cardId === goldTokenProgram.canonicalCardId && source.types.some(type => type.toLowerCase() === 'gear') &&
      source.energy === null && source.power === null) {
    return new ProgramRegistry([goldTokenProgram]).get(source.cardId);
  }
  return registry.get(source.cardId);
}

/**
 * Build an activation draft without consuming the process-local sequence used
 * by real commands. Projection may inspect cost/target viability repeatedly;
 * those reads must never alter a later command's deterministic journal id.
 */
export function inspectActivate(
  registry: ProgramRegistry,
  source: ObjectSnapshot,
  controller: PlayerId,
  abilityIndex: number,
  draftId: string,
): ChainDraft {
  const abilities = activationList(registry, source);
  const ability = abilities[abilityIndex];
  if (!ability) throw new ProgramBindingError('unbound-ability', `No activated ability ${abilityIndex} on ${source.cardId ?? source.ref.id}`);
  const body = translateInstructionTargets(ability.body) as readonly Instruction[];
  const program = activationProgram(registry, source);
  const cost = bindProgramCost({ program, source, mode: 'activate', id: draftId, ability });
  if (!cost) judgeRequired(`Activated ability ${draftId} has no cost plan`);
  const restrictions = translateActivationRestriction(ability.restriction, source, controller, source.cardId ?? source.ref.id);
  return { id: draftId, controller, source, kind: 'activated', speed: ability.timing, body,
    cost: { id: `cost:${draftId}`, ...cost.plan }, ...(restrictions ? { restrictions } : {}) };
}

export function describeActivate(registry: ProgramRegistry, source: ObjectSnapshot, controller: PlayerId, abilityIndex = 0): ChainDraft {
  const id = `activate:${source.ref.id}:${source.ref.zoneEntryId}:${controller}:${++activationSequence}`;
  return inspectActivate(registry, source, controller, abilityIndex, id);
}
let activationSequence = 0;

export interface InspectActivationInput {
  readonly engine: ChainEngine;
  readonly registry: ProgramRegistry;
  readonly controller: PlayerId;
  readonly sources: readonly ObjectSnapshot[];
  /** Payment accepts only Reaction Add abilities (CR 430.3). */
  readonly window: 'priority' | 'payment';
}

export interface InspectedActivation {
  readonly source: ObjectSnapshot;
  readonly abilityIndex: number;
  readonly ability: ActivatedAbility;
  readonly draft: ChainDraft;
  readonly label: string;
  readonly reaction: boolean;
  readonly add: boolean;
}

class ProjectionChoiceRequired extends Error {
  readonly name = 'ProjectionChoiceRequired';
}

function hasAddPrimitive(body: readonly Instruction[]): boolean {
  for (const instruction of body) {
    if (instruction.op === 'effect.resources') return true;
    for (const key of ['body', 'modes'] as const) {
      const value = instruction.args[key];
      if ((value?.kind === 'constant' || value?.kind === 'literal') && Array.isArray(value.value) &&
          value.value.some(entry => entry !== null && typeof entry === 'object' &&
            (key === 'modes'
              ? Array.isArray((entry as { readonly body?: unknown }).body) &&
                hasAddPrimitive((entry as { readonly body: readonly Instruction[] }).body)
              : isInstruction(entry) && hasAddPrimitive([entry])))) return true;
    }
  }
  return false;
}

function isInstruction(value: unknown): value is Instruction {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as { readonly id?: unknown }).id === 'string' &&
    typeof (value as { readonly op?: unknown }).op === 'string' &&
    (value as { readonly args?: unknown }).args !== null && typeof (value as { readonly args?: unknown }).args === 'object';
}

function instructionTargets(body: readonly Instruction[]): readonly TargetRequirement[] {
  const targets: TargetRequirement[] = [];
  const visit = (instructions: readonly Instruction[]): void => {
    for (const instruction of instructions) {
      targets.push(...(instruction.targets ?? []) as readonly TargetRequirement[]);
      for (const key of ['body', 'modes'] as const) {
        const value = instruction.args[key];
        if ((value?.kind !== 'constant' && value?.kind !== 'literal') || !Array.isArray(value.value)) continue;
        for (const entry of value.value) {
          if (key === 'body' && isInstruction(entry)) visit([entry]);
          if (key === 'modes' && entry !== null && typeof entry === 'object' &&
              Array.isArray((entry as { readonly body?: unknown }).body)) {
            visit((entry as { readonly body: readonly Instruction[] }).body);
          }
        }
      }
    }
  };
  visit(body);
  return targets;
}

function targetRequirementsAvailable(engine: ChainEngine,
  source: ObjectSnapshot, controller: PlayerId, body: readonly Instruction[]): boolean {
  return engine.withStableLayers(() => {
    const context = engine.pipeline.host.context(source, controller, 'chain-item-finalize');
    for (const requirement of instructionTargets(body)) {
      const candidates = queryTargetCandidates(context, requirement, {
        ruleRegistry: engine.layers.registry,
        rulePlayer: controller,
        isLegal: snapshot => ruleRestrictions(engine.layers.registry, 'target', snapshot.ref, snapshot, controller).length === 0 &&
          ruleRestrictions(engine.layers.registry, 'choose-as-target', snapshot.ref, snapshot, controller).length === 0,
      });
      const selection = requirement.selection ?? 'one';
      const minimum = requirement.min ?? (selection === 'one' ? 1 : 0);
      if (candidates.length < minimum) return false;
    }
    return true;
  });
}

function activationCostAvailable(engine: ChainEngine, source: ObjectSnapshot, draft: ChainDraft,
  controller: PlayerId): boolean {
  if (draft.cost === undefined) return false;
  const costInput = draft.cost;
  return engine.withStableLayers(() => {
    const raw = engine.pipeline.host.context(source, controller, 'chain-item-finalize');
    const context = new Proxy(raw, { get(target, key) {
      if (key === 'choose') return (): never => { throw new ProjectionChoiceRequired('Projection cannot answer Finalize choices'); };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const sources: CostDiscountSources = {
      statics: staticCostSources(engine),
      continuous: engine.layers.registry.list().filter(entry =>
        (entry.effect.effect as { readonly costModification?: unknown }).costModification !== true),
      finalizedPlaysThisTurn: engine.finalizedCardPlaysThisTurn(),
      originZone: source.zone,
      purpose: 'activate',
    };
    try {
      const plan = finalizeCostPlan(context, costInput, sources);
      return assessCostPayment(context, plan).payable;
    } catch (error) {
      if (error instanceof ProjectionChoiceRequired) return false;
      return false;
    }
  });
}

/**
 * Mirror ChainEngine.execute's continuous rule gate without adding state.
 * The restriction query is private to the engine, so the production surface
 * exposes this read-only candidate query at the same rules seam.
 */
export function activationIsRestricted(engine: ChainEngine, draft: ChainDraft, speed: ChainDraft['speed'] = draft.speed): boolean {
  const actionNames = new Set<string>([speed ?? 'normal', 'play', 'play-card']);
  if (draft.kind === 'activated') {
    actionNames.add('activate');
    actionNames.add('activate-ability');
  }
  return [...actionNames].some(action => ruleRestrictions(
    engine.layers.registry,
    action,
    draft.source.ref,
    draft.source,
    draft.controller,
  ).length > 0);
}

function activationLabel(program: CardProgram, body: readonly Instruction[]): string {
  if (body.some(instruction => instruction.op === 'effect.attach') &&
      program.abilities.some(ability => ability.kind === 'keyword' && ability.keyword.toLowerCase() === 'equip')) {
    return 'Equip';
  }
  const sourceText = program.sourceText.trim();
  const firstLine = sourceText.split(/\r?\n/u).find(line => line.trim().length > 0) ?? sourceText;
  return firstLine.slice(0, 512);
}

/** Read-only production candidate query shared by server projections. */
export function inspectActivations(input: InspectActivationInput): readonly InspectedActivation[] {
  const { engine, registry, controller, sources, window } = input;
  const inspected: InspectedActivation[] = [];
  for (const source of sources) {
    if (source.controller !== controller || source.faceDown ||
        (source.zone !== 'board' && !source.types.some(type => type.toLowerCase() === 'legend'))) continue;
    let abilities: readonly ActivatedAbility[];
    let program: CardProgram;
    try {
      program = activationProgram(registry, source);
      abilities = activationAbilities(registry, source);
    } catch { continue; }
    for (const [abilityIndex, ability] of abilities.entries()) {
      try {
        const reaction = ability.timing === 'reaction';
        const draft = inspectActivate(registry, source, controller, abilityIndex,
          `inspect:${source.ref.id}:${source.ref.zoneEntryId}:${controller}:${abilityIndex}`);
        const add = hasAddPrimitive(draft.body);
        if (window === 'payment' && (!reaction || !add)) continue;
        if (window === 'priority' && !engine.canAct(controller, ability.timing, source.ref, source)) continue;
        if (activationIsRestricted(engine, draft, ability.timing)) continue;
        if (!targetRequirementsAvailable(engine, source, controller, draft.body)) continue;
        if (!activationCostAvailable(engine, source, draft, controller)) continue;
        inspected.push(Object.freeze({ source, abilityIndex, ability, draft,
          label: activationLabel(program, draft.body), reaction, add }));
      } catch {
        // An individual unbound or judge-required ability must not suppress
        // unrelated executable activations in the same viewer projection.
        continue;
      }
    }
  }
  return Object.freeze(inspected);
}
