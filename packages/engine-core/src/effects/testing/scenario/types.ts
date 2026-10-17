import type { CardProgram, Expr, Instruction, ObjectFilter } from "@riftbound/card-dsl";
import type { GameAction, LocationRef, ObjectRef, ObjectSnapshot, PlayerId, PlayerSnapshot, Value, ZoneId } from "../../contract.js";
import type { PipelineEvent } from "../../../events/pipeline-types.js";
import type { TimingPointId } from "../../../events/timing-points.js";

/** A card object in a scenario. `program` is a convenient in-memory registry entry. */
export interface ScenarioObject extends Partial<Omit<ObjectSnapshot, "ref" | "zone" | "owner" | "controller" | "location">> {
  readonly id: string;
  readonly cardId?: string | null;
  readonly program?: CardProgram;
  readonly owner?: PlayerId;
  readonly controller?: PlayerId;
  readonly zone?: ZoneId;
  readonly location?: LocationRef | null;
}

export interface ScenarioPlayer {
  readonly energy?: number;
  readonly power?: readonly string[];
  readonly xp?: number;
  readonly score?: number;
  /** Zone arrays are top-to-bottom for decks and entry order elsewhere. */
  readonly zones?: Partial<Record<ZoneId, readonly string[]>>;
}

export type ScenarioChoiceValue = unknown;

export type ScenarioOperation =
  | {
      readonly type: "play";
      readonly object: string;
      readonly player?: PlayerId;
      readonly location?: LocationRef;
      readonly cost?: Extract<GameAction, { type: "play" }>['cost'];
    }
  | {
      readonly type: "activate";
      readonly object: string;
      readonly player?: PlayerId;
      readonly ability?: number;
    }
  | { readonly type: "pass"; readonly player?: PlayerId }
  | {
      readonly type: "trigger";
      readonly timingPoint: TimingPointId;
      readonly object?: string;
      readonly source?: string;
      readonly target?: string;
      readonly player?: PlayerId;
      readonly details?: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "choose"; readonly id: string; readonly value: ScenarioChoiceValue };

export interface ScenarioEventExpectation {
  readonly sequence?: readonly EventPattern[];
  readonly includes?: readonly EventPattern[];
  readonly exact?: readonly EventPattern[];
}

/** Partial event matching keeps scenario data readable while retaining exact event logs. */
export type EventPattern = Readonly<Record<string, unknown>>;

export interface ScenarioObjectExpectation extends Partial<Omit<ObjectSnapshot, "ref">> {
  readonly ref?: string | Partial<ObjectRef>;
  readonly counters?: Readonly<Record<string, number>> | readonly (readonly [string, number])[];
  readonly empowered?: number;
}

export interface ScenarioExpectation {
  readonly events?: ScenarioEventExpectation | readonly EventPattern[];
  readonly objects?: Readonly<Record<string, ScenarioObjectExpectation>>;
  readonly players?: Readonly<Record<PlayerId, Partial<PlayerSnapshot>>>;
  readonly links?: Readonly<Record<string, Value>>;
}

export interface CardScenario {
  readonly players?: Readonly<Record<PlayerId, ScenarioPlayer>>;
  readonly objects?: readonly ScenarioObject[];
  readonly phase?: string;
  readonly turnOrder?: readonly PlayerId[];
  readonly turnPlayer?: PlayerId;
  readonly priority?: PlayerId;
  readonly answers?: Readonly<Record<string, ScenarioChoiceValue>>;
  readonly operations?: readonly ScenarioOperation[];
  readonly expect?: ScenarioExpectation;
  readonly seed?: number;
}

export interface ScenarioObjectState extends ObjectSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly empowered: number;
}

export interface ScenarioState {
  readonly objects: readonly ScenarioObjectState[];
  readonly players: Readonly<Record<PlayerId, PlayerSnapshot>>;
  readonly priority: PlayerId | null;
  readonly chain: readonly unknown[];
}

export interface CardScenarioResult {
  readonly events: readonly PipelineEvent[];
  readonly state: ScenarioState;
  readonly links: Readonly<Record<string, Value>>;
  readonly asserts: () => void;
}

export interface CardScenarioTemplateRow {
  readonly name?: string;
  readonly canonicalCardId: string;
  readonly program: CardProgram;
  readonly scenario: CardScenario;
  readonly expect?: ScenarioExpectation;
}

export interface CardScenarioTemplateCase {
  readonly name: string;
  readonly canonicalCardId: string;
  readonly run: () => CardScenarioResult;
}

/** Kept as a type-only import anchor for consumers that build scenario data. */
export type ScenarioInstruction = Instruction | Expr | ObjectFilter;
