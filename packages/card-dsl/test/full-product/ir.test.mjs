import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_PRODUCT_EFFECT_OPCODES,
  FullProductEffectIrValidationError,
  compileFullProductEffectText,
  isFullProductEffectIr,
  parseFullProductEffectIr,
  validateFullProductEffectIr
} from "../../dist/full-product/types.js";

function fixture() {
  return {
    kind: "full-product-effect-ir",
    schemaVersion: 1,
    ruleset: "full-product",
    id: "card.full-product-sample",
    body: [
      {
        type: "target",
        id: "card.full-product-sample.target",
        placeholder: "selected-target",
        minCount: 1,
        maxCount: 1
      },
      {
        type: "trigger",
        id: "card.full-product-sample.trigger",
        event: "card.arrives",
        body: [
          { type: "effect", id: "card.full-product-sample.cost", opcode: "cost.energy", args: { amount: 1 } },
          { type: "effect", id: "card.full-product-sample.draw", opcode: "draw.cards", args: { count: 1 } },
          { type: "effect", id: "card.full-product-sample.energy", opcode: "gain.energy", args: { amount: 1 } },
          { type: "effect", id: "card.full-product-sample.score", opcode: "gain.score", args: { amount: 1 } },
          { type: "effect", id: "card.full-product-sample.move", opcode: "move.zone", args: { zone: "discard" } },
          {
            type: "effect",
            id: "card.full-product-sample.prompt",
            opcode: "prompt.target",
            args: { prompt: "Choose a target" },
            targetId: "card.full-product-sample.target"
          },
          { type: "effect", id: "card.full-product-sample.chain", opcode: "chain.create", args: { count: 1 } },
          {
            type: "effect",
            id: "card.full-product-sample.judge",
            opcode: "judge.required",
            args: { reason: "Official semantics are not verified." }
          }
        ]
      }
    ]
  };
}

test("accepts the full-product EffectIR v1 opcode set", () => {
  assert.deepEqual([...FULL_PRODUCT_EFFECT_OPCODES], [
    "cost.energy",
    "draw.cards",
    "gain.energy",
    "gain.score",
    "move.zone",
    "prompt.target",
    "chain.create",
    "judge.required"
  ]);

  const input = fixture();
  const result = validateFullProductEffectIr(input);
  assert.equal(result.ok, true);
  assert.equal(isFullProductEffectIr(input), true);
  assert.equal(parseFullProductEffectIr(input).id, "card.full-product-sample");
});

test("rejects unknown opcodes", () => {
  const input = fixture();
  input.body[1].body[1].opcode = "destroy.everything";

  const result = validateFullProductEffectIr(input);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue =>
    issue.code === "unknown-opcode" &&
    issue.path === "$.body[1].body[1].opcode"
  ));
  assert.equal(isFullProductEffectIr(input), false);
  assert.throws(
    () => parseFullProductEffectIr(input),
    error =>
      error instanceof FullProductEffectIrValidationError &&
      error.issues.some(issue => issue.code === "unknown-opcode")
  );
});

test("rejects unknown arguments and fields", () => {
  const input = fixture();
  input.body[1].body[1].args = { count: 1, extra: "not allowed" };

  const result = validateFullProductEffectIr(input);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue =>
    issue.code === "unknown-argument" &&
    issue.path === "$.body[1].body[1].args.extra"
  ));

  const documentExtra = { ...fixture(), extra: true };
  const documentResult = validateFullProductEffectIr(documentExtra);
  assert.equal(documentResult.ok, false);
  assert.ok(documentResult.issues.some(issue =>
    issue.code === "unknown-field" && issue.path === "$.extra"
  ));

  const nodeExtra = fixture();
  nodeExtra.body[1].body[1].extra = "not allowed";
  const nodeResult = validateFullProductEffectIr(nodeExtra);
  assert.equal(nodeResult.ok, false);
  assert.ok(nodeResult.issues.some(issue =>
    issue.code === "unknown-field" &&
    issue.path === "$.body[1].body[1].extra"
  ));
});

test("checks missing, unexpected, and unresolved target references", () => {
  const missingTarget = fixture();
  delete missingTarget.body[1].body[5].targetId;
  const missingResult = validateFullProductEffectIr(missingTarget);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.issues.some(issue =>
    issue.code === "missing-target" &&
    issue.path === "$.body[1].body[5].targetId"
  ));

  const unexpectedTarget = fixture();
  unexpectedTarget.body[1].body[1].targetId = "card.full-product-sample.target";
  const unexpectedResult = validateFullProductEffectIr(unexpectedTarget);
  assert.equal(unexpectedResult.ok, false);
  assert.ok(unexpectedResult.issues.some(issue =>
    issue.code === "unexpected-target" &&
    issue.path === "$.body[1].body[1].targetId"
  ));

  const unresolvedTarget = fixture();
  unresolvedTarget.body[1].body[5].targetId = "card.missing-target";
  const unresolvedResult = validateFullProductEffectIr(unresolvedTarget);
  assert.equal(unresolvedResult.ok, false);
  assert.ok(unresolvedResult.issues.some(issue =>
    issue.code === "unresolved-target" &&
    issue.path === "$.body[1].body[5].targetId"
  ));
});

test("keeps judge-required effects explicit and strictly typed", () => {
  const input = {
    kind: "full-product-effect-ir",
    schemaVersion: 1,
    ruleset: "full-product",
    id: "card.blocked-effect",
    body: [
      {
        type: "effect",
        id: "card.blocked-effect.effect",
        opcode: "judge.required",
        args: { reason: "Timing is not officially verified." }
      }
    ]
  };

  assert.equal(isFullProductEffectIr(input), true);

  const extraArgument = structuredClone(input);
  extraArgument.body[0].args = {
    reason: "Timing is not officially verified.",
    guess: false
  };
  const result = validateFullProductEffectIr(extraArgument);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue =>
    issue.code === "unknown-argument" &&
    issue.path === "$.body[0].args.guess"
  ));
});

test("compiles only the five explicitly verified sentences", () => {
  const cases = [
    ["draw 1 card", "draw.cards", { count: 1 }],
    ["gain 1 energy", "gain.energy", { amount: 1 }],
    ["gain 1 score", "gain.score", { amount: 1 }],
    ["move this card to discard", "move.zone", { zone: "discard" }],
    ["create 1 chain item", "chain.create", { count: 1 }]
  ];

  for (const [text, opcode, args] of cases) {
    const compiled = compileFullProductEffectText({
      id: "card.verified-effect",
      text: ` ${text}. `
    });
    assert.equal(compiled.status, "executable");
    assert.deepEqual(compiled.ir.body, [
      {
        type: "effect",
        id: "card.verified-effect.effect",
        opcode,
        args
      }
    ]);
  }
});

test("returns judgeRequired for empty, unknown, and ambiguous text", () => {
  const empty = compileFullProductEffectText({
    id: "card.no-text",
    text: "   "
  });
  assert.equal(empty.status, "judgeRequired");
  assert.equal(empty.ir, null);
  assert.equal(empty.issues[0].code, "empty-text");

  for (const text of [
    "draw 2 cards",
    "move this card to hand",
    "draw 1 card and gain 1 energy",
    "target player discards a card"
  ]) {
    const result = compileFullProductEffectText({
      id: "card.unverified-text",
      text
    });
    assert.equal(result.status, "judgeRequired");
    assert.equal(result.ir, null);
    assert.equal(result.issues[0].code, "judge-required");
  }
});
