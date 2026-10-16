import type {
  ContinuousEffectSpec,
  Duration,
  ObjectSnapshot,
  PlayerId,
} from "../effects/contract.js";
import type { ObjectRef } from "@riftbound/card-dsl";
import type { TimingPointId } from "../events/timing-points.js";

export type LayerName = ContinuousEffectSpec["layer"];

export const LAYER_ORDER: readonly LayerName[] = ["copy", "trait", "ability", "arithmetic"];

export type ActionTiming = "action" | "reaction" | "ambush" | string;

export interface MovementPermissions {
  readonly allowed: boolean;
  readonly canMove: boolean;
  readonly canGank: boolean;
  readonly restrictions: readonly string[];
}

/** Characteristics produced by the layer engine in addition to ObjectSnapshot. */
export interface LayeredObjectSnapshot extends ObjectSnapshot {
  readonly printed: ObjectSnapshot;
  readonly actionTimings: readonly ActionTiming[];
  readonly availableTimings: readonly ActionTiming[];
  readonly movement: MovementPermissions;
  readonly text: string | null;
  readonly effectText: string | null;
}

export interface RegisteredContinuousEffect {
  readonly effect: ContinuousEffectSpec;
  readonly duration: Duration;
  readonly timestamp: number;
  readonly sequence: number;
}

export type ContinuousEffectRegistration = RegisteredContinuousEffect;

export interface TimingEvent {
  readonly id: TimingPointId;
  readonly player?: PlayerId;
}

export type DerivedMightResolver = (
  object: LayeredObjectSnapshot,
) => number | null | undefined;

export interface LayerEngineOptions {
  readonly effects?: readonly RegisteredContinuousEffect[];
  readonly timingPoint?: TimingPointId;
  readonly derivedMight?: DerivedMightResolver;
}

export interface LayerEvaluationResult {
  readonly snapshots: readonly LayeredObjectSnapshot[];
  readonly expiredEffectIds: readonly string[];
}

export function refKey(ref: ObjectRef): string {
  return `${ref.id}:${ref.zoneEntryId}`;
}

export function sameRef(left: ObjectRef | null | undefined, right: ObjectRef | null | undefined): boolean {
  return left !== null && left !== undefined && right !== null && right !== undefined &&
    left.id === right.id && left.zoneEntryId === right.zoneEntryId;
}
