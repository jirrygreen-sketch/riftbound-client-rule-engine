import type { GameEvent } from "@riftbound/protocol";
import type {
  OpcodeId,
  TimingPointId,
  Value
} from "@riftbound/card-dsl";

/** A minimal runtime schema used to validate one instruction's decoded arguments. */
export interface Schema<A> {
  readonly parse: (value: unknown) => A;
  readonly safeParse?: (value: unknown) =>
    | { readonly success: true; readonly data: A }
    | { readonly success: false; readonly error: unknown };
}

/** The smallest state view an instruction may read through the engine boundary. */
export interface ResolveView {
  readonly [key: string]: unknown;
}

/** A draw action that changes a player's hand and deck through the engine. */
export interface DrawAction {
  readonly type: "draw";
  readonly playerId: string;
  readonly amount: number;
}

/** A discard action that moves an object to its discard zone. */
export interface DiscardAction {
  readonly type: "discard";
  readonly objectId: string;
}

/** A move action that changes an object's zone. */
export interface MoveAction {
  readonly type: "move";
  readonly objectId: string;
  readonly destination: string;
}

/** A tap or ready action for a permanent. */
export interface ReadinessAction {
  readonly type: "tap" | "ready";
  readonly objectId: string;
}

/** A damage action submitted before prevention, modification, and replacement. */
export interface DamageAction {
  readonly type: "damage";
  readonly sourceId?: string;
  readonly targetId: string;
  readonly amount: number;
}

/** A destroy action that sends an object through the rules lifecycle. */
export interface DestroyAction {
  readonly type: "destroy";
  readonly objectId: string;
}

/** An exile action that removes an object from ordinary play zones. */
export interface ExileAction {
  readonly type: "exile";
  readonly objectId: string;
}

/** A payment action committed after a cost plan has been finalized. */
export interface PayAction {
  readonly type: "pay";
  readonly playerId: string;
  readonly resource: string;
  readonly amount: number;
}

/** An energy gain action for a player. */
export interface GainEnergyAction {
  readonly type: "gain-energy";
  readonly playerId: string;
  readonly amount: number;
}

/** A rune gain action for a player. */
export interface GainRuneAction {
  readonly type: "gain-rune";
  readonly playerId: string;
  readonly amount: number;
}

/** An attachment action that links one object to another. */
export interface AttachAction {
  readonly type: "attach";
  readonly objectId: string;
  readonly hostId: string;
}

/** A detach action that removes an attachment relationship. */
export interface DetachAction {
  readonly type: "detach";
  readonly objectId: string;
}

/** A copy action that creates an object with copied printed characteristics. */
export interface CopyAction {
  readonly type: "copy";
  readonly sourceId: string;
  readonly targetId?: string;
}

/** A reveal action that makes an object visible to the relevant players. */
export interface RevealAction {
  readonly type: "reveal";
  readonly objectId: string;
}

/** A scoring action that records points for a player. */
export interface ScoreAction {
  readonly type: "score";
  readonly playerId: string;
  readonly amount: number;
}

/** A minimal game-state action submitted through ResolveContext.perform. */
export type GameAction =
  | DrawAction
  | DiscardAction
  | MoveAction
  | ReadinessAction
  | DamageAction
  | DestroyAction
  | ExileAction
  | PayAction
  | GainEnergyAction
  | GainRuneAction
  | AttachAction
  | DetachAction
  | CopyAction
  | RevealAction
  | ScoreAction;

/** The read-only capability surface available to an instruction primitive. */
export interface ResolveContext {
  /** Read a projection or selected view without exposing mutable engine state. */
  readonly readView: <T = ResolveView>(selector?: string) => T;
  /** Submit one minimal game action for replacement and state processing. */
  readonly perform: (action: GameAction) => void;
  /** Emit a rules event through the engine event pipeline. */
  readonly emit: (event: GameEvent) => void;
  /** Read a value linked by an earlier instruction in this resolution. */
  readonly readLinkedValue: (key: string) => Value | undefined;
  /** Read the named v1.5 timing point at which this instruction resolves. */
  readonly currentTimingPoint: () => TimingPointId;
}

/** A successfully executed instruction and any events or values it produced. */
export interface ExecutedInstructionResult {
  readonly status: "executed";
  readonly events: GameEvent[];
  readonly linkedValues?: Record<string, Value>;
}

/** An instruction that could not take effect because rules prevented it. */
export interface NegatedInstructionResult {
  readonly status: "negated";
  readonly reason: "replaced" | "skipped" | "impossible";
  readonly events: GameEvent[];
}

/** An instruction that was not attempted because its target or linked input was invalid. */
export interface IgnoredInstructionResult {
  readonly status: "ignored";
  readonly reason: "mistargeted" | "linked-ignored";
}

/** The result of resolving one instruction, preserving v1.5 ignored/negated semantics. */
export type InstructionResult =
  | ExecutedInstructionResult
  | NegatedInstructionResult
  | IgnoredInstructionResult;

/** The implementation contract for one generated opcode primitive. */
export interface InstructionDef<A> {
  readonly op: OpcodeId;
  readonly argsSchema: Schema<A>;
  readonly execute: (ctx: ResolveContext, args: A) => InstructionResult;
}
