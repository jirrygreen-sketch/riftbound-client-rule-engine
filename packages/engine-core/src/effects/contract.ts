import type { GameEvent } from "@riftbound/protocol";
import type {
  Condition, ContinuousEffect, Expr, Instruction, ObjectFilter, ObjectRef,
  OpcodeId, TriggerSpec, Value
} from "@riftbound/card-dsl";
import type { TimingPointId } from "../events/timing-points.js";

export type { Condition, Expr, Instruction, ObjectFilter, ObjectRef, OpcodeId, TriggerSpec, Value };
export type { GameEvent, TimingPointId };

/** The identity of a Riftbound player. */
export type PlayerId = string;
/** The six Riftbound domains. */
export type Domain = "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order";
/** Zones named by the primitive contract. */
export type ZoneId = "hand" | "deck" | "rune-deck" | "trash" | "banishment" | "board" | "rune-zone" | "chain";
/** A Base or Battlefield on the Board. */
export type LocationRef =
  | { readonly type: "base"; readonly player: PlayerId }
  | { readonly type: "battlefield"; readonly id: string };

/** Current characteristics after layers; null means no printed value. */
export interface ObjectSnapshot {
  readonly ref: ObjectRef;
  readonly cardId: string | null;
  readonly name: string;
  readonly types: readonly string[];
  readonly tags: readonly string[];
  readonly keywords: readonly { readonly id: string; readonly value?: number }[];
  readonly owner: PlayerId;
  readonly controller: PlayerId;
  readonly zone: ZoneId;
  readonly location: LocationRef | null;
  readonly might: number | null;
  readonly energy: number | null;
  readonly power: readonly Domain[] | null;
  readonly exhausted: boolean;
  readonly damage: number;
  readonly stunned: boolean;
  readonly buffs: number;
  readonly attachedTo: ObjectRef | null;
  readonly faceDown: boolean;
  readonly isToken: boolean;
}

/** Read-only resources and zone sizes for one player. */
export interface PlayerSnapshot {
  readonly id: PlayerId;
  readonly energy: number;
  readonly power: readonly Domain[];
  readonly runePool: readonly ObjectRef[];
  readonly runes: readonly ObjectRef[];
  readonly xp: number;
  readonly score: number;
  readonly handSize: number;
  readonly handCount: number;
  readonly deckSize: number;
  readonly deckCount: number;
  readonly runeDeckSize: number;
  readonly runeDeckCount: number;
}

/** A parser compatible with schema libraries without a runtime dependency. */
export interface Schema<A> {
  readonly parse: (value: unknown) => A;
  readonly safeParse?: (value: unknown) =>
    | { readonly success: true; readonly data: A }
    | { readonly success: false; readonly error: unknown };
}

/** Visibility of a choice request and its answer. */
export type ChoiceVisibility = "public" | "chooser-only" | readonly PlayerId[];
/** A resolution-time decision; choices use stable request ids. */
export type ChoiceRequest<T> = {
  readonly id: string;
  readonly chooser: PlayerId;
  readonly visibility: ChoiceVisibility;
  readonly prompt?: string;
} & (
  | { readonly type: "optional" }
  | { readonly type: "mode"; readonly options: readonly T[] }
  | { readonly type: "select-objects"; readonly options: readonly ObjectRef[]; readonly min: number; readonly max: number }
  | { readonly type: "order"; readonly options: readonly ObjectRef[] }
  | { readonly type: "number"; readonly min: number; readonly max: number }
);

/** Rolls back the current instruction and asks the caller for an answer. */
export class AwaitChoice<T = unknown> extends Error {
  readonly request: ChoiceRequest<T>;
  constructor(request: ChoiceRequest<T>) {
    super(`Awaiting choice: ${request.id}`);
    this.name = "AwaitChoice";
    this.request = request;
  }
}

/** A count query over committed actions or timing points. */
export interface HistoryQuery {
  readonly scope?: "turn" | "combat" | "game";
  readonly action?: GameAction["type"];
  readonly timingPoint?: TimingPointId;
  readonly player?: PlayerId;
  readonly object?: ObjectRef;
}
/** A layer registration, consumed by the production layers implementation. */
export interface ContinuousEffectSpec {
  readonly id: string;
  readonly layer: "copy" | "trait" | "ability" | "arithmetic";
  readonly source?: ObjectRef;
  readonly filter: ObjectFilter;
  readonly effect: ContinuousEffect;
}
/** Lifetime information for a continuous effect. */
export type Duration =
  | { readonly type: "permanent" }
  | { readonly type: "end-of-turn" }
  | { readonly type: "end-of-combat" }
  | { readonly type: "while-source-in-zone"; readonly source: ObjectRef }
  | { readonly type: "until"; readonly at: TimingPointId; readonly player?: PlayerId };

/** A finalized payment plan; primitive actions do not calculate printed costs. */
export interface FinalizedCostPlan {
  readonly finalized: true;
  readonly energy?: number;
  readonly power?: readonly Domain[];
  readonly xp?: number;
  readonly exhaust?: readonly ObjectRef[];
  readonly recycle?: readonly ObjectRef[];
}
/** Printed characteristics used when creating a token. */
export interface TokenSpec {
  readonly cardId?: string | null;
  readonly name: string;
  readonly types: readonly string[];
  readonly tags?: readonly string[];
  readonly keywords?: readonly { readonly id: string; readonly value?: number }[];
  readonly might: number | null;
  readonly energy: number | null;
  readonly power: readonly Domain[] | null;
}
/** Valid destinations for a zone action. */
export type ZoneDestination = "hand" | "deck-top" | "deck-bottom" | "trash" | "banishment" | "base" | "battlefield" | "rune-deck" | "rune-zone" | "chain";

/** The closed primitive action vocabulary frozen in P0 section 3.6. */
export type GameAction =
  /** Draw from a player's Main Deck. */
  | { readonly type: "draw"; readonly player: PlayerId; readonly amount: number }
  /** Discard an object to its owner's Trash. */
  | { readonly type: "discard"; readonly object: ObjectRef }
  /** Move an object between named zones. */
  | { readonly type: "move-zone"; readonly object: ObjectRef; readonly to: ZoneDestination; readonly location?: LocationRef }
  /** Recycle an object to the bottom of its deck. */
  | { readonly type: "recycle"; readonly object: ObjectRef }
  /** Banish an object. */
  | { readonly type: "banish"; readonly object: ObjectRef }
  /** Burn cards from a Main Deck to Trash. */
  | { readonly type: "mill"; readonly player: PlayerId; readonly amount: number }
  /** Shuffle a Main Deck or Rune Deck. */
  | { readonly type: "shuffle"; readonly player: PlayerId; readonly zone?: "deck" | "rune-deck" }
  /** Order selected cards on top of a deck. */
  | { readonly type: "order-top"; readonly player: PlayerId; readonly objects: readonly ObjectRef[]; readonly zone?: "deck" | "rune-deck" }
  /** Return an object to Hand. */
  | { readonly type: "return-to-hand"; readonly object: ObjectRef }
  /** Move an object between Board locations. */
  | { readonly type: "move-location"; readonly object: ObjectRef; readonly to: LocationRef }
  /** Ready a permanent. */
  | { readonly type: "ready"; readonly object: ObjectRef }
  /** Exhaust a permanent. */
  | { readonly type: "exhaust"; readonly object: ObjectRef }
  /** Stun a Unit. */
  | { readonly type: "stun"; readonly object: ObjectRef }
  /** Kill a Unit. */
  | { readonly type: "kill"; readonly object: ObjectRef }
  /** Attach a non-Unit to a Unit. */
  | { readonly type: "attach"; readonly object: ObjectRef; readonly host: ObjectRef }
  /** Detach an attached object. */
  | { readonly type: "detach"; readonly object: ObjectRef }
  /** Change an object's controller. */
  | { readonly type: "take-control"; readonly object: ObjectRef; readonly player: PlayerId }
  /** Deal damage, preserving whether it is combat damage. */
  | { readonly type: "damage"; readonly source: ObjectRef; readonly target: ObjectRef; readonly amount: number; readonly combat: boolean }
  /** Remove marked damage. */
  | { readonly type: "heal"; readonly object: ObjectRef; readonly amount: number }
  /** Channel Runes from a Rune Deck. */
  | { readonly type: "channel-rune"; readonly player: PlayerId; readonly amount: number; readonly exhausted?: boolean }
  /** Add Energy. */
  | { readonly type: "gain-energy"; readonly player: PlayerId; readonly amount: number }
  /** Add domain power. */
  | { readonly type: "gain-power"; readonly player: PlayerId; readonly power: readonly Domain[] }
  /** Pay a finalized cost plan. */
  | { readonly type: "pay"; readonly player: PlayerId; readonly plan: FinalizedCostPlan }
  /** Gain XP. */
  | { readonly type: "gain-xp"; readonly player: PlayerId; readonly amount: number }
  /** Spend XP. */
  | { readonly type: "spend-xp"; readonly player: PlayerId; readonly amount: number }
  /** Add Buff markers. */
  | { readonly type: "buff"; readonly object: ObjectRef; readonly amount: number }
  /** Spend Buff markers. */
  | { readonly type: "spend-buff"; readonly object: ObjectRef; readonly amount: number }
  /** Apply Empower. */
  | { readonly type: "empower"; readonly object: ObjectRef; readonly amount?: number; readonly multiple?: boolean; readonly limit?: number }
  /** Remove Empower. */
  | { readonly type: "disempower"; readonly object: ObjectRef }
  /** Add a named counter. */
  | { readonly type: "add-counter"; readonly object: ObjectRef; readonly counter: string; readonly amount: number }
  /** Remove a named counter. */
  | { readonly type: "remove-counter"; readonly object: ObjectRef; readonly counter: string; readonly amount: number }
  /** Create a token at a Board location. */
  | { readonly type: "create-token"; readonly player: PlayerId; readonly token: TokenSpec; readonly location: LocationRef }
  /** Create an object with copied printed characteristics. */
  | { readonly type: "copy"; readonly source: ObjectRef; readonly player: PlayerId; readonly location: LocationRef }
  /** Play an object from its current zone. */
  | { readonly type: "play"; readonly object: ObjectRef; readonly player: PlayerId; readonly location?: LocationRef; readonly cost?: FinalizedCostPlan }
  /** Reveal an object to an audience. */
  | { readonly type: "reveal"; readonly object: ObjectRef; readonly viewers?: readonly PlayerId[] }
  /** Look at objects privately. */
  | { readonly type: "look"; readonly objects: readonly ObjectRef[]; readonly player: PlayerId }
  /** Show Off selected characteristics. */
  | { readonly type: "show-off"; readonly object: ObjectRef; readonly properties: readonly (keyof ObjectSnapshot)[]; readonly viewers?: readonly PlayerId[] }
  /** Counter a Chain item. */
  | { readonly type: "counter"; readonly object: ObjectRef }
  /** Award score. */
  | { readonly type: "score"; readonly player: PlayerId; readonly amount: number }
  /** Declare a winner. */
  | { readonly type: "win"; readonly player: PlayerId };

/** Result after replacement and prevention have been applied. */
export type ActionOutcome =
  | { readonly status: "done"; readonly events: readonly GameEvent[]; readonly result?: Value }
  | { readonly status: "replaced" | "prevented" | "impossible"; readonly events: readonly GameEvent[] };

/** The only state and decision capabilities available to a primitive. */
export interface ResolveContext {
  readonly source: ObjectSnapshot;
  readonly controller: PlayerId;
  readonly timingPoint: TimingPointId;
  object(ref: ObjectRef): ObjectSnapshot | null;
  lastKnown(ref: ObjectRef): ObjectSnapshot;
  /** A non-targeting set query; the result does not guarantee zone order. */
  query(filter: ObjectFilter): ObjectSnapshot[];
  /**
   * Read the first or last count objects in a player's actual zone order.
   * Decks use top-to-bottom order; other zones use entry order. Both slices
   * preserve that relative order. Omit count to read all objects; a count
   * larger than the zone returns all available objects. Zero returns none.
   * @throws RangeError if count is not a nonnegative safe integer.
   */
  zoneSlice(player: PlayerId, zone: ZoneId, from: "top" | "bottom", count?: number): ObjectSnapshot[];
  targets(specId: string): ObjectRef[];
  picks(specId: string): readonly (ObjectRef | PlayerId | string)[];
  player(id: PlayerId): PlayerSnapshot;
  evaluate(expr: Expr): Value;
  test(cond: Condition): boolean;
  linked(key: string): Value | undefined;
  history(query: HistoryQuery): number;
  choose<T>(request: ChoiceRequest<T>): T;
  perform(action: GameAction): ActionOutcome;
  link(key: string, value: Value): void;
  addContinuous(effect: ContinuousEffectSpec, duration: Duration): void;
  registerDelayedTrigger(at: TriggerSpec, body: readonly Instruction[]): void;
}

export interface ExecutedInstructionResult { readonly status: "executed"; readonly events: GameEvent[]; readonly linkedValues?: Record<string, Value>; }
export interface NegatedInstructionResult { readonly status: "negated"; readonly reason: "replaced" | "skipped" | "impossible"; readonly events: GameEvent[]; }
export interface IgnoredInstructionResult { readonly status: "ignored"; readonly reason: "mistargeted" | "linked-ignored"; }
export type InstructionResult = ExecutedInstructionResult | NegatedInstructionResult | IgnoredInstructionResult;
/** One deterministic primitive; no turn advancement or direct state writes. */
export interface InstructionDef<A> { readonly op: OpcodeId; readonly argsSchema: Schema<A>; execute(ctx: ResolveContext, args: A): InstructionResult; }
