import type {
  ArithmeticExpr, CardProgram, ControlInstruction, Expr, Instruction,
  InstructionBodyExpr, ObjectSelector, RepeatArgs, RepeatInstruction, SequenceInstruction
} from "../../dist/index.js";

const amount = {
  kind: "arithmetic", operator: "add", operands: [
    { kind: "constant", value: 1 },
    { kind: "arithmetic", operator: "neg", operands: [{ kind: "constant", value: -1 }] }
  ]
} satisfies ArithmeticExpr;

const child: Instruction = { id: "draw", op: "effect.draw", args: { amount } };
const body: InstructionBodyExpr = { kind: "constant", value: [child] };
const args: RepeatArgs = { count: amount, body, reselectTargets: { kind: "constant", value: false } };
const repeat: RepeatInstruction = { id: "loop", op: "repeat", args };
const sequence: SequenceInstruction = { id: "sequence", op: "sequence", args: { body: { kind: "literal", value: [repeat] } } };
const controls: readonly ControlInstruction[] = [sequence, repeat];
const expressions: readonly Expr[] = [amount, body];
const selectors: readonly ObjectSelector[] = ["self", "source", { target: "unit" }, { pick: "unit" }, { linked: "before" }];
const properties: readonly Expr[] = selectors.map(object => ({ kind: "object-property", object, property: "might" }));
// @ts-expect-error Static IR selectors cannot embed runtime zone identities.
const runtimeSelector: ObjectSelector = { id: "unit", zoneEntryId: 1 };

export const program: CardProgram = {
  canonicalCardId: "test.typed", rulesetVersion: "core-1.5", status: "executable", sourceText: "synthetic",
  abilities: [{ kind: "play", body: controls }]
};
export { expressions, properties, runtimeSelector };
