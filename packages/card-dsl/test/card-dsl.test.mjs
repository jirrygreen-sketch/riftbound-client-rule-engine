import assert from "node:assert/strict";
import test from "node:test";
import {
  CardDslValidationError,
  isCardDsl,
  parseCardDsl,
  serializeCardDsl,
  stableHashCardDsl,
  validateCardDsl
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
