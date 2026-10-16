import type { ChoiceRequest, GameAction, GameEvent, Instruction, ObjectSnapshot, PlayerId, ResolveContext, ActionOutcome } from '../effects/contract.js';
import type { TimingPointId } from './timing-points.js';
import type { TriggerSpec } from './trigger-spec.js';
import type { CostPlanInput } from '../cost/plan-types.js';
import type { TargetFinalizeOptions, TargetRequirement } from '../target/target-plan.js';

/** Internal events carry authoritative snapshots, not client supplied DTOs. */
export interface TimingEmission {
  readonly timingPoint: TimingPointId;
  readonly kind?: string;
  readonly object?: ObjectSnapshot;
  readonly source?: ObjectSnapshot;
  readonly target?: ObjectSnapshot;
  readonly player?: PlayerId;
  readonly amount?: number;
  readonly fromZone?: string;
  readonly toZone?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  /** Multiple named timings of one physical event share simultaneous ordering. */
  readonly simultaneousGroup?: string;
}
export type PipelineEvent = GameEvent & TimingEmission & { readonly action?: GameAction; readonly eventId: number };

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
}
export interface TriggerSnapshot {
  readonly registration: TriggerRegistration;
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly event: PipelineEvent;
  readonly frequencyKey: string | null;
}
export interface ActionExecution {
  readonly outcome: ActionOutcome;
  readonly emissions: readonly TimingEmission[];
}
/** The state owner implements these operations atomically with pipeline checkpoints. */
export interface PipelineHost {
  checkpoint(): unknown;
  restore(checkpoint: unknown): void;
  execute(action: GameAction): ActionExecution;
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
