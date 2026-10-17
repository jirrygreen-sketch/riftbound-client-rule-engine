/** The only ruleset currently accepted by the EffectIR v2 contract. */
export const EFFECT_IR_V2_RULESET = "core-1.5" as const;

/** A stable identifier for a generated instruction opcode. */
export type OpcodeId = string;

/** A stable identifier for a card keyword. */
export type KeywordId = string;

/** A named rules event or phase boundary used by a trigger. */
export type TimingPointId = string;

/** JSON-compatible values that can be captured as a linked result. */
export type Value =
  | string
  | number
  | boolean
  | null
  | readonly Value[]
  | { readonly [key: string]: Value };

/** A zone-bound object identity; leaving its zone invalidates this reference. */
export interface ObjectRef {
  readonly id: string;
  readonly zoneEntryId: number;
}

/** A board location identity. The engine binds player-relative selectors to this shape. */
export type LocationRef =
  | { readonly type: "base"; readonly player: string }
  | { readonly type: "battlefield"; readonly id: string };

/** A player-relative location reference evaluated by the resolving ability. */
export type RelativeLocationKind =
  | "ability-controller-base"
  | "controller-base"
  | "opponent-base"
  | "source-location"
  | "target-location"
  | "target-controller-base"
  | "target-owner-base";

/** Symbolic locations are static IR values; concrete LocationRefs are runtime values. */
export type LocationSelector =
  | LocationRef
  | RelativeLocationKind
  | { readonly kind: "relative"; readonly relation: RelativeLocationKind; readonly target?: string }
  | { readonly kind: "location-of"; readonly object: ObjectSelector }
  | { readonly kind: "location-selector"; readonly locationOf: ObjectSelector }
  | { readonly kind: "target-location"; readonly target: string }
  | { readonly kind: "target-controller-base"; readonly target: string }
  | { readonly kind: "target-owner-base"; readonly target: string }
  | { readonly kind: "source-location" }
  | { readonly kind: "linked-location"; readonly instructionId: string; readonly key?: string }
  | { readonly kind: "choose"; readonly id: string; readonly options?: readonly LocationSelector[]; readonly filter?: LocationFilter };

/** Location state predicates used by target.location. */
export interface LocationFilter {
  readonly type?: "base" | "battlefield" | "any";
  readonly kind?: "base" | "battlefield" | "any";
  readonly player?: string | "controller" | "opponent";
  readonly owner?: string | "controller" | "opponent" | null;
  readonly controller?: string | "controller" | "opponent" | "uncontrolled" | null;
  readonly occupied?: boolean;
  readonly open?: boolean;
  readonly controlled?: boolean;
  readonly contested?: boolean;
  readonly hasUnits?: boolean;
  readonly [key: string]: Value | undefined;
}

/** A target.location declaration. Location choices are public game-object choices. */
export interface LocationTargetSpec extends LocationFilter {
  readonly id: string;
  readonly min?: number;
  readonly max?: number | null;
  readonly selection?: "one" | "any" | "all" | "up-to";
  readonly [key: string]: Value | undefined;
}

/** Static IR names objects symbolically; the interpreter binds zone identities. */
export type ObjectSelector =
  | "self"
  | "source"
  | { readonly target: string }
  | { readonly pick: string }
  | { readonly linked: string };

/** Object-valued anchors, distinct from scalar filter fields such as objectId. */
export const OBJECT_FILTER_ANCHORS = ["object", "source", "target", "host", "attachedTo", "sameLocationAs", "exclude"] as const;

/** A JSON-like filter whose object-valued anchors contain static selectors. */
export type ObjectFilter = Readonly<Record<string, Value>> & {
  readonly [key in typeof OBJECT_FILTER_ANCHORS[number]]?: ObjectSelector;
};

/** A literal value expression, such as a printed amount or a named mode. */
export interface ConstantExpr<T = Value> {
  readonly kind: "constant";
  readonly value: T;
}

/** A literal spelling accepted for data authored with AST terminology. */
export interface LiteralExpr<T = Value> {
  readonly kind: "literal";
  readonly value: T;
}

/** An explicitly typed destination/location expression. */
export interface LocationExpr {
  readonly kind: "location";
  readonly value: LocationSelector;
}

/** An expression that reads a property from a rules object. */
export interface ObjectPropertyExpr {
  readonly kind: "object-property";
  readonly object: ObjectSelector;
  readonly property: string;
}

/** An alternate spelling for an object-property expression used by some tools. */
export interface ObjectAttributeExpr {
  readonly kind: "object-attribute";
  readonly object: ObjectSelector;
  readonly attribute: string;
}

/** An expression that reads a value produced by an earlier instruction. */
export interface LinkedValueExpr {
  readonly kind: "linked-value";
  readonly instructionId: string;
  readonly key?: string;
}

/** An alternate short spelling for a linked-value expression. */
export interface LinkedExpr {
  readonly kind: "linked";
  readonly instructionId: string;
  readonly key?: string;
}

/** An expression whose value is calculated by counting matching rules objects. */
export interface CountExpr {
  readonly kind: "count";
  readonly subject: string;
  readonly filter?: ObjectFilter;
}

/** A literal instruction body; its contents are executed only by a control node. */
export type InstructionBodyExpr = ConstantExpr<readonly Instruction[]> | LiteralExpr<readonly Instruction[]>;

/** Native arithmetic spellings, including the interpreter's existing long forms. */
export type ArithmeticOperator = "add" | "sub" | "subtract" | "mul" | "multiply" | "div" | "divide" | "min" | "max" | "neg";

/** Recursive arithmetic with explicit arity and no coercion of null characteristics. */
export type ArithmeticExpr = { readonly kind: "arithmetic" } & (
  | { readonly operator: "add" | "mul" | "multiply" | "min" | "max"; readonly operands: readonly [Expr, ...Expr[]] }
  | { readonly operator: "sub" | "subtract" | "div" | "divide"; readonly operands: readonly [Expr, Expr] }
  | { readonly operator: "neg"; readonly operands: readonly [Expr] }
);

/** A value expression used by instruction arguments and rule metadata. */
export type Expr =
  | ConstantExpr
  | LiteralExpr
  | LocationExpr
  | ObjectPropertyExpr
  | ObjectAttributeExpr
  | LinkedValueExpr
  | LinkedExpr
  | CountExpr
  | ArithmeticExpr
  | InstructionBodyExpr;

/** A comparison operator for a v1.5 condition clause. */
export type ConditionOperator =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in";

/** A condition that is always true, useful for generated programs. */
export interface AlwaysCondition {
  readonly kind: "always";
}

/** A condition that is always false, useful for blocked authored branches. */
export interface NeverCondition {
  readonly kind: "never";
}

/** A condition comparing two value expressions. */
export interface CompareCondition {
  readonly kind: "compare";
  readonly left: Expr;
  readonly operator: ConditionOperator;
  readonly right: Expr;
}

/** A conjunction of condition clauses. */
export interface AllCondition {
  readonly kind: "all";
  readonly conditions: readonly Condition[];
}

/** A disjunction of condition clauses. */
export interface AnyCondition {
  readonly kind: "any";
  readonly conditions: readonly Condition[];
}

/** A negated condition clause. */
export interface NotCondition {
  readonly kind: "not";
  readonly condition: Condition;
}

/** A condition that tests a boolean expression supplied by the rules context. */
export interface ExpressionCondition {
  readonly kind: "expression";
  readonly value: Expr;
}

/** A role in the event payload supplied while a trigger is tested. */
export type EventObjectSelector = "object" | "source" | "target";

/** A card-play provenance predicate.  The event payload, not the current zone, is authoritative. */
export interface PlayedFromHandCondition {
  readonly kind: "played-from-hand" | "playedFromHand";
  readonly object?: EventObjectSelector;
}

/** A card-play provenance predicate for an explicitly named origin zone. */
export interface PlayedFromZoneCondition {
  readonly kind: "played-from-zone" | "playedFromZone";
  readonly zone: string;
  readonly object?: EventObjectSelector;
}

/** A comparison against a printed/copied characteristic carried by an event object. */
export interface PrintedCharacteristicCondition {
  readonly kind: "event-printed" | "printed-characteristic" | "event-printed-characteristic";
  readonly object: EventObjectSelector;
  readonly characteristic: "energy" | "power" | "might";
  readonly operator: ConditionOperator;
  readonly right: Expr;
}

/** A read-only result predicate, including finalized optional-cost decisions. */
export interface ResultCondition {
  readonly kind: "result";
  /** A result key such as `cost.additional` or a linked instruction id. */
  readonly result: string;
  readonly id?: string;
  readonly key?: string;
  readonly operator?: ConditionOperator;
  readonly right?: Expr;
  /** `value` is accepted as the authored spelling for the comparison RHS. */
  readonly value?: Expr;
}

/** A v1.5 condition clause; its scope is the instruction or ability field owning it. */
export type Condition =
  | AlwaysCondition
  | NeverCondition
  | CompareCondition
  | AllCondition
  | AnyCondition
  | NotCondition
  | ExpressionCondition
  | PlayedFromHandCondition
  | PlayedFromZoneCondition
  | PrintedCharacteristicCondition
  | ResultCondition;

/** A target selection specification that participates in target-trigger rules. */
export interface TargetSpec {
  readonly id: string;
  readonly filter: ObjectFilter;
  /** Existing object-target location filter or a symbolic location reference. */
  readonly location?: LocationSelector | LocationFilter;
  readonly min?: number;
  readonly max?: number | null;
  readonly selection?: "one" | "any" | "all" | "up-to";
  readonly [key: string]: unknown;
}

/** A real zone-order source, captured without looking at its cards during Finalize. */
export interface PickZoneSlice {
  /** Omitted means the ability's controller, not the source's current controller. */
  readonly player?: Expr;
  readonly zone: "hand" | "deck" | "rune-deck" | "trash" | "banishment" | "board" | "rune-zone" | "chain";
  readonly from: "top" | "bottom";
  /** Omitted reads the whole zone; a short zone supplies all available objects. */
  readonly count?: Expr;
}

/** A non-target pick specification; picks do not trigger "becomes a target" effects. */
export interface PickSpec {
  readonly id: string;
  readonly options: readonly Value[];
  /** Explicit ordered sources use options: [], ordered: true, selection: "all". */
  readonly ordered?: boolean;
  readonly zoneSlice?: PickZoneSlice;
  /** Resolve-time binding to an actual preceding instruction result, in result order. */
  readonly linked?: LinkedValueExpr | LinkedExpr;
  /** Subtract an actual result list from linked, retaining the remaining order. */
  readonly exclude?: LinkedValueExpr | LinkedExpr;
  readonly filter?: ObjectFilter;
  readonly min?: number;
  readonly max?: number | null;
  readonly selection?: "one" | "any" | "all" | "up-to";
  readonly [key: string]: unknown;
}

/** A single payment component in a v1.5 cost plan. */
export interface CostPayment {
  readonly kind: string;
  readonly amount?: Expr;
  readonly value?: Expr;
  readonly choice?: PickSpec;
  readonly [key: string]: unknown;
}

/** A cost plan checked during Finalize before an ability is put into effect. */
export interface CostSpec {
  readonly kind?: string;
  readonly payments?: readonly CostPayment[];
  readonly energy?: Expr;
  readonly power?: Expr;
  readonly rune?: Expr;
  readonly discard?: PickSpec;
  readonly [key: string]: unknown;
}

/** A forced precondition that must hold before an ability can be played. */
export interface Requirement {
  readonly kind: string;
  readonly value?: Expr;
  readonly condition?: Condition;
  readonly [key: string]: unknown;
}

/** A placement or timing limitation kept separate from play requirements. */
export interface Restriction {
  readonly kind: string;
  readonly value?: Expr;
  readonly condition?: Condition;
  readonly [key: string]: unknown;
}

/** A layer-calculated continuous effect that does not enter the chain. */
export interface ContinuousEffect {
  readonly kind: string;
  readonly value?: Expr;
  readonly duration?: string;
  readonly [key: string]: unknown;
}

/** A v1.5 deckbuilding decision, such as an additional legendary choice. */
export interface DeckbuildingDecision {
  readonly kind: string;
  readonly options?: readonly Value[];
  readonly count?: number;
  readonly [key: string]: unknown;
}

/** An event pattern observed by a replacement ability. */
export interface EventPattern {
  readonly event?: string;
  readonly type?: string;
  readonly filter?: ObjectFilter;
  readonly [key: string]: unknown;
}

/** A trigger lifetime for which an otherwise matching trigger may fire once. */
export type TriggerOnce = "per-turn" | "per-combat" | "per-chain" | "per-game";

/** A timing-point subscription aligned with the events/trigger-spec contract. */
export interface TriggerSpec {
  readonly at: TimingPointId;
  readonly filter: ObjectFilter | EventPattern;
  readonly condition?: Condition;
  readonly once?: TriggerOnce;
}

/** A card instruction whose condition applies only to this instruction. */
export interface Instruction {
  readonly id: string;
  readonly op: OpcodeId;
  readonly args: Readonly<Record<string, Expr>>;
  readonly targets?: readonly TargetSpec[];
  readonly picks?: readonly PickSpec[];
  readonly locations?: readonly LocationTargetSpec[];
  readonly linkedTo?: string;
  readonly condition?: Condition;
}

/** Sequence bodies use the existing literal args.body encoding and share link scope. */
export type SequenceArgs = { readonly body: InstructionBodyExpr };

/** Repeat count is evaluated once; targets are reselected each iteration by default. */
export type RepeatArgs = SequenceArgs & {
  readonly count: Expr;
  readonly reselectTargets?: Expr;
};

/** A condition on this node guards its whole body. */
export interface SequenceInstruction extends Instruction {
  readonly op: "sequence";
  readonly args: SequenceArgs;
}

/** Each iteration has its own link scope and optionally reselects all targets. */
export interface RepeatInstruction extends Instruction {
  readonly op: "repeat";
  readonly args: RepeatArgs;
}

/** Shared typed structural nodes understood by the ability interpreter. */
export type ControlInstruction = SequenceInstruction | RepeatInstruction;

/** A keyword ability expanded by the engine's keyword registry. */
export interface KeywordAbility {
  readonly kind: "keyword";
  readonly keyword: KeywordId;
  readonly value?: number;
}

/** A mandatory or optional ability subscribed to a timing point. */
export interface TriggeredAbility {
  readonly kind: "triggered";
  readonly trigger: TriggerSpec;
  readonly optional: boolean;
  readonly body: readonly Instruction[];
}

/** An ability activated at action or reaction speed after paying its cost. */
export interface ActivatedAbility {
  readonly kind: "activated";
  readonly cost: CostSpec;
  readonly timing: "action" | "reaction";
  readonly body: readonly Instruction[];
  readonly restriction?: Restriction;
}

/** A static layer effect evaluated outside the chain. */
export interface StaticAbility {
  readonly kind: "static";
  readonly effect: ContinuousEffect;
  readonly condition?: Condition;
}

/** A replacement ability that intercepts an event before it commits. */
export interface ReplacementAbility {
  readonly kind: "replacement";
  readonly replaces: EventPattern;
  readonly with: readonly Instruction[];
  readonly condition?: Condition;
}

/** A play ability resolved when the card enters play. */
export interface PlayAbility {
  readonly kind: "play";
  readonly cost?: CostSpec;
  readonly body: readonly Instruction[];
  readonly requirements?: readonly Requirement[];
  readonly restriction?: Restriction;
}

/** One of the six v1.5 card ability forms. */
export type Ability =
  | KeywordAbility
  | TriggeredAbility
  | ActivatedAbility
  | StaticAbility
  | ReplacementAbility
  | PlayAbility;

/** The complete data program for one canonical card printing identity. */
export interface CardProgram {
  readonly canonicalCardId: string;
  readonly rulesetVersion: typeof EFFECT_IR_V2_RULESET;
  readonly status: "executable" | "judge-required" | "no-ability";
  readonly judgeReason?: string;
  readonly abilities: readonly Ability[];
  readonly deckbuilding?: readonly DeckbuildingDecision[];
  readonly sourceText: string;
}
