import type {
  Expr,
  Instruction,
  ObjectFilter,
  ObjectRef,
  ObjectSnapshot,
  ResolveContext,
  TriggerSpec,
  Value,
} from '../contract.js';
import type { TimingPointId } from '../../events/timing-points.js';
import type { DelayedDuration } from '../../events/delayed/duration.js';

/** Runtime-only registration facts. They are additive and never written to card IR. */
export interface DelayedRegistrationOptions {
  readonly expiresAt?: TimingPointId;
  /** Player-relative expiry for "your next ..." windows. */
  readonly expireOn?: {
    readonly timingPoint: TimingPointId;
    readonly player: ResolveContext['controller'];
  };
  readonly maxPerScope?: number;
  readonly lockedRefs?: readonly ObjectRef[];
  /** Explicitly preserve the complete parsed event pattern. */
  readonly filter?: Readonly<Record<string, unknown>>;
  /** Exact source/controller LKI captured at registration. */
  readonly source?: ObjectSnapshot;
  readonly controller?: ResolveContext['controller'];
}

/** Additive runtime capability for sinks that can persist delayed options. */
export interface DelayedRegistrationCapability {
  readonly version: 'riftbound.delayed-registration.v1';
  /** A checkpoint is mandatory so registration can roll back atomically. */
  checkpoint(): unknown;
  restore(checkpoint: unknown): void;
  register(
    at: TriggerSpec,
    body: readonly Instruction[],
    options: DelayedRegistrationOptions,
  ): void;
}

/** Pipeline registration seam accepted by the capability adapter. */
export interface DelayedPipelineSink {
  registerTrigger(registration: import('../../events/pipeline-types.js').TriggerRegistration): void;
  hasTriggerRegistration(id: string): boolean;
  registerTriggerRule?(rule: import('../../events/pipeline-types.js').TriggerRule): void;
  unregisterTriggerRule?(id: string): void;
  unregisterTrigger?(id: string): void;
  checkpoint?(): unknown;
  restore?(checkpoint: unknown): void;
}

/** Internal symbol used to carry the additive sink through the interpreter. */
export const DELAYED_REGISTRATION_CAPABILITY = Symbol.for('riftbound.delayed-registration.capability');

/** A delayed-trigger sink that can persist the facts the frozen context lacks. */
export interface DelayedRegistrationSink extends ResolveContext {
  readonly delayedRegistration?: DelayedRegistrationCapability;
}

export interface DelayedTriggerDeclaration {
  readonly at: Expr | Value;
  readonly body: Expr | Value;
  readonly filter?: Expr | Value;
  readonly eventFilter?: Expr | Value;
  readonly duration?: Expr | Value;
  readonly window?: Expr | Value;
  readonly once?: Expr | Value;
  readonly uses?: Expr | Value;
  readonly objects?: Expr | Value;
  readonly count?: Expr | Value;
  readonly referent?: Expr | Value;
  readonly target?: Expr | Value;
}

export interface PreparedDelayedRegistration {
  readonly spec: TriggerSpec;
  readonly body: readonly Instruction[];
  readonly duration?: DelayedDuration;
  readonly options?: DelayedRegistrationOptions;
  readonly count?: number;
  readonly lockedRefs: readonly ObjectRef[];
  readonly filter: ObjectFilter | Readonly<Record<string, unknown>>;
}
