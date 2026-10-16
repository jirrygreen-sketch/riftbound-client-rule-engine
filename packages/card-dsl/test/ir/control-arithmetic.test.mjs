import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../dist/index.js";

const constant = value => ({ kind: "constant", value });
const arithmetic = (operator, ...operands) => ({ kind: "arithmetic", operator, operands });
const instruction = (id, op = "effect.draw", args = {}) => ({ id, op, args });
const sequence = body => instruction("sequence", "sequence", { body: constant(body) });
const repeat = (body, extra = {}) => instruction("repeat", "repeat", { count: constant(2), body: constant(body), ...extra });
const linked = instructionId => ({ kind: "linked-value", instructionId, key: "count" });
const program = body => ({ canonicalCardId: "test.control", rulesetVersion: EFFECT_IR_V2_RULESET, status: "executable", sourceText: "synthetic", abilities: [{ kind: "play", body }] });
const check = body => validateCardProgram(program(body));
const rejected = (body, path) => {
  const outcome = check(body);
  assert.equal(outcome.ok, false);
  assert.ok(outcome.issues.some(issue => issue.path.endsWith(path)), JSON.stringify(outcome.issues));
};

for (const [operator, numbers] of [
  ["add", [1, 2, 3]], ["sub", [4, 2]], ["subtract", [4, 2]], ["mul", [2, 3]],
  ["multiply", [2, 3]], ["div", [4, 2]], ["divide", [4, 2]], ["min", [2, 3]], ["max", [2, 3]], ["neg", [2]]
]) {
  test(`validates native ${operator} expressions`, () => {
    assert.equal(check([instruction("calculate", "condition.value", { value: arithmetic(operator, ...numbers.map(constant)) })]).ok, true);
  });
}

test("nested arithmetic can read preceding links and symbolic object selectors", () => {
  const expression = arithmetic("max", arithmetic("neg", constant(-3)), arithmetic("add", linked("first"), {
    kind: "object-property", object: "self", property: "might"
  }));
  assert.equal(check([instruction("first"), instruction("second", "effect.draw", { amount: expression })]).ok, true);
});

for (const [operator, operands] of [["unknown", [constant(1)]], ["neg", []], ["neg", [constant(1), constant(2)]], ["sub", [constant(1)]], ["divide", [constant(1)]], ["max", []]]) {
  test(`rejects invalid arithmetic ${operator} arity ${operands.length}`, () => {
    rejected([instruction("invalid", "condition.value", { value: { kind: "arithmetic", operator, operands } })], operator === "unknown" ? ".operator" : ".operands");
  });
}

test("rejects malformed nested arithmetic operands", () => {
  rejected([instruction("invalid", "effect.draw", { amount: arithmetic("add", constant(1), { kind: "unknown" }) })], ".operands[1].kind");
});

test("rejects cycles in native expressions", () => {
  const expression = arithmetic("add", constant(1));
  expression.operands.push(expression);
  rejected([instruction("invalid", "effect.draw", { amount: expression })], ".operands[1]");
});

test("rejects non-finite arithmetic literals", () => {
  rejected([instruction("invalid", "effect.draw", { amount: arithmetic("add", constant(Infinity)) })], ".operands[0].value");
});

test("rejects arithmetic literals missing their value", () => {
  rejected([instruction("invalid", "effect.draw", { amount: arithmetic("add", { kind: "constant" }) })], ".operands[0].value");
});

test("arithmetic with a null printed characteristic stays structurally valid", () => {
  assert.equal(check([instruction("value", "condition.value", { value: arithmetic("add", constant(null), constant(1)) })]).ok, true);
});

test("validates sequence, nested repeat, dynamic count, and target reselection", () => {
  const body = [instruction("first"), sequence([repeat([instruction("child")], { count: arithmetic("add", linked("first"), constant(1)), reselectTargets: constant(false) })])];
  const outcome = check(body);
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
});

test("sequence child bindings remain visible to its successors", () => {
  assert.equal(check([sequence([instruction("child")]), instruction("after", "effect.draw", { amount: linked("child") })]).ok, true);
});

test("repeat can read its enclosing scope but does not leak iteration bindings", () => {
  const loop = repeat([instruction("child", "effect.draw", { amount: linked("outer") })]);
  assert.equal(check([instruction("outer"), loop]).ok, true);
  rejected([instruction("outer"), loop, instruction("after", "effect.draw", { amount: linked("child") })], ".instructionId");
});

test("independent repeats may reuse local instruction ids", () => {
  const left = repeat([instruction("child")]);
  const right = { ...repeat([instruction("child")]), id: "repeat-again" };
  assert.equal(check([left, right]).ok, true);
});

test("rejects duplicate ids in a sequence's shared scope", () => {
  rejected([instruction("child"), sequence([instruction("child")])], ".body.value[0].id");
});

test("rejects forward links inside structural bodies", () => {
  rejected([sequence([instruction("before", "effect.draw", { amount: linked("after") }), instruction("after")])], ".instructionId");
});

for (const [op, args, path] of [
  ["sequence", {}, ".body"], ["sequence", { body: constant({}) }, ".body.value"],
  ["sequence", { body: constant([{ id: "child", op: "Bad Opcode", args: {} }]) }, ".body.value[0].op"],
  ["repeat", { body: constant([]) }, ".count"],
  ["repeat", { count: constant(-1), body: constant([]) }, ".count.value"],
  ["repeat", { count: constant(1.5), body: constant([]) }, ".count.value"],
  ["repeat", { count: constant(2), body: constant([]), reselectTargets: constant("yes") }, ".reselectTargets.value"]
]) {
  test(`rejects malformed ${op} payload at ${path}`, () => rejected([instruction("invalid", op, args)], path));
}

test("rejects a cyclic structural body without overflowing", () => {
  const container = sequence([]);
  container.args.body.value.push(container);
  rejected([container], ".body.value[0]");
});

test("accepts literal body aliases and zero repetitions", () => {
  assert.equal(check([repeat([], { count: constant(0), body: { kind: "literal", value: [] } })]).ok, true);
});

test("keeps expression-shaped constant data literal", () => {
  assert.equal(check([instruction("literal", "effect.custom", { data: constant({ kind: "arithmetic", operator: "unknown", operands: [] }) })]).ok, true);
});

test("rejects runtime object references in static IR", () => {
  rejected([instruction("invalid", "effect.draw", { amount: { kind: "object-attribute", object: { id: "unit", zoneEntryId: -1 }, attribute: "might" } })], ".object");
});

test("exported control and arithmetic types compose into a CardProgram", async () => {
  const { default: typescript } = await import("typescript");
  const compiled = typescript.createProgram([fileURLToPath(new URL("./control-arithmetic.types.ts", import.meta.url))], {
    noEmit: true, strict: true, skipLibCheck: true, target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.NodeNext, moduleResolution: typescript.ModuleResolutionKind.NodeNext
  });
  const diagnostics = typescript.getPreEmitDiagnostics(compiled);
  assert.deepEqual(diagnostics.map(diagnostic => typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});
