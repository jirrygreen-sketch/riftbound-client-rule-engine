import type { CARD_DSL_KIND, CARD_DSL_SCHEMA_VERSION, SYNTHETIC_DEMO_RULESET } from "./constants.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface EffectNode {
  readonly type: "effect";
  readonly id: string;
  readonly operation: string;
  readonly arguments: JsonObject;
  readonly targetId?: string;
}

export interface TriggerNode {
  readonly type: "trigger";
  readonly id: string;
  readonly event: string;
  readonly filter?: JsonObject;
  readonly body: readonly CardDslNode[];
}

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly body: readonly CardDslNode[];
}

export interface ChoiceNode {
  readonly type: "choice";
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly ChoiceOption[];
  readonly defaultOptionId?: string;
}

export interface OptionalNode {
  readonly type: "optional";
  readonly id: string;
  readonly prompt: string;
  readonly body: readonly CardDslNode[];
  readonly decline: readonly CardDslNode[];
}

export interface AutoResolveNode {
  readonly type: "auto-resolve";
  readonly id: string;
  readonly body: readonly CardDslNode[];
}

export interface TargetNode {
  readonly type: "target";
  readonly id: string;
  readonly placeholder: string;
  readonly minCount: number;
  readonly maxCount: number | null;
}

export type CardDslNode =
  | EffectNode
  | TriggerNode
  | ChoiceNode
  | OptionalNode
  | AutoResolveNode
  | TargetNode;

export interface CardDslDocument {
  readonly kind: typeof CARD_DSL_KIND;
  readonly schemaVersion: typeof CARD_DSL_SCHEMA_VERSION;
  readonly ruleset: typeof SYNTHETIC_DEMO_RULESET;
  readonly id: string;
  readonly body: readonly CardDslNode[];
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type ValidationResult =
  | {
      readonly ok: true;
      readonly value: CardDslDocument;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly ValidationIssue[];
    };
