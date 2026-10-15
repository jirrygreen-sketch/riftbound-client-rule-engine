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

/** A reference to an object, player, event, or other rules entity. */
export type ObjectRef = string;

/** A JSON-like filter used to describe the objects or events a rule can see. */
export type ObjectFilter = Readonly<Record<string, Value>>;

/** A literal value expression, such as a printed amount or a named mode. */
export interface ConstantExpr {
  readonly kind: "constant";
  readonly value: Value;
}

/** A literal spelling accepted for data authored with AST terminology. */
export interface LiteralExpr {
  readonly kind: "literal";
  readonly value: Value;
}

/** An expression that reads a property from a rules object. */
export interface ObjectPropertyExpr {
  readonly kind: "object-property";
  readonly object: ObjectRef;
  readonly property: string;
}

/** An alternate spelling for an object-property expression used by some tools. */
export interface ObjectAttributeExpr {
  readonly kind: "object-attribute";
  readonly object: ObjectRef;
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

/** A value expression used by instruction arguments and rule metadata. */
export type Expr =
  | ConstantExpr
  | LiteralExpr
  | ObjectPropertyExpr
  | ObjectAttributeExpr
  | LinkedValueExpr
  | LinkedExpr
  | CountExpr;

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

/** A v1.5 condition clause; its scope is the instruction or ability field owning it. */
export type Condition =
  | AlwaysCondition
  | NeverCondition
  | CompareCondition
  | AllCondition
  | AnyCondition
  | NotCondition
  | ExpressionCondition;

/** A target selection specification that participates in target-trigger rules. */
export interface TargetSpec {
  readonly id: string;
  readonly filter: ObjectFilter;
  readonly min?: number;
  readonly max?: number | null;
  readonly selection?: "one" | "any" | "all" | "up-to";
  readonly [key: string]: unknown;
}

/** A non-target pick specification; picks do not trigger "becomes a target" effects. */
export interface PickSpec {
  readonly id: string;
  readonly options: readonly Value[];
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
  readonly linkedTo?: string;
  readonly condition?: Condition;
}

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
