import type {
  Condition,
  Instruction,
  ObjectFilter,
  ObjectRef,
  ObjectSnapshot,
  PlayerId,
  TimingPointId,
  Value,
} from '../contract.js';

/**
 * The creation-time facts retained by a Reflexive Trigger.
 *
 * CR v1.5 388.4 makes the source's controller the decision maker and 389.1
 * creates a new ability as a Pending Item.  These values are captured when the
 * originating instruction resolves; they must not be read again from the
 * source's later controller or condition state.
 */
export interface ReflexiveConditionSnapshot {
  readonly timingPoint: TimingPointId;
  readonly controller: PlayerId;
  readonly source: ObjectSnapshot;
  readonly event?: string;
  readonly filter?: Readonly<Record<string, Value>>;
  readonly matched: readonly ObjectRef[];
  readonly conditionResult: boolean;
}

/** One Pending ability requested by a resolving `trigger.reflexive`. */
export interface ReflexivePendingRequest {
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly body: readonly Instruction[];
  readonly mayAtFinalize: boolean;
  readonly snapshot: ReflexiveConditionSnapshot;
  readonly linkKey?: string;
  readonly linkValue?: Value;
  readonly ordinal: number;
}

export interface ReflexivePendingCreation {
  readonly id: string;
}

/** Internal, additive runtime port consumed by the instruction. */
export interface ReflexivePendingRuntime {
  readonly version: 'riftbound.reflexive-pending.v1';
  create(request: ReflexivePendingRequest): ReflexivePendingCreation;
  /** Create one ordered Reflexive wave atomically after validating every id. */
  createAll(requests: readonly ReflexivePendingRequest[]): readonly ReflexivePendingCreation[];
}

/** Internal helper result exposed for focused execution evidence. */
export interface ReflexivePendingRuntimeHandle {
  readonly snapshots: readonly ReflexiveConditionSnapshot[];
  detach(): void;
}

export interface ReflexiveInstructionArgs {
  readonly at?: string;
  readonly body: readonly Instruction[];
  readonly condition?: boolean | Condition;
  readonly filter?: ObjectFilter;
  readonly objects?: Value;
  readonly count: number;
  readonly linkKey?: string;
}
