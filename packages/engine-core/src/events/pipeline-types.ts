import type { ChoiceRequest, ContractGameAction, GameAction, GameEvent, Instruction, ObjectSnapshot, PlayerId, ResolveContext, ActionOutcome } from '../effects/contract.js';
import type { TimingPointId } from './timing-points.js';
import type { TriggerSpec } from './trigger-spec.js';
import type { CostPlanInput } from '../cost/plan-types.js';
import type { TargetFinalizeOptions, TargetRequirement } from '../target/target-plan.js';

/** Internal events carry authoritative snapshots, not client supplied DTOs. */
export interface TimingEmission {
  readonly timingPoint: TimingPointId;
  readonly kind?: string;
  /** Identity of the atomic action batch that produced this emission. */
  readonly batchId?: string;
  readonly object?: ObjectSnapshot;
  readonly source?: ObjectSnapshot;
  readonly target?: ObjectSnapshot;
  /** Immutable event-role snapshot distinct from object, source, and target. */
  readonly it?: ObjectSnapshot;
  readonly player?: PlayerId;
  readonly amount?: number;
  readonly fromZone?: string;
  readonly toZone?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  /** Multiple named timings of one physical event share simultaneous ordering. */
  readonly simultaneousGroup?: string;
}
export type PipelineEvent = GameEvent & TimingEmission & { readonly action?: GameAction; readonly eventId: number };

export type TriggerRuleMode = 'additional' | 'multiply' | 'suppress';

export interface TriggerRuleContext {
  readonly registration: TriggerRegistration;
  readonly source: ObjectSnapshot;
  /** The live incarnation of the rule source, when the rule has one. */
  readonly ruleSource?: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly event: PipelineEvent;
}

/**
 * A collection-stage rule.  Rules are deliberately expressed as predicates
 * over the authoritative trigger snapshot rather than card text so unknown
 * printed semantics remain judge-required until their adapter is proven.
 */
export interface TriggerRule {
  readonly id: string;
  readonly mode: TriggerRuleMode;
  readonly source?: ObjectSnapshot;
  readonly activeZones?: readonly string[];
  readonly delayed?: boolean;
  readonly boundToIncarnation?: boolean;
  readonly amount?: number | ((context: TriggerRuleContext) => number);
  readonly matches: (context: TriggerRuleContext) => boolean;
}

export interface TriggerRegistration {
  readonly id: string;
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly spec: TriggerSpec;
  readonly body: readonly Instruction[];
  readonly optional?: boolean;
  /** Normal permanents default to Board; delayed abilities outlive their source. */
  readonly activeZones?: readonly string[];
  readonly delayed?: boolean;
  /** Parsed leading costs and choices, supplied by the card-program adapter. */
  readonly cost?: CostPlanInput;
  readonly mayAtFinalize?: boolean;
  readonly targets?: readonly { readonly requirement: TargetRequirement; readonly options?: Omit<TargetFinalizeOptions, 'isPending' | 'onTargetsFinalized' | 'onTargeted' | 'taxAdapter'> }[];
  readonly boundToIncarnation?: boolean;
  readonly expiresAt?: TimingPointId;
  /** Optional explicit cap for a once scope; omitted means one occurrence. */
  readonly maxPerScope?: number;
}
export interface TriggerSnapshot {
  readonly registration: TriggerRegistration;
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly event: PipelineEvent;
  readonly frequencyKey: string | null;
  readonly frequencyLimit?: number;
  readonly occurrence?: number;
  readonly multiplicity?: number;
  readonly batchId?: string;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

/** Structural mirror of the additive RIFT-845 event binding contract. */
export interface TriggerEventObjectBinding {
  readonly eventId: number;
  readonly role: 'it';
  readonly ref: ObjectSnapshot['ref'];
  readonly snapshot: ObjectSnapshot;
}

/**
 * Build the contract binding from the one frozen event carried by a trigger.
 * RIFT-835 owns installing this on the default Chain Finalize/Resolve context.
 */
export function triggerEventObjectBinding(snapshot: TriggerSnapshot, role: 'it'): TriggerEventObjectBinding | null {
  const event = snapshot.event;
  const object = event.it;
  if (role !== 'it' || !Number.isSafeInteger(event.eventId) || event.eventId <= 0 || object === undefined ||
      object === null || typeof object.ref !== 'object' || object.ref === null ||
      typeof object.ref.id !== 'string' || object.ref.id.length === 0 ||
      !Number.isSafeInteger(object.ref.zoneEntryId) || object.ref.zoneEntryId < 0) {
    return null;
  }
  return deepFreeze({
    eventId: event.eventId,
    role,
    ref: structuredClone(object.ref),
    snapshot: structuredClone(object),
  });
}
export interface ActionExecution {
  readonly outcome: ActionOutcome;
  readonly emissions: readonly TimingEmission[];
}

/**
 * Versioned capability for state owners that can pause a confirmed Kill before
 * the zone transition. The callback runs after the state owner has applied all
 * replacements and validated the exact source incarnation, but while the
 * source is still in its authoritative pre-transition zone.
 */
export const PIPELINE_DEATH_BOUNDARY_VERSION = 'riftbound.pipeline-death-boundary.v1' as const;

export interface PipelineDeathBoundaryContext {
  readonly batchId: string;
  readonly action: GameAction | ContractGameAction;
  readonly before: readonly ObjectSnapshot[];
  /** Frozen death timings to publish before the state owner resumes. */
  readonly emissions: readonly TimingEmission[];
}

export interface PipelineDeathBoundaryCapability {
  readonly version: typeof PIPELINE_DEATH_BOUNDARY_VERSION;
  execute(action: GameAction, boundary: (context: PipelineDeathBoundaryContext) => void): ActionExecution;
  executeContract(action: ContractGameAction, boundary: (context: PipelineDeathBoundaryContext) => void): ActionExecution;
}
/** The state owner implements these operations atomically with pipeline checkpoints. */
export interface PipelineHost {
  checkpoint(): unknown;
  restore(checkpoint: unknown): void;
  execute(action: GameAction): ActionExecution;
  /** Optional typed seam for Recall and atomic Batch actions. */
  executeContract?(action: ContractGameAction): ActionExecution;
  /** Optional pre-zone-change seam for confirmed deaths. */
  deathBoundary?: PipelineDeathBoundaryCapability;
  context(source: ObjectSnapshot, controller: PlayerId, at: TimingPointId): ResolveContext;
  objects(): readonly ObjectSnapshot[];
  choose<T>(request: ChoiceRequest<T>): T;
  testTrigger?(registration: TriggerRegistration, event: PipelineEvent, source: ObjectSnapshot): boolean;
}
export type ReplacementResult =
  | { readonly status: 'rewrite'; readonly action: GameAction }
  | { readonly status: 'replace'; readonly actions: readonly GameAction[] }
  | { readonly status: 'prevent' };
export interface ReplacementRegistration {
  readonly id: string;
  readonly source?: ObjectSnapshot;
  readonly activeZones?: readonly string[];
  readonly matches: (action: GameAction, original: GameAction) => boolean;
  readonly apply: (action: GameAction, original: GameAction) => ReplacementResult;
  readonly optional?: boolean;
  readonly oncePerTurn?: boolean;
}
export interface PipelineClock {
  turn: number;
  phase: number;
  combat: number;
  showdown: number;
  chain: number;
}
