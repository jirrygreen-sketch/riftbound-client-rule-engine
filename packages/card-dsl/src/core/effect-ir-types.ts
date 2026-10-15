import type { EFFECT_IR_SCHEMA_VERSION, SYNTHETIC_DEMO_RULESET } from "./constants.js";
import type { JsonObject } from "./types.js";

export type EffectOpcode =
  | "draw.cards"
  | "damage.target"
  | "gain.energy"
  | "summon.self";

export const EFFECT_OPCODES = [
  "draw.cards",
  "damage.target",
  "gain.energy",
  "summon.self"
] as const satisfies readonly EffectOpcode[];

export interface EffectArgumentSpec {
  readonly key: string;
  readonly required: boolean;
  readonly type: "integer" | "player";
}

export interface EffectOpcodeSpec {
  readonly operation: EffectOpcode;
  readonly arguments: readonly EffectArgumentSpec[];
  readonly requiresTarget: boolean;
}

export const EFFECT_OPCODE_SPECS: Readonly<
  Record<EffectOpcode, EffectOpcodeSpec>
> = {
  "draw.cards": {
    operation: "draw.cards",
    arguments: [{ key: "count", required: true, type: "integer" }],
    requiresTarget: false
  },
  "damage.target": {
    operation: "damage.target",
    arguments: [{ key: "amount", required: true, type: "integer" }],
    requiresTarget: true
  },
  "gain.energy": {
    operation: "gain.energy",
    arguments: [
      { key: "amount", required: true, type: "integer" },
      { key: "player", required: true, type: "player" }
    ],
    requiresTarget: false
  },
  "summon.self": {
    operation: "summon.self",
    arguments: [],
    requiresTarget: false
  }
};

export interface EffectIrEffect {
  readonly type: "effect";
  readonly id: string;
  readonly opcode: EffectOpcode;
  readonly args: JsonObject;
  readonly targetId?: string;
}

export interface EffectIrTrigger {
  readonly type: "trigger";
  readonly id: string;
  readonly event: string;
  readonly body: readonly EffectIrNode[];
}

export interface EffectIrTarget {
  readonly type: "target";
  readonly id: string;
  readonly placeholder: string;
  readonly minCount: number;
  readonly maxCount: number | null;
}

export type EffectIrNode = EffectIrEffect | EffectIrTrigger | EffectIrTarget;

export interface EffectIr {
  readonly kind: "effect-ir";
  readonly schemaVersion: typeof EFFECT_IR_SCHEMA_VERSION;
  readonly ruleset: typeof SYNTHETIC_DEMO_RULESET;
  readonly id: string;
  readonly body: readonly EffectIrNode[];
}

export interface EffectIrValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type EffectIrValidationResult =
  | {
      readonly ok: true;
      readonly value: EffectIr;
      readonly issues: readonly [];
    }
  | {
      readonly ok: false;
      readonly issues: readonly EffectIrValidationIssue[];
    };

export class EffectIrValidationError extends Error {
  readonly issues: readonly EffectIrValidationIssue[];

  constructor(issues: readonly EffectIrValidationIssue[]) {
    super(
      issues.map(issue => `${issue.path}: ${issue.message}`).join("\n")
    );
    this.name = "EffectIrValidationError";
    this.issues = issues;
  }
}
