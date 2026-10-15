import { EFFECT_IR_SCHEMA_VERSION, ID_PATTERN, SYNTHETIC_DEMO_RULESET } from "./constants.js";
import { EffectIrValidationError } from "./effect-ir-types.js";
import type { EffectIr, EffectIrNode, EffectOpcode } from "./effect-ir-types.js";
import { validateEffectIr } from "./effect-ir-validation.js";
import type { JsonObject } from "./types.js";

export interface EffectTextDiagnostic {
  readonly path: string;
  readonly code: "empty-text" | "judge-required";
  readonly message: string;
}

export type EffectTextCompilationResult =
  | {
      readonly status: "executable";
      readonly ir: EffectIr;
      readonly issues: readonly [];
    }
  | {
      readonly status: "judgeRequired";
      readonly ir: null;
      readonly issues: readonly EffectTextDiagnostic[];
    };

export interface EffectTextCompilationInput {
  readonly id: string;
  readonly text: string;
}

interface EffectTextRule {
  readonly triggerEvent: string;
  readonly opcode: EffectOpcode;
  readonly args: JsonObject;
  readonly target?: boolean;
}

const EFFECT_TEXT_RULES = new Map<string, EffectTextRule>([
  [
    "when this card arrives, draw 1 card",
    { triggerEvent: "card.arrives", opcode: "draw.cards", args: { count: 1 } }
  ],
  [
    "when this card is discarded, draw 1 card",
    { triggerEvent: "card.discarded", opcode: "draw.cards", args: { count: 1 } }
  ],
  [
    "when this card arrives, deal 2 damage to target",
    {
      triggerEvent: "card.arrives",
      opcode: "damage.target",
      args: { amount: 2 },
      target: true
    }
  ],
  [
    "when this card arrives, gain 1 energy",
    {
      triggerEvent: "card.arrives",
      opcode: "gain.energy",
      args: { amount: 1, player: "self" }
    }
  ],
  [
    "when this card arrives, summon this card",
    { triggerEvent: "card.arrives", opcode: "summon.self", args: {} }
  ]
]);

function normalizeEffectText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]$/, "");
}

export function compileEffectText(
  input: EffectTextCompilationInput
): EffectTextCompilationResult {
  if (typeof input.id !== "string" || !ID_PATTERN.test(input.id)) {
    throw new EffectIrValidationError([
      { path: "$.id", code: "invalid-identifier", message: "Expected a stable card id." }
    ]);
  }
  if (typeof input.text !== "string") {
    throw new EffectIrValidationError([
      { path: "$.text", code: "invalid-text", message: "Expected card text as a string." }
    ]);
  }

  const normalized = normalizeEffectText(input.text);
  if (normalized === "") {
    return {
      status: "judgeRequired",
      ir: null,
      issues: [
        {
          path: `${input.id}.ability`,
          code: "empty-text",
          message: "No ability text is available to compile."
        }
      ]
    };
  }

  const rule = EFFECT_TEXT_RULES.get(normalized);
  if (rule === undefined) {
    return {
      status: "judgeRequired",
      ir: null,
      issues: [
        {
          path: `${input.id}.ability`,
          code: "judge-required",
          message: "The ability text is outside the explicitly verified compiler coverage."
        }
      ]
    };
  }

  const targetId = rule.target === true ? `${input.id}.target.selected` : undefined;
  const compiledArgs = { ...rule.args };
  const body: EffectIrNode[] = [];
  if (targetId !== undefined) {
    body.push({
      type: "target",
      id: targetId,
      placeholder: "selected-target",
      minCount: 1,
      maxCount: 1
    });
  }
  body.push({
    type: "trigger",
    id: `${input.id}.trigger`,
    event: rule.triggerEvent,
    body: [
      targetId === undefined
        ? {
            type: "effect",
            id: `${input.id}.effect`,
            opcode: rule.opcode,
            args: compiledArgs
          }
        : {
            type: "effect",
            id: `${input.id}.effect`,
            opcode: rule.opcode,
            args: compiledArgs,
            targetId
          }
    ]
  });

  const ir = {
    kind: "effect-ir",
    schemaVersion: EFFECT_IR_SCHEMA_VERSION,
    ruleset: SYNTHETIC_DEMO_RULESET,
    id: input.id,
    body
  };
  const result = validateEffectIr(ir);
  if (!result.ok) {
    throw new EffectIrValidationError(result.issues);
  }
  return { status: "executable", ir: result.value, issues: [] };
}
