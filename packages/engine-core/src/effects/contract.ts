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
/** A payment source that can satisfy any Domain requirement (CR v1.5 163.2.b).
 * `universal` is the contract spelling; `any` is retained for the existing
 * duel resource adapter, and `universal-power` mirrors card-dsl receipts.
 */
export type UniversalPowerSource = "universal" | "any" | "universal-power";
export type PowerPaymentSource = Domain | UniversalPowerSource;
export type FacedownZoneId = "facedown";
/** An immutable event role that can be referenced without choosing an object. */
export type EventObjectRole = "it";
/**
 * An authoritative Empowered status count. It is a nonnegative safe integer;
 * the reader in zones/empower-state.ts rejects every other value.
 */
export type EmpoweredCount = number;
/** Zones named by the primitive contract. */
export type ZoneId = "hand" | "deck" | "rune-deck" | "trash" | "banishment" | "board" | "rune-zone" | "chain" | "legend";
/** A Base or Battlefield on the Board. */
export type LocationRef =
  | { readonly type: "base"; readonly player: PlayerId }
  | { readonly type: "battlefield"; readonly id: string };

/** A symbolic object binding in a card program (P0 contract 3.6). */
export type ObjectSelector =
  | "self"
  | "source"
  | { readonly target: string }
  | { readonly pick: string }
  | { readonly linked: string };

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
  /** Designation in the current combat; omitted by older adapters, defaults to null. */
  readonly combatRole?: "attacker" | "defender" | null;
  readonly might: number | null;
  readonly energy: number | null;
  readonly power: readonly Domain[] | null;
  readonly exhausted: boolean;
  readonly damage: number;
  readonly stunned: boolean;
  /** Number of ordinary Buff markers. This is independent of Empowered. */
  readonly buffs: number;
  /**
   * Authoritative number of Empowered statuses (CR v1.5 442, 443). This is
   * optional only so existing adapters can keep constructing legacy snapshots;
   * absence means unavailable, never zero. Consumers must read it through
   * zones/empower-state.ts, which validates it at runtime.
   */
  readonly empowered?: EmpoweredCount;
  /**
   * Legacy compatibility spelling for `empowered`. The reader uses it only
   * when the canonical field is absent. When both are present, the existing
   * reader gives `empowered` precedence; new producers should emit both from
   * `empoweredState()` and keep them equal.
   */
  readonly empoweredCount?: EmpoweredCount;
  readonly attachedTo: ObjectRef | null;
  readonly faceDown: boolean;
  /** Battlefield provenance for a facedown object; absent for legacy adapters. */
  readonly facedownLocation?: LocationRef | null;
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
  /** Facedown Zone counts are optional until the Hide consumer is installed. */
  readonly facedownSize?: number;
  readonly facedownCount?: number;
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
  /** Exclude the selected card identities, including their earlier zone entries. */
  readonly exclude?: ObjectSelector;
  /** Match the action object's characteristics captured when the action began. */
  readonly objectFilter?: ObjectFilter;
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
  readonly planId?: string;
  readonly energy?: number;
  readonly power?: readonly Domain[];
  /** Universal Power is kept separate from named Domains and is never coerced. */
  readonly universalPower?: number;
  readonly powerSources?: readonly { readonly source: PowerPaymentSource; readonly amount: number }[];
  readonly xp?: number;
  readonly exhaust?: readonly ObjectRef[];
  readonly recycle?: readonly ObjectRef[];
  readonly parameters?: Readonly<Record<string, Value>>;
  readonly receipt?: PrimitiveCostPaymentReceipt;
}

/** A stable payment receipt. It is evidence, never a second state authority. */
export interface PrimitiveCostPaymentReceipt {
  readonly planId?: string;
  readonly paid: boolean;
  readonly status: "paid" | "declined" | "rejected" | "rolled-back";
  readonly payments: readonly {
    readonly id?: string;
    readonly kind: string;
    readonly paid: boolean;
    readonly amount?: number;
    readonly source?: PowerPaymentSource | "energy" | "xp" | "object" | string;
    readonly universal?: boolean;
  }[];
  readonly universalPower?: number;
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
  /** Setup-only identity; absence means the created object is not a Champion Legend. */
  readonly championLegend?: true;
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
  /**
   * Create a token on the Board or as a Pending Chain item's object
   * (Core Rules v1.5 440.2.c / 185.2.a), or establish a Legend directly in
   * the public Legend Zone (107.4 / 174.2.b). The result is its new ObjectRef.
   * The destination is explicit; legacy Board callers use the perform overload.
   */
  | ({ readonly type: "create-token"; readonly player: PlayerId; readonly token: TokenSpec } & (
    | { readonly to: "board"; readonly location: LocationRef }
    | { readonly to: "chain"; readonly location?: LocationRef }
    | { readonly to: "legend"; readonly location?: undefined }
  ))
  /** Create an object with copied printed characteristics. */
  | { readonly type: "copy"; readonly source: ObjectRef; readonly player: PlayerId; readonly location: LocationRef }
  /** Play an object from its current zone, including a token created Pending on the Chain. */
  | { readonly type: "play"; readonly object: ObjectRef; readonly player: PlayerId; readonly location?: LocationRef; readonly cost?: FinalizedCostPlan }
  /** Reveal an object to an audience; result lists the actual revealed ObjectRefs in zone order. */
  | { readonly type: "reveal"; readonly object: ObjectRef; readonly viewers?: readonly PlayerId[] }
  /** Look at objects privately; result lists the actual viewed ObjectRefs in zone order. */
  | { readonly type: "look"; readonly objects: readonly ObjectRef[]; readonly player: PlayerId }
  /** Show Off selected characteristics; result lists the actual shown ObjectRefs in zone order. */
  | { readonly type: "show-off"; readonly object: ObjectRef; readonly properties: readonly (keyof ObjectSnapshot)[]; readonly viewers?: readonly PlayerId[] }
  /** Counter a Chain item. */
  | { readonly type: "counter"; readonly object: ObjectRef }
  /** Award score. */
  | { readonly type: "score"; readonly player: PlayerId; readonly amount: number }
  /** Declare a winner. */
  | { readonly type: "win"; readonly player: PlayerId };

/** Additive action vocabulary for the Hide/Recall/transaction consumers. */
export interface HideAction {
  readonly type: "hide";
  readonly object: ObjectRef;
  readonly player: PlayerId;
  readonly location: Extract<LocationRef, { type: "battlefield" }>;
  readonly cost?: FinalizedCostPlan;
}
export interface RecallAction {
  readonly type: "recall";
  readonly object: ObjectRef;
  readonly player: PlayerId;
}
export interface BatchAction {
  readonly type: "batch";
  readonly actions: readonly (GameAction | HideAction | RecallAction | BatchAction)[];
  readonly transactionId?: string;
}
export type ContractGameAction = GameAction | HideAction | RecallAction | BatchAction;

/** Versioned, optional bridge for actions outside the legacy closed GameAction. */
export const CONTRACT_ACTION_CAPABILITY_VERSION = "riftbound.contract-actions.v1" as const;
export interface ContractActionCapability {
  readonly version: typeof CONTRACT_ACTION_CAPABILITY_VERSION;
  perform(action: ContractGameAction): ActionOutcome;
}

/** Return the selected action bridge or fail closed before any action is submitted. */
export function requireContractActionCapability(
  context: Pick<ResolveContext, "contractActions">,
): ContractActionCapability {
  const capability = context.contractActions;
  if (capability === undefined || capability.version !== CONTRACT_ACTION_CAPABILITY_VERSION) {
    throw new Error("Contract action capability unavailable or unsupported");
  }
  return capability;
}

/** A frozen event-role snapshot, keyed to the pipeline event that supplied it. */
export interface EventObjectBinding {
  readonly eventId: number;
  readonly role: EventObjectRole;
  /** The exact event-time identity, never looked up again by id. */
  readonly ref: ObjectRef;
  readonly snapshot: ObjectSnapshot;
}

/** @deprecated Existing Board token calls are normalized to an explicit to: "board". */
export type LegacyBoardTokenAction = Omit<Extract<GameAction, { readonly type: "create-token"; readonly to: "board" }>, "to"> & { readonly to?: undefined };

/**
 * Result after replacement and prevention have been applied. Successful
 * create-token returns its ObjectRef; reveal, look, and show-off return an
 * ObjectRef list in zone order. Other results depend on the action.
 */
export type ActionOutcome =
  | { readonly status: "done"; readonly events: readonly GameEvent[]; readonly result?: Value; readonly receipt?: ActionReceipt }
  | { readonly status: "replaced" | "prevented" | "impossible"; readonly events: readonly GameEvent[]; readonly receipt?: ActionReceipt };

/** Receipt for an atomic action batch, including a deterministic rollback marker. */
export interface ActionReceipt {
  readonly transactionId?: string;
  readonly status: "committed" | "rolled-back" | "rejected";
  readonly actions: readonly { readonly type: ContractGameAction["type"]; readonly status: "done" | "replaced" | "prevented" | "impossible" }[];
}

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
  /** @deprecated Include to: "board" when creating a Board token. */
  perform(action: LegacyBoardTokenAction): ActionOutcome;
  /**
   * Read the immutable object bound by a triggering event. The returned
   * snapshot must retain the event's id + zoneEntryId and must not be rebound
   * to a later incarnation. Contexts without a trigger binding omit this
   * capability; consumers then fail closed.
   */
  eventObject?(role: EventObjectRole): EventObjectBinding | null;
  /**
   * Optional versioned consumer for Hide/Recall/atomic Batch actions. Existing
   * contexts remain valid without it; callers must fail closed when absent.
   */
  readonly contractActions?: ContractActionCapability;
  link(key: string, value: Value): void;
  addContinuous(effect: ContinuousEffectSpec, duration: Duration): void;
  registerDelayedTrigger(at: TriggerSpec, body: readonly Instruction[]): void;
  /** Optional outer transaction seam; existing contexts remain valid without it. */
  readonly transaction?: <T>(run: () => T) => T;
}

export interface ExecutedInstructionResult { readonly status: "executed"; readonly events: GameEvent[]; readonly linkedValues?: Record<string, Value>; }
export interface NegatedInstructionResult { readonly status: "negated"; readonly reason: "replaced" | "skipped" | "impossible"; readonly events: GameEvent[]; }
export interface IgnoredInstructionResult { readonly status: "ignored"; readonly reason: "mistargeted" | "linked-ignored"; }
export type InstructionResult = ExecutedInstructionResult | NegatedInstructionResult | IgnoredInstructionResult;
/** One deterministic primitive; no turn advancement or direct state writes. */
export interface InstructionDef<A> { readonly op: OpcodeId; readonly argsSchema: Schema<A>; execute(ctx: ResolveContext, args: A): InstructionResult; }
