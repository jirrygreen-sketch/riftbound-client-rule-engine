import assert from "node:assert/strict";
import test from "node:test";
import {
  CardDslValidationError,
  compileEffectText,
  EFFECT_OPCODES,
  EffectIrValidationError,
  isCardDsl,
  isEffectIr,
  parseCardDsl,
  parseEffectIr,
  serializeCardDsl,
  stableHashCardDsl,
  validateCardDsl,
  validateEffectIr
} from "../dist/index.js";

function fixture() {
  return {
    kind: "card-dsl",
    schemaVersion: 1,
    ruleset: "synthetic-demo",
    id: "demo.signal-beacon",
    body: [
      {
        type: "target",
        id: "demo.target.opponent",
        placeholder: "opponent-target",
        minCount: 1,
        maxCount: 1
      },
      {
        type: "trigger",
        id: "demo.trigger.arrival",
        event: "demo.zone-entered",
        filter: { controller: "self", kind: "demo.signal" },
        body: [
          {
            type: "optional",
            id: "demo.optional.signal",
            prompt: "Resolve the demo signal?",
            body: [
              {
                type: "choice",
                id: "demo.choice.signal",
                prompt: "Choose a demo result",
                defaultOptionId: "pulse",
                options: [
                  {
                    id: "pulse",
                    label: "Emit a pulse",
                    body: [
                      {
                        type: "effect",
                        id: "demo.effect.pulse",
                        operation: "demo.adjust-counter",
                        arguments: { amount: 1, counter: "pulse" },
                        targetId: "demo.target.opponent"
                      }
                    ]
                  },
                  {
                    id: "mark",
                    label: "Place a demo marker",
                    body: [
                      {
                        type: "effect",
                        id: "demo.effect.mark",
                        operation: "demo.add-marker",
                        arguments: { marker: "demo-mark" }
                      }
                    ]
                  }
                ]
              }
            ],
            decline: [
              {
                type: "auto-resolve",
                id: "demo.auto.decline",
                body: [
                  {
                    type: "effect",
                    id: "demo.effect.decline",
                    operation: "demo.record-note",
                    arguments: { note: "declined" }
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };
}

test("accepts the complete synthetic-demo node set", () => {
  const input = fixture();
  const result = validateCardDsl(input);

  assert.equal(result.ok, true);
  assert.equal(isCardDsl(input), true);
  assert.equal(parseCardDsl(input).id, "demo.signal-beacon");
});

test("rejects unknown fields at the document and nested node levels", () => {
  const documentWithUnknown = { ...fixture(), extra: true };
  const documentResult = validateCardDsl(documentWithUnknown);
  assert.equal(documentResult.ok, false);
  assert.ok(documentResult.issues.some(issue => issue.code === "unknown-field"));

  const input = fixture();
  input.body[0].extra = "not allowed";
  const nodeResult = validateCardDsl(input);
  assert.equal(nodeResult.ok, false);
  assert.ok(nodeResult.issues.some(issue => issue.code === "unknown-field"));
});

test("rejects unsupported node types", () => {
  const input = fixture();
  input.body.push({ type: "chain-link", id: "demo.chain-link" });

  const result = validateCardDsl(input);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === "unknown-node-type"));
});

test("checks target ranges, references, and global node ids", () => {
  const badRange = fixture();
  badRange.body[0].minCount = 2;
  badRange.body[0].maxCount = 1;
  const rangeResult = validateCardDsl(badRange);
  assert.equal(rangeResult.ok, false);
  assert.ok(rangeResult.issues.some(issue => issue.code === "invalid-range"));

  const missingTarget = fixture();
  missingTarget.body[1].body[0].body[0].options[0].body[0].targetId =
    "demo.target.missing";
  const targetResult = validateCardDsl(missingTarget);
  assert.equal(targetResult.ok, false);
  assert.ok(targetResult.issues.some(issue => issue.code === "unresolved-target"));

  const duplicateId = fixture();
  duplicateId.body[1].body[0].body[0].options[0].body[0].id =
    "demo.effect.mark";
  const duplicateResult = validateCardDsl(duplicateId);
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.issues.some(issue => issue.code === "duplicate-node-id"));
});

test("checks choice option constraints", () => {
  const duplicateOption = fixture();
  duplicateOption.body[1].body[0].body[0].options[1].id = "pulse";
  const duplicateResult = validateCardDsl(duplicateOption);
  assert.equal(duplicateResult.ok, false);
  assert.ok(duplicateResult.issues.some(issue => issue.code === "duplicate-option-id"));

  const unknownDefault = fixture();
  unknownDefault.body[1].body[0].body[0].defaultOptionId = "unknown";
  const defaultResult = validateCardDsl(unknownDefault);
  assert.equal(defaultResult.ok, false);
  assert.ok(defaultResult.issues.some(issue => issue.code === "unknown-default-option"));
});

test("rejects hidden player choices inside an auto-resolve body", () => {
  const autoResolvedChoice = fixture();
  autoResolvedChoice.body[1].body[0].decline[0].body.push({
    type: "choice",
    id: "demo.choice.hidden",
    prompt: "Hidden choice?",
    options: [
      {
        id: "one",
        label: "One",
        body: [
          {
            type: "effect",
            id: "demo.effect.hidden-one",
            operation: "demo.record-note",
            arguments: { note: "one" }
          }
        ]
      },
      {
        id: "two",
        label: "Two",
        body: [
          {
            type: "effect",
            id: "demo.effect.hidden-two",
            operation: "demo.record-note",
            arguments: { note: "two" }
          }
        ]
      }
    ]
  });
  const choiceResult = validateCardDsl(autoResolvedChoice);
  assert.equal(choiceResult.ok, false);
  assert.ok(choiceResult.issues.some(issue => issue.code === "auto-resolve-choice"));

  const autoResolvedOptional = fixture();
  autoResolvedOptional.body[1].body[0].decline[0].body.push({
    type: "optional",
    id: "demo.optional.hidden",
    prompt: "Hidden optional action?",
    body: [
      {
        type: "effect",
        id: "demo.effect.hidden",
        operation: "demo.record-note",
        arguments: { note: "hidden" }
      }
    ],
    decline: []
  });
  const optionalResult = validateCardDsl(autoResolvedOptional);
  assert.equal(optionalResult.ok, false);
  assert.ok(optionalResult.issues.some(issue => issue.code === "auto-resolve-choice"));
});

test("rejects target selection inside an auto-resolve body", () => {
  const targetNode = fixture();
  targetNode.body[1].body[0].decline[0].body.push({
    type: "target",
    id: "demo.target.hidden",
    placeholder: "hidden-target",
    minCount: 1,
    maxCount: 1
  });
  const targetResult = validateCardDsl(targetNode);
  assert.equal(targetResult.ok, false);
  assert.ok(targetResult.issues.some(issue => issue.code === "auto-resolve-target"));

  const referencedTarget = fixture();
  referencedTarget.body[1].body[0].decline[0].body.push({
    type: "effect",
    id: "demo.effect.hidden-target",
    operation: "demo.adjust-counter",
    arguments: { amount: 1, counter: "pulse" },
    targetId: "demo.target.opponent"
  });
  const referencedResult = validateCardDsl(referencedTarget);
  assert.equal(referencedResult.ok, false);
  assert.ok(
    referencedResult.issues.some(issue =>
      issue.code === "auto-resolve-target" && issue.path.endsWith("targetId")
    )
  );
});

test("rejects values that are not pure JSON data", () => {
  const withUndefined = fixture();
  withUndefined.body[1].body[0].body[0].options[0].body[0].arguments.amount =
    undefined;
  const undefinedResult = validateCardDsl(withUndefined);
  assert.equal(undefinedResult.ok, false);
  assert.ok(undefinedResult.issues.some(issue => issue.code === "non-json-value"));

  const withNaN = fixture();
  withNaN.body[1].body[0].body[0].options[0].body[0].arguments.amount = Number.NaN;
  const nanResult = validateCardDsl(withNaN);
  assert.equal(nanResult.ok, false);
  assert.ok(nanResult.issues.some(issue => issue.code === "invalid-number"));

  const cyclic = fixture();
  cyclic.body[1].body[0].body[0].options[0].body[0].arguments.self = cyclic;
  const cyclicResult = validateCardDsl(cyclic);
  assert.equal(cyclicResult.ok, false);
  assert.ok(cyclicResult.issues.some(issue => issue.code === "cyclic-value"));
});

test("normalizes object key order and produces a stable hash", () => {
  const first = fixture();
  const second = {
    body: first.body,
    id: first.id,
    ruleset: first.ruleset,
    schemaVersion: first.schemaVersion,
    kind: first.kind
  };

  assert.equal(serializeCardDsl(first), serializeCardDsl(second));
  assert.equal(stableHashCardDsl(first), stableHashCardDsl(second));
  assert.match(stableHashCardDsl(first), /^fnv1a64:[0-9a-f]{16}$/);
  assert.notEqual(stableHashCardDsl(first), stableHashCardDsl({ ...first, id: "demo.other" }));
});

test("parseCardDsl throws a structured validation error", () => {
  const input = fixture();
  input.ruleset = "official";

  assert.throws(
    () => parseCardDsl(input),
    error =>
      error instanceof CardDslValidationError &&
      error.issues.some(issue => issue.code === "unsupported-ruleset")
  );
});

test("defines explicit executable effect opcodes", () => {
  assert.deepEqual([...EFFECT_OPCODES], [
    "draw.cards",
    "damage.target",
    "gain.energy",
    "summon.self"
  ]);
});

test("compiles only explicitly verified basic effects", () => {
  const draw = compileEffectText({
    id: "card.verified-draw",
    text: " When   THIS card ARRIVES, draw 1 card. "
  });
  assert.equal(draw.status, "executable");
  assert.equal(isEffectIr(draw.ir), true);
  assert.deepEqual(draw.ir.body, [
    {
      type: "trigger",
      id: "card.verified-draw.trigger",
      event: "card.arrives",
      body: [
        {
          type: "effect",
          id: "card.verified-draw.effect",
          opcode: "draw.cards",
          args: { count: 1 }
        }
      ]
    }
  ]);

  const damage = compileEffectText({
    id: "card.verified-damage",
    text: "When this card arrives, deal 2 damage to target."
  });
  assert.equal(damage.status, "executable");
  assert.equal(damage.ir.body[0].id, "card.verified-damage.target.selected");
  assert.equal(
    damage.ir.body[1].body[0].targetId,
    "card.verified-damage.target.selected"
  );
});

test("returns judgeRequired instead of guessing unknown text", () => {
  const unknown = compileEffectText({
    id: "card.unknown-effect",
    text: "When this card arrives, each player discards a card."
  });
  assert.equal(unknown.status, "judgeRequired");
  assert.equal(unknown.ir, null);
  assert.deepEqual(unknown.issues, [
    {
      path: "card.unknown-effect.ability",
      code: "judge-required",
      message: "The ability text is outside the explicitly verified compiler coverage."
    }
  ]);

  const empty = compileEffectText({
    id: "card.no-text",
    text: "   "
  });
  assert.equal(empty.status, "judgeRequired");
  assert.equal(empty.issues[0].code, "empty-text");

  for (const text of [
    "When this card arrives, draw 2 cards.",
    "When this card arrives, deal 1 damage to target.",
    "When this card arrives, gain 2 energy.",
    "When this card arrives, summon a token."
  ]) {
    const nearMiss = compileEffectText({
      id: "card.near-miss-effect",
      text
    });
    assert.equal(nearMiss.status, "judgeRequired");
  }
});

test("validates EffectIR opcodes, arguments, targets, and node ids", () => {
  const goodIr = {
    kind: "effect-ir",
    schemaVersion: 1,
    ruleset: "synthetic-demo",
    id: "card.good-effect",
    body: [
      {
        type: "target",
        id: "card.good-effect.target",
        placeholder: "selected-target",
        minCount: 1,
        maxCount: 1
      },
      {
        type: "trigger",
        id: "card.good-effect.trigger",
        event: "card.arrives",
        body: [
          {
            type: "effect",
            id: "card.good-effect.effect",
            opcode: "damage.target",
            args: { amount: 2 },
            targetId: "card.good-effect.target"
          }
        ]
      }
    ]
  };
  assert.equal(isEffectIr(goodIr), true);
  assert.equal(parseEffectIr(goodIr).id, "card.good-effect");

  const unknownOpcode = structuredClone(goodIr);
  unknownOpcode.body[1].body[0].opcode = "destroy.everything";
  assert.throws(
    () => {
      throw new EffectIrValidationError([{ path: "$", code: "test", message: "test" }]);
    },
    (error) => error instanceof EffectIrValidationError
  );
  assert.equal(isEffectIr(unknownOpcode), false);

  const badArguments = structuredClone(goodIr);
  badArguments.body[1].body[0].args = { count: 2 };
  assert.equal(isEffectIr(badArguments), false);

  const missingTarget = structuredClone(goodIr);
  delete missingTarget.body[1].body[0].targetId;
  assert.equal(isEffectIr(missingTarget), false);

  const unexpectedTarget = structuredClone(goodIr);
  unexpectedTarget.body[1].body[0].opcode = "draw.cards";
  assert.equal(isEffectIr(unexpectedTarget), false);

  const duplicateId = structuredClone(goodIr);
  duplicateId.body[1].id = "card.good-effect.target";
  assert.equal(isEffectIr(duplicateId), false);

  assert.throws(
    () => parseEffectIr(unknownOpcode),
    error =>
      error instanceof EffectIrValidationError &&
      error.issues.some(issue => issue.code === "unknown-opcode")
  );
});

test("rejects unknown EffectIR argument keys", () => {
  const goodIr = {
    kind: "effect-ir",
    schemaVersion: 1,
    ruleset: "synthetic-demo",
    id: "card.extra-argument",
    body: [
      {
        type: "trigger",
        id: "card.extra-argument.trigger",
        event: "card.arrives",
        body: [
          {
            type: "effect",
            id: "card.extra-argument.effect",
            opcode: "draw.cards",
            args: { count: 1, surprise: "not in the opcode spec" }
          }
        ]
      }
    ]
  };

  const result = validateEffectIr(goodIr);
  assert.equal(result.ok, false);
  assert.equal(isEffectIr(goodIr), false);
  assert.ok(
    result.issues.some(issue =>
      issue.code === "unknown-argument" &&
      issue.path === "$.body[0].body[0].args.surprise"
    )
  );
});

test("keeps compiled EffectIR arguments isolated between calls", () => {
  const first = compileEffectText({
    id: "card.argument-isolation",
    text: "When this card arrives, draw 1 card."
  });
  assert.equal(first.status, "executable");

  first.ir.body[0].body[0].args.count = 7;

  const second = compileEffectText({
    id: "card.argument-isolation-two",
    text: "When this card arrives, draw 1 card."
  });
  assert.equal(second.status, "executable");
  assert.deepEqual(second.ir.body[0].body[0].args, { count: 1 });
});

test("rejects non-plain EffectIR documents", () => {
  class EffectIrLike {
    constructor() {
      this.kind = "effect-ir";
      this.schemaVersion = 1;
      this.ruleset = "synthetic-demo";
      this.id = "card.class-instance";
      this.body = [
        {
          type: "trigger",
          id: "card.class-instance.trigger",
          event: "card.arrives",
          body: [
            {
              type: "effect",
              id: "card.class-instance.effect",
              opcode: "draw.cards",
              args: { count: 1 }
            }
          ]
        }
      ];
    }
  }

  const result = validateEffectIr(new EffectIrLike());
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === "invalid-document"));
});
